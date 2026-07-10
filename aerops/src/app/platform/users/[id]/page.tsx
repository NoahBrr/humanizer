import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, X } from "lucide-react";
import { db } from "@/lib/db";
import { requirePlatformSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/misc";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { ROLE_LABELS, SECTION_PERMISSIONS, canAccessSection } from "@/lib/rbac";
import { enabledModules } from "@/lib/features";
import { modulesForProfiles } from "@/lib/business-profiles";
import { resolvePermissions } from "@/lib/platform-users";
import { platformCan } from "@/lib/platform-permissions";
import { formatDate, formatDateTime } from "@/lib/utils";
import type { Role } from "@prisma/client";
import { UserActions } from "./user-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "User" };

function sectionLabel(href: string) {
  const s = href.slice(1).replace(/-/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default async function PlatformUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePlatformSession();
  const { id } = await params;

  const user = await db.user.findUnique({
    where: { id },
    // Explicit select — never load passwordHash / mfaSecret into server memory.
    select: {
      id: true, firstName: true, lastName: true, email: true, phone: true,
      role: true, customRoleId: true, organizationId: true,
      isActive: true, deletedAt: true, createdAt: true, mfaEnabled: true,
      customRole: { select: { id: true, name: true, permissions: true } },
      organization: {
        select: {
          id: true, name: true, status: true, ownerId: true, disabledModules: true, businessProfiles: true,
          plan: { select: { name: true, modules: true } },
        },
      },
    },
  });
  if (!user) notFound();

  const [logins, auditRows, orgRoles, memberships, impersonations] = await Promise.all([
    db.loginEvent.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 15 }),
    db.auditLog.findMany({
      // Actions BY the user, actions done AS the user under impersonation, and actions ON the user.
      where: { OR: [{ actorUserId: user.id }, { impersonatedUserId: user.id }, { entityType: "User", entityId: user.id }] },
      orderBy: { createdAt: "desc" }, take: 15,
    }),
    user.organizationId
      ? db.orgRole.findMany({ where: { organizationId: user.organizationId }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([] as { id: string; name: string }[]),
    db.membership.findMany({
      where: { userId: user.id },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      include: {
        organization: { select: { id: true, name: true, status: true, ownerId: true } },
        customRole: { select: { name: true } },
        primaryLocation: { select: { name: true, icao: true } },
      },
    }),
    db.impersonationSession.findMany({
      where: { targetUserId: user.id },
      orderBy: { startedAt: "desc" },
      take: 10,
      include: { platformUser: { select: { firstName: true, lastName: true } }, organization: { select: { name: true } } },
    }),
  ]);

  const permissions = resolvePermissions(user.role, user.customRole?.permissions);
  const modules = enabledModules(user.organization?.plan?.modules, user.organization?.disabledModules ?? [], modulesForProfiles(user.organization?.businessProfiles ?? []));
  const sections = Object.keys(SECTION_PERMISSIONS).map((href) => ({ href, allowed: canAccessSection(permissions, modules, href) }));

  const isOwner = !!user.organization && user.organization.ownerId === user.id;
  const status = user.deletedAt ? "Deleted" : user.isActive ? "Active" : "Suspended";
  const roleOptions = (Object.keys(ROLE_LABELS) as Role[]).map((r) => ({ value: r, label: ROLE_LABELS[r] }));

  return (
    <div className="animate-fade-up space-y-4">
      <Link href="/platform/users" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Users
      </Link>

      <div className="flex items-start gap-3">
        <Avatar first={user.firstName} last={user.lastName} className="h-11 w-11 text-sm" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{user.firstName} {user.lastName}</h1>
            <StatusBadge status={status} />
            {isOwner && <Badge tone="violet">Account Owner</Badge>}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{user.email}{user.phone ? ` · ${user.phone}` : ""}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Membership</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-xs">
            <Row label="Organization" value={user.organization ? <Link href={`/platform/organizations/${user.organization.id}`} className="text-primary hover:underline">{user.organization.name}</Link> : <span className="text-muted-foreground">Individual account (no org)</span>} />
            {user.organization && <Row label="Org status" value={<StatusBadge status={user.organization.status} />} />}
            {user.organization && <Row label="Plan" value={user.organization.plan?.name ?? "No plan"} />}
            <Row label="Role" value={user.customRole ? <Badge tone="violet">{user.customRole.name}</Badge> : ROLE_LABELS[user.role]} />
            <Row label="Member since" value={formatDate(user.createdAt)} />
            <Row label="MFA" value={<Badge tone={user.mfaEnabled ? "green" : "gray"}>{user.mfaEnabled ? "Enabled" : "Not enrolled"}</Badge>} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Effective permissions</CardTitle>
            <CardDescription>{permissions.size} capabilities from {user.customRole ? "a custom role" : "the built-in role"}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1">
            {permissions.size === 0 && <p className="text-xs text-muted-foreground">No permissions (individual account).</p>}
            {[...permissions].sort().map((p) => <code key={p} className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{p}</code>)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Navigation preview</CardTitle>
            <CardDescription>Sidebar sections this user sees today</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            {sections.map((s) => (
              <div key={s.href} className={`flex items-center gap-1.5 ${s.allowed ? "" : "text-muted-foreground/50"}`}>
                {s.allowed ? <Check className="h-3 w-3 text-success" /> : <X className="h-3 w-3" />}
                {sectionLabel(s.href)}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <UserActions
        userId={user.id}
        userName={`${user.firstName} ${user.lastName}`}
        impersonating={!!session.impersonation}
        state={{ isActive: user.isActive, isDeleted: !!user.deletedAt, isOwner, hasOrg: !!user.organizationId, orgActive: user.organization?.status === "ACTIVE" }}
        current={{ role: user.role, customRoleId: user.customRole?.id ?? null }}
        roleOptions={roleOptions}
        customRoles={orgRoles}
        can={{
          manage: platformCan(session.platformRole, "platform.users.manage"),
          roles: platformCan(session.platformRole, "platform.roles.manage"),
          transferOwner: platformCan(session.platformRole, "platform.users.transfer_owner"),
          impersonate: platformCan(session.platformRole, "platform.impersonate"),
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle>Organizations</CardTitle>
          <CardDescription>{memberships.length} membership{memberships.length === 1 ? "" : "s"} — a user may belong to several organizations with different roles</CardDescription>
        </CardHeader>
        <CardContent className="p-2">
          <Table>
            <THead><TR><TH>Organization</TH><TH>Role</TH><TH>Status</TH><TH>Primary location</TH><TH>Joined</TH></TR></THead>
            <TBody>
              {memberships.length === 0 && <TR><TD colSpan={5} className="text-xs text-muted-foreground">No organization memberships (individual account).</TD></TR>}
              {memberships.map((m) => (
                <TR key={m.id}>
                  <TD>
                    <Link href={`/platform/organizations/${m.organizationId}`} className="text-primary hover:underline">{m.organization.name}</Link>
                    {m.organization.ownerId === user.id && <Badge tone="violet" className="ml-1.5">Owner</Badge>}
                  </TD>
                  <TD>{m.customRole ? <Badge tone="violet">{m.customRole.name}</Badge> : ROLE_LABELS[m.role]}</TD>
                  <TD><Badge tone={m.status === "ACTIVE" ? "green" : "gray"}>{m.status.toLowerCase()}</Badge></TD>
                  <TD className="text-[11px] text-muted-foreground">{m.primaryLocation ? `${m.primaryLocation.name}${m.primaryLocation.icao ? ` (${m.primaryLocation.icao})` : ""}` : "—"}</TD>
                  <TD className="whitespace-nowrap text-[11px] text-muted-foreground">{formatDate(m.createdAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Login history</CardTitle><CardDescription>Most recent sign-in attempts</CardDescription></CardHeader>
          <CardContent className="p-2">
            <Table>
              <THead><TR><TH>When</TH><TH>Result</TH><TH>IP</TH></TR></THead>
              <TBody>
                {logins.length === 0 && <TR><TD className="text-xs text-muted-foreground" colSpan={3}>No sign-in events recorded.</TD></TR>}
                {logins.map((l) => (
                  <TR key={l.id}>
                    <TD className="whitespace-nowrap text-[11px] text-muted-foreground">{formatDateTime(l.createdAt)}</TD>
                    <TD><Badge tone={l.success ? "green" : "red"}>{l.success ? "success" : l.reason?.replaceAll("_", " ") ?? "failed"}</Badge></TD>
                    <TD className="text-[11px] text-muted-foreground">{l.ip ?? "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Audit history</CardTitle><CardDescription>Actions by and on this user</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {auditRows.length === 0 && <p className="text-xs text-muted-foreground">No audit events for this user.</p>}
            {auditRows.map((a) => (
              <div key={a.id} className="text-xs">
                <code className="rounded bg-muted px-1 py-0.5 text-[10px]">{a.action}</code> {a.actorLabel}
                <span className="ml-1 text-[10px] text-muted-foreground">{formatDateTime(a.createdAt)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Impersonation history</CardTitle>
          <CardDescription>AeroOps support sessions that acted as this user — always audited and disclosed</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {impersonations.length === 0 && <p className="text-xs text-muted-foreground">No impersonation sessions recorded.</p>}
          {impersonations.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2 text-xs">
              <Badge tone={s.endedAt ? "gray" : "amber"}>{s.endedAt ? "ended" : "active"}</Badge>
              <span className="font-medium">{s.platformUser.firstName} {s.platformUser.lastName}</span>
              <Badge tone={s.readOnly ? "blue" : "red"}>{s.readOnly ? "read-only" : "full access"}</Badge>
              <span className="min-w-0 truncate text-muted-foreground">· {s.reason}</span>
              <span className="ml-auto whitespace-nowrap text-[10px] text-muted-foreground">{formatDateTime(s.startedAt)}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
