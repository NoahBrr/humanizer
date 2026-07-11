import { hashToken } from "@/lib/tokens";
import type { PaymentMethodReference, PaymentConsent } from "@prisma/client";

/**
 * Payment-method foundation (doc 20, Part Q). Safe-metadata display, off-session
 * consent validity (derived, never stored — R-P12), and payment readiness.
 *
 * NO PROVIDER SDK, NO CHARGING. Method capture in this phase resolves to a
 * provider-independent STUB (`createSetupSessionStub`) that stands in for the
 * hosted SetupIntent surface; the real Stripe adapter and any charge execution
 * are Phase 5. Nothing here stores a PAN, CVV, bank number, or raw token/secret
 * (principle 8) — only opaque provider references and the safe allowlist.
 */

/** The default billing-authorization consent text + version (doc 20). Org-custom
 *  text is a later refinement; the version pins re-acceptance on wording change. */
export const CONSENT_VERSION = "v1";
export const CONSENT_TEXT =
  "I authorize this flight school to charge my saved payment method for approved " +
  "flight charges (aircraft rental, instruction, fees, and applicable tax) after " +
  "each Revenue Review is approved. I understand charges occur off-session and " +
  "that I may revoke this authorization at any time.";
export const CONSENT_TEXT_HASH = hashToken(CONSENT_TEXT); // integrity pin (single-source hashing)

/** Human-safe method label from the allowlist metadata — never a full number. */
export function safeMethodDisplay(m: Pick<PaymentMethodReference, "type" | "brand" | "last4" | "bankName" | "expMonth" | "expYear">): string {
  if (m.type === "CARD") {
    const brand = m.brand ? m.brand[0].toUpperCase() + m.brand.slice(1) : "Card";
    const exp = m.expMonth && m.expYear ? ` · exp ${String(m.expMonth).padStart(2, "0")}/${String(m.expYear).slice(-2)}` : "";
    return `${brand} ····${m.last4 ?? "????"}${exp}`;
  }
  return `${m.bankName ?? "Bank account"} ····${m.last4 ?? "????"}`;
}

/**
 * A consent row is valid (chargeable authorization exists) iff it is bound to a
 * saved method, unrevoked, unsuperseded, and its version matches the org's
 * current billing-authorization version. Derived at read — no stored status.
 */
export function isConsentValid(
  c: Pick<PaymentConsent, "paymentMethodReferenceId" | "revokedAt" | "supersededAt" | "consentVersion">,
  currentVersion: string,
): boolean {
  return (
    c.paymentMethodReferenceId != null &&
    c.revokedAt == null &&
    c.supersededAt == null &&
    c.consentVersion === currentVersion
  );
}

export type PaymentReadiness = { ready: boolean; reasons: string[] };

/**
 * Whether an approved review COULD be charged off-session (readiness only — no
 * charge happens in this phase). Requires an ACTIVE default method on the
 * bill-to customer and a valid consent bound to it. The reasons drive the
 * "missing payment method / missing consent" warnings on the review.
 */
export function paymentReadiness(input: {
  hasPayerOrSelfPay: boolean;
  methods: Pick<PaymentMethodReference, "id" | "status" | "isDefault">[];
  consents: Pick<PaymentConsent, "paymentMethodReferenceId" | "revokedAt" | "supersededAt" | "consentVersion">[];
  currentVersion: string;
}): PaymentReadiness {
  const reasons: string[] = [];
  if (!input.hasPayerOrSelfPay) reasons.push("No responsible payer is assigned.");
  const active = input.methods.filter((m) => m.status === "ACTIVE");
  const def = active.find((m) => m.isDefault) ?? active[0];
  if (!def) {
    reasons.push("No saved payment method on file.");
    return { ready: false, reasons };
  }
  const hasConsent = input.consents.some(
    (c) => c.paymentMethodReferenceId === def.id && isConsentValid(c, input.currentVersion),
  );
  if (!hasConsent) reasons.push("No current off-session charging authorization for the default method.");
  return { ready: reasons.length === 0, reasons };
}

/**
 * Provider-independent method-setup stub (doc 39 §2.2 FakeProvider posture). In
 * this phase there is no Stripe SDK: this returns a deterministic fake hosted-
 * setup reference so the setup flow and consent capture work end-to-end in dev
 * without any real provider. Phase 5 replaces it with the real StripeProvider
 * SetupIntent behind the env-gated adapter. It NEVER handles card/bank data.
 */
export function createSetupSessionStub(input: { customerRef: string; methodType: "card" | "us_bank_account" }): { setupRef: string; clientSecret: string; stub: true } {
  const suffix = Math.abs(hashCode(`${input.customerRef}:${input.methodType}`)).toString(36);
  return {
    setupRef: `seti_stub_${suffix}`,
    clientSecret: `seti_stub_${suffix}_secret_dev`, // transient dev-only placeholder — never persisted
    stub: true,
  };
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
