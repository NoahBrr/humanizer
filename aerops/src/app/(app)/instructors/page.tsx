import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, PageHeader } from "@/components/ui/misc";
import { formatCurrency, formatDate, fullName } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Instructors" };

export default async function InstructorsPage() {
  const session = await getSession();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const instructors = await db.instructor.findMany({
    where: { user: { organizationId: session!.organizationId } },
    include: {
      user: true,
      students: { include: { user: { select: { firstName: true, lastName: true } } } },
      availability: true,
      dispatches: { where: { status: "CLOSED", closedAt: { gte: monthStart } }, select: { dualGiven: true, flightTime: true } },
      scheduleEvents: {
        where: { start: { gte: new Date() }, status: { in: ["SCHEDULED", "DISPATCHED"] } },
        orderBy: { start: "asc" },
        take: 3,
        include: { student: { include: { user: { select: { firstName: true, lastName: true } } } }, aircraft: { select: { tailNumber: true } } },
      },
    },
    orderBy: { user: { lastName: "asc" } },
  });

  const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="animate-fade-up">
      <PageHeader title="Instructors" description={`${instructors.length} certified flight instructors`} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {instructors.map((i) => {
          const hoursTaught = i.dispatches.reduce((t, d) => t + Number(d.dualGiven ?? d.flightTime ?? 0), 0);
          const revenue = hoursTaught * Number(i.hourlyRate);
          const days = new Set(i.availability.map((a) => a.dayOfWeek));
          return (
            <Card key={i.id}>
              <CardHeader className="flex-row items-center gap-3">
                <Avatar first={i.user.firstName} last={i.user.lastName} className="h-10 w-10 text-sm" />
                <div className="flex-1">
                  <CardTitle>{i.user.firstName} {i.user.lastName}</CardTitle>
                  <CardDescription>{i.certificates.split(",").join(" · ")} · {formatCurrency(i.hourlyRate)}/hr</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-muted/60 p-2 text-center">
                    <p className="text-[10px] text-muted-foreground">Hours taught (MTD)</p>
                    <p className="text-sm font-semibold">{hoursTaught.toFixed(1)}</p>
                  </div>
                  <div className="rounded-lg bg-muted/60 p-2 text-center">
                    <p className="text-[10px] text-muted-foreground">Revenue (MTD)</p>
                    <p className="text-sm font-semibold">{formatCurrency(revenue)}</p>
                  </div>
                </div>

                <div>
                  <p className="mb-1 text-[11px] font-medium text-muted-foreground">Availability</p>
                  <div className="flex gap-1">
                    {DAY_LABELS.map((d, idx) => (
                      <span key={d} className={`flex-1 rounded-md py-1 text-center text-[10px] font-medium ${days.has(idx) ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground/50"}`}>
                        {d}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-1 text-[11px] font-medium text-muted-foreground">Assigned students ({i.students.length})</p>
                  <div className="flex flex-wrap gap-1">
                    {i.students.map((s) => <Badge key={s.id} tone="gray">{fullName(s.user)}</Badge>)}
                  </div>
                </div>

                <div>
                  <p className="mb-1 text-[11px] font-medium text-muted-foreground">Next flights</p>
                  <div className="space-y-1">
                    {i.scheduleEvents.length === 0 && <p className="text-[11px] text-muted-foreground">Nothing upcoming.</p>}
                    {i.scheduleEvents.map((e) => (
                      <p key={e.id} className="text-[11px]">
                        <span className="font-medium">{formatDate(e.start)}</span>
                        <span className="text-muted-foreground"> · {fullName(e.student?.user)}{e.aircraft ? ` · ${e.aircraft.tailNumber}` : ""}</span>
                      </p>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-border pt-2 text-[11px] text-muted-foreground">
                  <span>CFI exp: {formatDate(i.cfiExpiration)}</span>
                  <span>Medical: {formatDate(i.medicalExpiration)}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
