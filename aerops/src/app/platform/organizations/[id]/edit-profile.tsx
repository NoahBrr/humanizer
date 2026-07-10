"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";

const ORG_TYPES: [string, string][] = [
  ["PART_61_FLIGHT_SCHOOL", "Part 61 Flight School"],
  ["PART_141_FLIGHT_SCHOOL", "Part 141 Flight School"],
  ["FLYING_CLUB", "Flying Club"],
  ["UNIVERSITY_PROGRAM", "University Aviation Program"],
  ["CORPORATE_FLIGHT_DEPT", "Corporate Flight Department"],
  ["MAINTENANCE_ORG", "Maintenance Organization"],
  ["OTHER", "Other"],
];

export type OrgProfile = {
  name: string;
  legalName: string;
  orgType: string;
  description: string;
  website: string;
  phone: string;
  billingEmail: string;
  primaryContactName: string;
  primaryContactEmail: string;
  address: string;
  timeZone: string;
  brandColor: string;
  isDiscoverable: boolean;
};

/**
 * Explicit edit mode for an organization's safe profile fields (Part 4). Only
 * changed fields are sent; the API authorizes each field and writes a
 * before/after audit record. Ownership, pricing, capacity, and lifecycle are NOT
 * here — they route through their own permissioned workflows.
 */
export function EditProfile({ orgId, initial, canBranding }: { orgId: string; initial: OrgProfile; canBranding: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof OrgProfile>(k: K, v: OrgProfile[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setBusy(true);
    setError(null);
    // Send only changed fields (empty strings clear optional text fields).
    const payload: Record<string, unknown> = {};
    (Object.keys(form) as (keyof OrgProfile)[]).forEach((k) => {
      if (form[k] !== initial[k]) payload[k] = form[k];
    });
    if (Object.keys(payload).length === 0) {
      setBusy(false);
      setOpen(false);
      return;
    }
    const res = await fetch(`/api/platform/organizations/${orgId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(typeof j.error === "string" ? j.error : "Could not save changes.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => { setForm(initial); setOpen(true); }}>
        <Pencil className="h-3.5 w-3.5" /> Edit profile
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Edit organization profile</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}><X className="h-4 w-4" /></Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Display name</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Legal name</Label>
            <Input value={form.legalName} onChange={(e) => set("legalName", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Organization type</Label>
            <Select value={form.orgType} onChange={(e) => set("orgType", e.target.value)}>
              {ORG_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Time zone</Label>
            <Input value={form.timeZone} onChange={(e) => set("timeZone", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Website</Label>
            <Input value={form.website} onChange={(e) => set("website", e.target.value)} placeholder="https://…" />
          </div>
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Billing email</Label>
            <Input value={form.billingEmail} onChange={(e) => set("billingEmail", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Primary contact</Label>
            <Input value={form.primaryContactName} onChange={(e) => set("primaryContactName", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Primary contact email</Label>
            <Input value={form.primaryContactEmail} onChange={(e) => set("primaryContactEmail", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Address</Label>
            <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
          </div>
          {canBranding && (
            <div className="space-y-1.5">
              <Label>Brand color</Label>
              <div className="flex items-center gap-2">
                <input type="color" value={form.brandColor} onChange={(e) => set("brandColor", e.target.value)} className="h-9 w-10 cursor-pointer rounded-md border border-input" aria-label="Brand color" />
                <Input value={form.brandColor} onChange={(e) => set("brandColor", e.target.value)} className="font-mono" />
              </div>
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <Label>Description</Label>
          <textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={form.isDiscoverable} onChange={(e) => set("isDiscoverable", e.target.checked)} className="h-4 w-4 rounded border-input" />
          Discoverable in public organization search
        </label>
        {error && <p className="text-xs font-medium text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={busy}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save changes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
