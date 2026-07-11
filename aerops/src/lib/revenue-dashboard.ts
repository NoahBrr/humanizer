import { db } from "@/lib/db";
import { invoiceAmountDue } from "@/lib/revenue-money";

/**
 * Revenue Engine org-wide read engine (doc 30 §4/§7). The ONE engine behind the
 * executive Revenue Dashboard and the operations queue. Pure period/footing
 * helpers (unit-tested) + thin `db` aggregate wrappers — zero new models in
 * Phase 1, so the money figures here read the existing Invoice/Payment tables;
 * later phases point the same surface at snapshotted allocations.
 *
 * This engine computes ORG-WIDE aggregates. The student/payer surface is served
 * by `revenue-self.ts`, which must never import this file (doc 30 §6) — the
 * static scan in tests keeps org-wide aggregates structurally unreachable from
 * the self-view.
 */

// --- Pure helpers (no I/O; contract-tested) ---------------------------------

/** Offset (ms) added to a UTC instant to get wall-clock time in `timeZone`. */
function tzOffsetMs(at: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(at).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUTC - Math.floor(at.getTime() / 1000) * 1000;
}

/** Wall-clock Y/M/D in `timeZone` for the instant `at`. */
function zonedYMD(at: Date, timeZone: string): { y: number; m: number; d: number } {
  const dtf = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const p = Object.fromEntries(dtf.formatToParts(at).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day };
}

/**
 * Resolve the UTC instant of a wall-clock boundary (`localAsUTC` = the boundary
 * expressed as if it were UTC) in `timeZone`. The offset must be evaluated AT
 * the boundary, not at some other instant — otherwise the result lands ~1h off
 * on DST-transition days. A single convergence pass corrects the offset from the
 * initial guess (a boundary is never within an hour of a transition edge).
 */
function boundaryInstant(localAsUTC: number, timeZone: string): Date {
  const guess = localAsUTC - tzOffsetMs(new Date(localAsUTC), timeZone);
  return new Date(localAsUTC - tzOffsetMs(new Date(guess), timeZone));
}

/** The UTC instant of local midnight (start of `at`'s day) in `timeZone`. */
export function startOfDayInTimeZone(at: Date, timeZone: string): Date {
  const { y, m, d } = zonedYMD(at, timeZone);
  return boundaryInstant(Date.UTC(y, m - 1, d, 0, 0, 0), timeZone);
}

/** The UTC instant of the first moment of `at`'s month in `timeZone`. */
export function startOfMonthInTimeZone(at: Date, timeZone: string): Date {
  const { y, m } = zonedYMD(at, timeZone);
  return boundaryInstant(Date.UTC(y, m - 1, 1, 0, 0, 0), timeZone);
}


/**
 * Footing check: the parts must sum to the total within a cent. The core
 * financial invariant every dashboard figure and export relies on — a failed
 * foot is a bug, never rounded away.
 */
export function foots(parts: number[], total: number, epsilon = 0.005): boolean {
  const sum = parts.reduce((a, b) => a + b, 0);
  return Math.abs(sum - total) < epsilon;
}

export type RevenueDashboardSummary = {
  collectedToday: number;
  collectedMTD: number;
  outstanding: number;
  openInvoiceCount: number;
  periodStartDay: Date;
  periodStartMonth: Date;
};

// --- Aggregate wrapper (thin over db; Phase 1 reads Invoice/Payment) ---------

/**
 * Phase 1 executive summary from the existing billing tables. Amounts are money
 * totals in the org's currency (single-currency per org in Phase 1). Later
 * phases add approved-vs-collected, per-dimension breakdowns, and the review
 * queue once RevenueReview/RevenueAllocation land.
 */
export async function revenueDashboardSummary(
  organizationId: string,
  timeZone: string,
  now: Date,
): Promise<RevenueDashboardSummary> {
  const periodStartDay = startOfDayInTimeZone(now, timeZone);
  const periodStartMonth = startOfMonthInTimeZone(now, timeZone);

  const [collectedTodayAgg, collectedMTDAgg, openInvoices] = await Promise.all([
    db.payment.aggregate({ where: { invoice: { organizationId }, paidAt: { gte: periodStartDay } }, _sum: { amount: true } }),
    db.payment.aggregate({ where: { invoice: { organizationId }, paidAt: { gte: periodStartMonth } }, _sum: { amount: true } }),
    db.invoice.findMany({
      where: { organizationId, status: { in: ["OPEN", "PARTIALLY_PAID", "OVERDUE"] } },
      select: { lines: { select: { quantity: true, unitPrice: true } }, payments: { select: { amount: true } } },
    }),
  ]);

  const outstanding = openInvoices.reduce(
    (total, inv) => total + invoiceAmountDue(inv.lines, inv.payments).amountDue,
    0,
  );

  return {
    collectedToday: Number(collectedTodayAgg._sum.amount ?? 0),
    collectedMTD: Number(collectedMTDAgg._sum.amount ?? 0),
    outstanding,
    openInvoiceCount: openInvoices.length,
    periodStartDay,
    periodStartMonth,
  };
}
