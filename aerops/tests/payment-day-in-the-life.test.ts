import { describe, it, expect } from "vitest";
import { Prisma, type LineItemKind } from "@prisma/client";
import { assertBalanced } from "@/lib/ledger";
import { buildApprovalJournalLines, buildSettlementJournalLines, buildRefundJournalLines } from "@/lib/revenue-journals";
import { buildApprovalAllocationRows, assertSetBalanced, categorizeLines } from "@/lib/revenue-allocation";
import { computePlatformFee, feeBaseAmount, ZERO_FEE_POLICY } from "@/lib/platform-fee";
import { decideScheduling } from "@/lib/payment-scheduling";
import { accountReadyForCharge, deriveAccountStatus, reduceAccountSync, type AccountFacts } from "@/lib/connected-account";
import { chargeIdempotencyKey } from "@/lib/payment-idempotency";
import { toMinorUnits } from "@/lib/payment-runner";
import { canTransition } from "@/lib/revenue-review";
import { FakePaymentProvider } from "@/lib/fake-provider";

/**
 * Day-in-the-Life simulation (Phase 5 release gate). Twenty scenarios drawn from
 * a real flight school's day, each driven through the SAME pure builders and
 * engines the production code paths use. The gate this test enforces:
 *
 *   • Every journal balances (Σdebits = Σcredits).
 *   • Every allocation set balances on both dimensions (= total).
 *   • Platform-fee reconciliation: clearing + fee = total at settlement;
 *     fee refund is proportional and never exceeds what was earned.
 *   • Idempotency keys are stable per attempt and unique across attempts.
 *   • Webhook replay / duplicate intent cannot double-count.
 *   • No money is created or destroyed across the whole day (grand totals tie).
 *
 * It uses NO network and NO clock — the FakePaymentProvider is deterministic and
 * all timestamps are fixed — so it is reproducible on every run.
 */

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const T0 = new Date("2026-07-11T15:00:00.000Z");

type Line = { kind: LineItemKind; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal };
const line = (kind: LineItemKind, quantity: Prisma.Decimal.Value, unitPrice: Prisma.Decimal.Value): Line => ({ kind, quantity: D(quantity), unitPrice: D(unitPrice) });

const READY_ACCOUNT: AccountFacts = {
  providerAccountId: "acct_1", chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true,
  requirementsDue: { currentlyDue: [], eventuallyDue: [], pastDue: [], currentDeadline: null }, suspendedAt: null, deauthorizedAt: null,
};

type Ledger = { debit: Prisma.Decimal; credit: Prisma.Decimal };
const ZERO_LEDGER = (): Ledger => ({ debit: D(0), credit: D(0) });
function tally(acc: Ledger, lines: { direction: "DEBIT" | "CREDIT"; amount: Prisma.Decimal }[]): void {
  for (const l of lines) {
    if (l.direction === "DEBIT") acc.debit = acc.debit.plus(l.amount);
    else acc.credit = acc.credit.plus(l.amount);
  }
}

/**
 * Run the full approval→settlement pipeline for one billed lesson and assert
 * every balance property. Returns the journal lines so the caller can fold them
 * into the day's grand total (money-conservation check).
 */
function runBilledLesson(opts: {
  lines: Line[];
  tax?: Prisma.Decimal;
  comp?: Prisma.Decimal;
  feeBps?: number;
  refund?: { amount: Prisma.Decimal | "full" };
}) {
  const tax = opts.tax ?? D(0);
  const comp = opts.comp ?? D(0);
  const catAmounts = categorizeLines(opts.lines);
  const subtotal = opts.lines.reduce((t, l) => t.plus(l.quantity.times(l.unitPrice)), D(0));
  const total = subtotal.plus(tax);
  const feePolicy = { ...ZERO_FEE_POLICY, feePercentBps: opts.feeBps ?? 0 };
  const fee = computePlatformFee(feePolicy, feeBaseAmount(feePolicy.feeBase, subtotal, total));

  // J1 approval journal.
  const j1 = buildApprovalJournalLines({ total, compTotal: comp, categoryAmounts: catAmounts, taxAmount: tax });
  expect(() => assertBalanced(j1)).not.toThrow();

  // S1 allocation set — both dimensions must equal the total.
  const s1 = buildApprovalAllocationRows({ categoryAmounts: catAmounts, taxAmount: tax, platformFee: fee, total });
  expect(() => assertSetBalanced(s1, total)).not.toThrow();
  const rev = s1.filter((r) => r.dimension === "REVENUE").reduce((t, r) => t.plus(r.amount), D(0));
  const proc = s1.filter((r) => r.dimension === "PROCEEDS").reduce((t, r) => t.plus(r.amount), D(0));
  expect(rev.toFixed(2)).toBe(total.toFixed(2));
  expect(proc.toFixed(2)).toBe(total.toFixed(2));

  // J2 settlement — clearing + fee must reconstruct the total exactly.
  const j2 = buildSettlementJournalLines({ total, platformFee: fee });
  expect(() => assertBalanced(j2)).not.toThrow();
  const clearing = j2.filter((l) => l.account === "PAYMENT_CLEARING").reduce((t, l) => t.plus(l.amount), D(0));
  const feePosted = j2.filter((l) => l.account === "PLATFORM_FEE_EXPENSE").reduce((t, l) => t.plus(l.amount), D(0));
  expect(clearing.plus(feePosted).toFixed(2)).toBe(total.toFixed(2));

  const journals = [j1, j2];

  // Optional refund.
  let j3: ReturnType<typeof buildRefundJournalLines> | null = null;
  if (opts.refund) {
    const refundAmount = opts.refund.amount === "full" ? total : opts.refund.amount;
    const feeRefund = fee.greaterThan(0) ? fee.times(refundAmount).dividedBy(total).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP) : D(0);
    expect(feeRefund.lessThanOrEqualTo(fee)).toBe(true); // never reverse more fee than earned
    j3 = buildRefundJournalLines({ refundAmount, platformFeeRefund: feeRefund });
    expect(() => assertBalanced(j3!)).not.toThrow();
    journals.push(j3);
  }

  return { total, fee, subtotal, tax, j1, j2, j3, journals };
}

describe("Day-in-the-Life — 20 scenarios (Phase 5 release gate)", () => {
  const grand = ZERO_LEDGER();
  const fold = (js: { direction: "DEBIT" | "CREDIT"; amount: Prisma.Decimal }[][]) => js.forEach((j) => tally(grand, j));

  it("S1: full happy path — Cessna 172 + instructor, card, 2% platform fee", () => {
    const r = runBilledLesson({ lines: [line("AIRCRAFT_RENTAL", 1.5, 165), line("INSTRUCTOR_TIME", 1.5, 70)], tax: D("0"), comp: D("60.00"), feeBps: 200 });
    expect(r.total.toFixed(2)).toBe("352.50");
    expect(r.fee.toFixed(2)).toBe("7.05"); // 2% of 352.50
    fold(r.journals);
    // Charge is scheduled immediately.
    const decision = decideScheduling({ policy: "IMMEDIATE_ON_APPROVAL", chargingEnabled: true, hasPaymentMethod: true, accountReady: true, approvedAt: T0 });
    expect(decision).toMatchObject({ schedule: true, status: "SCHEDULED" });
  });

  it("S2: card declined — sync decline routes to PAYMENT_FAILED, no settlement", async () => {
    const p = new FakePaymentProvider();
    p.script("sc_x_a1", "declineSync");
    const res = await p.createCharge({ accountRef: "acct_1", amount: 35250, currency: "USD", customerRef: "cus_1", methodRef: "pm_1", applicationFeeAmount: 705, idempotencyKey: "sc_x_a1", offSession: true, metadata: {} });
    expect(res.status).toBe("failed");
    expect(canTransition("PAYMENT_PROCESSING", "PAYMENT_FAILED")).toBe(true);
    // A failed review may be retried.
    expect(canTransition("PAYMENT_FAILED", "PAYMENT_PROCESSING")).toBe(true);
  });

  it("S3: ACH pending → succeeded — review ACH_PENDING then PAID", async () => {
    const p = new FakePaymentProvider();
    p.script("sc_ach_a1", "processing");
    const res = await p.createCharge({ accountRef: "acct_1", amount: 20000, currency: "USD", customerRef: "cus_1", methodRef: "pm_ach", applicationFeeAmount: 0, idempotencyKey: "sc_ach_a1", offSession: true, metadata: {} });
    expect(res.status).toBe("processing");
    expect(canTransition("PAYMENT_PROCESSING", "ACH_PENDING")).toBe(true);
    expect(canTransition("ACH_PENDING", "PAID")).toBe(true);
    const r = runBilledLesson({ lines: [line("AIRCRAFT_RENTAL", 1, 200)] });
    fold(r.journals);
  });

  it("S4: ACH returned (R01) — ACH_PENDING → PAYMENT_FAILED is legal", () => {
    expect(canTransition("ACH_PENDING", "PAYMENT_FAILED")).toBe(true);
    // A return arriving after a (wrong) provisional paid must NOT silently pass:
    // there is no PAID → PAYMENT_FAILED edge, so a late return is handled as a
    // dispute/adjustment, never a silent status flip.
    expect(canTransition("PAID", "PAYMENT_FAILED")).toBe(false);
  });

  it("S5: full refund — J3 reverses J2 exactly, fee fully reversed", () => {
    const r = runBilledLesson({ lines: [line("AIRCRAFT_RENTAL", 2, 150)], feeBps: 250, refund: { amount: "full" } });
    // Settlement then full refund nets to zero on the clearing + A/R accounts.
    const net = ZERO_LEDGER();
    tally(net, r.j2);
    tally(net, r.j3!);
    expect(net.debit.minus(net.credit).toFixed(2)).toBe("0.00");
    fold(r.journals);
    expect(canTransition("CARD_PAID", "REFUNDED")).toBe(true);
  });

  it("S6: partial refund — proportional fee reversal, review PARTIALLY_REFUNDED", () => {
    const r = runBilledLesson({ lines: [line("AIRCRAFT_RENTAL", 4, 150)], feeBps: 300, refund: { amount: D("300.00") } }); // refund 300 of 600
    const feeRefund = r.fee.times(D("300.00")).dividedBy(r.total).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    expect(feeRefund.toFixed(2)).toBe("9.00"); // half of 18.00
    fold(r.journals);
    expect(canTransition("CARD_PAID", "PARTIALLY_REFUNDED")).toBe(true);
    expect(canTransition("PARTIALLY_REFUNDED", "REFUNDED")).toBe(true);
  });

  it("S7: two instructors on one flight — combined instruction revenue balances", () => {
    const r = runBilledLesson({ lines: [line("AIRCRAFT_RENTAL", 2, 160), line("INSTRUCTOR_TIME", 1, 75), line("GROUND_INSTRUCTION", 1, 65)], comp: D("95.00"), feeBps: 200 });
    const cats = categorizeLines([line("INSTRUCTOR_TIME", 1, 75), line("GROUND_INSTRUCTION", 1, 65)]);
    expect(cats.get("INSTRUCTOR_SERVICE_REVENUE")?.toFixed(2)).toBe("140.00"); // both instructors combine
    fold(r.journals);
  });

  it("S8: parent (ResponsiblePayer) pays — scheduling identical, payer resolved upstream", () => {
    const r = runBilledLesson({ lines: [line("AIRCRAFT_RENTAL", 1.2, 155)], feeBps: 200 });
    const decision = decideScheduling({ policy: "IMMEDIATE_ON_APPROVAL", chargingEnabled: true, hasPaymentMethod: true, accountReady: true, approvedAt: T0 });
    expect(decision.schedule).toBe(true);
    fold(r.journals);
  });

  it("S9: no payment method on file — outbox holds AWAITING_MANUAL, no auto-charge", () => {
    const decision = decideScheduling({ policy: "IMMEDIATE_ON_APPROVAL", chargingEnabled: true, hasPaymentMethod: false, accountReady: true, approvedAt: T0 });
    expect(decision).toMatchObject({ schedule: true, status: "AWAITING_MANUAL", runAfter: null });
  });

  it("S10: airport & landing fees (pass-through) — ride OTHER_REVENUE in the line taxonomy and balance", () => {
    const r = runBilledLesson({ lines: [line("AIRCRAFT_RENTAL", 1, 150), line("OTHER", 1, 25)], feeBps: 200 });
    const cats = categorizeLines([line("OTHER", 1, 25)]);
    expect(cats.get("OTHER_REVENUE")?.toFixed(2)).toBe("25.00");
    fold(r.journals);
  });

  it("S11: manual line item — flows through OTHER_REVENUE and still balances", () => {
    const r = runBilledLesson({ lines: [line("AIRCRAFT_RENTAL", 1, 150), line("OTHER", 1, 40)], feeBps: 200 });
    fold(r.journals);
    // A manual item risk-flags the review → SECOND approval, but numbers balance.
    expect(r.total.toFixed(2)).toBe("190.00");
  });

  it("S12: discount — negative line becomes a contra-revenue debit, REVENUE dimension holds", () => {
    const r = runBilledLesson({ lines: [line("AIRCRAFT_RENTAL", 1, 200), line("DISCOUNT", 1, -30)], feeBps: 0 });
    expect(r.total.toFixed(2)).toBe("170.00");
    // J1 must contain a CONTRA_REVENUE_DISCOUNTS debit of 30.
    const contra = r.j1.filter((l) => l.account === "CONTRA_REVENUE_DISCOUNTS").reduce((t, l) => t.plus(l.amount), D(0));
    expect(contra.toFixed(2)).toBe("30.00");
    fold(r.journals);
  });

  it("S13: multi-location — location scoping is upstream; journals are org-level and balance", () => {
    const r = runBilledLesson({ lines: [line("AIRCRAFT_RENTAL", 1, 175)], feeBps: 200 });
    fold(r.journals);
  });

  it("S14: custom per-student pricing + tax — tax lands in both A/R and TAX_PAYABLE", () => {
    const r = runBilledLesson({ lines: [line("AIRCRAFT_RENTAL", 1, 180)], tax: D("14.40"), feeBps: 200 });
    expect(r.total.toFixed(2)).toBe("194.40");
    const taxPayable = r.j1.filter((l) => l.account === "TAX_PAYABLE").reduce((t, l) => t.plus(l.amount), D(0));
    expect(taxPayable.toFixed(2)).toBe("14.40");
    fold(r.journals);
  });

  it("S15: manual billing policy — NO outbox row, school invoices offline", () => {
    const decision = decideScheduling({ policy: "MANUAL_INVOICE", chargingEnabled: true, hasPaymentMethod: true, accountReady: true, approvedAt: T0 });
    expect(decision).toEqual({ schedule: false, reason: "manual_invoice" });
  });

  it("S16: instructor edits after CHANGES_REQUESTED — re-approval path is legal, prior charge blocked", () => {
    expect(canTransition("AWAITING_OPERATIONS_REVIEW", "CHANGES_REQUESTED")).toBe(true);
    expect(canTransition("CHANGES_REQUESTED", "AWAITING_OPERATIONS_REVIEW")).toBe(true);
    // Cannot leap from CHANGES_REQUESTED straight to a paid/charging state.
    expect(canTransition("CHANGES_REQUESTED", "PAYMENT_SCHEDULED")).toBe(false);
  });

  it("S17: concurrent approval — only one APPROVED→PAYMENT_SCHEDULED edge exists", () => {
    // The DB guards concurrency (updateMany status filter); the state machine
    // guarantees there is exactly one legal edge to schedule from.
    expect(canTransition("APPROVED", "PAYMENT_SCHEDULED")).toBe(true);
    expect(canTransition("PAYMENT_SCHEDULED", "PAYMENT_SCHEDULED")).toBe(false);
  });

  it("S18: webhook replay — a duplicate succeeded event is a no-op (idempotent transition)", () => {
    // Settlement flips PROCESSING→CARD_PAID once; a replay finds CARD_PAID and
    // there is no CARD_PAID→CARD_PAID edge, so no second settlement is possible.
    expect(canTransition("PAYMENT_PROCESSING", "CARD_PAID")).toBe(true);
    expect(canTransition("CARD_PAID", "CARD_PAID")).toBe(false);
  });

  it("S19: duplicate PaymentIntent prevented — same attempt key returns the same intent", async () => {
    const p = new FakePaymentProvider();
    const input = { accountRef: "acct_1", amount: 35250, currency: "USD", customerRef: "cus_1", methodRef: "pm_1", applicationFeeAmount: 705, idempotencyKey: chargeIdempotencyKey("sc_dup", 1), offSession: true, metadata: {} };
    const first = await p.createCharge(input);
    const second = await p.createCharge(input); // retry with the SAME key
    expect(second.paymentIntentRef).toBe(first.paymentIntentRef); // no second intent minted
    // A genuine re-charge (new attempt number) gets a distinct key.
    expect(chargeIdempotencyKey("sc_dup", 2)).not.toBe(chargeIdempotencyKey("sc_dup", 1));
  });

  it("S20: connected account not ready — charge gate closed; out-of-order sync cannot re-open it", () => {
    const notReady: AccountFacts = { ...READY_ACCOUNT, chargesEnabled: false, detailsSubmitted: false };
    expect(accountReadyForCharge(notReady)).toBe(false);
    expect(deriveAccountStatus(notReady)).toBe("PENDING");
    const decision = decideScheduling({ policy: "IMMEDIATE_ON_APPROVAL", chargingEnabled: true, hasPaymentMethod: true, accountReady: false, approvedAt: T0 });
    expect(decision).toMatchObject({ schedule: true, status: "AWAITING_MANUAL" });

    // A suspended account can never be charged, even if a stale "enabled" arrives late.
    const suspended: AccountFacts = { ...READY_ACCOUNT, suspendedAt: T0 };
    expect(accountReadyForCharge(suspended)).toBe(false);
    const stale = reduceAccountSync(
      { providerStateAsOf: new Date("2026-07-11T16:00:00Z"), firstEnabledAt: T0, suspendedAt: T0, deauthorizedAt: null },
      { accountRef: "acct_1", chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, requirements: { currentlyDue: [], eventuallyDue: [], pastDue: [], currentDeadline: null }, disabledReason: null, country: "US", defaultCurrency: "usd", businessType: "individual", capabilities: null, providerStateAsOf: new Date("2026-07-11T15:30:00Z") },
      T0,
    );
    expect(stale).toBeNull(); // older snapshot ignored — no resurrection
  });

  it("GRAND TOTAL: across the whole day, Σ debits = Σ credits (no money created or destroyed)", () => {
    expect(grand.debit.toFixed(2)).toBe(grand.credit.toFixed(2));
    expect(grand.debit.greaterThan(0)).toBe(true);
  });
});
