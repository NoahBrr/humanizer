import { db } from "@/lib/db";
import type { Permission } from "@/lib/permissions";

/**
 * Revenue Review access scoping (doc 03 §6.1). `revenue.review_view` is a single
 * key that means "all reviews" for operations/finance/admin but "own reviews
 * only" for an instructor. This resolves that discrimination server-side — UI
 * hiding is never the boundary.
 */

type ViewerSession = { userId: string; organizationId: string; permissions: ReadonlySet<Permission> };

/** The acting user's Instructor id in this org, or null if they are not an instructor. */
export async function actingInstructorId(session: ViewerSession): Promise<string | null> {
  const inst = await db.instructor.findFirst({
    where: { userId: session.userId, user: { organizationId: session.organizationId } },
    select: { id: true },
  });
  return inst?.id ?? null;
}

/**
 * A Prisma `where` fragment scoping RevenueReview visibility for the viewer:
 * - operations/finance/admin (revenue.approve or billing.view): all org reviews
 * - an instructor without that grant: only reviews where they are the instructor
 * - any other review_view holder (e.g. a dispatcher): all org reviews
 * Combine with `{ organizationId }` — never trust a client-supplied scope.
 */
export async function reviewViewFilter(session: ViewerSession): Promise<{ instructorId?: string }> {
  if (session.permissions.has("revenue.approve") || session.permissions.has("billing.view")) return {};
  const instId = await actingInstructorId(session);
  return instId ? { instructorId: instId } : {};
}

/**
 * True if the acting user may enter/edit time on `review` as its instructor:
 * either they ARE the review's instructor, or they hold `revenue.time_override`
 * (supervisors correcting another instructor's time — doc 03 §5, reason required).
 */
export async function canEditInstructorTime(
  session: ViewerSession & { permissions: ReadonlySet<Permission> },
  reviewInstructorId: string,
): Promise<boolean> {
  if (session.permissions.has("revenue.time_override")) return true;
  const instId = await actingInstructorId(session);
  return instId !== null && instId === reviewInstructorId;
}
