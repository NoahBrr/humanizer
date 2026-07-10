import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { founderAccessAllowed, platformAccessWindowActive, platformOrgInScope } from "@/lib/session-rules";
import {
  ASSIGNABLE_PLATFORM_ROLES,
  canAssignPlatformRoleDirectly,
  canDeactivatePlatformUser,
  canScopePlatformUser,
  requiresFounderChangeReason,
  validAccessWindow,
} from "@/lib/platform-user-admin";
import { PLATFORM_ROLE_PERMISSIONS, ALL_PLATFORM_PERMISSIONS, PLATFORM_ROLE_SPEC_ALIAS } from "@/lib/platform-permissions";
import { PLATFORM_ROLE_LABELS } from "@/lib/rbac";

/**
 * Founder authority (Phase D3-A / ADR-024). Founder power is the immutable
 * `isFounder` identity, conferred only by the bootstrap — never by a role — so
 * founder-exclusive surfaces cannot be reached by editing a platform role.
 */
describe("founder identity", () => {
  it("keys on the immutable isFounder identity, never a role", () => {
    expect(founderAccessAllowed({ isFounder: true })).toBe(true);
    expect(founderAccessAllowed({ isFounder: false })).toBe(false);
    expect(founderAccessAllowed({})).toBe(false);
    expect(founderAccessAllowed(null)).toBe(false);
    expect(founderAccessAllowed(undefined)).toBe(false);
  });

  it("FOUNDER_SUPER_ADMIN is the top role with every platform capability", () => {
    expect([...PLATFORM_ROLE_PERMISSIONS.FOUNDER_SUPER_ADMIN].sort()).toEqual([...ALL_PLATFORM_PERMISSIONS].sort());
    expect(PLATFORM_ROLE_SPEC_ALIAS.FOUNDER_SUPER_ADMIN).toBe("Founder Super Admin");
    expect(PLATFORM_ROLE_LABELS.FOUNDER_SUPER_ADMIN).toBe("Founder Super Admin");
  });

  it("FOUNDER_SUPER_ADMIN is never assignable via an ordinary role change", () => {
    expect(ASSIGNABLE_PLATFORM_ROLES).not.toContain("FOUNDER_SUPER_ADMIN");
    expect(canAssignPlatformRoleDirectly("FOUNDER_SUPER_ADMIN").ok).toBe(false);
    expect(canAssignPlatformRoleDirectly("SUPPORT_ENGINEER").ok).toBe(true);
  });
});

describe("last-founder safeguard + founder-change rules", () => {
  it("blocks removing the last active founder; allows when another founder remains", () => {
    expect(canDeactivatePlatformUser({ targetIsFounder: true, otherActiveFoundersExist: false }).ok).toBe(false);
    expect(canDeactivatePlatformUser({ targetIsFounder: true, otherActiveFoundersExist: true }).ok).toBe(true);
    expect(canDeactivatePlatformUser({ targetIsFounder: false, otherActiveFoundersExist: false }).ok).toBe(true);
  });

  it("requires a recorded reason for any change to a founder", () => {
    expect(requiresFounderChangeReason(true, undefined).ok).toBe(false);
    expect(requiresFounderChangeReason(true, "  ").ok).toBe(false);
    expect(requiresFounderChangeReason(true, "recovery rotation").ok).toBe(true);
    expect(requiresFounderChangeReason(false, undefined).ok).toBe(true);
  });
});

describe("org-restricted platform access (D3-A scope confinement)", () => {
  it("unrestricted staff act on any org; a restricted staffer only within their list", () => {
    expect(platformOrgInScope(undefined, "org_x")).toBe(true);
    expect(platformOrgInScope(null, "org_x")).toBe(true);
    expect(platformOrgInScope([], "org_x")).toBe(true);
    expect(platformOrgInScope(["org_a", "org_b"], "org_a")).toBe(true);
    expect(platformOrgInScope(["org_a", "org_b"], "org_x")).toBe(false);
  });
});

describe("founder lockout protection (D3-A)", () => {
  it("access scopes (read-only / time-box / org-restriction) can never be applied to a founder", () => {
    expect(canScopePlatformUser(true).ok).toBe(false); // founder → refused (no lockout)
    expect(canScopePlatformUser(false).ok).toBe(true); // non-founder → allowed
  });
});

describe("time-boxed platform access", () => {
  const now = new Date("2026-07-10T12:00:00Z");
  it("refuses access before the start and after the expiry", () => {
    expect(platformAccessWindowActive({}, now)).toBe(true);
    expect(platformAccessWindowActive({ accessStartsAt: new Date("2026-07-11T00:00:00Z") }, now)).toBe(false);
    expect(platformAccessWindowActive({ accessExpiresAt: new Date("2026-07-09T00:00:00Z") }, now)).toBe(false);
    expect(platformAccessWindowActive({ accessStartsAt: new Date("2026-07-01"), accessExpiresAt: new Date("2026-07-31") }, now)).toBe(true);
  });
  it("validates the access-window bounds", () => {
    expect(validAccessWindow(new Date("2026-07-10"), new Date("2026-07-09")).ok).toBe(false);
    expect(validAccessWindow(new Date("2026-07-10"), new Date("2026-07-11")).ok).toBe(true);
    expect(validAccessWindow(null, null).ok).toBe(true);
  });
});

describe("founder credential hygiene (no hardcoded / seeded / logged secrets)", () => {
  const root = path.resolve(__dirname, "..");
  const bootstrap = readFileSync(path.join(root, "scripts/bootstrap-founders.ts"), "utf8");
  const seed = readFileSync(path.join(root, "prisma/seed.ts"), "utf8");

  it("the bootstrap reads passwords from the environment and hashes them — never a literal", () => {
    expect(bootstrap).toMatch(/process\.env\[f\.passwordEnv\]/); // read from protected env
    expect(bootstrap).toMatch(/bcrypt\.hash\(password/); // store only a hash
    expect(bootstrap).not.toMatch(/\$2[aby]\$\d\d\$/); // no committed bcrypt hash literal
  });

  it("the bootstrap never prints the plaintext password", () => {
    // No console.* line interpolates the `password` variable.
    for (const line of bootstrap.split("\n")) {
      if (/console\.(log|error|warn|info)/.test(line)) {
        expect(line).not.toMatch(/\$\{?\s*password\b/);
      }
    }
  });

  it("the seed never contains the real founder credentials (they are bootstrap-only)", () => {
    expect(seed).not.toMatch(/noahkshroff@gmail\.com/i);
    expect(seed).not.toMatch(/freyjack2@gmail\.com/i);
    expect(seed.toLowerCase()).not.toContain("founder_noah_password");
    expect(seed.toLowerCase()).not.toContain("founder_jack_password");
  });

  it("the seed can never mint a founder (no isFounder, no FOUNDER_SUPER_ADMIN)", () => {
    expect(seed).not.toMatch(/isFounder\s*:\s*true/);
    expect(seed).not.toContain("FOUNDER_SUPER_ADMIN");
  });

  it("the bootstrap provisions exactly the two founders — it is not a general admin-creation path", () => {
    // The identity list is fixed in the script (emails are identities, not
    // secrets); the environment supplies only passwords, never extra accounts.
    const emails = [...bootstrap.matchAll(/email:\s*"([^"]+)"/g)].map((m) => m[1].toLowerCase());
    expect(emails.sort()).toEqual(["freyjack2@gmail.com", "noahkshroff@gmail.com"]);
    expect(bootstrap).not.toMatch(/process\.env\.[A-Z_]*EMAIL/); // no env-driven identities
  });
});

describe("no email-based founder authorization in application code", () => {
  // Founder AUTHORIZATION keys on the immutable isFounder identity — never an
  // email comparison. The founder emails may appear only in the bootstrap
  // script (as provisioning identities), nowhere in src/.
  it("src/ never references the founder emails", () => {
    const src = path.resolve(__dirname, "../src");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && /noahkshroff@gmail\.com|freyjack2@gmail\.com/i.test(readFileSync(p, "utf8"))) {
          offenders.push(p);
        }
      }
    };
    walk(src);
    expect(offenders).toEqual([]);
  });
});
