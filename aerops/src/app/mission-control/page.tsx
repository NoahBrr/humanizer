import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { buildMissionControlSnapshot } from "@/lib/mission-control";
import { MissionControlWall, type WallKey } from "./mission-control-wall";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mission Control" };

/**
 * Mission Control (Section 16A) — the full-screen operational command center.
 * Lives OUTSIDE the app shell: no sidebar, no topbar, dark room-readable
 * design for TVs, dispatch offices, and hangar walls. The initial snapshot is
 * server-rendered; from then on the wall updates over SSE and never reloads.
 */
const ROLE_DEFAULT_WALL: Record<string, WallKey> = {
  MAINTENANCE: "maintenance",
  DISPATCHER: "ops",
  ACCOUNTANT: "executive",
  INSTRUCTOR: "training",
};

export default async function MissionControlPage({ searchParams }: { searchParams: Promise<{ wall?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (session.platformRole && !session.impersonation) redirect("/platform");
  if (session.orgStatus !== "ACTIVE") redirect("/dashboard");

  const snapshot = await buildMissionControlSnapshot({
    organizationId: session.organizationId,
    modules: session.modules,
    businessProfiles: session.businessProfiles,
    canSeeFinance: session.permissions.has("billing.view"),
  });

  const { wall } = await searchParams;
  const initialWall: WallKey = (["default", "ops", "maintenance", "training", "executive"].includes(wall ?? "")
    ? (wall as WallKey)
    : ROLE_DEFAULT_WALL[session.role] ?? "default");

  return (
    <MissionControlWall
      initial={snapshot}
      initialWall={initialWall}
      viewer={`${session.firstName} ${session.lastName}`}
      canAcknowledge={!session.impersonation?.readOnly}
    />
  );
}
