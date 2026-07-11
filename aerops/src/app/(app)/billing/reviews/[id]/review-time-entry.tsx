"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { apiErrorMessage } from "@/lib/utils";

export type TimeEntryRow = {
  id: string;
  category: string;
  categoryLabel: string;
  customLabel: string | null;
  hours: number;
  billToCustomer: boolean;
  compensable: boolean;
  notes: string | null;
};

const CATEGORIES: { value: string; label: string }[] = [
  { value: "FLIGHT_INSTRUCTION", label: "Flight instruction" },
  { value: "GROUND_INSTRUCTION", label: "Ground instruction" },
  { value: "PREFLIGHT_BRIEFING", label: "Pre-flight briefing" },
  { value: "POSTFLIGHT_DEBRIEFING", label: "Post-flight debriefing" },
  { value: "SIMULATOR_INSTRUCTION", label: "Simulator instruction" },
  { value: "ORAL_PREPARATION", label: "Oral preparation" },
  { value: "CHECKRIDE_PREPARATION", label: "Checkride preparation" },
  { value: "STAGE_CHECK", label: "Stage check" },
  { value: "GROUND_SCHOOL", label: "Ground school" },
  { value: "ADMINISTRATIVE", label: "Administrative" },
  { value: "CUSTOM", label: "Custom" },
];

export function ReviewTimeEntry({ reviewId, entries }: { reviewId: string; entries: TimeEntryRow[] }) {
  const router = useRouter();
  const [category, setCategory] = useState("FLIGHT_INSTRUCTION");
  const [customLabel, setCustomLabel] = useState("");
  const [hours, setHours] = useState("1.0");
  const [billToCustomer, setBillToCustomer] = useState(true);
  const [compensable, setCompensable] = useState(true);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hoursNum = Number(hours);
  const valid = hoursNum > 0 && (category !== "CUSTOM" || customLabel.trim().length > 0);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/revenue/reviews/${reviewId}/time`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          customLabel: category === "CUSTOM" ? customLabel.trim() : null,
          hours: hoursNum,
          billToCustomer,
          compensable,
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(apiErrorMessage(j?.error, "Could not add the time entry. Please try again."));
      } else {
        setCustomLabel("");
        setHours("1.0");
        setNotes("");
        router.refresh();
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(entryId: string) {
    setRemovingId(entryId);
    setError(null);
    try {
      const res = await fetch(`/api/revenue/reviews/${reviewId}/time?entryId=${encodeURIComponent(entryId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(apiErrorMessage(j?.error, "Could not remove the entry. Please try again."));
      } else {
        router.refresh();
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          No instructor time recorded yet. Add the time you taught below.
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold">
                  {e.category === "CUSTOM" && e.customLabel ? e.customLabel : e.categoryLabel}
                  <span className="ml-2 font-normal tabular-nums text-muted-foreground">{e.hours.toFixed(1)} hrs</span>
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge tone={e.billToCustomer ? "blue" : "gray"}>{e.billToCustomer ? "Billed to customer" : "Not billed"}</Badge>
                  <Badge tone={e.compensable ? "green" : "gray"}>{e.compensable ? "Compensable" : "Non-compensable"}</Badge>
                </div>
                {e.notes && <p className="mt-1 text-[11px] text-muted-foreground">{e.notes}</p>}
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                disabled={removingId === e.id}
                onClick={() => remove(e.id)}
                aria-label="Remove entry"
              >
                {removingId === e.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2.5 border-t border-border pt-4">
        <p className="flex items-center gap-1.5 text-xs font-semibold"><Clock className="h-3.5 w-3.5 text-muted-foreground" /> Add instructor time</p>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Category</Label>
            <Select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 text-sm">
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Hours</Label>
            <Input type="number" step="0.1" min="0" value={hours} onChange={(e) => setHours(e.target.value)} className="h-9" />
          </div>
        </div>
        {category === "CUSTOM" && (
          <div className="space-y-1">
            <Label>Custom label</Label>
            <Input value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} placeholder="Describe the activity" className="h-9" />
          </div>
        )}
        <div className="flex flex-wrap gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <input type="checkbox" checked={billToCustomer} onChange={(e) => setBillToCustomer(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--color-primary)]" />
            Bill to customer
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <input type="checkbox" checked={compensable} onChange={(e) => setCompensable(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--color-primary)]" />
            Compensable
          </label>
        </div>
        <div className="space-y-1">
          <Label>Notes (optional)</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything worth noting for approval" className="min-h-16 text-sm" />
        </div>
        {error && <p className="text-xs font-medium text-destructive">{error}</p>}
        <Button size="sm" disabled={!valid || busy} onClick={add}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add time entry
        </Button>
      </div>
    </div>
  );
}
