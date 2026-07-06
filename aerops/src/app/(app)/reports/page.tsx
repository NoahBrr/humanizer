import { auth } from "@/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/misc";
import { ReportsClient } from "./reports-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const session = await auth();
  const organizationId = session!.user.organizationId;
  const since = new Date();
  since.setDate(since.getDate() - 30);
  since.setHours(0, 0, 0, 0);

  const [payments, dispatches, events, aircraft, instructors] = await Promise.all([
    db.payment.findMany({
      where: { invoice: { organizationId }, paidAt: { gte: since } },
      select: { amount: true, paidAt: true },
    }),
    db.dispatch.findMany({
      where: { aircraft: { organizationId }, status: "CLOSED", closedAt: { gte: since } },
      select: {
        flightTime: true, closedAt: true,
        aircraft: { select: { tailNumber: true, hourlyRateWet: true } },
        instructor: { select: { hourlyRate: true, user: { select: { firstName: true, lastName: true } } } },
        student: { select: { user: { select: { firstName: true, lastName: true } } } },
      },
    }),
    db.scheduleEvent.findMany({
      where: { organizationId, start: { gte: since }, status: { in: ["CANCELLED", "WEATHER_CANCELLED", "NO_SHOW"] } },
      select: { status: true, cancellationReason: true },
    }),
    db.aircraft.count({ where: { organizationId, isSimulator: false } }),
    db.instructor.count({ where: { user: { organizationId } } }),
  ]);

  // Revenue + flights per day
  const days: { date: string; revenue: number; flights: number; hours: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({ date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }), revenue: 0, flights: 0, hours: 0 });
  }
  const dayIndex = (date: Date) =>
    29 - Math.min(29, Math.max(0, Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0)) / 86_400_000)));
  for (const p of payments) {
    const idx = dayIndex(p.paidAt);
    if (days[idx]) days[idx].revenue += Number(p.amount);
  }
  for (const d of dispatches) {
    if (!d.closedAt) continue;
    const idx = dayIndex(d.closedAt);
    if (days[idx]) {
      days[idx].flights += 1;
      days[idx].hours += Number(d.flightTime ?? 0);
    }
  }

  // Revenue per aircraft / instructor / student
  const byAircraft = new Map<string, { hours: number; revenue: number }>();
  const byInstructor = new Map<string, { hours: number; revenue: number }>();
  const byStudent = new Map<string, { hours: number; revenue: number }>();
  for (const d of dispatches) {
    const ft = Number(d.flightTime ?? 0);
    const acRev = ft * Number(d.aircraft.hourlyRateWet);
    const key = d.aircraft.tailNumber;
    const a = byAircraft.get(key) ?? { hours: 0, revenue: 0 };
    a.hours += ft; a.revenue += acRev;
    byAircraft.set(key, a);

    if (d.instructor) {
      const name = `${d.instructor.user.firstName} ${d.instructor.user.lastName}`;
      const rev = (ft + 0.5) * Number(d.instructor.hourlyRate);
      const rec = byInstructor.get(name) ?? { hours: 0, revenue: 0 };
      rec.hours += ft; rec.revenue += rev;
      byInstructor.set(name, rec);
    }
    if (d.student) {
      const name = `${d.student.user.firstName} ${d.student.user.lastName}`;
      const rec = byStudent.get(name) ?? { hours: 0, revenue: 0 };
      rec.hours += ft; rec.revenue += acRev + (d.instructor ? (ft + 0.5) * Number(d.instructor.hourlyRate) : 0);
      byStudent.set(name, rec);
    }
  }

  const cancelReasons = new Map<string, number>();
  for (const e of events) {
    const reason = e.status === "WEATHER_CANCELLED" ? "Weather" : e.status === "NO_SHOW" ? "No-show" : e.cancellationReason ?? "Other";
    cancelReasons.set(reason, (cancelReasons.get(reason) ?? 0) + 1);
  }

  const totalHours = dispatches.reduce((t, d) => t + Number(d.flightTime ?? 0), 0);
  const totalRevenue = payments.reduce((t, p) => t + Number(p.amount), 0);
  const avgFlight = dispatches.length ? totalHours / dispatches.length : 0;

  const toRows = (m: Map<string, { hours: number; revenue: number }>) =>
    [...m.entries()].map(([name, v]) => ({ name, hours: Math.round(v.hours * 10) / 10, revenue: Math.round(v.revenue) })).sort((a, b) => b.revenue - a.revenue);

  return (
    <div className="animate-fade-up">
      <PageHeader title="Reports & Analytics" description="Last 30 days of operations. Export any dataset as CSV." />
      <ReportsClient
        summary={{
          revenue: Math.round(totalRevenue),
          flights: dispatches.length,
          hours: Math.round(totalHours * 10) / 10,
          avgFlight: Math.round(avgFlight * 10) / 10,
          utilization: aircraft > 0 ? Math.round((totalHours / (aircraft * 60)) * 100) : 0,
          instructors,
        }}
        daily={days}
        byAircraft={toRows(byAircraft)}
        byInstructor={toRows(byInstructor)}
        byStudent={toRows(byStudent)}
        cancellations={[...cancelReasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count)}
      />
    </div>
  );
}
