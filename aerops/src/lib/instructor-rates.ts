import { Prisma } from "@prisma/client";

/**
 * Instructor rate resolution (doc 04). Mirrors the aircraft pricing resolver
 * (doc 05 / pricing.ts): 8 tiers, deterministic tie-break, AMBIGUOUS_RATE that
 * blocks approval but never closeout. Two structurally separate rate systems —
 * BILLING (what the customer is charged) and COMPENSATION (what the instructor
 * earns) — never inferred from each other (principle 6). Pure and Decimal.
 */

export type RateKind = "BILLING" | "COMPENSATION";
export type TimeCategory =
  | "FLIGHT_INSTRUCTION" | "GROUND_INSTRUCTION" | "PREFLIGHT_BRIEFING" | "POSTFLIGHT_DEBRIEFING"
  | "SIMULATOR_INSTRUCTION" | "ORAL_PREPARATION" | "CHECKRIDE_PREPARATION" | "STAGE_CHECK"
  | "GROUND_SCHOOL" | "ADMINISTRATIVE" | "CUSTOM";

export type RateLine = {
  id: string;
  category: TimeCategory;
  customLabel: string;
  rate: Prisma.Decimal | null;
  percentOfBilling: Prisma.Decimal | null;
  minBillableHours: Prisma.Decimal | null;
};

export type RateProfileCandidate = {
  id: string;
  kind: RateKind;
  version: number;
  name: string;
  status: "DRAFT" | "APPROVED" | "ARCHIVED";
  instructorId: string | null;
  syllabusId: string | null;
  locationId: string | null;
  priority: number;
  currency: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  createdAt: Date;
  lines: RateLine[];
  /** Synthesized tier-8 legacy fallback (BILLING only). */
  isLegacyFallback?: boolean;
};

export type RateContext = {
  instructorId: string;
  syllabusId: string | null;
  locationId: string | null;
  explicitProfileId: string | null;
};

export type RateResolution = {
  rate: Prisma.Decimal | null;
  currency: string | null;
  profileId: string | null;
  profileVersion: number | null;
  lineId: string | null;
  tier: number | null;
  ambiguous: boolean;
  legacy: boolean;
  reasons: { code: string; detail: string }[];
  warnings: { code: string; detail: string }[];
};

function effectiveApproved(p: RateProfileCandidate, at: Date): boolean {
  if (p.status !== "APPROVED") return false;
  if (p.effectiveFrom.getTime() > at.getTime()) return false;
  if (p.effectiveTo && p.effectiveTo.getTime() <= at.getTime()) return false;
  return true;
}

/** Tier of a candidate given the context; null = not applicable. */
function tierOf(p: RateProfileCandidate, ctx: RateContext): number | null {
  if (ctx.explicitProfileId && p.id === ctx.explicitProfileId) return 1;
  const inst = p.instructorId === ctx.instructorId;
  const prog = p.syllabusId !== null && p.syllabusId === ctx.syllabusId;
  const loc = p.locationId !== null && p.locationId === ctx.locationId;
  if (p.syllabusId && !prog) return null; // scoped to a different program
  if (p.locationId && !loc) return null; // scoped to a different location
  if (p.instructorId && !inst) return null; // scoped to a different instructor
  if (prog && inst) return 2;
  if (prog && !p.instructorId) return 3;
  if (loc && inst) return 4;
  if (loc && !p.instructorId) return 5;
  if (inst && !p.syllabusId && !p.locationId) return 6;
  if (!p.instructorId && !p.syllabusId && !p.locationId) return p.isLegacyFallback ? 8 : 7;
  return null;
}

function lineFor(p: RateProfileCandidate, category: TimeCategory, customLabel: string): RateLine | undefined {
  return p.lines.find((l) => l.category === category && (category !== "CUSTOM" || l.customLabel === customLabel));
}

/**
 * Resolve the rate for one (kind, category) at time `at`. `candidates` are the
 * org's rate profiles of the given kind; supply the legacy fallback for BILLING
 * only when the instructor's hourlyRate was explicitly set.
 */
export function resolveInstructorRate(
  candidates: RateProfileCandidate[],
  ctx: RateContext,
  kind: RateKind,
  category: TimeCategory,
  at: Date,
  customLabel = "",
): RateResolution {
  const applicable = candidates
    .filter((p) => p.kind === kind)
    .filter((p) => p.isLegacyFallback || effectiveApproved(p, at))
    .map((p) => ({ p, tier: tierOf(p, ctx), line: lineFor(p, category, customLabel) }))
    .filter((x): x is { p: RateProfileCandidate; tier: number; line: RateLine } => x.tier !== null && x.line !== undefined);

  for (let tier = 1; tier <= 8; tier++) {
    const atTier = applicable.filter((x) => x.tier === tier);
    if (atTier.length === 0) continue;

    const minPriority = Math.min(...atTier.map((x) => x.p.priority));
    const top = atTier.filter((x) => x.p.priority === minPriority);
    const ordered = [...top].sort((a, b) =>
      b.p.effectiveFrom.getTime() - a.p.effectiveFrom.getTime() ||
      a.p.createdAt.getTime() - b.p.createdAt.getTime() ||
      (a.p.id < b.p.id ? -1 : a.p.id > b.p.id ? 1 : 0),
    );
    const win = ordered[0];
    const reasons = [{ code: `RESOLVED_TIER_${tier}`, detail: `${kind} ${category}: "${win.p.name}" tier ${tier}` }];
    const warnings: { code: string; detail: string }[] = [];
    const legacy = !!win.p.isLegacyFallback;
    if (legacy) warnings.push({ code: "LEGACY", detail: "billed at legacy default rate — create an Instructor Rate Profile" });
    const ambiguous = top.length > 1;
    if (ambiguous) warnings.push({ code: "AMBIGUOUS_RATE", detail: `Multiple ${kind} profiles tie at tier ${tier}: ${top.map((x) => x.p.name).join(", ")}` });

    return {
      rate: win.line.rate, currency: win.p.currency, profileId: win.p.id, profileVersion: win.p.version,
      lineId: win.line.id, tier, ambiguous, legacy, reasons, warnings,
    };
  }

  // No candidate — the "unpriced instructor time" blocking condition.
  return {
    rate: null, currency: null, profileId: null, profileVersion: null, lineId: null, tier: null,
    ambiguous: false, legacy: false, reasons: [],
    warnings: [{ code: "UNPRICED_INSTRUCTOR_TIME", detail: `No ${kind} rate for ${category} — create an Instructor Rate Profile before approval` }],
  };
}

/**
 * Billing/compensation charge for a block of instructor time: apply the minimum
 * billable hours (if the resolved line sets one), then hours × rate, half-up to
 * cents. Decimal throughout.
 */
export function computeInstructorCharge(hours: Prisma.Decimal.Value, rate: Prisma.Decimal, minBillableHours?: Prisma.Decimal | null): Prisma.Decimal {
  let h = new Prisma.Decimal(hours);
  if (minBillableHours && h.lessThan(minBillableHours)) h = minBillableHours;
  return h.times(rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}
