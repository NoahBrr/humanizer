/**
 * Revenue Engine payment-provider seam (doc 39 §2.1; ADR-032 base + Part 2
 * additive extensions ratified in doc 18 §9.2).
 *
 * Every engine that will move money is typed against this interface from
 * birth (Phase 1), long before an implementation exists. The deterministic
 * `FakePaymentProvider` (tests) and the real `StripeProvider` (`src/lib/stripe.ts`,
 * added in Phase 5) both satisfy it, so they cannot drift.
 *
 * Money is always integer minor units at the provider boundary (`amount` in
 * cents) with an explicit ISO 4217 `currency` — the app's Prisma `Decimal`
 * columns convert at this edge only. Every call except `parseWebhookEvent` and
 * `refundApplicationFee` executes in CONNECTED-ACCOUNT context: `accountRef` is
 * resolved server-side from the session org, never client-supplied.
 *
 * NO METHOD IS CALLED IN PHASE 1. The interface + a stub/fake are the whole of
 * the provider surface until each phase lights up its calls (Phase 4: customer +
 * method setup; Phase 5: charge, connected accounts, webhooks; Phase 6: refunds,
 * disputes).
 */

/** Opaque provider references — never secrets, safe to persist. */
export type ProviderRef = string; // cus_… pm_… pi_… re_… acct_… dp_… fee_…

export interface ProviderCharge {
  paymentIntentRef: ProviderRef;
  status: "requires_action" | "processing" | "succeeded" | "failed" | "canceled";
  clientSecret?: string; // transient — never persisted after use
  rawStatus: string;
}

export interface ProviderRefund {
  refundRef: ProviderRef;
  status: "pending" | "succeeded" | "failed" | "canceled";
  rawStatus: string;
}

export interface ProviderConnectedAccount {
  accountRef: ProviderRef;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  requirementsDue: string[];
  disabledReason: string | null;
  country: string;
  defaultCurrency: string;
}

export interface ProviderSetupSession {
  setupRef: ProviderRef;
  clientSecret: string; // transient — handed to the hosted element, never stored
}

export interface ProviderWebhookEvent {
  providerEventId: string;
  type: string;
  accountRef: ProviderRef | null; // the connected account the event belongs to
  data: unknown;
  livemode: boolean;
}

export interface CreateChargeInput {
  accountRef: ProviderRef;
  amount: number; // minor units
  currency: string;
  customerRef: ProviderRef;
  methodRef: ProviderRef;
  applicationFeeAmount: number; // minor units; the AeroOps platform fee
  idempotencyKey: string;
  offSession: boolean;
  metadata: Record<string, string>;
}

export interface CreateRefundInput {
  accountRef: ProviderRef;
  paymentIntentRef: ProviderRef;
  amount?: number; // omit for full refund
  refundApplicationFee: boolean;
  idempotencyKey: string;
  metadata: Record<string, string>;
}

/**
 * The provider contract. Implementations live behind `getPaymentProvider()`
 * (Phase 5), which returns a null-adapter when `REVENUE_CHARGING` is off so every
 * charging surface degrades gracefully to manual invoice + offline recording.
 */
export interface PaymentProvider {
  // Phase 4 — customers & saved methods (connected-account context)
  createCustomer(input: { accountRef: ProviderRef; email?: string; name?: string; metadata: Record<string, string> }): Promise<ProviderRef>;
  createSetupSession(input: { accountRef: ProviderRef; customerRef: ProviderRef; methodType: "card" | "us_bank_account" }): Promise<ProviderSetupSession>;
  detachPaymentMethod(input: { accountRef: ProviderRef; methodRef: ProviderRef }): Promise<void>;

  // Phase 5 — charging & connected accounts
  createCharge(input: CreateChargeInput): Promise<ProviderCharge>;
  createConnectedAccount(input: { country: string; email: string; metadata: Record<string, string> }): Promise<ProviderRef>;
  createAccountOnboardingLink(input: { accountRef: ProviderRef; refreshUrl: string; returnUrl: string }): Promise<string>;
  retrieveConnectedAccount(input: { accountRef: ProviderRef }): Promise<ProviderConnectedAccount>;

  // Phase 6 — refunds & disputes
  createRefund(input: CreateRefundInput): Promise<ProviderRefund>;
  submitDisputeEvidence(input: { accountRef: ProviderRef; disputeRef: ProviderRef; evidence: Record<string, string> }): Promise<void>;
  /** Platform-account context (⊙) — lost-dispute application-fee reversal. */
  refundApplicationFee(input: { applicationFeeRef: ProviderRef; amount: number; idempotencyKey: string }): Promise<void>;

  // Phase 5 — webhook verification (⊙, no account context; signature-verified)
  parseWebhookEvent(signature: string, raw: string, endpoint: "connect" | "platform"): ProviderWebhookEvent;
}
