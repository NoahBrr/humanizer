import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requirePlatformSession } from "@/lib/session";
import { platformOrgInScope } from "@/lib/session-rules";
import { MODULES, CORE_MODULES, type ModuleKey } from "@/lib/features";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Avatar, Progress } from "@/components/ui/misc";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/rbac";
import { platformCan } from "@/lib/platform-permissions";
import { computeCustomerSuccess } from "@/lib/customer-success";
import { orgMembershipSummary } from "@/lib/memberships";
import { OrgActions, ImpersonateButton, ModuleToggles } from "./org-actions";
import { EditProfile } from "./edit-profile";
import { NotesPanel } from "./notes-panel";
import { SnapshotsPanel } from "./snapshots-panel";

export const dynamic = "force-dynamic";

const ORG_TYPE_LABELS: Record<string, string> = {
  PART_61_FLIGHT_SCHOOL: "Part 61 Flight School",
  PART_141_FLIGHT_SCHOOL: "Part 141 Flight School",
  FLYING_CLUB: "Flying Club",
  UNIVERSITY_PROGRAM: "University Aviation Program",
  CORPORATE_FLIGHT_DEPT: "Corporate Flight Department",
  MAINTENANCE_ORG: "Maintenance Organization",
  OTHER: "Other",
};

function Field({ label, value, link }: { label: string; value?: string | null; link?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      {value ? (
        link ? (
          <a href={value} target="_blank" rel="noreferrer" className="truncate text-primary hover:underline">{value}</a>
        ) : (
          <span className="truncate text-right">{value}</span>
        )
      ) : (
        <span className="text-muted-foreground/50">—</span>
      )}
    </div>
  );
}

export default async function OrganizationDetail({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePlatformSession();
  const { id } = await params;
  // Org-restricted staff can view only their scoped organizations (D3-A).
  if (!platformOrgInScope(session.restrictedOrgIds, id)) notFound();
  const org = await db.organization.findUnique({
    where: { id },
    include: {
      plan: true,
      locations: true,
      users: { where: { deletedAt: null }, orderBy: [{ role: "asc" }, { lastName: "asc" }] },
      invitations: { where: { acceptedAt: null, expiresAt: { gt: new Date() } } },
      auditLogs: { orderBy: { createdAt: "desc" }, take: 8 },
      _count: { select: { aircraft: true, scheduleEvents: true, invoices: true } },
    },
  });
  if (!org) notFound();
  const [plans, success, notes, snapshots, owner, members] = await Promise.all([
    db.subscriptionPlan.findMany({ orderBy: { priceMonthly: "asc" } }),
    computeCustomerSuccess(org.id),
    db.platformNote.findMany({ where: { organizationId: org.id }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.orgSnapshot.findMany({ where: { organizationId: org.id }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, sizeBytes: true, createdAt: true, createdBy: true } }),
    org.ownerId ? db.user.findUnique({ where: { id: org.ownerId }, select: { id: true, firstName: true, lastName: true, email: true, isActive: true } }) : Promise.resolve(null),
    orgMembershipSummary(org.id),
  ]);

  const canImpersonate = platformCan(session.platformRole, "platform.impersonate");
  const canManage = platformCan(session.platformRole, "platform.orgs.manage");
  const canViewInternal = platformCan(session.platformRole, "platform.pricing.view");
  const canEdit = platformCan(session.platformRole, "platform.orgs.edit");
  const canBranding = platformCan(session.platformRole, "platform.branding.manage");

  // Capacity = subscription LIMITS (plan, with per-org overrides) vs LIVE counts —
  // deliberately kept distinct (Part 3). A null max means "no limit".
  const maxUsers = org.maxUsersOverride ?? org.plan?.maxUsers ?? null;
  const maxAircraft = org.maxAircraftOverride ?? org.plan?.maxAircraft ?? null;
  const usage = [
    { label: "Active users", used: members.active, max: maxUsers, overridden: org.maxUsersOverride != null },
    { label: "Aircraft", used: org._count.aircraft, max: maxAircraft, overridden: org.maxAircraftOverride != null },
    { label: "Locations", used: org.locations.length, max: org.plan?.maxLocations ?? null, overridden: false },
  ];

  return (
    <div className="animate-fade-up space-y-4">
      <Link href="/platform/organizations" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> All organizations
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{org.name}</h1>
          {org.legalName && org.legalName !== org.name && <p className="text-xs text-muted-foreground">{org.legalName}</p>}
          <p className="mt-0.5 text-sm text-muted-foreground">
            <span className="font-mono text-xs">{org.slug}</span> · {ORG_TYPE_LABELS[org.orgType] ?? org.orgType} · created {formatDate(org.createdAt)} · {org.timeZone}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {org.isDemo && <Badge tone="cyan">Demo</Badge>}
          <StatusBadge status={org.status} />
          <Badge tone="gray">{org.subscriptionStatus}</Badge>
          <Badge tone="violet">{org.plan?.name ?? "No plan"} · {formatCurrency(org.plan?.priceMonthly ?? 0)}/mo</Badge>
        </div>
      </div>

      {/* Account Owner — the ownership source of truth (Organization.ownerId). */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            {owner ? (
              <Avatar first={owner.firstName} last={owner.lastName} className="h-9 w-9 text-xs" />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/10 text-sm font-bold text-amber-600">!</div>
            )}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Account Owner</p>
              {owner ? (
                <p className="text-sm font-semibold">
                  {owner.firstName} {owner.lastName}
                  <span className="font-normal text-muted-foreground"> · {owner.email}</span>
                  {!owner.isActive && <Badge tone="red" className="ml-2">Inactive</Badge>}
                </p>
              ) : (
                <p className="text-sm font-semibold text-amber-600">Owner pending — an invitation is outstanding</p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span><span className="font-semibold text-foreground">{members.active}</span> active</span>
            <span><span className="font-semibold text-foreground">{members.students}</span> students</span>
            <span><span className="font-semibold text-foreground">{members.instructors}</span> instructors</span>
            <span><span className="font-semibold text-foreground">{members.staff}</span> staff</span>
            {members.deactivated > 0 && <span><span className="font-semibold text-foreground">{members.deactivated}</span> deactivated</span>}
            <span>{org.invitations.length} pending</span>
          </div>
        </CardContent>
      </Card>

      {(canManage || canEdit) && (
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <EditProfile
              orgId={org.id}
              canBranding={canBranding}
              initial={{
                name: org.name,
                legalName: org.legalName ?? "",
                orgType: org.orgType,
                description: org.description ?? "",
                website: org.website ?? "",
                phone: org.phone ?? "",
                billingEmail: org.billingEmail ?? "",
                primaryContactName: org.primaryContactName ?? "",
                primaryContactEmail: org.primaryContactEmail ?? "",
                address: org.address ?? "",
                timeZone: org.timeZone,
                brandColor: org.brandColor,
                isDiscoverable: org.isDiscoverable,
              }}
            />
          )}
        </div>
      )}

      {canManage && <OrgActions orgId={org.id} status={org.status} planId={org.planId} plans={plans.map((p) => ({ id: p.id, name: p.name, price: Number(p.priceMonthly) }))} />}

      {canManage && (
        <SnapshotsPanel
          orgId={org.id}
          orgName={org.name}
          snapshots={snapshots.map((sn) => ({ ...sn, createdAt: sn.createdAt.toISOString() }))}
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Onboarding</CardTitle>
            <CardDescription>{success.onboarding.pct}% complete</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Progress value={success.onboarding.pct} tone={success.onboarding.pct === 100 ? "success" : "primary"} />
            {success.onboarding.steps.map((s) => (
              <div key={s.label} className="flex items-center gap-2 text-xs">
                <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold ${s.done ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
                  {s.done ? "✓" : "·"}
                </span>
                <span className={s.done ? "" : "text-muted-foreground"}>{s.label}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Customer Success
              <Badge tone={success.risk === "HEALTHY" ? "green" : success.risk === "WATCH" ? "amber" : "red"}>
                {success.risk.replaceAll("_", " ")}
              </Badge>
            </CardTitle>
            <CardDescription>
              {success.activity.logins14d} sign-ins (14d) · {success.activity.bookings7d} bookings (7d)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {success.riskFactors.map((f) => (
              <p key={f} className="font-medium text-warning">⚠ {f}</p>
            ))}
            {success.outreach.map((o) => (
              <p key={o} className="text-muted-foreground">→ {o}</p>
            ))}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {success.adoption.map((a) => (
                <Badge key={a.label} tone={a.active ? "green" : "gray"}>{a.label}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        <NotesPanel orgId={org.id} notes={notes.map((n) => ({ id: n.id, authorLabel: n.authorLabel, body: n.body, createdAt: n.createdAt.toISOString() }))} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Capacity</CardTitle>
            <CardDescription>Live counts vs subscription limits — {org._count.scheduleEvents} bookings · {org._count.invoices} invoices lifetime</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {usage.map((u) => (
              <div key={u.label}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium">{u.label}{u.overridden && <Badge tone="amber" className="ml-1.5">override</Badge>}</span>
                  <span className="text-muted-foreground tabular-nums">{u.used}{u.max != null ? ` / ${u.max}` : " · no limit"}</span>
                </div>
                <Progress value={u.max ? Math.min(100, (u.used / u.max) * 100) : 0} tone={u.max && u.used / u.max > 0.85 ? "warning" : "primary"} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Feature Modules</CardTitle>
            <CardDescription>Plan grants availability; toggles disable per-org</CardDescription>
          </CardHeader>
          <CardContent>
            <ModuleToggles
              orgId={org.id}
              disabled={!canManage}
              modules={Object.entries(MODULES).map(([key, label]) => ({
                key,
                label,
                core: CORE_MODULES.includes(key as ModuleKey),
                inPlan: (org.plan?.modules ?? []).includes(key) || CORE_MODULES.includes(key as ModuleKey),
                enabled: !org.disabledModules.includes(key),
              }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Recent Audit Activity</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-xs">
            {org.auditLogs.length === 0 && <p className="text-muted-foreground">No activity recorded.</p>}
            {org.auditLogs.map((a) => (
              <div key={a.id}>
                <p><span className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">{a.action}</span> {a.actorLabel}</p>
                <p className="text-[10px] text-muted-foreground">{formatDateTime(a.createdAt)}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Contact &amp; Profile</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-xs">
            <Field label="Website" value={org.website} link />
            <Field label="Phone" value={org.phone} />
            <Field label="Billing email" value={org.billingEmail} />
            <Field label="Primary contact" value={org.primaryContactName} />
            <Field label="Contact email" value={org.primaryContactEmail} />
            <Field label="Address" value={org.address} />
            {org.description && <p className="pt-1 text-muted-foreground">{org.description}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Branding</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              {org.logoUrl ? (
                <div className="h-11 w-11 rounded-lg border border-border bg-contain bg-center bg-no-repeat" style={{ backgroundImage: `url(${org.logoUrl})` }} />
              ) : (
                <div className="flex h-11 w-11 items-center justify-center rounded-lg text-sm font-bold text-white" style={{ background: org.brandColor }}>{org.name[0]}</div>
              )}
              <div className="text-xs">
                <p className="font-medium">{org.logoUrl ? "Custom logo" : "No logo uploaded"}</p>
                <p className="font-mono text-muted-foreground">{org.brandColor}</p>
              </div>
              <div className="ml-auto h-8 w-8 rounded-md border border-border" style={{ background: org.brandColor }} title="Brand color" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Internal</CardTitle>
            <CardDescription>Never shown to customers</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5 text-xs">
            {canViewInternal ? (
              <>
                <Field label="Billing mode" value={org.billingMode} />
                <Field label="Subscription" value={org.subscriptionStatus} />
                <Field label="Onboarding" value={org.onboardingStatus} />
                <Field label="Discoverable" value={org.isDiscoverable ? "Yes" : "No"} />
                <p className="pt-1 text-[11px] text-muted-foreground">Internal notes are below. Pricing &amp; contract terms route through the pricing workflow.</p>
              </>
            ) : (
              <p className="text-muted-foreground">Requires internal-pricing access.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>
            {members.active} active · {org.invitations.length} pending invitation{org.invitations.length === 1 ? "" : "s"}
            {canImpersonate && " · impersonation sessions are audited and reported to the organization"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {org.users.map((u) => (
            <div key={u.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/50">
              <Avatar first={u.firstName} last={u.lastName} className="h-7 w-7 text-[10px]" />
              <Link href={`/platform/users/${u.id}`} className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium hover:underline">{u.firstName} {u.lastName}</p>
                <p className="truncate text-[11px] text-muted-foreground">{u.email}</p>
              </Link>
              {u.id === org.ownerId && <Badge tone="violet">Owner</Badge>}
              {!u.isActive && <Badge tone="red">Inactive</Badge>}
              <Badge tone="blue">{ROLE_LABELS[u.role]}</Badge>
              {canImpersonate && org.status === "ACTIVE" && u.isActive && <ImpersonateButton userId={u.id} name={`${u.firstName} ${u.lastName}`} />}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
