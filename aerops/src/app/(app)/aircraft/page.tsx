import Link from "next/link";
import { Plane } from "lucide-react";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/misc";
import { formatCurrency, daysUntil } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Aircraft" };

export default async function AircraftPage() {
  const session = await auth();
  const aircraft = await db.aircraft.findMany({
    where: { organizationId: session!.user.organizationId },
    include: {
      aircraftType: true,
      location: { select: { icao: true } },
      squawks: { where: { status: { in: ["OPEN", "IN_PROGRESS"] } }, select: { id: true, severity: true } },
      components: true,
    },
    orderBy: { tailNumber: "asc" },
  });

  return (
    <div className="animate-fade-up">
      <PageHeader title="Aircraft" description={`${aircraft.length} aircraft in the fleet`} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {aircraft.map((a) => {
          const hobbs = Number(a.currentHobbs);
          const nextHours = a.components
            .filter((c) => c.dueAtHours)
            .map((c) => ({ name: c.name, left: Number(c.dueAtHours) - hobbs }))
            .sort((x, y) => x.left - y.left)[0];
          const nextDate = a.components
            .filter((c) => c.dueAtDate)
            .map((c) => ({ name: c.name, days: daysUntil(c.dueAtDate)! }))
            .sort((x, y) => x.days - y.days)[0];

          return (
            <Link key={a.id} href={`/aircraft/${a.id}`}>
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                        <Plane className="h-5 w-5 -rotate-45" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">{a.tailNumber}</p>
                        <p className="text-xs text-muted-foreground">{a.aircraftType.manufacturer} {a.aircraftType.model}{a.year ? ` · ${a.year}` : ""}</p>
                      </div>
                    </div>
                    <StatusBadge status={a.status} />
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-muted/60 py-2">
                      <p className="text-[10px] text-muted-foreground">Hobbs</p>
                      <p className="text-xs font-semibold tabular-nums">{hobbs.toFixed(1)}</p>
                    </div>
                    <div className="rounded-lg bg-muted/60 py-2">
                      <p className="text-[10px] text-muted-foreground">Rate (wet)</p>
                      <p className="text-xs font-semibold">{formatCurrency(a.hourlyRateWet)}/hr</p>
                    </div>
                    <div className="rounded-lg bg-muted/60 py-2">
                      <p className="text-[10px] text-muted-foreground">Base</p>
                      <p className="text-xs font-semibold">{a.location?.icao ?? "—"}</p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {a.squawks.length > 0 && (
                      <Badge tone={a.squawks.some((s) => s.severity === "GROUNDING") ? "red" : "amber"}>
                        {a.squawks.length} open squawk{a.squawks.length > 1 ? "s" : ""}
                      </Badge>
                    )}
                    {nextHours && (
                      <Badge tone={nextHours.left < 10 ? "red" : nextHours.left < 25 ? "amber" : "gray"}>
                        {nextHours.name} in {nextHours.left.toFixed(0)} hrs
                      </Badge>
                    )}
                    {nextDate && nextDate.days < 60 && (
                      <Badge tone={nextDate.days < 14 ? "red" : "amber"}>{nextDate.name} in {nextDate.days} days</Badge>
                    )}
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
