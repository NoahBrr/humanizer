import { Prisma, type LedgerAccount, type LedgerDirection, type PrismaClient } from "@prisma/client";

/**
 * The append-only double-entry ledger spine (doc 12/28). This is the SOLE
 * writer of LedgerEntry rows — no other module inserts them, and there is no
 * update/delete path (corrections are new reversing journals). Every journal
 * balances: Σ debits = Σ credits, one currency, every amount > 0. The balance
 * is asserted BEFORE any row is written, inside the caller's transaction, so a
 * journal can never be half-posted or post unbalanced.
 */

export type JournalLine = { account: LedgerAccount; direction: LedgerDirection; amount: Prisma.Decimal };

const Z = new Prisma.Decimal(0);

/** Throws if the journal does not balance or any amount is non-positive. */
export function assertBalanced(lines: JournalLine[]): void {
  if (lines.length === 0) throw new LedgerError("A journal must have at least one line.");
  let debit = Z;
  let credit = Z;
  for (const l of lines) {
    if (l.amount.lessThanOrEqualTo(0)) throw new LedgerError(`Ledger amounts must be > 0 (got ${l.amount} on ${l.account}).`);
    if (l.direction === "DEBIT") debit = debit.plus(l.amount);
    else credit = credit.plus(l.amount);
  }
  if (!debit.equals(credit)) {
    throw new LedgerError(`Journal does not balance: debits ${debit.toFixed(2)} ≠ credits ${credit.toFixed(2)}.`);
  }
}

export class LedgerError extends Error {}

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * Post one balanced journal (all lines share `journalId`). Must run inside the
 * caller's transaction so it commits atomically with the state change that
 * produced it.
 */
export async function postJournal(
  tx: Tx,
  input: {
    organizationId: string;
    journalId: string;
    event: string; // dot-namespaced, e.g. "revenue_review.approved"
    sourceType: string; // RevenueReview | Payment | Refund | PlatformFee | ...
    sourceId: string;
    currency: string;
    effectiveAt: Date;
    lines: JournalLine[];
  },
): Promise<void> {
  assertBalanced(input.lines);
  await tx.ledgerEntry.createMany({
    data: input.lines.map((l) => ({
      organizationId: input.organizationId,
      journalId: input.journalId,
      event: input.event,
      account: l.account,
      direction: l.direction,
      amount: l.amount,
      currency: input.currency,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      effectiveAt: input.effectiveAt,
    })),
  });
}

/** Convenience builders keeping call sites readable. */
export const debit = (account: LedgerAccount, amount: Prisma.Decimal): JournalLine => ({ account, direction: "DEBIT", amount });
export const credit = (account: LedgerAccount, amount: Prisma.Decimal): JournalLine => ({ account, direction: "CREDIT", amount });

/** Drop zero-amount lines (a category with no money never posts). */
export const nonZero = (lines: JournalLine[]): JournalLine[] => lines.filter((l) => l.amount.greaterThan(0));
