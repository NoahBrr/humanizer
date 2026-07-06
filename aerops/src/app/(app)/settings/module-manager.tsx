"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Blocks, Workflow, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type ProfileOpt = { key: string; label: string; modules: string[]; active: boolean; inPlan: boolean };
type AutomationOpt = { key: string; label: string; description: string; trigger: string; enabled: boolean };

/**
 * Module Manager (Section 8): organizations activate business activities;
 * module dependencies resolve automatically and navigation adapts.
 */
export function ModuleManager({
  profiles, automations, enabledModules, moduleLabels, readOnly,
}: {
  profiles: ProfileOpt[]; automations: AutomationOpt[]; enabledModules: string[]; moduleLabels: Record<string, string>; readOnly: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    await fetch("/api/organization/profiles", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    router.refresh();
  }

  function toggleProfile(key: string, on: boolean) {
    const next = on ? [...profiles.filter((p) => p.active).map((p) => p.key), key] : profiles.filter((p) => p.active && p.key !== key).map((p) => p.key);
    patch({ businessProfiles: next });
  }

  function toggleAutomation(key: string, enable: boolean) {
    const nextDisabled = automations.filter((a) => (a.key === key ? !enable : !a.enabled)).map((a) => a.key);
    patch({ disabledAutomations: nextDisabled });
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5"><Blocks className="h-4 w-4" /> Business Profiles & Modules {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}</CardTitle>
          <CardDescription>
            Select every activity your organization performs — module dependencies install automatically and navigation adapts. Selections can change any time.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
            {profiles.map((p) => (
              <label key={p.key} className={`flex items-start gap-2 rounded-lg border p-2 text-xs ${p.active ? "border-primary/40 bg-primary/5" : "border-border"} ${!p.inPlan ? "opacity-45" : "cursor-pointer"}`}>
                <input
                  type="checkbox"
                  checked={p.active}
                  disabled={readOnly || busy || !p.inPlan}
                  onChange={(e) => toggleProfile(p.key, e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-primary)]"
                />
                <span>
                  <span className="font-medium">{p.label}</span>
                  {!p.inPlan && <span className="ml-1 rounded bg-muted px-1 text-[9px] text-muted-foreground">plan upgrade</span>}
                  <span className="block text-[10px] text-muted-foreground">needs: {p.modules.join(", ")}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="border-t border-border pt-2.5">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Installed modules</p>
            <div className="flex flex-wrap gap-1.5">
              {enabledModules.map((m) => <Badge key={m} tone="blue">{moduleLabels[m] ?? m}</Badge>)}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5"><Workflow className="h-4 w-4" /> Workflow Automations</CardTitle>
          <CardDescription>Built-in rules that run on operational events. The no-code workflow builder extends this same registry.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {automations.map((a) => (
            <label key={a.key} className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-border p-2.5 text-xs">
              <span>
                <span className="font-medium">{a.label}</span>
                <code className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[9px]">{a.trigger}</code>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">{a.description}</span>
              </span>
              <input
                type="checkbox"
                checked={a.enabled}
                disabled={readOnly || busy}
                onChange={(e) => toggleAutomation(a.key, e.target.checked)}
                className="mt-1 h-3.5 w-3.5 accent-[var(--color-primary)]"
              />
            </label>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
