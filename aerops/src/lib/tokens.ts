import { createHash, randomBytes } from "crypto";

/**
 * Bearer-token utilities. AeroOps stores **only** the one-way hash of any
 * bearer token (invitation, invite link, API key); the raw value is shown
 * once at creation and never persisted (see DECISIONS.md ADR-020 and
 * SECURITY_STANDARDS.md). Look up by hashing the presented token and
 * matching the stored `tokenHash`/`keyHash` — the same shape the API-key
 * path has always used, now shared.
 *
 * sha256 is the correct primitive here (not bcrypt): these tokens carry
 * ≥192 bits of `randomBytes` entropy, so they are not brute-forceable and
 * need no salt or work factor — only irreversibility at rest, which a fast
 * hash provides while keeping per-request lookup cheap.
 */

/** A fresh URL-safe token with 24 bytes (192 bits) of entropy. */
export function generateToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

/** One-way hash of a raw token, for storage and lookup. Hex sha256. */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Mint a token: keep `raw` for one-time display, store `hash`. */
export function createToken(bytes = 24): { raw: string; hash: string } {
  const raw = generateToken(bytes);
  return { raw, hash: hashToken(raw) };
}
