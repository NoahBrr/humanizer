import { redirect } from "next/navigation";
import { Palette, Clock, KeyRound, Bell, CreditCard, Users } from "lucide-react";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { isAdmin, ROLE_LABELS } from "@/lib/rbac";
import { PageHeader, Avatar } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await auth();
  if (!isAdmin(session!.user.role)) redirect("/dashboard");
  const organizationId = session!.user.organizationId;

  const [org, users, lessonTypes, locations] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId } }),
    db.user.findMany({ where: { organizationId }, orderBy: [{ role: "asc" }, { lastName: "asc" }] }),
    db.lessonType.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
    db.location.findMany({ where: { organizationId } }),
  ]);

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader title="Settings" description="School configuration, branding, users, and integrations" />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5"><Palette className="h-4 w-4" /> School Branding</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-xs text-muted-foreground">School name</span>
              <span className="font-medium">{org?.name}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-xs text-muted-foreground">Workspace slug</span>
              <span className="font-mono text-xs">{org?.slug}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-xs text-muted-foreground">Brand color</span>
              <span className="flex items-center gap-2 font-mono text-xs">
                <span className="h-4 w-4 rounded" style={{ background: org?.brandColor }} /> {org?.brandColor}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" /> Time zone</span>
              <span className="font-medium">{org?.timeZone}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-xs text-muted-foreground">Locations</span>
              <span className="font-medium">{locations.map((l) => l.icao).join(", ")}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5"><CreditCard className="h-4 w-4" /> Lesson Types & Rates</CardTitle>
            <CardDescription>Colors drive the schedule; durations pre-fill new bookings</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
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
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5"><Users className="h-4 w-4" /> Users & Permissions</CardTitle>
          <CardDescription>Role-based access controls what each user can see and do</CardDescription>
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5"><Bell className="h-4 w-4" /> Notification Channels</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <div className="flex items-center justify-between"><span>Email (SendGrid)</span><Badge tone="green">Connected</Badge></div>
            <div className="flex items-center justify-between"><span>SMS (Twilio)</span><Badge tone="amber">Configure API key</Badge></div>
            <div className="flex items-center justify-between"><span>Push notifications</span><Badge tone="green">Enabled</Badge></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5"><KeyRound className="h-4 w-4" /> Integrations & API</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <div className="flex items-center justify-between"><span>Stripe payments</span><Badge tone="amber">Add secret key</Badge></div>
            <div className="flex items-center justify-between"><span>QuickBooks sync</span><Badge tone="gray">Not connected</Badge></div>
            <div className="flex items-center justify-between"><span>Aviation Weather (METAR/TAF)</span><Badge tone="green">Public feed</Badge></div>
            <div className="flex items-center justify-between">
              <span>API key</span>
              <code className="rounded bg-muted px-2 py-0.5 font-mono text-[10px]">aero_live_••••••••••••</code>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
