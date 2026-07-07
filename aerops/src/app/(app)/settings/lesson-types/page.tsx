import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/misc";
import { LessonTypesManager } from "./lesson-types-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lesson Types" };

export default async function LessonTypesPage() {
  const session = await getSession();
  if (!session!.permissions.has("settings.manage")) redirect("/dashboard");

  const lessonTypes = await db.lessonType.findMany({
    where: { organizationId: session!.organizationId },
    select: { id: true, name: true, color: true, durationMin: true, requiresAircraft: true, requiresInstructor: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="animate-fade-up space-y-4">
      <Link href="/settings" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Settings
      </Link>
      <PageHeader title="Lesson Types" description="Colors drive the schedule; durations pre-fill new bookings; requirements gate what a booking needs." />
      <LessonTypesManager lessonTypes={lessonTypes} />
    </div>
  );
}
