"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Plane, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";

/**
 * Public, embeddable discovery-flight request form (Section 11 website
 * forms). ?org=<slug> targets the organization; submissions create CRM leads.
 */
function RequestForm() {
  const org = useSearchParams().get("org") ?? "golden-gate";
  const [form, setForm] = useState({ name: "", email: "", phone: "", interest: "Discovery flight", notes: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ org, source: "website", ...form }),
    });
    setBusy(false);
    if (res.ok) setDone(true);
    else setError((await res.json().catch(() => ({}))).error ?? "Something went wrong — please call us instead.");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md animate-fade-up">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
            <Plane className="h-6 w-6 -rotate-45" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Take a discovery flight</h1>
            <p className="mt-1 text-sm text-muted-foreground">Tell us a little about you — we&apos;ll reach out within one business day.</p>
          </div>
        </div>
        {done ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center shadow-sm">
            <Check className="mx-auto h-8 w-8 text-success" />
            <p className="mt-2 text-sm font-semibold">Request received!</p>
            <p className="mt-1 text-xs text-muted-foreground">Our team will contact you shortly to pick a time and aircraft.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-card p-6 shadow-sm">
            <div className="space-y-1.5"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus /></div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
              <div className="space-y-1.5"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            </div>
            <div className="space-y-1.5"><Label>I&apos;m interested in</Label><Input value={form.interest} onChange={(e) => setForm({ ...form, interest: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Anything else?</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Goals, availability, questions…" /></div>
            {error && <p className="text-xs font-medium text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Request my flight</Button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function RequestFlightPage() {
  return <Suspense><RequestForm /></Suspense>;
}
