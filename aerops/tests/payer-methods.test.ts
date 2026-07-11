import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { payerRecordFilter, payerScopeFromRelationships, assertPaymentPartyXor, type PayerScope } from "@/lib/payers";
import { isConsentValid, paymentReadiness, safeMethodDisplay, CONSENT_VERSION } from "@/lib/payment-methods";

const scope = (over: Partial<PayerScope> = {}): PayerScope => ({
  payerIds: [], viewableStudentIds: [], manageableStudentIds: [], isPayer: false, ...over,
});

describe("payer record scoping (doc 11 — access only to authorized students/invoices)", () => {
  it("limits records to the payer's own payer ids and viewable students", () => {
    const f = payerRecordFilter(scope({ payerIds: ["p1"], viewableStudentIds: ["s1", "s2"], isPayer: true }));
    expect(f.OR).toEqual([{ payerId: { in: ["p1"] } }, { studentId: { in: ["s1", "s2"] } }]);
  });
  it("fails closed to nothing (never a whole tenant) when the scope is empty", () => {
    const f = payerRecordFilter(scope());
    // Sentinel ids that match no row — an empty scope returns zero records, not all.
    expect(f.OR).toEqual([{ payerId: { in: ["__none__"] } }, { studentId: { in: ["__none__"] } }]);
  });

  it("student-wide visibility requires fullFinancialVisibility — canViewInvoices alone does NOT leak a student's other-payer reviews (doc 11 §3.9)", () => {
    // A default payer (canManage, NOT fullFinancialVisibility): sees NO student-wide rows;
    // their own bill-to reviews are matched separately by the payerId clause.
    const narrow = payerScopeFromRelationships([
      { id: "p1", relationships: [{ studentId: "s1", fullFinancialVisibility: false, canManagePaymentMethods: true }] },
    ]);
    expect(narrow.viewableStudentIds).toEqual([]);
    expect(narrow.manageableStudentIds).toEqual(["s1"]);
    // An explicitly-granted full-visibility payer sees the student's whole history.
    const full = payerScopeFromRelationships([
      { id: "p1", relationships: [{ studentId: "s1", fullFinancialVisibility: true, canManagePaymentMethods: false }] },
    ]);
    expect(full.viewableStudentIds).toEqual(["s1"]);
  });
});

describe("paying-party XOR (doc 20 V2)", () => {
  it("accepts exactly one of payerId | studentId, rejects both or neither", () => {
    expect(() => assertPaymentPartyXor("p1", null)).not.toThrow();
    expect(() => assertPaymentPartyXor(null, "s1")).not.toThrow();
    expect(() => assertPaymentPartyXor("p1", "s1")).toThrow();
    expect(() => assertPaymentPartyXor(null, null)).toThrow();
  });
});

describe("off-session consent validity (derived, R-P12)", () => {
  const bound = { paymentMethodReferenceId: "pm1", revokedAt: null as Date | null, supersededAt: null as Date | null, consentVersion: CONSENT_VERSION };
  it("is valid only when bound, unrevoked, unsuperseded, and version-current", () => {
    expect(isConsentValid(bound, CONSENT_VERSION)).toBe(true);
  });
  it("is invalid if unbound, revoked, superseded, or a stale version", () => {
    expect(isConsentValid({ ...bound, paymentMethodReferenceId: null }, CONSENT_VERSION)).toBe(false);
    expect(isConsentValid({ ...bound, revokedAt: new Date() }, CONSENT_VERSION)).toBe(false);
    expect(isConsentValid({ ...bound, supersededAt: new Date() }, CONSENT_VERSION)).toBe(false);
    expect(isConsentValid(bound, "v2")).toBe(false); // version bump forces re-acceptance
  });
});

describe("payment readiness (missing method / consent warnings)", () => {
  const method = { id: "pm1", status: "ACTIVE" as const, isDefault: true };
  const validConsent = { paymentMethodReferenceId: "pm1", revokedAt: null, supersededAt: null, consentVersion: CONSENT_VERSION };

  it("is not ready without a responsible payer", () => {
    const r = paymentReadiness({ hasPayerOrSelfPay: false, methods: [method], consents: [validConsent], currentVersion: CONSENT_VERSION });
    expect(r.ready).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/responsible payer/i);
  });
  it("is not ready without a saved method", () => {
    const r = paymentReadiness({ hasPayerOrSelfPay: true, methods: [], consents: [], currentVersion: CONSENT_VERSION });
    expect(r.ready).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/no saved payment method/i);
  });
  it("is not ready with a method but no valid consent", () => {
    const r = paymentReadiness({ hasPayerOrSelfPay: true, methods: [method], consents: [], currentVersion: CONSENT_VERSION });
    expect(r.ready).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/authorization/i);
  });
  it("is ready with an active default method and a valid consent", () => {
    const r = paymentReadiness({ hasPayerOrSelfPay: true, methods: [method], consents: [validConsent], currentVersion: CONSENT_VERSION });
    expect(r.ready).toBe(true);
    expect(r.reasons).toEqual([]);
  });
});

describe("safe method display (never a full number)", () => {
  it("shows only brand + last4 + expiry for a card", () => {
    const s = safeMethodDisplay({ type: "CARD", brand: "visa", last4: "4242", bankName: null, expMonth: 4, expYear: 2028 });
    expect(s).toBe("Visa ····4242 · exp 04/28");
    expect(s).not.toMatch(/\d{7,}/); // no long digit run — never a PAN
  });
  it("shows only bank name + last4 for a bank account", () => {
    expect(safeMethodDisplay({ type: "US_BANK_ACCOUNT", brand: null, last4: "6789", bankName: "Wells Fargo", expMonth: null, expYear: null })).toBe("Wells Fargo ····6789");
  });
});

// Principle 8: no raw card/bank data or secrets are ever stored. Scan the whole
// Revenue Engine schema + the payer/payment routes for forbidden fields.
describe("no raw payment credentials are stored (principle 8)", () => {
  // Strip comments so a reassuring "never stores a PAN/CVV" docstring isn't a
  // false positive — we only care about real declarations/assignments.
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/^\s*\/\/\/.*$/gm, "");
  const schema = stripComments(readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8"));
  const forbidden = /\b(cardNumber|cardNum|pan|cvv|cvc|securityCode|accountNumber|routingNumber|rawToken|clientSecret|cardExpiry)\b/i;

  it("the schema declares no PAN/CVV/bank-number/secret column", () => {
    expect(schema).not.toMatch(forbidden);
  });
  it("the payer + payment routes never persist a forbidden field", () => {
    const dirs = [
      path.join(__dirname, "..", "src", "app", "api", "payer"),
      path.join(__dirname, "..", "src", "app", "api", "revenue", "payers"),
    ];
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".ts")) files.push(p);
      }
    };
    dirs.forEach(walk);
    const offenders = files.filter((f) => forbidden.test(stripComments(readFileSync(f, "utf8"))));
    expect(offenders).toEqual([]);
  });
});

describe("route-enforced invariants (source guards — no DB harness in this repo)", () => {
  const read = (p: string) => readFileSync(path.join(__dirname, "..", p), "utf8");

  it("resolveDefaultPayer validates the explicit payer's ACTIVE relationship before trusting it", () => {
    const src = read("src/lib/payers.ts");
    // The explicit branch must query an ACTIVE relationship scoped by org+student+payer.
    expect(src).toMatch(/studentPayerRelationship\.findFirst[\s\S]*payerId:\s*explicitPayerId[\s\S]*status:\s*"ACTIVE"/);
  });

  it("detaching a method supersedes its consents AND promotes a surviving default", () => {
    const src = read("src/app/api/payer/payment-methods/route.ts");
    expect(src).toMatch(/status:\s*"DETACHED"/);
    expect(src).toMatch(/paymentConsent\.updateMany[\s\S]*supersededAt:\s*new Date/); // detach → consent no longer valid
    expect(src).toMatch(/method\.isDefault[\s\S]*isDefault:\s*true/); // promote a survivor
  });

  it("revoking consent stamps revokedAt (making it invalid) and is payer-scoped + audited", () => {
    const src = read("src/app/api/payer/consent/route.ts");
    expect(src).toMatch(/revokedAt:\s*new Date/);
    expect(src).toMatch(/authorizePayer/);
    expect(src).toMatch(/recordAudit/);
  });

  it("staff payer creation clears other defaults (one ACTIVE default per student)", () => {
    const src = read("src/app/api/revenue/payers/route.ts");
    expect(src).toMatch(/isDefault:\s*false/); // clears existing defaults before setting a new one
    expect(src).toMatch(/recordAudit/);
  });
});
