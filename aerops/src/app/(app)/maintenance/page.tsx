import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { formatDate, daysUntil } from "@/lib/utils";
import { FleetStatusGrid, SquawkList } from "./maintenance-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Maintenance" };

export default async function MaintenancePage() {
  const session = await getSession();
  const organizationId = session!.organizationId;

  const [aircraft, squawks, orders] = await Promise.all([
    db.aircraft.findMany({
      where: { organizationId, isSimulator: false },
      include: { components: true, aircraftType: { select: { model: true } } },
      orderBy: { tailNumber: "asc" },
    }),
    db.squawk.findMany({
      where: { aircraft: { organizationId } },
      include: { aircraft: { select: { tailNumber: true } } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 30,
    }),
    db.maintenanceOrder.findMany({
      where: { aircraft: { organizationId } },
      include: { aircraft: { select: { tailNumber: true } } },
      orderBy: { startDate: "asc" },
    }),
  ]);

  const upcomingInspections = aircraft
    .flatMap((a) =>
      a.components.map((c) => {
        const hoursLeft = c.dueAtHours ? Number(c.dueAtHours) - Number(a.currentHobbs) : null;
        const daysLeft = c.dueAtDate ? daysUntil(c.dueAtDate) : null;
        return { tail: a.tailNumber, name: c.name, hoursLeft, daysLeft, dueAtDate: c.dueAtDate };
      }),
    )
    .filter((i) => (i.hoursLeft !== null && i.hoursLeft < 40) || (i.daysLeft !== null && i.daysLeft < 45))
    .sort((a, b) => (a.hoursLeft ?? a.daysLeft ?? 0) - (b.hoursLeft ?? b.daysLeft ?? 0));

  const queue = orders.filter((o) => o.status === "SCHEDULED" || o.status === "IN_PROGRESS");
  const history = orders.filter((o) => o.status === "COMPLETED").slice(0, 8);

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader title="Maintenance" description="Fleet airworthiness, squawks, and the maintenance queue" />

      <FleetStatusGrid
        aircraft={aircraft.map((a) => ({
          id: a.id, tailNumber: a.tailNumber, model: a.aircraftType.model, status: a.status, hobbs: Number(a.currentHobbs),
        }))}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SquawkList
          squawks={squawks.map((s) => ({
            id: s.id, tail: s.aircraft.tailNumber, title: s.title, description: s.description,
            severity: s.severity, status: s.status, createdAt: s.createdAt.toISOString(), resolution: s.resolution,
          }))}
        />

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Maintenance Queue</CardTitle>
              <CardDescription>Scheduled and in-progress work orders</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {queue.length === 0 && <p className="text-xs text-muted-foreground">Queue is clear.</p>}
              {queue.map((o) => (
                <div key={o.id} className="flex items-start justify-between gap-2 rounded-lg border border-border p-2.5">
                  <div>
                    <p className="text-xs font-semibold">{o.aircraft.tailNumber} — {o.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatDate(o.startDate)}{o.endDate ? ` → ${formatDate(o.endDate)}` : ""}{o.assignedTo ? ` · ${o.assignedTo}` : ""}
                    </p>
                    {o.description && <p className="mt-1 text-[11px] text-muted-foreground">{o.description}</p>}
                  </div>
                  <StatusBadge status={o.status} />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Upcoming Inspections</CardTitle>
              <CardDescription>Items due within 40 hours or 45 days</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {upcomingInspections.length === 0 && <p className="text-xs text-muted-foreground">Nothing due soon.</p>}
              {upcomingInspections.map((i, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs">
                  <span className="font-medium">{i.tail} — {i.name}</span>
                  <span className={`tabular-nums ${(i.hoursLeft ?? i.daysLeft ?? 99) <= 10 ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
                    {i.hoursLeft !== null ? `${i.hoursLeft.toFixed(1)} hrs` : `${i.daysLeft} days`}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Recently Completed</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {history.map((o) => (
                <div key={o.id} className="flex items-center justify-between text-xs">
                  <span>{o.aircraft.tailNumber} — {o.title}</span>
                  <span className="text-muted-foreground">{formatDate(o.endDate ?? o.startDate)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
