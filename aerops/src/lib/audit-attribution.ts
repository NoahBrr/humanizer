/**
 * Pure audit-attribution rule (ADR-023 / Priority 1), kept import-free of
 * server-only modules so the test suite exercises it directly (mirrors
 * session-rules.ts / platform-users.ts). `recordAudit` reads the impersonation
 * cookie and the request headers; this function makes the actual attribution
 * decision, so the security-critical "who is the real actor" logic is provable
 * without a database or a request context.
 */

export type AttributionInput = {
  actorUserId?: string | null;
  actorPlatformUserId?: string | null;
  impersonatedUserId?: string | null;
  impersonationSessionId?: string | null;
  actorLabel: string;
};

/** The minimal impersonation facts attribution needs (a subset of the cookie). */
export type ImpersonationContext = {
  platformUserId: string;
  platformLabel: string;
  sessionId: string;
};

export type Attribution = {
  actorUserId: string | null;
  actorPlatformUserId: string | null;
  impersonatedUserId: string | null;
  impersonationSessionId: string | null;
  actorLabel: string;
};

/**
 * Decide the recorded actor identities.
 *
 * Only a customer-attributed action with no explicit platform actor can be an
 * impersonated action (platform routes attribute themselves). When such an
 * action happens inside an active impersonation session, the real actor is the
 * staff member: they become `actorPlatformUserId`, the customer is preserved as
 * `impersonatedUserId`, the session is linked, and `actorUserId` is cleared so
 * no row implies the customer acted independently. Otherwise the explicit fields
 * pass through unchanged. Never emits cookie or token values — only ids/labels.
 */
export function computeAttribution(input: AttributionInput, imp: ImpersonationContext | null): Attribution {
  const impersonated = input.actorUserId && !input.actorPlatformUserId ? imp : null;

  if (impersonated) {
    return {
      actorUserId: null,
      actorPlatformUserId: impersonated.platformUserId,
      impersonatedUserId: input.actorUserId ?? null,
      impersonationSessionId: impersonated.sessionId,
      actorLabel: `${impersonated.platformLabel} (AeroOps · impersonating ${input.actorLabel})`,
    };
  }
  return {
    actorUserId: input.actorUserId ?? null,
    actorPlatformUserId: input.actorPlatformUserId ?? null,
    impersonatedUserId: input.impersonatedUserId ?? null,
    impersonationSessionId: input.impersonationSessionId ?? null,
    actorLabel: input.actorLabel,
  };
}
