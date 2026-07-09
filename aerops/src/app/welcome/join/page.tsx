"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building2, CheckCircle2, Loader2, Search, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Find-and-join flow for individual accounts: search the organization
 * directory (name / airport / city / org code), then file a join request an
 * admin reviews. Invitation links skip straight to /join/<token>.
 */

type OrgResult = {
  id: string; name: string; code: string; brandColor: string;
  businessProfiles: string[]; locations: { name: string; icao: string | null }[];
  members: number; aircraft: number;
};

const ROLES = [
  ["STUDENT", "Student"], ["INSTRUCTOR", "Instructor"], ["DISPATCHER", "Dispatcher"],
  ["MAINTENANCE", "Maintenance"], ["ACCOUNTANT", "Accountant"], ["SCHOOL_ADMIN", "Owner / Admin"],
] as const;

export default function JoinCompanyPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<OrgResult[] | null>(null);
  const [selected, setSelected] = useState<OrgResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const [role, setRole] = useState("STUDENT");
  const [phone, setPhone] = useState("");
  const [cert, setCert] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");

  // Debounced directory search.
  useEffect(() => {
    if (q.trim().length < 2) { setResults(null); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/orgs/search?q=${encodeURIComponent(q.trim())}`);
        const data = await res.json();
        setResults(res.ok ? data.results : []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  async function submit() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/join-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: selected.id,
          requestedRole: role,
          phone: phone || undefined,
          certificateInfo: cert || undefined,
          reason: reason || undefined,
          message: message || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Request failed.");
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  if (sent && selected) {
    return (
      <div className="mx-auto max-w-md animate-fade-up pt-10 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
        <h1 className="mt-4 text-xl font-semibold tracking-tight">Request sent to {selected.name}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          An administrator will review your request. You&apos;ll get access automatically once approved — track the status on your welcome page.
        </p>
        <Button className="mt-6" onClick={() => router.push("/welcome")}>Back to welcome</Button>
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <Link href="/welcome" className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back
      </Link>
      <h1 className="text-xl font-semibold tracking-tight">Join a company or operator</h1>
      <p className="mt-0.5 text-sm text-muted-foreground">
        Search by company name, airport (e.g. KPAO), city, or organization code. Have an invite link? Just open it.
      </p>

      <div className="relative mt-5 max-w-lg">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="e.g. Golden Gate, KPAO, Palo Alto…" value={q} onChange={(e) => { setQ(e.target.value); setSelected(null); }} autoFocus />
        {searching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
      </div>

      {results && !selected && (
        <div className="mt-3 max-w-lg space-y-2">
          {results.length === 0 && (
            <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-xs text-muted-foreground">
              No organizations matched “{q}”. Check the spelling, try the airport code, or ask your organization for an invite link.
            </p>
          )}
          {results.map((o) => (
            <button
              key={o.id}
              onClick={() => setSelected(o)}
              className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border bg-card p-3.5 text-left transition-colors hover:border-primary/50"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ backgroundColor: o.brandColor }}>
                {o.name.slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{o.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {o.locations.map((l) => l.icao ?? l.name).join(" · ") || "—"} · {o.members} members · {o.aircraft} aircraft
                </span>
              </span>
              <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}

      {selected && (
        <Card className={cn("mt-4 max-w-lg")}>
          <CardContent className="space-y-3 p-5">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ backgroundColor: selected.brandColor }}>
                {selected.name.slice(0, 2).toUpperCase()}
              </span>
              <p className="text-sm font-semibold">Request to join {selected.name}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Requested role</Label>
                <Select value={role} onChange={(e) => setRole(e.target.value)}>
                  {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Phone <span className="text-muted-foreground/60">(optional)</span></Label>
                <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Pilot certificate / student status <span className="text-muted-foreground/60">(optional)</span></Label>
              <Input placeholder="e.g. Student pilot, PPL ASEL, CFI/CFII…" value={cert} onChange={(e) => setCert(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Why are you joining?</Label>
              <Input placeholder="e.g. Starting private pilot training this fall" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Message to the admin <span className="text-muted-foreground/60">(optional)</span></Label>
              <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Anything that helps them approve you faster." />
            </div>
            {error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">{error}</p>}
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setSelected(null)} disabled={busy}>Back to results</Button>
              <Button onClick={submit} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send request
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
