import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { runDueScheduledCharges } from "@/lib/payment-runner";

/**
 * Manually release a held charge (doc 28). A review whose outbox row is
 * AWAITING_MANUAL — MANUAL_CHARGE policy, or a charge that was held because the
 * method/account wasn't ready — is released to SCHEDULED (due now) and the
 * runner is kicked so it charges immediately. The runner re-validates readiness,
 * so this can't force a charge on a not-ready account. Test mode only.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await authorize("revenue.charge", { mutating: true });
  if (error) return error;
  const { id } = await params;

  const sc = await db.scheduledCharge.findFirst({
    where: { revenueReviewId: id, organizationId: session.organizationId },
    select: { id: true, status: true, paymentMethodReferenceId: true },
  });
  if (!sc) return NextResponse.json({ error: "No scheduled charge exists for this review." }, { status: 404 });
  if (sc.status !== "AWAITING_MANUAL" && sc.status !== "FAILED") {
    return NextResponse.json({ error: `This charge is ${sc.status.toLowerCase()} and cannot be released.` }, { status: 409 });
  }
  if (!sc.paymentMethodReferenceId) {
    return NextResponse.json({ error: "Attach a payment method before charging." }, { status: 409 });
  }

  // Release to the runner (guarded: only from a held state).
  const released = await db.scheduledCharge.updateMany({
    where: { id: sc.id, status: sc.status },
    data: { status: "SCHEDULED", runAfter: new Date() },
  });
  if (released.count === 0) return NextResponse.json({ error: "The charge changed state — refresh and try again." }, { status: 409 });

  await recordAudit({
    organizationId: session.organizationId, actorUserId: session.userId, actorLabel: `${session.firstName} ${session.lastName}`,
    action: "revenue.charge.manual_release", entityType: "ScheduledCharge", entityId: sc.id,
  });

  const summary = await runDueScheduledCharges({ now: new Date(), organizationId: session.organizationId });
  return NextResponse.json({ released: true, run: summary.processed.find((p) => p.scheduledChargeId === sc.id)?.outcome ?? "queued" });
}
