import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const startedAt = Date.now();

/**
 * Platform health (Section 17 observability). Unauthenticated by design —
 * load balancers, uptime monitors, and status pages need it — so it exposes
 * component status only, never data or configuration.
 */
export async function GET() {
  let database = "ok";
  let dbLatencyMs: number | null = null;
  try {
    const t = Date.now();
    await db.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - t;
  } catch {
    database = "unreachable";
  }

  const healthy = database === "ok";
  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      database,
      dbLatencyMs,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      version: process.env.npm_package_version ?? "0.1.0",
    },
    { status: healthy ? 200 : 503 },
  );
}
