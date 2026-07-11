/**
 * Payment idempotency keys (doc 28 §"exactly-once", ADR-037). The key handed to
 * the provider is derived PURELY from durable local identifiers — the
 * ScheduledCharge id and the attempt number — never from a clock or random
 * source. Two properties follow:
 *
 *  1. A retry of the SAME attempt (same ScheduledCharge, same attemptNumber)
 *     reuses the SAME key, so the provider dedupes and never mints a second
 *     PaymentIntent — a crash between "provider charged" and "row written" costs
 *     nothing on replay.
 *  2. A NEW attempt (incremented number, e.g. after a decline) gets a NEW key,
 *     so a genuine re-charge is allowed. attemptNumber is serialized by the
 *     PaymentAttempt @@unique([scheduledChargeId, attemptNumber]) constraint.
 *
 * Keys are ≤255 chars (Stripe's limit) and contain only [a-z0-9_].
 */
export function chargeIdempotencyKey(scheduledChargeId: string, attemptNumber: number): string {
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) {
    throw new Error(`attemptNumber must be a positive integer, got ${attemptNumber}`);
  }
  return `sc_${scheduledChargeId}_a${attemptNumber}`;
}
