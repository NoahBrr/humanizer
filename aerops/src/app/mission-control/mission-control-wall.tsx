"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Plane, Radio, Wrench, GraduationCap, Landmark, Bell, Sparkles, X, CheckCheck,
} from "lucide-react";
import type { MissionControlSnapshot, OpsFlight } from "@/lib/mission-control";
import { statusHex } from "@/lib/status-colors";

export type WallKey = "default" | "ops" | "maintenance" | "training" | "executive";

type PanelKey = "ops" | "fleet" | "maintenance" | "training" | "finance" | "alerts" | "insights";

const WALLS: Record<WallKey, { label: string; panels: PanelKey[] }> = {
  default: { label: "Mission Control", panels: ["ops", "alerts", "fleet", "insights", "maintenance", "training", "finance"] },
  ops: { label: "Operations Wall", panels: ["ops", "fleet", "alerts", "insights"] },
  maintenance: { label: "Maintenance Wall", panels: ["maintenance", "fleet", "alerts", "insights"] },
  training: { label: "Training Wall", panels: ["training", "ops", "alerts", "insights"] },
  executive: { label: "Executive Wall", panels: ["finance", "fleet", "insights", "alerts"] },
};

const SEVERITY_COLOR: Record<string, string> = { ACT_NOW: "#ef4444", THIS_WEEK: "#f59e0b", OPPORTUNITY: "#3b82f6" };

export function MissionControlWall({
  initial, initialWall, viewer, canAcknowledge,
}: {
  initial: MissionControlSnapshot;
  initialWall: WallKey;
  viewer: string;
  canAcknowledge: boolean;
}) {
  const [snap, setSnap] = useState(initial);
  const [wall, setWall] = useState<WallKey>(initialWall);
  const [live, setLive] = useState(false);
  const [clock, setClock] = useState<Date | null>(null);

  useEffect(() => {
    const tick = setInterval(() => setClock(new Date()), 1000);
    setClock(new Date());
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    const es = new EventSource("/api/mission-control/stream");
    es.addEventListener("snapshot", (e) => {
      setLive(true);
      setSnap(JSON.parse((e as MessageEvent).data));
    });
    es.onerror = () => setLive(false); // EventSource auto-reconnects
    return () => es.close();
  }, []);

  async function acknowledgeAll() {
    await fetch("/api/notifications/read", { method: "POST" });
  }

  const criticalUnread = useMemo(() => snap.alerts.filter((a) => a.critical && a.unread), [snap.alerts]);
  const panels = WALLS[wall].panels.filter((p) => {
    if (p === "ops") return !!snap.ops;
    if (p === "maintenance") return !!snap.maintenance;
    if (p === "training") return !!snap.training;
    if (p === "finance") return !!snap.finance;
    return true;
  });

  const s = snap.statusBar;

  return (
    <div className="min-h-screen bg-[#05080f] p-4 text-slate-100 lg:p-6" data-live={live}>
      {/* --- Live status bar ------------------------------------------------ */}
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            <span className={`absolute inline-flex h-full w-full rounded-full ${live ? "animate-ping bg-emerald-500/60" : "bg-amber-500/60"}`} />
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${live ? "bg-emerald-500" : "bg-amber-500"}`} />
          </span>
          <span className="text-sm font-bold tracking-widest text-slate-300">{live ? "LIVE" : "CONNECTING"}</span>
        </div>
        <h1 className="text-lg font-semibold tracking-tight">{snap.organization}</h1>
        <span className="rounded-md border border-slate-700 px-2 py-0.5 text-xs font-medium tracking-wide text-slate-400">{WALLS[wall].label}</span>
        <span className="text-sm text-slate-400">{s.weather}</span>
        <div className="ml-auto flex items-center gap-5 text-sm">
          <Stat dot="#10b981" label="Available" value={s.aircraftAvailable} />
          <Stat dot="#8b5cf6" label="Flying" value={s.aircraftFlying} />
          <Stat dot="#991b1b" label="Down" value={s.aircraftGrounded} />
          <Stat dot="#3b82f6" label="Flights today" value={s.flightsToday} />
          <Stat dot="#f59e0b" label="Unread" value={s.unreadAlerts} />
          <span className="tabular-nums text-2xl font-bold tracking-tight" suppressHydrationWarning>
            {clock ? clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--:--"}
          </span>
          <Link href="/dashboard" aria-label="Exit Mission Control" className="rounded-md border border-slate-700 p-1.5 text-slate-400 hover:text-slate-100">
            <X className="h-4 w-4" />
          </Link>
        </div>
      </header>

      {/* --- Critical alert strip (persists until acknowledged) ------------- */}
      {criticalUnread.length > 0 && (
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-red-800 bg-red-950/60 px-4 py-2.5">
          <Bell className="h-5 w-5 shrink-0 animate-pulse text-red-400" />
          <div className="flex min-w-0 flex-1 flex-wrap gap-x-6 gap-y-1">
            {criticalUnread.slice(0, 3).map((a) => (
              <span key={a.id} className="text-sm font-semibold text-red-200">{a.title}<span className="ml-2 font-normal text-red-300/80">{a.body}</span></span>
            ))}
          </div>
          {canAcknowledge && (
            <button onClick={acknowledgeAll} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-red-700 px-3 py-1 text-xs font-semibold text-red-200 hover:bg-red-900/50">
              <CheckCheck className="h-3.5 w-3.5" /> Acknowledge
            </button>
          )}
        </div>
      )}

      {/* --- Wall grid ------------------------------------------------------ */}
      <main className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        {panels.map((p) => {
          switch (p) {
            case "ops": return <OpsPanel key={p} snap={snap} />;
            case "alerts": return <AlertsPanel key={p} snap={snap} />;
            case "fleet": return <FleetPanel key={p} snap={snap} />;
            case "insights": return <InsightsPanel key={p} snap={snap} />;
            case "maintenance": return <MaintenancePanel key={p} snap={snap} />;
            case "training": return <TrainingPanel key={p} snap={snap} />;
            case "finance": return <FinancePanel key={p} snap={snap} />;
          }
        })}
      </main>

      {/* --- Wall switcher ---------------------------------------------------- */}
      <footer className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3 text-xs text-slate-500">
        {(Object.keys(WALLS) as WallKey[]).map((w) => (
          <button
            key={w}
            onClick={() => setWall(w)}
            className={`rounded-full border px-3 py-1 font-medium transition-colors ${w === wall ? "border-blue-500 bg-blue-500/15 text-blue-300" : "border-slate-700 text-slate-400 hover:text-slate-200"}`}
          >
            {WALLS[w].label}
          </button>
        ))}
        <span className="ml-auto">Signed in as {viewer} · streaming every 5s · walls adapt to business profiles and permissions</span>
      </footer>
    </div>
  );
}

function Stat({ dot, label, value }: { dot: string; label: string; value: number }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ background: dot }} />
      <span className="tabular-nums text-xl font-bold">{value}</span>
      <span className="hidden text-xs text-slate-500 lg:inline">{label}</span>
    </span>
  );
}

function Panel({ title, icon, span, children }: { title: string; icon: React.ReactNode; span?: number; children: React.ReactNode }) {
  return (
    <section className={`rounded-2xl border border-slate-800 bg-slate-900/40 p-4 ${span === 2 ? "xl:col-span-2" : ""}`}>
      <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-slate-400">{icon}{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function statusChip(status: string) {
  const hex = statusHex(status, "dark");
  return (
    <span className="rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wide" style={{ background: `${hex}26`, color: hex }}>
      {status.replaceAll("_", " ")}
    </span>
  );
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function OpsPanel({ snap }: { snap: MissionControlSnapshot }) {
  const ops = snap.ops!;
  return (
    <Panel title="Operations" icon={<Radio className="h-3.5 w-3.5" />} span={2}>
      {ops.active.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {ops.active.map((f) => <FlightRow key={f.id} f={f} big />)}
        </div>
      )}
      <div className="space-y-1.5">
        {ops.upcoming.length === 0 && ops.active.length === 0 && <p className="text-sm text-slate-500">No flights remaining today.</p>}
        {ops.upcoming.map((f) => <FlightRow key={f.id} f={f} />)}
      </div>
      <p className="mt-3 text-xs text-slate-500">{ops.completed} completed · {ops.cancelled} cancelled today</p>
    </Panel>
  );
}

function FlightRow({ f, big }: { f: OpsFlight; big?: boolean }) {
  return (
    <div className={`flex items-center gap-3 rounded-xl border border-slate-800/80 bg-slate-950/50 px-3 ${big ? "py-2.5" : "py-1.5"}`}>
      <span className={`tabular-nums font-bold ${big ? "text-lg" : "text-sm"}`}>{hhmm(f.start)}</span>
      <span className={`font-semibold ${big ? "text-lg" : "text-sm"}`}>{f.tail ?? "—"}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-slate-400">
        {f.student ?? "Open"}{f.instructor ? ` · ${f.instructor}` : ""} · {f.type}
      </span>
      {statusChip(f.status)}
    </div>
  );
}

function FleetPanel({ snap }: { snap: MissionControlSnapshot }) {
  return (
    <Panel title="Fleet" icon={<Plane className="h-3.5 w-3.5" />} span={2}>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
        {snap.fleet.map((a) => (
          <div key={a.tail} className="rounded-xl border border-slate-800/80 bg-slate-950/50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-base font-bold">{a.tail}</span>
              <span className="tabular-nums text-sm font-bold" style={{ color: statusHex(a.rating, "dark") }}>{a.score}</span>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-slate-500">{a.model} · {a.hobbs.toFixed(1)} hrs</p>
            <div className="mt-2">{statusChip(a.status)}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function AlertsPanel({ snap }: { snap: MissionControlSnapshot }) {
  return (
    <Panel title="Alerts" icon={<Bell className="h-3.5 w-3.5" />}>
      <div className="space-y-1.5">
        {snap.alerts.length === 0 && <p className="text-sm text-slate-500">All quiet.</p>}
        {snap.alerts.slice(0, 8).map((a) => (
          <div key={a.id} className={`rounded-xl border px-3 py-1.5 ${a.critical && a.unread ? "border-red-800 bg-red-950/40" : "border-slate-800/80 bg-slate-950/50"}`}>
            <div className="flex items-center gap-2">
              {a.unread && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${a.critical ? "bg-red-500" : "bg-blue-500"}`} />}
              <p className={`min-w-0 flex-1 truncate text-sm ${a.unread ? "font-semibold" : "text-slate-400"}`}>{a.title}</p>
              <span className="shrink-0 text-[10px] text-slate-500">{hhmm(a.createdAt)}</span>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function InsightsPanel({ snap }: { snap: MissionControlSnapshot }) {
  return (
    <Panel title="AI Insights" icon={<Sparkles className="h-3.5 w-3.5" />}>
      <div className="space-y-2">
        {snap.insights.length === 0 && <p className="text-sm text-slate-500">No recommendations right now.</p>}
        {snap.insights.map((i, idx) => (
          <div key={idx} className="rounded-xl border border-slate-800/80 bg-slate-950/50 p-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SEVERITY_COLOR[i.severity] }} />
              <p className="text-sm font-semibold leading-snug">{i.recommendation}</p>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">{i.why}</p>
            <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-600">{i.category} · {i.confidence} confidence</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function MaintenancePanel({ snap }: { snap: MissionControlSnapshot }) {
  const m = snap.maintenance!;
  return (
    <Panel title="Maintenance" icon={<Wrench className="h-3.5 w-3.5" />}>
      <div className="grid grid-cols-3 gap-2 text-center">
        <BigNumber label="Backlog" value={m.backlog} />
        <BigNumber label="In shop" value={m.inShop} tone={m.inShop > 0 ? "#f97316" : undefined} />
        <BigNumber label="Awaiting insp." value={m.awaitingInspection} tone={m.awaitingInspection > 0 ? "#f59e0b" : undefined} />
      </div>
      {m.lowStock.length > 0 && (
        <div className="mt-3 space-y-1">
          {m.lowStock.map((p) => (
            <p key={p.partNumber} className="flex items-center justify-between text-sm">
              <span className="text-red-300">{p.partNumber}</span>
              <span className="tabular-nums text-slate-400">{p.quantity} / min {p.minQuantity}</span>
            </p>
          ))}
        </div>
      )}
    </Panel>
  );
}

function TrainingPanel({ snap }: { snap: MissionControlSnapshot }) {
  const t = snap.training!;
  return (
    <Panel title="Training" icon={<GraduationCap className="h-3.5 w-3.5" />}>
      <BigNumber label="Enrolled students" value={t.enrolled} />
      <div className="mt-3 space-y-1.5">
        {t.checkrides.length === 0 && <p className="text-sm text-slate-500">No checkrides in the next 14 days.</p>}
        {t.checkrides.map((c, i) => (
          <div key={i} className="flex items-center gap-2 rounded-xl border border-slate-800/80 bg-slate-950/50 px-3 py-1.5 text-sm">
            <span className="font-semibold">{c.student}</span>
            <span className="min-w-0 flex-1 truncate text-slate-400">{c.rating}</span>
            <span className="tabular-nums text-slate-400">{new Date(c.date).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function FinancePanel({ snap }: { snap: MissionControlSnapshot }) {
  const f = snap.finance!;
  const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  return (
    <Panel title="Finance" icon={<Landmark className="h-3.5 w-3.5" />}>
      <div className="grid grid-cols-3 gap-2 text-center">
        <BigNumber label="Payments MTD" value={usd(f.paymentsMtd)} tone="#10b981" />
        <BigNumber label="Overdue" value={usd(f.overdueTotal)} tone={f.overdueTotal > 0 ? "#ef4444" : undefined} />
        <BigNumber label="Open invoices" value={f.openInvoices} />
      </div>
    </Panel>
  );
}

function BigNumber({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-800/80 bg-slate-950/50 p-3">
      <p className="tabular-nums text-3xl font-bold tracking-tight" style={tone ? { color: tone } : undefined}>{value}</p>
      <p className="mt-1 text-[11px] text-slate-500">{label}</p>
    </div>
  );
}
