import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { Prisma } from "@prisma/client";
import { assertBalanced, debit, credit, nonZero, LedgerError } from "@/lib/ledger";
import { buildApprovalAllocationRows, assertSetBalanced, categorizeLines, categoryForLineKind, AllocationError } from "@/lib/revenue-allocation";
import { computePlatformFee, feeBaseAmount, ZERO_FEE_POLICY } from "@/lib/platform-fee";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

describe("ledger double-entry invariants (doc 12/28)", () => {
  it("accepts a balanced journal", () => {
    expect(() => assertBalanced([debit("ACCOUNTS_RECEIVABLE", D("100.00")), credit("REVENUE_AIRCRAFT", D("100.00"))])).not.toThrow();
  });
  it("rejects an unbalanced journal", () => {
    expect(() => assertBalanced([debit("ACCOUNTS_RECEIVABLE", D("100.00")), credit("REVENUE_AIRCRAFT", D("99.99"))])).toThrow(LedgerError);
  });
  it("rejects a non-positive amount", () => {
    expect(() => assertBalanced([debit("ACCOUNTS_RECEIVABLE", D("0")), credit("REVENUE_AIRCRAFT", D("0"))])).toThrow(LedgerError);
  });
});

describe("approval journal J1 balances for the doc-28 fixture", () => {
  it("Σ debits = Σ credits = 570.00 (A/R 500 + comp 70 vs revenues+tax+comp)", () => {
    const comp = D("70.00");
    const lines = nonZero([
      debit("ACCOUNTS_RECEIVABLE", D("500.00")),
      debit("INSTRUCTOR_COMP_EXPENSE", comp),
      credit("REVENUE_AIRCRAFT", D("300.00")),
      credit("REVENUE_INSTRUCTION", D("160.00")),
      credit("REVENUE_AIRPORT_FEES", D("10.00")),
      credit("REVENUE_FUEL", D("20.00")),
      credit("TAX_PAYABLE", D("10.00")),
      credit("INSTRUCTOR_COMP_PAYABLE", comp),
    ]);
    expect(() => assertBalanced(lines)).not.toThrow();
  });
});

describe("allocation set S1 — each dimension sums to the total (doc 28 §6)", () => {
  it("builds a balanced REVENUE + PROCEEDS set for the fixture", () => {
    const cats = new Map<Parameters<typeof buildApprovalAllocationRows>[0]["categoryAmounts"] extends Map<infer K, infer V> ? K : never, Prisma.Decimal>([
      ["AIRCRAFT_REVENUE", D("300.00")],
      ["INSTRUCTOR_SERVICE_REVENUE", D("160.00")],
      ["AIRPORT_LANDING_FEES", D("10.00")],
      ["FUEL_REVENUE", D("20.00")],
    ]);
    const rows = buildApprovalAllocationRows({ categoryAmounts: cats, taxAmount: D("10.00"), platformFee: D("9.80"), total: D("500.00") });
    const rev = rows.filter((r) => r.dimension === "REVENUE").reduce((t, r) => t.plus(r.amount), D(0));
    const proc = rows.filter((r) => r.dimension === "PROCEEDS").reduce((t, r) => t.plus(r.amount), D(0));
    expect(rev.toFixed(2)).toBe("500.00");
    expect(proc.toFixed(2)).toBe("500.00");
    // school retained = total − tax − fee
    const retained = rows.find((r) => r.category === "SCHOOL_RETAINED_REVENUE");
    expect(retained?.amount.toFixed(2)).toBe("480.20");
  });
  it("throws if a dimension does not sum to the amount", () => {
    expect(() => assertSetBalanced([{ dimension: "REVENUE", category: "AIRCRAFT_REVENUE", amount: D("99.00") }], D("100.00"))).toThrow(AllocationError);
  });
  it("handles a net discount by keeping the REVENUE dimension balanced", () => {
    // subtotal 90 (100 aircraft − 10 discount in OTHER), tax 0, fee 0, total 90.
    const cats = new Map<Parameters<typeof buildApprovalAllocationRows>[0]["categoryAmounts"] extends Map<infer K, infer V> ? K : never, Prisma.Decimal>([
      ["AIRCRAFT_REVENUE", D("100.00")],
      ["OTHER_REVENUE", D("-10.00")],
    ]);
    const rows = buildApprovalAllocationRows({ categoryAmounts: cats, taxAmount: D("0"), platformFee: D("0"), total: D("90.00") });
    const rev = rows.filter((r) => r.dimension === "REVENUE").reduce((t, r) => t.plus(r.amount), D(0));
    expect(rev.toFixed(2)).toBe("90.00");
  });
});

describe("line categorization + platform fee", () => {
  it("maps line kinds to revenue categories (instruction combined per schema enum)", () => {
    expect(categoryForLineKind("AIRCRAFT_RENTAL")).toBe("AIRCRAFT_REVENUE");
    expect(categoryForLineKind("INSTRUCTOR_TIME")).toBe("INSTRUCTOR_SERVICE_REVENUE");
    expect(categoryForLineKind("GROUND_INSTRUCTION")).toBe("INSTRUCTOR_SERVICE_REVENUE");
    expect(categoryForLineKind("FUEL_SURCHARGE")).toBe("FUEL_REVENUE");
    expect(categoryForLineKind("MEMBERSHIP_FEE")).toBe("OTHER_REVENUE");
  });
  it("sums signed line totals by category", () => {
    const m = categorizeLines([
      { kind: "AIRCRAFT_RENTAL", quantity: D("2"), unitPrice: D("150.00") },
      { kind: "INSTRUCTOR_TIME", quantity: D("1.5"), unitPrice: D("85.00") },
    ]);
    expect(m.get("AIRCRAFT_REVENUE")?.toFixed(2)).toBe("300.00");
    expect(m.get("INSTRUCTOR_SERVICE_REVENUE")?.toFixed(2)).toBe("127.50");
  });
  it("computes the platform fee: bps on the base, clamped, half-up", () => {
    const policy = { ...ZERO_FEE_POLICY, feePercentBps: 200 }; // 2%
    expect(computePlatformFee(policy, D("490.00")).toFixed(2)).toBe("9.80");
    expect(feeBaseAmount("COLLECTED_PRETAX", D("490.00"), D("500.00")).toFixed(2)).toBe("490.00");
    expect(feeBaseAmount("COLLECTED_TOTAL", D("490.00"), D("500.00")).toFixed(2)).toBe("500.00");
  });
  it("the zero (default) policy charges no fee", () => {
    expect(computePlatformFee(ZERO_FEE_POLICY, D("500.00")).toFixed(2)).toBe("0.00");
  });
});

describe("ledger + allocations are append-only (L1 immutability, doc 28)", () => {
  // No update/delete of LedgerEntry or RevenueAllocation may exist anywhere in
  // src — corrections are new signed sets / reversing journals only.
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!p.includes("(marketing)")) walk(p); }
      else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) files.push(p);
    }
  };
  walk(path.join(__dirname, "..", "src"));
  const forbidden = /\b(ledgerEntry|revenueAllocation)\.(update|updateMany|delete|deleteMany|upsert)\b/;

  it("no src file mutates or deletes a ledger entry or allocation row", () => {
    const offenders = files.filter((f) => forbidden.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
