"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, DatabaseZap, Dices, Loader2 } from "lucide-react";
import { ORG_TEMPLATES, type OrgTemplateKey } from "@/lib/org-templates";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * One-click demo tenant factory. Pick a business template and size, get a
 * fully-populated isolated organization ready to demo in under a minute.
 */

type Result = { orgId: string; name: string; ownerEmail: string; ownerPassword: string; counts: Record<string, number> };

export default function DemoDataPage() {
  const [template, setTemplate] = useState<OrgTemplateKey>("medium-flight-school");
  const [fleetSize, setFleetSize] = useState(25);
  const [name, setName] = useState(ORG_TEMPLATES["medium-flight-school"].exampleNames[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);

  const tpl = ORG_TEMPLATES[template];

  function selectTemplate(key: OrgTemplateKey) {
    setTemplate(key);
    setFleetSize(ORG_TEMPLATES[key].defaultFleetSize);
    setName(ORG_TEMPLATES[key].exampleNames[Math.floor(Math.random() * ORG_TEMPLATES[key].exampleNames.length)]);
  }

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/platform/demo-orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, template, fleetSize, seedData: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Generation failed");
      setResults([{ ...data, name }, ...results]);
      // suggest a fresh example name for the next run
      const pool = tpl.exampleNames.filter((n) => n !== name);
      setName(pool[Math.floor(Math.random() * pool.length)] ?? `${name} ${Math.floor(Math.random() * 90) + 10}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="animate-fade-up">
      <h1 className="text-xl font-semibold tracking-tight">Demo Data Generator</h1>
      <p className="mt-0.5 text-sm text-muted-foreground">
        Create unlimited fully-isolated demo organizations with realistic fleets, people, schedules, billing and maintenance.
      </p>

      <div className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {Object.values(ORG_TEMPLATES).map((t) => (
          <button
            key={t.key}
            onClick={() => selectTemplate(t.key)}
            className={cn(
              "cursor-pointer rounded-xl border p-3.5 text-left transition-colors",
              template === t.key ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40",
            )}
          >
            <p className="text-sm font-medium">{t.label}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t.description}</p>
            <p className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground/70">e.g. {t.exampleNames[0]}</p>
          </button>
        ))}
      </div>

      <Card className="mt-4 max-w-3xl">
        <CardContent className="p-5">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
            <div className="space-y-1.5">
              <Label>Organization name</Label>
              <div className="flex gap-2">
                <Input value={name} onChange={(e) => setName(e.target.value)} />
                <Button variant="outline" size="icon" onClick={() => setName(tpl.exampleNames[Math.floor(Math.random() * tpl.exampleNames.length)])} aria-label="Random name">
                  <Dices className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Fleet size</Label>
              <div className="flex items-center gap-1.5">
                {[5, 25, 100, 500].map((n) => (
                  <button key={n} onClick={() => setFleetSize(n)} className={cn("cursor-pointer rounded-lg border px-3 py-2 text-xs font-medium", fleetSize === n ? "border-primary bg-primary/10 text-brand-sky" : "border-border hover:border-primary/40")}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-end">
              <Button onClick={generate} disabled={busy || name.trim().length < 2}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseZap className="h-4 w-4" />}
                Generate
              </Button>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Generates ~{Math.min(Math.max(Math.round(fleetSize * tpl.peopleRatio), 6), 1200).toLocaleString()} {tpl.training ? "students" : "clients"},
            ~{Math.min(Math.max(Math.round(fleetSize * tpl.instructorRatio), 1), 80)} instructors, a ±7 day schedule, invoices and maintenance history.
            {fleetSize >= 100 && " Large fleets can take up to a minute."}
          </p>
          {error && <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {results.length > 0 && (
        <div className="mt-6 max-w-3xl space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Generated this session</p>
          {results.map((r) => (
            <Card key={r.orgId}>
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{r.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {r.counts.aircraft} aircraft · {r.counts.students} people · {r.counts.scheduleEvents} events · owner <code className="font-mono">{r.ownerEmail}</code> / <code className="font-mono">{r.ownerPassword}</code>
                  </p>
                </div>
                <Link href={`/platform/organizations/${r.orgId}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand-sky hover:underline">
                  Manage <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
