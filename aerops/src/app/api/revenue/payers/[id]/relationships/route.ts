import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";

/**
 * Payer ↔ student relationships (doc 11 §4). Staff link another student to an
 * existing payer, set/clear the student's ACTIVE default payer, or revoke a
 * link. Everything is org-scoped from the session and audited. One ACTIVE
 * default payer per student is an invariant enforced on every default write.
 */

const linkSchema = z.object({
  studentId: z.string().trim().min(1),
  isDefault: z.boolean().optional(),
  canViewInvoices: z.boolean().optional(),
  canManagePaymentMethods: z.boolean().optional(),
});

async function loadOrgPayer(payerId: string, organizationId: string) {
  return db.responsiblePayer.findFirst({ where: { id: payerId, organizationId }, select: { id: true } });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await authorize("revenue.payment_methods_manage", { mutating: true });
  if (error) return error;
  const { id: payerId } = await params;

  const payer = await loadOrgPayer(payerId, session.organizationId);
  if (!payer) return NextResponse.json({ error: "Payer not found." }, { status: 404 });

  const parsed = linkSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A studentId is required.", details: parsed.error.flatten() }, { status: 400 });
  const { studentId, isDefault, canViewInvoices, canManagePaymentMethods } = parsed.data;
  const actorLabel = `${session.firstName} ${session.lastName}`;

  // Cross-tenant guard: the student must belong to this org.
  const student = await db.student.findFirst({ where: { id: studentId, user: { organizationId: session.organizationId } }, select: { id: true } });
  if (!student) return NextResponse.json({ error: "That student isn't in your organization." }, { status: 404 });

  await db.$transaction(async (tx) => {
    if (isDefault) {
      await tx.studentPayerRelationship.updateMany({
        where: { organizationId: session.organizationId, studentId, isDefault: true },
        data: { isDefault: false },
      });
    }
    // Idempotent link (unique studentId+payerId): reactivate/adjust if it exists.
    await tx.studentPayerRelationship.upsert({
      where: { studentId_payerId: { studentId, payerId } },
      create: {
        organizationId: session.organizationId,
        studentId,
        payerId,
        isDefault: !!isDefault,
        canViewInvoices: canViewInvoices ?? true,
        canManagePaymentMethods: canManagePaymentMethods ?? true,
        createdByLabel: actorLabel,
      },
      update: {
        status: "ACTIVE",
        revokedAt: null,
        revokedReason: null,
        isDefault: isDefault ?? undefined,
        canViewInvoices: canViewInvoices ?? undefined,
        canManagePaymentMethods: canManagePaymentMethods ?? undefined,
      },
    });
  });

  await recordAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    actorLabel,
    action: "revenue.payer.relationship_link",
    entityType: "StudentPayerRelationship",
    entityId: payerId,
    newValue: { payerId, studentId, isDefault: !!isDefault },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await authorize("revenue.payment_methods_manage", { mutating: true });
  if (error) return error;
  const { id: payerId } = await params;

  const payer = await loadOrgPayer(payerId, session.organizationId);
  if (!payer) return NextResponse.json({ error: "Payer not found." }, { status: 404 });

  const studentId = new URL(req.url).searchParams.get("studentId");
  if (!studentId) return NextResponse.json({ error: "A studentId is required to revoke a relationship." }, { status: 400 });
  const actorLabel = `${session.firstName} ${session.lastName}`;

  // Revoke (not delete): the row stays for the audit trail; ACTIVE-status
  // filtering in resolvePayerScope removes the payer's access immediately.
  const revoked = await db.studentPayerRelationship.updateMany({
    where: { organizationId: session.organizationId, payerId, studentId, status: { not: "REVOKED" } },
    data: { status: "REVOKED", revokedAt: new Date(), isDefault: false, revokedReason: `Revoked by ${actorLabel}` },
  });
  if (revoked.count === 0) return NextResponse.json({ error: "No active relationship to revoke." }, { status: 404 });

  await recordAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    actorLabel,
    action: "revenue.payer.relationship_revoke",
    entityType: "StudentPayerRelationship",
    entityId: payerId,
    newValue: { payerId, studentId, status: "REVOKED" },
  });
  return NextResponse.json({ ok: true });
}
