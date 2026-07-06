import Link from "next/link";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, PageHeader, Progress } from "@/components/ui/misc";
import { formatCurrency, formatHours, fullName } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Students" };

export default async function StudentsPage() {
  const session = await getSession();
  const students = await db.student.findMany({
    where: { user: { organizationId: session!.organizationId } },
    include: {
      user: true,
      assignedInstructor: { include: { user: { select: { firstName: true, lastName: true } } } },
      enrollments: { include: { syllabus: { select: { requiredHours: true, name: true } } } },
    },
    orderBy: { user: { lastName: "asc" } },
  });

  return (
    <div className="animate-fade-up">
      <PageHeader title="Students" description={`${students.length} enrolled students`} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {students.map((s) => {
          const required = Number(s.enrollments[0]?.syllabus.requiredHours ?? 40);
          const progress = Math.min(100, Math.round((Number(s.totalHours) / required) * 100));
          const balance = Number(s.accountBalance);
          return (
            <Link key={s.id} href={`/students/${s.id}`}>
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardContent className="p-5">
                  <div className="flex items-center gap-3">
                    <Avatar first={s.user.firstName} last={s.user.lastName} className="h-10 w-10 text-sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{s.user.firstName} {s.user.lastName}</p>
                      <p className="truncate text-xs text-muted-foreground">{s.trainingGoal ?? "—"} · CFI: {fullName(s.assignedInstructor?.user)}</p>
                    </div>
                    <Badge tone={balance < 0 ? "red" : "green"}>{balance < 0 ? `-${formatCurrency(Math.abs(balance))}` : formatCurrency(balance)}</Badge>
                  </div>
                  <div className="mt-4">
                    <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{s.enrollments[0]?.syllabus.name ?? "No syllabus"}</span>
                      <span>{formatHours(s.totalHours)} · {progress}%</span>
                    </div>
                    <Progress value={progress} tone={progress > 75 ? "success" : "primary"} />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
