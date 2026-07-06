import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ShieldAlert, ShieldCheck, KeyRound } from "lucide-react";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { PageHeader, Avatar } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatDateTime, fullName } from "@/lib/utils";
import { SecurityControls } from "./security-controls";

export const dynamic = "force-dynamic";
export const metadata = { title: "Security" };

export default async function SecurityPage() {
  const session = await getSession();
  if (!session!.permissions.has("settings.manage")) redirect("/dashboard");
  const organizationId = session!.organizationId;
  const since = new Date(Date.now() - 14 * 86_400_000);

  const [logins, failedCount, users, permissionAudit, me, org] = await Promise.all([
    db.loginEvent.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.loginEvent.count({ where: { organizationId, success: false, createdAt: { gte: since } } }),
    db.user.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, email: true, mfaEnabled: true },
      orderBy: { lastName: "asc" },
    }),
    db.auditLog.findMany({
      where: { organizationId, action: { in: ["security.mfa_enabled", "security.mfa_disabled", "security.password_changed", "security.logout_all_devices", "users.invite", "users.invitation_accepted"] } },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    db.user.findUnique({ where: { id: session!.userId }, select: { mfaEnabled: true } }),
    db.organization.findUnique({ where: { id: organizationId }, select: { ownerId: true } }),
  ]);

  const mfaCount = users.filter((u) => u.mfaEnabled).length;

  return (
    <div className="animate-fade-up space-y-4">
      <Link href="/settings" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Settings
      </Link>
      <PageHeader title="Security" description="Sign-in activity, multi-factor enrollment, and account protection for your organization" />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Logins (14d)", value: logins.filter((l) => l.success).length >= 20 ? "20+" : String(logins.filter((l) => l.success).length) },
          { label: "Failed attempts (14d)", value: String(failedCount), alert: failedCount > 10 },
          { label: "MFA adoption", value: `${mfaCount}/${users.length}` },
          { label: "Your MFA", value: me?.mfaEnabled ? "Enabled" : "Not enrolled", alert: !me?.mfaEnabled },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-[11px] text-muted-foreground">{s.label}</p>
              <p className={`mt-1 text-lg font-semibold ${s.alert ? "text-destructive" : ""}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <SecurityControls mfaEnabled={!!me?.mfaEnabled} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent Sign-in Activity</CardTitle>
            <CardDescription>Successful and failed attempts, newest first</CardDescription>
          </CardHeader>
          <CardContent className="p-2">
            <Table>
              <THead><TR><TH>When</TH><TH>Account</TH><TH>Result</TH><TH>IP</TH></TR></THead>
              <TBody>
                {logins.map((l) => (
                  <TR key={l.id}>
                    <TD className="whitespace-nowrap text-[11px] text-muted-foreground">{formatDateTime(l.createdAt)}</TD>
                    <TD className="text-xs">{l.email}</TD>
                    <TD>
                      <Badge tone={l.success ? "green" : "red"}>
                        {l.success ? (l.reason?.startsWith("oauth") ? l.reason.replace("_", " ") : "success") : l.reason?.replaceAll("_", " ") ?? "failed"}
                      </Badge>
                    </TD>
                    <TD className="text-[11px] text-muted-foreground">{l.ip ?? "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4" /> MFA Enrollment</CardTitle>
              <CardDescription>Encourage every member — especially the owner — to enroll</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {users.map((u) => (
                <div key={u.id} className="flex items-center gap-2.5">
                  <Avatar first={u.firstName} last={u.lastName} className="h-6 w-6 text-[9px]" />
                  <span className="flex-1 truncate text-xs font-medium">
                    {fullName(u)}
                    {org?.ownerId === u.id && <Badge tone="violet" className="ml-1.5">Owner</Badge>}
                  </span>
                  <Badge tone={u.mfaEnabled ? "green" : "amber"}>{u.mfaEnabled ? "MFA on" : "Not enrolled"}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5"><KeyRound className="h-4 w-4" /> Security Events</CardTitle>
              <CardDescription>Password changes, MFA changes, user management</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {permissionAudit.length === 0 && <p className="text-xs text-muted-foreground">No security events yet.</p>}
              {permissionAudit.map((a) => (
                <div key={a.id} className="text-xs">
                  <code className="rounded bg-muted px-1 py-0.5 text-[10px]">{a.action}</code> {a.actorLabel}
                  <span className="ml-1 text-[10px] text-muted-foreground">{formatDateTime(a.createdAt)}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5"><ShieldAlert className="h-4 w-4" /> Platform Protections</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-xs text-muted-foreground">
              <p>✓ Passwords hashed with bcrypt; 12+ char policy with breach-list screening</p>
              <p>✓ Rate limiting on sign-in, password change, and invitation endpoints</p>
              <p>✓ CSRF protection (Auth.js), parameterized queries (Prisma), output escaping (React)</p>
              <p>✓ Org-scoped queries on every endpoint; immutable audit trail</p>
              <p>✓ Session revocation: password changes and “log out all devices” invalidate every JWT</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
