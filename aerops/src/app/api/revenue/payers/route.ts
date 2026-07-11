import { NextResponse } from "next/server";
import { z } from "zod";
import { PayerType } from "@prisma/client";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { issuePayerInvite } from "@/lib/payers";

/**
 * Staff-side responsible-payer management (doc 11 §4). An operator creates a
 * payer (a real login who bills for one or more students) and optionally links
 * a student, then hands the returned single-use invite token to the payer to
 * claim the account. No money moves here — this is identity + routing only.
 */

const INVITE_EXPIRY_DAYS = 14;

const createSchema = z.object({
  payerType: z.nativeEnum(PayerType),
  displayName: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(200),
  companyName: z.string().trim().max(200).optional(),
  studentId: z.string().trim().min(1).optional(),
  isDefault: z.boolean().optional(),
});

export async function GET() {
  const { session, error } = await authorize("revenue.payment_methods_manage");
  if (error) return error;
  const payers = await db.responsiblePayer.findMany({
    where: { organizationId: session.organizationId },
    orderBy: { createdAt: "desc" },
    include: {
      relationships: {
        include: { student: { include: { user: { select: { firstName: true, lastName: true } } } } },
      },
    },
  });
  return NextResponse.json({ payers });
}

export async function POST(req: Request) {
  const { session, error } = await authorize("revenue.payment_methods_manage", { mutating: true });
  if (error) return error;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a payer type, display name, and email.", details: parsed.error.flatten() }, { status: 400 });
  }
  const { payerType, displayName, email, companyName, studentId, isDefault } = parsed.data;
  const actorLabel = `${session.firstName} ${session.lastName}`;

  // Cross-tenant guard: a linked student must belong to THIS org (from the
  // session, never trusting the client's id) — otherwise a payer could be
  // wired to another tenant's student.
  if (studentId) {
    const student = await db.student.findFirst({
      where: { id: studentId, user: { organizationId: session.organizationId } },
      select: { id: true },
    });
    if (!student) return NextResponse.json({ error: "That student isn't in your organization." }, { status: 404 });
  }

  const payer = await db.$transaction(async (tx) => {
    const created = await tx.responsiblePayer.create({
      data: {
        organizationId: session.organizationId,
        payerType,
        displayName,
        email,
        companyName: companyName ?? null,
        status: "INVITED",
        invitedByLabel: actorLabel,
      },
    });
    if (studentId) {
      // One ACTIVE default payer per student: clear the others first.
      if (isDefault) {
        await tx.studentPayerRelationship.updateMany({
          where: { organizationId: session.organizationId, studentId, isDefault: true },
          data: { isDefault: false },
        });
      }
      await tx.studentPayerRelationship.create({
        data: {
          organizationId: session.organizationId,
          studentId,
          payerId: created.id,
          isDefault: !!isDefault,
          createdByLabel: actorLabel,
        },
      });
    }
    return created;
  });

  // Raw invite token is returned to staff exactly once (only its hash persists).
  const inviteToken = await issuePayerInvite(payer.id, INVITE_EXPIRY_DAYS);

  await recordAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    actorLabel,
    action: "revenue.payer.create",
    entityType: "ResponsiblePayer",
    entityId: payer.id,
    newValue: { payerType, displayName, email, studentId: studentId ?? null, isDefault: !!isDefault },
  });

  return NextResponse.json(
    { payer: { id: payer.id, displayName: payer.displayName, email: payer.email, status: payer.status }, inviteToken },
    { status: 201 },
  );
}
