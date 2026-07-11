import type { ConnectedAccountStatus, Prisma } from "@prisma/client";
import type { ProviderConnectedAccount } from "@/lib/payment-provider";

/**
 * Connected-account status + readiness engine (doc 19, ADR-037). The stored
 * ConnectedAccount.status is a PROJECTION derived here from provider-mirrored
 * facts (chargesEnabled/payoutsEnabled/detailsSubmitted/requirements) plus the
 * two sticky platform controls (suspendedAt, deauthorizedAt). It is recomputed
 * on every sync — the reducer is the ONLY writer of the mirrored facts.
 *
 * Two invariants this file protects:
 *   1. A charge is only ever attempted on an account that is genuinely able to
 *      accept one (`accountReadyForCharge`) — the financial gate.
 *   2. Provider facts are applied in provider-clock order (`providerStateAsOf`)
 *      so an out-of-order webhook can never resurrect a stale "enabled" over a
 *      newer "suspended".
 *
 * NO secrets or submitted requirement VALUES are stored — only requirement KEYS
 * and deadlines (doc 13). This file never reads a Stripe secret; onboarding I/O
 * goes through the PaymentProvider adapter.
 */

/** Requirement keys mirrored from the provider — never submitted values. */
export type RequirementsDue = {
  currentlyDue: string[];
  eventuallyDue: string[];
  pastDue: string[];
  currentDeadline: string | null;
};

/** The mirrored facts the status derivation reads. */
export type AccountFacts = {
  providerAccountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsDue: RequirementsDue | null;
  suspendedAt: Date | null;
  deauthorizedAt: Date | null;
};

/**
 * Derive the projected status (doc 19 §"derivation"). Order matters — the
 * sticky platform controls win over any provider fact, so a suspended or
 * deauthorized account can never present as chargeable.
 */
export function deriveAccountStatus(f: AccountFacts): ConnectedAccountStatus {
  if (f.suspendedAt) return "SUSPENDED";
  if (f.deauthorizedAt) return "DISABLED";
  if (!f.providerAccountId) return "PENDING";

  const pastDue = f.requirementsDue?.pastDue ?? [];
  const currentlyDue = f.requirementsDue?.currentlyDue ?? [];

  // Past-due requirements disable charging even if the flag lags.
  if (pastDue.length > 0) return f.chargesEnabled ? "REQUIREMENTS_DUE" : "RESTRICTED";
  if (f.chargesEnabled && f.payoutsEnabled && f.detailsSubmitted && currentlyDue.length === 0) return "ENABLED";
  if (f.chargesEnabled) return "REQUIREMENTS_DUE"; // can charge, more info wanted (eventually/currently due)
  if (f.detailsSubmitted) return "RESTRICTED"; // submitted but not yet enabled
  return "PENDING";
}

/**
 * The charge gate. An account may be charged only when the provider says
 * charges are enabled AND no platform control blocks it. REQUIREMENTS_DUE is
 * still chargeable (Stripe keeps charges on while non-urgent info is pending);
 * RESTRICTED/DISABLED/SUSPENDED/PENDING are not.
 */
export function accountReadyForCharge(f: AccountFacts): boolean {
  if (f.suspendedAt || f.deauthorizedAt) return false;
  if (!f.chargesEnabled) return false;
  const status = deriveAccountStatus(f);
  return status === "ENABLED" || status === "REQUIREMENTS_DUE";
}

/** Human explanation of why an account can't be charged — for onboarding UI. */
export function chargeBlockReason(f: AccountFacts): string | null {
  if (accountReadyForCharge(f)) return null;
  if (f.suspendedAt) return "Payments are suspended for this school by AeroOps.";
  if (f.deauthorizedAt) return "The payment account has been disconnected from AeroOps.";
  if (!f.providerAccountId) return "Payment onboarding has not been started.";
  if (!f.chargesEnabled) {
    const pastDue = f.requirementsDue?.pastDue ?? [];
    if (pastDue.length > 0) return "Stripe needs additional information before this school can accept payments.";
    if (!f.detailsSubmitted) return "Payment onboarding is incomplete.";
    return "This school's payment account is not yet enabled by Stripe.";
  }
  return "This school cannot accept payments yet.";
}

/**
 * Reduce a provider account snapshot into a ConnectedAccount update, guarded by
 * provider-clock order. Returns null when the snapshot is stale (its
 * providerStateAsOf is not newer than what we already have) so the caller skips
 * the write — the out-of-order webhook guard. `at` is our-clock (caller-passed,
 * keeps the engine deterministic); it stamps lastStatusSyncAt and the write-once
 * firstEnabledAt.
 */
export function reduceAccountSync(
  current: { providerStateAsOf: Date | null; firstEnabledAt: Date | null; suspendedAt: Date | null; deauthorizedAt: Date | null },
  snapshot: ProviderConnectedAccount,
  at: Date,
): Prisma.ConnectedAccountUpdateInput | null {
  // Out-of-order guard: never apply a snapshot at or before the watermark.
  if (snapshot.providerStateAsOf && current.providerStateAsOf && snapshot.providerStateAsOf <= current.providerStateAsOf) {
    return null;
  }

  const facts: AccountFacts = {
    providerAccountId: snapshot.accountRef,
    chargesEnabled: snapshot.chargesEnabled,
    payoutsEnabled: snapshot.payoutsEnabled,
    detailsSubmitted: snapshot.detailsSubmitted,
    requirementsDue: snapshot.requirements,
    // Sticky controls are AeroOps state, not provider state — preserve them.
    suspendedAt: current.suspendedAt,
    deauthorizedAt: current.deauthorizedAt,
  };

  const update: Prisma.ConnectedAccountUpdateInput = {
    providerAccountId: snapshot.accountRef,
    chargesEnabled: snapshot.chargesEnabled,
    payoutsEnabled: snapshot.payoutsEnabled,
    detailsSubmitted: snapshot.detailsSubmitted,
    requirementsDue: snapshot.requirements as unknown as Prisma.InputJsonValue,
    disabledReason: snapshot.disabledReason ?? null,
    country: snapshot.country ?? null,
    defaultCurrency: snapshot.defaultCurrency ?? null,
    businessType: snapshot.businessType ?? null,
    capabilities: (snapshot.capabilities ?? null) as Prisma.InputJsonValue,
    status: deriveAccountStatus(facts),
    providerStateAsOf: snapshot.providerStateAsOf ?? at,
    lastStatusSyncAt: at,
  };

  // firstEnabledAt is write-once — set only on the first true transition.
  if (snapshot.chargesEnabled && !current.firstEnabledAt) update.firstEnabledAt = at;

  return update;
}
