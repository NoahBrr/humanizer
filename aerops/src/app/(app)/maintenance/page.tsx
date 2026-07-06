import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { formatDate, daysUntil } from "@/lib/utils";
import { FleetStatusGrid, SquawkList } from "./maintenance-actions";
import { WorkOrderBoard } from "./work-order-board";
import { Card as MetricCard } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

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

  const ACTIVE = ["DRAFT", "OPEN", "SCHEDULED", "ASSIGNED", "WAITING_PARTS", "IN_PROGRESS", "AWAITING_INSPECTION", "APPROVED", "RETURN_TO_SERVICE"];
  const queue = orders.filter((o) => ACTIVE.includes(o.status));
  const history = orders.filter((o) => ["COMPLETED", "CLOSED"].includes(o.status)).slice(0, 8);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const costMtd = orders
    .filter((o) => o.endDate && o.endDate >= monthStart)
    .reduce((t, o) => t + Number(o.costParts ?? 0) + Number(o.costLabor ?? 0), 0);
  const backlog = queue.length;
  const inShop = aircraft.filter((a) => ["GROUNDED", "IN_MAINTENANCE"].includes(a.status)).length;
  const avgDailyRevenue = 350; // conservative per-aircraft baseline for lost-revenue estimate
  const revenueLostEstimate = inShop * avgDailyRevenue;

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader title="Maintenance" description="Fleet airworthiness, squawks, and the maintenance queue" />

      <FleetStatusGrid
        aircraft={aircraft.map((a) => ({
          id: a.id, tailNumber: a.tailNumber, model: a.aircraftType.model, status: a.status, hobbs: Number(a.currentHobbs),
        }))}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Work-order backlog", value: String(backlog) },
          { label: "Aircraft in shop", value: String(inShop), alert: inShop > 0 },
          { label: "Maintenance cost (MTD)", value: formatCurrency(costMtd) },
          { label: "Est. revenue lost / day", value: formatCurrency(revenueLostEstimate), alert: revenueLostEstimate > 0 },
        ].map((m) => (
          <MetricCard key={m.label}>
            <div className="p-4">
              <p className="text-[11px] text-muted-foreground">{m.label}</p>
              <p className={`mt-1 text-lg font-semibold ${m.alert ? "text-destructive" : ""}`}>{m.value}</p>
            </div>
          </MetricCard>
        ))}
      </div>

      <WorkOrderBoard
        canManage={session!.permissions.has("maintenance.manage") && !session!.impersonation?.readOnly}
        orders={queue.map((o) => ({
          id: o.id, number: o.number, tail: o.aircraft.tailNumber, title: o.title, category: o.category,
          priority: o.priority, status: o.status, assignedTo: o.assignedTo, approvedBy: o.approvedBy,
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
