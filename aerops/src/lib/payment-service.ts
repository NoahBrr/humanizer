/**
 * Payment-provider factory + injection seam (doc 39 §2; ADR-032/037). This is
 * the single place the rest of the app resolves a `PaymentProvider`:
 *
 *  - Tests and the offline simulation inject a `FakePaymentProvider` via
 *    `__setPaymentProvider` (plain dependency injection — no `vi.mock`).
 *  - When `REVENUE_CHARGING=test` with valid Connect secrets (`chargingEnabled()`),
 *    a `StripeProvider` is lazily constructed via its async, dynamic-import
 *    factory — so the `stripe` SDK never enters the top-level module graph.
 *  - Otherwise there is **no provider**: callers get `null` and every charging
 *    surface degrades to manual invoice + offline recording (CLAUDE.md §9).
 *
 * The `StripeProvider` is a singleton once built; secrets never leave this module
 * or the adapter.
 */

import type { PaymentProvider } from "./payment-provider";
import { chargingEnabled, chargingSecrets } from "./payment-config";

let injected: PaymentProvider | null = null;
let cachedStripe: PaymentProvider | null = null;
let building: Promise<PaymentProvider | null> | null = null;

/** Test/sim only — inject a provider (or clear it with `null`). */
export function __setPaymentProvider(provider: PaymentProvider | null): void {
  injected = provider;
}

/** True when charging is on and all test secrets validate — the real adapter is usable. */
export function chargingActive(): boolean {
  return chargingEnabled();
}

/**
 * Async resolver — the primary entry point for real callers. Returns the injected
 * provider, else a lazily-built `StripeProvider` when charging is enabled, else
 * `null` (charging off → degrade gracefully). The real adapter is built once via
 * dynamic import and cached.
 */
export async function getPaymentProviderAsync(): Promise<PaymentProvider | null> {
  if (injected) return injected;
  if (!chargingEnabled()) return null;
  if (cachedStripe) return cachedStripe;
  if (!building) {
    building = (async () => {
      const secrets = chargingSecrets();
      if (!secrets) return null;
      const { StripeProvider } = await import("./stripe");
      cachedStripe = await StripeProvider.create(secrets);
      return cachedStripe;
    })().finally(() => {
      building = null;
    });
  }
  return building;
}

/**
 * Synchronous resolver: the injected provider, or an already-built real adapter,
 * else `null`. It never triggers the dynamic import itself (keeping the top level
 * SDK-free) — call `getPaymentProviderAsync()` first to warm the real adapter.
 * Charging off always yields `null`.
 */
export function getPaymentProvider(): PaymentProvider | null {
  if (injected) return injected;
  if (!chargingEnabled()) return null;
  return cachedStripe;
}

/** Test-only reset of the lazily-built real adapter (does not touch injection). */
export function __resetPaymentProviderCache(): void {
  cachedStripe = null;
  building = null;
}
