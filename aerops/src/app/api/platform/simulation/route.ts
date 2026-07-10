import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorizePlatform } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { SCENARIOS } from "@/lib/simulation";

const startSchema = z.object({
  orgId: z.string().min(1),
  scenario: z.enum(Object.keys(SCENARIOS) as [string, ...string[]]),
});

/** Start a live simulation run against an organization. */
export async function POST(req: Request) {
  const { session, error } = await authorizePlatform(["FOUNDER", "PLATFORM_ADMIN"], { mutating: true });
  if (error) return error;

  const body = startSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const org = await db.organization.findUnique({ where: { id: body.data.orgId }, select: { id: true, name: true, deletedAt: true } });
  if (!org || org.deletedAt) return NextResponse.json({ error: "Organization not found" }, { status: 404 });

  // One running simulation per organization.
  await db.simulationRun.updateMany({
    where: { organizationId: org.id, status: "RUNNING" },
    data: { status: "STOPPED", stoppedAt: new Date() },
  });

  const run = await db.simulationRun.create({
    data: { organizationId: org.id, scenario: body.data.scenario, startedBy: session.email },
  });
  await recordAudit({
    organizationId: org.id,
    actorPlatformUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: "platform.simulation.start",
    entityType: "SimulationRun",
    entityId: run.id,
    newValue: { scenario: body.data.scenario, organization: org.name },
  });
  return NextResponse.json({ ok: true, runId: run.id });
}

const stopSchema = z.object({ runId: z.string().min(1) });

/** Stop a simulation run. */
export async function DELETE(req: Request) {
  const { session, error } = await authorizePlatform(["FOUNDER", "PLATFORM_ADMIN"], { mutating: true });
  if (error) return error;

  const body = stopSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const run = await db.simulationRun.update({
    where: { id: body.data.runId },
    data: { status: "STOPPED", stoppedAt: new Date() },
    include: { organization: { select: { name: true } } },
  }).catch(() => null);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  await recordAudit({
    organizationId: run.organizationId,
    actorPlatformUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: "platform.simulation.stop",
    entityType: "SimulationRun",
    entityId: run.id,
    newValue: { ticks: run.tickCount, eventsCreated: run.eventsCreated },
  });
  return NextResponse.json({ ok: true });
}
