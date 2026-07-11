import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  resolvePricing, computeRentalCharge, legacyFallbackProfile,
  type PricingCandidate, type ResolutionContext,
} from "@/lib/pricing";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const base: Omit<PricingCandidate, "id" | "familyId" | "name" | "status" | "aircraftId" | "isDefault" | "priority" | "eligibleCustomerTypes" | "eligibleMembershipRoles" | "eligibleProgramIds" | "locationId"> = {
  version: 1, billingBasis: "HOBBS", customUnitLabel: null, wetDry: "WET",
  rateAmount: D("150.00"), currency: "USD", minBillableQuantity: null, roundingRule: "NEAREST_TENTH",
  effectiveStart: new Date("2026-01-01T00:00:00Z"), effectiveEnd: null, createdAt: new Date("2026-01-01T00:00:00Z"),
};
function profile(over: Partial<PricingCandidate> & Pick<PricingCandidate, "id" | "name">): PricingCandidate {
  return {
    familyId: over.id, status: "APPROVED", aircraftId: null, isDefault: false, priority: 100,
    eligibleCustomerTypes: [], eligibleMembershipRoles: [], eligibleProgramIds: [], locationId: null,
    ...base, ...over,
  };
}
const ctx = (over: Partial<ResolutionContext> = {}): ResolutionContext => ({
  aircraftId: "ac1", explicitProfileId: null, customerTypes: [], membershipRoles: [], programIds: [], locationId: null, ...over,
});
const at = new Date("2026-07-10T15:00:00Z");

describe("pricing resolution (L1–L6, doc 05)", () => {
  it("explicit dispatch selection wins as L1 over everything else", () => {
    const member = profile({ id: "member", name: "Member", eligibleCustomerTypes: ["member"] });
    const explicit = profile({ id: "explicit", name: "Explicit", rateAmount: D("99.00") });
    const r = resolvePricing([member, explicit], ctx({ explicitProfileId: "explicit", customerTypes: ["member"] }), at);
    expect(r.level).toBe("L1");
    expect(r.profile?.id).toBe("explicit");
  });

  it("program rate (L2) outranks a membership rate (L3)", () => {
    const member = profile({ id: "m", name: "Member", eligibleCustomerTypes: ["member"] });
    const program = profile({ id: "p", name: "University", eligibleProgramIds: ["syl1"] });
    const r = resolvePricing([member, program], ctx({ customerTypes: ["member"], programIds: ["syl1"] }), at);
    expect(r.level).toBe("L2");
    expect(r.profile?.id).toBe("p");
  });

  it("customer type selects the member vs non-member rate (L3)", () => {
    const member = profile({ id: "m", name: "Member", eligibleCustomerTypes: ["member"], rateAmount: D("135.00") });
    const nonmember = profile({ id: "n", name: "Non-member", eligibleCustomerTypes: ["non_member"], rateAmount: D("165.00") });
    expect(resolvePricing([member, nonmember], ctx({ customerTypes: ["member"] }), at).profile?.id).toBe("m");
    expect(resolvePricing([member, nonmember], ctx({ customerTypes: ["non_member"] }), at).profile?.id).toBe("n");
  });

  it("falls back to the legacy wet rate for a zero-config org and flags LEGACY_FALLBACK", () => {
    const legacy = legacyFallbackProfile("ac1", "142.00");
    const r = resolvePricing([legacy], ctx(), at);
    expect(r.level).toBe("L6");
    expect(r.reasons.some((x) => x.code === "LEGACY_FALLBACK")).toBe(true);
    expect(r.ambiguous).toBe(false);
  });

  it("ties at the same level surface AMBIGUOUS_RATE but still return a deterministic result", () => {
    const a = profile({ id: "a", name: "Rate A", eligibleCustomerTypes: ["member"], priority: 50, effectiveStart: new Date("2026-02-01T00:00:00Z") });
    const b = profile({ id: "b", name: "Rate B", eligibleCustomerTypes: ["member"], priority: 50, effectiveStart: new Date("2026-03-01T00:00:00Z") });
    const r = resolvePricing([a, b], ctx({ customerTypes: ["member"] }), at);
    expect(r.ambiguous).toBe(true);
    expect(r.warnings.some((w) => w.code === "AMBIGUOUS_RATE")).toBe(true);
    expect(r.profile?.id).toBe("b"); // latest effectiveStart wins the deterministic tiebreak
  });

  it("aircraft-specific beats fleet-wide within the winning level", () => {
    const fleet = profile({ id: "f", name: "Fleet member", eligibleCustomerTypes: ["member"], aircraftId: null });
    const acSpecific = profile({ id: "s", name: "This aircraft member", eligibleCustomerTypes: ["member"], aircraftId: "ac1" });
    const r = resolvePricing([fleet, acSpecific], ctx({ customerTypes: ["member"] }), at);
    expect(r.profile?.id).toBe("s");
  });

  it("eligibility is conjunctive — a program+location profile whose location differs is ineligible", () => {
    const both = profile({ id: "pl", name: "Program at Loc A", eligibleProgramIds: ["syl1"], locationId: "locA" });
    const orgDefault = profile({ id: "d", name: "Org default", isDefault: true, aircraftId: null });
    // program matches but location does NOT → the combined profile must not win at L2.
    const r = resolvePricing([both, orgDefault], ctx({ programIds: ["syl1"], locationId: "locB" }), at);
    expect(r.profile?.id).toBe("d");
    // when both match, it wins at its highest-precedence selector (L2).
    const r2 = resolvePricing([both, orgDefault], ctx({ programIds: ["syl1"], locationId: "locA" }), at);
    expect(r2.level).toBe("L2");
    expect(r2.profile?.id).toBe("pl");
  });

  it("an invalid explicit dispatch selection degrades to normal resolution but warns (never silent)", () => {
    const member = profile({ id: "m", name: "Member", eligibleCustomerTypes: ["member"] });
    const r = resolvePricing([member], ctx({ explicitProfileId: "gone", customerTypes: ["member"] }), at);
    expect(r.profile?.id).toBe("m"); // fell through to L3
    expect(r.warnings.some((w) => w.code === "EXPLICIT_SELECTION_INVALID")).toBe(true);
  });

  // Verifies effective-window resolution (a flight resolves to the version whose
  // window covers it). True snapshot immutability of an APPROVED review line is a
  // Phase 3 guarantee (the approval transaction freezes the snapshot) — tested there.
  it("resolution honors the effective window at flight time (June bills v1, July bills v2)", () => {
    // v1 effective Jan–Jun (superseded by an effectiveEnd), v2 effective from Jul.
    const v1 = profile({ id: "v1", name: "Member v1", eligibleCustomerTypes: ["member"], rateAmount: D("120.00"), effectiveStart: new Date("2026-01-01T00:00:00Z"), effectiveEnd: new Date("2026-07-01T00:00:00Z") });
    const v2 = profile({ id: "v2", name: "Member v2", eligibleCustomerTypes: ["member"], rateAmount: D("150.00"), effectiveStart: new Date("2026-07-01T00:00:00Z") });
    // A flight in June resolves to v1's $120 — v2 does not retroactively apply.
    const june = resolvePricing([v1, v2], ctx({ customerTypes: ["member"] }), new Date("2026-06-15T12:00:00Z"));
    expect(june.profile?.rateAmount.toString()).toBe("120");
    // A flight in July resolves to v2's $150.
    const july = resolvePricing([v1, v2], ctx({ customerTypes: ["member"] }), new Date("2026-07-15T12:00:00Z"));
    expect(july.profile?.rateAmount.toString()).toBe("150");
  });
});

describe("rental charge computation (doc 05 §3.4)", () => {
  it("Hobbs basis: quantity × rate, half-up to cents", () => {
    const c = computeRentalCharge(base, { hobbsOut: "1234.5", hobbsIn: "1236.2" });
    expect(c.quantity.toString()).toBe("1.7");
    expect(c.amount.toString()).toBe("255"); // 1.7 × 150.00
  });

  it("applies the minimum billable quantity AFTER rounding", () => {
    const c = computeRentalCharge({ ...base, minBillableQuantity: D("1.0") }, { hobbsOut: "100.0", hobbsIn: "100.9" });
    expect(c.quantity.toString()).toBe("1"); // 0.9 rounds to 0.9, then min 1.0 applies
    expect(c.amount.toString()).toBe("150");
  });

  it("FIXED basis bills a flat amount regardless of meters", () => {
    const c = computeRentalCharge({ ...base, billingBasis: "FIXED", rateAmount: D("99.00") }, {});
    expect(c.quantity.toString()).toBe("1");
    expect(c.amount.toString()).toBe("99");
  });

  it("never produces a negative quantity from a meter rollback", () => {
    const c = computeRentalCharge(base, { hobbsOut: "10.0", hobbsIn: "9.0" });
    expect(c.rawQuantity.toString()).toBe("0");
    expect(c.amount.toString()).toBe("0");
  });

  it("TACH basis uses the tach delta, not Hobbs", () => {
    const c = computeRentalCharge({ ...base, billingBasis: "TACH" }, { hobbsOut: "0", hobbsIn: "5.0", tachOut: "2000.0", tachIn: "2001.4" });
    expect(c.quantity.toString()).toBe("1.4");
    expect(c.amount.toString()).toBe("210"); // 1.4 × 150
  });

  it("CUSTOM_UNIT basis bills the entered quantity", () => {
    const c = computeRentalCharge({ ...base, billingBasis: "CUSTOM_UNIT", roundingRule: "NONE", rateAmount: new Prisma.Decimal("12.00") }, { customQuantity: "3" });
    expect(c.quantity.toString()).toBe("3");
    expect(c.amount.toString()).toBe("36");
  });
});
