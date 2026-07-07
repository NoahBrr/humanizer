"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Building2, Check, Loader2, MapPin, Puzzle, Rocket, UserPlus } from "lucide-react";
import { BUSINESS_PROFILES, type BusinessProfileKey } from "@/lib/business-profiles";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Self-serve organization creation wizard. The signed-in individual account
 * becomes the organization owner; business activities drive which modules
 * light up (lib/business-profiles).
 */

const STEPS = [
  { key: "name", label: "Company", icon: Building2 },
  { key: "activities", label: "Business Activities", icon: Puzzle },
  { key: "location", label: "Location & Contact", icon: MapPin },
  { key: "team", label: "Invite Team", icon: UserPlus },
  { key: "finish", label: "Finish", icon: Rocket },
] as const;

const TIMEZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles"];

export default function CreateCompanyPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [profiles, setProfiles] = useState<BusinessProfileKey[]>([]);
  const [locName, setLocName] = useState("");
  const [icao, setIcao] = useState("");
  const [timeZone, setTimeZone] = useState("America/New_York");
  const [phone, setPhone] = useState("");
  const [emails, setEmails] = useState<string[]>([""]);

  const modules = useMemo(() => {
    const set = new Set<string>();
    for (const p of profiles) for (const m of BUSINESS_PROFILES[p].modules) set.add(m);
    return [...set];
  }, [profiles]);

  const canNext =
    step === 0 ? name.trim().length >= 2 :
    step === 1 ? profiles.length >= 1 :
    step === 2 ? locName.trim().length >= 2 :
    true;

  function toggleProfile(key: BusinessProfileKey) {
    setProfiles((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          businessProfiles: profiles,
          location: { name: locName.trim(), icao: icao.trim().toUpperCase() || undefined },
          timeZone,
          phone: phone || undefined,
          inviteEmails: emails.map((e) => e.trim()).filter(Boolean),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Creation failed.");
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Creation failed.");
      setBusy(false);
    }
  }

  return (
    <div className="animate-fade-up">
      <Link href="/welcome" className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back
      </Link>
      <h1 className="text-xl font-semibold tracking-tight">Create your company or operator</h1>
      <p className="mt-0.5 text-sm text-muted-foreground">A few questions and your AeroOps workspace is live. You&apos;ll be the owner.</p>

      <div className="mt-5 flex flex-wrap items-center gap-1.5">
        {STEPS.map((s, i) => (
          <button
            key={s.key}
            onClick={() => i < step && setStep(i)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium",
              i === step ? "bg-accent text-accent-foreground" : i < step ? "cursor-pointer text-foreground hover:bg-muted" : "text-muted-foreground/50",
            )}
          >
            {i < step ? <Check className="h-3.5 w-3.5 text-success" /> : <s.icon className="h-3.5 w-3.5" />}
            {s.label}
            {i < STEPS.length - 1 && <span className="ml-1 text-muted-foreground/30">›</span>}
          </button>
        ))}
      </div>

      <Card className="mt-4">
        <CardContent className="p-6">
          {step === 0 && (
            <div className="max-w-md space-y-1.5">
              <Label htmlFor="org-name">Company / operator name</Label>
              <Input id="org-name" placeholder="e.g. Blue Ridge Flying Club" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              <p className="text-[11px] text-muted-foreground">This is how your organization appears to members and on invoices.</p>
            </div>
          )}

          {step === 1 && (
            <div>
              <p className="text-xs text-muted-foreground">Select everything you do — AeroOps enables the right modules automatically. You can change this later.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {(Object.entries(BUSINESS_PROFILES) as [BusinessProfileKey, (typeof BUSINESS_PROFILES)[BusinessProfileKey]][]).map(([key, p]) => (
                  <button
                    key={key}
                    onClick={() => toggleProfile(key)}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-left text-sm transition-colors",
                      profiles.includes(key) ? "border-primary bg-primary/10 font-medium" : "border-border hover:border-primary/40",
                    )}
                  >
                    <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border", profiles.includes(key) ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                      {profiles.includes(key) && <Check className="h-3 w-3" />}
                    </span>
                    {p.label}
                  </button>
                ))}
              </div>
              {modules.length > 0 && (
                <p className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  Modules that will be enabled:
                  {modules.map((m) => <Badge key={m} tone="blue">{m}</Badge>)}
                </p>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="grid max-w-lg gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Primary airport / location</Label>
                <Input placeholder="e.g. Raleigh Executive Jetport" value={locName} onChange={(e) => setLocName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>ICAO <span className="text-muted-foreground/60">(optional)</span></Label>
                <Input placeholder="KTTA" value={icao} onChange={(e) => setIcao(e.target.value.toUpperCase())} maxLength={5} />
              </div>
              <div className="space-y-1.5">
                <Label>Time zone</Label>
                <Select value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
                  {TIMEZONES.map((tz) => <option key={tz}>{tz}</option>)}
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Business phone <span className="text-muted-foreground/60">(optional)</span></Label>
                <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="max-w-md space-y-2">
              <p className="text-xs text-muted-foreground">Invite teammates by email (optional). They&apos;ll receive an invitation to join your organization — you can also do this later in Settings.</p>
              {emails.map((e, i) => (
                <Input key={i} type="email" placeholder="teammate@example.com" value={e} onChange={(ev) => setEmails(emails.map((x, j) => (j === i ? ev.target.value : x)))} />
              ))}
              <div className="flex gap-2">
                {emails.length < 10 && <Button variant="outline" size="sm" onClick={() => setEmails([...emails, ""])}>Add another</Button>}
                {emails.length > 1 && <Button variant="ghost" size="sm" onClick={() => setEmails(emails.slice(0, -1))}>Remove last</Button>}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="max-w-md space-y-2 text-sm">
              {[
                ["Company", name],
                ["Activities", profiles.map((p) => BUSINESS_PROFILES[p].label).join(", ")],
                ["Location", `${locName}${icao ? ` (${icao})` : ""}`],
                ["Time zone", timeZone],
                ["Invitations", emails.filter((e) => e.trim()).length ? `${emails.filter((e) => e.trim()).length} teammate(s)` : "None"],
                ["Plan", "Starter (change any time)"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-border py-1.5 last:border-0">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="text-right font-medium">{v}</span>
                </div>
              ))}
              {error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">{error}</p>}
            </div>
          )}

          <div className="mt-6 flex justify-between">
            <Button variant="ghost" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0 || busy}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={() => setStep(step + 1)} disabled={!canNext}>
                Continue <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={create} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />} Create organization
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
