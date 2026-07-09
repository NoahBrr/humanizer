"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Copy, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

type Plan = { id: string; name: string; price: number; maxUsers: number; maxAircraft: number; maxLocations: number };

const STEPS = ["Organization", "First location", "Plan", "Administrator", "Done"];

/**
 * Platform-side organization onboarding. Customer-facing self-serve onboarding
 * reuses the same API; this wizard is the operator path (< 2 minutes).
 */
export function NewOrgWizard({ plans }: { plans: Plan[] }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [timeZone, setTimeZone] = useState("America/New_York");
  const [locName, setLocName] = useState("");
  const [icao, setIcao] = useState("");
  const [planId, setPlanId] = useState(plans[1]?.id ?? plans[0]?.id ?? "");
  const [adminEmail, setAdminEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const stepValid = [
    name.length >= 2 && /^[a-z0-9-]{2,40}$/.test(slug),
    locName.length >= 2,
    !!planId,
    /.+@.+\..+/.test(adminEmail),
  ][step] ?? true;

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/platform/organizations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, slug, timeZone, planId, location: { name: locName, icao: icao || undefined }, adminEmail }),
    });
    setBusy(false);
    const j = await res.json();
    if (!res.ok) {
      setError(typeof j.error === "string" ? j.error : "Could not create the organization.");
    } else {
      setInviteUrl(`${window.location.origin}${j.inviteUrl}`);
      setStep(4);
    }
  }

  return (
    <div className="animate-fade-up mx-auto max-w-xl">
      <Link href="/platform/organizations" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Organizations
      </Link>
      <h1 className="mt-3 text-xl font-semibold tracking-tight">New organization</h1>

      <div className="mt-4 mb-5 flex items-center gap-1">
        {STEPS.map((s, i) => (
          <div key={s} className="flex flex-1 flex-col gap-1">
            <div className={`h-1 rounded-full ${i <= step ? "bg-violet-600" : "bg-muted"}`} />
            <span className={`text-[10px] ${i === step ? "font-semibold" : "text-muted-foreground"}`}>{s}</span>
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="space-y-4 p-6">
          {step === 0 && (
            <>
              <div className="space-y-1.5">
                <Label>Organization name</Label>
                <Input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40));
                  }}
                  placeholder="Carolina Flight Academy"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label>Workspace slug</Label>
                <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="carolina-flight" />
                <p className="text-[11px] text-muted-foreground">Lowercase letters, numbers, and dashes.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Time zone</Label>
                <Input value={timeZone} onChange={(e) => setTimeZone(e.target.value)} placeholder="America/New_York" />
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div className="space-y-1.5">
                <Label>Location name</Label>
                <Input value={locName} onChange={(e) => setLocName(e.target.value)} placeholder="Chapel Hill" autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label>Airport ICAO (optional)</Label>
                <Input value={icao} onChange={(e) => setIcao(e.target.value.toUpperCase())} placeholder="KIGX" maxLength={6} />
              </div>
              <p className="text-[11px] text-muted-foreground">More locations can be added any time in the organization&apos;s settings.</p>
            </>
          )}

          {step === 2 && (
            <div className="space-y-2">
              {plans.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPlanId(p.id)}
                  className={`w-full cursor-pointer rounded-xl border p-3 text-left transition-colors ${planId === p.id ? "border-violet-600 bg-violet-600/5" : "border-border hover:border-violet-600/40"}`}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">{p.name}</p>
                    <p className="text-sm font-semibold">${p.price}<span className="text-xs font-normal text-muted-foreground">/mo</span></p>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Up to {p.maxUsers} users · {p.maxAircraft} aircraft · {p.maxLocations} location{p.maxLocations > 1 ? "s" : ""}
                  </p>
                </button>
              ))}
            </div>
          )}

          {step === 3 && (
            <>
              <div className="space-y-1.5">
                <Label>Administrator email</Label>
                <Input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="owner@school.com" autoFocus />
              </div>
              <p className="text-[11px] text-muted-foreground">
                They receive an invitation to create the owner account and finish onboarding (aircraft, staff, data import) inside their workspace.
              </p>
              {error && <p className="text-xs font-medium text-destructive">{error}</p>}
            </>
          )}

          {step === 4 && inviteUrl && (
            <div className="space-y-3 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                <Check className="h-6 w-6 text-emerald-600" />
              </div>
              <p className="text-sm font-semibold">{name} is live</p>
              <p className="text-xs text-muted-foreground">Send the administrator this invitation link (also emailed automatically in production):</p>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-2">
                <code className="min-w-0 flex-1 truncate text-left text-[11px]">{inviteUrl}</code>
                <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(inviteUrl); setCopied(true); }}>
                  {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <Link href="/platform/organizations" className="inline-block text-xs font-medium text-primary hover:underline">Back to organizations →</Link>
            </div>
          )}

          {step < 4 && (
            <div className="flex justify-between border-t border-border pt-4">
              <Button variant="ghost" size="sm" disabled={step === 0 || busy} onClick={() => setStep(step - 1)}>Back</Button>
              {step < 3 ? (
                <Button size="sm" disabled={!stepValid} onClick={() => setStep(step + 1)}>
                  Continue <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <Button size="sm" disabled={!stepValid || busy} onClick={submit}>
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Create organization
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
