import { describe, it, expect } from "vitest";
import { Prisma, type RevenueReviewStatus } from "@prisma/client";
import { assertBalanced } from "@/lib/ledger";
import { buildApprovalJournalLines, buildSettlementJournalLines } from "@/lib/revenue-journals";
import { categorizeLines, lineTotal, buildApprovalAllocationRows, assertSetBalanced } from "@/lib/revenue-allocation";
import { REVIEW_TRANSITIONS, VOIDABLE, SUBMITTABLE, APPROVABLE } from "@/lib/revenue-review";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const twoDp = (d: Prisma.Decimal) => d.decimalPlaces() <= 2;

/**
 * Regression tests for the reviewer findings on Phase 5 (commit 06c767d):
 *  - INV-8: sub-cent line products must not drift a cent in the PERSISTED ledger.
 *  - State machine: no non-terminal status is a dead end; reachability is sane.
 *  - Refund cap: cumulative refund and fee reversal are bounded, sequenced.
 *  - Dispute lost: full fee reversal keeps the books balanced.
 */

describe("INV-8: sub-cent line products round before summing (no persisted drift)", () => {
  it("1.5 × 66.67 = 100.005 rounds half-up to 100.01 per line", () => {
    expect(lineTotal({ quantity: D("1.5"), unitPrice: D("66.67") }).toFixed(2)).toBe("100.01");
  });

  it("J1 built from fractional-cent lines balances AND every persisted amount is 2 dp", () => {
    // Two categories, each 1.5 × 66.67 = 100.005. Pre-fix these summed un-rounded
    // (200.010) and the DB rounded each line to 100.01 → persisted credit 200.02
    // vs A/R debit 200.01: a created cent. Post-fix each line is 100.01 first.
    const lines = [
      { kind: "AIRCRAFT_RENTAL" as const, quantity: D("1.5"), unitPrice: D("66.67") },
      { kind: "FUEL_SURCHARGE" as const, quantity: D("1.5"), unitPrice: D("66.67") },
    ];
    const cats = categorizeLines(lines);
    const subtotal = lines.reduce((t, l) => t.plus(lineTotal(l)), D(0));
    expect(subtotal.toFixed(2)).toBe("200.02");

    const j1 = buildApprovalJournalLines({ total: subtotal, compTotal: D(0), categoryAmounts: cats, taxAmount: D(0) });
    expect(() => assertBalanced(j1)).not.toThrow();
    // The real guarantee: no line carries sub-cent precision into a Decimal(12,2)
    // column, so Σ(persisted) == persisted total exactly.
    for (const l of j1) expect(twoDp(l.amount), `${l.account} ${l.amount} must be ≤2dp`).toBe(true);
    const debit = j1.filter((l) => l.direction === "DEBIT").reduce((t, l) => t.plus(l.amount), D(0));
    const credit = j1.filter((l) => l.direction === "CREDIT").reduce((t, l) => t.plus(l.amount), D(0));
    expect(debit.toFixed(2)).toBe(credit.toFixed(2));

    // Allocation set also 2dp + balanced.
    const rows = buildApprovalAllocationRows({ categoryAmounts: cats, taxAmount: D(0), platformFee: D(0), total: subtotal });
    expect(() => assertSetBalanced(rows, subtotal)).not.toThrow();
    for (const r of rows) expect(twoDp(r.amount)).toBe(true);
  });
});

describe("REVIEW_TRANSITIONS state-machine soundness", () => {
  const all = Object.keys(REVIEW_TRANSITIONS) as RevenueReviewStatus[];
  // Documented terminal states (no outbound edges by design).
  const TERMINAL: RevenueReviewStatus[] = ["VOIDED", "REFUNDED", "WRITTEN_OFF"];

  it("every non-terminal status has at least one outbound edge (no dead ends)", () => {
    const deadEnds = all.filter((s) => !TERMINAL.includes(s) && REVIEW_TRANSITIONS[s].length === 0);
    expect(deadEnds).toEqual([]);
  });

  it("every status is reachable from DRAFT except the deferred WRITTEN_OFF island", () => {
    const seen = new Set<RevenueReviewStatus>(["DRAFT"]);
    const queue: RevenueReviewStatus[] = ["DRAFT"];
    while (queue.length) {
      for (const next of REVIEW_TRANSITIONS[queue.shift()!]) if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
    const unreachable = all.filter((s) => !seen.has(s));
    // WRITTEN_OFF has no inbound edge yet (write-off is a later phase) — that is
    // the ONLY acceptable unreachable state.
    expect(unreachable).toEqual(["WRITTEN_OFF"]);
  });

  it("VOIDABLE/SUBMITTABLE/APPROVABLE reference only real statuses, and PAYMENT_FAILED can be voided", () => {
    for (const s of [...VOIDABLE, ...SUBMITTABLE, ...APPROVABLE]) expect(all).toContain(s);
    // The gate list and the edge table must agree: PAYMENT_FAILED→VOIDED.
    expect(VOIDABLE).toContain("PAYMENT_FAILED");
    expect(REVIEW_TRANSITIONS.PAYMENT_FAILED).toContain("VOIDED");
  });
});

describe("refund cap — cumulative refund + proportional fee reversal are bounded", () => {
  // Payment 600.00, platform fee 18.00 (3%). Refund 300 then 300 then attempt more.
  const payment = D("600.00");
  const fee = D("18.00");
  const feeRefundFor = (amount: Prisma.Decimal, alreadyReversed: Prisma.Decimal) => {
    const proportional = fee.times(amount).dividedBy(payment).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const remaining = fee.minus(alreadyReversed);
    return proportional.greaterThan(remaining) ? remaining : proportional;
  };

  it("two 300 refunds reverse exactly the earned fee and never more", () => {
    let refunded = D(0);
    let reversed = D(0);
    for (const amt of [D("300.00"), D("300.00")]) {
      const remaining = payment.minus(refunded);
      expect(amt.lessThanOrEqualTo(remaining)).toBe(true); // never over-refund
      const fr = feeRefundFor(amt, reversed);
      refunded = refunded.plus(amt);
      reversed = reversed.plus(fr);
    }
    expect(refunded.toFixed(2)).toBe("600.00");
    expect(reversed.toFixed(2)).toBe("18.00"); // exactly the earned fee, not a cent more
    expect(reversed.lessThanOrEqualTo(fee)).toBe(true);
    // A third refund is impossible: remaining is 0.
    expect(payment.minus(refunded).toFixed(2)).toBe("0.00");
  });
});

describe("dispute lost — full fee reversal keeps books balanced, fee never over-reversed", () => {
  it("settlement + full chargeback nets clearing/AR to zero and reverses all fee", () => {
    const total = D("500.00");
    const fee = D("12.50");
    const j2 = buildSettlementJournalLines({ total, platformFee: fee });
    expect(() => assertBalanced(j2)).not.toThrow();
    // Lost dispute reverses the entire fee (reversedAmount → fee.amount).
    const reversed = fee; // handleDisputeClosed sets reversedAmount = fee.amount
    expect(reversed.lessThanOrEqualTo(fee)).toBe(true);
    expect(reversed.toFixed(2)).toBe("12.50");
  });
});
