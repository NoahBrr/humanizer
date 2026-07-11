import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { revenueChargingMode, chargingSecrets, chargingEnabled } from "@/lib/payment-config";
import { FakePaymentProvider } from "@/lib/fake-provider";
import {
  __setPaymentProvider,
  __resetPaymentProviderCache,
  getPaymentProvider,
  getPaymentProviderAsync,
  chargingActive,
} from "@/lib/payment-service";

const LIB = path.resolve(__dirname, "../src/lib");
const read = (f: string) => readFileSync(path.join(LIB, f), "utf8");

// Explicit env objects only — the unit suite never reads real STRIPE credentials
// (doc 24 I9). Valid test-mode secrets:
const mkEnv = (o: Record<string, string | undefined>): NodeJS.ProcessEnv =>
  o as unknown as NodeJS.ProcessEnv;

const validEnv = (over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv =>
  mkEnv({
    REVENUE_CHARGING: "test",
    STRIPE_CONNECT_SECRET_KEY: "rk_test_abc123",
    STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_connect",
    STRIPE_PLATFORM_WEBHOOK_SECRET: "whsec_platform",
    ...over,
  });

describe("payment-config — fail-closed, test-mode-only (doc 39 §3)", () => {
  it("defaults to off when REVENUE_CHARGING is absent", () => {
    expect(revenueChargingMode(mkEnv({}))).toBe("off");
    expect(chargingSecrets(mkEnv({}))).toBeNull();
    expect(chargingEnabled(mkEnv({}))).toBe(false);
  });

  it("off → null secrets, no throw even with keys absent", () => {
    const env = mkEnv({ REVENUE_CHARGING: "off" });
    expect(revenueChargingMode(env)).toBe("off");
    expect(chargingSecrets(env)).toBeNull();
    expect(chargingEnabled(env)).toBe(false);
  });

  it("test + valid rk_test_ keys → validated secrets", () => {
    const env = validEnv();
    expect(revenueChargingMode(env)).toBe("test");
    const secrets = chargingSecrets(env);
    expect(secrets).toEqual({
      connectSecretKey: "rk_test_abc123",
      connectWebhookSecret: "whsec_connect",
      platformWebhookSecret: "whsec_platform",
    });
    expect(chargingEnabled(env)).toBe(true);
  });

  it("test + valid sk_test_ key also accepted", () => {
    const env = validEnv({ STRIPE_CONNECT_SECRET_KEY: "sk_test_xyz" });
    expect(chargingSecrets(env)?.connectSecretKey).toBe("sk_test_xyz");
  });

  it("test + a missing secret → throws (fail-closed)", () => {
    expect(() => chargingSecrets(validEnv({ STRIPE_CONNECT_WEBHOOK_SECRET: undefined }))).toThrow(
      /requires STRIPE_CONNECT_WEBHOOK_SECRET/,
    );
    expect(() => chargingSecrets(validEnv({ STRIPE_CONNECT_SECRET_KEY: undefined }))).toThrow(
      /requires STRIPE_CONNECT_SECRET_KEY/,
    );
  });

  it("test + a LIVE-prefixed connect key → throws (the live-guard)", () => {
    expect(() => chargingSecrets(validEnv({ STRIPE_CONNECT_SECRET_KEY: "sk_live_realmoney" }))).toThrow(
      /LIVE key/,
    );
    expect(() => chargingSecrets(validEnv({ STRIPE_CONNECT_SECRET_KEY: "rk_live_realmoney" }))).toThrow(
      /LIVE key/,
    );
  });

  it("test + a non-test-prefixed connect key → throws", () => {
    expect(() => chargingSecrets(validEnv({ STRIPE_CONNECT_SECRET_KEY: "pk_test_notsecret" }))).toThrow(
      /must be a test key/,
    );
  });

  it("an invalid REVENUE_CHARGING value → throws (no live mode exists)", () => {
    expect(() => revenueChargingMode(mkEnv({ REVENUE_CHARGING: "live" }))).toThrow(
      /must be "off" or "test"/,
    );
    expect(() => revenueChargingMode(mkEnv({ REVENUE_CHARGING: "yes" }))).toThrow();
  });
});

describe("stripe adapter — source discipline (doc 33 §5.4)", () => {
  const stripeSrc = read("stripe-connect.ts");

  it("has NO top-level `import ... from \"stripe\"` — dynamic import only", () => {
    const topLevelImport = /^\s*import\b[^\n]*\bfrom\s+["']stripe["']/m;
    expect(topLevelImport.test(stripeSrc)).toBe(false);
    // The SDK is loaded exclusively via a dynamic import, so it never bundles client-side.
    expect(stripeSrc).toMatch(/await import\(["']stripe["']\)/);
  });

  it("stores no raw card / bank credential fields anywhere in the payment layer", () => {
    const forbidden = [
      /\bcard_number\b/i,
      /\bcardnumber\b/i,
      /\bcvc\b/i,
      /\bcvv\b/i,
      /\bexp_month\b/i,
      /\bexp_year\b/i,
      /\baccount_number\b/i,
      /\brouting_number\b/i,
    ];
    for (const file of ["stripe-connect.ts", "fake-provider.ts", "payment-service.ts", "payment-provider.ts"]) {
      const src = read(file);
      for (const pat of forbidden) {
        expect(pat.test(src), `${file} must not reference ${pat}`).toBe(false);
      }
    }
  });

  it("never console-logs from the payment layer (secrets must not leak to logs)", () => {
    for (const file of ["stripe-connect.ts", "fake-provider.ts", "payment-service.ts"]) {
      expect(/console\.(log|info|warn|error)/.test(read(file))).toBe(false);
    }
  });
});

describe("payment-service — factory + injection seam (degrades when charging off)", () => {
  afterEach(() => {
    __setPaymentProvider(null);
    __resetPaymentProviderCache();
  });

  it("returns null when charging is off (default test env) — callers degrade to offline", async () => {
    expect(chargingActive()).toBe(false);
    expect(getPaymentProvider()).toBeNull();
    await expect(getPaymentProviderAsync()).resolves.toBeNull();
  });

  it("returns the injected provider from both sync and async resolvers", async () => {
    const fake = new FakePaymentProvider();
    __setPaymentProvider(fake);
    expect(getPaymentProvider()).toBe(fake);
    await expect(getPaymentProviderAsync()).resolves.toBe(fake);
  });
});

describe("FakePaymentProvider — deterministic contract double (doc 33 §3.3)", () => {
  const chargeInput = (over: Partial<Parameters<FakePaymentProvider["createCharge"]>[0]> = {}) => ({
    accountRef: "acct_fake_1",
    amount: 50000,
    currency: "usd",
    customerRef: "cus_fake_1",
    methodRef: "pm_fake_1",
    applicationFeeAmount: 980,
    idempotencyKey: "sc_1_a1",
    offSession: true,
    metadata: { reviewId: "rev_1" },
    ...over,
  });

  it("is deterministic — two fresh instances yield identical ref sequences", async () => {
    const a = new FakePaymentProvider();
    const b = new FakePaymentProvider();
    const ra = await a.createCharge(chargeInput());
    const rb = await b.createCharge(chargeInput());
    expect(ra).toEqual(rb);
    expect(ra.paymentIntentRef).toBe("pi_fake_1");
    expect(ra.status).toBe("succeeded");
  });

  it("createCharge is idempotent by key — same result, no second intent", async () => {
    const p = new FakePaymentProvider();
    const first = await p.createCharge(chargeInput());
    const second = await p.createCharge(chargeInput());
    expect(second).toBe(first);
    // Both calls journaled, but only one PaymentIntent minted.
    const charges = p.journal.filter((j) => j.method === "createCharge");
    expect(charges).toHaveLength(2);
    const distinctRefs = new Set([first.paymentIntentRef, second.paymentIntentRef]);
    expect(distinctRefs.size).toBe(1);
  });

  it("scripts outcomes by idempotency key and by metadata review id", async () => {
    const p = new FakePaymentProvider();
    p.script("sc_1_a1", "declineSync");
    expect((await p.createCharge(chargeInput())).status).toBe("failed");

    p.script("rev_9", "requiresAction");
    const ra = await p.createCharge(chargeInput({ idempotencyKey: "sc_9_a1", metadata: { reviewId: "rev_9" } }));
    expect(ra.status).toBe("requires_action");
    expect(ra.clientSecret).toBeDefined();

    p.script("sc_ach_a1", "processing");
    expect((await p.createCharge(chargeInput({ idempotencyKey: "sc_ach_a1" }))).status).toBe("processing");
  });

  it("timeout throws and records no result (retry can re-attempt)", async () => {
    const p = new FakePaymentProvider();
    p.script("sc_to_a1", "timeout");
    await expect(p.createCharge(chargeInput({ idempotencyKey: "sc_to_a1" }))).rejects.toThrow(/timeout/i);
    // No intent stored → a subsequent scripted-succeed attempt on the same key proceeds.
    p.script("sc_to_a1", "succeed");
    expect((await p.createCharge(chargeInput({ idempotencyKey: "sc_to_a1" }))).status).toBe("succeeded");
  });

  it("retrieveConnectedAccount is healthy by default and scriptable per account", async () => {
    const p = new FakePaymentProvider();
    const healthy = await p.retrieveConnectedAccount({ accountRef: "acct_fake_1" });
    expect(healthy).toMatchObject({
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      requirements: { currentlyDue: [], eventuallyDue: [], pastDue: [], currentDeadline: null },
      disabledReason: null,
      country: "US",
      defaultCurrency: "usd",
    });
    p.scriptAccount("acct_x", { chargesEnabled: false, disabledReason: "requirements.past_due" });
    const restricted = await p.retrieveConnectedAccount({ accountRef: "acct_x" });
    expect(restricted.chargesEnabled).toBe(false);
    expect(restricted.disabledReason).toBe("requirements.past_due");
  });

  it("createRefund is idempotent by key", async () => {
    const p = new FakePaymentProvider();
    const input = {
      accountRef: "acct_fake_1",
      paymentIntentRef: "pi_fake_1",
      refundApplicationFee: true,
      idempotencyKey: "rf_1",
      metadata: {},
    };
    const first = await p.createRefund(input);
    const second = await p.createRefund(input);
    expect(first.status).toBe("succeeded");
    expect(second).toBe(first);
  });

  it("parseWebhookEvent verifies a REAL HMAC and rejects tampering", () => {
    const p = new FakePaymentProvider();
    const { raw, signature } = p.webhookFor("payment_intent.succeeded", {
      paymentIntentRef: "pi_fake_1",
      accountRef: "acct_fake_1",
      status: "succeeded",
    });
    const evt = p.parseWebhookEvent(signature, raw, "connect");
    expect(evt.type).toBe("payment_intent.succeeded");
    expect(evt.accountRef).toBe("acct_fake_1");
    expect(evt.livemode).toBe(false);
    expect(evt.providerEventId).toMatch(/^evt_fake_/);

    // A tampered body no longer matches the signature.
    expect(() => p.parseWebhookEvent(signature, raw + " ", "connect")).toThrow(/signature/i);
    // A forged signature is rejected.
    expect(() => p.parseWebhookEvent("t=1,v1=deadbeef", raw, "connect")).toThrow();
  });

  it("records every stub call in the journal", async () => {
    const p = new FakePaymentProvider();
    await p.createCustomer({ accountRef: "acct_fake_1", metadata: {} });
    await p.createConnectedAccount({ country: "US", email: "a@b.co", metadata: {} });
    await p.createAccountOnboardingLink({ accountRef: "acct_fake_1", refreshUrl: "r", returnUrl: "u" });
    await p.detachPaymentMethod({ accountRef: "acct_fake_1", methodRef: "pm_fake_1" });
    await p.refundApplicationFee({ applicationFeeRef: "fee_1", amount: 100, idempotencyKey: "k" });
    const methods = p.journal.map((j) => j.method);
    expect(methods).toEqual([
      "createCustomer",
      "createConnectedAccount",
      "createAccountOnboardingLink",
      "detachPaymentMethod",
      "refundApplicationFee",
    ]);
  });
});
