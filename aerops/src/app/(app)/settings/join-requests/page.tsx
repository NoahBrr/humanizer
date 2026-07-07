import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Inbox } from "lucide-react";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { PageHeader, EmptyState, Avatar } from "@/components/ui/misc";
import { ROLE_LABELS } from "@/lib/rbac";
import { DecisionPanel, InviteLinksManager } from "./request-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Join Requests" };

export default async function JoinRequestsPage() {
  const session = await getSession();
  if (!session || !session.permissions.has("users.manage")) redirect("/dashboard");

  const [requests, locations, links] = await Promise.all([
    db.joinRequest.findMany({
      where: { organizationId: session.organizationId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 100,
      include: { user: { select: { firstName: true, lastName: true, email: true, phone: true } } },
    }),
    db.location.findMany({ where: { organizationId: session.organizationId, isActive: true }, select: { id: true, name: true, icao: true } }),
    db.inviteLink.findMany({
      where: { organizationId: session.organizationId, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, label: true, role: true, token: true, autoApprove: true, uses: true, maxUses: true, expiresAt: true },
    }),
  ]);

  const open = requests.filter((r) => r.status === "PENDING" || r.status === "MORE_INFO");
  const closed = requests.filter((r) => r.status !== "PENDING" && r.status !== "MORE_INFO");

  return (
    <div className="animate-fade-up">
      <Link href="/settings" className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Settings
      </Link>
      <PageHeader
        title="Join Requests & Invite Links"
        description="People asking to join your organization, and shareable links for onboarding them in bulk."
      />

      <div className="space-y-6">
        <div>
          <p className="mb-2 text-sm font-semibold">Awaiting review {open.length > 0 && <span className="ml-1 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning">{open.length}</span>}</p>
          {open.length === 0 ? (
            <Card><CardContent className="p-0"><EmptyState icon={<Inbox className="h-7 w-7" />} title="No open requests" description="New join requests will appear here and in your notifications." /></CardContent></Card>
          ) : (
            <div className="space-y-3">
              {open.map((r) => (
                <Card key={r.id}>
                  <CardContent className="p-4">
                    <div className="flex flex-wrap items-start gap-3">
                      <Avatar first={r.user.firstName} last={r.user.lastName} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">
                          {r.user.firstName} {r.user.lastName}
                          <span className="ml-2 font-normal text-muted-foreground">{r.user.email}{r.phone || r.user.phone ? ` · ${r.phone ?? r.user.phone}` : ""}</span>
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Wants to join as <span className="font-medium text-foreground">{ROLE_LABELS[r.requestedRole]}</span>
                          {" · "}{r.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        </p>
                        {r.certificateInfo && <p className="mt-1 text-xs"><span className="text-muted-foreground">Certificate:</span> {r.certificateInfo}</p>}
                        {r.reason && <p className="mt-1 text-xs"><span className="text-muted-foreground">Reason:</span> {r.reason}</p>}
                        {r.message && <p className="mt-1 rounded-lg bg-muted/60 px-2.5 py-1.5 text-xs italic">“{r.message}”</p>}
                      </div>
                      <StatusBadge status={r.status} />
                    </div>
                    <DecisionPanel requestId={r.id} requestedRole={r.requestedRole} locations={locations} />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        <InviteLinksManager links={links.map((l) => ({ ...l, expiresAt: l.expiresAt?.toISOString() ?? null }))} />

        {closed.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-semibold">History</p>
            <div className="space-y-1.5">
              {closed.slice(0, 20).map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
                  <p className="min-w-0 flex-1 truncate text-xs">
                    <span className="font-medium">{r.user.firstName} {r.user.lastName}</span>
                    <span className="text-muted-foreground"> · {ROLE_LABELS[r.assignedRole ?? r.requestedRole]}{r.decidedByLabel ? ` · decided by ${r.decidedByLabel}` : ""}</span>
                  </p>
                  <StatusBadge status={r.status} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
