import { db } from "@/lib/db";
import { getPaymentProviderAsync } from "@/lib/payment-service";
import { reduceAccountSync, deriveAccountStatus, type AccountFacts } from "@/lib/connected-account";

/**
 * Connected-account onboarding orchestration (doc 19, ADR-037). Thin service
 * over the provider adapter: it creates the Express account, mints a
 * Stripe-hosted onboarding link, and mirrors status back via the pure reducer.
 * The KYC/bank details are entered on Stripe's hosted surface — AeroOps never
 * sees or stores them (doc 13). Test mode only.
 */

export type OnboardingResult =
  | { status: "disabled" }
  | { status: "link"; url: string; accountRef: string };

/**
 * Start (or resume) onboarding for an org. Idempotent: an org has at most one
 * ConnectedAccount (organizationId @unique), so a repeat call reuses the
 * existing Express account and just issues a fresh link.
 */
export async function startOnboarding(input: {
  organizationId: string;
  email: string;
  returnUrl: string;
  refreshUrl: string;
  actorUserId: string;
  actorLabel: string;
  now: Date;
}): Promise<OnboardingResult> {
  const provider = await getPaymentProviderAsync();
  if (!provider) return { status: "disabled" };

  const existing = await db.connectedAccount.findUnique({ where: { organizationId: input.organizationId } });
  let accountRef = existing?.providerAccountId ?? null;

  if (!accountRef) {
    accountRef = await provider.createConnectedAccount({ country: "US", email: input.email, metadata: { organizationId: input.organizationId } });
    await db.connectedAccount.upsert({
      where: { organizationId: input.organizationId },
      create: {
        organizationId: input.organizationId, provider: "STRIPE", providerAccountId: accountRef, status: "PENDING",
        onboardingInitiatedAt: input.now, onboardingInitiatedByUserId: input.actorUserId, onboardingInitiatedByLabel: input.actorLabel,
      },
      update: {
        providerAccountId: accountRef,
        onboardingInitiatedAt: input.now, onboardingInitiatedByUserId: input.actorUserId, onboardingInitiatedByLabel: input.actorLabel,
      },
    });
  }

  const url = await provider.createAccountOnboardingLink({ accountRef, refreshUrl: input.refreshUrl, returnUrl: input.returnUrl });
  return { status: "link", url, accountRef };
}

export type SyncResult =
  | { status: "disabled" }
  | { status: "not_started" }
  | { status: "stale" }
  | { status: "synced"; accountStatus: string; chargesEnabled: boolean };

/** Pull the latest account state and reduce it into our projection. */
export async function syncConnectedAccount(organizationId: string, now: Date): Promise<SyncResult> {
  const provider = await getPaymentProviderAsync();
  if (!provider) return { status: "disabled" };

  const current = await db.connectedAccount.findUnique({ where: { organizationId } });
  if (!current?.providerAccountId) return { status: "not_started" };

  const snapshot = await provider.retrieveConnectedAccount({ accountRef: current.providerAccountId });
  const update = reduceAccountSync(
    { providerStateAsOf: current.providerStateAsOf, firstEnabledAt: current.firstEnabledAt, suspendedAt: current.suspendedAt, deauthorizedAt: current.deauthorizedAt },
    snapshot,
    now,
  );
  if (!update) return { status: "stale" };
  await db.connectedAccount.update({ where: { organizationId }, data: update });

  const facts: AccountFacts = {
    providerAccountId: snapshot.accountRef, chargesEnabled: snapshot.chargesEnabled, payoutsEnabled: snapshot.payoutsEnabled,
    detailsSubmitted: snapshot.detailsSubmitted, requirementsDue: snapshot.requirements, suspendedAt: current.suspendedAt, deauthorizedAt: current.deauthorizedAt,
  };
  return { status: "synced", accountStatus: deriveAccountStatus(facts), chargesEnabled: snapshot.chargesEnabled };
}
