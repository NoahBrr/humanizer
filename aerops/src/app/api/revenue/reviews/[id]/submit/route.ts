import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { SUBMITTABLE } from "@/lib/revenue-review";
import { canEditInstructorTime } from "@/lib/revenue-access";

/**
 * Submit a Revenue Review for Operations approval (doc 03 §2). The instructor
 * confirms their time and hands the review to Operations. Own-review only —
 * an instructor submits their own review unless they hold revenue.time_override.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await authorize("revenue.review_submit", { mutating: true });
  if (error) return error;
  const { id } = await params;

  const review = await db.revenueReview.findFirst({ where: { id, organizationId: session.organizationId } });
  if (!review) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (review.instructorId && !(await canEditInstructorTime(session, review.instructorId))) {
    return NextResponse.json({ error: "You can only submit your own reviews." }, { status: 403 });
  }
  if (!SUBMITTABLE.includes(review.status)) {
    return NextResponse.json({ error: "This review can no longer be submitted." }, { status: 409 });
  }

  // Guarded transition — a concurrent submit/void matches zero rows and 409s.
  const claim = await db.revenueReview.updateMany({
    where: { id, status: { in: SUBMITTABLE } },
    data: { status: "AWAITING_OPERATIONS_REVIEW", submittedAt: new Date(), submittedById: session.userId },
  });
  if (claim.count === 0) return NextResponse.json({ error: "This review was just updated. Refresh and try again." }, { status: 409 });

  await recordAudit({
    organizationId: session.organizationId, actorUserId: session.userId, actorLabel: `${session.firstName} ${session.lastName}`,
    action: "revenue.review.submit", entityType: "RevenueReview", entityId: id,
    oldValue: { status: review.status }, newValue: { status: "AWAITING_OPERATIONS_REVIEW" },
  });
  return NextResponse.json({ status: "AWAITING_OPERATIONS_REVIEW" });
}
