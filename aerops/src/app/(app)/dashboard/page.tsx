import Link from "next/link";
import type { Role } from "@prisma/client";
import {
  Plane, Wrench, Users, GraduationCap, DollarSign, TrendingUp, AlertTriangle,
  CalendarCheck, CloudSun, Award,
} from "lucide-react";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { cookies } from "next/headers";
import { activeLocationWeather, icaoOf, weatherSummary } from "@/lib/weather";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Progress, EmptyState } from "@/components/ui/misc";
import { CustomizableDashboard, type DashboardSection, type DashboardSectionChild } from "@/components/dashboard/customizable-dashboard";
import { dashboardCapabilities } from "@/lib/dashboard-access";
import { formatCurrency, formatTime, formatDate, fullName, daysUntil } from "@/lib/utils";

// Weather category → tone token (never raw hex). Mirrors the top bar chip.
const WX_TONE: Record<"VFR" | "MVFR" | "IFR", string> = {
  VFR: "text-success",
  MVFR: "text-warning",
  IFR: "text-destructive",
};

// The dashboard is personalized to the viewer's job. Sections are gated by
// PERMISSION (never role name) so nobody sees data they can't access — e.g. a
// Student Pilot never receives a finance node, a Finance Manager never receives
// the ops board. The role only picks the framing (eyebrow/subtitle) and, for
// Student Pilots, a dedicated my-training workspace. See
// docs/company/ROLES_AND_WORKSPACES.md for the full Dashboard Matrix.
const OVERVIEW_EYEBROW: Record<Role, string> = {
  SUPER_ADMIN: "Operations Overview",
  SCHOOL_ADMIN: "Operations Overview",
  DISPATCHER: "Dispatch Overview",
  INSTRUCTOR: "Instruction Overview",
  MAINTENANCE: "Maintenance Overview",
  ACCOUNTANT: "Financial Overview",
  STUDENT: "Flight Training",
};

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
  const perms = session!.permissions;
  const role = session!.role;
  const wx = await activeLocationWeather(organizationId, (await cookies()).get("aerops-location")?.value);
  const wxCategory = wx?.weather.category;
  const todayStart = startOfDay();
  const todayEnd = startOfDay(1);
  const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
  const hour = new Date().getHours();
  const timeOfDay = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";

  // Weather is surfaced ONLY here as a dedicated section (the top bar already
  // shows the active-location chip). Same single source, keyed to the location.
  const weatherSection = (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Weather</CardTitle>
          <CardDescription>{wx ? `${icaoOf(wx.location)} · active location` : "Active location"}</CardDescription>
        </div>
        <CloudSun className="h-4 w-4 text-muted-foreground/60" />
      </CardHeader>
      <CardContent>
        {!wx || !wxCategory ? (
          <p className="text-xs text-muted-foreground">
            No location set yet. Add a location in settings to see its current conditions here.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className={`text-sm font-semibold ${WX_TONE[wxCategory]}`}>{wxCategory}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{weatherSummary(wx.weather)}</span>
            </div>
            {wx.weather.risks.length > 0 && (
              <ul className="space-y-1 border-t border-border pt-2">
                {wx.weather.risks.map((r) => (
                  <li key={r} className="text-[11px] text-muted-foreground">{r}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );

  const greeting = (subtitle: string) => (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-brand-royal dark:text-brand-sky">{OVERVIEW_EYEBROW[role]}</p>
      <h1 className="text-[1.35rem] font-semibold leading-tight tracking-tight text-brand-navy dark:text-foreground">
        Good {timeOfDay}, {session!.firstName}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} · {subtitle}
      </p>
    </div>
  );

  // ───────────────────────── Student Pilot workspace ─────────────────────────
  // Students see THEIR training — next lessons, hours, checkride — never org-wide
  // ops or any financial totals. All queries are scoped to the student's own row.
  if (role === "STUDENT") {
    const me = await db.student.findFirst({
      where: { userId: session!.userId },
      select: { id: true, totalHours: true, soloHours: true, accountBalance: true },
    });
    const [myLessons, myCheckride, myNotifications] = await Promise.all([
      me
        ? db.scheduleEvent.findMany({
            where: { organizationId, studentId: me.id, start: { gte: todayStart }, type: { not: "MAINTENANCE_BLOCK" } },
            include: {
              aircraft: { select: { tailNumber: true } },
              instructor: { include: { user: { select: { firstName: true, lastName: true } } } },
              lessonType: { select: { name: true, color: true } },
            },
            orderBy: { start: "asc" },
            take: 5,
          })
        : Promise.resolve([]),
      me ? db.checkride.findFirst({ where: { studentId: me.id, status: "SCHEDULED", date: { gte: todayStart } }, orderBy: { date: "asc" } }) : Promise.resolve(null),
      // Students see only their OWN notifications — never org-wide broadcasts,
      // which can carry other members' operational/financial detail.
      db.notification.findMany({ where: { organizationId, userId: session!.userId }, orderBy: { createdAt: "desc" }, take: 5 }),
    ]);
    const owed = me ? Math.max(0, -Number(me.accountBalance)) : 0;

    const myLessonsSection = (
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>My Upcoming Lessons</CardTitle>
            <CardDescription>Your next scheduled flights and sessions</CardDescription>
          </div>
          <Link href="/schedule" className="text-xs font-medium text-primary hover:underline">Open schedule →</Link>
        </CardHeader>
        <CardContent className="space-y-1">
          {myLessons.length === 0 && (
            <EmptyState
              icon={<CalendarCheck className="h-7 w-7" />}
              title="No lessons scheduled yet"
              description="When your instructor or the front desk books a lesson, it will show up here."
            />
          )}
          {myLessons.map((f) => (
            <div key={f.id} className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50">
              <div className="w-24 text-xs font-semibold tabular-nums">{formatDate(f.start)}</div>
              <div className="h-8 w-1 rounded-full" style={{ background: f.lessonType?.color ?? "var(--color-primary)" }} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {formatTime(f.start)} · {f.lessonType?.name ?? f.type}
                </p>
                <p className="text-xs text-muted-foreground">
                  {f.instructor ? fullName(f.instructor.user) : "Solo"}{f.aircraft ? ` · ${f.aircraft.tailNumber}` : ""}
                </p>
              </div>
              <StatusBadge status={f.status} />
            </div>
          ))}
        </CardContent>
      </Card>
    );

    const myTrainingSection = (
      <Card>
        <CardHeader><CardTitle>My Training</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] text-muted-foreground">Total hours</p>
              <p className="text-2xl font-semibold tracking-tight tabular-nums">{me ? Number(me.totalHours).toFixed(1) : "0.0"}</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Solo hours</p>
              <p className="text-2xl font-semibold tracking-tight tabular-nums">{me ? Number(me.soloHours).toFixed(1) : "0.0"}</p>
            </div>
          </div>
          <div className="border-t border-border pt-3">
            <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"><Award className="h-3.5 w-3.5" /> Next checkride</p>
            {myCheckride ? (
              <p className="text-sm font-medium">{myCheckride.rating.replaceAll("_", " ")} · {formatDate(myCheckride.date)}</p>
            ) : (
              <p className="text-xs text-muted-foreground">None scheduled yet — keep flying toward your next stage.</p>
            )}
          </div>
          {owed > 0 && (
            <div className="border-t border-border pt-3">
              <p className="text-[11px] font-medium text-muted-foreground">Balance due</p>
              <p className="text-sm font-semibold text-destructive">{formatCurrency(owed)}</p>
            </div>
          )}
        </CardContent>
      </Card>
    );

    const activitySection = (
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Recent Activity</CardTitle>
          <Users className="h-4 w-4 text-muted-foreground/60" />
        </CardHeader>
        <CardContent className="space-y-2.5">
          {myNotifications.length === 0 && <p className="text-xs text-muted-foreground">Nothing new.</p>}
          {myNotifications.map((n) => (
            <div key={n.id}>
              <p className="text-xs font-medium">{n.title}</p>
              {n.body && <p className="line-clamp-1 text-[11px] text-muted-foreground">{n.body}</p>}
            </div>
          ))}
        </CardContent>
      </Card>
    );

    const studentSections: DashboardSection[] = [
      { key: "myLessons", label: "My Upcoming Lessons", node: myLessonsSection },
      {
        key: "trainingRow",
        label: "Training & weather",
        gridClassName: "grid grid-cols-1 gap-4 lg:grid-cols-3",
        children: [
          { key: "myTraining", label: "My Training", node: myTrainingSection },
          { key: "weather", label: "Weather", node: weatherSection },
          { key: "activity", label: "Recent Activity", node: activitySection },
        ],
      },
    ];
    return <CustomizableDashboard greeting={greeting("Here's your training at a glance.")} sections={studentSections} />;
  }

  // ───────────────────────── Operational workspace ─────────────────────────
  const { canSchedule, canMaintenance: canMaint, canStudents, canFinance, canFleet } = dashboardCapabilities(perms);

  const [
    todaysFlights, aircraftCounts, instructorsToday, checkrides,
    revenueTodayAgg, revenueMonthAgg, notifications, squawks, upcomingMx,
    balances, completedThisMonth,
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
  ]);

  const byStatus = Object.fromEntries(aircraftCounts.map((c) => [c.status, c._count]));
  const available = byStatus.AVAILABLE ?? 0;
  const inMx = (byStatus.IN_MAINTENANCE ?? 0) + (byStatus.GROUNDED ?? 0);
  const studentsFlyingToday = new Set(todaysFlights.filter((f) => f.studentId).map((f) => f.studentId)).size;
  const revenueToday = Number(revenueTodayAgg._sum.amount ?? 0);
  const revenueMonth = Number(revenueMonthAgg._sum.amount ?? 0);
  const outstanding = balances.reduce((t, s) => t + Math.abs(Number(s.accountBalance)), 0);

  // Pinned KPI tiles — each gated to the permission that makes it meaningful.
  const allStats = [
    { show: canSchedule, label: "Today's Flights", value: todaysFlights.length, icon: CalendarCheck, href: "/schedule" },
    { show: canFleet, label: "Aircraft Available", value: `${available}`, sub: `${inMx} down for maintenance`, icon: Plane, href: "/aircraft" },
    { show: canStudents, label: "Students Flying Today", value: studentsFlyingToday, sub: `${instructorsToday} instructors on staff`, icon: GraduationCap, href: "/students" },
  ];
  const stats = allStats.filter((s) => s.show);
  const statsCols = stats.length >= 3 ? "sm:grid-cols-3" : stats.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-1";
  const statsRow = stats.length > 0 ? (
    <div className={`grid grid-cols-1 gap-3 ${statsCols}`}>
      {stats.map((s) => (
        <Link key={s.label} href={s.href}>
          <Card className="transition-shadow hover:shadow-md">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-medium text-muted-foreground">{s.label}</p>
                <s.icon className="h-3.5 w-3.5 text-brand-royal dark:text-brand-sky" />
              </div>
              <p className="mt-1.5 text-2xl font-semibold tracking-tight">{s.value}</p>
              {s.sub && <p className="mt-0.5 text-[10px] text-muted-foreground">{s.sub}</p>}
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  ) : undefined;

  const todaysFlightsSection = (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Today&apos;s Flights</CardTitle>
          <CardDescription>Every flight on the schedule today, in order</CardDescription>
        </div>
        <Link href="/schedule" className="text-xs font-medium text-primary hover:underline">Open schedule →</Link>
      </CardHeader>
      <CardContent className="space-y-1">
        {todaysFlights.length === 0 && (
          <EmptyState
            icon={<CalendarCheck className="h-7 w-7" />}
            title="No flights scheduled today"
            description="Open the schedule to book the first flight of the day."
          />
        )}
        {todaysFlights.map((f) => (
          <div key={f.id} className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50">
            <div className="w-14 text-xs font-semibold tabular-nums">{formatTime(f.start)}</div>
            <div className="h-8 w-1 rounded-full" style={{ background: f.lessonType?.color ?? "var(--color-primary)" }} />
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
  );

  const squawksCard = (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Open Squawks</CardTitle>
        <AlertTriangle className="h-4 w-4 text-muted-foreground/60" />
      </CardHeader>
      <CardContent className="space-y-2.5">
        {squawks.length === 0 && <p className="text-xs text-muted-foreground">No open squawks — the fleet is clean.</p>}
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
  );

  const maintenanceCard = (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Upcoming Maintenance</CardTitle>
        <Wrench className="h-4 w-4 text-muted-foreground/60" />
      </CardHeader>
      <CardContent className="space-y-2.5">
        {upcomingMx.length === 0 && <p className="text-xs text-muted-foreground">Nothing scheduled.</p>}
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
  );

  const checkridesCard = (
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
  );

  const notificationsCard = (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Recent Activity</CardTitle>
        <Users className="h-4 w-4 text-muted-foreground/60" />
      </CardHeader>
      <CardContent className="space-y-2.5">
        {notifications.length === 0 && <p className="text-xs text-muted-foreground">Nothing new.</p>}
        {notifications.map((n) => (
          <div key={n.id}>
            <p className="text-xs font-medium">{n.title}</p>
            {n.body && <p className="line-clamp-1 text-[11px] text-muted-foreground">{n.body}</p>}
          </div>
        ))}
      </CardContent>
    </Card>
  );

  const financeSection = (
    <div>
      <h2 className="mb-3 text-sm font-semibold tracking-tight text-brand-navy dark:text-foreground">Finance</h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Link href="/billing">
          <Card className="transition-shadow hover:shadow-md">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-medium text-muted-foreground">Revenue Today</p>
                <DollarSign className="h-3.5 w-3.5 text-muted-foreground/60" />
              </div>
              <p className="mt-1.5 text-2xl font-semibold tracking-tight">{formatCurrency(revenueToday)}</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/reports">
          <Card className="transition-shadow hover:shadow-md">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-medium text-muted-foreground">Revenue This Month</p>
                <TrendingUp className="h-3.5 w-3.5 text-muted-foreground/60" />
              </div>
              <p className="mt-1.5 text-2xl font-semibold tracking-tight">{formatCurrency(revenueMonth)}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{completedThisMonth._count} flights closed</p>
            </CardContent>
          </Card>
        </Link>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Outstanding Balances</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground/60" />
          </CardHeader>
          <CardContent className="space-y-2">
            {balances.length === 0 && <p className="text-xs text-muted-foreground">All accounts settled.</p>}
            {balances.map((s) => (
              <div key={s.id} className="flex items-center justify-between">
                <p className="text-xs font-medium">{fullName(s.user)}</p>
                <p className="text-xs font-semibold text-destructive">{formatCurrency(Math.abs(Number(s.accountBalance)))}</p>
              </div>
            ))}
            {balances.length > 0 && (
              <div className="border-t border-border pt-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Total outstanding</span>
                  <span className="font-semibold">{formatCurrency(outstanding)}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );

  const fleetSection = (
    <Card>
      <CardHeader>
        <CardTitle>Fleet Utilization This Month</CardTitle>
        <CardDescription>Hours flown per aircraft vs. a 60 hr/month target</CardDescription>
      </CardHeader>
      <CardContent>
        <UtilizationRows organizationId={organizationId} monthStart={monthStart} />
      </CardContent>
    </Card>
  );

  // Build the section list from the viewer's permissions. Only permitted
  // sections are constructed, so ungated data never reaches the client.
  const attentionChildren: DashboardSectionChild[] = [];
  if (canMaint) attentionChildren.push({ key: "squawks", label: "Open Squawks", node: squawksCard, toggleable: false });
  if (canMaint) attentionChildren.push({ key: "maintenance", label: "Maintenance", node: maintenanceCard });
  if (canStudents) attentionChildren.push({ key: "checkrides", label: "Checkrides", node: checkridesCard });
  attentionChildren.push({ key: "notifications", label: "Recent Activity", node: notificationsCard });

  const sections: DashboardSection[] = [];
  if (canSchedule) sections.push({ key: "todaysFlights", label: "Today's Flights", node: todaysFlightsSection });
  sections.push({
    key: "needsAttention",
    label: "Needs attention",
    gridClassName: "grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4",
    children: attentionChildren,
  });
  sections.push({ key: "weather", label: "Weather", node: weatherSection });
  if (canFinance) sections.push({ key: "finance", label: "Finance Snapshot", node: financeSection });
  if (canFleet) sections.push({ key: "fleetStatus", label: "Fleet Status", node: fleetSection });

  return <CustomizableDashboard greeting={greeting("Here's today's operating picture.")} pinned={statsRow} sections={sections} />;
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
