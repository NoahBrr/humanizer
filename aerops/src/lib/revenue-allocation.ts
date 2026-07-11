import { Prisma, type AllocationCategory, type AllocationDimension, type AllocationEvent, type LineItemKind } from "@prisma/client";

/**
 * Revenue allocation (doc 12/28). Every financial event on a review writes ONE
 * balanced SET (grouped by setId) in TWO dimensions — REVENUE and PROCEEDS —
 * each of which sums EXACTLY to the event amount. Rows are immutable and signed
 * (reversals negative); there is no update/delete path. The set is asserted
 * balanced BEFORE any row is written. @@unique([setId, dimension, category])
 * makes a set structurally single-valued per category.
 */

const Z = new Prisma.Decimal(0);
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export class AllocationError extends Error {}

/** Map an invoice-line kind to its REVENUE allocation category (doc 28 §3). */
export function categoryForLineKind(kind: LineItemKind): AllocationCategory {
  switch (kind) {
    case "AIRCRAFT_RENTAL": return "AIRCRAFT_REVENUE";
    case "INSTRUCTOR_TIME":
    case "GROUND_INSTRUCTION":
    case "SIMULATOR_TIME": return "INSTRUCTOR_SERVICE_REVENUE";
    case "FUEL_SURCHARGE": return "FUEL_REVENUE";
    default: return "OTHER_REVENUE"; // membership, late fee, supply, discount (signed), other
  }
}

/**
 * A single line's total, ROUNDED to 2 dp (half-up) — the money value that will
 * be persisted. quantity is Decimal(8,2) and unitPrice Decimal(10,2), so the raw
 * product can carry up to 4 dp; rounding here (before any sum) is what keeps
 * every downstream journal/allocation amount exactly 2 dp. Summing rounded parts
 * — rather than rounding the sum — is the ONLY way Σ(persisted lines) equals the
 * persisted total, so the ledger cannot drift a cent (see INV-8).
 */
export function lineTotal(line: { quantity: Prisma.Decimal.Value; unitPrice: Prisma.Decimal.Value }): Prisma.Decimal {
  return D(line.quantity).times(line.unitPrice).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Sum invoice line totals (signed, each rounded to 2 dp) by REVENUE category. */
export function categorizeLines(lines: { kind: LineItemKind; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal }[]): Map<AllocationCategory, Prisma.Decimal> {
  const m = new Map<AllocationCategory, Prisma.Decimal>();
  for (const l of lines) {
    const cat = categoryForLineKind(l.kind);
    m.set(cat, (m.get(cat) ?? Z).plus(lineTotal(l)));
  }
  return m;
}

export type AllocationRow = { dimension: AllocationDimension; category: AllocationCategory; amount: Prisma.Decimal };

/**
 * Build the APPROVAL set rows (pure, contract-tested). REVENUE dimension = the
 * category revenues + TAX (sums to total). PROCEEDS dimension = TAX + PLATFORM_FEE
 * + SCHOOL_RETAINED_REVENUE (sums to total). Both dimensions are asserted to sum
 * to `total` to the cent, or it throws before anything is written.
 */
export function buildApprovalAllocationRows(input: {
  categoryAmounts: Map<AllocationCategory, Prisma.Decimal>;
  taxAmount: Prisma.Decimal;
  platformFee: Prisma.Decimal;
  total: Prisma.Decimal; // subtotal + tax
}): AllocationRow[] {
  const rows: AllocationRow[] = [];
  for (const [category, amount] of input.categoryAmounts) {
    if (!amount.isZero()) rows.push({ dimension: "REVENUE", category, amount });
  }
  if (!input.taxAmount.isZero()) rows.push({ dimension: "REVENUE", category: "TAX", amount: input.taxAmount });

  const schoolRetained = input.total.minus(input.taxAmount).minus(input.platformFee);
  if (!input.taxAmount.isZero()) rows.push({ dimension: "PROCEEDS", category: "TAX", amount: input.taxAmount });
  if (!input.platformFee.isZero()) rows.push({ dimension: "PROCEEDS", category: "PLATFORM_FEE", amount: input.platformFee });
  rows.push({ dimension: "PROCEEDS", category: "SCHOOL_RETAINED_REVENUE", amount: schoolRetained });

  assertSetBalanced(rows, input.total);
  return rows;
}

/** Each dimension present must sum to `amount` (doc 28 §4.2). */
export function assertSetBalanced(rows: AllocationRow[], amount: Prisma.Decimal): void {
  for (const dim of ["REVENUE", "PROCEEDS"] as AllocationDimension[]) {
    const dimRows = rows.filter((r) => r.dimension === dim);
    if (dimRows.length === 0) continue; // an absent dimension is valid only for zero-amount sets
    const sum = dimRows.reduce((t, r) => t.plus(r.amount), Z);
    if (!sum.equals(amount)) {
      throw new AllocationError(`Allocation ${dim} dimension sums to ${sum.toFixed(2)}, expected ${amount.toFixed(2)}.`);
    }
  }
}

/** Persist a balanced allocation set inside the caller's transaction. */
export async function postAllocationSet(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    revenueReviewId: string;
    invoiceId: string;
    setId: string;
    event: AllocationEvent;
    currency: string;
    effectiveAt: Date;
    amount: Prisma.Decimal; // event amount each dimension must sum to
    rows: AllocationRow[];
    sourceType?: string;
    sourceId?: string;
  },
): Promise<void> {
  assertSetBalanced(input.rows, input.amount);
  await tx.revenueAllocation.createMany({
    data: input.rows.map((r) => ({
      organizationId: input.organizationId,
      revenueReviewId: input.revenueReviewId,
      invoiceId: input.invoiceId,
      setId: input.setId,
      event: input.event,
      dimension: r.dimension,
      category: r.category,
      amount: r.amount,
      currency: input.currency,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      effectiveAt: input.effectiveAt,
    })),
  });
}
