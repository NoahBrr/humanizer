/**
 * Shared pure money arithmetic for the Revenue Engine. Lives in its own module
 * (not in revenue-dashboard.ts) so the student self-view engine can reuse it
 * WITHOUT importing the org-wide dashboard engine — the isolation rule in
 * doc 30 §6 stays intact (revenue-self.ts must never reach org-wide aggregation).
 */

/**
 * Amount still owed on an invoice = billed − paid, clamped at zero. Single
 * source for both the org dashboard and the student self-view so the two
 * surfaces can never drift (an overpaid invoice contributes 0 to outstanding,
 * never a negative that silently offsets another invoice's balance).
 */
export function invoiceAmountDue(
  lines: Array<{ quantity: unknown; unitPrice: unknown }>,
  payments: Array<{ amount: unknown }>,
): { billed: number; paid: number; amountDue: number } {
  const billed = lines.reduce((t, l) => t + Number(l.quantity) * Number(l.unitPrice), 0);
  const paid = payments.reduce((t, p) => t + Number(p.amount), 0);
  return { billed, paid, amountDue: Math.max(0, billed - paid) };
}
