import { describe, it, expect } from "vitest";
import type { Role } from "@prisma/client";
import { permissionsForRole } from "@/lib/permissions";
import { canAccessSection } from "@/lib/rbac";
import { NAV_ITEMS } from "@/components/shell/nav-config";
import { SECTION_MODULES, type ModuleKey } from "@/lib/features";
import { dashboardCapabilities } from "@/lib/dashboard-access";

// All modules enabled, so we test PERMISSION gating in isolation.
const ALL_MODULES = new Set(Object.values(SECTION_MODULES)) as Set<ModuleKey>;

function navFor(role: Role): string[] {
  const perms = permissionsForRole(role);
  return NAV_ITEMS.filter((i) => canAccessSection(perms, ALL_MODULES, i.href)).map((i) => i.href);
}

describe("role-personalized navigation (each role sees only what it can use)", () => {
  it("Student Pilot: only their own destinations, no ops/finance/admin pages", () => {
    const nav = navFor("STUDENT");
    expect(nav).toEqual(expect.arrayContaining(["/dashboard", "/schedule", "/notifications", "/documents"]));
    for (const hidden of [
      "/billing", "/reports", "/executive", "/dispatch", "/operations", "/maintenance",
      "/aircraft", "/instructors", "/training", "/crm", "/import", "/settings", "/intelligence", "/mission-control",
    ]) {
      expect(nav, `${hidden} must be hidden from a Student Pilot`).not.toContain(hidden);
    }
  });

  it("Finance Manager: finance surfaces, not the ops floor", () => {
    const nav = navFor("ACCOUNTANT");
    expect(nav).toEqual(expect.arrayContaining(["/billing", "/reports", "/executive"]));
    for (const hidden of ["/dispatch", "/maintenance", "/schedule", "/mission-control", "/settings"]) {
      expect(nav, `${hidden} must be hidden from a Finance Manager`).not.toContain(hidden);
    }
  });

  it("Maintenance Manager: the shop + fleet, not finance", () => {
    const nav = navFor("MAINTENANCE");
    expect(nav).toEqual(expect.arrayContaining(["/aircraft", "/maintenance", "/mission-control"]));
    for (const hidden of ["/billing", "/reports", "/executive", "/schedule", "/students", "/settings"]) {
      expect(nav, `${hidden} must be hidden from a Maintenance Manager`).not.toContain(hidden);
    }
  });

  it("Account Owner / Org Admin: full navigation", () => {
    expect(navFor("SUPER_ADMIN").length).toBe(NAV_ITEMS.length);
    expect(navFor("SCHOOL_ADMIN").length).toBe(NAV_ITEMS.length);
  });
});

describe("role-personalized dashboard sections (gated by permission, never leaked)", () => {
  const cap = (r: Role) => dashboardCapabilities(permissionsForRole(r));

  it("Student Pilot: no finance, fleet, maintenance, or student-management sections", () => {
    const c = cap("STUDENT");
    expect(c.canFinance).toBe(false);
    expect(c.canFleet).toBe(false);
    expect(c.canMaintenance).toBe(false);
    expect(c.canStudents).toBe(false);
  });

  it("Finance Manager: finance yes, ops board no", () => {
    const c = cap("ACCOUNTANT");
    expect(c.canFinance).toBe(true);
    expect(c.canSchedule).toBe(false);
    expect(c.canFleet).toBe(false);
  });

  it("Maintenance Manager: fleet + maintenance yes, finance no", () => {
    const c = cap("MAINTENANCE");
    expect(c.canMaintenance).toBe(true);
    expect(c.canFleet).toBe(true);
    expect(c.canFinance).toBe(false);
  });

  it("Flight Dispatcher: ops + fleet yes, finance no", () => {
    const c = cap("DISPATCHER");
    expect(c.canSchedule).toBe(true);
    expect(c.canFleet).toBe(true);
    expect(c.canFinance).toBe(false);
  });

  it("Account Owner: every section", () => {
    expect(Object.values(cap("SUPER_ADMIN")).every(Boolean)).toBe(true);
  });
});
