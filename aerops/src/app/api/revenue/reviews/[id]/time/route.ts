import { NextResponse } from "next/server";
import { z } from "zod";
import type { RevenueReviewStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { canEditInstructorTime } from "@/lib/revenue-access";

/**
 * Instructor time entry on a Revenue Review (doc 03, ADR-025). An instructor
 * records the time they actually taught — flight/ground/briefing — which the
 * approval engine (Phase 3) later confirms. Only editable while the review is
 * still pre-approval; once Operations approves, the snapshot is frozen.
 */

// Only DRAFT/AWAITING_INSTRUCTOR_REVIEW/CHANGES_REQUESTED accept time edits;
// any later (frozen) state is locked. Mirrors revenue-review.ts's guard set.
const EDITABLE_STATUSES: RevenueReviewStatus[] = ["DRAFT", "AWAITING_INSTRUCTOR_REVIEW", "CHANGES_REQUESTED"];

const timeSchema = z.object({
  category: z.enum([
    "FLIGHT_INSTRUCTION", "GROUND_INSTRUCTION", "PREFLIGHT_BRIEFING", "POSTFLIGHT_DEBRIEFING",
    "SIMULATOR_INSTRUCTION", "ORAL_PREPARATION", "CHECKRIDE_PREPARATION", "STAGE_CHECK",
    "GROUND_SCHOOL", "ADMINISTRATIVE", "CUSTOM",
  ]),
  customLabel: z.string().max(120).nullish(),
  hours: z.number().positive(),
  billToCustomer: z.boolean(),
  compensable: z.boolean(),
  notes: z.string().max(500).nullish(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await authorize("revenue.time_entry", { mutating: true });
  if (error) return error;

  const { id } = await params;
  const review = await db.revenueReview.findFirst({
    where: { id, organizationId: session.organizationId },
  });
  if (!review) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!review.instructorId) {
    return NextResponse.json({ error: "This review has no instructor to log time against." }, { status: 400 });
  }
  // Own time only: revenue.time_entry is "own"; acting on another instructor's
  // review requires revenue.time_override (doc 03 §5). UI hiding is not the gate.
  if (!(await canEditInstructorTime(session, review.instructorId))) {
    return NextResponse.json({ error: "You can only log time on your own reviews." }, { status: 403 });
  }
  if (!EDITABLE_STATUSES.includes(review.status)) {
    return NextResponse.json({ error: "This review is locked" }, { status: 409 });
  }

  const body = timeSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const entry = await db.instructorTimeEntry.create({
    data: {
      organizationId: session.organizationId,
      revenueReviewId: review.id,
      instructorId: review.instructorId,
      source: "INSTRUCTOR_ENTERED",
      category: body.data.category,
      customLabel: body.data.customLabel ?? null,
      hours: body.data.hours,
      billToCustomer: body.data.billToCustomer,
      compensable: body.data.compensable,
      notes: body.data.notes ?? null,
      confirmedByInstructorAt: new Date(),
    },
  });

  await recordAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: "revenue.time_entry.add",
    entityType: "InstructorTimeEntry",
    entityId: entry.id,
    newValue: {
      revenueReviewId: review.id, category: entry.category, hours: Number(entry.hours),
      billToCustomer: entry.billToCustomer, compensable: entry.compensable,
    },
  });

  return NextResponse.json({ entry }, { status: 201 });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await authorize("revenue.time_entry", { mutating: true });
  if (error) return error;

  const { id } = await params;
  const entryId = new URL(req.url).searchParams.get("entryId");
  if (!entryId) return NextResponse.json({ error: "entryId is required" }, { status: 400 });

  const review = await db.revenueReview.findFirst({
    where: { id, organizationId: session.organizationId },
  });
  if (!review) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (review.instructorId && !(await canEditInstructorTime(session, review.instructorId))) {
    return NextResponse.json({ error: "You can only edit time on your own reviews." }, { status: 403 });
  }
  if (!EDITABLE_STATUSES.includes(review.status)) {
    return NextResponse.json({ error: "This review is locked" }, { status: 409 });
  }

  // Scope the entry to the org-owned review — a cross-tenant or mismatched
  // entryId matches nothing and 404s rather than deleting another org's row.
  const entry = await db.instructorTimeEntry.findFirst({
    where: { id: entryId, revenueReviewId: review.id, organizationId: session.organizationId },
  });
  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.instructorTimeEntry.delete({ where: { id: entry.id } });

  await recordAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: "revenue.time_entry.remove",
    entityType: "InstructorTimeEntry",
    entityId: entry.id,
    oldValue: { revenueReviewId: review.id, category: entry.category, hours: Number(entry.hours) },
  });

  return NextResponse.json({ ok: true });
}
