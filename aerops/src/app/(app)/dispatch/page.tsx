import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/misc";
import { DispatchBoard } from "./dispatch-board";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dispatch" };

export default async function DispatchPage() {
  const session = await getSession();
  const organizationId = session!.organizationId;
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);

  const dispatches = await db.dispatch.findMany({
    where: {
      aircraft: { organizationId },
      OR: [
        { status: { in: ["PENDING", "RELEASED"] } },
        { status: "CLOSED", closedAt: { gte: dayStart, lt: dayEnd } },
      ],
    },
    include: {
      aircraft: { select: { id: true, tailNumber: true, status: true, currentHobbs: true, currentTach: true, hourlyRateWet: true } },
      student: { include: { user: { select: { firstName: true, lastName: true } } } },
      instructor: { include: { user: { select: { firstName: true, lastName: true } }, } },
      scheduleEvent: { include: { lessonType: { select: { name: true } } } },
    },
    orderBy: { scheduleEvent: { start: "asc" } },
  });

  const serialized = dispatches.map((d) => ({
    id: d.id,
    status: d.status,
    tailNumber: d.aircraft.tailNumber,
    aircraftStatus: d.aircraft.status,
    currentHobbs: Number(d.aircraft.currentHobbs),
    currentTach: Number(d.aircraft.currentTach),
    rate: Number(d.aircraft.hourlyRateWet),
    student: d.student ? `${d.student.user.firstName} ${d.student.user.lastName}` : null,
    instructor: d.instructor ? `${d.instructor.user.firstName} ${d.instructor.user.lastName}` : null,
    cfiRate: d.instructor ? Number(d.instructor.hourlyRate) : 0,
    lesson: d.scheduleEvent.lessonType?.name ?? d.scheduleEvent.type.replaceAll("_", " "),
    start: d.scheduleEvent.start.toISOString(),
    end: d.scheduleEvent.end.toISOString(),
    releasedAt: d.releasedAt?.toISOString() ?? null,
    releasedBy: d.releasedBy,
    hobbsOut: d.hobbsOut ? Number(d.hobbsOut) : null,
    tachOut: d.tachOut ? Number(d.tachOut) : null,
    hobbsIn: d.hobbsIn ? Number(d.hobbsIn) : null,
    flightTime: d.flightTime ? Number(d.flightTime) : null,
    landings: d.landings,
  }));

  const canDispatch = session!.permissions.has("dispatch.release") && !session!.impersonation?.readOnly;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Dispatch"
        description="Pre-flight release and aircraft return. Completing a return creates a draft Revenue Review — it does not charge anything."
      />
      <DispatchBoard dispatches={serialized} canDispatch={canDispatch} />
    </div>
  );
}
