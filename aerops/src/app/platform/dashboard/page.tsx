import { Building2, Users, Plane, DollarSign, Activity, Database } from "lucide-react";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { formatCurrency, formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

export default async function PlatformDashboard() {
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const dbStart = Date.now();
  const [orgs, userCount, aircraftCount, recentAudit, plans, lessons30, flights30, revenue30, students, apiKeys, deliveries30, scenes] = await Promise.all([
    db.organization.findMany({ include: { plan: true, _count: { select: { users: true, aircraft: true } } } }),
    db.user.count(),
    db.aircraft.count(),
    db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 10, include: { organization: { select: { name: true } } } }),
    db.subscriptionPlan.count(),
    db.scheduleEvent.count({ where: { start: { gte: since30 } } }),
    db.dispatch.count({ where: { status: "CLOSED", closedAt: { gte: since30 } } }),
    db.payment.aggregate({ where: { paidAt: { gte: since30 } }, _sum: { amount: true } }),
    db.student.count(),
    db.apiKey.count({ where: { revokedAt: null } }),
    db.webhookDelivery.count({ where: { createdAt: { gte: since30 } } }),
    db.missionControlScene.count(),
  ]);
  const dbLatencyMs = Date.now() - dbStart;

  const active = orgs.filter((o) => o.status === "ACTIVE");
  const mrr = active.reduce((t, o) => t + Number(o.plan?.priceMonthly ?? 0), 0);

  // Section 18 success metrics — measured from live data, never estimated.
  const successMetrics = [
    { label: "Lessons scheduled (30d)", value: String(lessons30) },
    { label: "Flights completed (30d)", value: String(flights30) },
    { label: "Revenue processed (30d)", value: formatCurrency(revenue30._sum.amount) },
    { label: "Students managed", value: String(students) },
    { label: "Aircraft managed", value: String(aircraftCount) },
    { label: "Active API keys", value: String(apiKeys) },
    { label: "Webhook deliveries (30d)", value: String(deliveries30) },
    { label: "Mission Control scenes", value: String(scenes) },
  ];

  const stats = [
    { label: "Organizations", value: `${active.length}`, sub: `${orgs.length - active.length} suspended/deleted`, icon: Building2 },
    { label: "Total users", value: String(userCount), icon: Users },
    { label: "Aircraft on platform", value: String(aircraftCount), icon: Plane },
    { label: "MRR", value: formatCurrency(mrr), sub: `${plans} plans`, icon: DollarSign },
  ];

  return (
    <div className="animate-fade-up space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Platform Dashboard</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Fleet-wide view of every AeroOps customer.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-medium text-muted-foreground">{s.label}</p>
                <s.icon className="h-3.5 w-3.5 text-muted-foreground/60" />
              </div>
              <p className="mt-1.5 text-xl font-semibold tracking-tight">{s.value}</p>
              {s.sub && <p className="mt-0.5 text-[10px] text-muted-foreground">{s.sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Success Metrics</CardTitle>
          <CardDescription>The roadmap KPIs (Section 18), measured across every organization on the platform</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            {successMetrics.map((m) => (
              <div key={m.label} className="rounded-lg border border-border p-3">
                <p className="text-lg font-semibold tabular-nums tracking-tight">{m.value}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">{m.label}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent Platform Activity</CardTitle>
            <CardDescription>Latest entries in the immutable audit trail</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {recentAudit.map((a) => (
              <div key={a.id} className="flex items-start justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <p className="font-medium">
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{a.action}</span>{" "}
                    <span className="text-muted-foreground">by</span> {a.actorLabel}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {a.organization?.name ?? "Platform"} · {formatDateTime(a.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5"><Activity className="h-4 w-4" /> System Health</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-muted-foreground"><Database className="h-3.5 w-3.5" /> Database</span>
              <StatusBadge status={dbLatencyMs < 250 ? "AVAILABLE" : "IN_PROGRESS"} />
            </div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Query latency</span><span className="font-medium tabular-nums">{dbLatencyMs} ms</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Node</span><span className="font-medium">{process.version}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Uptime</span><span className="font-medium tabular-nums">{Math.floor(process.uptime() / 60)} min</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Environment</span><span className="font-medium">{process.env.NODE_ENV}</span></div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
