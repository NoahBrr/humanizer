import { redirect } from "next/navigation";
import { Palette, KeyRound, Bell, CreditCard, Users, ShieldCheck, MailPlus } from "lucide-react";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/rbac";
import { PERMISSIONS, type Permission } from "@/lib/permissions";
import { PageHeader, Avatar } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { InviteUserForm } from "./invite-form";
import { ModuleManager } from "./module-manager";
import { BrandingForm } from "./branding-form";
import { BUSINESS_PROFILES } from "@/lib/business-profiles";
import { AUTOMATIONS } from "@/lib/automations";
import { MODULES, CORE_MODULES } from "@/lib/features";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await getSession();
  if (!session!.permissions.has("settings.manage")) redirect("/dashboard");
  const organizationId = session!.organizationId;

  const [org, users, lessonTypes, locations, orgRoles, invitations, departments] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, include: { plan: true } }),
    db.user.findMany({ where: { organizationId, deletedAt: null }, orderBy: [{ role: "asc" }, { lastName: "asc" }] }),
    db.lessonType.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
    db.location.findMany({ where: { organizationId } }),
    db.orgRole.findMany({ where: { organizationId }, orderBy: [{ isSystem: "desc" }, { name: "asc" }] }),
    db.invitation.findMany({ where: { organizationId, acceptedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }),
    db.department.findMany({ where: { organizationId }, include: { _count: { select: { users: true } } } }),
  ]);
  const canInvite = session!.permissions.has("users.manage") && !session!.impersonation?.readOnly;

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader title="Settings" description="School configuration, branding, users, and integrations">
        <a href="/settings/join-requests" className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium shadow-sm hover:bg-muted">
          Join Requests
        </a>
        <a href="/settings/locations" className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium shadow-sm hover:bg-muted">
          Locations →
        </a>
        {session!.permissions.has("revenue.payment_methods_manage") && (
          <a href="/settings/payers" className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium shadow-sm hover:bg-muted">
            Payers →
          </a>
        )}
        {session!.permissions.has("revenue.connect_manage") && (
          <a href="/settings/payments" className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium shadow-sm hover:bg-muted">
            Connected Payments →
          </a>
        )}
        <a href="/settings/security" className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium shadow-sm hover:bg-muted">
          Security →
        </a>
        <a href="/settings/developers" className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium shadow-sm hover:bg-muted">
          Developers →
        </a>
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5"><Palette className="h-4 w-4" /> School Branding</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {org && <BrandingForm org={{ name: org.name, slug: org.slug, brandColor: org.brandColor, timeZone: org.timeZone }} />}
            <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
              <span className="text-xs text-muted-foreground">Locations</span>
              <a href="/settings/locations" className="text-xs font-medium text-primary hover:underline">
                {locations.length} configured — manage →
              </a>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5"><CreditCard className="h-4 w-4" /> Lesson Types & Rates</CardTitle>
            <CardDescription>Colors drive the schedule; durations pre-fill new bookings</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {lessonTypes.length === 0 && <p className="text-xs text-muted-foreground">No lesson types yet — add your first to populate the scheduler.</p>}
            {lessonTypes.map((lt) => (
              <div key={lt.id} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-xs font-medium">
                  <span className="h-3 w-3 rounded" style={{ background: lt.color }} /> {lt.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {lt.durationMin} min{lt.requiresAircraft ? " · aircraft" : ""}{lt.requiresInstructor ? " · CFI" : ""}
                </span>
              </div>
            ))}
            <div className="border-t border-border pt-3">
              <a href="/settings/lesson-types" className="text-xs font-medium text-primary hover:underline">Manage lesson types →</a>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5"><Users className="h-4 w-4" /> Users & Permissions</CardTitle>
          <CardDescription>
            {users.length} of {org?.plan?.maxUsers ?? "∞"} seats used on the {org?.plan?.name ?? "current"} plan
          </CardDescription>
        </CardHeader>
        <CardContent className="p-2">
          <Table>
            <THead><TR><TH>User</TH><TH>Email</TH><TH>Role</TH><TH>Status</TH><TH>MFA</TH></TR></THead>
            <TBody>
              {users.map((u) => (
                <TR key={u.id}>
                  <TD>
                    <div className="flex items-center gap-2">
                      <Avatar first={u.firstName} last={u.lastName} className="h-6 w-6 text-[9px]" />
                      <span className="text-xs font-medium">{u.firstName} {u.lastName}</span>
                    </div>
                  </TD>
                  <TD className="text-xs text-muted-foreground">{u.email}</TD>
                  <TD><Badge tone="blue">{ROLE_LABELS[u.role]}</Badge></TD>
                  <TD><Badge tone={u.isActive ? "green" : "gray"}>{u.isActive ? "Active" : "Inactive"}</Badge></TD>
                  <TD><Badge tone={u.mfaEnabled ? "green" : "amber"}>{u.mfaEnabled ? "Enabled" : "Not enrolled"}</Badge></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <ModuleManager
        readOnly={!!session!.impersonation?.readOnly}
        enabledModules={[...session!.modules]}
        moduleLabels={MODULES}
        profiles={Object.entries(BUSINESS_PROFILES).map(([key, p]) => ({
          key,
          label: p.label,
          modules: [...p.modules],
          active: (org?.businessProfiles ?? []).includes(key),
          inPlan: p.modules.every((m) => (org?.plan?.modules ?? []).includes(m) || (CORE_MODULES as string[]).includes(m)),
        }))}
        automations={Object.entries(AUTOMATIONS).map(([key, a]) => ({
          key,
          label: a.label,
          description: a.description,
          trigger: a.trigger,
          enabled: !(org?.disabledAutomations ?? []).includes(key),
        }))}
      />

      {canInvite && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5"><MailPlus className="h-4 w-4" /> Invite Users</CardTitle>
            <CardDescription>Invitations expire after 14 days. In production the link is emailed automatically.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <InviteUserForm />
            {invitations.length > 0 && (
              <div className="space-y-1.5 border-t border-border pt-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Pending invitations</p>
                {invitations.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between text-xs">
                    <span className="font-medium">{inv.email}</span>
                    <span className="text-muted-foreground">{ROLE_LABELS[inv.role]} · expires {formatDate(inv.expiresAt)} · invited by {inv.invitedBy ?? "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4" /> Roles & Permissions</CardTitle>
          <CardDescription>
            Roles are bundles of modular permissions. System roles ship with AeroOps; custom roles can be created for your organization.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {orgRoles.length === 0 && <p className="text-xs text-muted-foreground">This organization uses the built-in role defaults.</p>}
          {orgRoles.map((r) => (
            <div key={r.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold">
                  {ROLE_LABELS[r.name as keyof typeof ROLE_LABELS] ?? r.name}
                  {r.isSystem ? <Badge tone="gray" className="ml-2">System</Badge> : <Badge tone="violet" className="ml-2">Custom</Badge>}
                </p>
                <p className="text-[11px] text-muted-foreground">{r.permissions.length} permissions</p>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {(r.permissions as Permission[]).slice(0, 12).map((perm) => (
                  <span key={perm} title={PERMISSIONS[perm]} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">{perm}</span>
                ))}
                {r.permissions.length > 12 && <span className="text-[9px] text-muted-foreground">+{r.permissions.length - 12} more</span>}
              </div>
            </div>
          ))}
          {departments.length > 0 && (
            <div className="border-t border-border pt-3">
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Departments</p>
              <div className="flex flex-wrap gap-1.5">
                {departments.map((d) => <Badge key={d.id} tone="blue">{d.name} · {d._count.users}</Badge>)}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5"><Bell className="h-4 w-4" /> Notification Channels</CardTitle>
            <CardDescription>In-app notifications are live today. External delivery channels are on the roadmap — no configuration is required yet.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <div className="flex items-center justify-between"><span>In-app notifications</span><Badge tone="green">Live</Badge></div>
            <div className="flex items-center justify-between"><span>Email delivery</span><Badge tone="gray">Planned</Badge></div>
            <div className="flex items-center justify-between"><span>SMS delivery</span><Badge tone="gray">Planned</Badge></div>
            <div className="flex items-center justify-between"><span>Web push</span><Badge tone="gray">Planned</Badge></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5"><KeyRound className="h-4 w-4" /> Integrations & API</CardTitle>
            <CardDescription>Payment and accounting integrations are on the roadmap. The public API is available today — manage keys under Developers.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <div className="flex items-center justify-between"><span>Stripe payments</span><Badge tone="gray">Planned</Badge></div>
            <div className="flex items-center justify-between"><span>QuickBooks sync</span><Badge tone="gray">Planned</Badge></div>
            <div className="flex items-center justify-between"><span>Aviation Weather (METAR/TAF)</span><Badge tone="amber">Simulated</Badge></div>
            <div className="flex items-center justify-between">
              <span>API keys</span>
              <a href="/settings/developers" className="font-medium text-primary hover:underline">Manage in Developers →</a>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
