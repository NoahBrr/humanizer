"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { TIME_ZONES } from "@/lib/timezones";
import { apiErrorMessage } from "@/lib/utils";

type Org = { name: string; slug: string; brandColor: string; timeZone: string };

/** Editable org identity — name, brand color, time zone. Slug is locked. */
export function BrandingForm({ org }: { org: Org }) {
  const router = useRouter();
  const [name, setName] = useState(org.name);
  const [brandColor, setBrandColor] = useState(org.brandColor);
  const [timeZone, setTimeZone] = useState(org.timeZone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const hexValid = /^#[0-9a-fA-F]{6}$/.test(brandColor);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await fetch("/api/organization/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), brandColor, timeZone }),
    });
    setBusy(false);
    if (res.ok) {
      setSaved(true);
      router.refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      setError(apiErrorMessage(j.error, "Could not save your changes. Please review the fields and try again."));
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="brand-name">School name</Label>
        <Input
          id="brand-name"
          value={name}
          onChange={(e) => { setName(e.target.value); setSaved(false); }}
          maxLength={120}
          placeholder="Blue Ridge Flight Academy"
          required
        />
      </div>

      <div className="space-y-1">
        <Label>Brand color</Label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label="Brand color picker"
            value={hexValid ? brandColor : "#2563eb"}
            onChange={(e) => { setBrandColor(e.target.value); setSaved(false); }}
            className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-input bg-card p-1"
          />
          <Input
            aria-label="Brand color hex"
            value={brandColor}
            onChange={(e) => { setBrandColor(e.target.value); setSaved(false); }}
            placeholder="#2563eb"
            spellCheck={false}
            className="font-mono"
          />
        </div>
        {!hexValid && <p className="text-[11px] text-muted-foreground">Enter a 6-digit hex value like #2563eb.</p>}
      </div>

      <div className="space-y-1">
        <Label htmlFor="brand-tz">Time zone</Label>
        <Select id="brand-tz" value={timeZone} onChange={(e) => { setTimeZone(e.target.value); setSaved(false); }}>
          {TIME_ZONES.map((tz) => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="flex items-center gap-1"><Lock className="h-3 w-3" /> Workspace slug</Label>
        <Input value={org.slug} readOnly disabled className="cursor-not-allowed font-mono" />
        <p className="text-[11px] text-muted-foreground">
          Workspace slug is locked — it&apos;s part of your sign-in URL and shared links. Contact support to change it.
        </p>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" disabled={busy || !hexValid || name.trim().length === 0}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save changes
        </Button>
        {saved && <span className="flex items-center gap-1 text-xs font-medium text-success"><Check className="h-3.5 w-3.5" /> Saved</span>}
      </div>
      {error && <p className="text-xs font-medium text-destructive">{error}</p>}
    </form>
  );
}
