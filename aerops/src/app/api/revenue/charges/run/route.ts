import { NextResponse } from "next/server";
import { authorize } from "@/lib/session";
import { runDueScheduledCharges } from "@/lib/payment-runner";

/**
 * Run the org's due payment outbox (doc 28/39). Ordinarily a background cron
 * drives the runner; this endpoint lets an operator flush the queue on demand.
 * ALWAYS org-scoped from the session — never a cross-org sweep (that is a
 * platform-only path). Idempotent: the claim guard means a double-tap can't
 * double-charge. Test mode only.
 */
export async function POST() {
  const { session, error } = await authorize("revenue.charge", { mutating: true });
  if (error) return error;

  const summary = await runDueScheduledCharges({ now: new Date(), organizationId: session.organizationId });
  return NextResponse.json({ claimed: summary.claimed, processed: summary.processed });
}
