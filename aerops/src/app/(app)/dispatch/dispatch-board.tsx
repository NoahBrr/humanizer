"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Radio, PlaneTakeoff, PlaneLanding, Check, Loader2, AlertTriangle, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency, formatTime } from "@/lib/utils";

type DispatchRow = {
  id: string; status: string; tailNumber: string; aircraftStatus: string;
  currentHobbs: number; currentTach: number; rate: number; cfiRate: number;
  student: string | null; instructor: string | null; lesson: string;
  start: string; end: string; releasedAt: string | null; releasedBy: string | null;
  hobbsOut: number | null; tachOut: number | null; hobbsIn: number | null;
  flightTime: number | null; landings: number | null;
};

export function DispatchBoard({ dispatches, canDispatch }: { dispatches: DispatchRow[]; canDispatch: boolean }) {
  const pending = dispatches.filter((d) => d.status === "PENDING");
  const released = dispatches.filter((d) => d.status === "RELEASED");
  const closed = dispatches.filter((d) => d.status === "CLOSED");

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Column
        title="Awaiting Release"
        description="Complete the pre-flight checklist to release"
        icon={<Radio className="h-4 w-4 text-warning" />}
        count={pending.length}
      >
        {pending.map((d) => <PendingCard key={d.id} d={d} canDispatch={canDispatch} />)}
      </Column>
      <Column
        title="Released / In Flight"
        description="Complete the aircraft return after landing — creates a draft review, charges nothing"
        icon={<PlaneTakeoff className="h-4 w-4 text-primary" />}
        count={released.length}
      >
        {released.map((d) => <ReleasedCard key={d.id} d={d} canDispatch={canDispatch} />)}
      </Column>
      <Column
        title="Closed Today"
        description="Return complete — draft Revenue Review created"
        icon={<PlaneLanding className="h-4 w-4 text-success" />}
        count={closed.length}
      >
        {closed.map((d) => (
          <Card key={d.id}>
            <CardContent className="p-4">
              <DispatchHeader d={d} />
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <Fact label="Flight time" value={`${d.flightTime?.toFixed(1) ?? "—"} hrs`} />
                <Fact label="Hobbs in" value={d.hobbsIn?.toFixed(1) ?? "—"} />
                <Fact label="Landings" value={String(d.landings ?? "—")} />
              </div>
            </CardContent>
          </Card>
        ))}
      </Column>
    </div>
  );
}

function Column({ title, description, icon, count, children }: { title: string; description: string; icon: React.ReactNode; count: number; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <div className="flex-1">
          <p className="text-sm font-semibold">{title} <span className="ml-1 text-xs font-normal text-muted-foreground">{count}</span></p>
          <p className="text-[11px] text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="space-y-3">
        {count === 0 && <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">Nothing here</div>}
        {children}
      </div>
    </div>
  );
}

function DispatchHeader({ d }: { d: DispatchRow }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <p className="text-sm font-semibold">{d.tailNumber} <span className="font-normal text-muted-foreground">· {d.lesson}</span></p>
        <p className="text-xs text-muted-foreground">
          {formatTime(d.start)}–{formatTime(d.end)} · {d.student ?? "No student"}{d.instructor ? ` · CFI ${d.instructor}` : " · Solo"}
        </p>
      </div>
      <StatusBadge status={d.status} />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/60 py-1.5">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-xs font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function PendingCard({ d, canDispatch }: { d: DispatchRow; canDispatch: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fuelQty, setFuelQty] = useState("Full tanks (53 gal)");
  const [oilQty, setOilQty] = useState("7 qt");
  const [checks, setChecks] = useState({ weather: false, docs: false, cfi: false, student: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grounded = d.aircraftStatus === "GROUNDED" || d.aircraftStatus === "IN_MAINTENANCE";
  const allChecked = checks.weather && checks.docs && (d.instructor ? checks.cfi : true) && (d.student ? checks.student : true);

  async function release() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/dispatch/${d.id}/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fuelQty, oilQty,
        weatherAcknowledged: checks.weather, documentsVerified: checks.docs,
        instructorApproved: checks.cfi, studentApproved: checks.student,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(typeof j.error === "string" ? j.error : "Release failed.");
    } else {
      router.refresh();
    }
  }

  return (
    <Card>
      <CardContent className="p-4">
        <DispatchHeader d={d} />
        {grounded && (
          <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-destructive/10 px-2.5 py-1.5 text-[11px] font-medium text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" /> {d.tailNumber} is {d.aircraftStatus.replaceAll("_", " ").toLowerCase()} — cannot release.
          </p>
        )}
        {canDispatch && !grounded && !open && (
          <Button size="sm" className="mt-3 w-full" onClick={() => setOpen(true)}>Start pre-flight release</Button>
        )}
        {open && (
          <div className="mt-3 space-y-2.5 border-t border-border pt-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label>Fuel quantity</Label><Input value={fuelQty} onChange={(e) => setFuelQty(e.target.value)} className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label>Oil quantity</Label><Input value={oilQty} onChange={(e) => setOilQty(e.target.value)} className="h-8 text-xs" /></div>
            </div>
            {[
              { key: "weather" as const, label: "Weather briefing reviewed and acknowledged" },
              { key: "docs" as const, label: "Aircraft documents verified (ARROW)" },
              ...(d.instructor ? [{ key: "cfi" as const, label: `Instructor approval — ${d.instructor}` }] : []),
              ...(d.student ? [{ key: "student" as const, label: `Student/renter approval — ${d.student}` }] : []),
            ].map((c) => (
              <label key={c.key} className="flex cursor-pointer items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={checks[c.key]}
                  onChange={(e) => setChecks({ ...checks, [c.key]: e.target.checked })}
                  className="h-3.5 w-3.5 accent-[var(--color-primary)]"
                />
                {c.label}
              </label>
            ))}
            <p className="text-[11px] text-muted-foreground">Hobbs out will be recorded as {d.currentHobbs.toFixed(1)}.</p>
            {error && <p className="text-[11px] font-medium text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" disabled={!allChecked || busy} onClick={release}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Release flight
              </Button>
              <Button size="sm" variant="outline" onClick={() => setOpen(false)}>Close</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReleasedCard({ d, canDispatch }: { d: DispatchRow; canDispatch: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const hobbsOut = d.hobbsOut ?? d.currentHobbs;
  const tachOut = d.tachOut ?? d.currentTach;
  const [hobbsIn, setHobbsIn] = useState((hobbsOut + 1.5).toFixed(1));
  const [tachIn, setTachIn] = useState((tachOut + 1.3).toFixed(1));
  const [landings, setLandings] = useState("3");
  const [nightTime, setNightTime] = useState("0");
  const [instrumentTime, setInstrumentTime] = useState("0");
  const [fuelAdded, setFuelAdded] = useState("0");
  const [oilAdded, setOilAdded] = useState("0");
  const [airports, setAirports] = useState("");
  const [condition, setCondition] = useState("");
  const [withSquawk, setWithSquawk] = useState(false);
  const [squawkTitle, setSquawkTitle] = useState("");
  const [squawkSeverity, setSquawkSeverity] = useState("MINOR");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);

  const flightTime = Math.max(0, Number(hobbsIn) - hobbsOut);
  const estimate = flightTime * d.rate + (d.instructor ? (flightTime + 0.5) * d.cfiRate : 0);

  async function close() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/dispatch/${d.id}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hobbsIn: Number(hobbsIn), tachIn: Number(tachIn), landings: Number(landings),
        nightTime: Number(nightTime), instrumentTime: Number(instrumentTime), fuelAddedGal: Number(fuelAdded),
        oilAddedQt: oilAdded ? Number(oilAdded) : undefined,
        airportsVisited: airports.trim() || undefined,
        conditionIn: condition.trim() || undefined,
        squawk: withSquawk && squawkTitle.length >= 3 ? { title: squawkTitle, severity: squawkSeverity } : null,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(typeof j.error === "string" ? j.error : "Closeout failed.");
    } else {
      const j = await res.json().catch(() => ({}));
      // Show a confirmation linking to the created review before refreshing the
      // board out from under it, so the operator can jump straight to it.
      if (typeof j.reviewId === "string") setReviewId(j.reviewId);
      router.refresh();
    }
  }

  if (reviewId) {
    return (
      <Card>
        <CardContent className="p-4">
          <DispatchHeader d={d} />
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-success/10 px-3 py-2.5 text-xs text-foreground">
            <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <div>
              <p className="font-medium">Return complete — draft Revenue Review created. Nothing was charged.</p>
              <Link href={`/billing/reviews/${reviewId}`} className="mt-1 inline-block font-semibold text-primary hover:underline">
                View Revenue Review
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <DispatchHeader d={d} />
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Released {d.releasedAt ? formatTime(d.releasedAt) : ""} by {d.releasedBy ?? "—"} · Hobbs out {hobbsOut.toFixed(1)}
        </p>
        {canDispatch && !open && (
          <Button size="sm" variant="outline" className="mt-3 w-full" onClick={() => setOpen(true)}>Complete aircraft return</Button>
        )}
        {open && (
          <div className="mt-3 space-y-2.5 border-t border-border pt-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label>Hobbs in</Label><Input type="number" step="0.1" value={hobbsIn} onChange={(e) => setHobbsIn(e.target.value)} className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label>Tach in</Label><Input type="number" step="0.1" value={tachIn} onChange={(e) => setTachIn(e.target.value)} className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label>Landings</Label><Input type="number" value={landings} onChange={(e) => setLandings(e.target.value)} className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label>Fuel added (gal)</Label><Input type="number" step="0.1" value={fuelAdded} onChange={(e) => setFuelAdded(e.target.value)} className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label>Night (hrs)</Label><Input type="number" step="0.1" value={nightTime} onChange={(e) => setNightTime(e.target.value)} className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label>Instrument (hrs)</Label><Input type="number" step="0.1" value={instrumentTime} onChange={(e) => setInstrumentTime(e.target.value)} className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label>Oil added (qt)</Label><Input type="number" step="0.1" value={oilAdded} onChange={(e) => setOilAdded(e.target.value)} className="h-8 text-xs" /></div>
              <div className="space-y-1"><Label>Airports visited</Label><Input value={airports} onChange={(e) => setAirports(e.target.value)} placeholder="Airports visited" className="h-8 text-xs" /></div>
              <div className="col-span-2 space-y-1"><Label>Aircraft condition</Label><Input value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="Notes on how the aircraft came back" className="h-8 text-xs" /></div>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <input type="checkbox" checked={withSquawk} onChange={(e) => setWithSquawk(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--color-primary)]" />
              Report a squawk
            </label>
            {withSquawk && (
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2 space-y-1"><Label>Squawk</Label><Input value={squawkTitle} onChange={(e) => setSquawkTitle(e.target.value)} placeholder="What's wrong?" className="h-8 text-xs" /></div>
                <div className="space-y-1">
                  <Label>Severity</Label>
                  <Select value={squawkSeverity} onChange={(e) => setSquawkSeverity(e.target.value)} className="h-8 text-xs">
                    <option value="MINOR">Minor</option><option value="MAJOR">Major</option><option value="GROUNDING">Grounding</option>
                  </Select>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2">
              <span className="text-[11px] text-muted-foreground">Billable: <span className="font-semibold text-foreground">{flightTime.toFixed(1)} hrs</span></span>
              <Badge tone="blue">Draft total (not charged) {formatCurrency(estimate)}</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">Completing the return records the meters and creates a draft Revenue Review. It does not charge anything.</p>
            {error && <p className="text-[11px] font-medium text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" disabled={busy || flightTime <= 0} onClick={close}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlaneLanding className="h-3.5 w-3.5" />} Complete return & create Revenue Review
              </Button>
              <Button size="sm" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
