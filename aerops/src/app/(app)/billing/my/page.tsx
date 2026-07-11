import { notFound } from "next/navigation";
import { Wallet } from "lucide-react";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { studentSelfSummary } from "@/lib/revenue-self";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "My Payments" };

/**
 * Student self-view (doc 30 §6). Own reviews/invoices, amount due, and payment
 * status — nothing org-wide. Identity is resolved server-side from the session
 * (never a client parameter); a non-student is denied with a 404 so this surface
 * fails closed to nobody else's data.
 */
export default async function MyPaymentsPage() {
  const session = await getSession();
  if (!session || !session.permissions.has("revenue.self_view")) notFound();

  // Own-data-only: this page exists solely for a student in THIS org.
  const student = await db.student.findFirst({
    where: { userId: session.userId, user: { organizationId: session.organizationId } },
    select: { id: true },
  });
  if (!student) notFound();

  const summary = await studentSelfSummary(session.userId, session.organizationId);
  const unpaid = summary.invoices.filter((i) => i.amountDue > 0).length;

  const stats = [
    { label: "Balance due", value: formatCurrency(summary.amountDueTotal) },
    { label: "Open balances", value: String(unpaid) },
    { label: "Invoices", value: String(summary.invoices.length) },
  ];

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow="Billing"
        title="My Payments"
        description="Your invoices and payment status. Only your own records appear here."
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
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
        <CardContent className="p-2">
          {summary.invoices.length === 0 ? (
            <EmptyState
              icon={<Wallet className="h-5 w-5" />}
              title="No invoices yet"
              description="When your flights close and a Revenue Review is approved, your invoices will appear here."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Invoice</TH>
                  <TH>Issued</TH>
                  <TH className="text-right">Billed</TH>
                  <TH className="text-right">Paid</TH>
                  <TH className="text-right">Balance</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {summary.invoices.map((inv) => (
                  <TR key={inv.id}>
                    <TD className="text-xs font-semibold">{inv.number}</TD>
                    <TD className="text-xs">{formatDate(inv.issuedAt)}</TD>
                    <TD className="text-right text-xs tabular-nums">{formatCurrency(inv.billed)}</TD>
                    <TD className="text-right text-xs tabular-nums">{formatCurrency(inv.paid)}</TD>
                    <TD className="text-right text-xs font-medium tabular-nums">{formatCurrency(inv.amountDue)}</TD>
                    <TD><StatusBadge status={inv.status} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
