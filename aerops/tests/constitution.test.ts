import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { NAV_ITEMS } from "@/components/shell/nav-config";
import { SECTION_PERMISSIONS } from "@/lib/rbac";
import { DOMAIN_EVENTS } from "@/lib/events";

/**
 * Constitution compliance (Section 20). These are architecture tests: they
 * statically enforce the rules ARCHITECTURE.md and CONSTITUTION.md state in
 * prose, so a PR that violates the constitution fails CI instead of relying
 * on a reviewer to notice.
 */
const SRC = path.resolve(__dirname, "../src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const rel = (p: string) => path.relative(SRC, p).replaceAll("\\", "/");

describe("every API route authorizes (one gate, no exceptions)", () => {
  // Public by design — each entry needs a reason.
  const PUBLIC_ROUTES = new Set([
    "app/api/auth/[...nextauth]/route.ts", // NextAuth handler IS the authenticator
    "app/api/auth/mfa-check/route.ts", // pre-auth step of the login flow, rate limited
    "app/api/auth/register/route.ts", // public sign-up, rate limited, creates org-less accounts only
    "app/api/health/route.ts", // observability: data-free by contract
    "app/api/invitations/accept/route.ts", // token-authenticated public onboarding
    "app/api/demo-requests/route.ts", // marketing form intake, rate limited, data-free response
  ]);

  // Self-service identity routes: any signed-in user acts on their OWN
  // account, so they are session-gated rather than permission-gated. The
  // test still verifies the guard exists — this is a category, not a pass.
  const SELF_SERVICE_ROUTES = new Set([
    "app/api/security/mfa/route.ts",
    "app/api/security/password/route.ts",
    "app/api/security/sessions/route.ts",
    "app/api/waitlist/route.ts",
    // Individual-account onboarding: callers have no organization yet, so no
    // org permission can apply — each route acts only on the caller's own
    // membership and is engine-validated.
    "app/api/orgs/route.ts",
    "app/api/orgs/search/route.ts",
    "app/api/join-requests/route.ts",
    "app/api/invite-links/redeem/route.ts",
  ]);

  const routes = walk(path.join(SRC, "app", "api")).filter((p) => p.endsWith("route.ts"));

  it("finds a meaningful number of routes (walker sanity)", () => {
    expect(routes.length).toBeGreaterThan(20);
  });

  for (const route of routes) {
    const name = rel(route);
    if (PUBLIC_ROUTES.has(name)) continue;
    if (SELF_SERVICE_ROUTES.has(name)) {
      it(`${name} (self-service) still guards the session`, () => {
        const src = readFileSync(route, "utf8");
        expect(src.includes("getSession()"), `${name} must resolve the session`).toBe(true);
        expect(src.includes("401"), `${name} must reject unauthenticated callers`).toBe(true);
      });
      continue;
    }
    it(`${name} calls authorize()/authorizePlatform()`, () => {
      const src = readFileSync(route, "utf8");
      expect(/\b(authorize|authorizePlatform)\(/.test(src), `${name} has no authorization gate`).toBe(true);
    });
  }
});

describe("platform mutations refuse impersonation (audit integrity, ADR-023)", () => {
  // During impersonation session.userId is the impersonated CUSTOMER, so a
  // platform route that mutates would record the customer's id as the platform
  // actor — the AuditLog.actorPlatformUser FK insert fails and recordAudit
  // swallows it (a mutation with no audit) — or persist customer-labelled data.
  // authorizePlatform(..., { mutating: true }) refuses while impersonating, so
  // every mutating /api/platform handler must pass it. The impersonate route's
  // DELETE (ending a session) is the sole intentionally-unguarded handler; its
  // POST carries the marker so the file still passes this file-level scan.
  const platformRoutes = walk(path.join(SRC, "app", "api", "platform")).filter((p) => p.endsWith("route.ts"));
  const MUTATING = /export async function (POST|PATCH|PUT|DELETE)\b/;

  it("finds platform routes (walker sanity)", () => {
    expect(platformRoutes.length).toBeGreaterThan(5);
  });

  for (const route of platformRoutes) {
    const src = readFileSync(route, "utf8");
    if (!MUTATING.test(src)) continue;
    it(`${rel(route)} guards mutations with { mutating: true }`, () => {
      expect(
        /\{\s*mutating:\s*true\s*\}/.test(src),
        `${rel(route)} has a mutating handler but never passes { mutating: true } to authorizePlatform — a staff member could mutate while impersonating and the action would be misattributed or lose its audit row`,
      ).toBe(true);
    });
  }
});

describe("nobody bypasses the event bus", () => {
  it("emitWebhook is called only inside src/lib", () => {
    const offenders = walk(SRC)
      .filter((p) => !rel(p).startsWith("lib/"))
      .filter((p) => /\bemitWebhook\(/.test(readFileSync(p, "utf8")))
      .map(rel);
    expect(offenders, `emit through emitDomainEvent instead: ${offenders.join(", ")}`).toEqual([]);
  });

  it("every event in the vocabulary is actually emitted somewhere", () => {
    const emitted = new Set<string>();
    for (const p of walk(SRC)) {
      for (const m of readFileSync(p, "utf8").matchAll(/emitDomainEvent\([^,]+,\s*"([^"]+)"/g)) emitted.add(m[1]);
    }
    for (const event of DOMAIN_EVENTS) {
      expect(emitted.has(event), `"${event}" is registered but never emitted — vocabulary must not drift from reality`).toBe(true);
    }
  });
});

describe("navigation is fully permission-mapped", () => {
  for (const item of NAV_ITEMS) {
    it(`${item.href} has a section permission`, () => {
      expect(SECTION_PERMISSIONS[item.href], `${item.href} missing from SECTION_PERMISSIONS`).toBeDefined();
    });
  }
});

describe("no raw status colors outside the canonical module", () => {
  it("STATUS_TONE map is defined exactly once", () => {
    const definers = walk(SRC).filter((p) => /const STATUS_TONE\b/.test(readFileSync(p, "utf8"))).map(rel);
    expect(definers).toEqual(["lib/status-colors.ts"]);
  });
});
