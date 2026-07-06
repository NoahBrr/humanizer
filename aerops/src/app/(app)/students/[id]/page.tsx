import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Award, FileSignature, ShieldCheck, Gauge, History } from "lucide-react";
import { computeReadiness } from "@/lib/readiness";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Avatar, Progress } from "@/components/ui/misc";
import { formatCurrency, formatDate, formatDateTime, formatHours, fullName, daysUntil } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function StudentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const { id } = await params;
  const s = await db.student.findFirst({
    where: { id, user: { organizationId: session!.organizationId } },
    include: {
      user: true,
      assignedInstructor: { include: { user: { select: { firstName: true, lastName: true } } } },
      enrollments: {
        include: {
          syllabus: { include: { stages: { include: { lessons: { orderBy: { order: "asc" } } }, orderBy: { order: "asc" } } } },
        },
      },
      lessonRecords: {
        include: { instructor: { include: { user: { select: { firstName: true, lastName: true } } } }, syllabusLesson: true },
        orderBy: { date: "desc" },
      },
      endorsements: { include: { instructor: { include: { user: { select: { firstName: true, lastName: true } } } } }, orderBy: { signedAt: "desc" } },
      ratings: { orderBy: { earnedAt: "desc" } },
      checkrides: { orderBy: { date: "desc" } },
      scheduleEvents: {
        where: { start: { gte: new Date() }, status: { in: ["SCHEDULED", "DISPATCHED"] } },
        include: { aircraft: { select: { tailNumber: true } }, instructor: { include: { user: { select: { firstName: true, lastName: true } } } }, lessonType: true },
        orderBy: { start: "asc" },
        take: 5,
      },
      invoices: { orderBy: { issuedAt: "desc" }, take: 5, include: { lines: true, payments: true } },
    },
  });
  if (!s) notFound();

  const enrollment = s.enrollments[0];
  const required = Number(enrollment?.syllabus.requiredHours ?? 40);
  const progress = Math.min(100, Math.round((Number(s.totalHours) / required) * 100));
  const completedLessonIds = new Set(s.lessonRecords.filter((r) => r.grade !== "INCOMPLETE" && r.syllabusLessonId).map((r) => r.syllabusLessonId));
  const medicalDays = daysUntil(s.medicalExpiration);
  const balance = Number(s.accountBalance);

  // --- Checkride readiness ---------------------------------------------------
  const allSyllabusLessons = enrollment?.syllabus.stages.flatMap((st) => st.lessons) ?? [];
  const stageCheckStages = enrollment?.syllabus.stages.filter((st) => st.isStageCheck) ?? [];
  const stageChecksPassed = stageCheckStages.filter((st) => st.lessons.some((l) => completedLessonIds.has(l.id))).length;
  const weakAreas = s.lessonRecords
    .filter((r) => r.grade === "NEEDS_IMPROVEMENT")
    .map((r) => r.syllabusLesson?.name ?? "General airmanship");
  const readiness = computeReadiness({
    totalHours: Number(s.totalHours),
    requiredHours: required,
    lessonsCompleted: allSyllabusLessons.filter((l) => completedLessonIds.has(l.id)).length,
    lessonsTotal: allSyllabusLessons.length,
    stageChecksPassed,
    stageChecksTotal: stageCheckStages.length,
    endorsementCount: s.endorsements.length,
    medicalValid: medicalDays !== null && medicalDays > 0,
    writtenTestPassed: s.writtenTestPassed,
    checkrideScheduled: s.checkrides.some((c) => c.status === "SCHEDULED"),
    weakAreas,
  });

  // --- Unified timeline --------------------------------------------------------
  type TL = { at: Date; kind: string; text: string };
  const timeline: TL[] = [
    { at: s.enrolledAt, kind: "Enrolled", text: `Joined as ${s.status.replaceAll("_", " ").toLowerCase()}` },
    ...(s.discoveryFlightAt ? [{ at: s.discoveryFlightAt, kind: "Discovery", text: `Discovery flight — ${s.discoveryOutcome ?? "completed"}` }] : []),
    ...s.lessonRecords.map((r) => ({ at: r.date, kind: "Lesson", text: `${r.syllabusLesson?.name ?? "Lesson"} — ${r.grade.replaceAll("_", " ").toLowerCase()}` })),
    ...s.endorsements.map((e) => ({ at: e.signedAt, kind: "Endorsement", text: e.title })),
    ...s.checkrides.map((c) => ({ at: c.date, kind: "Checkride", text: `${c.rating.replaceAll("_", " ")} — ${c.status.toLowerCase()}` })),
    ...s.ratings.map((r) => ({ at: r.earnedAt, kind: "Certificate", text: `${r.rating.replaceAll("_", " ")} earned` })),
    ...s.invoices.map((inv) => ({ at: inv.issuedAt, kind: "Invoice", text: `${inv.number} — ${inv.status.replaceAll("_", " ").toLowerCase()}` })),
    ...(s.writtenTestDate ? [{ at: s.writtenTestDate, kind: "Knowledge Test", text: `Written ${s.writtenTestPassed ? "passed" : "attempted"}${s.writtenTestScore ? ` — ${s.writtenTestScore}%` : ""}` }] : []),
  ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 20);

  return (
    <div className="animate-fade-up space-y-4">
      <Link href="/students" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> All students
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar first={s.user.firstName} last={s.user.lastName} className="h-12 w-12 text-base" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{s.user.firstName} {s.user.lastName}</h1>
            <p className="text-sm text-muted-foreground">
              {s.trainingGoal} · {s.trainingPart.replaceAll("_", " ")} · CFI: {fullName(s.assignedInstructor?.user)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={s.status} />
          {s.ftnNumber && <Badge tone="gray">FTN {s.ftnNumber}</Badge>}
          {s.writtenTestPassed && <Badge tone="green">Written {s.writtenTestScore ?? ""}%</Badge>}
          {s.tsaVerified && <Badge tone="green"><ShieldCheck className="h-3 w-3" /> TSA verified</Badge>}
          <Badge tone={balance < 0 ? "red" : "green"}>Balance {balance < 0 ? `-${formatCurrency(Math.abs(balance))}` : formatCurrency(balance)}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Total hours", value: formatHours(s.totalHours) },
          { label: "Solo hours", value: formatHours(s.soloHours) },
          { label: "Course progress", value: `${progress}%` },
          { label: "Medical", value: medicalDays === null ? "—" : medicalDays > 0 ? `${medicalDays} days left` : "EXPIRED", tone: medicalDays !== null && medicalDays < 60 },
        ].map((f) => (
          <Card key={f.label}>
            <CardContent className="p-4">
              <p className="text-[11px] text-muted-foreground">{f.label}</p>
              <p className={`mt-1 text-lg font-semibold ${f.tone ? "text-destructive" : ""}`}>{f.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{enrollment?.syllabus.name ?? "Syllabus"}</CardTitle>
            <CardDescription>
              {formatHours(s.totalHours)} of {required.toFixed(0)} required hours · {progress}% complete
            </CardDescription>
            <Progress value={progress} className="mt-2" />
          </CardHeader>
          <CardContent className="space-y-4">
            {enrollment?.syllabus.stages.map((stage) => {
              const done = stage.lessons.filter((l) => completedLessonIds.has(l.id)).length;
              return (
                <div key={stage.id}>
                  <div className="mb-1.5 flex items-center justify-between">
                    <p className="text-xs font-semibold">{stage.name}{stage.isStageCheck && <Badge tone="violet" className="ml-2">Stage check</Badge>}</p>
                    <p className="text-[11px] text-muted-foreground">{done}/{stage.lessons.length}</p>
                  </div>
                  <div className="space-y-1">
                    {stage.lessons.map((l) => {
                      const complete = completedLessonIds.has(l.id);
                      return (
                        <div key={l.id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs hover:bg-muted/50">
                          <span className={`h-1.5 w-1.5 rounded-full ${complete ? "bg-success" : "bg-border"}`} />
                          <span className={complete ? "" : "text-muted-foreground"}>{l.name}</span>
                          {l.minHours && <span className="ml-auto text-[10px] text-muted-foreground">{Number(l.minHours).toFixed(1)} hrs min</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            }) ?? <p className="text-xs text-muted-foreground">Not enrolled in a syllabus.</p>}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Upcoming Lessons</CardTitle></CardHeader>
            <CardContent className="space-y-2.5">
              {s.scheduleEvents.length === 0 && <p className="text-xs text-muted-foreground">Nothing scheduled.</p>}
              {s.scheduleEvents.map((e) => (
                <div key={e.id}>
                  <p className="text-xs font-medium">{formatDateTime(e.start)}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {e.lessonType?.name}{e.aircraft ? ` · ${e.aircraft.tailNumber}` : ""}{e.instructor ? ` · ${fullName(e.instructor.user)}` : ""}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-1.5"><Award className="h-4 w-4" /> Checkrides & Ratings</CardTitle></CardHeader>
            <CardContent className="space-y-2.5">
              {s.checkrides.map((c) => (
                <div key={c.id} className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium">{c.rating.replaceAll("_", " ")} checkride</p>
                    <p className="text-[11px] text-muted-foreground">{formatDate(c.date)} · {c.examinerName}</p>
                  </div>
                  <StatusBadge status={c.status} />
                </div>
              ))}
              {s.ratings.map((r) => (
                <div key={r.id} className="flex items-center justify-between">
                  <p className="text-xs font-medium">{r.rating.replaceAll("_", " ")}</p>
                  <p className="text-[11px] text-muted-foreground">earned {formatDate(r.earnedAt)}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-1.5"><FileSignature className="h-4 w-4" /> Endorsements</CardTitle></CardHeader>
            <CardContent className="space-y-2.5">
              {s.endorsements.length === 0 && <p className="text-xs text-muted-foreground">No endorsements on file.</p>}
              {s.endorsements.map((e) => (
                <div key={e.id} className="rounded-lg border border-border p-2.5">
                  <p className="text-xs font-medium">{e.title} {e.farReference && <span className="text-muted-foreground">§{e.farReference}</span>}</p>
                  <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{e.text}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Signed {formatDate(e.signedAt)} by {fullName(e.instructor.user)}{e.expiresAt ? ` · expires ${formatDate(e.expiresAt)}` : ""}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5"><Gauge className="h-4 w-4" /> Checkride Readiness</CardTitle>
          <CardDescription>Transparent factor-by-factor score — the future AI layer refines weights, never hides reasoning</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex items-center gap-4">
            <div className="text-3xl font-semibold tabular-nums">{readiness.score}<span className="text-base text-muted-foreground">/100</span></div>
            <StatusBadge status={readiness.status} className="text-xs" />
            <div className="min-w-0 flex-1"><Progress value={readiness.score} tone={readiness.score >= 70 ? "success" : readiness.score >= 40 ? "primary" : "warning"} /></div>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {readiness.factors.map((f) => (
              <div key={f.label} className="flex items-start gap-2 rounded-lg border border-border p-2.5">
                <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${f.met ? "bg-success" : "bg-warning"}`} />
                <div>
                  <p className="text-xs font-medium">{f.label}</p>
                  <p className="text-[11px] text-muted-foreground">{f.detail}</p>
                </div>
              </div>
            ))}
          </div>
          {readiness.weakAreas.length > 0 && (
            <p className="mt-3 text-xs"><span className="font-semibold text-warning">Focus areas:</span> <span className="text-muted-foreground">{readiness.weakAreas.join(" · ")}</span></p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Lesson History & Instructor Notes</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {s.lessonRecords.slice(0, 8).map((r) => (
              <div key={r.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold">{r.syllabusLesson?.name ?? "Lesson"}</p>
                  <StatusBadge status={r.grade} />
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {formatDate(r.date)} · {fullName(r.instructor.user)}
                  {r.flightHours ? ` · ${Number(r.flightHours).toFixed(1)} flight hrs` : ""}
                  {r.groundHours ? ` · ${Number(r.groundHours).toFixed(1)} ground hrs` : ""}
                </p>
                {r.notes && <p className="mt-1.5 text-xs">{r.notes}</p>}
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  {r.signedByInstructor ? "✓ Instructor signed" : "○ Awaiting instructor signature"} · {r.signedByStudent ? "✓ Student signed" : "○ Awaiting student signature"}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-1.5"><History className="h-4 w-4" /> Student Timeline</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {timeline.map((t, i) => (
              <div key={i} className="flex items-center gap-3 text-xs">
                <span className="w-20 shrink-0 text-[11px] text-muted-foreground">{formatDate(t.at)}</span>
                <Badge tone={t.kind === "Checkride" || t.kind === "Certificate" ? "green" : t.kind === "Endorsement" ? "violet" : t.kind === "Invoice" ? "gray" : "blue"}>{t.kind}</Badge>
                <span className="min-w-0 flex-1 truncate">{t.text}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Recent Invoices</CardTitle></CardHeader>
          <CardContent className="space-y-2.5">
            {s.invoices.map((inv) => {
              const total = inv.lines.reduce((t, l) => t + Number(l.quantity) * Number(l.unitPrice), 0);
              return (
                <Link key={inv.id} href={`/billing/${inv.id}`} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-muted/50">
                  <div>
                    <p className="text-xs font-medium">{inv.number}</p>
                    <p className="text-[11px] text-muted-foreground">{formatDate(inv.issuedAt)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold tabular-nums">{formatCurrency(total)}</span>
                    <StatusBadge status={inv.status} />
                  </div>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
