import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/misc";
import { ScheduleCalendar } from "./schedule-calendar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Schedule" };

export default async function SchedulePage() {
  const session = await getSession();
  const organizationId = session!.organizationId;

  const [aircraft, instructors, students, lessonTypes] = await Promise.all([
    db.aircraft.findMany({
      where: { organizationId, status: { not: "RETIRED" } },
      select: { id: true, tailNumber: true, status: true, isSimulator: true, aircraftType: { select: { model: true } } },
      orderBy: { tailNumber: "asc" },
    }),
    db.instructor.findMany({
      where: { user: { organizationId, isActive: true } },
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
    }),
    db.student.findMany({
      where: { user: { organizationId, isActive: true } },
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
    }),
    db.lessonType.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
  ]);

  const canEdit = session!.permissions.has("schedule.create");

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Schedule"
        description="Drag to book, drag events to move, pull edges to resize. Conflicts are detected automatically."
      />
      <ScheduleCalendar
        aircraft={aircraft.map((a) => ({ id: a.id, tailNumber: a.tailNumber, model: a.aircraftType.model, status: a.status, isSimulator: a.isSimulator }))}
        instructors={instructors.map((i) => ({ id: i.id, name: `${i.user.firstName} ${i.user.lastName}` }))}
        students={students.map((s) => ({ id: s.id, name: `${s.user.firstName} ${s.user.lastName}` }))}
        lessonTypes={lessonTypes.map((l) => ({ id: l.id, name: l.name, color: l.color, durationMin: l.durationMin, requiresAircraft: l.requiresAircraft, requiresInstructor: l.requiresInstructor }))}
        canEdit={canEdit}
      />
    </div>
  );
}
