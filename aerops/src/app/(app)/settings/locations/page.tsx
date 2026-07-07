import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/misc";
import { LocationsManager } from "./locations-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Locations" };

export default async function LocationsPage() {
  const session = await getSession();
  if (!session!.permissions.has("settings.manage")) redirect("/dashboard");

  const locations = await db.location.findMany({
    where: { organizationId: session!.organizationId },
    select: { id: true, name: true, icao: true, timeZone: true, isActive: true },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });

  return (
    <div className="animate-fade-up space-y-4">
      <Link href="/settings" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Settings
      </Link>
      <PageHeader title="Locations" description="Bases and airports your organization operates from. Time zone and ICAO drive scheduling and weather." />
      <LocationsManager locations={locations} />
    </div>
  );
}
