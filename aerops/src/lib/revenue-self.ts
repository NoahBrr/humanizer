import { db } from "@/lib/db";
import { invoiceAmountDue } from "@/lib/revenue-money";

/**
 * Student/payer self-view engine (doc 30 §6, doc 36 §6). Serves the "My
 * Payments" surface with ONLY the session identity's own financial records.
 *
 * HARD RULE (structural, contract-tested): this file must NEVER import
 * `revenue-dashboard.ts` (the org-wide engine). Org-wide aggregates — school
 * revenue, instructor compensation, platform fees, other customers, org reports
 * — are unreachable from here because the code path to compute them does not
 * exist on this surface. Identity is always resolved server-side from the
 * session (`session.userId → Student.userId`), never a client parameter.
 */

export type StudentSelfSummary = {
  invoices: Array<{
    id: string;
    number: string;
    status: string;
    issuedAt: Date;
    billed: number;
    paid: number;
    amountDue: number;
  }>;
  amountDueTotal: number;
};

/**
 * Own invoices + payment status for the signed-in student. `studentUserId` is
 * the session user id (resolved by the caller from the session, never the
 * client). Returns nothing if the user is not a student in this org — fails
 * closed to an empty view, never to another tenant's data.
 */
export async function studentSelfSummary(studentUserId: string, organizationId: string): Promise<StudentSelfSummary> {
  const student = await db.student.findFirst({
    where: { userId: studentUserId, user: { organizationId } },
    select: { id: true },
  });
  if (!student) return { invoices: [], amountDueTotal: 0 };

  const invoices = await db.invoice.findMany({
    where: { organizationId, studentId: student.id },
    select: {
      id: true, number: true, status: true, issuedAt: true,
      lines: { select: { quantity: true, unitPrice: true } },
      payments: { select: { amount: true } },
    },
    orderBy: { issuedAt: "desc" },
    take: 100,
  });

  const rows = invoices.map((inv) => {
    const { billed, paid, amountDue } = invoiceAmountDue(inv.lines, inv.payments);
    return { id: inv.id, number: inv.number, status: inv.status, issuedAt: inv.issuedAt, billed, paid, amountDue };
  });

  return { invoices: rows, amountDueTotal: rows.reduce((t, r) => t + r.amountDue, 0) };
}
