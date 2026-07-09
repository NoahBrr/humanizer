"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";

const ORG_TYPES = [
  "Flight school", "Flying club", "Aircraft rental", "FBO", "Maintenance shop",
  "Corporate flight department", "University program", "Aircraft management", "Charter operator", "Other",
];
const FLEET_SIZES = ["1–2", "3–5", "6–15", "16–50", "50+"];

/** Shared demo/contact intake form posting to /api/demo-requests. */
export function LeadForm({ kind }: { kind: "demo" | "contact" }) {
  const [form, setForm] = useState({ name: "", email: "", company: "", phone: "", orgType: ORG_TYPES[0], fleetSize: FLEET_SIZES[1], message: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/demo-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, ...form, company: form.company || undefined, phone: form.phone || undefined, message: form.message || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Something went wrong — try again.");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
        <p className="mt-3 text-sm font-semibold">{kind === "demo" ? "Demo request received" : "Message received"}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {kind === "demo"
            ? "We'll reach out shortly to schedule a walkthrough with your kind of operation loaded in."
            : "Thanks for getting in touch — we'll reply to your email soon."}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="lf-name">Name</Label>
          <Input id="lf-name" value={form.name} onChange={set("name")} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lf-email">Work email</Label>
          <Input id="lf-email" type="email" value={form.email} onChange={set("email")} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lf-company">Company / operation</Label>
          <Input id="lf-company" value={form.company} onChange={set("company")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lf-phone">Phone <span className="text-muted-foreground/60">(optional)</span></Label>
          <Input id="lf-phone" type="tel" value={form.phone} onChange={set("phone")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lf-type">Organization type</Label>
          <Select id="lf-type" value={form.orgType} onChange={set("orgType")}>
            {ORG_TYPES.map((t) => <option key={t}>{t}</option>)}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lf-fleet">Fleet size</Label>
          <Select id="lf-fleet" value={form.fleetSize} onChange={set("fleetSize")}>
            {FLEET_SIZES.map((t) => <option key={t}>{t} aircraft</option>)}
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="lf-message">{kind === "demo" ? "Anything specific you want to see?" : "How can we help?"}</Label>
        <Textarea id="lf-message" value={form.message} onChange={set("message")} />
      </div>
      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {kind === "demo" ? "Request a Demo" : "Send message"}
      </Button>
    </form>
  );
}
