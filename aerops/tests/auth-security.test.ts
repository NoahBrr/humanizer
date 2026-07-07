import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { platformClaimsValid } from "../src/lib/session-rules";
import { requireAuthSecret, DEV_ONLY_AUTH_SECRET } from "../src/lib/env";

// Phase 1A contracts: platform-session revocation is immediate, and
// AUTH_SECRET fails closed in production. These tests pin both.

describe("platform session revocation (platformClaimsValid)", () => {
  const active = { isActive: true, sessionVersion: 3 };

  it("accepts an active user whose token matches the current sessionVersion", () => {
    expect(platformClaimsValid(active, 3)).toBe(true);
  });

  it("rejects when the platform user row no longer exists", () => {
    expect(platformClaimsValid(null, 3)).toBe(false);
  });

  it("rejects a deactivated platform user immediately", () => {
    expect(platformClaimsValid({ isActive: false, sessionVersion: 3 }, 3)).toBe(false);
  });

  it("rejects any sessionVersion drift (revocation bump kills stale JWTs)", () => {
    expect(platformClaimsValid(active, 2)).toBe(false);
    expect(platformClaimsValid(active, 4)).toBe(false);
    expect(platformClaimsValid({ isActive: true, sessionVersion: 0 }, 1)).toBe(false);
  });

  it("fails closed when the token carries no sessionVersion claim", () => {
    expect(platformClaimsValid(active, undefined)).toBe(false);
  });

  it("version 0 tokens still validate against version 0 rows (fresh accounts)", () => {
    expect(platformClaimsValid({ isActive: true, sessionVersion: 0 }, 0)).toBe(true);
  });
});

describe("AUTH_SECRET fail-closed (requireAuthSecret)", () => {
  const REAL = "5uP3r-l0ng-r34l-s3cr3t-v4lu3-32chars-minimum!!";

  it("production with a real secret returns it unchanged", () => {
    expect(requireAuthSecret(REAL, "production")).toBe(REAL);
  });

  it("production refuses to start without AUTH_SECRET", () => {
    expect(() => requireAuthSecret(undefined, "production")).toThrow(/AUTH_SECRET is not set/);
    expect(() => requireAuthSecret("", "production")).toThrow(/AUTH_SECRET is not set/);
  });

  it("production rejects the committed .env.example placeholder", () => {
    const placeholder = /AUTH_SECRET="([^"]+)"/.exec(readFileSync(path.join(__dirname, "..", ".env.example"), "utf8"))?.[1];
    expect(placeholder).toBeTruthy();
    expect(() => requireAuthSecret(placeholder, "production")).toThrow(/placeholder/);
  });

  it("production rejects the dev-only fallback and short secrets", () => {
    expect(() => requireAuthSecret(DEV_ONLY_AUTH_SECRET, "production")).toThrow(/placeholder/);
    expect(() => requireAuthSecret("tooshort", "production")).toThrow(/shorter than/);
  });

  it("development works without AUTH_SECRET via the documented dev fallback", () => {
    expect(requireAuthSecret(undefined, "development")).toBe(DEV_ONLY_AUTH_SECRET);
    expect(requireAuthSecret(undefined, "test")).toBe(DEV_ONLY_AUTH_SECRET);
  });

  it("development prefers an explicitly configured secret", () => {
    expect(requireAuthSecret("my-local-secret", "development")).toBe("my-local-secret");
  });
});

// --- Static enforcement ------------------------------------------------------

const SRC = path.join(__dirname, "..", "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe("static enforcement", () => {
  it("AUTH_SECRET is only read inside src/lib/env.ts (no scattered fallbacks)", () => {
    const offenders = walk(SRC)
      .filter((p) => readFileSync(p, "utf8").includes("process.env.AUTH_SECRET"))
      .map((p) => path.relative(SRC, p))
      .filter((p) => p !== path.join("lib", "env.ts"));
    expect(offenders).toEqual([]);
  });

  it("no silent dev-secret fallback pattern anywhere in src", () => {
    const offenders = walk(SRC)
      .filter((p) => /AUTH_SECRET\s*(\?\?|\|\|)/.test(readFileSync(p, "utf8")))
      .map((p) => path.relative(SRC, p))
      .filter((p) => p !== path.join("lib", "env.ts"));
    expect(offenders).toEqual([]);
  });

  it("getSession verifies platform sessions through platformClaimsValid", () => {
    const session = readFileSync(path.join(SRC, "lib", "session.ts"), "utf8");
    // The platform branch must consult the database row and the shared rule —
    // removing either reopens the revocation hole this phase closed.
    expect(session).toMatch(/platformUser\.findUnique/);
    expect(session).toMatch(/platformClaimsValid\(/);
    expect(session).toMatch(/isActive: true, sessionVersion: true/);
  });

  it("server startup validates the production environment (instrumentation)", () => {
    const inst = readFileSync(path.join(SRC, "instrumentation.ts"), "utf8");
    expect(inst).toMatch(/assertProductionEnv/);
  });
});
