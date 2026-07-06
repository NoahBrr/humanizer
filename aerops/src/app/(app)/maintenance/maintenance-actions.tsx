"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plane, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type AircraftRow = { id: string; tailNumber: string; model: string; status: string; hobbs: number };

export function FleetStatusGrid({ aircraft }: { aircraft: AircraftRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function setStatus(id: string, status: string) {
    setBusyId(id);
    await fetch(`/api/aircraft/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setBusyId(null);
    router.refresh();
  }

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {aircraft.map((a) => (
        <Card key={a.id}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Plane className="h-4 w-4 -rotate-45 text-muted-foreground" />
                <p className="text-sm font-semibold">{a.tailNumber}</p>
              </div>
              {busyId === a.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{a.model} · {a.hobbs.toFixed(1)} hrs</p>
            <div className="mt-2"><StatusBadge status={a.status} /></div>
            <div className="mt-2.5 flex gap-1.5">
              {a.status !== "AVAILABLE" && (
                <Button size="sm" variant="success" className="h-6 flex-1 px-2 text-[10px]" onClick={() => setStatus(a.id, "AVAILABLE")}>
                  Return to line
                </Button>
              )}
              {a.status === "AVAILABLE" && (
                <>
                  <Button size="sm" variant="outline" className="h-6 flex-1 px-2 text-[10px]" onClick={() => setStatus(a.id, "IN_MAINTENANCE")}>
                    To shop
                  </Button>
                  <Button size="sm" variant="destructive" className="h-6 flex-1 px-2 text-[10px]" onClick={() => setStatus(a.id, "GROUNDED")}>
                    Ground
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

type SquawkRow = {
  id: string; tail: string; title: string; description: string | null;
  severity: string; status: string; createdAt: string; resolution: string | null;
};

export function SquawkList({ squawks }: { squawks: SquawkRow[] }) {
  const router = useRouter();
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolution, setResolution] = useState("");
  const [busy, setBusy] = useState(false);

  async function update(id: string, status: string, res?: string) {
    setBusy(true);
    await fetch(`/api/squawks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, resolution: res }),
    });
    setBusy(false);
    setResolvingId(null);
    setResolution("");
    router.refresh();
  }

  const open = squawks.filter((s) => s.status === "OPEN" || s.status === "IN_PROGRESS");
  const closed = squawks.filter((s) => s.status === "RESOLVED" || s.status === "DEFERRED");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Squawks</CardTitle>
        <CardDescription>{open.length} open · {closed.length} resolved/deferred</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {open.map((s) => (
          <div key={s.id} className="rounded-lg border border-border p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold">{s.tail} — {s.title}</p>
                {s.description && <p className="mt-0.5 text-[11px] text-muted-foreground">{s.description}</p>}
              </div>
              <div className="flex shrink-0 gap-1">
                <StatusBadge status={s.severity} />
                <StatusBadge status={s.status} />
              </div>
            </div>
            {resolvingId === s.id ? (
              <div className="mt-2 flex gap-2">
                <Input value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Resolution notes…" className="h-7 flex-1 text-xs" />
                <Button size="sm" className="h-7 text-[11px]" disabled={busy || !resolution} onClick={() => update(s.id, "RESOLVED", resolution)}>Resolve</Button>
                <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setResolvingId(null)}>Cancel</Button>
              </div>
            ) : (
              <div className="mt-2 flex gap-1.5">
                {s.status === "OPEN" && (
                  <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={busy} onClick={() => update(s.id, "IN_PROGRESS")}>Start work</Button>
                )}
                <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => setResolvingId(s.id)}>Resolve…</Button>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" disabled={busy} onClick={() => update(s.id, "DEFERRED")}>Defer</Button>
              </div>
            )}
          </div>
        ))}
        {closed.slice(0, 5).map((s) => (
          <div key={s.id} className="flex items-start justify-between gap-2 rounded-lg p-2 opacity-70">
            <div>
              <p className="text-xs font-medium">{s.tail} — {s.title}</p>
              {s.resolution && <p className="text-[11px] text-muted-foreground">{s.resolution}</p>}
            </div>
            <StatusBadge status={s.status} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
