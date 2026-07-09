"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Activity, CloudLightning, Loader2, Play, Radio, Square, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Org = { id: string; name: string };
type Scenario = { key: string; label: string; description: string };
type FeedItem = { at: string; kind: string; message: string };
type ActiveRun = { id: string; orgId: string; orgName: string; scenario: string; tickCount: number };

const KIND_STYLES: Record<string, string> = {
  dispatch: "text-brand-sky",
  flight: "text-success",
  booking: "text-blue-400",
  weather: "text-amber-400",
  maintenance: "text-red-400",
  revenue: "text-emerald-400",
  checkin: "text-violet-400",
  training: "text-cyan-400",
  ai: "text-fuchsia-400",
  warn: "text-amber-400",
};

const TICK_MS = 4000;

export function SimulationClient({ orgs, scenarios, initialRun }: { orgs: Org[]; scenarios: Scenario[]; initialRun: ActiveRun | null }) {
  const [orgId, setOrgId] = useState(initialRun?.orgId ?? orgs[0]?.id ?? "");
  const [scenario, setScenario] = useState(initialRun?.scenario ?? scenarios[0]?.key ?? "");
  const [run, setRun] = useState<ActiveRun | null>(initialRun);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const runRef = useRef<ActiveRun | null>(initialRun);
  runRef.current = run;

  const tick = useCallback(async () => {
    const current = runRef.current;
    if (!current) return;
    try {
      const res = await fetch("/api/platform/simulation/tick", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: current.id }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setRun((r) => (r ? { ...r, tickCount: data.tick } : r));
      setFeed((f) => [...data.feed.reverse(), ...f].slice(0, 60));
    } catch {
      /* transient — next tick retries */
    }
  }, []);

  // Re-arm only when the RUN changes (not on every tick's state update) —
  // otherwise each tick restarts the effect and fires immediately,
  // collapsing the interval into a tight loop.
  const runId = run?.id ?? null;
  useEffect(() => {
    if (!runId) return;
    tick();
    timer.current = setInterval(tick, TICK_MS);
    return () => {
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
    };
  }, [runId, tick]);

  async function start() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/platform/simulation", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, scenario }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to start");
      const org = orgs.find((o) => o.id === orgId);
      setFeed([]);
      setRun({ id: data.runId, orgId, orgName: org?.name ?? "", scenario, tickCount: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!run) return;
    setBusy(true);
    try {
      await fetch("/api/platform/simulation", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: run.id }),
      });
    } finally {
      setRun(null);
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-2">
        <CardContent className="space-y-4 p-5">
          <div className="space-y-1.5">
            <Label>Organization</Label>
            <Select value={orgId} onChange={(e) => setOrgId(e.target.value)} disabled={!!run}>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Scenario</Label>
            <div className="space-y-1.5">
              {scenarios.map((s) => (
                <button
                  key={s.key}
                  onClick={() => !run && setScenario(s.key)}
                  className={cn(
                    "block w-full cursor-pointer rounded-lg border px-3 py-2 text-left transition-colors",
                    scenario === s.key ? "border-primary bg-primary/10" : "border-border hover:border-primary/40",
                    run && "cursor-default opacity-60",
                  )}
                >
                  <p className="text-xs font-medium">{s.label}</p>
                  <p className="text-[11px] text-muted-foreground">{s.description}</p>
                </button>
              ))}
            </div>
          </div>
          {error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">{error}</p>}
          {run ? (
            <Button variant="destructive" className="w-full" onClick={stop} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />} Stop simulation
            </Button>
          ) : (
            <Button className="w-full" onClick={start} disabled={busy || !orgId}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Start simulation
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardContent className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Radio className={cn("h-4 w-4", run ? "animate-pulse text-success" : "text-muted-foreground")} />
              Live activity {run && <span className="text-xs font-normal text-muted-foreground">— {run.orgName} · tick {run.tickCount}</span>}
            </p>
            {run && <span className="rounded-md bg-success/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">Running</span>}
          </div>
          <div className="h-[26rem] space-y-2 overflow-y-auto rounded-lg border border-border bg-background/60 p-3 font-mono text-[11px]">
            {feed.length === 0 && (
              <p className="flex h-full flex-col items-center justify-center gap-2 text-center font-sans text-xs text-muted-foreground">
                {run ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-6 w-6 opacity-40" />}
                {run ? "Waiting for first tick…" : "Start a simulation to watch live dispatches, weather, maintenance and revenue flow through the tenant."}
              </p>
            )}
            {feed.map((f, i) => (
              <p key={`${f.at}-${i}`} className="flex gap-2">
                <span className="shrink-0 text-muted-foreground/60">{new Date(f.at).toLocaleTimeString("en-US", { hour12: false })}</span>
                <span className={cn("shrink-0 font-semibold uppercase", KIND_STYLES[f.kind] ?? "text-foreground")}>
                  {f.kind === "weather" ? <CloudLightning className="inline h-3 w-3" /> : f.kind === "maintenance" ? <Wrench className="inline h-3 w-3" /> : null} {f.kind}
                </span>
                <span className="text-foreground/90">{f.message}</span>
              </p>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
