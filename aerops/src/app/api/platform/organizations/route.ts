import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorizePlatform } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { systemOrgRoleSeed } from "@/lib/permissions";
import { platformRolesWith } from "@/lib/platform-permissions";
import { assignOwnerTx } from "@/lib/memberships";
import { createToken } from "@/lib/tokens";

const ORG_TYPES = [
  "PART_61_FLIGHT_SCHOOL", "PART_141_FLIGHT_SCHOOL", "FLYING_CLUB", "UNIVERSITY_PROGRAM",
  "CORPORATE_FLIGHT_DEPT", "MAINTENANCE_ORG", "OTHER",
] as const;

const optionalEmail = z.string().email().optional().or(z.literal("").transform(() => undefined));
const optionalUrl = z.string().url().max(200).optional().or(z.literal("").transform(() => undefined));

const createSchema = z.object({
  // Identity & profile
  name: z.string().min(2).max(120), // public display name
  legalName: z.string().max(200).optional(),
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/),
  orgType: z.enum(ORG_TYPES).default("OTHER"),
  description: z.string().max(2000).optional(),
  website: optionalUrl,
  phone: z.string().max(40).optional(),
  billingEmail: optionalEmail,
  primaryContactName: z.string().max(120).optional(),
  primaryContactEmail: optionalEmail,
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#2563eb"),
  timeZone: z.string().default("America/New_York"),
  // Commercial
  planId: z.string(),
  billingMode: z.enum(["MANUAL", "STRIPE"]).default("MANUAL"),
  subscriptionStatus: z.enum(["TRIAL", "ACTIVE", "PAST_DUE", "CANCELED", "MANUAL"]).default("TRIAL"),
  maxAircraftOverride: z.number().int().positive().max(100000).optional(),
  maxUsersOverride: z.number().int().positive().max(100000).optional(),
  isDiscoverable: z.boolean().default(false),
  isDemo: z.boolean().default(false),
  businessProfiles: z.array(z.string()).max(20).optional(),
  // Locations
  location: z.object({ name: z.string().min(2), icao: z.string().max(6).optional(), timeZone: z.string().optional() }),
  additionalLocations: z.array(z.object({ name: z.string().min(2), icao: z.string().max(6).optional(), timeZone: z.string().optional() })).max(20).optional(),
  // Initial Account Owner — an existing personal account, or an invitation.
  owner: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("existing"), userId: z.string().min(1) }),
    z.object({ mode: z.literal("invite"), email: z.string().email(), firstName: z.string().max(60).optional(), lastName: z.string().max(60).optional() }),
  ]),
});

/**
 * Create a customer organization with its initial Account Owner in one
 * transaction (Priority 0 / Part 2). Ownership is assigned atomically — either
 * an existing personal user becomes the owner (ownerId + active ACCOUNT_OWNER
 * membership together), or a proposed-owner invitation is minted (role
 * ACCOUNT_OWNER; ownership activates only when they accept and their account
 * exists). The org, first location, additional locations, system roles, and
 * internal defaults are provisioned together so a partially-configured org is
 * never left behind. The AeroOps operator is never inserted as a member.
 */
export async function POST(req: Request) {
  const { session, error } = await authorizePlatform(platformRolesWith("platform.orgs.manage"), { mutating: true });
  if (error) return error;

  const body = createSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const data = body.data;

  if (await db.organization.findUnique({ where: { slug: data.slug }, select: { id: true } })) {
    return NextResponse.json({ error: "That workspace slug is already taken — pick another." }, { status: 409 });
  }
  const plan = await db.subscriptionPlan.findUnique({ where: { id: data.planId } });
  if (!plan) return NextResponse.json({ error: "Unknown plan" }, { status: 400 });

  // Validate an existing-user owner up front (must be an active personal account).
  if (data.owner.mode === "existing") {
    const u = await db.user.findUnique({ where: { id: data.owner.userId }, select: { id: true, isActive: true, deletedAt: true } });
    if (!u || !u.isActive || u.deletedAt) {
      return NextResponse.json({ error: "The selected owner is not an active AeroOps account." }, { status: 400 });
    }
  } else {
    const clash = await db.user.findUnique({ where: { email: data.owner.email.toLowerCase() }, select: { id: true } });
    if (clash) {
      return NextResponse.json({ error: "An account with that owner email already exists — select them as the existing owner instead." }, { status: 409 });
    }
  }

  const actorLabel = `${session.firstName} ${session.lastName} (AeroOps)`;
  // Raw invite token is generated outside the transaction so only the hash is
  // ever persisted (ADR-020); the raw token lives only in the returned URL.
  const invite = data.owner.mode === "invite" ? createToken() : null;

  const { org, ownerMode } = await db.$transaction(async (tx) => {
    const created = await tx.organization.create({
      data: {
        name: data.name,
        legalName: data.legalName,
        slug: data.slug,
        orgType: data.orgType,
        description: data.description,
        website: data.website,
        phone: data.phone,
        billingEmail: data.billingEmail,
        primaryContactName: data.primaryContactName,
        primaryContactEmail: data.primaryContactEmail,
        brandColor: data.brandColor,
        timeZone: data.timeZone,
        planId: plan.id,
        billingMode: data.billingMode,
        subscriptionStatus: data.subscriptionStatus,
        maxAircraftOverride: data.maxAircraftOverride,
        maxUsersOverride: data.maxUsersOverride,
        isDiscoverable: data.isDiscoverable,
        isDemo: data.isDemo,
        businessProfiles: data.businessProfiles ?? [],
        onboardingStatus: "IN_PROGRESS",
        locations: {
          create: [
            { name: data.location.name, icao: data.location.icao, timeZone: data.location.timeZone ?? data.timeZone },
            ...(data.additionalLocations ?? []).map((l) => ({ name: l.name, icao: l.icao, timeZone: l.timeZone ?? data.timeZone })),
          ],
        },
        orgRoles: { create: systemOrgRoleSeed() },
      },
      include: { locations: { select: { id: true }, orderBy: { createdAt: "asc" }, take: 1 } },
    });

    if (data.owner.mode === "existing") {
      await assignOwnerTx(tx, { organizationId: created.id, userId: data.owner.userId, invitedByLabel: actorLabel, primaryLocationId: created.locations[0]?.id ?? null });
      return { org: created, ownerMode: "existing" as const };
    }
    // Proposed owner: ownership activates on acceptance (invitation role ACCOUNT_OWNER).
    await tx.invitation.create({
      data: {
        organizationId: created.id,
        email: data.owner.email.toLowerCase(),
        role: "ACCOUNT_OWNER",
        tokenHash: invite!.hash,
        invitedBy: actorLabel,
        expiresAt: new Date(Date.now() + 14 * 86_400_000),
      },
    });
    return { org: created, ownerMode: "invite" as const };
  });

  await recordAudit({
    organizationId: org.id,
    actorPlatformUserId: session.userId,
    actorLabel,
    action: "platform.org_create",
    entityType: "Organization",
    entityId: org.id,
    newValue: {
      name: org.name, slug: org.slug, orgType: org.orgType, plan: plan.name, isDemo: org.isDemo,
      owner: data.owner.mode === "existing" ? { existingUserId: data.owner.userId } : { invitedEmail: data.owner.email },
    },
  });

  return NextResponse.json(
    {
      organization: { id: org.id, name: org.name, slug: org.slug },
      ownerMode,
      // Only present for the invitation path.
      inviteUrl: invite ? `/invite/${invite.raw}` : null,
    },
    { status: 201 },
  );
}
