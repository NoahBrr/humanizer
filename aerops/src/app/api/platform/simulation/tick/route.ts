import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorizePlatform, platformOrgScopeError } from "@/lib/session";
import { simulationTick } from "@/lib/simulation";

const schema = z.object({ runId: z.string().min(1) });

/**
 * Advance a running simulation by one tick. Driven by the simulation UI
 * while it is open; each tick is bounded (3-5 weighted actions), so the
 * caller cannot flood a tenant. Not audited per-tick — the run's start and
 * stop are the audited actions, and each run row counts its ticks.
 */
export async function POST(req: Request) {
  const { session, error } = await authorizePlatform(["FOUNDER", "PLATFORM_ADMIN"], { mutating: true });
  if (error) return error;

  const body = schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  // Each tick writes into the run's org — scope-check it (org-restricted staff, D3-A).
  const run = await db.simulationRun.findUnique({ where: { id: body.data.runId }, select: { organizationId: true } });
  if (run) {
    const scopeError = platformOrgScopeError(session, run.organizationId);
    if (scopeError) return scopeError;
  }

  const result = await simulationTick(body.data.runId);
  if (!result) return NextResponse.json({ error: "Run is not active" }, { status: 409 });
  return NextResponse.json(result);
}
