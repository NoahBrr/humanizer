import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorizePlatform, platformOrgScopeError } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { platformCan, PLATFORM_PERMISSIONS, type PlatformPermission } from "@/lib/platform-permissions";

const ORG_TYPES = [
  "PART_61_FLIGHT_SCHOOL", "PART_141_FLIGHT_SCHOOL", "FLYING_CLUB", "UNIVERSITY_PROGRAM",
  "CORPORATE_FLIGHT_DEPT", "MAINTENANCE_ORG", "OTHER",
] as const;
const emptyToNull = z.literal("").transform(() => null);

const patchSchema = z.object({
  // Profile (platform.orgs.edit)
  name: z.string().min(2).max(120).optional(),
  legalName: z.string().max(200).nullable().optional(),
  orgType: z.enum(ORG_TYPES).optional(),
  description: z.string().max(2000).nullable().optional(),
  website: z.string().url().max(200).nullable().optional().or(emptyToNull),
  phone: z.string().max(40).nullable().optional(),
  billingEmail: z.string().email().nullable().optional().or(emptyToNull),
  primaryContactName: z.string().max(120).nullable().optional(),
  primaryContactEmail: z.string().email().nullable().optional().or(emptyToNull),
  primaryContactPhone: z.string().max(40).nullable().optional(),
  address: z.string().max(300).nullable().optional(),
  timeZone: z.string().max(60).optional(),
  isDiscoverable: z.boolean().optional(),
  onboardingStatus: z.enum(["NOT_STARTED", "IN_PROGRESS", "LIVE"]).optional(),
  // Branding (platform.branding.manage)
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  // Capacity (platform.capacity.manage)
  maxAircraftOverride: z.number().int().positive().max(100000).nullable().optional(),
  maxUsersOverride: z.number().int().positive().max(100000).nullable().optional(),
  // Commercial (platform.pricing.change)
  subscriptionStatus: z.enum(["TRIAL", "ACTIVE", "PAST_DUE", "CANCELED", "MANUAL"]).optional(),
  billingMode: z.enum(["MANUAL", "STRIPE"]).optional(),
  // Lifecycle / plan / modules / demo (platform.orgs.manage / .suspend)
  status: z.enum(["ACTIVE", "SUSPENDED", "DELETED"]).optional(),
  planId: z.string().optional(),
  disabledModules: z.array(z.string()).optional(),
  isDemo: z.boolean().optional(),
});

type Field = keyof z.infer<typeof patchSchema>;

// Every editable field maps to the platform permission it requires — so a
// role that may edit the profile but not pricing cannot change pricing, and the
// gate is per-field, not per-route (Part 4 / Part 10).
const FIELD_PERMISSION: Record<Exclude<Field, "status">, PlatformPermission> = {
  name: "platform.orgs.edit", legalName: "platform.orgs.edit", orgType: "platform.orgs.edit",
  description: "platform.orgs.edit", website: "platform.orgs.edit", phone: "platform.orgs.edit",
  billingEmail: "platform.orgs.edit", primaryContactName: "platform.orgs.edit",
  primaryContactEmail: "platform.orgs.edit", primaryContactPhone: "platform.orgs.edit",
  address: "platform.orgs.edit", timeZone: "platform.orgs.edit", isDiscoverable: "platform.orgs.edit",
  onboardingStatus: "platform.orgs.edit",
  brandColor: "platform.branding.manage",
  maxAircraftOverride: "platform.capacity.manage", maxUsersOverride: "platform.capacity.manage",
  subscriptionStatus: "platform.pricing.change", billingMode: "platform.pricing.change",
  planId: "platform.orgs.manage", disabledModules: "platform.orgs.manage", isDemo: "platform.orgs.manage",
};

/**
 * Edit an organization (Part 4). Every requested field is authorized against the
 * platform permission it requires — profile vs branding vs capacity vs pricing vs
 * lifecycle — so a role can change only what it's allowed to. Ownership is NOT
 * editable here: it routes through the dedicated ownership-transfer workflow
 * (PATCH /api/platform/users/[id] transfer_owner). Every change writes a
 * before/after audit record; sensitive fields (suspension, pricing, capacity,
 * demo classification, financial modules) require their own permission.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await authorizePlatform(undefined, { mutating: true });
  if (staff.error) return staff.error;
  const session = staff.session;

  const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (raw && "ownerId" in raw) {
    return NextResponse.json({ error: "Ownership cannot be changed here — use the ownership-transfer workflow." }, { status: 400 });
  }

  const { id } = await params;
  const scopeError = platformOrgScopeError(session, id);
  if (scopeError) return scopeError;
  const org = await db.organization.findUnique({ where: { id } });
  if (!org) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = patchSchema.safeParse(raw);
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const data = body.data;
  const changed = (Object.keys(data) as Field[]).filter((k) => data[k] !== undefined);
  if (changed.length === 0) return NextResponse.json({ error: "No changes supplied." }, { status: 400 });

  // Per-field permission enforcement. Soft-delete (DELETED) needs orgs.manage;
  // suspend/reactivate needs orgs.suspend.
  const required = new Set<PlatformPermission>();
  for (const k of changed) {
    if (k === "status") required.add(data.status === "DELETED" ? "platform.orgs.manage" : "platform.orgs.suspend");
    else required.add(FIELD_PERMISSION[k]);
  }
  for (const perm of required) {
    if (!platformCan(session.platformRole, perm)) {
      return NextResponse.json({ error: `Your platform role cannot: ${PLATFORM_PERMISSIONS[perm]}.` }, { status: 403 });
    }
  }

  // Build the update + before/after diff (only changed fields).
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const updateData: Record<string, unknown> = {};
  for (const k of changed) {
    before[k] = (org as Record<string, unknown>)[k];
    after[k] = data[k];
    updateData[k] = data[k];
  }
  if (data.status) {
    updateData.suspendedAt = data.status === "SUSPENDED" ? new Date() : null;
    updateData.deletedAt = data.status === "DELETED" ? new Date() : null;
  }

  const updated = await db.organization.update({ where: { id }, data: updateData });

  const action = data.status
    ? `platform.org_${data.status.toLowerCase()}`
    : changed.length === 1 && changed[0] === "planId"
      ? "platform.org_plan_change"
      : changed.length === 1 && changed[0] === "disabledModules"
        ? "platform.org_modules_change"
        : "platform.org_edit";

  await recordAudit({
    organizationId: id,
    actorPlatformUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName} (AeroOps)`,
    action,
    entityType: "Organization",
    entityId: id,
    oldValue: before,
    newValue: after,
  });

  return NextResponse.json({ organization: { id: updated.id, name: updated.name, status: updated.status } });
}
