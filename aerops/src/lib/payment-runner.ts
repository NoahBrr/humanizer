import { Prisma, type PaymentAttemptTrigger, type RevenueReviewStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getPaymentProvider } from "@/lib/payment-service";
import { chargeIdempotencyKey } from "@/lib/payment-idempotency";
import { accountReadyForCharge } from "@/lib/connected-account";
import { canTransition } from "@/lib/revenue-review";
import type { CreateChargeInput, ProviderCharge } from "@/lib/payment-provider";

/**
 * Background payment runner (doc 28 §"outbox", doc 39 §8, ADR-037). Claims due
 * ScheduledCharge outbox rows and drives them to the provider EXACTLY ONCE.
 *
 * The three layers that make a double charge impossible:
 *   1. Claim guard — `updateMany({ where: { status: SCHEDULED } })`; the loser of
 *      a race gets count 0 and does nothing. One PROCESSING transition per row.
 *   2. Attempt uniqueness — PaymentAttempt @@unique([scheduledChargeId,
 *      attemptNumber]); a duplicate attempt row cannot be inserted.
 *   3. Provider idempotency key `sc_<id>_a<n>` — a retry of the SAME attempt
 *      (e.g. after a timeout where the charge may already exist) reuses the key,
 *      so the provider returns the existing intent instead of a second one.
 *
 * The runner NEVER posts to the ledger. Settlement (J2, PlatformFee EARNED, the
 * Payment row, review → CARD_PAID/PAID) has a single writer: the webhook handler
 * (payment-webhooks.ts). The runner only records that an attempt reached the
 * provider and moves the review into a *_PROCESSING / *_PENDING / *_FAILED
 * holding state. This keeps settlement single-sourced and replay-safe.
 *
 * Deterministic: `now` is always passed in (never Date.now), and the provider is
 * the injected FakePaymentProvider in tests/simulation.
 *
 * A CREATED attempt that never received a provider response for longer than
 * RECOVERY_GRACE_MS is *resumed* with its ORIGINAL key — recovering a crash or
 * timeout between "provider charged" and "row written" without minting a second
 * PaymentIntent.
 */

const RECOVERY_GRACE_MS = 2 * 60_000; // 2 minutes

/** Decimal dollars → integer minor units (half-up), for the provider boundary. */
export function toMinorUnits(amount: Prisma.Decimal): number {
  return Number(amount.times(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP));
}

export type RunSummary = {
  claimed: number;
  processed: { scheduledChargeId: string; outcome: string }[];
};

/**
 * Process all charges that are due (fresh SCHEDULED with runAfter ≤ now) plus any
 * that are stuck mid-attempt (recovery). Optionally scoped to one org; a
 * platform sweep passes no organizationId.
 */
export async function runDueScheduledCharges(opts: { now: Date; organizationId?: string; limit?: number }): Promise<RunSummary> {
  const limit = opts.limit ?? 50;
  const orgScope = opts.organizationId ? { organizationId: opts.organizationId } : {};

  const due = await db.scheduledCharge.findMany({
    where: {
      ...orgScope,
      OR: [
        { status: "SCHEDULED", runAfter: { lte: opts.now } },
        // Recovery: a PROCESSING row whose latest attempt never got a response.
        { status: "PROCESSING", updatedAt: { lte: new Date(opts.now.getTime() - RECOVERY_GRACE_MS) } },
      ],
    },
    select: { id: true },
    orderBy: { runAfter: "asc" },
    take: limit,
  });

  const summary: RunSummary = { claimed: 0, processed: [] };
  for (const { id } of due) {
    try {
      const outcome = await processScheduledCharge(id, opts.now);
      if (outcome !== "skipped") summary.claimed += 1;
      summary.processed.push({ scheduledChargeId: id, outcome });
    } catch (e) {
      // A single charge failing must never abort the sweep.
      logger.error("payment runner: charge processing failed", { scheduledChargeId: id, error: String(e) });
      summary.processed.push({ scheduledChargeId: id, outcome: "error" });
    }
  }
  return summary;
}

type ClaimResult =
  | { kind: "skip"; reason: string }
  | { kind: "blocked"; reason: string }
  | { kind: "charge"; attemptId: string; idempotencyKey: string; input: CreateChargeInput; reviewId: string };

/**
 * Claim one charge and materialize (or resume) its PaymentAttempt inside a short
 * transaction. No network call happens here.
 */
async function claimCharge(scheduledChargeId: string, now: Date): Promise<ClaimResult> {
  return db.$transaction(async (tx) => {
    const sc = await tx.scheduledCharge.findUnique({
      where: { id: scheduledChargeId },
      include: {
        method: { include: { customer: true } },
        organization: { select: { id: true, planId: true, connectedAccount: true } },
        attempts: { orderBy: { attemptNumber: "desc" }, take: 1 },
      },
    });
    if (!sc) return { kind: "skip", reason: "not_found" };

    // The platform's cut sent as application_fee_amount — the amount ACCRUED at
    // approval, so the fee charged matches the fee booked (reconciled at settle).
    const fee = await tx.platformFee.findUnique({ where: { revenueReviewId: sc.revenueReviewId }, select: { amount: true, reversedAmount: true } });
    const feeMinor = fee ? toMinorUnits(fee.amount.minus(fee.reversedAmount)) : 0;

    // ---- Recovery path: a PROCESSING row with a still-CREATED latest attempt ----
    const latest = sc.attempts[0];
    if (sc.status === "PROCESSING") {
      if (!latest || latest.status !== "CREATED" || latest.providerPaymentIntentId) return { kind: "skip", reason: "in_flight" };
      if (latest.createdAt > new Date(now.getTime() - RECOVERY_GRACE_MS)) return { kind: "skip", reason: "too_fresh" };
      const input = buildChargeInput(sc, latest.idempotencyKey, latest.amount, feeMinor);
      if (!input) return { kind: "blocked", reason: "context_lost" };
      return { kind: "charge", attemptId: latest.id, idempotencyKey: latest.idempotencyKey, input, reviewId: sc.revenueReviewId };
    }

    // ---- Fresh path: only a SCHEDULED, due row ----
    if (sc.status !== "SCHEDULED") return { kind: "skip", reason: `status_${sc.status}` };
    if (sc.runAfter && sc.runAfter > now) return { kind: "skip", reason: "not_due" };

    // Re-validate the charge gate at run time (state may have changed since approval).
    const account = sc.organization.connectedAccount;
    if (!account || !accountReadyForCharge({
      providerAccountId: account.providerAccountId, chargesEnabled: account.chargesEnabled,
      payoutsEnabled: account.payoutsEnabled, detailsSubmitted: account.detailsSubmitted,
      requirementsDue: account.requirementsDue as never, suspendedAt: account.suspendedAt, deauthorizedAt: account.deauthorizedAt,
    })) {
      await tx.scheduledCharge.updateMany({ where: { id: sc.id, status: "SCHEDULED" }, data: { status: "AWAITING_MANUAL" } });
      return { kind: "blocked", reason: "account_not_ready" };
    }
    if (!sc.method || sc.method.status !== "ACTIVE" || sc.method.detachedAt) {
      await tx.scheduledCharge.updateMany({ where: { id: sc.id, status: "SCHEDULED" }, data: { status: "AWAITING_MANUAL" } });
      return { kind: "blocked", reason: "no_active_method" };
    }

    const attemptNumber = sc.attemptCount + 1;
    const idempotencyKey = chargeIdempotencyKey(sc.id, attemptNumber);

    // Claim: exactly one worker flips SCHEDULED → PROCESSING.
    const claim = await tx.scheduledCharge.updateMany({
      where: { id: sc.id, status: "SCHEDULED" },
      data: { status: "PROCESSING", attemptCount: attemptNumber },
    });
    if (claim.count === 0) return { kind: "skip", reason: "lost_claim" };

    const trigger: PaymentAttemptTrigger =
      sc.policy === "IMMEDIATE_ON_APPROVAL" ? "IMMEDIATE_ON_APPROVAL" : attemptNumber > 1 ? "AUTO_RETRY" : "BATCH";

    const attempt = await tx.paymentAttempt.create({
      data: {
        organizationId: sc.organizationId,
        scheduledChargeId: sc.id,
        attemptNumber,
        invoiceId: sc.invoiceId,
        idempotencyKey,
        provider: "STRIPE",
        status: "CREATED",
        trigger,
        amount: sc.amount,
        currency: sc.currency,
        methodType: sc.method.type,
        methodBrand: sc.method.brand,
        methodLast4: sc.method.last4,
        initiatedByLabel: "system:payment-runner",
      },
    });
    await tx.scheduledCharge.update({ where: { id: sc.id }, data: { lastAttemptId: attempt.id } });

    // Move the review into the processing holding state (settlement is the webhook's job).
    await transitionReview(tx, sc.revenueReviewId, "PAYMENT_PROCESSING");

    const input = buildChargeInput(sc, idempotencyKey, sc.amount, feeMinor);
    if (!input) return { kind: "blocked", reason: "context_lost" };
    return { kind: "charge", attemptId: attempt.id, idempotencyKey, input, reviewId: sc.revenueReviewId };
  });
}

type ScWithContext = Prisma.ScheduledChargeGetPayload<{
  include: { method: { include: { customer: true } }; organization: { select: { id: true; planId: true; connectedAccount: true } } };
}>;

/** Assemble the provider charge input from the outbox row's resolved context. */
function buildChargeInput(sc: ScWithContext, idempotencyKey: string, amount: Prisma.Decimal, applicationFeeMinor: number): CreateChargeInput | null {
  const account = sc.organization.connectedAccount;
  const method = sc.method;
  if (!account?.providerAccountId || !method?.customer?.providerCustomerId || !method.providerPaymentMethodId) return null;
  return {
    accountRef: account.providerAccountId,
    amount: toMinorUnits(amount),
    currency: sc.currency,
    customerRef: method.customer.providerCustomerId,
    methodRef: method.providerPaymentMethodId,
    applicationFeeAmount: applicationFeeMinor,
    idempotencyKey,
    offSession: true, // the payer is not present; runner is unattended
    metadata: { reviewId: sc.revenueReviewId, invoiceId: sc.invoiceId, scheduledChargeId: sc.id },
  };
}

/** Execute the provider call OUTSIDE any transaction, then record the outcome. */
async function processScheduledCharge(scheduledChargeId: string, now: Date): Promise<string> {
  const claim = await claimCharge(scheduledChargeId, now);
  if (claim.kind === "skip") return "skipped";
  if (claim.kind === "blocked") return `blocked:${claim.reason}`;

  const provider = getPaymentProvider();
  if (!provider) {
    // Charging turned off between claim and execute — release back to manual.
    await db.scheduledCharge.update({ where: { id: scheduledChargeId }, data: { status: "AWAITING_MANUAL" } });
    return "blocked:charging_off";
  }

  let charge: ProviderCharge;
  try {
    charge = await provider.createCharge(claim.input);
  } catch (e) {
    // INDETERMINATE failure (timeout/network). Do NOT fail or re-key: leave the
    // attempt CREATED and the charge PROCESSING so recovery resumes the SAME key.
    logger.warn("payment runner: provider call errored (will recover)", { scheduledChargeId, attemptId: claim.attemptId, error: String(e) });
    await db.scheduledCharge.update({ where: { id: scheduledChargeId }, data: { updatedAt: now } }).catch(() => {});
    return "indeterminate";
  }

  return recordChargeOutcome(scheduledChargeId, claim.attemptId, claim.reviewId, charge, now);
}

/** Persist a definite provider outcome and move the review to its holding state. */
async function recordChargeOutcome(
  scheduledChargeId: string, attemptId: string, reviewId: string, charge: ProviderCharge, now: Date,
): Promise<string> {
  return db.$transaction(async (tx) => {
    const attempt = await tx.paymentAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt || attempt.status !== "CREATED") return "already_recorded"; // replay guard

    switch (charge.status) {
      case "succeeded":
        // Card authorized+captured. Settlement (J2, Payment, CARD_PAID) is the
        // webhook's job; here we only pin the intent id and keep PROCESSING.
        await tx.paymentAttempt.update({ where: { id: attemptId }, data: { providerPaymentIntentId: charge.paymentIntentRef, status: "PROCESSING", processingAt: now } });
        return "succeeded_awaiting_settlement";
      case "processing":
        // ACH debit initiated — pending window; review → ACH_PENDING.
        await tx.paymentAttempt.update({ where: { id: attemptId }, data: { providerPaymentIntentId: charge.paymentIntentRef, status: "PROCESSING", processingAt: now } });
        await transitionReview(tx, reviewId, "ACH_PENDING");
        return "ach_processing";
      case "requires_action":
        // Off-session cannot complete a 3DS challenge — a hard fail for auto-charge.
        return failAttempt(tx, scheduledChargeId, attemptId, reviewId, charge.paymentIntentRef, "requires_action", "Card requires customer authentication.", now);
      case "failed":
        return failAttempt(tx, scheduledChargeId, attemptId, reviewId, charge.paymentIntentRef, charge.rawStatus, "The charge was declined.", now);
      case "canceled":
        await tx.paymentAttempt.update({ where: { id: attemptId }, data: { providerPaymentIntentId: charge.paymentIntentRef, status: "CANCELLED", cancelledAt: now } });
        await tx.scheduledCharge.update({ where: { id: scheduledChargeId }, data: { status: "FAILED" } });
        await transitionReview(tx, reviewId, "PAYMENT_FAILED"); // never leave the review stuck in PROCESSING
        return "canceled";
    }
  });
}

async function failAttempt(
  tx: Prisma.TransactionClient, scheduledChargeId: string, attemptId: string, reviewId: string,
  intentRef: string | undefined, failureCode: string, failureMessage: string, now: Date,
): Promise<string> {
  await tx.paymentAttempt.update({
    where: { id: attemptId },
    data: { providerPaymentIntentId: intentRef ?? null, status: "FAILED", failedAt: now, failureCode, failureMessage },
  });
  await tx.scheduledCharge.update({ where: { id: scheduledChargeId }, data: { status: "FAILED" } });
  await transitionReview(tx, reviewId, "PAYMENT_FAILED");
  return `failed:${failureCode}`;
}

/** Guarded review transition — never forces an illegal edge (doc 03 §2). */
async function transitionReview(tx: Prisma.TransactionClient, reviewId: string, to: RevenueReviewStatus): Promise<void> {
  const review = await tx.revenueReview.findUnique({ where: { id: reviewId }, select: { status: true } });
  if (!review) return;
  if (review.status === to) return;
  if (!canTransition(review.status, to)) return; // idempotent / out-of-order safe
  await tx.revenueReview.update({ where: { id: reviewId }, data: { status: to } });
}
