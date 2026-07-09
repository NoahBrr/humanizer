import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { buildMissionControlSnapshot } from "@/lib/mission-control";
import { BUILTIN_SCENES, type PanelKey, type Scene } from "@/lib/mission-control-scenes";
import { MissionControlWall } from "./mission-control-wall";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mission Control" };

/**
 * Mission Control (Sections 16A/16B) — the full-screen operational command
 * center. Lives OUTSIDE the app shell: no sidebar, no topbar, dark
 * room-readable design for TVs, dispatch offices, and hangar walls. The
 * initial snapshot is server-rendered; from then on the wall updates over
 * SSE and never reloads. ?scene= picks a scene, ?tv=1 enables TV mode
 * (chrome hidden, scenes auto-rotate).
 */
const ROLE_DEFAULT_SCENE: Record<string, string> = {
  MAINTENANCE: "maintenance",
  DISPATCHER: "ops",
  ACCOUNTANT: "executive",
  INSTRUCTOR: "training",
};

export default async function MissionControlPage({ searchParams }: { searchParams: Promise<{ scene?: string; wall?: string; tv?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (session.platformRole && !session.impersonation) redirect("/platform");
  if (session.orgStatus !== "ACTIVE") redirect("/dashboard");

  const [snapshot, savedScenes] = await Promise.all([
    buildMissionControlSnapshot({
      organizationId: session.organizationId,
      modules: session.modules,
      businessProfiles: session.businessProfiles,
      canSeeFinance: session.permissions.has("billing.view"),
      canSeeCrm: session.permissions.has("students.manage"),
      canSeeCfi: session.permissions.has("instructors.view"),
      canSeeHealth: session.permissions.has("reports.view"),
    }),
    db.missionControlScene.findMany({ where: { organizationId: session.organizationId }, orderBy: { createdAt: "asc" } }),
  ]);

  const scenes: Scene[] = [
    ...BUILTIN_SCENES,
    ...savedScenes.map((s) => ({ key: s.id, label: s.name, panels: s.panels as PanelKey[], builtin: false })),
  ];

  const params = await searchParams;
  const requested = params.scene ?? params.wall; // ?wall= kept for 16A links
  const initialScene = scenes.some((s) => s.key === requested)
    ? (requested as string)
    : ROLE_DEFAULT_SCENE[session.role] ?? "default";

  return (
    <MissionControlWall
      initial={snapshot}
      scenes={scenes}
      initialScene={initialScene}
      tvMode={params.tv === "1"}
      viewer={`${session.firstName} ${session.lastName}`}
      canAcknowledge={!session.impersonation?.readOnly}
      canManageScenes={session.permissions.has("settings.manage") && !session.impersonation?.readOnly}
    />
  );
}
