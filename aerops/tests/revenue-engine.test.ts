import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { startOfDayInTimeZone, startOfMonthInTimeZone, foots } from "@/lib/revenue-dashboard";
import { invoiceAmountDue } from "@/lib/revenue-money";
import { PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } from "@/lib/permissions";

describe("revenue-dashboard pure helpers", () => {
  it("startOfDayInTimeZone returns local midnight for the instant's zone", () => {
    // 2026-07-11T03:30:00Z is 2026-07-10 23:30 in New York (UTC-4 in July) →
    // start of that NY day is 2026-07-10T04:00:00Z.
    const at = new Date("2026-07-11T03:30:00Z");
    const start = startOfDayInTimeZone(at, "America/New_York");
    expect(start.toISOString()).toBe("2026-07-10T04:00:00.000Z");
  });

  it("startOfDayInTimeZone respects a different zone for the same instant", () => {
    // Same instant is 2026-07-11 in UTC → start of UTC day is 2026-07-11T00:00Z.
    const at = new Date("2026-07-11T03:30:00Z");
    expect(startOfDayInTimeZone(at, "UTC").toISOString()).toBe("2026-07-11T00:00:00.000Z");
  });

  it("startOfMonthInTimeZone returns the first moment of the zone's month", () => {
    const at = new Date("2026-07-11T03:30:00Z"); // still July 10 in NY, so July
    expect(startOfMonthInTimeZone(at, "America/New_York").toISOString()).toBe("2026-07-01T04:00:00.000Z");
  });

  it("foots holds within a cent and fails on a real gap", () => {
    expect(foots([100.0, 45.4, 4.6], 150.0)).toBe(true);
    expect(foots([100.0, 45.4], 150.0)).toBe(false);
  });

  it("period boundaries are correct across DST transitions (offset at the boundary, not at `at`)", () => {
    // Fall-back day: Nov 1 2026, 10:00Z is 06:00 EST, but NY midnight that day was
    // still EDT (UTC-4) → start of day = 2026-11-01T04:00:00Z, not 05:00.
    expect(startOfDayInTimeZone(new Date("2026-11-01T10:00:00Z"), "America/New_York").toISOString())
      .toBe("2026-11-01T04:00:00.000Z");
    // Spring-forward month: March 1 2026 midnight NY is EST (UTC-5) even though
    // mid-month is EDT → start of month = 2026-03-01T05:00:00Z, not 04:00.
    expect(startOfMonthInTimeZone(new Date("2026-03-15T16:00:00Z"), "America/New_York").toISOString())
      .toBe("2026-03-01T05:00:00.000Z");
  });
});

describe("invoiceAmountDue (shared, doc 30 §6 isolation-safe)", () => {
  const line = (q: number, p: number) => ({ quantity: q, unitPrice: p });
  const pay = (a: number) => ({ amount: a });

  it("empty invoice nets zero (null sums coalesce)", () => {
    expect(invoiceAmountDue([], [])).toEqual({ billed: 0, paid: 0, amountDue: 0 });
  });
  it("partial payment leaves the remainder due", () => {
    expect(invoiceAmountDue([line(2, 85)], [pay(100)])).toEqual({ billed: 170, paid: 100, amountDue: 70 });
  });
  it("overpayment clamps amountDue at zero — never a negative offset", () => {
    expect(invoiceAmountDue([line(1, 50)], [pay(80)])).toEqual({ billed: 50, paid: 80, amountDue: 0 });
  });
});

describe("student self-view isolation (doc 30 §6)", () => {
  it("revenue-self.ts never imports the org-wide revenue-dashboard engine", () => {
    const src = readFileSync(path.join(__dirname, "..", "src", "lib", "revenue-self.ts"), "utf8");
    // Match actual imports (static or dynamic), not descriptive mentions in comments.
    expect(src).not.toMatch(/(from\s+['"][^'"]*revenue-dashboard['"]|import\(\s*['"][^'"]*revenue-dashboard['"])/);
  });
});

describe("Revenue Engine permission bundles (doc 36)", () => {
  const has = (role: keyof typeof DEFAULT_ROLE_PERMISSIONS, key: string) =>
    (DEFAULT_ROLE_PERMISSIONS[role] as readonly string[]).includes(key);

  it("STUDENT sees only its own money — never org financials or reports", () => {
    expect(has("STUDENT", "revenue.self_view")).toBe(true);
    expect(has("STUDENT", "billing.view")).toBe(false);
    expect(has("STUDENT", "reports.view")).toBe(false);
    expect(has("STUDENT", "revenue.review_view")).toBe(false);
    expect(has("STUDENT", "revenue.allocation_view")).toBe(false);
    expect(has("STUDENT", "revenue.compensation_view")).toBe(false);
  });

  it("INSTRUCTOR holds own-scoped review/time/compensation, not org-wide finance", () => {
    expect(has("INSTRUCTOR", "revenue.review_view")).toBe(true);
    expect(has("INSTRUCTOR", "revenue.time_entry")).toBe(true);
    expect(has("INSTRUCTOR", "revenue.compensation_view_own")).toBe(true);
    // never another instructor's compensation, nor approval, nor org allocation
    expect(has("INSTRUCTOR", "revenue.compensation_view")).toBe(false);
    expect(has("INSTRUCTOR", "revenue.approve")).toBe(false);
    expect(has("INSTRUCTOR", "revenue.allocation_view")).toBe(false);
  });

  it("ACCOUNTANT is a finalizer (approve_finance/charge/refund), not an operations approver", () => {
    expect(has("ACCOUNTANT", "revenue.approve_finance")).toBe(true);
    expect(has("ACCOUNTANT", "revenue.charge")).toBe(true);
    expect(has("ACCOUNTANT", "revenue.refund")).toBe(true);
    expect(has("ACCOUNTANT", "revenue.reconciliation_manage")).toBe(true);
    // separation of duties: no unilateral operations approval
    expect(has("ACCOUNTANT", "revenue.approve")).toBe(false);
  });

  it("DISPATCHER gets non-finance revenue views only (D34 billing.view deferred)", () => {
    expect(has("DISPATCHER", "revenue.review_view")).toBe(true);
    expect(has("DISPATCHER", "revenue.pricing_view")).toBe(true);
    expect(has("DISPATCHER", "billing.view")).toBe(false); // D34 open — owner sign-off
  });

  it("every revenue.* bundle key exists in the PERMISSIONS catalog", () => {
    const catalog = new Set(Object.keys(PERMISSIONS));
    for (const role of Object.keys(DEFAULT_ROLE_PERMISSIONS) as (keyof typeof DEFAULT_ROLE_PERMISSIONS)[]) {
      for (const key of DEFAULT_ROLE_PERMISSIONS[role]) {
        expect(catalog.has(key), `${String(role)} references unknown permission ${key}`).toBe(true);
      }
    }
  });
});
