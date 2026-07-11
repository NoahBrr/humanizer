/**
 * Revenue Engine charging configuration (doc 39 §3; ADR-032/037). Fail-closed
 * and TEST-MODE ONLY:
 *
 *  - `REVENUE_CHARGING` is "off" (default) or "test". There is NO "live" value
 *    in any phase — a value other than off/test throws.
 *  - "test" REQUIRES the three Connect/webhook secrets; a missing one throws.
 *  - A LIVE-prefixed key (rk_live_/sk_live_) under "test" throws — the guard
 *    that makes an accidental live charge structurally impossible.
 *  - "off" (or absent) with no secrets: silent, degraded — every charging
 *    surface falls back to manual invoice + offline recording. No throw.
 *
 * Secrets are read ONLY here and in the Stripe adapter; never logged, never
 * returned to a client, never persisted.
 */

export type ChargingMode = "off" | "test";

export function revenueChargingMode(env: NodeJS.ProcessEnv = process.env): ChargingMode {
  const raw = (env.REVENUE_CHARGING ?? "off").toLowerCase();
  if (raw === "off") return "off";
  if (raw === "test") return "test";
  throw new Error(`FATAL: REVENUE_CHARGING must be "off" or "test" (there is no live mode). Got "${env.REVENUE_CHARGING}".`);
}

function assertTestKey(name: string, value: string | undefined): string {
  if (!value) throw new Error(`FATAL: REVENUE_CHARGING=test requires ${name}.`);
  if (name === "STRIPE_CONNECT_SECRET_KEY") {
    if (value.startsWith("rk_live_") || value.startsWith("sk_live_")) {
      throw new Error(`FATAL: ${name} is a LIVE key but REVENUE_CHARGING=test. Live charging is not permitted in any phase.`);
    }
    if (!value.startsWith("rk_test_") && !value.startsWith("sk_test_")) {
      throw new Error(`FATAL: ${name} must be a test key (rk_test_ or sk_test_).`);
    }
  }
  return value;
}

export type ChargingSecrets = {
  connectSecretKey: string;
  connectWebhookSecret: string;
  platformWebhookSecret: string;
};

/**
 * Returns the validated test-mode secrets, or null when charging is off. Throws
 * (fail-closed) when mode is "test" but a secret is missing/live-prefixed.
 */
export function chargingSecrets(env: NodeJS.ProcessEnv = process.env): ChargingSecrets | null {
  if (revenueChargingMode(env) === "off") return null;
  return {
    connectSecretKey: assertTestKey("STRIPE_CONNECT_SECRET_KEY", env.STRIPE_CONNECT_SECRET_KEY),
    connectWebhookSecret: assertTestKey("STRIPE_CONNECT_WEBHOOK_SECRET", env.STRIPE_CONNECT_WEBHOOK_SECRET),
    platformWebhookSecret: assertTestKey("STRIPE_PLATFORM_WEBHOOK_SECRET", env.STRIPE_PLATFORM_WEBHOOK_SECRET),
  };
}

/** True only when charging is enabled AND all test secrets validate. */
export function chargingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return chargingSecrets(env) !== null;
}
