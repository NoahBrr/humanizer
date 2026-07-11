/**
 * Deterministic in-memory `PaymentProvider` test double (doc 33 §3.3; doc 39
 * §2.2). This is the repo's only payment test seam and it is **plain dependency
 * injection against the `PaymentProvider` interface** — never `vi.mock`, never a
 * network stub — so it cannot drift from `StripeProvider` (both are contract-
 * tested against the same interface).
 *
 * Determinism is structural: every reference comes from a per-family monotonic
 * counter, never `Math.random`/`Date.now` (both banned in engine code), so a
 * fixed sequence of calls always yields the same refs. Nothing here touches the
 * network. `createCharge`/`createRefund` are idempotent by key (a repeated key
 * returns the prior result and creates no second intent), every call is appended
 * to the public `journal`, and `parseWebhookEvent` performs a REAL HMAC-SHA256
 * verification so the simulation can craft genuinely-signed events via
 * `signPayload`/`webhookFor`.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  PaymentProvider,
  ProviderCharge,
  ProviderRefund,
  ProviderConnectedAccount,
  ProviderSetupSession,
  ProviderWebhookEvent,
  ProviderRef,
  CreateChargeInput,
  CreateRefundInput,
} from "./payment-provider";

/** Scriptable charge outcomes (doc 33 §3.3; doc 39 §2.2). */
export type ChargeOutcome =
  | "succeed"
  | "declineSync"
  | "requiresAction"
  | "processing" // ACH — settles later by webhook
  | "timeout"; // throws a timeout-like error; leaves no recorded result

/** One recorded provider call — the full audit of what the fake was asked to do. */
export interface JournalEntry {
  method: string;
  args: unknown;
}

/**
 * A fixed base so webhook timestamps are deterministic (never `Date.now`). The
 * fake verifies signatures it produced itself, so it needs no clock tolerance.
 */
const WEBHOOK_BASE_TS = 1_700_000_000;
const FAKE_WEBHOOK_SECRET = "whsec_fake_deterministic_secret";

export class FakePaymentProvider implements PaymentProvider {
  /** Every call, in order — public so tests/sim can assert the full interaction. */
  public readonly journal: JournalEntry[] = [];

  private readonly counters = new Map<string, number>();
  private readonly chargeScripts = new Map<string, ChargeOutcome>();
  private readonly accountScripts = new Map<ProviderRef, Partial<ProviderConnectedAccount>>();
  private readonly chargesByKey = new Map<string, ProviderCharge>();
  private readonly refundsByKey = new Map<string, ProviderRefund>();
  private sigCounter = 0;

  private next(prefix: string): ProviderRef {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}_fake_${n}`;
  }

  private record(method: string, args: unknown): void {
    this.journal.push({ method, args });
  }

  // ── Scripting seams (test/sim only) ──────────────────────────────────────

  /**
   * Force `createCharge`'s outcome for a given key. The key is matched against
   * the call's `idempotencyKey` first, then `metadata.reviewId`, so a test can
   * script by attempt key or by the review it belongs to.
   */
  script(idempotencyKeyOrReviewId: string, outcome: ChargeOutcome): void {
    this.chargeScripts.set(idempotencyKeyOrReviewId, outcome);
  }

  /** Override `retrieveConnectedAccount` fields for one account (e.g. charges disabled). */
  scriptAccount(accountRef: ProviderRef, over: Partial<ProviderConnectedAccount>): void {
    this.accountScripts.set(accountRef, over);
  }

  // ── Phase 4 — customers & saved methods ──────────────────────────────────

  async createCustomer(input: {
    accountRef: ProviderRef;
    email?: string;
    name?: string;
    metadata: Record<string, string>;
  }): Promise<ProviderRef> {
    this.record("createCustomer", input);
    return this.next("cus");
  }

  async createSetupSession(input: {
    accountRef: ProviderRef;
    customerRef: ProviderRef;
    methodType: "card" | "us_bank_account";
  }): Promise<ProviderSetupSession> {
    this.record("createSetupSession", input);
    const setupRef = this.next("seti");
    return { setupRef, clientSecret: `${setupRef}_secret` };
  }

  async detachPaymentMethod(input: { accountRef: ProviderRef; methodRef: ProviderRef }): Promise<void> {
    this.record("detachPaymentMethod", input);
  }

  // ── Phase 5 — charging & connected accounts ──────────────────────────────

  async createCharge(input: CreateChargeInput): Promise<ProviderCharge> {
    this.record("createCharge", input);

    // Idempotent: a repeated key returns the same prior intent, never a new one.
    const prior = this.chargesByKey.get(input.idempotencyKey);
    if (prior) return prior;

    const outcome =
      this.chargeScripts.get(input.idempotencyKey) ??
      this.chargeScripts.get(input.metadata.reviewId ?? "") ??
      "succeed";

    if (outcome === "timeout") {
      // No result recorded → a retry (reconcile-then-proceed) can re-attempt.
      throw this.timeoutError();
    }

    const paymentIntentRef = this.next("pi");
    let charge: ProviderCharge;
    switch (outcome) {
      case "declineSync":
        charge = { paymentIntentRef, status: "failed", rawStatus: "card_declined" };
        break;
      case "requiresAction":
        charge = {
          paymentIntentRef,
          status: "requires_action",
          rawStatus: "requires_action",
          clientSecret: `${paymentIntentRef}_secret`,
        };
        break;
      case "processing":
        charge = { paymentIntentRef, status: "processing", rawStatus: "processing" };
        break;
      case "succeed":
      default:
        charge = { paymentIntentRef, status: "succeeded", rawStatus: "succeeded" };
        break;
    }
    this.chargesByKey.set(input.idempotencyKey, charge);
    return charge;
  }

  async createConnectedAccount(input: {
    country: string;
    email: string;
    metadata: Record<string, string>;
  }): Promise<ProviderRef> {
    this.record("createConnectedAccount", input);
    return this.next("acct");
  }

  async createAccountOnboardingLink(input: {
    accountRef: ProviderRef;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<string> {
    this.record("createAccountOnboardingLink", input);
    return `https://connect.fake/onboarding/${input.accountRef}/${this.next("acl")}`;
  }

  async retrieveConnectedAccount(input: { accountRef: ProviderRef }): Promise<ProviderConnectedAccount> {
    this.record("retrieveConnectedAccount", input);
    const base: ProviderConnectedAccount = {
      accountRef: input.accountRef,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      requirements: { currentlyDue: [], eventuallyDue: [], pastDue: [], currentDeadline: null },
      disabledReason: null,
      country: "US",
      defaultCurrency: "usd",
      businessType: "individual",
      capabilities: { card_payments: "active", transfers: "active", us_bank_account_ach_payments: "active" },
      providerStateAsOf: null,
    };
    return { ...base, ...(this.accountScripts.get(input.accountRef) ?? {}) };
  }

  // ── Phase 6 — refunds & disputes ─────────────────────────────────────────

  async createRefund(input: CreateRefundInput): Promise<ProviderRefund> {
    this.record("createRefund", input);
    const prior = this.refundsByKey.get(input.idempotencyKey);
    if (prior) return prior;
    const refund: ProviderRefund = {
      refundRef: this.next("re"),
      status: "succeeded",
      rawStatus: "succeeded",
    };
    this.refundsByKey.set(input.idempotencyKey, refund);
    return refund;
  }

  async submitDisputeEvidence(input: {
    accountRef: ProviderRef;
    disputeRef: ProviderRef;
    evidence: Record<string, string>;
  }): Promise<void> {
    this.record("submitDisputeEvidence", input);
  }

  async refundApplicationFee(input: {
    applicationFeeRef: ProviderRef;
    amount: number;
    idempotencyKey: string;
  }): Promise<void> {
    this.record("refundApplicationFee", input);
  }

  // ── Phase 5 — webhook verification (real HMAC) ───────────────────────────

  parseWebhookEvent(signature: string, raw: string, endpoint: "connect" | "platform"): ProviderWebhookEvent {
    this.record("parseWebhookEvent", { endpoint });
    this.verifySignature(signature, raw);
    const evt = JSON.parse(raw) as {
      id: string;
      type: string;
      account?: string | null;
      data?: unknown;
    };
    return {
      providerEventId: evt.id,
      type: evt.type,
      accountRef: evt.account ?? null,
      data: evt.data,
      livemode: false,
    };
  }

  // ── Signing helpers (let tests/sim craft genuinely-signed events) ─────────

  /**
   * Produce a Stripe-shaped `t=…,v1=…` header whose `v1` is a real HMAC-SHA256
   * over `${t}.${raw}` with the fake secret — the exact scheme `parseWebhookEvent`
   * verifies. Timestamp is counter-derived, never `Date.now`.
   */
  signPayload(raw: string): string {
    const t = WEBHOOK_BASE_TS + this.sigCounter++;
    const v1 = createHmac("sha256", FAKE_WEBHOOK_SECRET).update(`${t}.${raw}`).digest("hex");
    return `t=${t},v1=${v1}`;
  }

  /**
   * Build the `{ raw, signature }` a real Stripe would POST after a charge/refund,
   * ready to feed straight into the webhook handler. `kind` is the Stripe event
   * type (e.g. "payment_intent.succeeded", "charge.refunded").
   */
  webhookFor(
    kind: string,
    opts: {
      paymentIntentRef?: ProviderRef;
      accountRef?: ProviderRef | null;
      refundRef?: ProviderRef;
      applicationFeeRef?: ProviderRef;
      status?: string;
      amount?: number;
      extra?: Record<string, unknown>;
    },
  ): { raw: string; signature: string } {
    const object: Record<string, unknown> = {
      id: opts.paymentIntentRef ?? opts.refundRef ?? opts.applicationFeeRef ?? this.next("obj"),
      object: kind.split(".")[0],
      ...(opts.paymentIntentRef ? { payment_intent: opts.paymentIntentRef } : {}),
      ...(opts.refundRef ? { refund: opts.refundRef } : {}),
      ...(opts.applicationFeeRef ? { application_fee: opts.applicationFeeRef } : {}),
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.amount !== undefined ? { amount: opts.amount } : {}),
      ...(opts.extra ?? {}),
    };
    const evt = {
      id: this.next("evt"),
      type: kind,
      account: opts.accountRef ?? null,
      livemode: false,
      data: { object },
    };
    const raw = JSON.stringify(evt);
    return { raw, signature: this.signPayload(raw) };
  }

  // ── internals ────────────────────────────────────────────────────────────

  private verifySignature(signature: string, raw: string): void {
    const parts = Object.fromEntries(
      signature.split(",").map((kv) => {
        const eq = kv.indexOf("=");
        return [kv.slice(0, eq), kv.slice(eq + 1)];
      }),
    );
    const t = parts["t"];
    const v1 = parts["v1"];
    if (!t || !v1) throw new Error("FakePaymentProvider: malformed signature header.");
    const expected = createHmac("sha256", FAKE_WEBHOOK_SECRET).update(`${t}.${raw}`).digest("hex");
    const a = Buffer.from(v1, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error("FakePaymentProvider: webhook signature verification failed.");
    }
  }

  private timeoutError(): Error {
    const err = new Error("FakePaymentProvider: simulated provider timeout.");
    err.name = "StripeConnectionError";
    return Object.assign(err, { code: "ETIMEDOUT" });
  }
}
