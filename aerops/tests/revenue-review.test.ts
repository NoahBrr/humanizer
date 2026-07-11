import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { canTransition, isFrozen, REVIEW_TRANSITIONS, reviewNumber, invoiceNumber, requiredApprovalKinds } from "@/lib/revenue-review";

// Static guard for the ADR-025 closeout flip (the repo tests the close route by
// source scan — there is no DB-backed harness). These pin the invariants the
// three-reviewer pass called out: return creates a DRAFT review + DRAFT invoice
// and does NOT move the student's balance (nothing is owed until approval).
const closeSrc = readFileSync(path.resolve(__dirname, "../src/app/api/dispatch/[id]/close/route.ts"), "utf8");

describe("closeout ADR-025 flip (source invariants)", () => {
  it("creates a DRAFT Revenue Review wrapping a DRAFT invoice", () => {
    expect(closeSrc).toMatch(/tx\.revenueReview\.create/);
    expect(closeSrc).toMatch(/status:\s*"DRAFT"/);
  });
  it("does NOT decrement the student's account balance at closeout", () => {
    expect(closeSrc).not.toMatch(/accountBalance:\s*\{\s*decrement/);
  });
  it("still claims the RELEASED→CLOSED transition atomically (do-not-break rule 5)", () => {
    expect(closeSrc).toMatch(/updateMany\(\{[\s\S]*status:\s*"RELEASED"/);
    expect(closeSrc).toMatch(/\.count\s*===\s*0/);
  });
});

describe("Revenue Review status machine (doc 03)", () => {
  it("allows the happy-path lifecycle DRAFT → … → APPROVED", () => {
    expect(canTransition("DRAFT", "AWAITING_INSTRUCTOR_REVIEW")).toBe(true);
    expect(canTransition("AWAITING_INSTRUCTOR_REVIEW", "AWAITING_OPERATIONS_REVIEW")).toBe(true);
    expect(canTransition("AWAITING_OPERATIONS_REVIEW", "APPROVED")).toBe(true);
  });

  it("supports the changes-requested loop and void-before-approval", () => {
    expect(canTransition("AWAITING_OPERATIONS_REVIEW", "CHANGES_REQUESTED")).toBe(true);
    expect(canTransition("CHANGES_REQUESTED", "AWAITING_OPERATIONS_REVIEW")).toBe(true);
    expect(canTransition("DRAFT", "VOIDED")).toBe(true);
    expect(canTransition("AWAITING_INSTRUCTOR_REVIEW", "VOIDED")).toBe(true);
  });

  it("forbids illegal jumps (no skipping approval, no un-approving to draft)", () => {
    expect(canTransition("DRAFT", "APPROVED")).toBe(false);
    expect(canTransition("DRAFT", "PAID")).toBe(false);
    expect(canTransition("APPROVED", "DRAFT")).toBe(false);
    expect(canTransition("APPROVED", "AWAITING_OPERATIONS_REVIEW")).toBe(false);
  });

  it("terminal states have no outbound transitions", () => {
    for (const s of ["REFUNDED", "VOIDED", "WRITTEN_OFF"] as const) {
      expect(REVIEW_TRANSITIONS[s]).toEqual([]);
    }
  });

  it("freezes the snapshot at APPROVED and everything after; not before", () => {
    expect(isFrozen("DRAFT")).toBe(false);
    expect(isFrozen("AWAITING_OPERATIONS_REVIEW")).toBe(false);
    expect(isFrozen("CHANGES_REQUESTED")).toBe(false);
    expect(isFrozen("APPROVED")).toBe(true);
    expect(isFrozen("PAID")).toBe(true);
    expect(isFrozen("REFUNDED")).toBe(true);
  });

  it("formats zero-padded human numbers", () => {
    expect(reviewNumber(42)).toBe("RR-00042");
    expect(invoiceNumber(7)).toBe("INV-00007");
  });
});

describe("approval requirements (doc 03 §2)", () => {
  const base = { operationsApprovalRequired: true, secondApprovalAmountThreshold: null, financeApprovalRequired: false };

  it("requires only OPERATIONS for a routine review under threshold", () => {
    expect(requiredApprovalKinds(base, 250, false)).toEqual(["OPERATIONS"]);
  });
  it("adds SECOND only when the total strictly EXCEEDS the org threshold (doc 03 §2.5)", () => {
    const p = { ...base, secondApprovalAmountThreshold: 2500 };
    expect(requiredApprovalKinds(p, 2500, false)).toEqual(["OPERATIONS"]); // exactly at threshold: not over
    expect(requiredApprovalKinds(p, 2500.01, false)).toEqual(["OPERATIONS", "SECOND"]);
  });

  it("never returns an empty (unapprovable) set — falls back to OPERATIONS", () => {
    expect(requiredApprovalKinds({ operationsApprovalRequired: false, secondApprovalAmountThreshold: null, financeApprovalRequired: false }, 100, false)).toEqual(["OPERATIONS"]);
  });
  it("adds SECOND when the review is flagged (manual item / damage / discount) regardless of total", () => {
    expect(requiredApprovalKinds(base, 10, true)).toEqual(["OPERATIONS", "SECOND"]);
  });
  it("adds FINANCE when the org requires a separate finance approval", () => {
    const p = { ...base, financeApprovalRequired: true };
    expect(requiredApprovalKinds(p, 100, false)).toEqual(["OPERATIONS", "FINANCE"]);
  });
});

// The approval routes must never call a payment provider (Phase 3 rule): approval
// creates the immutable snapshot but no charge. Static guard over the route.
describe("approval routes carry no charge code", () => {
  const approveSrc = readFileSync(path.resolve(__dirname, "../src/app/api/revenue/reviews/[id]/approve/route.ts"), "utf8");
  it("the approve route freezes a snapshot and finalizes the invoice without any Stripe/charge call", () => {
    expect(approveSrc).toMatch(/approvalSnapshot/);
    expect(approveSrc).toMatch(/status:\s*"APPROVED"/);
    // No actual provider code (matching real usage, not the reassuring prose).
    expect(approveSrc).not.toMatch(/from ["']stripe|stripe\.|PaymentIntent|\.createCharge|getPaymentProvider/);
  });
  it("enforces separation of duties (no self-approval of risk-flagged / no double-sign)", () => {
    expect(approveSrc).toMatch(/separationOfDutiesRequired/);
    expect(approveSrc).toMatch(/riskFlags/);
    expect(approveSrc).toMatch(/already approved this review|different person must approve/i);
  });
  it("counts only non-superseded approvals (invalidation on Changes Requested)", () => {
    expect(approveSrc).toMatch(/supersededAt === null|supersededAt == null/);
  });
  it("locks the review row inside the approve tx before writing a signature (no partial-approval TOCTOU)", () => {
    // A guarded updateMany on the review row (status AWAITING_OPERATIONS_REVIEW)
    // runs inside the $transaction before the approval create, serializing
    // against a concurrent request-changes/void.
    const tx = approveSrc.slice(approveSrc.indexOf("$transaction"));
    const lockIdx = tx.indexOf("revenueReview.updateMany");
    const createIdx = tx.indexOf("revenueReviewApproval.create");
    expect(lockIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(-1);
    expect(lockIdx).toBeLessThan(createIdx); // lock precedes the signature insert
  });
  it("Request Changes supersedes live approval signatures so corrected numbers need fresh approval", () => {
    const rcSrc = readFileSync(path.resolve(__dirname, "../src/app/api/revenue/reviews/[id]/request-changes/route.ts"), "utf8");
    expect(rcSrc).toMatch(/revenueReviewApproval\.updateMany/);
    expect(rcSrc).toMatch(/supersededAt:\s*(new Date|null)/);
  });
});
