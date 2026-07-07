/**
 * Environment validation. AUTH_SECRET signs both NextAuth JWTs and the
 * impersonation cookie HMAC — a guessable value forges platform-staff
 * impersonation, so production fails closed: no fallback, no startup.
 * All AUTH_SECRET access goes through this module (statically enforced by
 * tests/auth-security.test.ts).
 */

/**
 * Development-only fallback, used exclusively when NODE_ENV !== "production"
 * and AUTH_SECRET is unset. Deliberately long enough to exercise the same
 * code paths as a real secret, and deliberately impossible to mistake for
 * one.
 */
export const DEV_ONLY_AUTH_SECRET = "aerops-dev-only-secret-never-production-0000000000000000";

/** The committed .env.example placeholder — must never reach production. */
const EXAMPLE_PLACEHOLDER = "dev-secret-change-in-production-9f8a7b6c5d4e3f2a1b0c";

const MIN_SECRET_LENGTH = 32;

export function isProduction(env: string | undefined = process.env.NODE_ENV) {
  return env === "production";
}

/**
 * Validate AUTH_SECRET for the current environment; returns the effective
 * secret. Throws (refusing startup / the request) when production is
 * misconfigured — never signs anything with a substitute in production.
 */
export function requireAuthSecret(
  value: string | undefined = process.env.AUTH_SECRET,
  env: string | undefined = process.env.NODE_ENV,
): string {
  if (isProduction(env)) {
    if (!value) {
      throw new Error(
        "FATAL: AUTH_SECRET is not set. AeroOps refuses to start in production without it. " +
          "Generate one with `openssl rand -base64 32` and set it in the deployment environment (see PRODUCTION.md §16).",
      );
    }
    if (value === EXAMPLE_PLACEHOLDER || value === DEV_ONLY_AUTH_SECRET) {
      throw new Error(
        "FATAL: AUTH_SECRET is set to a committed placeholder value. Generate a real secret with `openssl rand -base64 32`.",
      );
    }
    if (value.length < MIN_SECRET_LENGTH) {
      throw new Error(`FATAL: AUTH_SECRET is shorter than ${MIN_SECRET_LENGTH} characters. Generate one with \`openssl rand -base64 32\`.`);
    }
    return value;
  }
  return value || DEV_ONLY_AUTH_SECRET;
}

/**
 * Startup gate, called from instrumentation.ts when the server boots.
 * Kept separate from requireAuthSecret so future required-in-production
 * variables (PRODUCTION.md §16) validate in one place.
 */
export function assertProductionEnv() {
  requireAuthSecret();
}
