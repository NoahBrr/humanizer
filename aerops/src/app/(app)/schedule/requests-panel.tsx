"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, ListPlus, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";

export type RequestRow = {
  id: string; student: string; preferredStart: string; durationMin: number;
  lessonType: string | null; instructor: string | null; notes: string | null; status: string;
};

/** Staff view: review pending lesson requests. */
export function RequestsPanel({ requests, canReview }: { requests: RequestRow[]; canReview: boolean }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function review(id: string, status: string) {
    setBusyId(id);
    await fetch("/api/lesson-requests", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    setBusyId(null);
    router.refresh();
  }

  if (requests.length === 0) return null;

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5"><CalendarClock className="h-4 w-4" /> Lesson Requests</CardTitle>
        <CardDescription>Student-submitted requests awaiting review. Approve, then book the slot on the timeline above.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {requests.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold">{r.student} <span className="font-normal text-muted-foreground">wants {formatDateTime(r.preferredStart)} · {r.durationMin} min</span></p>
              <p className="text-[11px] text-muted-foreground">
                {r.lessonType ?? "Any lesson"}{r.instructor ? ` · prefers ${r.instructor}` : ""}{r.notes ? ` · “${r.notes}”` : ""}
              </p>
            </div>
            <StatusBadge status={r.status} />
            {canReview && r.status === "PENDING" && (
              <div className="flex gap-1.5">
                <Button size="sm" variant="success" className="h-7 px-2 text-[11px]" disabled={busyId === r.id} onClick={() => review(r.id, "APPROVED")}>Approve</Button>
                <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={busyId === r.id} onClick={() => review(r.id, "NEEDS_CHANGES")}>Needs changes</Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-destructive" disabled={busyId === r.id} onClick={() => review(r.id, "REJECTED")}>Reject</Button>
              </div>
            )}
            {canReview && r.status === "APPROVED" && (
              <Button size="sm" className="h-7 px-2 text-[11px]" disabled={busyId === r.id} onClick={() => review(r.id, "SCHEDULED")}>Mark scheduled</Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Student view: request a lesson or join a day's waitlist. */
export function StudentRequestForm({ lessonTypes, instructors }: { lessonTypes: { id: string; name: string }[]; instructors: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<null | "request" | "waitlist">(null);
  const [when, setWhen] = useState("");
  const [duration, setDuration] = useState("120");
  const [lessonTypeId, setLessonTypeId] = useState("");
  const [instructorId, setInstructorId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setMsg(null);
    const url = open === "request" ? "/api/lesson-requests" : "/api/waitlist";
    const body = open === "request"
      ? { preferredStart: new Date(when).toISOString(), durationMin: Number(duration), lessonTypeId: lessonTypeId || null, instructorId: instructorId || null, notes: notes || null }
      : { date: new Date(when).toISOString(), notes: notes || null };
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (res.ok) {
      setMsg(open === "request" ? "Request sent — dispatch will review it shortly." : "You're on the waitlist. We'll notify you if a slot opens.");
      setOpen(null);
      router.refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      setMsg(typeof j.error === "string" ? j.error : "Something went wrong.");
    }
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5"><ListPlus className="h-4 w-4" /> Need a lesson?</CardTitle>
        <CardDescription>Request a specific time, or join a day&apos;s waitlist to grab cancellations.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!open && (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setOpen("request")}>Request a lesson</Button>
            <Button size="sm" variant="outline" onClick={() => setOpen("waitlist")}>Join a waitlist</Button>
          </div>
        )}
        {open && (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            <div className="space-y-1">
              <Label>{open === "request" ? "Preferred time" : "Day"}</Label>
              <Input type={open === "request" ? "datetime-local" : "date"} value={when} onChange={(e) => setWhen(e.target.value)} />
            </div>
            {open === "request" && (
              <>
                <div className="space-y-1">
                  <Label>Duration (min)</Label>
                  <Input type="number" min={30} step={30} value={duration} onChange={(e) => setDuration(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Lesson type</Label>
                  <Select value={lessonTypeId} onChange={(e) => setLessonTypeId(e.target.value)}>
                    <option value="">Any</option>
                    {lessonTypes.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Preferred instructor</Label>
                  <Select value={instructorId} onChange={(e) => setInstructorId(e.target.value)}>
                    <option value="">Any</option>
                    {instructors.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </Select>
                </div>
              </>
            )}
            <div className="space-y-1 md:col-span-3">
              <Label>Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-9" placeholder="Anything dispatch should know…" />
            </div>
            <div className="flex items-end gap-2">
              <Button size="sm" disabled={busy || !when} onClick={submit}>{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Submit</Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>Cancel</Button>
            </div>
          </div>
        )}
        {msg && <p className="text-xs font-medium text-muted-foreground">{msg}</p>}
      </CardContent>
    </Card>
  );
}
