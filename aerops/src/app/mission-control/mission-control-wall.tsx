"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Plane, Radio, Wrench, GraduationCap, Landmark, Bell, Sparkles, X, CheckCheck,
  Gauge, CloudSun, Megaphone, Users, Plus, Trash2, Tv,
} from "lucide-react";
import type { MissionControlSnapshot, OpsFlight, FleetCard, AirportWeather } from "@/lib/mission-control";
import { PANEL_KEYS, PANEL_LABELS, type PanelKey, type Scene } from "@/lib/mission-control-scenes";
import { statusHex } from "@/lib/status-colors";

const SEVERITY_COLOR: Record<string, string> = { ACT_NOW: "#ef4444", THIS_WEEK: "#f59e0b", OPPORTUNITY: "#3b82f6" };
const CATEGORY_COLOR: Record<string, string> = { VFR: "#10b981", MVFR: "#3b82f6", IFR: "#ef4444" };
const TV_ROTATE_MS = 20_000;

export function MissionControlWall({
  initial, scenes: initialScenes, initialScene, tvMode, viewer, canAcknowledge, canManageScenes,
}: {
  initial: MissionControlSnapshot;
  scenes: Scene[];
  initialScene: string;
  tvMode: boolean;
  viewer: string;
  canAcknowledge: boolean;
  canManageScenes: boolean;
}) {
  const [snap, setSnap] = useState(initial);
  const [scenes, setScenes] = useState(initialScenes);
  const [sceneKey, setSceneKey] = useState(initialScene);
  const [live, setLive] = useState(false);
  const [clock, setClock] = useState<Date | null>(null);
  const [editing, setEditing] = useState(false);

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

  // TV mode: rotate through every scene automatically — no mouse required.
  useEffect(() => {
    if (!tvMode) return;
    const rotate = setInterval(() => {
      setSceneKey((current) => {
        const idx = scenes.findIndex((s) => s.key === current);
        return scenes[(idx + 1) % scenes.length]?.key ?? current;
      });
    }, TV_ROTATE_MS);
    return () => clearInterval(rotate);
  }, [tvMode, scenes]);

  async function acknowledgeAll() {
    await fetch("/api/notifications/read", { method: "POST" });
  }

  const scene = scenes.find((s) => s.key === sceneKey) ?? scenes[0];
  const criticalUnread = useMemo(() => snap.alerts.filter((a) => a.critical && a.unread), [snap.alerts]);

  // A panel renders only when its snapshot section exists — profile/module/
  // permission gating happens server-side, the scene just proposes an order.
  const available = (p: PanelKey): boolean => {
    if (p === "ops") return !!snap.ops;
    if (p === "maintenance") return !!snap.maintenance;
    if (p === "training") return !!snap.training;
    if (p === "finance") return !!snap.finance;
    if (p === "cfi") return !!snap.cfi;
    if (p === "crm") return !!snap.crm;
    if (p === "weather") return snap.weather.length > 0;
    return true;
  };
  const panels = scene.panels.filter(available);

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
        <span className="rounded-md border border-slate-700 px-2 py-0.5 text-xs font-medium tracking-wide text-slate-400">
          {scene.label}{tvMode && <Tv className="ml-1.5 inline h-3 w-3 align-[-1px]" />}
        </span>
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
          {!tvMode && (
            <Link href="/dashboard" aria-label="Exit Mission Control" className="rounded-md border border-slate-700 p-1.5 text-slate-400 hover:text-slate-100">
              <X className="h-4 w-4" />
            </Link>
          )}
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
          {canAcknowledge && !tvMode && (
            <button onClick={acknowledgeAll} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-red-700 px-3 py-1 text-xs font-semibold text-red-200 hover:bg-red-900/50">
              <CheckCheck className="h-3.5 w-3.5" /> Acknowledge
            </button>
          )}
        </div>
      )}

      {/* --- Scene grid ------------------------------------------------------ */}
      <main className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        {panels.map((p) => {
          switch (p) {
            case "kpi": return <KpiPanel key={p} snap={snap} />;
            case "ops": return <OpsPanel key={p} snap={snap} />;
            case "alerts": return <AlertsPanel key={p} snap={snap} />;
            case "fleet": return <FleetPanel key={p} snap={snap} />;
            case "aircraftwall": return <AircraftWallPanel key={p} snap={snap} />;
            case "weather": return <WeatherPanel key={p} snap={snap} />;
            case "insights": return <InsightsPanel key={p} snap={snap} />;
            case "maintenance": return <MaintenancePanel key={p} snap={snap} />;
            case "training": return <TrainingPanel key={p} snap={snap} />;
            case "cfi": return <CfiPanel key={p} snap={snap} />;
            case "crm": return <CrmPanel key={p} snap={snap} />;
            case "finance": return <FinancePanel key={p} snap={snap} />;
          }
        })}
      </main>

      {/* --- Scene switcher (hidden in TV mode) ------------------------------- */}
      {!tvMode && (
        <footer className="mt-5 space-y-3 border-t border-slate-800 pt-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            {scenes.map((sc) => (
              <span key={sc.key} className="group relative">
                <button
                  onClick={() => setSceneKey(sc.key)}
                  className={`rounded-full border px-3 py-1 font-medium transition-colors ${sc.key === sceneKey ? "border-blue-500 bg-blue-500/15 text-blue-300" : "border-slate-700 text-slate-400 hover:text-slate-200"}`}
                >
                  {sc.label}
                </button>
                {!sc.builtin && canManageScenes && (
                  <button
                    aria-label={`Delete scene ${sc.label}`}
                    onClick={async () => {
                      await fetch("/api/mission-control/scenes", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: sc.key }) });
                      setScenes((prev) => prev.filter((x) => x.key !== sc.key));
                      if (sceneKey === sc.key) setSceneKey("default");
                    }}
                    className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-slate-800 p-0.5 text-slate-400 hover:text-red-400 group-hover:block"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </span>
            ))}
            {canManageScenes && (
              <button onClick={() => setEditing((e) => !e)} className="flex items-center gap-1 rounded-full border border-dashed border-slate-600 px-3 py-1 font-medium text-slate-400 hover:text-slate-200">
                <Plus className="h-3 w-3" /> New scene
              </button>
            )}
            <Link href="/mission-control?tv=1" className="flex items-center gap-1 rounded-full border border-slate-700 px-3 py-1 font-medium text-slate-400 hover:text-slate-200">
              <Tv className="h-3 w-3" /> TV mode
            </Link>
            <span className="ml-auto">Signed in as {viewer} · one shared stream, every widget · scenes adapt to profiles and permissions</span>
          </div>
          {editing && (
            <SceneCreator
              onCreated={(scene) => {
                setScenes((prev) => [...prev, scene]);
                setSceneKey(scene.key);
                setEditing(false);
              }}
            />
          )}
        </footer>
      )}
    </div>
  );
}

function SceneCreator({ onCreated }: { onCreated: (s: Scene) => void }) {
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<PanelKey[]>(["kpi", "alerts"]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/mission-control/scenes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, panels: picked }),
    });
    const j = await res.json();
    setBusy(false);
    if (!res.ok) { setError(typeof j.error === "string" ? j.error : "Could not save scene."); return; }
    onCreated({ key: j.scene.id, label: j.scene.name, panels: j.scene.panels, builtin: false });
  }

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Scene name (e.g. Morning Dispatch)"
          className="h-8 rounded-lg border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100 placeholder:text-slate-600"
        />
        {PANEL_KEYS.map((p) => (
          <label key={p} className={`cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-medium ${picked.includes(p) ? "border-blue-500 bg-blue-500/15 text-blue-300" : "border-slate-700 text-slate-500"}`}>
            <input
              type="checkbox"
              className="hidden"
              checked={picked.includes(p)}
              onChange={(e) => setPicked(e.target.checked ? [...picked, p] : picked.filter((x) => x !== p))}
            />
            {PANEL_LABELS[p]}
          </label>
        ))}
        <button
          onClick={save}
          disabled={busy || name.trim().length < 2 || picked.length === 0}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          Save scene
        </button>
      </div>
      {error && <p className="mt-2 text-xs font-medium text-red-400">{error}</p>}
      <p className="mt-2 text-[11px] text-slate-500">Widgets render in the order picked. Saved scenes are shared with the whole organization.</p>
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
    <section className={`rounded-2xl border border-slate-800 bg-slate-900/40 p-4 ${span === 2 ? "xl:col-span-2" : span === 3 ? "xl:col-span-3" : ""}`}>
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
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// --- Widgets ----------------------------------------------------------------

function KpiPanel({ snap }: { snap: MissionControlSnapshot }) {
  const k = snap.kpi;
  const items: { label: string; value: string | number; tone?: string }[] = [
    { label: "Flights today", value: k.flightsToday },
    { label: "Completed", value: k.completedToday },
    { label: "Airworthy", value: `${k.airworthy}/${k.totalAircraft}`, tone: k.airworthy < k.totalAircraft ? "#f59e0b" : "#10b981" },
    { label: "Students", value: k.enrolledStudents },
    { label: "Open squawks", value: k.openSquawks, tone: k.openSquawks > 0 ? "#f97316" : undefined },
    { label: "New leads (7d)", value: k.newLeads7d },
  ];
  if (k.revenueToday !== null) items.push({ label: "Revenue today", value: usd(k.revenueToday), tone: "#10b981" });
  if (k.revenueMtd !== null) items.push({ label: "Revenue MTD", value: usd(k.revenueMtd), tone: "#10b981" });
  return (
    <Panel title="KPI Wall" icon={<Gauge className="h-3.5 w-3.5" />} span={3}>
      <div className="grid grid-cols-2 gap-2 text-center md:grid-cols-4 xl:grid-cols-8">
        {items.map((i) => <BigNumber key={i.label} label={i.label} value={i.value} tone={i.tone} />)}
      </div>
    </Panel>
  );
}

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

/** Section 16B aircraft wall: one rich card per aircraft, room-readable. */
function AircraftWallPanel({ snap }: { snap: MissionControlSnapshot }) {
  return (
    <Panel title="Aircraft Wall" icon={<Plane className="h-3.5 w-3.5" />} span={2}>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {snap.fleet.map((a) => <AircraftCard key={a.tail} a={a} />)}
      </div>
    </Panel>
  );
}

function AircraftCard({ a }: { a: FleetCard }) {
  const inspTone = a.hoursToInspection !== null && a.hoursToInspection <= 10 ? "#ef4444" : a.hoursToInspection !== null && a.hoursToInspection <= 40 ? "#f59e0b" : undefined;
  return (
    <div className="rounded-xl border border-slate-800/80 bg-slate-950/50 p-3" style={{ borderLeftWidth: 3, borderLeftColor: statusHex(a.status, "dark") }}>
      <div className="flex items-center gap-2">
        <span className="text-lg font-bold">{a.tail}</span>
        <span className="text-xs text-slate-500">{a.model}</span>
        <span className="ml-auto tabular-nums text-sm font-bold" style={{ color: statusHex(a.rating, "dark") }}>{a.score}</span>
        {statusChip(a.status)}
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2 text-center">
        <MiniStat label="Hobbs" value={a.hobbs.toFixed(1)} />
        <MiniStat label="Tach" value={a.tach.toFixed(1)} />
        <MiniStat label="To insp." value={a.hoursToInspection !== null ? `${a.hoursToInspection.toFixed(0)}h` : "—"} tone={inspTone} />
        <MiniStat label="Squawks" value={a.openSquawks} tone={a.openSquawks > 0 ? "#f97316" : undefined} />
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
        {a.todayFlights > 0 ? `${a.todayFlights} flight${a.todayFlights === 1 ? "" : "s"} today` : "No flights today"}
        {a.nextFlight ? ` · next ${a.nextFlight}` : ""}
      </p>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div>
      <p className="tabular-nums text-sm font-bold" style={tone ? { color: tone } : undefined}>{value}</p>
      <p className="text-[10px] text-slate-600">{label}</p>
    </div>
  );
}

function WeatherPanel({ snap }: { snap: MissionControlSnapshot }) {
  return (
    <Panel title="Weather" icon={<CloudSun className="h-3.5 w-3.5" />}>
      <div className="space-y-2">
        {snap.weather.map((w) => <AirportRow key={w.icao} w={w} />)}
      </div>
    </Panel>
  );
}

function AirportRow({ w }: { w: AirportWeather }) {
  const c = CATEGORY_COLOR[w.category];
  return (
    <div className="rounded-xl border border-slate-800/80 bg-slate-950/50 p-3" style={{ borderLeftWidth: 3, borderLeftColor: c }}>
      <div className="flex items-center gap-2">
        <span className="text-base font-bold">{w.icao}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{w.name}</span>
        <span className="rounded-md px-2 py-0.5 text-xs font-bold" style={{ background: `${c}26`, color: c }}>{w.category}</span>
      </div>
      <p className="mt-1.5 tabular-nums text-sm text-slate-300">
        {String(w.windDir).padStart(3, "0")}° {w.windKt}{w.gustKt ? `G${w.gustKt}` : ""}kt · {w.visibilitySm}SM · {w.ceilingFt ? `OVC${String(Math.round(w.ceilingFt / 100)).padStart(3, "0")}` : "CLR"} · {w.tempC}°C · DA {w.densityAltFt.toLocaleString()}ft
      </p>
      {w.risks.map((r) => (
        <p key={r} className="mt-1 text-[11px] font-medium text-amber-400">⚠ {r}</p>
      ))}
    </div>
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

function CfiPanel({ snap }: { snap: MissionControlSnapshot }) {
  const c = snap.cfi!;
  const tone = (d: number | null) => (d === null ? undefined : d <= 30 ? "#ef4444" : d <= 90 ? "#f59e0b" : undefined);
  return (
    <Panel title="Instructors" icon={<Users className="h-3.5 w-3.5" />}>
      <div className="space-y-1.5">
        {c.instructors.map((i) => (
          <div key={i.name} className="rounded-xl border border-slate-800/80 bg-slate-950/50 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{i.name}</span>
              <span className="ml-auto tabular-nums text-sm font-bold text-slate-300">{i.hours7d.toFixed(1)}h</span>
              <span className="text-[10px] text-slate-600">next 7d</span>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">
              CFI <span style={{ color: tone(i.cfiDays) }}>{i.cfiDays !== null ? `${i.cfiDays}d` : "—"}</span>
              {" · "}Medical <span style={{ color: tone(i.medicalDays) }}>{i.medicalDays !== null ? `${i.medicalDays}d` : "—"}</span>
            </p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function CrmPanel({ snap }: { snap: MissionControlSnapshot }) {
  const c = snap.crm!;
  return (
    <Panel title="Admissions & CRM" icon={<Megaphone className="h-3.5 w-3.5" />}>
      <div className="grid grid-cols-2 gap-2 text-center">
        <BigNumber label="New leads (7d)" value={c.newLeads7d} />
        <BigNumber label="Open pipeline" value={c.openLeads} />
        <BigNumber label="Follow-ups due" value={c.followUpsDue} tone={c.followUpsDue > 0 ? "#f59e0b" : undefined} />
        <BigNumber label="Pipeline value" value={usd(c.pipelineValue)} tone="#10b981" />
      </div>
    </Panel>
  );
}

function FinancePanel({ snap }: { snap: MissionControlSnapshot }) {
  const f = snap.finance!;
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
