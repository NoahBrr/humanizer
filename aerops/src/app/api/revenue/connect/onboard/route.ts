import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { startOnboarding } from "@/lib/connect-onboarding";

/**
 * Start (or resume) Stripe Connect onboarding for the org (doc 19). Returns a
 * Stripe-hosted onboarding link; KYC/bank details are entered there, never here.
 * Return/refresh URLs are SERVER-derived from the request origin (no
 * open-redirect from a client-supplied URL). Test mode only.
 */
export async function POST(req: Request) {
  const { session, error } = await authorize("revenue.connect_manage", { mutating: true });
  if (error) return error;

  const user = await db.user.findUnique({ where: { id: session.userId }, select: { email: true } });
  if (!user?.email) return NextResponse.json({ error: "Your account needs an email before onboarding." }, { status: 400 });

  const origin = new URL(req.url).origin;
  const settingsUrl = `${origin}/app/settings/payments`;

  const result = await startOnboarding({
    organizationId: session.organizationId,
    email: user.email,
    returnUrl: settingsUrl,
    refreshUrl: settingsUrl,
    actorUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`,
    now: new Date(),
  });

  if (result.status === "disabled") {
    return NextResponse.json({ error: "Connected payments are not enabled for this environment." }, { status: 409 });
  }

  await recordAudit({
    organizationId: session.organizationId, actorUserId: session.userId, actorLabel: `${session.firstName} ${session.lastName}`,
    action: "revenue.connect.onboard_started", entityType: "ConnectedAccount", entityId: result.accountRef,
  });
  return NextResponse.json({ url: result.url });
}
