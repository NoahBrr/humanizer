import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { APPROVABLE } from "@/lib/revenue-review";

const schema = z.object({ reason: z.string().min(3).max(500) });

/** Operations sends a review back to the instructor (doc 03) — reason required. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await authorize("revenue.approve", { mutating: true });
  if (error) return error;
  const { id } = await params;

  const body = schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: "A reason is required to request changes." }, { status: 400 });

  const review = await db.revenueReview.findFirst({ where: { id, organizationId: session.organizationId } });
  if (!review) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!APPROVABLE.includes(review.status)) {
    return NextResponse.json({ error: "This review is not awaiting approval." }, { status: 409 });
  }

  let concurrent = false;
  await db.$transaction(async (tx) => {
    const claim = await tx.revenueReview.updateMany({
      where: { id, status: "AWAITING_OPERATIONS_REVIEW" },
      data: { status: "CHANGES_REQUESTED", changesRequestedAt: new Date(), changesRequestedById: session.userId, changesRequestedReason: body.data.reason },
    });
    if (claim.count === 0) { concurrent = true; return; }
    // Invalidate every live approval signature — the corrected numbers must be
    // freshly approved; no prior signature carries to the new total (doc 03 §2.7).
    await tx.revenueReviewApproval.updateMany({
      where: { revenueReviewId: id, supersededAt: null },
      data: { supersededAt: new Date() },
    });
  });
  if (concurrent) return NextResponse.json({ error: "This review was just updated. Refresh and try again." }, { status: 409 });

  await recordAudit({
    organizationId: session.organizationId, actorUserId: session.userId, actorLabel: `${session.firstName} ${session.lastName}`,
    action: "revenue.review.request_changes", entityType: "RevenueReview", entityId: id,
    oldValue: { status: review.status }, newValue: { status: "CHANGES_REQUESTED", reason: body.data.reason },
  });
  return NextResponse.json({ status: "CHANGES_REQUESTED" });
}
