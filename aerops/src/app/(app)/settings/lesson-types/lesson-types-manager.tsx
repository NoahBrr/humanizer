"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, GraduationCap, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/misc";
import { apiErrorMessage } from "@/lib/utils";

type LessonType = {
  id: string;
  name: string;
  color: string;
  durationMin: number;
  requiresAircraft: boolean;
  requiresInstructor: boolean;
};

const SAVE_FALLBACK = "Could not save this lesson type. Please review the fields and try again.";
const DEFAULT_COLOR = "#2563eb";

export function LessonTypesManager({ lessonTypes }: { lessonTypes: LessonType[] }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5"><GraduationCap className="h-4 w-4" /> Your Lesson Types</CardTitle>
          <CardDescription>These populate the scheduler. Duration is 15–480 minutes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {lessonTypes.length === 0 ? (
            <EmptyState
              icon={<GraduationCap className="h-6 w-6" />}
              title="No lesson types yet"
              description="Create your first lesson type so instructors and students can book structured training sessions."
            />
          ) : (
            lessonTypes.map((lt) => <LessonTypeRow key={lt.id} lessonType={lt} />)
          )}
        </CardContent>
      </Card>
      <AddLessonType />
    </div>
  );
}

function LessonTypeRow({ lessonType }: { lessonType: LessonType }) {
  const router = useRouter();
  const [name, setName] = useState(lessonType.name);
  const [color, setColor] = useState(lessonType.color);
  const [durationMin, setDurationMin] = useState(String(lessonType.durationMin));
  const [requiresAircraft, setRequiresAircraft] = useState(lessonType.requiresAircraft);
  const [requiresInstructor, setRequiresInstructor] = useState(lessonType.requiresInstructor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const hexValid = /^#[0-9a-fA-F]{6}$/.test(color);
  const durationNum = Number(durationMin);
  const durationValid = Number.isInteger(durationNum) && durationNum >= 15 && durationNum <= 480;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await fetch("/api/organization/lesson-types", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: lessonType.id, name: name.trim(), color, durationMin: durationNum, requiresAircraft, requiresInstructor }),
    });
    setBusy(false);
    if (res.ok) {
      setSaved(true);
      router.refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      setError(apiErrorMessage(j.error, SAVE_FALLBACK));
    }
  }

  return (
    <form onSubmit={save} className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex items-end gap-2">
          <span className="mb-1 h-6 w-6 shrink-0 rounded" style={{ background: hexValid ? color : undefined }} />
          <div className="w-24 space-y-1">
            <Label>Color</Label>
            <input
              type="color"
              aria-label="Lesson color picker"
              value={hexValid ? color : DEFAULT_COLOR}
              onChange={(e) => { setColor(e.target.value); setSaved(false); }}
              className="h-9 w-full cursor-pointer rounded-lg border border-input bg-card p-1"
            />
          </div>
        </div>
        <div className="min-w-40 flex-1 space-y-1">
          <Label>Name</Label>
          <Input value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} maxLength={120} required />
        </div>
        <div className="w-28 space-y-1">
          <Label>Duration (min)</Label>
          <Input type="number" min={15} max={480} value={durationMin} onChange={(e) => { setDurationMin(e.target.value); setSaved(false); }} required />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            <input type="checkbox" checked={requiresAircraft} onChange={(e) => { setRequiresAircraft(e.target.checked); setSaved(false); }} className="h-3.5 w-3.5 accent-[var(--color-primary)]" />
            Requires aircraft
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            <input type="checkbox" checked={requiresInstructor} onChange={(e) => { setRequiresInstructor(e.target.checked); setSaved(false); }} className="h-3.5 w-3.5 accent-[var(--color-primary)]" />
            Requires instructor
          </label>
        </div>
        <div className="flex items-center gap-3">
          {saved && <span className="flex items-center gap-1 text-xs font-medium text-success"><Check className="h-3.5 w-3.5" /> Saved</span>}
          <Button type="submit" size="sm" variant="outline" disabled={busy || name.trim().length === 0 || !hexValid || !durationValid}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
          </Button>
        </div>
      </div>
      {!durationValid && <p className="text-[11px] text-muted-foreground">Duration must be a whole number between 15 and 480 minutes.</p>}
      {error && <p className="text-xs font-medium text-destructive">{error}</p>}
    </form>
  );
}

function AddLessonType() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [durationMin, setDurationMin] = useState("120");
  const [requiresAircraft, setRequiresAircraft] = useState(true);
  const [requiresInstructor, setRequiresInstructor] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hexValid = /^#[0-9a-fA-F]{6}$/.test(color);
  const durationNum = Number(durationMin);
  const durationValid = Number.isInteger(durationNum) && durationNum >= 15 && durationNum <= 480;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/organization/lesson-types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), color, durationMin: durationNum, requiresAircraft, requiresInstructor }),
    });
    setBusy(false);
    if (res.ok) {
      setName("");
      setColor(DEFAULT_COLOR);
      setDurationMin("120");
      setRequiresAircraft(true);
      setRequiresInstructor(true);
      router.refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      setError(apiErrorMessage(j.error, SAVE_FALLBACK));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5"><Plus className="h-4 w-4" /> Add lesson type</CardTitle>
        <CardDescription>Pick a schedule color and a default duration; toggle the resources a booking must reserve.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <div className="w-24 space-y-1">
            <Label>Color</Label>
            <input
              type="color"
              aria-label="Lesson color picker"
              value={hexValid ? color : DEFAULT_COLOR}
              onChange={(e) => setColor(e.target.value)}
              className="h-9 w-full cursor-pointer rounded-lg border border-input bg-card p-1"
            />
          </div>
          <div className="min-w-40 flex-1 space-y-1">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Dual Instruction" required />
          </div>
          <div className="w-28 space-y-1">
            <Label>Duration (min)</Label>
            <Input type="number" min={15} max={480} value={durationMin} onChange={(e) => setDurationMin(e.target.value)} required />
          </div>
          <Button type="submit" disabled={busy || name.trim().length === 0 || !hexValid || !durationValid}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
          </Button>
        </form>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            <input type="checkbox" checked={requiresAircraft} onChange={(e) => setRequiresAircraft(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--color-primary)]" />
            Requires aircraft
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            <input type="checkbox" checked={requiresInstructor} onChange={(e) => setRequiresInstructor(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--color-primary)]" />
            Requires instructor
          </label>
        </div>
        {error && <p className="text-xs font-medium text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
