import { Wallet } from "lucide-react";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { resolvePayerScope, payerRecordFilter } from "@/lib/payers";
import { invoiceAmountDue } from "@/lib/revenue-money";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatCurrency, formatDate, fullName } from "@/lib/utils";
import { PayerMethods } from "./payer-methods";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payer Portal" };

/**
 * Payer portal home (doc 11 §7). Shows ONLY the reviews/invoices this payer is
 * authorized for — derived from resolvePayerScope + payerRecordFilter, never a
 * client-supplied org/student id — plus their saved payment methods. A payer can
 * never see another payer's or an unauthorized student's data.
 */
export default async function PayerPortalPage() {
  const session = (await getSession())!; // layout guarantees an authorized payer
  const scope = await resolvePayerScope(session.userId);

  const reviews = await db.revenueReview.findMany({
    where: payerRecordFilter(scope),
    include: {
      invoice: { select: { number: true, status: true, lines: { select: { quantity: true, unitPrice: true } }, payments: { select: { amount: true } } } },
      student: { include: { user: { select: { firstName: true, lastName: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const rows = reviews.map((r) => {
    const { billed, paid, amountDue } = invoiceAmountDue(r.invoice.lines, r.invoice.payments);
    return {
      id: r.id,
      number: r.invoice.number,
      student: fullName(r.student?.user) || "—",
      status: r.status,
      issuedAt: r.createdAt,
      billed,
      paid,
      amountDue,
    };
  });
  const balanceDue = rows.reduce((t, r) => t + r.amountDue, 0);

  const stats = [
    { label: "Balance due", value: formatCurrency(balanceDue) },
    { label: "Open items", value: String(rows.filter((r) => r.amountDue > 0).length) },
    { label: "Total items", value: String(rows.length) },
  ];

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader
        eyebrow="Payer Portal"
        title={`Welcome, ${session.firstName}`}
        description="Invoices and reviews you're responsible for, plus the payment methods on file."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-[11px] text-muted-foreground">{s.label}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Invoices & reviews</CardTitle>
          <CardDescription>Everything you are authorized to view for your linked students.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {rows.length === 0 ? (
            <EmptyState
              icon={<Wallet className="h-5 w-5" />}
              title="Nothing to show yet"
              description="When a flight closes and its Revenue Review is approved, it will appear here."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Invoice</TH>
                  <TH>Student</TH>
                  <TH>Date</TH>
                  <TH className="text-right">Billed</TH>
                  <TH className="text-right">Balance</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id}>
                    <TD className="text-xs font-semibold">{r.number}</TD>
                    <TD className="text-xs">{r.student}</TD>
                    <TD className="text-xs">{formatDate(r.issuedAt)}</TD>
                    <TD className="text-right text-xs tabular-nums">{formatCurrency(r.billed)}</TD>
                    <TD className="text-right text-xs font-medium tabular-nums">{formatCurrency(r.amountDue)}</TD>
                    <TD><StatusBadge status={r.status} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <PayerMethods />
    </div>
  );
}
