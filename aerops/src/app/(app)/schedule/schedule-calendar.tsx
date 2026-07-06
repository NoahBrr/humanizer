"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import resourceTimelinePlugin from "@fullcalendar/resource-timeline";
import type { EventClickArg, EventDropArg, DateSelectArg, EventInput } from "@fullcalendar/core";
import type { EventResizeDoneArg } from "@fullcalendar/interaction";
import { X, AlertTriangle, CalendarPlus, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/badge";
import { formatDateTime, formatTime } from "@/lib/utils";

type AircraftOpt = { id: string; tailNumber: string; model: string; status: string; isSimulator: boolean };
type PersonOpt = { id: string; name: string };
type LessonTypeOpt = { id: string; name: string; color: string; durationMin: number; requiresAircraft: boolean; requiresInstructor: boolean };

type ApiEvent = {
  id: string;
  start: string;
  end: string;
  type: string;
  status: string;
  notes: string | null;
  cancellationReason: string | null;
  aircraft: { id: string; tailNumber: string } | null;
  instructor: { id: string; user: { firstName: string; lastName: string } } | null;
  student: { id: string; user: { firstName: string; lastName: string } } | null;
  lessonType: { id: string; name: string; color: string } | null;
};

type Conflict = { kind: string; message: string };
type Suggestion = { start: string; end: string };

type Toast = { id: number; kind: "success" | "error"; message: string };

const INACTIVE = ["CANCELLED", "WEATHER_CANCELLED", "NO_SHOW"];

export function ScheduleCalendar({
  aircraft, instructors, students, lessonTypes, canEdit,
}: {
  aircraft: AircraftOpt[]; instructors: PersonOpt[]; students: PersonOpt[]; lessonTypes: LessonTypeOpt[]; canEdit: boolean;
}) {
  const calendarRef = useRef<FullCalendar>(null);
  const eventsCache = useRef<Map<string, ApiEvent>>(new Map());
  const [selected, setSelected] = useState<ApiEvent | null>(null);
  const [draft, setDraft] = useState<{ start: string; end: string } | null>(null);
  const [filterAircraft, setFilterAircraft] = useState("");
  const [filterInstructor, setFilterInstructor] = useState("");
  const [search, setSearch] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((kind: Toast["kind"], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  const refetch = useCallback(() => calendarRef.current?.getApi().refetchEvents(), []);

  const fetchEvents = useCallback(
    async (info: { startStr: string; endStr: string }, success: (events: EventInput[]) => void, failure: (e: Error) => void) => {
      try {
        const res = await fetch(`/api/schedule/events?start=${encodeURIComponent(info.startStr)}&end=${encodeURIComponent(info.endStr)}`);
        if (!res.ok) throw new Error("Failed to load events");
        const { events } = (await res.json()) as { events: ApiEvent[] };
        eventsCache.current = new Map(events.map((e) => [e.id, e]));

        const filtered = events.filter((e) => {
          if (filterAircraft && e.aircraft?.id !== filterAircraft) return false;
          if (filterInstructor && e.instructor?.id !== filterInstructor) return false;
          if (search) {
            const hay = [
              e.student ? `${e.student.user.firstName} ${e.student.user.lastName}` : "",
              e.instructor ? `${e.instructor.user.firstName} ${e.instructor.user.lastName}` : "",
              e.aircraft?.tailNumber ?? "",
              e.lessonType?.name ?? "",
            ].join(" ").toLowerCase();
            if (!hay.includes(search.toLowerCase())) return false;
          }
          return true;
        });

        success(
          filtered.map((e) => {
            const inactive = INACTIVE.includes(e.status);
            const who = e.student ? `${e.student.user.firstName} ${e.student.user.lastName[0]}.` : e.lessonType?.name ?? e.type;
            return {
              id: e.id,
              title: `${e.aircraft ? e.aircraft.tailNumber + " · " : ""}${who}`,
              start: e.start,
              end: e.end,
              resourceId: e.aircraft?.id,
              backgroundColor: inactive ? "#9ca3af" : e.lessonType?.color ?? "#2563eb",
              textColor: "#ffffff",
              editable: canEdit && !inactive && e.status === "SCHEDULED",
              classNames: inactive ? ["opacity-50", "line-through"] : [],
            };
          }),
        );
      } catch (e) {
        failure(e as Error);
      }
    },
    [filterAircraft, filterInstructor, search, canEdit],
  );

  async function moveEvent(id: string, start: Date, end: Date, revert: () => void) {
    const res = await fetch(`/api/schedule/events/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start: start.toISOString(), end: end.toISOString() }),
    });
    if (res.status === 409) {
      const { conflicts } = (await res.json()) as { conflicts: Conflict[] };
      toast("error", `Move blocked: ${conflicts[0]?.message ?? "conflict detected"}`);
      revert();
    } else if (!res.ok) {
      toast("error", "Could not update the booking.");
      revert();
    } else {
      toast("success", "Booking updated.");
      refetch();
    }
  }

  const onDrop = (arg: EventDropArg) => moveEvent(arg.event.id, arg.event.start!, arg.event.end!, arg.revert);
  const onResize = (arg: EventResizeDoneArg) => moveEvent(arg.event.id, arg.event.start!, arg.event.end!, arg.revert);
  const onSelect = (arg: DateSelectArg) => {
    if (!canEdit) return;
    setSelected(null);
    setDraft({ start: arg.start.toISOString(), end: arg.end.toISOString() });
  };
  const onEventClick = (arg: EventClickArg) => {
    setDraft(null);
    setSelected(eventsCache.current.get(arg.event.id) ?? null);
  };

  return (
    <div className="relative">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input placeholder="Search student, CFI, tail…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 w-56 text-xs" />
        <Select value={filterAircraft} onChange={(e) => setFilterAircraft(e.target.value)} className="h-8 w-40 text-xs">
          <option value="">All aircraft</option>
          {aircraft.map((a) => <option key={a.id} value={a.id}>{a.tailNumber}</option>)}
        </Select>
        <Select value={filterInstructor} onChange={(e) => setFilterInstructor(e.target.value)} className="h-8 w-44 text-xs">
          <option value="">All instructors</option>
          {instructors.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </Select>
        <Button variant="outline" size="sm" onClick={refetch}>Apply filters</Button>
        <div className="flex-1" />
        {canEdit && (
          <Button size="sm" onClick={() => { const s = new Date(); s.setHours(s.getHours() + 1, 0, 0, 0); const e = new Date(s.getTime() + 2 * 3600_000); setDraft({ start: s.toISOString(), end: e.toISOString() }); }}>
            <CalendarPlus className="h-3.5 w-3.5" /> Quick schedule
          </Button>
        )}
      </div>

      <div className="aerops-calendar rounded-xl border border-border bg-card p-3 shadow-sm">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, resourceTimelinePlugin]}
          schedulerLicenseKey="GPL-My-Project-Is-Open-Source"
          initialView="timeGridWeek"
          headerToolbar={{ left: "prev,next today", center: "title", right: "timeGridDay,timeGridWeek,dayGridMonth,resourceTimelineDay,listWeek" }}
          buttonText={{ today: "Today", day: "Day", week: "Week", month: "Month", list: "List", resourceTimelineDay: "Timeline" }}
          views={{ resourceTimelineDay: { slotMinTime: "06:00", slotMaxTime: "21:00" } }}
          resources={aircraft.map((a) => ({ id: a.id, title: `${a.tailNumber} · ${a.model}` }))}
          resourceAreaHeaderContent="Aircraft"
          resourceAreaWidth="180px"
          events={fetchEvents}
          selectable={canEdit}
          selectMirror
          editable={canEdit}
          select={onSelect}
          eventClick={onEventClick}
          eventDrop={onDrop}
          eventResize={onResize}
          slotMinTime="06:00"
          slotMaxTime="21:00"
          nowIndicator
          height="auto"
          expandRows
          dayMaxEventRows={4}
          stickyHeaderDates
        />
      </div>

      {draft && (
        <BookingPanel
          draft={draft}
          aircraft={aircraft}
          instructors={instructors}
          students={students}
          lessonTypes={lessonTypes}
          onClose={() => setDraft(null)}
          onBooked={() => { setDraft(null); refetch(); toast("success", "Booking created."); }}
        />
      )}

      {selected && (
        <DetailPanel
          event={selected}
          canEdit={canEdit}
          onClose={() => setSelected(null)}
          onChanged={(msg) => { setSelected(null); refetch(); toast("success", msg); }}
          onError={(msg) => toast("error", msg)}
        />
      )}

      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex animate-fade-up items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium shadow-lg ${
              t.kind === "success" ? "border-border bg-card" : "border-destructive/30 bg-card text-destructive"
            }`}
          >
            {t.kind === "success" ? <Check className="h-3.5 w-3.5 text-success" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function PanelShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full max-w-sm animate-fade-up border-l border-border bg-card shadow-2xl">
      <div className="flex h-14 items-center justify-between border-b border-border px-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>
      <div className="h-[calc(100vh-3.5rem)] space-y-4 overflow-y-auto p-4">{children}</div>
    </div>
  );
}

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function BookingPanel({
  draft, aircraft, instructors, students, lessonTypes, onClose, onBooked,
}: {
  draft: { start: string; end: string };
  aircraft: AircraftOpt[]; instructors: PersonOpt[]; students: PersonOpt[]; lessonTypes: LessonTypeOpt[];
  onClose: () => void; onBooked: () => void;
}) {
  const [start, setStart] = useState(toLocalInput(draft.start));
  const [end, setEnd] = useState(toLocalInput(draft.end));
  const [lessonTypeId, setLessonTypeId] = useState(lessonTypes[0]?.id ?? "");
  const [aircraftId, setAircraftId] = useState("");
  const [instructorId, setInstructorId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [notes, setNotes] = useState("");
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [saving, setSaving] = useState(false);

  const lt = useMemo(() => lessonTypes.find((l) => l.id === lessonTypeId), [lessonTypeId, lessonTypes]);
  const typeForLesson = (name?: string) =>
    name?.includes("Solo") ? "SOLO_FLIGHT" : name?.includes("Ground") ? "GROUND_LESSON" : name?.includes("Sim") ? "SIMULATOR" : name?.includes("Checkride") ? "CHECKRIDE" : "FLIGHT_LESSON";

  async function submit(force = false) {
    setSaving(true);
    setConflicts([]);
    const res = await fetch("/api/schedule/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        type: typeForLesson(lt?.name),
        aircraftId: aircraftId || null,
        instructorId: instructorId || null,
        studentId: studentId || null,
        lessonTypeId: lessonTypeId || null,
        notes: notes || null,
        force,
      }),
    });
    setSaving(false);
    if (res.status === 409) {
      const data = (await res.json()) as { conflicts: Conflict[]; suggestions: Suggestion[] };
      setConflicts(data.conflicts);
      setSuggestions(data.suggestions);
    } else if (res.ok) {
      onBooked();
    }
  }

  return (
    <PanelShell title="New booking" onClose={onClose}>
      <div className="space-y-1.5">
        <Label>Lesson type</Label>
        <Select value={lessonTypeId} onChange={(e) => setLessonTypeId(e.target.value)}>
          {lessonTypes.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label>Start</Label>
          <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>End</Label>
          <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Student</Label>
        <Select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
          <option value="">— none —</option>
          {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </div>
      {(lt?.requiresInstructor ?? true) && (
        <div className="space-y-1.5">
          <Label>Instructor</Label>
          <Select value={instructorId} onChange={(e) => setInstructorId(e.target.value)}>
            <option value="">— none —</option>
            {instructors.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </Select>
        </div>
      )}
      {(lt?.requiresAircraft ?? true) && (
        <div className="space-y-1.5">
          <Label>Aircraft</Label>
          <Select value={aircraftId} onChange={(e) => setAircraftId(e.target.value)}>
            <option value="">— none —</option>
            {aircraft.map((a) => (
              <option key={a.id} value={a.id} disabled={a.status !== "AVAILABLE"}>
                {a.tailNumber} · {a.model}{a.status !== "AVAILABLE" ? ` (${a.status.replaceAll("_", " ").toLowerCase()})` : ""}
              </option>
            ))}
          </Select>
        </div>
      )}
      <div className="space-y-1.5">
        <Label>Notes</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional briefing notes…" />
      </div>

      {conflicts.length > 0 && (
        <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" /> Conflicts detected
          </p>
          <ul className="space-y-1 text-xs text-destructive/90">
            {conflicts.map((c, i) => <li key={i}>• {c.message}</li>)}
          </ul>
          {suggestions.length > 0 && (
            <div className="pt-1">
              <p className="mb-1 text-[11px] font-medium text-muted-foreground">Suggested open slots:</p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => { setStart(toLocalInput(s.start)); setEnd(toLocalInput(s.end)); setConflicts([]); setSuggestions([]); }}
                    className="cursor-pointer rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium hover:border-primary/50"
                  >
                    {new Date(s.start).toLocaleDateString("en-US", { weekday: "short" })} {formatTime(s.start)}–{formatTime(s.end)}
                  </button>
                ))}
              </div>
            </div>
          )}
          <Button variant="destructive" size="sm" onClick={() => submit(true)} disabled={saving}>Book anyway (override)</Button>
        </div>
      )}

      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => submit(false)} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Create booking
        </Button>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
      </div>
    </PanelShell>
  );
}

function DetailPanel({
  event, canEdit, onClose, onChanged, onError,
}: {
  event: ApiEvent; canEdit: boolean; onClose: () => void; onChanged: (msg: string) => void; onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function setStatus(status: string, cancellationReason?: string) {
    setBusy(true);
    const res = await fetch(`/api/schedule/events/${event.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, cancellationReason }),
    });
    setBusy(false);
    if (res.ok) onChanged(status === "CANCELLED" ? "Booking cancelled." : status === "WEATHER_CANCELLED" ? "Weather cancellation recorded." : "Status updated.");
    else onError("Could not update status.");
  }

  const rows: [string, React.ReactNode][] = [
    ["Status", <StatusBadge key="s" status={event.status} />],
    ["When", `${formatDateTime(event.start)} → ${formatTime(event.end)}`],
    ["Lesson", event.lessonType?.name ?? event.type.replaceAll("_", " ")],
    ["Aircraft", event.aircraft?.tailNumber ?? "—"],
    ["Instructor", event.instructor ? `${event.instructor.user.firstName} ${event.instructor.user.lastName}` : "—"],
    ["Student", event.student ? `${event.student.user.firstName} ${event.student.user.lastName}` : "—"],
  ];

  return (
    <PanelShell title="Booking details" onClose={onClose}>
      <div className="space-y-2.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-4 text-sm">
            <span className="text-xs text-muted-foreground">{k}</span>
            <span className="text-right font-medium">{v}</span>
          </div>
        ))}
        {event.notes && <p className="rounded-lg bg-muted p-3 text-xs">{event.notes}</p>}
        {event.cancellationReason && <p className="rounded-lg bg-destructive/5 p-3 text-xs text-destructive">Cancelled: {event.cancellationReason}</p>}
      </div>

      {canEdit && !INACTIVE.includes(event.status) && event.status !== "COMPLETED" && (
        <div className="space-y-2 border-t border-border pt-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Actions</p>
          <div className="grid grid-cols-2 gap-2">
            {event.status === "SCHEDULED" && event.aircraft && (
              <a href="/dispatch" className="col-span-2">
                <Button className="w-full" variant="default">Go to dispatch</Button>
              </a>
            )}
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setStatus("WEATHER_CANCELLED", "Weather below minimums")}>Weather cancel</Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setStatus("NO_SHOW")}>No-show</Button>
            <Button variant="destructive" size="sm" className="col-span-2" disabled={busy} onClick={() => setStatus("CANCELLED", "Cancelled by staff")}>
              Cancel booking
            </Button>
          </div>
        </div>
      )}
    </PanelShell>
  );
}
