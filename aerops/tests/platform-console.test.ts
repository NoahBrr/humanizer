import { describe, it, expect } from "vitest";
import type { PlatformRole } from "@prisma/client";
import {
  PLATFORM_ROLE_PERMISSIONS,
  ALL_PLATFORM_PERMISSIONS,
  PLATFORM_ROLE_SPEC_ALIAS,
  isMutatingPlatformPermission,
  platformRolesWith,
  platformCan,
  type PlatformPermission,
} from "@/lib/platform-permissions";
import {
  resolvePermissions,
  isEffectiveAdmin,
  canDeactivateUser,
  canReactivateUser,
  canTransferOwnerTo,
  PROMOTE_ROLE,
} from "@/lib/platform-users";
import { platformAccessAllowed } from "@/lib/session-rules";
import { permissionsForRole } from "@/lib/permissions";

const ALL_ROLES = Object.keys(PLATFORM_ROLE_PERMISSIONS) as PlatformRole[];

describe("platform permission matrix", () => {
  it("gives the founder + admin roles every capability", () => {
    for (const role of ["FOUNDER_SUPER_ADMIN", "FOUNDER", "PLATFORM_ADMIN"] as PlatformRole[]) {
      expect([...PLATFORM_ROLE_PERMISSIONS[role]].sort()).toEqual([...ALL_PLATFORM_PERMISSIONS].sort());
    }
  });

  it("gives the read-only auditor zero mutating capabilities", () => {
    const mutating = PLATFORM_ROLE_PERMISSIONS.AUDITOR.filter(isMutatingPlatformPermission);
    expect(mutating).toEqual([]);
  });

  it("classifies a permission as mutating iff it is not a .view", () => {
    expect(isMutatingPlatformPermission("platform.orgs.view")).toBe(false);
    expect(isMutatingPlatformPermission("platform.audit.view")).toBe(false);
    expect(isMutatingPlatformPermission("platform.users.manage")).toBe(true);
    expect(isMutatingPlatformPermission("platform.impersonate")).toBe(true);
    expect(isMutatingPlatformPermission("platform.users.transfer_owner")).toBe(true);
  });

  it("maps every catalogued permission to at least one role", () => {
    for (const perm of ALL_PLATFORM_PERMISSIONS) {
      expect(platformRolesWith(perm).length).toBeGreaterThan(0);
    }
  });

  it("throws on an unknown permission (never returns [] — which would lock everyone out)", () => {
    expect(() => platformRolesWith("platform.nonexistent" as PlatformPermission)).toThrow();
  });

  it("derives the org-management role list used by the org PATCH route", () => {
    expect(platformRolesWith("platform.orgs.manage").sort()).toEqual(["BILLING_ADMIN", "FOUNDER", "FOUNDER_SUPER_ADMIN", "PLATFORM_ADMIN"]);
  });

  it("restricts the highest-impact capabilities to admins", () => {
    // Only the founder + admin tiers can transfer ownership or change roles.
    expect(platformRolesWith("platform.users.transfer_owner").sort()).toEqual(["FOUNDER", "FOUNDER_SUPER_ADMIN", "PLATFORM_ADMIN"]);
    expect(platformRolesWith("platform.roles.manage").sort()).toEqual(["FOUNDER", "FOUNDER_SUPER_ADMIN", "PLATFORM_ADMIN"]);
    // Support and billing cannot transfer ownership.
    expect(platformCan("SUPPORT_ENGINEER", "platform.users.transfer_owner")).toBe(false);
    expect(platformCan("BILLING_ADMIN", "platform.roles.manage")).toBe(false);
    // Support can help with user lifecycle; billing cannot.
    expect(platformCan("SUPPORT_ENGINEER", "platform.users.manage")).toBe(true);
    expect(platformCan("BILLING_ADMIN", "platform.users.manage")).toBe(false);
  });

  it("platformCan returns false for an undefined role", () => {
    expect(platformCan(undefined, "platform.orgs.view")).toBe(false);
  });

  it("names every role in the spec alias map", () => {
    for (const role of ALL_ROLES) {
      expect(typeof PLATFORM_ROLE_SPEC_ALIAS[role]).toBe("string");
      expect(PLATFORM_ROLE_SPEC_ALIAS[role].length).toBeGreaterThan(0);
    }
  });
});

describe("platform user action rules", () => {
  it("resolvePermissions prefers a custom role, else the built-in role", () => {
    expect(resolvePermissions("DISPATCHER")).toEqual(permissionsForRole("DISPATCHER"));
    const custom = resolvePermissions("STUDENT", ["billing.view", "reports.view"]);
    expect([...custom].sort()).toEqual(["billing.view", "reports.view"]);
  });

  it("treats settings.manage as the effective-admin marker", () => {
    expect(isEffectiveAdmin(resolvePermissions("SCHOOL_ADMIN"))).toBe(true);
    expect(isEffectiveAdmin(resolvePermissions("SUPER_ADMIN"))).toBe(true);
    expect(isEffectiveAdmin(resolvePermissions("STUDENT"))).toBe(false);
    expect(isEffectiveAdmin(resolvePermissions("INSTRUCTOR"))).toBe(false);
  });

  it("blocks deactivating the Account Owner until ownership is transferred", () => {
    expect(canDeactivateUser({ isOwner: true, isLastActiveAdmin: false, isDeleted: false }).ok).toBe(false);
  });

  it("blocks deactivating the last active administrator", () => {
    expect(canDeactivateUser({ isOwner: false, isLastActiveAdmin: true, isDeleted: false }).ok).toBe(false);
  });

  it("blocks deactivating an already-deleted user, and allows an ordinary member", () => {
    expect(canDeactivateUser({ isOwner: false, isLastActiveAdmin: false, isDeleted: true }).ok).toBe(false);
    expect(canDeactivateUser({ isOwner: false, isLastActiveAdmin: false, isDeleted: false }).ok).toBe(true);
  });

  it("does not revive a soft-deleted user via reactivate", () => {
    expect(canReactivateUser({ isDeleted: true }).ok).toBe(false);
    expect(canReactivateUser({ isDeleted: false }).ok).toBe(true);
  });

  it("only transfers ownership to an active, same-org member", () => {
    expect(canTransferOwnerTo({ exists: true, isActive: true, isDeleted: false, sameOrg: true }).ok).toBe(true);
    expect(canTransferOwnerTo({ exists: true, isActive: false, isDeleted: false, sameOrg: true }).ok).toBe(false);
    expect(canTransferOwnerTo({ exists: true, isActive: true, isDeleted: true, sameOrg: true }).ok).toBe(false);
    expect(canTransferOwnerTo({ exists: false, isActive: true, isDeleted: false, sameOrg: false }).ok).toBe(false);
  });

  it("promotes a transferred owner to an all-permission role (not a bare SUPER_ADMIN assumption)", () => {
    // Owners are seeded as SCHOOL_ADMIN; the promote target must carry settings.manage.
    expect(isEffectiveAdmin(permissionsForRole(PROMOTE_ROLE))).toBe(true);
  });
});

describe("platform access boundary (customers/students/org-admins cannot enter /platform)", () => {
  // Org members, students, org admins, and individual accounts all resolve to a
  // session with NO platformRole — the single fact the boundary turns on.
  it("rejects any session without a platform role", () => {
    expect(platformAccessAllowed({ platformRole: undefined })).toBe(false); // org member / student / org admin
    expect(platformAccessAllowed({})).toBe(false); // individual account
    expect(platformAccessAllowed(null)).toBe(false);
    expect(platformAccessAllowed(undefined)).toBe(false);
  });

  it("allows a platform-staff session", () => {
    expect(platformAccessAllowed({ platformRole: "FOUNDER" })).toBe(true);
    expect(platformAccessAllowed({ platformRole: "AUDITOR" })).toBe(true);
  });
});
