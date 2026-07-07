import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requirePlatformSession } from "@/lib/session";
import { MODULES, CORE_MODULES, type ModuleKey } from "@/lib/features";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Avatar, Progress } from "@/components/ui/misc";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/rbac";
import { computeCustomerSuccess } from "@/lib/customer-success";
import { OrgActions, ImpersonateButton, ModuleToggles } from "./org-actions";
import { NotesPanel } from "./notes-panel";
import { SnapshotsPanel } from "./snapshots-panel";

export const dynamic = "force-dynamic";

export default async function OrganizationDetail({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePlatformSession();
  const { id } = await params;
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
  const [plans, success, notes, snapshots] = await Promise.all([
    db.subscriptionPlan.findMany({ orderBy: { priceMonthly: "asc" } }),
    computeCustomerSuccess(org.id),
    db.platformNote.findMany({ where: { organizationId: org.id }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.orgSnapshot.findMany({ where: { organizationId: org.id }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, sizeBytes: true, createdAt: true, createdBy: true } }),
  ]);

  const canImpersonate = ["FOUNDER", "PLATFORM_ADMIN", "CUSTOMER_SUCCESS", "SUPPORT_ENGINEER"].includes(session?.platformRole ?? "");
  const canManage = ["FOUNDER", "PLATFORM_ADMIN", "BILLING_ADMIN"].includes(session?.platformRole ?? "");

  const usage = [
    { label: "Users", used: org.users.length, max: org.plan?.maxUsers },
    { label: "Aircraft", used: org._count.aircraft, max: org.plan?.maxAircraft },
    { label: "Locations", used: org.locations.length, max: org.plan?.maxLocations },
  ];

  return (
    <div className="animate-fade-up space-y-4">
      <Link href="/platform/organizations" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> All organizations
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{org.name}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            <span className="font-mono text-xs">{org.slug}</span> · created {formatDate(org.createdAt)} · {org.timeZone}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {org.isDemo && <Badge tone="cyan">Demo</Badge>}
          <StatusBadge status={org.status} />
          <Badge tone="violet">{org.plan?.name ?? "No plan"} · {formatCurrency(org.plan?.priceMonthly ?? 0)}/mo</Badge>
        </div>
      </div>

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
            <CardTitle>Usage vs Plan Limits</CardTitle>
            <CardDescription>{org._count.scheduleEvents} bookings · {org._count.invoices} invoices lifetime</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {usage.map((u) => (
              <div key={u.label}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="font-medium">{u.label}</span>
                  <span className="text-muted-foreground tabular-nums">{u.used}{u.max ? ` / ${u.max}` : ""}</span>
                </div>
                <Progress value={u.max ? (u.used / u.max) * 100 : 0} tone={u.max && u.used / u.max > 0.85 ? "warning" : "primary"} />
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

      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>
            {org.users.length} active · {org.invitations.length} pending invitation{org.invitations.length === 1 ? "" : "s"}
            {canImpersonate && " · impersonation sessions are audited and reported to the organization"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {org.users.map((u) => (
            <div key={u.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/50">
              <Avatar first={u.firstName} last={u.lastName} className="h-7 w-7 text-[10px]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{u.firstName} {u.lastName}</p>
                <p className="truncate text-[11px] text-muted-foreground">{u.email}</p>
              </div>
              <Badge tone="blue">{ROLE_LABELS[u.role]}</Badge>
              {canImpersonate && org.status === "ACTIVE" && <ImpersonateButton userId={u.id} name={`${u.firstName} ${u.lastName}`} />}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
