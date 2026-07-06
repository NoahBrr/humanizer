import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";

const paymentSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(["CARD", "ACH", "CASH", "CHECK", "ACCOUNT_CREDIT", "GIFT_CERTIFICATE"]).default("CARD"),
  reference: z.string().nullish(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["SUPER_ADMIN", "SCHOOL_ADMIN", "ACCOUNTANT", "DISPATCHER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const invoice = await db.invoice.findFirst({
    where: { id, organizationId: session.user.organizationId },
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

  return NextResponse.json({ payment, status: nextStatus }, { status: 201 });
}
