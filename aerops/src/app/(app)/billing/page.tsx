import Link from "next/link";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatCurrency, formatDate, fullName } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing" };

export default async function BillingPage() {
  const session = await getSession();
  const organizationId = session!.organizationId;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [invoices, collectedMTD] = await Promise.all([
    db.invoice.findMany({
      where: { organizationId },
      include: {
        student: { include: { user: { select: { firstName: true, lastName: true } } } },
        lines: true,
        payments: true,
      },
      orderBy: { issuedAt: "desc" },
      take: 60,
    }),
    db.payment.aggregate({ where: { invoice: { organizationId }, paidAt: { gte: monthStart } }, _sum: { amount: true } }),
  ]);

  const withTotals = invoices.map((inv) => {
    const total = inv.lines.reduce((t, l) => t + Number(l.quantity) * Number(l.unitPrice), 0);
    const paid = inv.payments.reduce((t, p) => t + Number(p.amount), 0);
    return { ...inv, total, paid };
  });

  const outstanding = withTotals.filter((i) => ["OPEN", "PARTIALLY_PAID", "OVERDUE"].includes(i.status)).reduce((t, i) => t + (i.total - i.paid), 0);
  const overdueCount = withTotals.filter((i) => i.status === "OVERDUE").length;

  const stats = [
    { label: "Outstanding", value: formatCurrency(outstanding) },
    { label: "Collected this month", value: formatCurrency(collectedMTD._sum.amount) },
    { label: "Overdue invoices", value: String(overdueCount) },
    { label: "Invoices (recent)", value: String(invoices.length) },
  ];

  return (
    <div className="animate-fade-up">
      <PageHeader title="Billing" description="Invoices are generated automatically when flights close. Stripe & QuickBooks sync-ready.">
        <Link href="/billing/reviews" className="text-xs font-medium text-primary hover:underline">Revenue Reviews</Link>
      </PageHeader>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-[11px] text-muted-foreground">{s.label}</p>
              <p className="mt-1 text-lg font-semibold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-2">
          <Table>
            <THead>
              <TR><TH>Invoice</TH><TH>Student</TH><TH>Issued</TH><TH>Due</TH><TH className="text-right">Total</TH><TH className="text-right">Balance</TH><TH>Status</TH></TR>
            </THead>
            <TBody>
              {withTotals.map((inv) => (
                <TR key={inv.id}>
                  <TD>
                    <Link href={`/billing/${inv.id}`} className="text-xs font-semibold text-primary hover:underline">{inv.number}</Link>
                  </TD>
                  <TD className="text-xs">{fullName(inv.student?.user)}</TD>
                  <TD className="text-xs">{formatDate(inv.issuedAt)}</TD>
                  <TD className="text-xs">{formatDate(inv.dueAt)}</TD>
                  <TD className="text-right text-xs font-medium tabular-nums">{formatCurrency(inv.total)}</TD>
                  <TD className="text-right text-xs tabular-nums">{formatCurrency(Math.max(0, inv.total - inv.paid))}</TD>
                  <TD><StatusBadge status={inv.status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
