import { db } from "@/lib/db";
import { SCENARIOS } from "@/lib/simulation";
import { SimulationClient } from "./simulation-client";
import { requirePlatformSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live Simulation" };

export default async function SimulationPage() {
  await requirePlatformSession();
  const [orgs, running] = await Promise.all([
    db.organization.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.simulationRun.findFirst({
      where: { status: "RUNNING" },
      orderBy: { startedAt: "desc" },
      include: { organization: { select: { id: true, name: true } } },
    }),
  ]);

  return (
    <div className="animate-fade-up">
      <h1 className="text-xl font-semibold tracking-tight">Live Simulation</h1>
      <p className="mt-0.5 text-sm text-muted-foreground">
        Run a scenario against any organization to generate live operational activity — perfect for demos, trade shows and investor meetings.
      </p>
      <SimulationClient
        orgs={orgs}
        scenarios={Object.entries(SCENARIOS).map(([key, s]) => ({ key, label: s.label, description: s.description }))}
        initialRun={running ? { id: running.id, orgId: running.organization.id, orgName: running.organization.name, scenario: running.scenario, tickCount: running.tickCount } : null}
      />
    </div>
  );
}
