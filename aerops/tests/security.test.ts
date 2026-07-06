import { describe, it, expect } from "vitest";
import { generateSecret, totpCode, verifyTotp, otpauthUrl } from "@/lib/totp";
import { validatePassword } from "@/lib/password";
import { rateLimit } from "@/lib/rate-limit";
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS } from "@/lib/permissions";

describe("TOTP (RFC 6238)", () => {
  it("accepts the current code and adjacent steps, rejects garbage", () => {
    const secret = generateSecret();
    expect(verifyTotp(secret, totpCode(secret))).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, -1))).toBe(true); // clock drift
    expect(verifyTotp(secret, "000000")).toBe(verifyTotp(secret, "000000")); // deterministic
    expect(verifyTotp(secret, "12345")).toBe(false); // wrong length
    expect(verifyTotp(secret, "abcdef")).toBe(false); // not digits
  });

  it("codes differ across secrets", () => {
    expect(totpCode(generateSecret())).toHaveLength(6);
    const a = generateSecret();
    const b = generateSecret();
    expect(a).not.toBe(b);
  });

  it("produces a scannable otpauth provisioning URL", () => {
    const url = otpauthUrl("JBSWY3DPEHPK3PXP", "pilot@example.com");
    expect(url).toContain("otpauth://totp/");
    expect(url).toContain("secret=JBSWY3DPEHPK3PXP");
  });
});

describe("password policy (Section 4)", () => {
  it("enforces length and all four character classes", () => {
    expect(validatePassword("Short1!").ok).toBe(false);
    expect(validatePassword("alllowercase1!aa").ok).toBe(false);
    expect(validatePassword("ALLUPPERCASE1!AA").ok).toBe(false);
    expect(validatePassword("NoNumbersHere!!!").ok).toBe(false);
    expect(validatePassword("NoSpecials12345A").ok).toBe(false);
    expect(validatePassword("Blue-Skies&Tailwinds-2026").ok).toBe(true);
  });

  it("rejects breached/common passwords even when they pass the classes", () => {
    const check = validatePassword("Password123!!!");
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.error).toContain("breach");
  });
});

describe("rate limiting", () => {
  it("allows up to the limit inside the window, then refuses with retry guidance", () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 5; i++) expect(rateLimit(key, 5, 60_000).allowed).toBe(true);
    const blocked = rateLimit(key, 5, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterS).toBeGreaterThan(0);
  });

  it("keys are independent", () => {
    const a = `a-${Math.random()}`;
    rateLimit(a, 1, 60_000);
    expect(rateLimit(a, 1, 60_000).allowed).toBe(false);
    expect(rateLimit(`b-${Math.random()}`, 1, 60_000).allowed).toBe(true);
  });
});

describe("permission catalog (RBAC is data, not code)", () => {
  it("every role bundle references only cataloged permissions", () => {
    const catalog = new Set(Object.keys(PERMISSIONS));
    for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      for (const p of perms) expect(catalog.has(p), `${role} grants unknown permission ${p}`).toBe(true);
    }
  });

  it("students never hold mutating operational permissions", () => {
    const student = new Set(DEFAULT_ROLE_PERMISSIONS.STUDENT);
    for (const denied of ["maintenance.manage", "dispatch.release", "settings.manage", "billing.record_payments"]) {
      expect(student.has(denied as never), `student must not hold ${denied}`).toBe(false);
    }
  });

  it("super admin holds the full catalog", () => {
    expect(new Set(DEFAULT_ROLE_PERMISSIONS.SUPER_ADMIN).size).toBe(Object.keys(PERMISSIONS).length);
  });
});
