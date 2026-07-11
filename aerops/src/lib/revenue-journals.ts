import { Prisma, type AllocationCategory, type LedgerAccount } from "@prisma/client";
import { debit, credit, nonZero, type JournalLine } from "@/lib/ledger";

/**
 * Pure double-entry journal builders (doc 12/28). Single source for the three
 * money-moving journals so the approve route, the settlement webhook, and the
 * refund path all post IDENTICAL, provably-balanced lines — and so the
 * Day-in-the-Life simulation can assert balance without a database.
 *
 * Every builder returns lines that satisfy Σdebits = Σcredits by construction;
 * postJournal re-asserts it at write time as a backstop.
 */

const Z = new Prisma.Decimal(0);

/** Revenue allocation category → its ledger revenue account (doc 28 taxonomy). */
export function ledgerAccountForCategory(cat: AllocationCategory): LedgerAccount {
  switch (cat) {
    case "AIRCRAFT_REVENUE": return "REVENUE_AIRCRAFT";
    case "INSTRUCTOR_SERVICE_REVENUE": return "REVENUE_INSTRUCTION";
    case "AIRPORT_LANDING_FEES": return "REVENUE_AIRPORT_FEES";
    case "FUEL_REVENUE": return "REVENUE_FUEL";
    default: return "REVENUE_OTHER";
  }
}

/**
 * J1 — approval journal. Recognizes revenue and books the receivable + the
 * instructor-compensation accrual. A negative category amount (a net discount)
 * becomes a CONTRA_REVENUE_DISCOUNTS debit rather than a negative credit.
 *
 *   debit  ACCOUNTS_RECEIVABLE      total
 *   debit  INSTRUCTOR_COMP_EXPENSE  comp
 *   debit  CONTRA_REVENUE_DISCOUNTS |negative categories|
 *   credit REVENUE_*                positive categories
 *   credit TAX_PAYABLE              tax
 *   credit INSTRUCTOR_COMP_PAYABLE  comp
 */
export function buildApprovalJournalLines(input: {
  total: Prisma.Decimal;
  compTotal: Prisma.Decimal;
  categoryAmounts: Map<AllocationCategory, Prisma.Decimal>;
  taxAmount: Prisma.Decimal;
}): JournalLine[] {
  const revenueLines: JournalLine[] = [];
  for (const [cat, amt] of input.categoryAmounts) {
    if (amt.greaterThan(0)) revenueLines.push(credit(ledgerAccountForCategory(cat), amt));
    else if (amt.lessThan(0)) revenueLines.push(debit("CONTRA_REVENUE_DISCOUNTS", amt.abs()));
  }
  return nonZero([
    debit("ACCOUNTS_RECEIVABLE", input.total),
    ...(input.compTotal.greaterThan(0) ? [debit("INSTRUCTOR_COMP_EXPENSE", input.compTotal)] : []),
    ...revenueLines,
    ...(input.taxAmount.greaterThan(0) ? [credit("TAX_PAYABLE", input.taxAmount)] : []),
    ...(input.compTotal.greaterThan(0) ? [credit("INSTRUCTOR_COMP_PAYABLE", input.compTotal)] : []),
  ]);
}

/**
 * J2 — settlement journal. Clears the receivable; proceeds land in clearing and
 * the platform fee is the school's expense (deducted at source by the
 * direct-charge model, ADR-037).
 *
 *   debit  PAYMENT_CLEARING      total − fee
 *   debit  PLATFORM_FEE_EXPENSE  fee
 *   credit ACCOUNTS_RECEIVABLE   total
 */
export function buildSettlementJournalLines(input: { total: Prisma.Decimal; platformFee: Prisma.Decimal }): JournalLine[] {
  // Defensive cap (ADR-037 item 8): the fee can never exceed the total, so the
  // clearing line can never go negative and J2 can never fail to balance.
  const raw = input.platformFee.greaterThan(0) ? input.platformFee : Z;
  const fee = raw.greaterThan(input.total) ? input.total : raw;
  const net = input.total.minus(fee);
  return nonZero([
    debit("PAYMENT_CLEARING", net),
    ...(fee.greaterThan(0) ? [debit("PLATFORM_FEE_EXPENSE", fee)] : []),
    credit("ACCOUNTS_RECEIVABLE", input.total),
  ]);
}

/**
 * J3 — refund journal (reverses settlement for the refunded amount). Money flows
 * back to the payer from clearing; a proportional platform-fee refund reduces
 * the expense.
 *
 *   debit  ACCOUNTS_RECEIVABLE   refund            (re-opens the receivable)
 *   credit PAYMENT_CLEARING      refund − feeBack
 *   credit PLATFORM_FEE_EXPENSE  feeBack           (expense reversed)
 */
export function buildRefundJournalLines(input: { refundAmount: Prisma.Decimal; platformFeeRefund: Prisma.Decimal }): JournalLine[] {
  const feeBack = input.platformFeeRefund.greaterThan(0) ? input.platformFeeRefund : Z;
  const clearingBack = input.refundAmount.minus(feeBack);
  return nonZero([
    debit("ACCOUNTS_RECEIVABLE", input.refundAmount),
    credit("PAYMENT_CLEARING", clearingBack),
    ...(feeBack.greaterThan(0) ? [credit("PLATFORM_FEE_EXPENSE", feeBack)] : []),
  ]);
}
