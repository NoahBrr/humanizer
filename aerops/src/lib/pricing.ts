import { Prisma } from "@prisma/client";

/**
 * Aircraft pricing resolution + rental-charge computation (doc 05, ADR-030).
 *
 * Pure and framework-free — no db, no I/O — so it is fully contract-tested and
 * reused unchanged by the close path and any preview surface. Callers load the
 * candidate profiles (org-scoped, APPROVED) and pass the resolution context;
 * the resolver picks exactly ONE profile deterministically, never guesses
 * silently, and returns a full reason trace (computed answers carry their
 * reasons). Money is Prisma.Decimal end to end — never a JS float.
 */

export type ResolutionLevel = "L1" | "L2" | "L3" | "L4" | "L5" | "L6";

export type PricingBasis = "HOBBS" | "TACH" | "FIXED" | "CUSTOM_UNIT";
export type RoundingRule = "NEAREST_TENTH" | "NEAREST_HUNDREDTH" | "UP_TENTH" | "UP_HUNDREDTH" | "NONE";

/** A candidate pricing profile, narrowed to the fields resolution needs. */
export type PricingCandidate = {
  id: string;
  familyId: string;
  version: number;
  name: string;
  status: "DRAFT" | "APPROVED" | "ARCHIVED";
  aircraftId: string | null;
  locationId: string | null;
  isDefault: boolean;
  priority: number;
  billingBasis: PricingBasis;
  customUnitLabel: string | null;
  wetDry: "WET" | "DRY" | "NOT_APPLICABLE";
  rateAmount: Prisma.Decimal;
  currency: string;
  minBillableQuantity: Prisma.Decimal | null;
  roundingRule: RoundingRule;
  eligibleMembershipRoles: string[];
  eligibleCustomerTypes: string[];
  eligibleProgramIds: string[];
  effectiveStart: Date;
  effectiveEnd: Date | null;
  createdAt: Date;
  /** True for the synthesized legacy fallback (not a real DB row). */
  isLegacyFallback?: boolean;
};

export type ResolutionContext = {
  aircraftId: string;
  explicitProfileId: string | null; // Dispatch.pricingProfileId (L1)
  customerTypes: string[]; // e.g. ["member"] | ["student"] | ["discovery"]
  membershipRoles: string[]; // Role names / "custom:<orgRoleId>"
  programIds: string[]; // Syllabus ids
  locationId: string | null;
};

export type ResolutionReason = { code: string; detail: string };

export type PricingResolution = {
  profile: PricingCandidate | null;
  level: ResolutionLevel | null;
  reasons: ResolutionReason[];
  warnings: ResolutionReason[];
  /** True while an AMBIGUOUS_RATE warning is unresolved — blocks approval, never closeout. */
  ambiguous: boolean;
};

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/** A profile participates only if APPROVED and its effective window covers `at`. */
function effectiveAndApproved(p: PricingCandidate, at: Date): boolean {
  if (p.status !== "APPROVED") return false;
  if (p.effectiveStart.getTime() > at.getTime()) return false;
  if (p.effectiveEnd && p.effectiveEnd.getTime() <= at.getTime()) return false;
  return true;
}

/**
 * Which resolution level a candidate competes at, or null if ineligible.
 * Eligibility is CONJUNCTIVE (doc 05 §3.3 point 4): every configured selector
 * must match. The profile then competes at its highest-precedence selector
 * (program → L2, membership/type → L3, location → L4, defaults → L5/L6).
 */
function levelOf(p: PricingCandidate, ctx: ResolutionContext): ResolutionLevel | null {
  if (ctx.explicitProfileId && p.id === ctx.explicitProfileId) return "L1";
  // Every configured selector must match — a program+location profile whose
  // location differs is ineligible, not eligible-at-L2.
  if (p.eligibleProgramIds.length && !p.eligibleProgramIds.some((id) => ctx.programIds.includes(id))) return null;
  if (p.eligibleMembershipRoles.length && !p.eligibleMembershipRoles.some((r) => ctx.membershipRoles.includes(r))) return null;
  if (p.eligibleCustomerTypes.length && !p.eligibleCustomerTypes.some((t) => ctx.customerTypes.includes(t))) return null;
  if (p.locationId && p.locationId !== ctx.locationId) return null;
  // Classify at the highest-precedence selector present.
  if (p.eligibleProgramIds.length) return "L2";
  if (p.eligibleMembershipRoles.length || p.eligibleCustomerTypes.length) return "L3";
  if (p.locationId) return "L4";
  if (p.isDefault && !p.aircraftId) return "L5";
  if (p.isDefault && p.aircraftId) return "L6";
  return null;
}

const LEVELS: ResolutionLevel[] = ["L1", "L2", "L3", "L4", "L5", "L6"];

/**
 * Resolve exactly one pricing profile. `candidates` are org+aircraft-applicable
 * profiles (aircraftId === ctx.aircraftId OR aircraftId === null); include the
 * synthesized legacy fallback (isLegacyFallback, level L6) so resolution can
 * never come up empty.
 */
export function resolvePricing(candidates: PricingCandidate[], ctx: ResolutionContext, at: Date): PricingResolution {
  const reasons: ResolutionReason[] = [];
  const eligible = candidates
    .filter((p) => p.aircraftId === null || p.aircraftId === ctx.aircraftId)
    .filter((p) => p.isLegacyFallback || effectiveAndApproved(p, at))
    .map((p) => ({ p, level: levelOf(p, ctx) }))
    .filter((x): x is { p: PricingCandidate; level: ResolutionLevel } => x.level !== null);

  // An explicit dispatch selection that is no longer resolvable (archived,
  // out of window, wrong aircraft) degrades to normal resolution — but never
  // silently (doc 05 §6 / V9). The warning rides through to the review.
  const explicitInvalid =
    ctx.explicitProfileId !== null && !eligible.some((x) => x.p.id === ctx.explicitProfileId);
  const carryWarnings: ResolutionReason[] = explicitInvalid
    ? [{ code: "EXPLICIT_SELECTION_INVALID", detail: `The pricing profile selected on the dispatch (${ctx.explicitProfileId}) is no longer applicable; resolution fell back to the standard rules.` }]
    : [];

  for (const level of LEVELS) {
    const atLevel = eligible.filter((x) => x.level === level).map((x) => x.p);
    if (atLevel.length === 0) continue;

    // Within the winning level: aircraft-specific beats fleet-wide, then lowest priority.
    const acSpecific = atLevel.filter((p) => p.aircraftId !== null);
    const pool = acSpecific.length ? acSpecific : atLevel;
    const minPriority = Math.min(...pool.map((p) => p.priority));
    const top = pool.filter((p) => p.priority === minPriority);

    // Deterministic total-order tiebreak so a draft always has numbers.
    const ordered = [...top].sort((a, b) =>
      b.effectiveStart.getTime() - a.effectiveStart.getTime() ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    const chosen = ordered[0];

    reasons.push({ code: `RESOLVED_${level}`, detail: `Selected "${chosen.name}" at level ${level}` });
    if (chosen.isLegacyFallback) reasons.push({ code: "LEGACY_FALLBACK", detail: "Zero-configuration org — billed at the aircraft's legacy wet rate" });

    const warnings: ResolutionReason[] = [...carryWarnings];
    const ambiguous = top.length > 1;
    if (ambiguous) {
      warnings.push({
        code: "AMBIGUOUS_RATE",
        detail: `Multiple profiles tie at ${level} priority ${minPriority}: ${top.map((p) => p.name).join(", ")}. A reviewer must pick one before approval.`,
      });
    }
    return { profile: chosen, level, reasons, warnings, ambiguous };
  }

  // Unreachable when a legacy fallback is supplied, but fail loud rather than silent.
  return { profile: null, level: null, reasons: [{ code: "NO_PROFILE", detail: "No applicable pricing profile and no legacy fallback supplied" }], warnings: carryWarnings, ambiguous: false };
}

export type RentalCharge = {
  rawQuantity: Prisma.Decimal;
  quantity: Prisma.Decimal;
  rateAmount: Prisma.Decimal;
  amount: Prisma.Decimal;
  currency: string;
  basis: PricingBasis;
};

function roundQuantity(q: Prisma.Decimal, rule: RoundingRule): Prisma.Decimal {
  switch (rule) {
    case "NEAREST_TENTH": return q.toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP);
    case "NEAREST_HUNDREDTH": return q.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    case "UP_TENTH": return q.toDecimalPlaces(1, Prisma.Decimal.ROUND_UP);
    case "UP_HUNDREDTH": return q.toDecimalPlaces(2, Prisma.Decimal.ROUND_UP);
    case "NONE": return q;
  }
}

/**
 * Compute the aircraft-rental charge from the resolved profile and meter/quantity
 * inputs. Order is fixed (doc 05 §3.4): raw quantity → round → apply minimum →
 * amount = quantity × rate, half-up to cents. All Decimal.
 */
export function computeRentalCharge(
  profile: Pick<PricingCandidate, "billingBasis" | "rateAmount" | "currency" | "minBillableQuantity" | "roundingRule">,
  input: { hobbsOut?: Prisma.Decimal.Value; hobbsIn?: Prisma.Decimal.Value; tachOut?: Prisma.Decimal.Value; tachIn?: Prisma.Decimal.Value; customQuantity?: Prisma.Decimal.Value },
): RentalCharge {
  let raw: Prisma.Decimal;
  switch (profile.billingBasis) {
    case "HOBBS": raw = D(input.hobbsIn ?? 0).minus(D(input.hobbsOut ?? 0)); break;
    case "TACH": raw = D(input.tachIn ?? 0).minus(D(input.tachOut ?? 0)); break;
    case "FIXED": raw = D(1); break;
    case "CUSTOM_UNIT": raw = D(input.customQuantity ?? 0); break;
  }
  if (raw.isNegative()) raw = D(0);

  let quantity = profile.billingBasis === "FIXED" ? raw : roundQuantity(raw, profile.roundingRule);
  if (profile.minBillableQuantity && quantity.lessThan(profile.minBillableQuantity)) {
    quantity = profile.minBillableQuantity;
  }
  const amount = quantity.times(profile.rateAmount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return { rawQuantity: raw, quantity, rateAmount: profile.rateAmount, amount, currency: profile.currency, basis: profile.billingBasis };
}

/** Build the synthesized legacy-fallback profile (L6) from an aircraft's wet rate. */
export function legacyFallbackProfile(aircraftId: string, hourlyRateWet: Prisma.Decimal.Value, currency = "USD"): PricingCandidate {
  return {
    id: `legacy:${aircraftId}`, familyId: `legacy:${aircraftId}`, version: 1, name: "Legacy wet rate",
    status: "APPROVED", aircraftId, locationId: null, isDefault: true, priority: 1000,
    billingBasis: "HOBBS", customUnitLabel: null, wetDry: "WET", rateAmount: D(hourlyRateWet), currency,
    minBillableQuantity: null, roundingRule: "NEAREST_TENTH",
    eligibleMembershipRoles: [], eligibleCustomerTypes: [], eligibleProgramIds: [],
    effectiveStart: new Date(0), effectiveEnd: null, createdAt: new Date(0), isLegacyFallback: true,
  };
}
