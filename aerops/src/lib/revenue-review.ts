import type { Prisma, RevenueReviewStatus } from "@prisma/client";

/**
 * Revenue Review engine (doc 03, ADR-025). The Revenue Review is the
 * customer-facing workflow layer wrapping a backend Invoice: aircraft return
 * creates a DRAFT review + its DRAFT invoice in one transaction, an instructor
 * confirms time, and Operations approves — freezing an immutable snapshot.
 *
 * Phase 2 Tail (this file's first cut) owns creation + numbering + the status
 * catalog. The full transition machine, approval, and snapshot land in Phase 3.
 */

/** Allocate the next value from a per-org sequence (doc 13 OrgSequence, R3). */
export async function nextOrgSequence(tx: Prisma.TransactionClient, organizationId: string, key: string): Promise<number> {
  const row = await tx.orgSequence.upsert({
    where: { organizationId_key: { organizationId, key } },
    create: { organizationId, key, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });
  return row.nextValue - 1;
}

export const reviewNumber = (seq: number) => `RR-${String(seq).padStart(5, "0")}`;
export const invoiceNumber = (seq: number) => `INV-${String(seq).padStart(5, "0")}`;

/**
 * Legal Revenue Review status transitions (doc 03 §2). Phase 2 Tail creates
 * reviews in DRAFT (or AWAITING_INSTRUCTOR_REVIEW when instructor time is
 * required); the transition guard is enforced in Phase 3's approval engine.
 * Terminal states (PAID, REFUNDED, VOIDED, WRITTEN_OFF) have no outbound edges
 * here; payment-side transitions (PAYMENT_* → CARD_PAID/ACH_PENDING/PAID) are
 * driven by the payment engine in Phase 5.
 */
export const REVIEW_TRANSITIONS: Record<RevenueReviewStatus, RevenueReviewStatus[]> = {
  DRAFT: ["AWAITING_INSTRUCTOR_REVIEW", "AWAITING_OPERATIONS_REVIEW", "VOIDED"],
  AWAITING_INSTRUCTOR_REVIEW: ["AWAITING_OPERATIONS_REVIEW", "CHANGES_REQUESTED", "VOIDED"],
  AWAITING_OPERATIONS_REVIEW: ["APPROVED", "CHANGES_REQUESTED", "VOIDED"],
  CHANGES_REQUESTED: ["AWAITING_INSTRUCTOR_REVIEW", "AWAITING_OPERATIONS_REVIEW", "VOIDED"],
  APPROVED: ["PAYMENT_SCHEDULED", "PAID", "VOIDED"],
  PAYMENT_SCHEDULED: ["PAYMENT_PROCESSING", "PAID", "PAYMENT_FAILED"],
  PAYMENT_PROCESSING: ["CARD_PAID", "ACH_PENDING", "PAID", "PAYMENT_FAILED"],
  CARD_PAID: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED", "DISPUTED"],
  ACH_PENDING: ["PAID", "PAYMENT_FAILED", "DISPUTED"],
  PAID: ["PARTIALLY_REFUNDED", "REFUNDED", "DISPUTED"],
  PAYMENT_FAILED: ["PAYMENT_SCHEDULED", "PAYMENT_PROCESSING", "VOIDED"],
  PARTIALLY_REFUNDED: ["REFUNDED", "DISPUTED"],
  REFUNDED: [],
  VOIDED: [],
  DISPUTED: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"],
  // WRITTEN_OFF has no inbound edge yet — write-off is a later phase (doc 03
  // "supported later"). It is intentionally unreachable via canTransition until
  // its inbound transition (from PAYMENT_FAILED / DISPUTED) is designed.
  WRITTEN_OFF: [],
};

export function canTransition(from: RevenueReviewStatus, to: RevenueReviewStatus): boolean {
  return REVIEW_TRANSITIONS[from].includes(to);
}

/** Statuses in which the review's snapshot is frozen and lines are immutable. */
export const APPROVED_OR_LATER: RevenueReviewStatus[] = [
  "APPROVED", "PAYMENT_SCHEDULED", "PAYMENT_PROCESSING", "CARD_PAID", "ACH_PENDING",
  "PAID", "PAYMENT_FAILED", "PARTIALLY_REFUNDED", "REFUNDED", "DISPUTED", "WRITTEN_OFF",
];
export const isFrozen = (status: RevenueReviewStatus) => APPROVED_OR_LATER.includes(status);

/** Statuses an instructor may submit from (→ Awaiting Operations Review). */
export const SUBMITTABLE: RevenueReviewStatus[] = ["DRAFT", "AWAITING_INSTRUCTOR_REVIEW", "CHANGES_REQUESTED"];
/** Statuses Operations may approve / request changes / void from. */
export const APPROVABLE: RevenueReviewStatus[] = ["AWAITING_OPERATIONS_REVIEW"];
/** Statuses a review may still be voided from (pre-payment only). */
export const VOIDABLE: RevenueReviewStatus[] = ["DRAFT", "AWAITING_INSTRUCTOR_REVIEW", "AWAITING_OPERATIONS_REVIEW", "CHANGES_REQUESTED", "APPROVED"];

type PolicyInputs = {
  operationsApprovalRequired: boolean;
  secondApprovalAmountThreshold: unknown | null; // Prisma.Decimal | null
  financeApprovalRequired: boolean;
};

/**
 * The approval kinds a review needs before it can reach APPROVED (doc 03 §2).
 * OPERATIONS is always required; SECOND when the total crosses the org's
 * threshold or the review was flagged for a second approval (manual item,
 * damage fee, discount over policy); FINANCE when the org requires it.
 */
export function requiredApprovalKinds(
  policy: PolicyInputs,
  total: number,
  reviewSecondApprovalRequired: boolean,
): ("OPERATIONS" | "SECOND" | "FINANCE")[] {
  const kinds: ("OPERATIONS" | "SECOND" | "FINANCE")[] = [];
  if (policy.operationsApprovalRequired) kinds.push("OPERATIONS");
  const threshold = policy.secondApprovalAmountThreshold == null ? null : Number(policy.secondApprovalAmountThreshold);
  // Strict greater-than: OVER_THRESHOLD means total EXCEEDS the threshold (doc 03 §2.5).
  if (reviewSecondApprovalRequired || (threshold != null && total > threshold)) kinds.push("SECOND");
  if (policy.financeApprovalRequired) kinds.push("FINANCE");
  // A review must always have at least one approvable path — a zero-approver
  // policy (operationsApprovalRequired=false, no threshold/flag/finance) would
  // otherwise be permanently unapprovable (doc 03 §3 refuses zero-approver configs).
  if (kinds.length === 0) kinds.push("OPERATIONS");
  return kinds;
}

/**
 * The immutable snapshot frozen at approval (doc 03 §2.7, principle 5). A
 * point-in-time financial fact — never recomputed. Stored on
 * RevenueReview.approvalSnapshot (JSON) alongside totalAtApproval and
 * paymentPolicyAtApproval. Contains NO payment-provider state.
 */
export type ApprovalSnapshot = {
  version: 1;
  frozenAt: string;
  currency: string;
  lines: { kind: string; description: string; quantity: string; unitPrice: string; lineTotal: string }[];
  subtotal: string;
  tax: { total: string; perRule: { ruleKey: string; jurisdiction: string; tax: string }[] };
  total: string;
  paymentPolicy: string;
  platformFee: null; // placeholder only — computed/collected in Parts 2–3 (no value frozen yet)
  approvals: { kind: string; approverLabel: string; at: string }[];
};
