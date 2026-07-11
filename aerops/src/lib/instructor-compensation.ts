import { Prisma, type CompensationApprovalMode } from "@prisma/client";
import { resolveInstructorRate, computeInstructorCharge, type RateProfileCandidate } from "@/lib/instructor-rates";

/**
 * Instructor compensation birth (doc 04/29). At Revenue Review approval, one
 * InstructorEarning is created per compensable time entry from the resolved
 * COMPENSATION rate — a rate system STRUCTURALLY SEPARATE from customer billing
 * (principle 6): never inferred from what the customer was charged. Earnings are
 * append-only; clawbacks/refunds are signed reversal rows in a later phase.
 * If no compensation rate is configured for an instructor, NO earning is created
 * (doc 04) — a manual/backfill path fills the gap; the ledger comp lines reflect
 * only earnings that exist, so J1 still balances.
 */

const Z = new Prisma.Decimal(0);

type EarningInput = {
  organizationId: string;
  instructorId: string;
  revenueReviewId: string;
  locationId: string | null;
  currency: string;
  approvedAt: Date;
  timeEntries: { id: string; category: RateProfileCandidate["lines"][number]["category"]; customLabel: string | null; hours: Prisma.Decimal; compensable: boolean }[];
  compensationApprovalMode: CompensationApprovalMode;
};

/**
 * Create the InstructorEarning rows inside the approval transaction. Returns the
 * total accrued compensation so the caller posts the INSTRUCTOR_COMP_EXPENSE /
 * INSTRUCTOR_COMP_PAYABLE ledger lines.
 */
export async function birthEarnings(tx: Prisma.TransactionClient, input: EarningInput): Promise<Prisma.Decimal> {
  const compensable = input.timeEntries.filter((t) => t.compensable);
  if (compensable.length === 0) return Z;

  // Load the instructor's + org-wide COMPENSATION profiles (with lines).
  const profiles = await tx.instructorRateProfile.findMany({
    where: {
      organizationId: input.organizationId,
      kind: "COMPENSATION",
      status: "APPROVED",
      OR: [{ instructorId: input.instructorId }, { instructorId: null }],
    },
    include: { lines: true },
  });
  const candidates = profiles as unknown as RateProfileCandidate[];
  const ctx = { instructorId: input.instructorId, syllabusId: null, locationId: input.locationId, explicitProfileId: null };

  let total = Z;
  for (const te of compensable) {
    const res = resolveInstructorRate(candidates, ctx, "COMPENSATION", te.category, input.approvedAt, te.customLabel ?? "");
    if (res.rate == null) continue; // compensation not configured for this instructor/category
    const amount = computeInstructorCharge(te.hours, res.rate);
    total = total.plus(amount);
    await tx.instructorEarning.create({
      data: {
        organizationId: input.organizationId,
        instructorId: input.instructorId,
        revenueReviewId: input.revenueReviewId,
        timeEntryId: te.id,
        category: te.category,
        customLabel: te.customLabel ?? null,
        hours: te.hours,
        rate: res.rate,
        amount,
        currency: input.currency,
        classification: profileClassification(candidates, res.profileId),
        rateProfileId: res.profileId,
        rateProfileVersion: res.profileVersion,
        rateSource: { tier: res.tier, warnings: res.warnings } as unknown as Prisma.InputJsonValue,
        // AUTO_ON_REVIEW_APPROVAL writes payable rows directly; SEPARATE_APPROVAL holds at PENDING.
        status: input.compensationApprovalMode === "SEPARATE_APPROVAL" ? "PENDING" : "APPROVED",
        approvedAt: input.compensationApprovalMode === "SEPARATE_APPROVAL" ? null : input.approvedAt,
      },
    });
  }
  return total;
}

function profileClassification(candidates: RateProfileCandidate[], profileId: string | null): "EMPLOYEE" | "CONTRACTOR" | "UNSPECIFIED" {
  const p = candidates.find((c) => c.id === profileId) as (RateProfileCandidate & { classification?: "EMPLOYEE" | "CONTRACTOR" | "UNSPECIFIED" }) | undefined;
  return p?.classification ?? "UNSPECIFIED";
}
