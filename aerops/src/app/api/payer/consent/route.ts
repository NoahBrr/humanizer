import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authorizePayer } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { resolvePayerScope } from "@/lib/payers";

/**
 * Payer-initiated revocation of off-session charging authorization (doc 20 §R-P12,
 * doc 36 §5.2). Stamps `revokedAt` on the still-valid consents bound to one of the
 * caller's own saved methods. Consent validity is derived at read (never a stored
 * status), so revocation here simply makes those rows fail the validity check.
 * Scoped to a payment customer the acting payer owns; audited.
 */
export async function DELETE(req: Request) {
  const { session, error } = await authorizePayer({ mutating: true });
  if (error) return error;

  const methodId = new URL(req.url).searchParams.get("methodId");
  if (!methodId) return NextResponse.json({ error: "A methodId is required." }, { status: 400 });

  const scope = await resolvePayerScope(session.userId);
  const method = await db.paymentMethodReference.findFirst({
    where: { id: methodId, customer: { payerId: { in: scope.payerIds.length ? scope.payerIds : ["__none__"] } } },
    select: { id: true, organizationId: true },
  });
  if (!method) return NextResponse.json({ error: "Payment method not found." }, { status: 404 });

  const actorLabel = `${session.firstName} ${session.lastName}`.trim() || session.email;
  const revoked = await db.paymentConsent.updateMany({
    where: { paymentMethodReferenceId: method.id, revokedAt: null, supersededAt: null },
    data: { revokedAt: new Date(), revokedByUserId: session.userId, revokedByLabel: actorLabel, revokedReason: "Revoked by payer" },
  });
  if (revoked.count === 0) return NextResponse.json({ error: "No active authorization to revoke." }, { status: 404 });

  await recordAudit({
    organizationId: method.organizationId,
    actorUserId: session.userId,
    actorLabel,
    action: "revenue.payment_consent.revoke",
    entityType: "PaymentMethodReference",
    entityId: method.id,
    newValue: { revoked: revoked.count },
  });
  return NextResponse.json({ ok: true });
}
