import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Receipt } from "lucide-react";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatCurrency, formatDate, fullName } from "@/lib/utils";
import { PaymentForm } from "./payment-form";

export const dynamic = "force-dynamic";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const { id } = await params;
  const inv = await db.invoice.findFirst({
    where: { id, organizationId: session!.organizationId },
    include: {
      organization: { select: { name: true } },
      student: { include: { user: true } },
      lines: true,
      payments: { orderBy: { paidAt: "desc" } },
    },
  });
  if (!inv) notFound();

  const total = inv.lines.reduce((t, l) => t + Number(l.quantity) * Number(l.unitPrice), 0);
  const paid = inv.payments.reduce((t, p) => t + Number(p.amount), 0);
  const due = Math.max(0, total - paid);
  const canPay = session!.permissions.has("billing.record_payments") && !session!.impersonation?.readOnly;

  return (
    <div className="animate-fade-up mx-auto max-w-3xl space-y-4">
      <Link href="/billing" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> All invoices
      </Link>

      <Card>
        <CardHeader className="flex-row items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
              <Receipt className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base">{inv.number}</CardTitle>
              <CardDescription>
                {inv.organization.name} → {fullName(inv.student?.user)} · Issued {formatDate(inv.issuedAt)} · Due {formatDate(inv.dueAt)}
              </CardDescription>
            </div>
          </div>
          <StatusBadge status={inv.status} />
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR><TH>Description</TH><TH className="text-right">Qty</TH><TH className="text-right">Rate</TH><TH className="text-right">Amount</TH></TR>
            </THead>
            <TBody>
              {inv.lines.map((l) => (
                <TR key={l.id}>
                  <TD className="text-xs">
                    <span className="font-medium">{l.description}</span>
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{l.kind.replaceAll("_", " ").toLowerCase()}</span>
                  </TD>
                  <TD className="text-right text-xs tabular-nums">{Number(l.quantity).toFixed(1)}</TD>
                  <TD className="text-right text-xs tabular-nums">{formatCurrency(l.unitPrice)}</TD>
                  <TD className="text-right text-xs font-medium tabular-nums">{formatCurrency(Number(l.quantity) * Number(l.unitPrice))}</TD>
                </TR>
              ))}
            </TBody>
          </Table>

          <div className="mt-4 ml-auto w-56 space-y-1.5 text-sm">
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{formatCurrency(total)}</span></div>
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Payments</span><span className="tabular-nums">-{formatCurrency(paid)}</span></div>
            <div className="flex justify-between border-t border-border pt-1.5 font-semibold"><span>Balance due</span><span className="tabular-nums">{formatCurrency(due)}</span></div>
          </div>

          {inv.memo && <p className="mt-4 rounded-lg bg-muted p-3 text-xs text-muted-foreground">{inv.memo}</p>}
        </CardContent>
      </Card>

      {inv.payments.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Payment History</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {inv.payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-xs">
                <span>{formatDate(p.paidAt)} · {p.method.replaceAll("_", " ").toLowerCase()}{p.reference ? ` · ${p.reference}` : ""}</span>
                <span className="font-semibold tabular-nums">{formatCurrency(p.amount)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {canPay && due > 0 && inv.status !== "VOID" && <PaymentForm invoiceId={inv.id} amountDue={due} />}
    </div>
  );
}
