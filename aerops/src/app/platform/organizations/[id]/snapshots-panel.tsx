"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, History, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Snapshot = { id: string; name: string; sizeBytes: number; createdAt: string; createdBy: string };

/**
 * Save/restore points for an organization's dataset — lets platform staff
 * return a demo tenant to a known-good state in one click.
 */
export function SnapshotsPanel({ orgId, orgName, snapshots }: { orgId: string; orgName: string; snapshots: Snapshot[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");

  async function call(label: string, fn: () => Promise<Response>) {
    setBusy(label);
    setError(null);
    try {
      const res = await fn();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Request failed");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  const capture = () =>
    call("capture", () => fetch("/api/platform/snapshots", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId, name: name.trim() || `${orgName} — ${new Date().toLocaleDateString()}` }),
    })).then(() => setName(""));

  const restore = (id: string, snapName: string) => {
    if (!confirm(`Restore "${snapName}"?\n\nThis replaces ALL current data in ${orgName} with the snapshot contents.`)) return;
    call(`restore-${id}`, () => fetch(`/api/platform/snapshots/${id}`, { method: "POST" }));
  };

  const remove = (id: string) =>
    call(`delete-${id}`, () => fetch(`/api/platform/snapshots/${id}`, { method: "DELETE" }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Camera className="h-4 w-4 text-brand-sky" /> Snapshots</CardTitle>
        <CardDescription>Save this organization&apos;s exact state and restore it later — a known-good demo is always one click away.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5 pt-0">
        <div className="flex gap-2">
          <Input placeholder={`e.g. ${orgName} — investor demo`} value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-xs" />
          <Button variant="outline" size="sm" onClick={capture} disabled={!!busy}>
            {busy === "capture" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />} Save
          </Button>
        </div>
        {error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">{error}</p>}
        {snapshots.length === 0 && <p className="text-xs text-muted-foreground">No snapshots yet.</p>}
        {snapshots.map((s) => (
          <div key={s.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{s.name}</p>
              <p className="text-[11px] text-muted-foreground">
                {new Date(s.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {(s.sizeBytes / 1024).toFixed(0)} KB · {s.createdBy}
              </p>
            </div>
            <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={() => restore(s.id, s.name)} disabled={!!busy}>
              {busy === `restore-${s.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <History className="h-3 w-3" />} Restore
            </Button>
            <button onClick={() => remove(s.id)} disabled={!!busy} className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive" aria-label="Delete snapshot">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
