import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { VOIDABLE } from "@/lib/revenue-review";

const schema = z.object({ reason: z.string().min(3).max(500) });

/** Distinguishes a lost concurrency claim (→ 409) from a real failure (→ 500). */
class Concurrent extends Error {}

/**
 * Void a Revenue Review before payment (doc 03 §2). Reason required, audited.
 * Voiding also VOIDs the wrapped invoice. Only pre-payment states are voidable;
 * once a payment exists (Phase 5) a review is refunded/adjusted, never voided.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await authorize("revenue.void", { mutating: true });
  if (error) return error;
  const { id } = await params;

  const body = schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: "A reason is required to void a review." }, { status: 400 });

  const review = await db.revenueReview.findFirst({ where: { id, organizationId: session.organizationId } });
  if (!review) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!VOIDABLE.includes(review.status)) {
    return NextResponse.json({ error: "This review can no longer be voided." }, { status: 409 });
  }

  try {
    await db.$transaction(async (tx) => {
      const claim = await tx.revenueReview.updateMany({
        where: { id, status: { in: VOIDABLE } },
        data: { status: "VOIDED", voidedAt: new Date(), voidedById: session.userId, voidReason: body.data.reason },
      });
      if (claim.count === 0) throw new Concurrent();
      await tx.invoice.update({ where: { id: review.invoiceId }, data: { status: "VOID" } });
    });
  } catch (e) {
    if (e instanceof Concurrent) {
      return NextResponse.json({ error: "This review was just updated. Refresh and try again." }, { status: 409 });
    }
    return NextResponse.json({ error: "The review could not be voided. Please try again." }, { status: 500 });
  }

  await recordAudit({
    organizationId: session.organizationId, actorUserId: session.userId, actorLabel: `${session.firstName} ${session.lastName}`,
    action: "revenue.review.void", entityType: "RevenueReview", entityId: id,
    oldValue: { status: review.status }, newValue: { status: "VOIDED", reason: body.data.reason },
  });
  return NextResponse.json({ status: "VOIDED" });
}
