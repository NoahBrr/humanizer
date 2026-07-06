"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Webhook, Plus, Trash2, Copy, Check, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

type KeyRow = { id: string; name: string; prefix: string; scopes: string[]; readOnly: boolean; revoked: boolean; lastUsedAt: string | null };
type HookRow = { id: string; url: string; events: string[]; isActive: boolean };

const DEFAULT_SCOPES = ["schedule.view", "aircraft.view", "students.view", "reports.view"];

export function DeveloperControls({ keys, hooks, webhookEvents }: { keys: KeyRow[]; hooks: HookRow[]; webhookEvents: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [readOnly, setReadOnly] = useState(true);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [hookUrl, setHookUrl] = useState("");
  const [hookEvents, setHookEvents] = useState<string[]>(["flight.closed"]);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function createKey() {
    setBusy(true);
    const res = await fetch("/api/developer/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: keyName, scopes: readOnly ? DEFAULT_SCOPES : [...DEFAULT_SCOPES, "schedule.create", "schedule.edit"], readOnly }),
    });
    const j = await res.json();
    setBusy(false);
    if (res.ok) { setNewKey(j.key); setKeyName(""); router.refresh(); }
  }

  async function createHook() {
    setBusy(true);
    const res = await fetch("/api/developer/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: hookUrl, events: hookEvents }),
    });
    const j = await res.json();
    setBusy(false);
    if (res.ok) { setNewSecret(j.secret); setHookUrl(""); router.refresh(); }
  }

  async function del(url: string, id: string) {
    setBusy(true);
    await fetch(url, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setBusy(false);
    router.refresh();
  }

  function copy(text: string, tag: string) {
    navigator.clipboard.writeText(text);
    setCopied(tag);
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5"><KeyRound className="h-4 w-4" /> API Keys</CardTitle>
          <CardDescription>Scoped service accounts. The full key is shown once — store it safely.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2.5">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-40 flex-1 space-y-1"><Label>Key name</Label><Input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="Zapier integration" className="h-8 text-xs" /></div>
            <label className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--color-primary)]" /> Read-only
            </label>
            <Button size="sm" disabled={busy || keyName.length < 2} onClick={createKey}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Create</Button>
          </div>
          {newKey && (
            <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/5 p-2">
              <code className="min-w-0 flex-1 truncate text-[11px]">{newKey}</code>
              <Button variant="outline" size="sm" onClick={() => copy(newKey, "key")}>{copied === "key" ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}</Button>
            </div>
          )}
          {keys.map((k) => (
            <div key={k.id} className="flex items-center gap-2 rounded-lg border border-border p-2 text-xs">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{k.name} <code className="ml-1 rounded bg-muted px-1 text-[10px]">{k.prefix}…</code></p>
                <p className="text-[10px] text-muted-foreground">{k.scopes.length} scopes{k.readOnly ? " · read-only" : ""}{k.lastUsedAt ? ` · last used ${new Date(k.lastUsedAt).toLocaleString()}` : " · never used"}</p>
              </div>
              {k.revoked ? <Badge tone="gray">Revoked</Badge> : (
                <Button variant="ghost" size="sm" className="h-6 px-1.5 text-destructive" disabled={busy} onClick={() => del("/api/developer/keys", k.id)}><Trash2 className="h-3 w-3" /></Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5"><Webhook className="h-4 w-4" /> Webhooks</CardTitle>
          <CardDescription>HTTPS endpoints receiving signed event payloads.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2.5">
          <div className="space-y-2">
            <div className="space-y-1"><Label>Endpoint URL</Label><Input value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} placeholder="https://example.com/aerops-hook" className="h-8 text-xs" /></div>
            <div className="flex flex-wrap gap-1.5">
              {webhookEvents.map((ev) => (
                <label key={ev} className={`cursor-pointer rounded-full border px-2 py-0.5 text-[10px] ${hookEvents.includes(ev) ? "border-primary/50 bg-primary/10 font-medium" : "border-border text-muted-foreground"}`}>
                  <input type="checkbox" className="hidden" checked={hookEvents.includes(ev)} onChange={(e) => setHookEvents(e.target.checked ? [...hookEvents, ev] : hookEvents.filter((x) => x !== ev))} />
                  {ev}
                </label>
              ))}
            </div>
            <Button size="sm" disabled={busy || !hookUrl.startsWith("http") || hookEvents.length === 0} onClick={createHook}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Register webhook
            </Button>
          </div>
          {newSecret && (
            <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/5 p-2">
              <span className="text-[10px] font-medium text-success">Signing secret (shown once):</span>
              <code className="min-w-0 flex-1 truncate text-[11px]">{newSecret}</code>
              <Button variant="outline" size="sm" onClick={() => copy(newSecret, "secret")}>{copied === "secret" ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}</Button>
            </div>
          )}
          {hooks.map((h) => (
            <div key={h.id} className="flex items-center gap-2 rounded-lg border border-border p-2 text-xs">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{h.url}</p>
                <p className="text-[10px] text-muted-foreground">{h.events.join(", ")}</p>
              </div>
              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-destructive" disabled={busy} onClick={() => del("/api/developer/webhooks", h.id)}><Trash2 className="h-3 w-3" /></Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
