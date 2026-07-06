import { describe, it, expect } from "vitest";
import { airworthinessOf } from "@/lib/airworthiness";
import { fleetHealthOf } from "@/lib/fleet-health";
import { computeHealthScore } from "@/lib/health-score";
import { WO_TRANSITIONS, canTransitionWorkOrder } from "@/lib/work-orders";
import { statusToneOf, statusHex, STATUS_HEX } from "@/lib/status-colors";

const hours = (h: number) => ({ status: "AVAILABLE", currentHobbs: h, isSimulator: false }) as never;

describe("airworthiness engine", () => {
  it("grounded aircraft can never dispatch, regardless of inspections", () => {
    const aw = airworthinessOf({ status: "GROUNDED", currentHobbs: 100, isSimulator: false } as never, []);
    expect(aw.state).toBe("GROUNDED");
    expect(aw.canDispatch).toBe(false);
  });

  it("an overdue hour-based component blocks dispatch with the reason", () => {
    const aw = airworthinessOf(hours(1001), [{ name: "100-Hour", dueAtHours: 1000, dueAtDate: null } as never]);
    expect(aw.state).toBe("MAINTENANCE_OVERDUE");
    expect(aw.canDispatch).toBe(false);
    expect(aw.detail).toContain("100-Hour");
  });

  it("a margin inside the warning window is flagged but dispatchable", () => {
    const aw = airworthinessOf(hours(995), [{ name: "Oil Change", dueAtHours: 1000, dueAtDate: null } as never]);
    expect(aw.state).toBe("DUE_SOON");
    expect(aw.canDispatch).toBe(true);
  });

  it("healthy aircraft are airworthy", () => {
    const aw = airworthinessOf(hours(900), [{ name: "Annual", dueAtHours: 1000, dueAtDate: null } as never]);
    expect(aw.state).toBe("AIRWORTHY");
  });
});

describe("fleet health score", () => {
  const base = { status: "AVAILABLE", currentHobbs: 500, isSimulator: false, engineTimeSmoh: 400 } as never;

  it("a clean aircraft rates excellent with no factors", () => {
    const h = fleetHealthOf(base, [], [], []);
    expect(h.score).toBe(100);
    expect(h.rating).toBe("EXCELLENT");
    expect(h.factors).toHaveLength(0);
  });

  it("grounding plus a grounding squawk drives the score to critical territory", () => {
    const h = fleetHealthOf(
      { ...(base as object), status: "GROUNDED" } as never,
      [],
      [{ severity: "GROUNDING" } as never],
      [],
    );
    expect(h.score).toBeLessThan(60);
    expect(h.factors.map((f) => f.label)).toContain("Grounded");
    expect(h.factors.map((f) => f.label)).toContain("Open squawks");
  });

  it("every deduction is explained — factors sum to the score delta", () => {
    const h = fleetHealthOf(base, [], [{ severity: "MINOR" } as never], []);
    const totalImpact = h.factors.reduce((t, f) => t + f.impact, 0);
    expect(100 + totalImpact).toBe(h.score);
  });

  it("engine past the TBO baseline is penalized", () => {
    const h = fleetHealthOf({ ...(base as object), engineTimeSmoh: 2100 } as never, [], [], []);
    expect(h.factors.map((f) => f.label)).toContain("Engine past TBO");
  });
});

describe("organization health score", () => {
  const healthy = {
    revenueMonth: 50_000, outstandingAR: 5_000, overdueInvoices: 0, totalOpenInvoices: 4,
    airworthyAircraft: 5, totalAircraft: 5, groundingSquawks: 0,
    activeStudents: 20, idleStudents: 0, avgReadiness: 80,
    activeLeads: 10, conversionRate: 0.5, utilizationPct: 70,
  };

  it("a healthy organization scores high across categories", () => {
    const h = computeHealthScore(healthy);
    expect(h.overall).toBeGreaterThanOrEqual(75);
    expect(h.categories).toHaveLength(6);
    for (const c of h.categories) expect(c.detail.length).toBeGreaterThan(0);
  });

  it("grounded fleet drags the operational category, not just the overall", () => {
    const sick = computeHealthScore({ ...healthy, airworthyAircraft: 1, groundingSquawks: 3 });
    const opsHealthy = computeHealthScore(healthy).categories.find((c) => c.key === "operational")!;
    const opsSick = sick.categories.find((c) => c.key === "operational")!;
    expect(opsSick.score).toBeLessThan(opsHealthy.score);
  });
});

describe("work-order state machine", () => {
  it("follows the full lifecycle to closure", () => {
    const path = ["OPEN", "ASSIGNED", "IN_PROGRESS", "AWAITING_INSPECTION", "APPROVED", "RETURN_TO_SERVICE", "CLOSED"];
    let from = "DRAFT";
    for (const to of path) {
      expect(canTransitionWorkOrder(from, to), `${from} → ${to}`).toBe(true);
      from = to;
    }
  });

  it("refuses skipping inspection sign-off", () => {
    expect(canTransitionWorkOrder("IN_PROGRESS", "RETURN_TO_SERVICE")).toBe(false);
    expect(canTransitionWorkOrder("AWAITING_INSPECTION", "CLOSED")).toBe(false);
    expect(canTransitionWorkOrder("APPROVED", "CLOSED")).toBe(false);
  });

  it("closed and cancelled are terminal", () => {
    expect(WO_TRANSITIONS.CLOSED).toBeUndefined();
    expect(WO_TRANSITIONS.CANCELLED).toBeUndefined();
  });

  it("an approved order can only return to service", () => {
    expect(WO_TRANSITIONS.APPROVED).toEqual(["RETURN_TO_SERVICE"]);
  });
});

describe("status color system (Section 3 contract)", () => {
  it("the canonical operational colors never change", () => {
    expect(statusToneOf("SCHEDULED")).toBe("blue");
    expect(statusToneOf("DISPATCHED")).toBe("purple");
    expect(statusToneOf("IN_FLIGHT")).toBe("green");
    expect(statusToneOf("COMPLETED")).toBe("gray");
    expect(statusToneOf("CANCELLED")).toBe("red");
    expect(statusToneOf("IN_MAINTENANCE")).toBe("orange");
    expect(statusToneOf("GROUNDED")).toBe("darkred");
  });

  it("unknown statuses fall back to gray instead of crashing", () => {
    expect(statusToneOf("SOMETHING_NEW")).toBe("gray");
  });

  it("every tone resolves to a hex pair for both themes", () => {
    for (const tone of Object.keys(STATUS_HEX)) {
      expect(statusHex("SCHEDULED", "light")).toMatch(/^#/);
      expect(STATUS_HEX[tone as keyof typeof STATUS_HEX].light).toMatch(/^#[0-9a-f]{6}$/);
      expect(STATUS_HEX[tone as keyof typeof STATUS_HEX].dark).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
