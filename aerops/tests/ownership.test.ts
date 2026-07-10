import { describe, it, expect } from "vitest";
import {
  permissionsForRole,
  ALL_PERMISSIONS,
  ASSIGNABLE_SYSTEM_ROLES,
  systemOrgRoleSeed,
  isOwnerTierRole,
} from "@/lib/permissions";
import {
  PROMOTE_ROLE,
  DEMOTE_ROLE,
  canAssignRoleDirectly,
  canChangeRole,
  canTransferOwnerTo,
  canDeactivateUser,
  isEffectiveAdmin,
} from "@/lib/platform-users";
import { isAdmin, ROLE_LABELS } from "@/lib/rbac";
import { selectActiveMembership } from "@/lib/membership-rules";

/**
 * Finalized ownership model (Priority 0 / ADR-023). Ownership keys on
 * Organization.ownerId + an active ACCOUNT_OWNER membership; ACCOUNT_OWNER is the
 * owner role; SUPER_ADMIN is retired as an org role; SCHOOL_ADMIN is no longer a
 * synonym for ownership. These prove the pure decision rules that guard it.
 */
describe("ACCOUNT_OWNER role model", () => {
  it("ACCOUNT_OWNER carries every permission and is an effective admin / owner tier", () => {
    expect([...permissionsForRole("ACCOUNT_OWNER")].sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect(isEffectiveAdmin(permissionsForRole("ACCOUNT_OWNER"))).toBe(true);
    expect(isAdmin("ACCOUNT_OWNER")).toBe(true);
    expect(isOwnerTierRole("ACCOUNT_OWNER")).toBe(true);
  });

  it("promote target is ACCOUNT_OWNER; a former owner is demoted to an authorized non-owner admin", () => {
    expect(PROMOTE_ROLE).toBe("ACCOUNT_OWNER");
    expect(DEMOTE_ROLE).toBe("SCHOOL_ADMIN");
    // The former owner keeps a fully-authorized org role after transfer…
    expect(isEffectiveAdmin(permissionsForRole(DEMOTE_ROLE))).toBe(true);
    // …but is no longer owner-tier.
    expect(isOwnerTierRole(DEMOTE_ROLE)).toBe(false);
  });

  it("labels the owner 'Account Owner' and separates SCHOOL_ADMIN from ownership", () => {
    expect(ROLE_LABELS.ACCOUNT_OWNER).toBe("Account Owner");
    expect(ROLE_LABELS.SCHOOL_ADMIN).not.toMatch(/owner/i);
  });

  it("ACCOUNT_OWNER and the retired SUPER_ADMIN are never assignable system roles", () => {
    expect(ASSIGNABLE_SYSTEM_ROLES).not.toContain("ACCOUNT_OWNER");
    expect(ASSIGNABLE_SYSTEM_ROLES).not.toContain("SUPER_ADMIN");
    const seeded = systemOrgRoleSeed().map((r) => r.name);
    expect(seeded).not.toContain("ACCOUNT_OWNER");
    expect(seeded).not.toContain("SUPER_ADMIN");
    expect(seeded).toContain("SCHOOL_ADMIN");
  });
});

describe("ownership assignment guards", () => {
  it("refuses assigning ACCOUNT_OWNER (or SUPER_ADMIN) via the ordinary role flow", () => {
    expect(canAssignRoleDirectly("ACCOUNT_OWNER").ok).toBe(false);
    expect(canAssignRoleDirectly("SUPER_ADMIN").ok).toBe(false);
    expect(canAssignRoleDirectly("INSTRUCTOR").ok).toBe(true);
  });

  it("locks the owner's role (no silent demotion) until ownership is transferred", () => {
    expect(canChangeRole({ isOwner: true, targetRole: "SCHOOL_ADMIN" }).ok).toBe(false);
    expect(canChangeRole({ isOwner: false, targetRole: "ACCOUNT_OWNER" }).ok).toBe(false);
    expect(canChangeRole({ isOwner: false, targetRole: "INSTRUCTOR" }).ok).toBe(true);
  });

  it("last-owner safeguard: the current owner cannot be deactivated until transfer", () => {
    expect(canDeactivateUser({ isOwner: true, isLastActiveAdmin: false, isDeleted: false }).ok).toBe(false);
    // A non-owner ordinary member deactivates fine.
    expect(canDeactivateUser({ isOwner: false, isLastActiveAdmin: false, isDeleted: false }).ok).toBe(true);
  });

  it("transfers ownership only to an active, same-org member", () => {
    expect(canTransferOwnerTo({ exists: true, isActive: true, isDeleted: false, sameOrg: true }).ok).toBe(true);
    expect(canTransferOwnerTo({ exists: true, isActive: false, isDeleted: false, sameOrg: true }).ok).toBe(false);
    expect(canTransferOwnerTo({ exists: true, isActive: true, isDeleted: true, sameOrg: true }).ok).toBe(false);
    expect(canTransferOwnerTo({ exists: true, isActive: true, isDeleted: false, sameOrg: false }).ok).toBe(false);
  });
});

describe("active-membership projection selection (multi-org)", () => {
  const m = (organizationId: string) => ({ organizationId });

  it("prefers the explicit org, then the home org, then the earliest, then none", () => {
    const active = [m("a"), m("b"), m("c")]; // ordered oldest-first
    expect(selectActiveMembership(active, "b", "c")?.organizationId).toBe("c"); // explicit preference wins
    expect(selectActiveMembership(active, "b")?.organizationId).toBe("b"); // home org
    expect(selectActiveMembership(active, "z")?.organizationId).toBe("a"); // earliest active
    expect(selectActiveMembership([], "b", "c")).toBeNull(); // no memberships → individual account
  });

  it("ignores a preferred/home org the user is not an active member of", () => {
    expect(selectActiveMembership([m("a")], "zzz", "yyy")?.organizationId).toBe("a");
  });
});
