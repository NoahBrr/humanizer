import { redirect } from "next/navigation";
import Link from "next/link";
import { Gauge, Users, AlertTriangle, ClipboardCheck } from "lucide-react";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { computeReadiness } from "@/lib/readiness";
import { PageHeader, Avatar, Progress } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatDate, fullName, daysUntil } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Training Command Center" };

const TRAINING_PROFILES = ["part_61", "part_141", "university"];

export default async function TrainingCommandCenter() {
  const session = await getSession();
  if (!session!.permissions.has("students.manage")) redirect("/dashboard");
  if (session!.businessProfiles.length > 0 && !session!.businessProfiles.some((p) => TRAINING_PROFILES.includes(p))) {
    redirect("/dashboard"); // no training business profile → no training workspace
  }
  const organizationId = session!.organizationId;
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const weekStart = new Date(dayStart.getTime() - 7 * 86_400_000);

  const [todayEvents, students, instructors] = await Promise.all([
    db.scheduleEvent.findMany({
      where: { organizationId, start: { gte: dayStart, lt: dayEnd } },
      select: { status: true, studentId: true },
    }),
    db.student.findMany({
      where: { user: { organizationId, isActive: true } },
      include: {
        user: { select: { firstName: true, lastName: true } },
        assignedInstructor: { include: { user: { select: { firstName: true, lastName: true } } } },
        enrollments: { include: { syllabus: { include: { stages: { include: { lessons: true } } } } } },
        lessonRecords: { select: { grade: true, date: true, syllabusLessonId: true, flightHours: true, syllabusLesson: { select: { name: true } } } },
        endorsements: { select: { id: true } },
        checkrides: { select: { status: true, date: true, rating: true } },
      },
    }),
    db.instructor.findMany({
      where: { user: { organizationId, isActive: true } },
      include: {
        user: { select: { firstName: true, lastName: true } },
        students: { select: { id: true } },
        scheduleEvents: { where: { start: { gte: weekStart }, status: { notIn: ["CANCELLED", "NO_SHOW"] } }, select: { start: true, end: true, status: true } },
        dispatches: { where: { status: "CLOSED", closedAt: { gte: weekStart } }, select: { dualGiven: true, flightTime: true } },
      },
    }),
  ]);

  // --- Per-student readiness + pipeline buckets ------------------------------
  const rows = students.map((s) => {
    const enrollment = s.enrollments[0];
    const lessons = enrollment?.syllabus.stages.flatMap((st) => st.lessons) ?? [];
    const stageCheckStages = enrollment?.syllabus.stages.filter((st) => st.isStageCheck) ?? [];
    const done = new Set(s.lessonRecords.filter((r) => r.grade !== "INCOMPLETE" && r.syllabusLessonId).map((r) => r.syllabusLessonId));
    const readiness = computeReadiness({
      totalHours: Number(s.totalHours),
      requiredHours: Number(enrollment?.syllabus.requiredHours ?? 40),
      lessonsCompleted: lessons.filter((l) => done.has(l.id)).length,
      lessonsTotal: lessons.length,
      stageChecksPassed: stageCheckStages.filter((st) => st.lessons.some((l) => done.has(l.id))).length,
      stageChecksTotal: stageCheckStages.length,
      endorsementCount: s.endorsements.length,
      medicalValid: !!s.medicalExpiration && s.medicalExpiration > new Date(),
      writtenTestPassed: s.writtenTestPassed,
      checkrideScheduled: s.checkrides.some((c) => c.status === "SCHEDULED"),
      weakAreas: s.lessonRecords.filter((r) => r.grade === "NEEDS_IMPROVEMENT").map((r) => r.syllabusLesson?.name ?? "General"),
    });
    const lastLesson = s.lessonRecords.map((r) => r.date).sort((a, b) => b.getTime() - a.getTime())[0];
    const inactive = s.status === "ENROLLED" && (!lastLesson || Date.now() - lastLesson.getTime() > 21 * 86_400_000);
    const nearSolo = Number(s.soloHours) === 0 && Number(s.totalHours) >= 10 && s.status === "ENROLLED";
    return { s, readiness, inactive, nearSolo, lastLesson };
  });

  const pipeline = {
    discovery: students.filter((s) => ["LEAD", "DISCOVERY_FLIGHT", "PROSPECT"].includes(s.status)),
    nearSolo: rows.filter((r) => r.nearSolo),
    checkrideReady: rows.filter((r) => ["READY", "ALMOST_READY", "SCHEDULED"].includes(r.readiness.status) && r.s.status === "ENROLLED"),
    behind: rows.filter((r) => r.inactive),
  };

  const inFlight = todayEvents.filter((e) => e.status === "IN_FLIGHT").length;
  const completedToday = todayEvents.filter((e) => e.status === "COMPLETED").length;
  const cancelledToday = todayEvents.filter((e) => ["CANCELLED", "WEATHER_CANCELLED", "NO_SHOW"].includes(e.status)).length;
  const flyingToday = new Set(todayEvents.filter((e) => e.studentId).map((e) => e.studentId)).size;

  const metrics = [
    { label: "Today's lessons", value: String(todayEvents.length) },
    { label: "Students flying", value: String(flyingToday) },
    { label: "In flight now", value: String(inFlight) },
    { label: "Completed today", value: String(completedToday) },
    { label: "Cancelled today", value: String(cancelledToday), alert: cancelledToday > 2 },
    { label: "Checkride-ready", value: String(pipeline.checkrideReady.length) },
  ];

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader
        title="Training Command Center"
        description="The morning sixty-second view: pipeline health, checkride readiness, instructor workload and currency"
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {metrics.map((m) => (
          <Card key={m.label}>
            <CardContent className="p-4">
              <p className="text-[11px] text-muted-foreground">{m.label}</p>
              <p className={`mt-1 text-xl font-semibold ${m.alert ? "text-destructive" : ""}`}>{m.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5"><Users className="h-4 w-4" /> Training Pipeline</CardTitle>
          <CardDescription>Where every student stands, discovery to certificate</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-4">
          {[
            { title: "Discovery & prospects", tone: "blue" as const, items: pipeline.discovery.map((s) => ({ name: fullName(s.user), sub: s.discoveryOutcome ?? s.status.replaceAll("_", " ").toLowerCase() })) },
            { title: "Near solo", tone: "cyan" as const, items: pipeline.nearSolo.map((r) => ({ name: fullName(r.s.user), sub: `${Number(r.s.totalHours).toFixed(1)} hrs, no solo yet` })) },
            { title: "Checkride ready / almost", tone: "green" as const, items: pipeline.checkrideReady.map((r) => ({ name: fullName(r.s.user), sub: `score ${r.readiness.score} · ${r.readiness.status.replaceAll("_", " ").toLowerCase()}` })) },
            { title: "Falling behind (21d+ idle)", tone: "amber" as const, items: pipeline.behind.map((r) => ({ name: fullName(r.s.user), sub: r.lastLesson ? `last lesson ${formatDate(r.lastLesson)}` : "no lessons yet" })) },
          ].map((col) => (
            <div key={col.title} className="rounded-lg border border-border p-3">
              <p className="mb-2 flex items-center justify-between text-xs font-semibold">{col.title} <Badge tone={col.tone}>{col.items.length}</Badge></p>
              <div className="space-y-1.5">
                {col.items.length === 0 && <p className="text-[11px] text-muted-foreground">Nobody here right now.</p>}
                {col.items.slice(0, 5).map((i) => (
                  <div key={i.name}>
                    <p className="text-xs font-medium">{i.name}</p>
                    <p className="text-[11px] text-muted-foreground">{i.sub}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5"><Gauge className="h-4 w-4" /> Checkride Command Center</CardTitle>
            <CardDescription>Every enrolled student, ranked by readiness — click through for the factor breakdown</CardDescription>
          </CardHeader>
          <CardContent className="p-2">
            <Table>
              <THead><TR><TH>Student</TH><TH>CFI</TH><TH>Readiness</TH><TH>Status</TH><TH>Focus</TH></TR></THead>
              <TBody>
                {rows
                  .filter((r) => r.s.status === "ENROLLED")
                  .sort((a, b) => b.readiness.score - a.readiness.score)
                  .map((r) => (
                    <TR key={r.s.id}>
                      <TD>
                        <Link href={`/students/${r.s.id}`} className="text-xs font-semibold text-primary hover:underline">{fullName(r.s.user)}</Link>
                      </TD>
                      <TD className="text-xs">{fullName(r.s.assignedInstructor?.user)}</TD>
                      <TD className="w-32">
                        <div className="flex items-center gap-2">
                          <span className="w-6 text-xs font-semibold tabular-nums">{r.readiness.score}</span>
                          <Progress value={r.readiness.score} className="flex-1" tone={r.readiness.score >= 70 ? "success" : "primary"} />
                        </div>
                      </TD>
                      <TD><StatusBadge status={r.readiness.status} /></TD>
                      <TD className="max-w-40 truncate text-[11px] text-muted-foreground">{r.readiness.weakAreas[0] ?? "—"}</TD>
                    </TR>
                  ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5"><ClipboardCheck className="h-4 w-4" /> Instructor Workload & Currency</CardTitle>
            <CardDescription>Past-7-day load and credential margins — expired credentials block scheduling automatically</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {instructors.map((i) => {
              const hours = i.dispatches.reduce((t, d) => t + Number(d.dualGiven ?? d.flightTime ?? 0), 0);
              const lessons = i.scheduleEvents.length;
              const maxLessons = Math.max(...instructors.map((x) => x.scheduleEvents.length), 1);
              const cfiDays = daysUntil(i.cfiExpiration);
              const medDays = daysUntil(i.medicalExpiration);
              const currencyAlert = (cfiDays !== null && cfiDays < 60) || (medDays !== null && medDays < 60);
              return (
                <div key={i.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center gap-2.5">
                    <Avatar first={i.user.firstName} last={i.user.lastName} className="h-7 w-7 text-[10px]" />
                    <p className="flex-1 text-xs font-semibold">{fullName(i.user)} <span className="font-normal text-muted-foreground">· {i.students.length} students · {hours.toFixed(1)} hrs taught (7d)</span></p>
                    {currencyAlert && <Badge tone="amber"><AlertTriangle className="h-3 w-3" /> currency</Badge>}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="w-24 text-[10px] text-muted-foreground">{lessons} lessons / wk</span>
                    <Progress value={(lessons / maxLessons) * 100} className="flex-1" tone={lessons / maxLessons > 0.85 ? "warning" : "primary"} />
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    CFI renewal {formatDate(i.cfiExpiration)}{cfiDays !== null ? ` (${cfiDays}d)` : ""} · Medical {formatDate(i.medicalExpiration)}{medDays !== null ? ` (${medDays}d)` : ""}
                  </p>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
