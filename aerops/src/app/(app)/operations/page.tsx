import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { Activity, AlertTriangle, Plane, Radio, CloudSun } from "lucide-react";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { airworthinessOf } from "@/lib/airworthiness";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { formatCurrency, formatTime, fullName } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Operations" };

type Alert = { severity: "CRITICAL" | "WARNING" | "INFO"; text: string; href: string };

export default async function OperationsCenter() {
  const session = await getSession();
  if (!session!.permissions.has("dispatch.release")) redirect("/dashboard");
  const organizationId = session!.organizationId;
  const locationId = (await cookies()).get("aerops-location")?.value || undefined;
  const now = new Date();
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);

  const [events, fleet, payments] = await Promise.all([
    db.scheduleEvent.findMany({
      where: { organizationId, start: { gte: dayStart, lt: dayEnd }, ...(locationId ? { locationId } : {}) },
      include: {
        aircraft: { include: { components: true } },
        instructor: { include: { user: { select: { firstName: true, lastName: true } } } },
        student: { include: { user: { select: { firstName: true, lastName: true } } } },
        lessonType: { select: { name: true } },
        dispatch: true,
      },
      orderBy: { start: "asc" },
    }),
    db.aircraft.findMany({
      where: { organizationId, status: { not: "RETIRED" }, ...(locationId ? { locationId } : {}) },
      include: {
        components: true,
        squawks: { where: { status: { in: ["OPEN", "ASSIGNED", "WAITING_PARTS", "IN_PROGRESS", "TESTING"] } }, select: { severity: true } },
        dispatches: {
          where: { status: "RELEASED" },
          include: { scheduleEvent: { select: { end: true } }, student: { include: { user: { select: { firstName: true, lastName: true } } } } },
        },
      },
      orderBy: { tailNumber: "asc" },
    }),
    db.payment.aggregate({ where: { invoice: { organizationId }, paidAt: { gte: dayStart } }, _sum: { amount: true } }),
  ]);

  // --- Board lanes -----------------------------------------------------------
  const lanes = {
    scheduled: events.filter((e) => e.status === "SCHEDULED" && (!e.dispatch || e.dispatch.status === "PENDING") && e.end > now),
    released: events.filter((e) => (e.status === "DISPATCHED" || e.status === "IN_FLIGHT") && e.end > now),
    needsCloseout: events.filter((e) => (e.status === "DISPATCHED" || e.status === "IN_FLIGHT") && e.end <= now),
    closed: events.filter((e) => e.status === "COMPLETED"),
    cancelled: events.filter((e) => ["CANCELLED", "WEATHER_CANCELLED", "NO_SHOW"].includes(e.status)),
  };

  // --- Alerts ------------------------------------------------------------------
  const alerts: Alert[] = [];
  for (const e of lanes.needsCloseout) {
    alerts.push({
      severity: "CRITICAL",
      text: `${e.aircraft?.tailNumber ?? "Flight"} not returned — scheduled back ${formatTime(e.end)} (${fullName(e.student?.user)})`,
      href: "/dispatch",
    });
  }
  for (const a of fleet) {
    const aw = airworthinessOf(a, a.components);
    if (a.status === "GROUNDED") alerts.push({ severity: "CRITICAL", text: `${a.tailNumber} grounded`, href: `/aircraft/${a.id}` });
    else if (aw.state === "MAINTENANCE_OVERDUE") alerts.push({ severity: "CRITICAL", text: `${a.tailNumber}: ${aw.detail}`, href: `/aircraft/${a.id}` });
    else if (aw.state === "DUE_SOON") alerts.push({ severity: "WARNING", text: `${a.tailNumber}: ${aw.detail}`, href: `/aircraft/${a.id}` });
    if (a.squawks.some((s) => s.severity === "GROUNDING")) alerts.push({ severity: "CRITICAL", text: `${a.tailNumber} has an open grounding squawk`, href: "/maintenance" });
  }
  for (const e of [...lanes.scheduled, ...lanes.released]) {
    const bal = Number(e.student?.accountBalance ?? 0);
    if (e.student && bal < -500) {
      alerts.push({ severity: "WARNING", text: `${fullName(e.student.user)} flying today owes ${formatCurrency(Math.abs(bal))}`, href: "/billing" });
    }
  }
  const severityRank = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const;
  alerts.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  const flightHoursToday = lanes.closed.length
    ? (await db.dispatch.aggregate({ where: { aircraft: { organizationId }, status: "CLOSED", closedAt: { gte: dayStart } }, _sum: { flightTime: true, fuelAddedGal: true } }))
    : { _sum: { flightTime: 0, fuelAddedGal: 0 } };

  const summary = [
    { label: "Flights completed", value: String(lanes.closed.length) },
    { label: "Cancelled / no-show", value: String(lanes.cancelled.length) },
    { label: "Hours flown", value: Number(flightHoursToday._sum.flightTime ?? 0).toFixed(1) },
    { label: "Fuel added (gal)", value: Number(flightHoursToday._sum.fuelAddedGal ?? 0).toFixed(0) },
    { label: "Revenue today", value: formatCurrency(payments._sum.amount) },
    { label: "Open alerts", value: String(alerts.length), alert: alerts.some((a) => a.severity === "CRITICAL") },
  ];

  const laneDefs = [
    { key: "scheduled" as const, title: "Scheduled", desc: "Awaiting dispatch" },
    { key: "released" as const, title: "Released / Flying", desc: "In the air or taxiing" },
    { key: "needsCloseout" as const, title: "Needs Closeout", desc: "Past scheduled return" },
    { key: "closed" as const, title: "Completed", desc: "Closed & billed" },
    { key: "cancelled" as const, title: "Cancelled", desc: "Wx / no-show / staff" },
  ];

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader
        title="Operations Center"
        description="What is happening right now — flights, fleet, weather, and everything needing attention"
      >
        <div className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-sm">
          <CloudSun className="h-3.5 w-3.5 text-warning" /> <span className="font-semibold text-success">VFR</span> KPAO 310°/8 10SM SCT045
        </div>
      </PageHeader>

      {alerts.length > 0 && (
        <Card className="border-warning/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-warning" /> Operational Alerts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {alerts.slice(0, 8).map((a, i) => (
              <Link key={i} href={a.href} className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs hover:bg-muted/50">
                <Badge tone={a.severity === "CRITICAL" ? "red" : a.severity === "WARNING" ? "amber" : "blue"}>{a.severity.toLowerCase()}</Badge>
                <span className="min-w-0 flex-1 truncate">{a.text}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {summary.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-[11px] text-muted-foreground">{s.label}</p>
              <p className={`mt-1 text-xl font-semibold ${s.alert ? "text-destructive" : ""}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5"><Radio className="h-4 w-4" /> Live Flight Board</CardTitle>
          <CardDescription>Every flight today, by operational stage — click a card to act in Dispatch</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-5">
          {laneDefs.map((lane) => (
            <div key={lane.key} className="rounded-lg border border-border bg-muted/30 p-2">
              <p className="mb-1.5 flex items-center justify-between px-1 text-xs font-semibold">
                {lane.title} <span className="text-muted-foreground">{lanes[lane.key].length}</span>
              </p>
              <div className="space-y-1.5">
                {lanes[lane.key].length === 0 && <p className="px-1 py-2 text-[11px] text-muted-foreground">—</p>}
                {lanes[lane.key].map((e) => {
                  const aw = e.aircraft ? airworthinessOf(e.aircraft, e.aircraft.components) : null;
                  const bal = Number(e.student?.accountBalance ?? 0);
                  return (
                    <Link key={e.id} href="/dispatch" className="block rounded-lg border border-border bg-card p-2 shadow-sm transition-shadow hover:shadow-md">
                      <div className="flex items-center justify-between gap-1">
                        <p className="truncate text-[11px] font-semibold">{e.aircraft?.tailNumber ?? e.lessonType?.name ?? "—"}</p>
                        <StatusBadge status={e.status} />
                      </div>
                      <p className="mt-0.5 truncate text-[11px]">{fullName(e.student?.user)}{e.instructor ? ` · ${e.instructor.user.lastName}` : " · solo"}</p>
                      <p className="text-[10px] text-muted-foreground">{formatTime(e.start)}–{formatTime(e.end)} · {e.lessonType?.name ?? e.type}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {aw && !aw.canDispatch && <Badge tone="red">{aw.label}</Badge>}
                        {aw && aw.state === "DUE_SOON" && <Badge tone="amber">mx soon</Badge>}
                        {bal < -500 && <Badge tone="amber">balance</Badge>}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5"><Plane className="h-4 w-4" /> Aircraft Status Wall</CardTitle>
          <CardDescription>Live fleet state — sized for a dispatch-office display</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {fleet.map((a) => {
            const flying = a.dispatches[0];
            const aw = airworthinessOf(a, a.components);
            const expectedBack = flying?.scheduleEvent.end;
            const late = expectedBack && expectedBack < now;
            const state = flying ? (late ? "LATE RETURN" : "FLYING") : a.status === "AVAILABLE" ? aw.state : a.status;
            return (
              <Link key={a.id} href={`/aircraft/${a.id}`} className="rounded-xl border border-border bg-card p-3 text-center shadow-sm transition-shadow hover:shadow-md">
                <p className="text-sm font-bold tracking-tight">{a.tailNumber}</p>
                <div className="mt-1.5 flex justify-center">
                  {state === "FLYING" && <Badge tone="green">Flying</Badge>}
                  {state === "LATE RETURN" && <Badge tone="red">Late return</Badge>}
                  {state !== "FLYING" && state !== "LATE RETURN" && <StatusBadge status={state} />}
                </div>
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  {flying
                    ? `${fullName(flying.student?.user)} · back ${expectedBack ? formatTime(expectedBack) : "—"}`
                    : a.squawks.length > 0
                      ? `${a.squawks.length} open squawk${a.squawks.length > 1 ? "s" : ""}`
                      : `${Number(a.currentHobbs).toFixed(1)} hrs`}
                </p>
              </Link>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-center gap-2 p-4 text-[11px] text-muted-foreground">
          <Activity className="h-3.5 w-3.5" />
          The daily operations summary (flights, hours, revenue, cancellations, fuel) is emailed to owners automatically each evening once the SendGrid adapter is connected — the same aggregates power this page live.
        </CardContent>
      </Card>
    </div>
  );
}
