import { notFound } from "next/navigation";
import Link from "next/link";
import QRCode from "qrcode";
import { Plane, ArrowLeft, TrendingUp, History, QrCode } from "lucide-react";
import { airworthinessOf } from "@/lib/airworthiness";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Progress } from "@/components/ui/misc";
import { formatCurrency, formatDate, daysUntil, fullName } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AircraftDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const { id } = await params;
  const a = await db.aircraft.findFirst({
    where: { id, organizationId: session!.organizationId },
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
  const airworthiness = airworthinessOf(a, a.components);

  // --- Profitability & utilization (last 90 days) --------------------------
  const since = new Date(Date.now() - 90 * 86_400_000);
  const [closed, fleetForRank, auditTrail] = await Promise.all([
    db.dispatch.findMany({
      where: { aircraftId: a.id, status: "CLOSED", closedAt: { gte: since } },
      select: { flightTime: true, closedAt: true },
    }),
    db.dispatch.groupBy({
      by: ["aircraftId"],
      where: { aircraft: { organizationId: session!.organizationId, isSimulator: false }, status: "CLOSED", closedAt: { gte: since } },
      _sum: { flightTime: true },
    }),
    db.auditLog.findMany({
      where: { organizationId: session!.organizationId, entityType: "Aircraft", entityId: a.id },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
  ]);
  const hours90 = closed.reduce((t, d) => t + Number(d.flightTime ?? 0), 0);
  const wetRate = Number(a.hourlyRateWet);
  const revenue90 = hours90 * wetRate;
  const hourlyCost = Number(a.estimatedHourlyCost ?? 0);
  const insurance90 = Number(a.insuranceCostMonthly ?? 0) * 3;
  const cost90 = hours90 * hourlyCost + insurance90;
  const profit90 = revenue90 - cost90;
  const rank = 1 + fleetForRank
    .map((f) => ({ id: f.aircraftId, hrs: Number(f._sum.flightTime ?? 0) }))
    .filter((f) => f.hrs > hours90).length;

  // --- Unified history timeline ---------------------------------------------
  type TimelineItem = { at: Date; kind: string; text: string };
  const timeline: TimelineItem[] = [
    ...closed.filter((d) => d.closedAt).map((d) => ({ at: d.closedAt!, kind: "Flight", text: `Flight closed — ${Number(d.flightTime ?? 0).toFixed(1)} hrs` })),
    ...a.squawks.map((sq) => ({ at: sq.createdAt, kind: "Squawk", text: `${sq.title} (${sq.severity.toLowerCase()})` })),
    ...a.maintenance.map((m) => ({ at: m.startDate, kind: "Maintenance", text: `${m.title} — ${m.status.replaceAll("_", " ").toLowerCase()}` })),
    ...a.documents.map((d) => ({ at: d.uploadedAt, kind: "Document", text: d.name })),
    ...auditTrail.map((l) => ({ at: l.createdAt, kind: "Audit", text: `${l.action.split(".").pop()?.replaceAll("_", " ")} by ${l.actorLabel}` })),
  ].sort((x, y) => y.at.getTime() - x.at.getTime()).slice(0, 18);

  const qrDataUrl = await QRCode.toDataURL(`https://aerops.app/aircraft/${a.id}`, { margin: 1, width: 96 });
  const facts: [string, React.ReactNode][] = [
    ["Type", `${a.aircraftType.manufacturer} ${a.aircraftType.model}`],
    ["Nickname", a.nickname ?? "—"],
    ["Serial number", a.serialNumber ?? "—"],
    ["Ownership", `${a.ownershipType.replaceAll("_", " ").toLowerCase()}${a.ownerName ? ` — ${a.ownerName}` : ""}`],
    ["Engine", a.engineModel ? `${a.engineModel} (${a.engineSerial ?? "s/n —"})` : "—"],
    ["Propeller", a.propManufacturer ? `${a.propManufacturer} (${a.propSerial ?? "s/n —"})` : "—"],
    ["Empty / max gross", a.emptyWeightLbs ? `${a.emptyWeightLbs} / ${a.maxGrossWeightLbs} lbs` : "—"],
    ["Fuel capacity", a.fuelCapacityGal ? `${a.fuelCapacityGal} gal` : "—"],
    ["Cruise", a.cruiseSpeedKts ? `${a.cruiseSpeedKts} kts` : "—"],
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
        <div className="flex items-center gap-2">
          <StatusBadge status={airworthiness.state} className="text-xs" />
          <StatusBadge status={a.status} className="text-xs" />
        </div>
      </div>

      <div className={`rounded-xl border p-3 text-xs font-medium ${airworthiness.canDispatch ? "border-border bg-card text-muted-foreground" : "border-destructive/30 bg-destructive/5 text-destructive"}`}>
        {airworthiness.label}: {airworthiness.detail}{airworthiness.canDispatch ? "" : " Dispatch is blocked until this is resolved."}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5"><TrendingUp className="h-4 w-4" /> Profitability & Utilization</CardTitle>
            <CardDescription>Last 90 days · estimated from wet rate vs. hourly cost basis + insurance</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {[
                { label: "Hours flown", value: `${hours90.toFixed(1)}` },
                { label: "Revenue", value: formatCurrency(revenue90) },
                { label: "Est. costs", value: formatCurrency(cost90) },
                { label: "Est. profit", value: formatCurrency(profit90), tone: profit90 >= 0 },
                { label: "Revenue / hr", value: `${formatCurrency(wetRate)}` },
                { label: "Flights", value: String(closed.length) },
                { label: "Avg flight", value: closed.length ? `${(hours90 / closed.length).toFixed(1)} hrs` : "—" },
                { label: "Fleet rank", value: `#${rank} of ${Math.max(fleetForRank.length, 1)}` },
              ].map((f) => (
                <div key={f.label} className="rounded-lg bg-muted/60 p-2.5 text-center">
                  <p className="text-[10px] text-muted-foreground">{f.label}</p>
                  <p className={`text-sm font-semibold ${f.tone === false ? "text-destructive" : f.tone ? "text-success" : ""}`}>{f.value}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5"><QrCode className="h-4 w-4" /> Ramp QR</CardTitle>
            <CardDescription>Post in the cockpit — scanning opens this profile, squawks, and dispatch</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt={`QR code for ${a.tailNumber}`} className="h-24 w-24 rounded-lg border border-border bg-white p-1" />
            <div className="text-[11px] text-muted-foreground">
              <p className="font-mono">aerops.app/aircraft/…</p>
              <p className="mt-1">Insurance: {formatCurrency(a.insuranceCostMonthly ?? 0)}/mo</p>
              <p>Cost basis: {formatCurrency(a.estimatedHourlyCost ?? 0)}/hr</p>
              {a.fuelSurchargePerHr && <p>Fuel surcharge: {formatCurrency(a.fuelSurchargePerHr)}/hr</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5"><History className="h-4 w-4" /> Aircraft History</CardTitle>
          <CardDescription>Flights, squawks, maintenance, documents, and audited changes — one record</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {timeline.map((t, i) => (
            <div key={i} className="flex items-center gap-3 text-xs">
              <span className="w-24 shrink-0 text-[11px] text-muted-foreground">{formatDate(t.at)}</span>
              <Badge tone={t.kind === "Squawk" ? "amber" : t.kind === "Maintenance" ? "orange" : t.kind === "Flight" ? "blue" : "gray"}>{t.kind}</Badge>
              <span className="min-w-0 flex-1 truncate">{t.text}</span>
            </div>
          ))}
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
