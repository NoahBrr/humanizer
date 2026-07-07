import Link from "next/link";
import {
  Plane, Wrench, Users, GraduationCap, DollarSign, TrendingUp, AlertTriangle,
  CalendarCheck, Gauge, CloudSun, Award,
} from "lucide-react";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { cookies } from "next/headers";
import { activeLocationWeather, icaoOf, weatherSummary } from "@/lib/weather";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/misc";
import { formatCurrency, formatTime, formatDate, fullName, daysUntil } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

function startOfDay(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default async function DashboardPage() {
  const session = await getSession();
  const organizationId = session!.organizationId;
  const wx = await activeLocationWeather(organizationId, (await cookies()).get("aerops-location")?.value);
  const todayStart = startOfDay();
  const todayEnd = startOfDay(1);
  const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);

  const [
    todaysFlights, aircraftCounts, instructorsToday, checkrides,
    revenueTodayAgg, revenueMonthAgg, notifications, squawks, upcomingMx,
    balances, completedThisMonth, fleetSize,
  ] = await Promise.all([
    db.scheduleEvent.findMany({
      where: { organizationId, start: { gte: todayStart, lt: todayEnd }, type: { not: "MAINTENANCE_BLOCK" } },
      include: {
        aircraft: { select: { tailNumber: true } },
        instructor: { include: { user: { select: { firstName: true, lastName: true } } } },
        student: { include: { user: { select: { firstName: true, lastName: true } } } },
        lessonType: { select: { name: true, color: true } },
      },
      orderBy: { start: "asc" },
    }),
    db.aircraft.groupBy({ by: ["status"], where: { organizationId }, _count: true }),
    db.instructor.count({ where: { user: { organizationId, isActive: true } } }),
    db.checkride.findMany({
      where: { student: { user: { organizationId } }, status: "SCHEDULED", date: { gte: todayStart } },
      include: { student: { include: { user: { select: { firstName: true, lastName: true } } } } },
      orderBy: { date: "asc" },
      take: 4,
    }),
    db.payment.aggregate({ where: { invoice: { organizationId }, paidAt: { gte: todayStart } }, _sum: { amount: true } }),
    db.payment.aggregate({ where: { invoice: { organizationId }, paidAt: { gte: monthStart } }, _sum: { amount: true } }),
    db.notification.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 5 }),
    db.squawk.findMany({
      where: { aircraft: { organizationId }, status: { in: ["OPEN", "IN_PROGRESS"] } },
      include: { aircraft: { select: { tailNumber: true } } },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    db.maintenanceOrder.findMany({
      where: { aircraft: { organizationId }, status: { in: ["SCHEDULED", "IN_PROGRESS"] } },
      include: { aircraft: { select: { tailNumber: true } } },
      orderBy: { startDate: "asc" },
      take: 5,
    }),
    db.student.findMany({
      where: { user: { organizationId }, accountBalance: { lt: 0 } },
      include: { user: { select: { firstName: true, lastName: true } } },
      orderBy: { accountBalance: "asc" },
      take: 5,
    }),
    db.dispatch.aggregate({
      where: { aircraft: { organizationId }, status: "CLOSED", closedAt: { gte: monthStart } },
      _sum: { flightTime: true },
      _count: true,
    }),
    db.aircraft.count({ where: { organizationId, isSimulator: false } }),
  ]);

  const byStatus = Object.fromEntries(aircraftCounts.map((c) => [c.status, c._count]));
  const available = byStatus.AVAILABLE ?? 0;
  const inMx = (byStatus.IN_MAINTENANCE ?? 0) + (byStatus.GROUNDED ?? 0);
  const studentsFlyingToday = new Set(todaysFlights.filter((f) => f.studentId).map((f) => f.studentId)).size;
  const revenueToday = Number(revenueTodayAgg._sum.amount ?? 0);
  const revenueMonth = Number(revenueMonthAgg._sum.amount ?? 0);
  const hoursFlownMonth = Number(completedThisMonth._sum.flightTime ?? 0);
  // Rough utilization: hours flown this month vs 60 available hrs/aircraft/month
  const utilization = fleetSize > 0 ? Math.min(100, Math.round((hoursFlownMonth / (fleetSize * 60)) * 100)) : 0;
  const outstanding = balances.reduce((t, s) => t + Math.abs(Number(s.accountBalance)), 0);

  const stats = [
    { label: "Today's Flights", value: todaysFlights.length, icon: CalendarCheck, href: "/schedule" },
    { label: "Aircraft Available", value: `${available}`, sub: `${inMx} in maintenance`, icon: Plane, href: "/aircraft" },
    { label: "Students Flying Today", value: studentsFlyingToday, sub: `${instructorsToday} instructors on staff`, icon: GraduationCap, href: "/students" },
    { label: "Revenue Today", value: formatCurrency(revenueToday), icon: DollarSign, href: "/billing" },
    { label: "Revenue This Month", value: formatCurrency(revenueMonth), sub: `${completedThisMonth._count} flights closed`, icon: TrendingUp, href: "/reports" },
    { label: "Fleet Utilization", value: `${utilization}%`, sub: `${hoursFlownMonth.toFixed(1)} hrs this month`, icon: Gauge, href: "/reports" },
  ];

  return (
    <div className="animate-fade-up space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, {session!.firstName}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} · Here&apos;s today&apos;s operating picture.
          </p>
        </div>
        {wx && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
            <CloudSun className="h-4 w-4 text-warning" />
            {icaoOf(wx.location)} — {wx.weather.category} · {weatherSummary(wx.weather)}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card className="transition-shadow hover:shadow-md">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-medium text-muted-foreground">{s.label}</p>
                  <s.icon className="h-3.5 w-3.5 text-muted-foreground/60" />
                </div>
                <p className="mt-1.5 text-xl font-semibold tracking-tight">{s.value}</p>
                {s.sub && <p className="mt-0.5 text-[10px] text-muted-foreground">{s.sub}</p>}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Today&apos;s Flights</CardTitle>
              <CardDescription>All scheduled activity for today</CardDescription>
            </div>
            <Link href="/schedule" className="text-xs font-medium text-primary hover:underline">Open schedule →</Link>
          </CardHeader>
          <CardContent className="space-y-1">
            {todaysFlights.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No flights scheduled today.</p>}
            {todaysFlights.map((f) => (
              <div key={f.id} className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50">
                <div className="w-14 text-xs font-semibold tabular-nums">{formatTime(f.start)}</div>
                <div className="h-8 w-1 rounded-full" style={{ background: f.lessonType?.color ?? "#2563eb" }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {fullName(f.student?.user)} {f.instructor ? `· ${fullName(f.instructor.user)}` : "· Solo"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {f.lessonType?.name ?? f.type} {f.aircraft ? `· ${f.aircraft.tailNumber}` : ""}
                  </p>
                </div>
                <StatusBadge status={f.status} />
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Upcoming Checkrides</CardTitle>
              <Award className="h-4 w-4 text-muted-foreground/60" />
            </CardHeader>
            <CardContent className="space-y-2.5">
              {checkrides.length === 0 && <p className="text-xs text-muted-foreground">None scheduled.</p>}
              {checkrides.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium">{fullName(c.student.user)}</p>
                    <p className="text-[11px] text-muted-foreground">{c.rating.replaceAll("_", " ")} · {c.examinerName}</p>
                  </div>
                  <Badge tone={daysUntil(c.date)! <= 7 ? "amber" : "blue"}>{formatDate(c.date)}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Outstanding Balances</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground/60" />
            </CardHeader>
            <CardContent className="space-y-2">
              {balances.map((s) => (
                <div key={s.id} className="flex items-center justify-between">
                  <p className="text-xs font-medium">{fullName(s.user)}</p>
                  <p className="text-xs font-semibold text-destructive">{formatCurrency(Math.abs(Number(s.accountBalance)))}</p>
                </div>
              ))}
              <div className="border-t border-border pt-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Total outstanding</span>
                  <span className="font-semibold">{formatCurrency(outstanding)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Open Squawks</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground/60" />
          </CardHeader>
          <CardContent className="space-y-2.5">
            {squawks.map((s) => (
              <Link key={s.id} href="/maintenance" className="block">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium">{s.aircraft.tailNumber} — {s.title}</p>
                    <p className="text-[11px] text-muted-foreground">{formatDate(s.createdAt)}</p>
                  </div>
                  <StatusBadge status={s.severity} />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Upcoming Maintenance</CardTitle>
            <Wrench className="h-4 w-4 text-muted-foreground/60" />
          </CardHeader>
          <CardContent className="space-y-2.5">
            {upcomingMx.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-medium">{m.aircraft.tailNumber} — {m.title}</p>
                  <p className="text-[11px] text-muted-foreground">{formatDate(m.startDate)}</p>
                </div>
                <StatusBadge status={m.status} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent Notifications</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground/60" />
          </CardHeader>
          <CardContent className="space-y-2.5">
            {notifications.map((n) => (
              <div key={n.id}>
                <p className="text-xs font-medium">{n.title}</p>
                {n.body && <p className="line-clamp-1 text-[11px] text-muted-foreground">{n.body}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Fleet Utilization This Month</CardTitle>
          <CardDescription>Hours flown per aircraft vs. a 60 hr/month target</CardDescription>
        </CardHeader>
        <CardContent>
          <UtilizationRows organizationId={organizationId} monthStart={monthStart} />
        </CardContent>
      </Card>
    </div>
  );
}

async function UtilizationRows({ organizationId, monthStart }: { organizationId: string; monthStart: Date }) {
  const aircraft = await db.aircraft.findMany({
    where: { organizationId, isSimulator: false },
    include: { dispatches: { where: { status: "CLOSED", closedAt: { gte: monthStart } }, select: { flightTime: true } } },
    orderBy: { tailNumber: "asc" },
  });
  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
      {aircraft.map((a) => {
        const hours = a.dispatches.reduce((t, d) => t + Number(d.flightTime ?? 0), 0);
        const pct = Math.min(100, (hours / 60) * 100);
        return (
          <div key={a.id}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium">{a.tailNumber}</span>
              <span className="text-muted-foreground">{hours.toFixed(1)} / 60 hrs</span>
            </div>
            <Progress value={pct} tone={pct > 80 ? "success" : pct > 40 ? "primary" : "warning"} />
          </div>
        );
      })}
    </div>
  );
}
