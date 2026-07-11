/**
 * Real Stripe `PaymentProvider` adapter (Phase 5; ADR-032 base + ADR-037 Connect
 * finalization, doc 18 §9.2). Every money-moving call is a **direct charge on the
 * org's Express connected account** (`Stripe-Account` context, resolved server-
 * side from the session org), with the AeroOps platform fee collected atomically
 * via `application_fee_amount`. The two ⊙ operations (`refundApplicationFee`,
 * `parseWebhookEvent`) run in platform-account context.
 *
 * Server-only, and the `stripe` SDK is loaded by DYNAMIC import inside `create()`
 * — never a top-level `import` — so it can never enter a client bundle (mirrors
 * how `src/lib/import/parse.ts` dynamic-imports `exceljs`). This adapter is only
 * ever constructed when `chargingEnabled()` is true; the factory in
 * `payment-service.ts` returns null otherwise and charging surfaces degrade to
 * manual invoice + offline recording.
 *
 * Secrets are read from the validated `ChargingSecrets` only; never logged,
 * never returned.
 */

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
import type { ChargingSecrets } from "./payment-config";

/** The Stripe client instance type, via an ERASED inline type query (no runtime import). */
type StripeClient = import("stripe").default;

/**
 * Pinned to the SDK's supported API version (`stripe@17.5.0` → the acacia
 * release). Kept explicit so an SDK bump is a conscious, reviewed change.
 */
const STRIPE_API_VERSION = "2024-12-18.acacia" as const;

function mapChargeStatus(status: string): ProviderCharge["status"] {
  switch (status) {
    case "succeeded":
      return "succeeded";
    case "processing":
      return "processing";
    case "requires_action":
    case "requires_confirmation":
      return "requires_action";
    case "canceled":
      return "canceled";
    default:
      // requires_payment_method (declined off-session), requires_capture, …
      return "failed";
  }
}

function mapRefundStatus(status: string | null): ProviderRefund["status"] {
  switch (status) {
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "canceled":
      return "canceled";
    default:
      // pending, requires_action, or null → not yet terminal.
      return "pending";
  }
}

function mapAccount(
  accountRef: ProviderRef,
  account: import("stripe").Stripe.Account,
): ProviderConnectedAccount {
  return {
    accountRef,
    chargesEnabled: account.charges_enabled ?? false,
    payoutsEnabled: account.payouts_enabled ?? false,
    requirementsDue: account.requirements?.currently_due ?? [],
    disabledReason: account.requirements?.disabled_reason ?? null,
    country: account.country ?? "US",
    defaultCurrency: account.default_currency ?? "usd",
  };
}

export class StripeProvider implements PaymentProvider {
  private readonly client: StripeClient;
  private readonly secrets: ChargingSecrets;

  private constructor(client: StripeClient, secrets: ChargingSecrets) {
    this.client = client;
    this.secrets = secrets;
  }

  /**
   * Async factory: dynamic-imports the SDK and constructs the client. The only
   * place `stripe` is loaded — keeps the top level import-free and server-only.
   */
  static async create(secrets: ChargingSecrets): Promise<StripeProvider> {
    const Stripe = (await import("stripe")).default;
    const client = new Stripe(secrets.connectSecretKey, { apiVersion: STRIPE_API_VERSION });
    return new StripeProvider(client, secrets);
  }

  // ── Phase 4 — customers & saved methods (connected-account context) ──────

  async createCustomer(input: {
    accountRef: ProviderRef;
    email?: string;
    name?: string;
    metadata: Record<string, string>;
  }): Promise<ProviderRef> {
    const customer = await this.client.customers.create(
      { email: input.email, name: input.name, metadata: input.metadata },
      { stripeAccount: input.accountRef },
    );
    return customer.id;
  }

  async createSetupSession(input: {
    accountRef: ProviderRef;
    customerRef: ProviderRef;
    methodType: "card" | "us_bank_account";
  }): Promise<ProviderSetupSession> {
    const intent = await this.client.setupIntents.create(
      {
        customer: input.customerRef,
        payment_method_types: [input.methodType],
        usage: "off_session",
      },
      { stripeAccount: input.accountRef },
    );
    return { setupRef: intent.id, clientSecret: intent.client_secret ?? "" };
  }

  async detachPaymentMethod(input: { accountRef: ProviderRef; methodRef: ProviderRef }): Promise<void> {
    await this.client.paymentMethods.detach(input.methodRef, {}, { stripeAccount: input.accountRef });
  }

  // ── Phase 5 — charging & connected accounts ──────────────────────────────

  async createCharge(input: CreateChargeInput): Promise<ProviderCharge> {
    const intent = await this.client.paymentIntents.create(
      {
        amount: input.amount,
        currency: input.currency,
        customer: input.customerRef,
        payment_method: input.methodRef,
        // Omitted when zero (ADR-037 item 8) — Stripe rejects a zero fee.
        ...(input.applicationFeeAmount > 0
          ? { application_fee_amount: input.applicationFeeAmount }
          : {}),
        confirm: true,
        off_session: input.offSession,
        metadata: input.metadata,
      },
      { stripeAccount: input.accountRef, idempotencyKey: input.idempotencyKey },
    );
    return {
      paymentIntentRef: intent.id,
      status: mapChargeStatus(intent.status),
      rawStatus: intent.status,
      clientSecret: intent.client_secret ?? undefined,
    };
  }

  async createConnectedAccount(input: {
    country: string;
    email: string;
    metadata: Record<string, string>;
  }): Promise<ProviderRef> {
    const account = await this.client.accounts.create({
      type: "express",
      country: input.country,
      email: input.email,
      metadata: input.metadata,
    });
    return account.id;
  }

  async createAccountOnboardingLink(input: {
    accountRef: ProviderRef;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<string> {
    const link = await this.client.accountLinks.create({
      account: input.accountRef,
      refresh_url: input.refreshUrl,
      return_url: input.returnUrl,
      type: "account_onboarding",
    });
    return link.url;
  }

  async retrieveConnectedAccount(input: { accountRef: ProviderRef }): Promise<ProviderConnectedAccount> {
    const account = await this.client.accounts.retrieve(input.accountRef);
    return mapAccount(input.accountRef, account);
  }

  // ── Phase 6 — refunds & disputes ─────────────────────────────────────────

  async createRefund(input: CreateRefundInput): Promise<ProviderRefund> {
    const refund = await this.client.refunds.create(
      {
        payment_intent: input.paymentIntentRef,
        refund_application_fee: input.refundApplicationFee,
        metadata: input.metadata,
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
      },
      { stripeAccount: input.accountRef, idempotencyKey: input.idempotencyKey },
    );
    return {
      refundRef: refund.id,
      status: mapRefundStatus(refund.status),
      rawStatus: refund.status ?? "pending",
    };
  }

  async submitDisputeEvidence(input: {
    accountRef: ProviderRef;
    disputeRef: ProviderRef;
    evidence: Record<string, string>;
  }): Promise<void> {
    await this.client.disputes.update(
      input.disputeRef,
      { evidence: input.evidence as import("stripe").Stripe.DisputeUpdateParams.Evidence },
      { stripeAccount: input.accountRef },
    );
  }

  /** ⊙ Platform-account context — lost-dispute application-fee reversal (doc 27 §4.8). */
  async refundApplicationFee(input: {
    applicationFeeRef: ProviderRef;
    amount: number;
    idempotencyKey: string;
  }): Promise<void> {
    await this.client.applicationFees.createRefund(
      input.applicationFeeRef,
      { amount: input.amount },
      { idempotencyKey: input.idempotencyKey },
    );
  }

  // ── Phase 5 — webhook verification (⊙, per-endpoint secret) ──────────────

  parseWebhookEvent(signature: string, raw: string, endpoint: "connect" | "platform"): ProviderWebhookEvent {
    const secret =
      endpoint === "connect" ? this.secrets.connectWebhookSecret : this.secrets.platformWebhookSecret;
    const event = this.client.webhooks.constructEvent(raw, signature, secret);
    return {
      providerEventId: event.id,
      type: event.type,
      accountRef: event.account ?? null,
      data: event.data,
      livemode: event.livemode,
    };
  }
}
