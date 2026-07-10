import { describe, it, expect } from "vitest";
import { computeAttribution } from "@/lib/audit-attribution";

/**
 * Impersonation audit attribution (Priority 1 / ADR-023). Every action performed
 * while impersonating must preserve BOTH identities — the real platform actor and
 * the customer being represented — and must never imply the customer acted
 * independently. This exercises the pure decision the shared audit layer applies
 * to all ~37 customer routes centrally.
 */
const imp = { platformUserId: "plat_1", platformLabel: "Dana Ops", sessionId: "imp_sess_1" };

describe("audit attribution", () => {
  it("normal customer action: keeps the customer actor, no impersonation fields", () => {
    const a = computeAttribution({ actorUserId: "cust_1", actorLabel: "Sam Student" }, null);
    expect(a.actorUserId).toBe("cust_1");
    expect(a.actorPlatformUserId).toBeNull();
    expect(a.impersonatedUserId).toBeNull();
    expect(a.impersonationSessionId).toBeNull();
    expect(a.actorLabel).toBe("Sam Student");
  });

  it("normal platform action: an explicit platform actor is never rewritten, even with a cookie present", () => {
    const a = computeAttribution({ actorPlatformUserId: "plat_1", actorLabel: "Dana Ops (AeroOps)" }, imp);
    expect(a.actorPlatformUserId).toBe("plat_1");
    expect(a.actorUserId).toBeNull();
    expect(a.impersonatedUserId).toBeNull();
    expect(a.impersonationSessionId).toBeNull();
  });

  it("impersonated action: re-attributes to the REAL staff actor and preserves the customer + session", () => {
    const a = computeAttribution({ actorUserId: "cust_1", actorLabel: "Sam Student" }, imp);
    expect(a.actorPlatformUserId).toBe("plat_1"); // the real actor
    expect(a.impersonatedUserId).toBe("cust_1"); // the customer, preserved as the effective identity
    expect(a.impersonationSessionId).toBe("imp_sess_1"); // linked to the support session
    expect(a.actorUserId).toBeNull(); // the customer did NOT act on their own
    expect(a.actorLabel).toContain("Dana Ops"); // staff visible
    expect(a.actorLabel).toContain("Sam Student"); // customer visible
    expect(a.actorLabel).toMatch(/impersonat/i);
  });

  it("without impersonation, a customer action is never mislabeled as AeroOps staff", () => {
    const a = computeAttribution({ actorUserId: "cust_1", actorLabel: "Sam Student" }, null);
    expect(a.actorLabel).not.toMatch(/AeroOps/i);
    expect(a.actorPlatformUserId).toBeNull();
  });

  it("start/end audits: explicit impersonation fields pass through unchanged", () => {
    const a = computeAttribution(
      { actorPlatformUserId: "plat_1", impersonatedUserId: "cust_1", impersonationSessionId: "imp_sess_1", actorLabel: "Dana Ops (AeroOps)" },
      null,
    );
    expect(a.actorPlatformUserId).toBe("plat_1");
    expect(a.impersonatedUserId).toBe("cust_1");
    expect(a.impersonationSessionId).toBe("imp_sess_1");
  });

  it("attribution never emits raw secrets, cookies, or tokens — only ids and labels", () => {
    const a = computeAttribution({ actorUserId: "cust_1", actorLabel: "Sam Student" }, imp);
    expect(JSON.stringify(a)).not.toMatch(/secret|cookie|token|passwordHash|mfaSecret/i);
  });
});
