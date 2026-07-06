import { notFound } from "next/navigation";
import Link from "next/link";
import { Plane, ArrowLeft } from "lucide-react";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Progress } from "@/components/ui/misc";
import { formatCurrency, formatDate, daysUntil, fullName } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AircraftDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const { id } = await params;
  const a = await db.aircraft.findFirst({
    where: { id, organizationId: session!.user.organizationId },
    include: {
      aircraftType: true,
      location: true,
      components: { orderBy: { name: "asc" } },
      squawks: { orderBy: { createdAt: "desc" }, take: 10 },
      maintenance: { orderBy: { startDate: "desc" }, take: 10 },
      documents: { orderBy: { uploadedAt: "desc" } },
      dispatches: {
        where: { status: "CLOSED" },
        orderBy: { closedAt: "desc" },
        take: 8,
        include: {
          student: { include: { user: { select: { firstName: true, lastName: true } } } },
          instructor: { include: { user: { select: { firstName: true, lastName: true } } } },
        },
      },
    },
  });
  if (!a) notFound();

  const hobbs = Number(a.currentHobbs);
  const facts: [string, React.ReactNode][] = [
    ["Type", `${a.aircraftType.manufacturer} ${a.aircraftType.model}`],
    ["Year", a.year ?? "—"],
    ["Home base", a.location ? `${a.location.icao} — ${a.location.name}` : "—"],
    ["Hourly rate (wet)", `${formatCurrency(a.hourlyRateWet)}/hr`],
    ["Hourly rate (dry)", a.hourlyRateDry ? `${formatCurrency(a.hourlyRateDry)}/hr` : "—"],
    ["Fuel", a.fuelType],
    ["Useful load", a.usefulLoadLbs ? `${a.usefulLoadLbs} lbs` : "—"],
    ["Hobbs", hobbs.toFixed(1)],
    ["Tach", Number(a.currentTach).toFixed(1)],
    ["Engine (SMOH)", Number(a.engineTimeSmoh).toFixed(1)],
    ["Prop (SPOH)", Number(a.propTimeSpoh).toFixed(1)],
    ["Insurance expires", formatDate(a.insuranceExpiration)],
    ["Registration expires", formatDate(a.registrationExpiration)],
  ];

  return (
    <div className="animate-fade-up space-y-4">
      <Link href="/aircraft" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> All aircraft
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
            <Plane className="h-6 w-6 -rotate-45" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{a.tailNumber}</h1>
            <p className="text-sm text-muted-foreground">{a.aircraftType.manufacturer} {a.aircraftType.model}</p>
          </div>
        </div>
        <StatusBadge status={a.status} className="text-xs" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {facts.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-sm">
                <span className="text-xs text-muted-foreground">{k}</span>
                <span className="font-medium tabular-nums">{v}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Inspections & Components</CardTitle>
            <CardDescription>Time- and date-based maintenance items with remaining margin</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {a.components.length === 0 && <p className="text-xs text-muted-foreground">No tracked components (simulator).</p>}
            {a.components.map((c) => {
              let label = "";
              let pct = 100;
              let overdue = false;
              if (c.dueAtHours) {
                const left = Number(c.dueAtHours) - hobbs;
                const interval = c.intervalHours ?? 100;
                pct = Math.max(0, Math.min(100, (left / interval) * 100));
                overdue = left <= 0;
                label = overdue ? `${Math.abs(left).toFixed(1)} hrs overdue` : `${left.toFixed(1)} hrs remaining`;
              } else if (c.dueAtDate) {
                const days = daysUntil(c.dueAtDate)!;
                const interval = (c.intervalMonths ?? 12) * 30;
                pct = Math.max(0, Math.min(100, (days / interval) * 100));
                overdue = days <= 0;
                label = overdue ? `${Math.abs(days)} days overdue` : `${days} days remaining`;
              }
              return (
                <div key={c.id}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium">{c.name}</span>
                    <span className={overdue ? "font-semibold text-destructive" : "text-muted-foreground"}>{label}</span>
                  </div>
                  <Progress value={pct} tone={overdue || pct < 15 ? "warning" : "primary"} />
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Squawks</CardTitle></CardHeader>
          <CardContent className="space-y-2.5">
            {a.squawks.length === 0 && <p className="text-xs text-muted-foreground">No squawks reported.</p>}
            {a.squawks.map((s) => (
              <div key={s.id} className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-medium">{s.title}</p>
                  <p className="text-[11px] text-muted-foreground">{formatDate(s.createdAt)}{s.resolution ? ` · ${s.resolution}` : ""}</p>
                </div>
                <div className="flex gap-1">
                  <StatusBadge status={s.severity} />
                  <StatusBadge status={s.status} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Maintenance History</CardTitle></CardHeader>
          <CardContent className="space-y-2.5">
            {a.maintenance.map((m) => (
              <div key={m.id} className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-medium">{m.title}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatDate(m.startDate)}{m.costParts || m.costLabor ? ` · ${formatCurrency(Number(m.costParts ?? 0) + Number(m.costLabor ?? 0))}` : ""}
                  </p>
                </div>
                <StatusBadge status={m.status} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Flights</CardTitle>
          <CardDescription>Closed dispatches for this aircraft</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR><TH>Date</TH><TH>Pilot / Student</TH><TH>Instructor</TH><TH>Hobbs</TH><TH>Flight time</TH><TH>Landings</TH></TR>
            </THead>
            <TBody>
              {a.dispatches.map((d) => (
                <TR key={d.id}>
                  <TD className="text-xs">{formatDate(d.closedAt)}</TD>
                  <TD className="text-xs font-medium">{fullName(d.student?.user)}</TD>
                  <TD className="text-xs">{fullName(d.instructor?.user)}</TD>
                  <TD className="text-xs tabular-nums">{d.hobbsOut ? `${Number(d.hobbsOut).toFixed(1)} → ${Number(d.hobbsIn).toFixed(1)}` : "—"}</TD>
                  <TD className="text-xs tabular-nums">{d.flightTime ? `${Number(d.flightTime).toFixed(1)} hrs` : "—"}</TD>
                  <TD className="text-xs tabular-nums">{d.landings ?? "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      {a.documents.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Documents</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {a.documents.map((d) => (
              <Badge key={d.id} tone="blue" className="px-3 py-1.5">{d.name}{d.expiresAt ? ` · expires ${formatDate(d.expiresAt)}` : ""}</Badge>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
