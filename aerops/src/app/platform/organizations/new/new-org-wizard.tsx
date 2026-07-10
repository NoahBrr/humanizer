"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Copy, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";

type Plan = { id: string; name: string; price: number; maxUsers: number; maxAircraft: number; maxLocations: number };

const STEPS = ["Organization", "Location", "Plan", "Account Owner", "Done"];

const ORG_TYPES: [string, string][] = [
  ["PART_61_FLIGHT_SCHOOL", "Part 61 Flight School"],
  ["PART_141_FLIGHT_SCHOOL", "Part 141 Flight School"],
  ["FLYING_CLUB", "Flying Club"],
  ["UNIVERSITY_PROGRAM", "University Aviation Program"],
  ["CORPORATE_FLIGHT_DEPT", "Corporate Flight Department"],
  ["MAINTENANCE_ORG", "Maintenance Organization"],
  ["OTHER", "Other"],
];

/**
 * Platform-side organization onboarding. Creates the org and its initial Account
 * Owner together: the owner is invited as a proposed ACCOUNT_OWNER and ownership
 * activates when they accept and their account exists (Part 2 / ADR-023).
 */
export function NewOrgWizard({ plans }: { plans: Plan[] }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [legalName, setLegalName] = useState("");
  const [orgType, setOrgType] = useState("PART_61_FLIGHT_SCHOOL");
  const [description, setDescription] = useState("");
  const [timeZone, setTimeZone] = useState("America/New_York");
  const [locName, setLocName] = useState("");
  const [icao, setIcao] = useState("");
  const [planId, setPlanId] = useState(plans[1]?.id ?? plans[0]?.id ?? "");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerFirstName, setOwnerFirstName] = useState("");
  const [ownerLastName, setOwnerLastName] = useState("");
  const [brandColor, setBrandColor] = useState("#2563eb");
  const [isDemo, setIsDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const stepValid = [
    name.length >= 2 && /^[a-z0-9-]{2,40}$/.test(slug),
    locName.length >= 2,
    !!planId,
    /.+@.+\..+/.test(ownerEmail),
  ][step] ?? true;

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/platform/organizations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        slug,
        legalName: legalName || undefined,
        orgType,
        description: description || undefined,
        timeZone,
        brandColor,
        isDemo,
        planId,
        location: { name: locName, icao: icao || undefined },
        owner: { mode: "invite", email: ownerEmail, firstName: ownerFirstName || undefined, lastName: ownerLastName || undefined },
      }),
    });
    setBusy(false);
    const j = await res.json();
    if (!res.ok) {
      setError(typeof j.error === "string" ? j.error : "Could not create the organization.");
    } else {
      setInviteUrl(j.inviteUrl ? `${window.location.origin}${j.inviteUrl}` : null);
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
                <Label>Public display name</Label>
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
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Workspace slug</Label>
                  <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="carolina-flight" />
                </div>
                <div className="space-y-1.5">
                  <Label>Organization type</Label>
                  <Select value={orgType} onChange={(e) => setOrgType(e.target.value)}>
                    {ORG_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Legal name (optional)</Label>
                <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Carolina Flight Academy, LLC" />
              </div>
              <div className="space-y-1.5">
                <Label>Description (optional)</Label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="Part 61 flight school at KIGX serving the Triangle."
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Primary time zone</Label>
                <Input value={timeZone} onChange={(e) => setTimeZone(e.target.value)} placeholder="America/New_York" />
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div className="space-y-1.5">
                <Label>Primary location name</Label>
                <Input value={locName} onChange={(e) => setLocName(e.target.value)} placeholder="Chapel Hill" autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label>Primary airport identifier (optional)</Label>
                <Input value={icao} onChange={(e) => setIcao(e.target.value.toUpperCase())} placeholder="KIGX" maxLength={6} />
              </div>
              <p className="text-[11px] text-muted-foreground">More locations can be added any time in the organization&apos;s profile.</p>
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
                <Label>Account Owner email</Label>
                <Input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="owner@school.com" autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>First name (optional)</Label>
                  <Input value={ownerFirstName} onChange={(e) => setOwnerFirstName(e.target.value)} placeholder="Jordan" />
                </div>
                <div className="space-y-1.5">
                  <Label>Last name (optional)</Label>
                  <Input value={ownerLastName} onChange={(e) => setOwnerLastName(e.target.value)} placeholder="Reyes" />
                </div>
              </div>
              <div className="grid grid-cols-2 items-end gap-3">
                <div className="space-y-1.5">
                  <Label>Brand color</Label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="h-9 w-10 cursor-pointer rounded-md border border-input bg-background" aria-label="Brand color" />
                    <Input value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="font-mono" />
                  </div>
                </div>
                <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm">
                  <input type="checkbox" checked={isDemo} onChange={(e) => setIsDemo(e.target.checked)} className="h-4 w-4 rounded border-input" />
                  Demo organization
                </label>
              </div>
              <p className="text-[11px] text-muted-foreground">
                The owner receives an invitation to create their account. Ownership (Account Owner) activates only when they accept — the org is provisioned now with the owner pending.
              </p>
              {error && <p className="text-xs font-medium text-destructive">{error}</p>}
            </>
          )}

          {step === 4 && (
            <div className="space-y-3 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                <Check className="h-6 w-6 text-emerald-600" />
              </div>
              <p className="text-sm font-semibold">{name} is provisioned</p>
              {inviteUrl ? (
                <>
                  <p className="text-xs text-muted-foreground">Send the Account Owner this invitation link (also emailed automatically in production). Ownership activates when they accept:</p>
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-2">
                    <code className="min-w-0 flex-1 truncate text-left text-[11px]">{inviteUrl}</code>
                    <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(inviteUrl); setCopied(true); }}>
                      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Ownership was assigned to the selected account.</p>
              )}
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
