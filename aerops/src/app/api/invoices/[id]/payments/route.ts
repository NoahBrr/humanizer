import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";

const paymentSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(["CARD", "ACH", "CASH", "CHECK", "ACCOUNT_CREDIT", "GIFT_CERTIFICATE"]).default("CARD"),
  reference: z.string().nullish(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await authorize("billing.record_payments", { mutating: true });
  if (error) return error;

  const { id } = await params;
  const invoice = await db.invoice.findFirst({
    where: { id, organizationId: session.organizationId },
    include: { lines: true, payments: true },
  });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (invoice.status === "PAID" || invoice.status === "VOID") {
    return NextResponse.json({ error: `Invoice is already ${invoice.status.toLowerCase()}` }, { status: 400 });
  }

  const body = paymentSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const total = invoice.lines.reduce((t, l) => t + Number(l.quantity) * Number(l.unitPrice), 0);
  const paidSoFar = invoice.payments.reduce((t, p) => t + Number(p.amount), 0);
  const newPaid = paidSoFar + body.data.amount;
  const nextStatus = newPaid >= total - 0.005 ? "PAID" : "PARTIALLY_PAID";

  const [payment] = await db.$transaction([
    db.payment.create({
      data: { invoiceId: id, amount: body.data.amount, method: body.data.method, reference: body.data.reference ?? null },
    }),
    db.invoice.update({ where: { id }, data: { status: nextStatus } }),
    ...(invoice.studentId
      ? [db.student.update({ where: { id: invoice.studentId }, data: { accountBalance: { increment: body.data.amount } } })]
      : []),
  ]);

  await recordAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: "billing.payment_recorded",
    entityType: "Invoice",
    entityId: id,
    newValue: { amount: body.data.amount, method: body.data.method, status: nextStatus },
  });

  return NextResponse.json({ payment, status: nextStatus }, { status: 201 });
}
