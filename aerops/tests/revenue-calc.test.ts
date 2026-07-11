import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { resolveInstructorRate, computeInstructorCharge, type RateProfileCandidate, type RateContext } from "@/lib/instructor-rates";
import { computeTax, type TaxableLine, type TaxRuleInput } from "@/lib/tax";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

function rateProfile(over: Partial<RateProfileCandidate> & Pick<RateProfileCandidate, "id" | "kind">): RateProfileCandidate {
  return {
    name: over.id, version: 1, status: "APPROVED", instructorId: null, syllabusId: null, locationId: null, priority: 100,
    currency: "USD", effectiveFrom: new Date("2026-01-01T00:00:00Z"), effectiveTo: null, createdAt: new Date("2026-01-01T00:00:00Z"),
    lines: [{ id: `${over.id}-fl`, category: "FLIGHT_INSTRUCTION", customLabel: "", rate: D("85.00"), percentOfBilling: null, minBillableHours: null }],
    ...over,
  };
}
const ctx: RateContext = { instructorId: "inst1", syllabusId: null, locationId: null, explicitProfileId: null };
const at = new Date("2026-07-10T12:00:00Z");

describe("instructor rate resolution (doc 04, 8 tiers)", () => {
  it("keeps BILLING and COMPENSATION structurally separate — never inferred from each other", () => {
    const billing = rateProfile({ id: "b", kind: "BILLING", instructorId: "inst1", lines: [{ id: "b-fl", category: "FLIGHT_INSTRUCTION", customLabel: "", rate: D("85.00"), percentOfBilling: null, minBillableHours: null }] });
    const comp = rateProfile({ id: "c", kind: "COMPENSATION", instructorId: "inst1", lines: [{ id: "c-fl", category: "FLIGHT_INSTRUCTION", customLabel: "", rate: D("60.00"), percentOfBilling: null, minBillableHours: null }] });
    const all = [billing, comp];
    expect(resolveInstructorRate(all, ctx, "BILLING", "FLIGHT_INSTRUCTION", at).rate?.toString()).toBe("85");
    expect(resolveInstructorRate(all, ctx, "COMPENSATION", "FLIGHT_INSTRUCTION", at).rate?.toString()).toBe("60");
  });

  it("instructor-specific (tier 6) beats the org default (tier 7)", () => {
    const orgDefault = rateProfile({ id: "org", kind: "BILLING", instructorId: null, lines: [{ id: "org-fl", category: "FLIGHT_INSTRUCTION", customLabel: "", rate: D("80.00"), percentOfBilling: null, minBillableHours: null }] });
    const mine = rateProfile({ id: "mine", kind: "BILLING", instructorId: "inst1", lines: [{ id: "mine-fl", category: "FLIGHT_INSTRUCTION", customLabel: "", rate: D("95.00"), percentOfBilling: null, minBillableHours: null }] });
    const r = resolveInstructorRate([orgDefault, mine], ctx, "BILLING", "FLIGHT_INSTRUCTION", at);
    expect(r.tier).toBe(6);
    expect(r.rate?.toString()).toBe("95");
  });

  it("unpriced instructor time blocks with a warning, never a silent zero", () => {
    const r = resolveInstructorRate([], ctx, "COMPENSATION", "GROUND_INSTRUCTION", at);
    expect(r.rate).toBeNull();
    expect(r.warnings.some((w) => w.code === "UNPRICED_INSTRUCTOR_TIME")).toBe(true);
  });

  it("ties at a tier surface AMBIGUOUS_RATE and still resolve deterministically", () => {
    const a = rateProfile({ id: "a", name: "Rate A", kind: "BILLING", instructorId: "inst1", priority: 10, effectiveFrom: new Date("2026-02-01T00:00:00Z") });
    const b = rateProfile({ id: "b", name: "Rate B", kind: "BILLING", instructorId: "inst1", priority: 10, effectiveFrom: new Date("2026-03-01T00:00:00Z") });
    const r = resolveInstructorRate([a, b], ctx, "BILLING", "FLIGHT_INSTRUCTION", at);
    expect(r.ambiguous).toBe(true);
    expect(r.profileId).toBe("b"); // latest effectiveFrom
  });

  it("computes the billing charge half-up to cents", () => {
    expect(computeInstructorCharge("1.5", D("85.00")).toString()).toBe("127.5");
    expect(computeInstructorCharge("1.333", D("85.00")).toString()).toBe("113.31"); // 113.305 → 113.31
  });
});

describe("tax computation (doc 07, stacked)", () => {
  const line = (id: string, amt: string, cls: string, taxable = true): TaxableLine => ({ lineId: id, amount: D(amt), chargeClass: cls, taxable });
  const rule = (id: string, rate: string, kinds: string[], juris = "State"): TaxRuleInput => ({ id, ruleKey: id, version: 1, name: id, jurisdictionLabel: juris, ratePercent: D(rate), appliesToKinds: kinds });

  it("only taxes taxable lines matching the rule's charge classes", () => {
    const lines = [line("l1", "100.00", "airport_fee"), line("l2", "200.00", "aircraft_rental", false)];
    const r = computeTax(lines, [rule("ga", "6.0000", ["airport_fee"])]);
    expect(r.totalTax.toString()).toBe("6"); // 6% of 100, l2 not taxable
    expect(r.taxableBase.toString()).toBe("100");
  });

  it("stacks state + local rules on the same base", () => {
    const lines = [line("l1", "100.00", "airport_fee")];
    const r = computeTax(lines, [rule("state", "6.0000", [], "State"), rule("local", "2.0000", [], "Local")]);
    expect(r.totalTax.toString()).toBe("8"); // 6 + 2
    expect(r.perRule).toHaveLength(2);
  });

  it("no-tax when there are no rules (the default posture)", () => {
    const r = computeTax([line("l1", "100.00", "aircraft_rental")], []);
    expect(r.totalTax.toString()).toBe("0");
  });
});
