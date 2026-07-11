import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma, RefundDestination } from "@prisma/client";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { issueRefund } from "@/lib/payment-refunds";

/**
 * Refund a settled payment, fully or partially (doc 28 §refunds). The amount and
 * proportional fee reversal are server-computed in the engine; the client only
 * chooses how much and why. Separation of duties: refunds are gated on
 * revenue.refund (a distinct permission from charging). Test mode only.
 */
const schema = z.object({
  amount: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter a dollar amount like 120.00").optional(), // omit → full remaining
  destination: z.nativeEnum(RefundDestination).default("ORIGINAL_METHOD"),
  reason: z.string().trim().min(1).max(500),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await authorize("revenue.refund", { mutating: true });
  if (error) return error;
  const { id } = await params;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a reason and an optional amount.", details: parsed.error.flatten() }, { status: 400 });
  }

  const outcome = await issueRefund({
    organizationId: session.organizationId,
    paymentId: id,
    amount: parsed.data.amount ? new Prisma.Decimal(parsed.data.amount) : null,
    destination: parsed.data.destination,
    reason: parsed.data.reason,
    actorUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`,
    now: new Date(),
  });

  if (outcome.status === "rejected") {
    const map: Record<string, [number, string]> = {
      payment_not_found: [404, "That payment was not found."],
      charging_disabled: [409, "Connected payments are not enabled for this environment."],
      no_connected_account: [409, "This school has no connected payment account."],
      amount_not_positive: [400, "Enter a positive refund amount."],
      amount_exceeds_remaining: [400, "The refund exceeds the remaining refundable amount."],
      payment_not_provider_backed: [409, "This payment was not taken through the card/ACH processor and can't be refunded here."],
      provider_error: [502, "The processor could not complete the refund. Please try again."],
    };
    const [status, message] = map[outcome.reason] ?? [400, "The refund could not be processed."];
    return NextResponse.json({ error: message }, { status });
  }

  await recordAudit({
    organizationId: session.organizationId, actorUserId: session.userId, actorLabel: `${session.firstName} ${session.lastName}`,
    action: "revenue.payment.refund", entityType: "Refund", entityId: outcome.refundId,
    newValue: { amount: outcome.amount, reviewStatus: outcome.reviewStatus, reason: parsed.data.reason },
  });
  return NextResponse.json({ refundId: outcome.refundId, amount: outcome.amount, reviewStatus: outcome.reviewStatus });
}
