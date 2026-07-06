import { redirect } from "next/navigation";
import Link from "next/link";
import { HeartPulse, Tv, TrendingUp } from "lucide-react";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { airworthinessOf } from "@/lib/airworthiness";
import { computeHealthScore } from "@/lib/health-score";
import { PageHeader, Progress } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Executive" };

function since(days: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d;
}

export default async function ExecutivePage() {
  const session = await getSession();
  if (!session!.permissions.has("reports.view")) redirect("/dashboard");
  const organizationId = session!.organizationId;
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const yearStart = new Date(new Date().getFullYear(), 0, 1);

  const [payToday, payWeek, payMonth, payYear, openInvoices, fleet, leads, students, dispatches90] = await Promise.all([
    db.payment.aggregate({ where: { invoice: { organizationId }, paidAt: { gte: since(0) } }, _sum: { amount: true } }),
    db.payment.aggregate({ where: { invoice: { organizationId }, paidAt: { gte: since(7) } }, _sum: { amount: true } }),
    db.payment.aggregate({ where: { invoice: { organizationId }, paidAt: { gte: monthStart } }, _sum: { amount: true } }),
    db.payment.aggregate({ where: { invoice: { organizationId }, paidAt: { gte: yearStart } }, _sum: { amount: true } }),
    db.invoice.findMany({
      where: { organizationId, status: { in: ["OPEN", "PARTIALLY_PAID", "OVERDUE"] } },
      include: { lines: true, payments: true },
    }),
    db.aircraft.findMany({
      where: { organizationId, isSimulator: false, status: { not: "RETIRED" } },
      include: { components: true, squawks: { where: { severity: "GROUNDING", status: { notIn: ["RESOLVED", "CLOSED"] } } } },
    }),
    db.lead.findMany({ where: { organizationId }, select: { status: true } }),
    db.student.findMany({
      where: { user: { organizationId, isActive: true }, status: "ENROLLED" },
      select: { totalHours: true, lessonRecords: { select: { date: true }, orderBy: { date: "desc" }, take: 1 } },
    }),
    db.dispatch.findMany({
      where: { aircraft: { organizationId }, status: "CLOSED", closedAt: { gte: since(90) } },
      select: {
        flightTime: true,
        aircraft: { select: { tailNumber: true, hourlyRateWet: true, estimatedHourlyCost: true } },
        instructor: { select: { hourlyRate: true, user: { select: { firstName: true, lastName: true } } } },
      },
    }),
  ]);

  const outstandingAR = openInvoices.reduce(
    (t, inv) => t + inv.lines.reduce((lt, l) => lt + Number(l.quantity) * Number(l.unitPrice), 0) - inv.payments.reduce((pt, p) => pt + Number(p.amount), 0),
    0,
  );
  const overdue = openInvoices.filter((i) => i.status === "OVERDUE" || (i.dueAt && i.dueAt < new Date())).length;

  // Profitability rankings (90 days)
  const byAircraft = new Map<string, { revenue: number; cost: number; hours: number }>();
  const byInstructor = new Map<string, { revenue: number; hours: number }>();
  for (const d of dispatches90) {
    const ft = Number(d.flightTime ?? 0);
    const a = byAircraft.get(d.aircraft.tailNumber) ?? { revenue: 0, cost: 0, hours: 0 };
    a.revenue += ft * Number(d.aircraft.hourlyRateWet);
    a.cost += ft * Number(d.aircraft.estimatedHourlyCost ?? 0);
    a.hours += ft;
    byAircraft.set(d.aircraft.tailNumber, a);
    if (d.instructor) {
      const name = `${d.instructor.user.firstName} ${d.instructor.user.lastName}`;
      const i = byInstructor.get(name) ?? { revenue: 0, hours: 0 };
      i.revenue += (ft + 0.5) * Number(d.instructor.hourlyRate);
      i.hours += ft;
      byInstructor.set(name, i);
    }
  }
  const aircraftRank = [...byAircraft.entries()].map(([tail, v]) => ({ tail, ...v, profit: v.revenue - v.cost })).sort((a, b) => b.profit - a.profit);
  const instructorRank = [...byInstructor.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenue - a.revenue);
  const totalHours90 = dispatches90.reduce((t, d) => t + Number(d.flightTime ?? 0), 0);
  const estProfit90 = aircraftRank.reduce((t, a) => t + a.profit, 0);

  // Health score inputs
  const airworthy = fleet.filter((a) => airworthinessOf(a, a.components).canDispatch).length;
  const groundingSquawks = fleet.reduce((t, a) => t + a.squawks.length, 0);
  const idleStudents = students.filter((s) => !s.lessonRecords[0] || Date.now() - s.lessonRecords[0].date.getTime() > 21 * 86_400_000).length;
  const enrolledLeads = leads.filter((l) => l.status === "ENROLLED").length;
  const closedLeads = enrolledLeads + leads.filter((l) => l.status === "LOST").length;
  const health = computeHealthScore({
    revenueMonth: Number(payMonth._sum.amount ?? 0),
    outstandingAR,
    overdueInvoices: overdue,
    totalOpenInvoices: openInvoices.length,
    airworthyAircraft: airworthy,
    totalAircraft: fleet.length,
    groundingSquawks,
    activeStudents: students.length,
    idleStudents,
    avgReadiness: students.length ? Math.min(100, (students.reduce((t, s) => t + Number(s.totalHours), 0) / students.length / 40) * 100) : 0,
    activeLeads: leads.filter((l) => !["ENROLLED", "LOST"].includes(l.status)).length,
    conversionRate: closedLeads > 0 ? enrolledLeads / closedLeads : null,
    utilizationPct: fleet.length ? (totalHours90 / (fleet.length * 180)) * 100 : 0,
  });

  const kpis = [
    { label: "Revenue today", value: formatCurrency(payToday._sum.amount) },
    { label: "Revenue (7d)", value: formatCurrency(payWeek._sum.amount) },
    { label: "Revenue MTD", value: formatCurrency(payMonth._sum.amount) },
    { label: "Revenue YTD", value: formatCurrency(payYear._sum.amount) },
    { label: "Accounts receivable", value: formatCurrency(outstandingAR), alert: overdue > 0 },
    { label: "Overdue invoices", value: String(overdue), alert: overdue > 0 },
    { label: "Est. profit (90d)", value: formatCurrency(estProfit90) },
    { label: "Hours flown (90d)", value: totalHours90.toFixed(1) },
  ];

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader title="Executive" description="Is the business healthy, where is the money made, and what needs attention — in sixty seconds">
        <Link href="/operations" className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium shadow-sm hover:bg-muted">
          <Tv className="h-4 w-4" /> Mission Control ↗
        </Link>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4">
              <p className="text-[11px] text-muted-foreground">{k.label}</p>
              <p className={`mt-1 text-lg font-semibold ${k.alert ? "text-destructive" : ""}`}>{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5"><HeartPulse className="h-4 w-4" /> Organization Health Score</CardTitle>
          <CardDescription>Six explained categories — the same transparency rule as everywhere else in AeroOps</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex items-center gap-4">
            <div className="text-4xl font-semibold tabular-nums">{health.overall}<span className="text-lg text-muted-foreground">/100</span></div>
            <Badge tone={health.overall >= 75 ? "green" : health.overall >= 50 ? "amber" : "red"} className="text-xs">
              {health.overall >= 75 ? "Healthy" : health.overall >= 50 ? "Needs attention" : "At risk"}
            </Badge>
            <div className="min-w-0 flex-1"><Progress value={health.overall} tone={health.overall >= 75 ? "success" : health.overall >= 50 ? "primary" : "warning"} /></div>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {health.categories.map((c) => (
              <div key={c.key} className="rounded-lg border border-border p-3">
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium">{c.label}</span>
                  <span className="font-semibold tabular-nums">{c.score}</span>
                </div>
                <Progress value={c.score} tone={c.score >= 75 ? "success" : c.score >= 50 ? "primary" : "warning"} />
                <p className="mt-1.5 text-[11px] text-muted-foreground">{c.detail}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5"><TrendingUp className="h-4 w-4" /> Aircraft Profitability (90d)</CardTitle>
            <CardDescription>Revenue vs hourly cost basis — where the money is made and lost</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {aircraftRank.map((a) => (
              <div key={a.tail} className="flex items-center justify-between text-xs">
                <span className="font-medium">{a.tail} <span className="text-muted-foreground">· {a.hours.toFixed(1)} hrs</span></span>
                <span className={`font-semibold tabular-nums ${a.profit >= 0 ? "text-success" : "text-destructive"}`}>
                  {formatCurrency(a.profit)} <span className="font-normal text-muted-foreground">on {formatCurrency(a.revenue)}</span>
                </span>
              </div>
            ))}
            {aircraftRank.length === 0 && <p className="text-xs text-muted-foreground">No closed flights in the window.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Instructor Revenue (90d)</CardTitle>
            <CardDescription>Instruction revenue generated per CFI</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {instructorRank.map((i) => (
              <div key={i.name} className="flex items-center justify-between text-xs">
                <span className="font-medium">{i.name} <span className="text-muted-foreground">· {i.hours.toFixed(1)} hrs</span></span>
                <span className="font-semibold tabular-nums">{formatCurrency(i.revenue)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
