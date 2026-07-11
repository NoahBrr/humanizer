import { Prisma, type RefundDestination, type RevenueReviewStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getPaymentProvider } from "@/lib/payment-service";
import { postJournal } from "@/lib/ledger";
import { buildRefundJournalLines } from "@/lib/revenue-journals";
import { canTransition } from "@/lib/revenue-review";
import { toMinorUnits } from "@/lib/payment-runner";

/**
 * Refund engine (doc 28 §"refunds", doc 39 §9). Reverses a settled payment,
 * fully or partially, and keeps every projection balanced:
 *   - J3 reversing journal (buildRefundJournalLines) — money flows back out of
 *     clearing; the platform fee expense is reduced by the proportional refund.
 *   - PlatformFee.reversedAmount accrues; status → PARTIALLY_REVERSED / REVERSED.
 *   - The review moves to PARTIALLY_REFUNDED or REFUNDED (guarded transition).
 *
 * Exactly-once: Refund.adjustmentId is @unique (a deterministic per-refund key),
 * so a retried request cannot mint a second refund; the provider call carries an
 * idempotency key so the provider dedupes too. The provider call happens OUTSIDE
 * the transaction, framed by a PENDING → SUCCEEDED record like the charge path.
 *
 * The proportional platform-fee refund never exceeds the un-reversed remainder,
 * so fees can never be reversed past what was earned.
 */

export type RefundOutcome =
  | { status: "refunded"; refundId: string; amount: string; reviewStatus: RevenueReviewStatus }
  | { status: "rejected"; reason: string };

export async function issueRefund(input: {
  organizationId: string;
  paymentId: string;
  amount: Prisma.Decimal | null; // null → full remaining
  destination: RefundDestination;
  reason: string;
  actorUserId: string | null;
  actorLabel: string;
  now: Date;
}): Promise<RefundOutcome> {
  const provider = getPaymentProvider();
  if (!provider) return { status: "rejected", reason: "charging_disabled" };

  // ---- 1. Validate + create the PENDING refund inside a tx ----
  const prepared = await db.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({
      where: { id: input.paymentId, organizationId: input.organizationId },
      include: { attempt: { include: { scheduledCharge: true } }, refunds: true },
    });
    if (!payment) throw new RefundError("payment_not_found");
    if (!payment.attempt?.providerPaymentIntentId) throw new RefundError("payment_not_provider_backed");

    const account = await tx.connectedAccount.findUnique({ where: { organizationId: input.organizationId }, select: { providerAccountId: true } });
    if (!account?.providerAccountId) throw new RefundError("no_connected_account");

    const settledRefunds = payment.refunds.filter((r) => r.status === "SUCCEEDED" || r.status === "PROCESSING" || r.status === "PENDING");
    const alreadyRefunded = settledRefunds.reduce((t, r) => t.plus(r.amount), new Prisma.Decimal(0));
    const remaining = payment.amount.minus(alreadyRefunded);
    const amount = input.amount ?? remaining;
    if (amount.lessThanOrEqualTo(0)) throw new RefundError("amount_not_positive");
    if (amount.greaterThan(remaining)) throw new RefundError("amount_exceeds_remaining");

    const reviewId = payment.attempt.scheduledCharge.revenueReviewId;
    const fee = await tx.platformFee.findUnique({ where: { revenueReviewId: reviewId }, select: { id: true, amount: true, reversedAmount: true } });
    // Proportional fee refund, capped at the un-reversed remainder.
    let feeRefund = new Prisma.Decimal(0);
    if (fee && fee.amount.greaterThan(0)) {
      const proportional = fee.amount.times(amount).dividedBy(payment.amount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      const feeRemaining = fee.amount.minus(fee.reversedAmount);
      feeRefund = proportional.greaterThan(feeRemaining) ? feeRemaining : proportional;
    }

    // Deterministic adjustment key — the replay guard.
    const adjustmentId = `adj_${payment.id}_r${payment.refunds.length + 1}`;
    const refund = await tx.refund.create({
      data: {
        organizationId: input.organizationId, adjustmentId, paymentId: payment.id,
        amount, currency: payment.currency, destination: input.destination, status: "PENDING",
      },
    });
    const isFull = alreadyRefunded.plus(amount).equals(payment.amount);
    return {
      refundId: refund.id, intentRef: payment.attempt.providerPaymentIntentId, accountRef: account.providerAccountId,
      amount, amountMinor: toMinorUnits(amount), isFull, feeRefund, feeId: fee?.id ?? null, reviewId, currency: payment.currency,
    };
  }).catch((e) => {
    if (e instanceof RefundError) return { rejected: e.message } as const;
    throw e;
  });

  if ("rejected" in prepared) return { status: "rejected", reason: prepared.rejected };

  // ---- 2. Provider refund OUTSIDE the tx (idempotency-keyed) ----
  let providerRefundId: string;
  let providerStatus: string;
  try {
    const res = await provider.createRefund({
      accountRef: prepared.accountRef, paymentIntentRef: prepared.intentRef,
      amount: prepared.isFull ? undefined : prepared.amountMinor,
      refundApplicationFee: prepared.feeRefund.greaterThan(0),
      idempotencyKey: `rf_${prepared.refundId}`,
      metadata: { refundId: prepared.refundId, reviewId: prepared.reviewId },
    });
    providerRefundId = res.refundRef;
    providerStatus = res.status;
  } catch (e) {
    logger.error("refund provider call failed", { refundId: prepared.refundId, error: String(e) });
    await db.refund.update({ where: { id: prepared.refundId }, data: { status: "FAILED", failureReason: String(e).slice(0, 300) } }).catch(() => {});
    return { status: "rejected", reason: "provider_error" };
  }

  // ---- 3. Record the reversal (J3 + fee reversal + transition) ----
  return db.$transaction(async (tx) => {
    const claim = await tx.refund.updateMany({
      where: { id: prepared.refundId, status: "PENDING" },
      data: { status: providerStatus === "succeeded" ? "SUCCEEDED" : "PROCESSING", providerRefundId, processedAt: input.now },
    });
    // Already recorded (a retry that raced past the PENDING guard) — no re-post.
    if (claim.count === 0) {
      return { status: "refunded", refundId: prepared.refundId, amount: prepared.amount.toFixed(2), reviewStatus: prepared.isFull ? "REFUNDED" : "PARTIALLY_REFUNDED" };
    }

    // Platform-fee reversal.
    if (prepared.feeId && prepared.feeRefund.greaterThan(0)) {
      const fee = await tx.platformFee.findUnique({ where: { id: prepared.feeId }, select: { amount: true, reversedAmount: true } });
      if (fee) {
        const newReversed = fee.reversedAmount.plus(prepared.feeRefund);
        await tx.platformFee.update({
          where: { id: prepared.feeId },
          data: { reversedAmount: newReversed, status: newReversed.greaterThanOrEqualTo(fee.amount) ? "REVERSED" : "PARTIALLY_REVERSED" },
        });
      }
    }

    // J3 reversing journal.
    const lines = buildRefundJournalLines({ refundAmount: prepared.amount, platformFeeRefund: prepared.feeRefund });
    await postJournal(tx, {
      organizationId: input.organizationId, journalId: `jrnl_${prepared.refundId}_refund`,
      event: "payment.refunded", sourceType: "Refund", sourceId: prepared.refundId,
      currency: prepared.currency, effectiveAt: input.now, lines,
    });

    const target: RevenueReviewStatus = prepared.isFull ? "REFUNDED" : "PARTIALLY_REFUNDED";
    await transitionReview(tx, prepared.reviewId, target);
    return { status: "refunded", refundId: prepared.refundId, amount: prepared.amount.toFixed(2), reviewStatus: target };
  });
}

class RefundError extends Error {}

async function transitionReview(tx: Prisma.TransactionClient, reviewId: string, to: RevenueReviewStatus): Promise<void> {
  const review = await tx.revenueReview.findUnique({ where: { id: reviewId }, select: { status: true } });
  if (!review || review.status === to) return;
  if (!canTransition(review.status, to)) return;
  await tx.revenueReview.update({ where: { id: reviewId }, data: { status: to } });
}
