import type { Prisma, PaymentTimingPolicy, ScheduledChargeStatus } from "@prisma/client";

/**
 * Outbox scheduling at approval (doc 28 §"outbox", doc 39 §2/§8, ADR-037).
 *
 * The ScheduledCharge is the OUTBOX row: it is written INSIDE the approval
 * transaction (so approval and the intent-to-charge commit atomically), but NO
 * provider call happens here — a network call inside the money-moving tx is
 * forbidden. The background runner later claims the row and calls Stripe.
 *
 * revenueReviewId and invoiceId are both @unique on ScheduledCharge, so this can
 * create at most one outbox row per review — a retried approval can never mint a
 * second charge.
 *
 * Decision table (kept deliberately small — "five real flight schools"):
 *   MANUAL_INVOICE .............. no row (school bills offline)
 *   charging disabled ........... no row (degrade to manual invoice)
 *   no usable payment method .... AWAITING_MANUAL (staff must attach a method)
 *   connected account not ready . AWAITING_MANUAL (onboarding incomplete)
 *   MANUAL_CHARGE ............... AWAITING_MANUAL (staff presses "Charge now")
 *   IMMEDIATE_ON_APPROVAL ....... SCHEDULED, runAfter = approvedAt (due now)
 *   *_BATCH / CUSTOM_DATE ....... SCHEDULED, runAfter = next batch window
 */

export type SchedulingDecision =
  | { schedule: false; reason: "manual_invoice" | "charging_off" }
  | { schedule: true; status: ScheduledChargeStatus; runAfter: Date | null; reason: string };

/** Classify a timing policy into how the outbox should treat it. */
export function policyKind(policy: PaymentTimingPolicy): "immediate" | "batch" | "manual_charge" | "manual_invoice" {
  switch (policy) {
    case "MANUAL_INVOICE": return "manual_invoice";
    case "MANUAL_CHARGE": return "manual_charge";
    case "IMMEDIATE_ON_APPROVAL": return "immediate";
    default: return "batch"; // SAME_DAY_BATCH, NIGHTLY_BATCH, WEEKLY_BATCH, ACH_ONLY_BATCH, CUSTOM_DATE
  }
}

/**
 * Next batch window after `approvedAt`. Phase 5 (test mode) uses a simple next
 * UTC-midnight window for daily batches and +7d for weekly — the runner fires
 * whenever runAfter ≤ now, so the exact wall-clock only affects cadence, never
 * correctness. Org-timezone-aware batch windows are a deferred refinement
 * (tracked in ROADMAP); noted here so it is not mistaken for complete.
 */
export function nextBatchWindow(policy: PaymentTimingPolicy, approvedAt: Date): Date {
  const base = new Date(Date.UTC(approvedAt.getUTCFullYear(), approvedAt.getUTCMonth(), approvedAt.getUTCDate()));
  if (policy === "WEEKLY_BATCH") return new Date(base.getTime() + 7 * 86_400_000);
  return new Date(base.getTime() + 86_400_000); // next UTC midnight
}

/**
 * Decide the outbox action for a completing approval. Pure — the caller does the
 * ScheduledCharge write with `buildScheduledChargeData`.
 */
export function decideScheduling(input: {
  policy: PaymentTimingPolicy;
  chargingEnabled: boolean;
  hasPaymentMethod: boolean;
  accountReady: boolean;
  approvedAt: Date;
}): SchedulingDecision {
  const kind = policyKind(input.policy);
  if (kind === "manual_invoice") return { schedule: false, reason: "manual_invoice" };
  if (!input.chargingEnabled) return { schedule: false, reason: "charging_off" };

  // Blocked-but-owed: create the row so the receivable is tracked and staff can
  // act, but hold it out of the auto-runner until the block clears.
  if (!input.accountReady) return { schedule: true, status: "AWAITING_MANUAL", runAfter: null, reason: "account_not_ready" };
  if (!input.hasPaymentMethod) return { schedule: true, status: "AWAITING_MANUAL", runAfter: null, reason: "no_payment_method" };
  if (kind === "manual_charge") return { schedule: true, status: "AWAITING_MANUAL", runAfter: null, reason: "manual_charge" };
  if (kind === "immediate") return { schedule: true, status: "SCHEDULED", runAfter: input.approvedAt, reason: "immediate" };
  return { schedule: true, status: "SCHEDULED", runAfter: nextBatchWindow(input.policy, input.approvedAt), reason: "batch" };
}

/** Build the ScheduledCharge create payload for a positive scheduling decision. */
export function buildScheduledChargeData(input: {
  organizationId: string;
  revenueReviewId: string;
  invoiceId: string;
  policy: PaymentTimingPolicy;
  amount: Prisma.Decimal;
  currency: string;
  paymentMethodReferenceId: string | null;
  decision: Extract<SchedulingDecision, { schedule: true }>;
}): Prisma.ScheduledChargeUncheckedCreateInput {
  return {
    organizationId: input.organizationId,
    revenueReviewId: input.revenueReviewId,
    invoiceId: input.invoiceId,
    policy: input.policy,
    runAfter: input.decision.runAfter,
    amount: input.amount,
    currency: input.currency,
    paymentMethodReferenceId: input.paymentMethodReferenceId,
    status: input.decision.status,
  };
}
