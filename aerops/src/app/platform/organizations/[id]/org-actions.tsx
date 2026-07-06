"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, Pause, Play, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";

async function patchOrg(orgId: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/platform/organizations/${orgId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.ok;
}

export function OrgActions({ orgId, status, planId, plans }: { orgId: string; status: string; planId: string | null; plans: { id: string; name: string; price: number }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function act(body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    await patchOrg(orgId, body);
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3 shadow-sm">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Manage</span>
      <Select
        value={planId ?? ""}
        onChange={(e) => act({ planId: e.target.value })}
        disabled={busy}
        className="h-8 w-56 text-xs"
        aria-label="Subscription plan"
      >
        {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — ${p.price}/mo</option>)}
      </Select>
      <div className="flex-1" />
      {status === "ACTIVE" && (
        <Button variant="outline" size="sm" disabled={busy} onClick={() => act({ status: "SUSPENDED" }, "Suspend this organization? All of its users lose access immediately (data is preserved).")}>
          <Pause className="h-3.5 w-3.5" /> Suspend
        </Button>
      )}
      {status !== "ACTIVE" && (
        <Button variant="success" size="sm" disabled={busy} onClick={() => act({ status: "ACTIVE" })}>
          <Play className="h-3.5 w-3.5" /> Reactivate
        </Button>
      )}
      {status !== "DELETED" && (
        <Button variant="destructive" size="sm" disabled={busy} onClick={() => act({ status: "DELETED" }, "Soft-delete this organization? It is hidden and locked but data is retained per policy.")}>
          <Trash2 className="h-3.5 w-3.5" /> Soft delete
        </Button>
      )}
      {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
    </div>
  );
}

export function ImpersonateButton({ userId, name }: { userId: string; name: string }) {
  const [busy, setBusy] = useState(false);

  async function impersonate(readOnly: boolean) {
    setBusy(true);
    const res = await fetch("/api/platform/impersonate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, readOnly }),
    });
    if (res.ok) window.location.href = "/dashboard";
    else setBusy(false);
  }

  return (
    <div className="flex gap-1">
      <Button variant="outline" size="sm" className="h-7 px-2 text-[10px]" disabled={busy} onClick={() => impersonate(true)} title={`View as ${name} (read-only)`}>
        <Eye className="h-3 w-3" /> View as
      </Button>
      <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px]" disabled={busy} onClick={() => { if (window.confirm(`Impersonate ${name} with FULL access? Every action is audited.`)) impersonate(false); }}>
        Full
      </Button>
    </div>
  );
}

export function ModuleToggles({ orgId, modules, disabled }: { orgId: string; disabled: boolean; modules: { key: string; label: string; core: boolean; inPlan: boolean; enabled: boolean }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle(key: string, enable: boolean) {
    setBusy(true);
    const nextDisabled = modules.filter((m) => (m.key === key ? !enable : !m.enabled)).map((m) => m.key);
    await patchOrg(orgId, { disabledModules: nextDisabled });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="space-y-1.5">
      {modules.map((m) => (
        <label key={m.key} className={`flex items-center justify-between gap-2 text-xs ${!m.inPlan ? "opacity-40" : ""}`}>
          <span>
            {m.label}
            {m.core && <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">core</span>}
            {!m.inPlan && <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">not in plan</span>}
          </span>
          <input
            type="checkbox"
            checked={m.enabled && m.inPlan}
            disabled={disabled || busy || m.core || !m.inPlan}
            onChange={(e) => toggle(m.key, e.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--color-primary)]"
            aria-label={`Toggle ${m.label}`}
          />
        </label>
      ))}
    </div>
  );
}
