import { Prisma, type PaymentMethod as LegacyPaymentMethod, type RevenueReviewStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getPaymentProvider } from "@/lib/payment-service";
import { postJournal } from "@/lib/ledger";
import { buildSettlementJournalLines } from "@/lib/revenue-journals";
import { canTransition } from "@/lib/revenue-review";
import { reduceAccountSync } from "@/lib/connected-account";
import type { ProviderWebhookEvent } from "@/lib/payment-provider";

/**
 * Webhook ingestion + settlement (doc 28 §"settlement", doc 39 §8, spec Part L).
 *
 * This module is the SINGLE writer of settlement: the Payment row, the J2
 * settlement journal, PlatformFee → EARNED, and the review's paid/failed
 * transition all happen here and NOWHERE else. That single-writer rule is what
 * makes settlement exactly-once and webhook-replay safe.
 *
 * Store-then-process (spec Part L):
 *   1. Verify the signature (provider.parseWebhookEvent throws on mismatch).
 *   2. Resolve the org from the signed account id — the ONLY trusted tenant key
 *      (never a body field).
 *   3. Persist the event first (PaymentProviderEvent @@unique(provider,eventId));
 *      a duplicate delivery hits the unique and is dropped without reprocessing.
 *   4. Process. Settlement additionally flips the attempt PROCESSING→SUCCEEDED
 *      with a conditional updateMany, so even a replay that slipped past the
 *      store guard cannot post the ledger twice (count 0 → already settled).
 */

export type IngestResult =
  | { status: "ignored_no_provider" }
  | { status: "invalid_signature" }
  | { status: "duplicate"; providerEventId: string }
  | { status: "unmapped"; providerEventId: string } // no org for the account
  | { status: "processed"; providerEventId: string; outcome: string }
  | { status: "deferred"; providerEventId: string; error: string }; // stored, will retry

/**
 * Verify, store, and process one raw webhook delivery. `now` is caller-passed so
 * every settlement/earned/effective timestamp is deterministic and this engine
 * stays reproducible (parity with the runner/refund engines).
 */
export async function ingestWebhookEvent(signature: string, raw: string, endpoint: "connect" | "platform", now: Date): Promise<IngestResult> {
  const provider = getPaymentProvider();
  if (!provider) return { status: "ignored_no_provider" };

  let event: ProviderWebhookEvent;
  try {
    event = provider.parseWebhookEvent(signature, raw, endpoint);
  } catch {
    return { status: "invalid_signature" };
  }

  // Tenant resolution from the SIGNED account id only.
  const organizationId = event.accountRef
    ? (await db.connectedAccount.findUnique({ where: { provider_providerAccountId: { provider: "STRIPE", providerAccountId: event.accountRef } }, select: { organizationId: true } }))?.organizationId ?? null
    : null;

  // Store first (durability + dedupe). A duplicate delivery throws P2002 — but a
  // redelivery of an event we stored yet never finished processing (it deferred
  // on a race) must be REPROCESSED, not dropped, or a raced settlement would
  // stall forever waiting on an internal sweep. So: drop only if it already
  // processed; otherwise fall through and retry it.
  try {
    await db.paymentProviderEvent.create({
      data: { provider: "STRIPE", providerEventId: event.providerEventId, type: event.type, payload: raw as unknown as Prisma.InputJsonValue, organizationId },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const prior = await db.paymentProviderEvent.findUnique({ where: { provider_providerEventId: { provider: "STRIPE", providerEventId: event.providerEventId } }, select: { processedAt: true } });
      if (prior?.processedAt) return { status: "duplicate", providerEventId: event.providerEventId };
      // stored-but-unprocessed → fall through and reprocess (idempotent handlers)
    } else {
      throw e;
    }
  }

  // account.updated can arrive before any org-scoped charge; it still resolves an
  // org (the account IS the org). Other event types with no org are unmapped.
  if (!organizationId && event.type !== "account.updated") {
    return { status: "unmapped", providerEventId: event.providerEventId };
  }

  try {
    const outcome = await processEvent(event, organizationId, now);
    await db.paymentProviderEvent.updateMany({ where: { provider: "STRIPE", providerEventId: event.providerEventId }, data: { processedAt: now } });
    return { status: "processed", providerEventId: event.providerEventId, outcome };
  } catch (e) {
    // Leave processedAt null so a retry (or the reconciliation sweep) picks it up.
    await db.paymentProviderEvent.updateMany({ where: { provider: "STRIPE", providerEventId: event.providerEventId }, data: { processingError: String(e).slice(0, 500) } });
    logger.error("webhook processing deferred", { providerEventId: event.providerEventId, type: event.type, error: String(e) });
    return { status: "deferred", providerEventId: event.providerEventId, error: String(e) };
  }
}

type EventObject = { id?: string; object?: string; payment_intent?: string; status?: string; amount?: number; application_fee?: string } & Record<string, unknown>;

function eventObject(event: ProviderWebhookEvent): EventObject {
  const data = event.data as { object?: EventObject } | undefined;
  return data?.object ?? {};
}

/** The PaymentIntent ref a settlement/failure event refers to. */
function paymentIntentRef(obj: EventObject): string | null {
  if (obj.object === "payment_intent") return obj.id ?? null;
  return obj.payment_intent ?? null;
}

async function processEvent(event: ProviderWebhookEvent, organizationId: string | null, now: Date): Promise<string> {
  switch (event.type) {
    case "payment_intent.succeeded":
      return settleSucceeded(event, organizationId!, now);
    case "payment_intent.payment_failed":
      return handleFailed(event, organizationId!, now);
    case "payment_intent.processing":
      return handleProcessing(event, organizationId!);
    case "account.updated":
      return handleAccountUpdated(event, organizationId, now);
    case "charge.dispute.created":
      return handleDisputeOpened(event, organizationId!, now);
    case "charge.dispute.closed":
      return handleDisputeClosed(event, organizationId!, now);
    default:
      return `ignored:${event.type}`; // charge.refunded is driven by the refund engine's own record
  }
}

const REVIEW_PAID: Record<"CARD" | "US_BANK_ACCOUNT", RevenueReviewStatus> = { CARD: "CARD_PAID", US_BANK_ACCOUNT: "PAID" };

/**
 * Settle a successful charge — the money-moving path. Exactly-once via the
 * conditional attempt flip; balanced via postJournal's assertion.
 */
async function settleSucceeded(event: ProviderWebhookEvent, organizationId: string, now: Date): Promise<string> {
  const piRef = paymentIntentRef(eventObject(event));
  if (!piRef) throw new Error("payment_intent.succeeded without a resolvable intent id");

  return db.$transaction(async (tx) => {
    const attempt = await tx.paymentAttempt.findUnique({
      where: { provider_providerPaymentIntentId: { provider: "STRIPE", providerPaymentIntentId: piRef } },
      include: { scheduledCharge: true },
    });
    // The runner writes providerPaymentIntentId before/at outcome-recording; if
    // it is not here yet the webhook raced ahead — throw to retry, never guess.
    if (!attempt) throw new Error(`no PaymentAttempt for intent ${piRef} yet`);
    // Tenant integrity: the signed account's org must own this attempt.
    if (attempt.organizationId !== organizationId) throw new Error("account/org mismatch on settlement");

    // Atomic exactly-once flip. count 0 ⇒ already settled (replay) ⇒ no posting.
    const claim = await tx.paymentAttempt.updateMany({
      where: { id: attempt.id, status: { in: ["PROCESSING", "CREATED"] } },
      data: { status: "SUCCEEDED", settledAt: now, providerPaymentIntentId: piRef },
    });
    if (claim.count === 0) return "already_settled";

    await tx.scheduledCharge.update({ where: { id: attempt.scheduledChargeId }, data: { status: "COMPLETED" } });

    const total = attempt.amount;
    const fee = await tx.platformFee.findUnique({ where: { revenueReviewId: attempt.scheduledCharge.revenueReviewId }, select: { id: true, amount: true, reversedAmount: true } });
    const feeAmount = fee ? fee.amount.minus(fee.reversedAmount) : new Prisma.Decimal(0);

    // J2 settlement: A/R cleared; proceeds land in clearing; the platform fee is
    // the school's expense (deducted at the source by the direct-charge model).
    const lines = buildSettlementJournalLines({ total, platformFee: feeAmount });
    await postJournal(tx, {
      organizationId, journalId: `jrnl_${attempt.scheduledCharge.revenueReviewId}_settled`,
      event: "payment.settled", sourceType: "PaymentAttempt", sourceId: attempt.id,
      currency: attempt.currency, effectiveAt: now, lines,
    });

    // Platform fee → EARNED (idempotent: only from ACCRUED).
    if (fee) {
      await tx.platformFee.updateMany({ where: { id: fee.id, status: "ACCRUED" }, data: { status: "EARNED", earnedAt: now, providerRef: eventObject(event).application_fee ?? null } });
    }

    const legacyMethod: LegacyPaymentMethod = attempt.methodType === "US_BANK_ACCOUNT" ? "ACH" : "CARD";
    // Payment.paymentAttemptId is @unique — a third-layer dedupe.
    await tx.payment.create({
      data: {
        organizationId, invoiceId: attempt.invoiceId, amount: total, currency: attempt.currency,
        method: legacyMethod, reference: piRef, paymentAttemptId: attempt.id,
      },
    });
    await tx.invoice.update({ where: { id: attempt.invoiceId }, data: { status: "PAID" } });

    await transitionReview(tx, attempt.scheduledCharge.revenueReviewId, REVIEW_PAID[attempt.methodType ?? "CARD"]);
    return `settled:${legacyMethod}`;
  });
}

/** A charge failed at the provider (sync decline late, or an ACH return R01…). */
async function handleFailed(event: ProviderWebhookEvent, organizationId: string, now: Date): Promise<string> {
  const obj = eventObject(event);
  const piRef = paymentIntentRef(obj);
  if (!piRef) throw new Error("payment_failed without a resolvable intent id");
  return db.$transaction(async (tx) => {
    const attempt = await tx.paymentAttempt.findUnique({ where: { provider_providerPaymentIntentId: { provider: "STRIPE", providerPaymentIntentId: piRef } }, include: { scheduledCharge: true } });
    if (!attempt) throw new Error(`no PaymentAttempt for intent ${piRef}`);
    if (attempt.organizationId !== organizationId) throw new Error("account/org mismatch on failure");
    const claim = await tx.paymentAttempt.updateMany({
      where: { id: attempt.id, status: { in: ["PROCESSING", "CREATED"] } },
      data: { status: "FAILED", failedAt: now, failureCode: String(obj.status ?? "failed"), failureMessage: "The payment failed at the provider." },
    });
    if (claim.count === 0) {
      // The attempt already SUCCEEDED — this is a POST-SETTLEMENT return/reversal
      // (e.g. a late ACH R-code). Money we booked as collected is being clawed
      // back. We must NEVER silently drop it: raise a reconciliation exception so
      // a human reverses the settlement. (Auto-reversal of a settled ACH is a
      // tracked follow-up; the review stays paid until then, but flagged.)
      if (attempt.status === "SUCCEEDED") {
        await tx.reconciliationException.create({
          data: {
            organizationId, kind: "AMOUNT_MISMATCH", status: "OPEN", providerRef: piRef,
            sourceType: "PaymentAttempt", sourceId: attempt.id, currency: attempt.currency,
            expectedAmount: attempt.amount, actualAmount: new Prisma.Decimal(0), detectedAt: now,
          },
        });
        logger.error("post-settlement payment failure — reconciliation exception raised", { attemptId: attempt.id, piRef });
        return "post_settlement_return_flagged";
      }
      return "already_terminal";
    }
    await tx.scheduledCharge.update({ where: { id: attempt.scheduledChargeId }, data: { status: "FAILED" } });
    await transitionReview(tx, attempt.scheduledCharge.revenueReviewId, "PAYMENT_FAILED");
    return "failed";
  });
}

/** ACH pending confirmation — the review is already ACH_PENDING; idempotent. */
async function handleProcessing(event: ProviderWebhookEvent, organizationId: string): Promise<string> {
  const piRef = paymentIntentRef(eventObject(event));
  if (!piRef) return "ignored_no_intent";
  const attempt = await db.paymentAttempt.findUnique({ where: { provider_providerPaymentIntentId: { provider: "STRIPE", providerPaymentIntentId: piRef } }, include: { scheduledCharge: true } });
  if (!attempt || attempt.organizationId !== organizationId) return "ignored";
  await db.$transaction((tx) => transitionReview(tx, attempt.scheduledCharge.revenueReviewId, "ACH_PENDING"));
  return "processing";
}

/** Mirror connected-account state changes (doc 19), out-of-order safe. */
async function handleAccountUpdated(event: ProviderWebhookEvent, organizationId: string | null, now: Date): Promise<string> {
  if (!organizationId || !event.accountRef) return "unmapped";
  const obj = eventObject(event) as Record<string, unknown>;
  return db.$transaction(async (tx) => {
    const current = await tx.connectedAccount.findUnique({ where: { organizationId } });
    if (!current) return "no_account";
    const req = (obj.requirements ?? {}) as { currently_due?: string[]; eventually_due?: string[]; past_due?: string[]; current_deadline?: number | null };
    const update = reduceAccountSync(
      { providerStateAsOf: current.providerStateAsOf, firstEnabledAt: current.firstEnabledAt, suspendedAt: current.suspendedAt, deauthorizedAt: current.deauthorizedAt },
      {
        accountRef: event.accountRef!,
        chargesEnabled: Boolean(obj.charges_enabled),
        payoutsEnabled: Boolean(obj.payouts_enabled),
        detailsSubmitted: Boolean(obj.details_submitted),
        requirements: {
          currentlyDue: req.currently_due ?? [], eventuallyDue: req.eventually_due ?? [],
          pastDue: req.past_due ?? [], currentDeadline: req.current_deadline ? new Date(req.current_deadline * 1000).toISOString() : null,
        },
        disabledReason: (req as { disabled_reason?: string }).disabled_reason ?? null,
        country: String(obj.country ?? "US"), defaultCurrency: String(obj.default_currency ?? "usd"),
        businessType: (obj.business_type as string) ?? null, capabilities: null,
        providerStateAsOf: now,
      },
      now,
    );
    if (!update) return "stale_skipped";
    await tx.connectedAccount.update({ where: { organizationId }, data: update });
    return "account_synced";
  });
}

/**
 * A dispute (chargeback) was opened. Record it (idempotent via
 * @@unique(provider, providerDisputeId)), move the review to DISPUTED, and — for
 * a student-billed review — place a FinancialHold so ops sees the risk. No money
 * moves yet; the funds are held by the provider until the dispute resolves.
 */
async function handleDisputeOpened(event: ProviderWebhookEvent, organizationId: string, now: Date): Promise<string> {
  const obj = eventObject(event);
  const piRef = paymentIntentRef(obj);
  if (!piRef) throw new Error("dispute without a resolvable intent id");
  return db.$transaction(async (tx) => {
    const attempt = await tx.paymentAttempt.findUnique({ where: { provider_providerPaymentIntentId: { provider: "STRIPE", providerPaymentIntentId: piRef } }, include: { scheduledCharge: { include: { review: { select: { id: true, studentId: true } } } } } });
    if (!attempt) throw new Error(`no PaymentAttempt for disputed intent ${piRef}`);
    if (attempt.organizationId !== organizationId) throw new Error("account/org mismatch on dispute");
    const payment = await tx.payment.findFirst({ where: { paymentAttemptId: attempt.id }, select: { id: true } });
    const review = attempt.scheduledCharge.review;
    const disputeId = String(obj.id ?? piRef);

    try {
      await tx.dispute.create({
        data: {
          organizationId, invoiceId: attempt.invoiceId, revenueReviewId: review.id, paymentId: payment?.id ?? null,
          provider: "STRIPE", providerDisputeId: disputeId, amount: attempt.amount, currency: attempt.currency,
          reason: (obj.reason as string) ?? null, status: "OPEN",
          evidenceDueBy: obj.evidence_due_by ? new Date(Number(obj.evidence_due_by) * 1000) : null,
          openedAt: now,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return "dispute_duplicate";
      throw e;
    }

    await transitionReview(tx, review.id, "DISPUTED");
    if (review.studentId) {
      const active = await tx.financialHold.findFirst({ where: { organizationId, studentId: review.studentId, status: "ACTIVE" } });
      if (!active) {
        await tx.financialHold.create({
          data: { organizationId, studentId: review.studentId, status: "ACTIVE", source: "POLICY_ESCALATION", reason: `Chargeback opened on payment ${payment?.id ?? piRef}`, contextReviewIds: [review.id], placedByLabel: "system:payment-runner" },
        });
      }
    }
    return "dispute_opened";
  });
}

/**
 * A dispute closed. WON → review returns toward paid; LOST → the money is gone
 * (the provider has already pulled the funds + fee), so we reverse the platform
 * fee to match economic reality and leave the review DISPUTED-resolved.
 */
async function handleDisputeClosed(event: ProviderWebhookEvent, organizationId: string, now: Date): Promise<string> {
  const obj = eventObject(event);
  const disputeId = String(obj.id ?? "");
  const won = obj.status === "won" || (obj as { resolution?: string }).resolution === "won";
  return db.$transaction(async (tx) => {
    const dispute = await tx.dispute.findUnique({ where: { provider_providerDisputeId: { provider: "STRIPE", providerDisputeId: disputeId } } });
    if (!dispute || dispute.organizationId !== organizationId) return "unknown_dispute";
    if (dispute.status === "WON" || dispute.status === "LOST") return "already_resolved";
    await tx.dispute.update({ where: { id: dispute.id }, data: { status: won ? "WON" : "LOST", resolvedAt: now } });

    if (dispute.revenueReviewId) {
      if (won) {
        // Won: funds retained. The review returns to paid — never leave it stuck
        // in DISPUTED. (Card path was CARD_PAID before the dispute; DISPUTED→PAID
        // is the resolved-paid terminal.)
        await transitionReview(tx, dispute.revenueReviewId, "PAID");
      } else {
        // Lost: the provider pulled the funds + fee back. Reverse the platform fee
        // to match reality and move the review to REFUNDED (money left the school).
        const fee = await tx.platformFee.findUnique({ where: { revenueReviewId: dispute.revenueReviewId }, select: { id: true, amount: true, reversedAmount: true } });
        if (fee && fee.reversedAmount.lessThan(fee.amount)) {
          await tx.platformFee.update({ where: { id: fee.id }, data: { reversedAmount: fee.amount, status: "REVERSED" } });
        }
        await transitionReview(tx, dispute.revenueReviewId, "REFUNDED");
      }
    }
    return won ? "dispute_won" : "dispute_lost";
  });
}

async function transitionReview(tx: Prisma.TransactionClient, reviewId: string, to: RevenueReviewStatus): Promise<void> {
  const review = await tx.revenueReview.findUnique({ where: { id: reviewId }, select: { status: true } });
  if (!review || review.status === to) return;
  if (!canTransition(review.status, to)) return;
  await tx.revenueReview.update({ where: { id: reviewId }, data: { status: to } });
}
