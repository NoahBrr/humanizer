import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { requireAuthSecret } from "@/lib/env";

/**
 * The impersonation cookie: an HMAC-signed, short-lived token that lets AeroOps
 * staff act as a customer user during an audited support session (ADR-023,
 * Priority 1). It is the single source of truth for "is this request an
 * impersonation, and if so, whose identity does it carry?" — read identically by
 * the session layer (to resolve the effective identity) and the audit layer (to
 * re-attribute actions to the real staff actor). Kept in its own lightweight
 * module so `audit.ts` can read it without pulling in the whole session graph.
 *
 * The payload carries the platform actor's id and label (so an audit row can be
 * written without a database lookup), the target customer, the org, the
 * ImpersonationSession row id (links every audit back to the support session),
 * read-only flag, and an expiry. Expiry alone stops impersonated access and
 * attribution — a decoded token past `exp` is treated as absent.
 */
export const IMPERSONATION_COOKIE = "aerops-impersonation";
const IMPERSONATION_TTL_MS = 60 * 60 * 1000;

export type ImpersonationPayload = {
  platformUserId: string;
  platformLabel: string;
  targetUserId: string;
  organizationId: string;
  sessionId: string;
  readOnly: boolean;
  exp: number;
};

export function impersonationTtlMs() {
  return IMPERSONATION_TTL_MS;
}

function sign(data: string) {
  return createHmac("sha256", requireAuthSecret()).update(data).digest("base64url");
}

export function encodeImpersonation(payload: ImpersonationPayload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function decodeImpersonation(value: string): ImpersonationPayload | null {
  const [body, mac] = value.split(".");
  if (!body || !mac) return null;
  const expected = sign(body);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: ImpersonationPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString()) as ImpersonationPayload;
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
  return payload;
}

/**
 * The active impersonation on the current request, or null. Because the cookie
 * is HMAC-signed with AUTH_SECRET and httpOnly, only platform staff who started
 * a session can produce a valid one — so a valid token present on a request IS
 * an impersonation session. Customer mutating routes only run under a resolved
 * impersonation (authorize() rejects a plain platform session), so the audit
 * layer can trust this to re-attribute staff actions. Never throws.
 */
export async function readActiveImpersonation(): Promise<ImpersonationPayload | null> {
  try {
    const raw = (await cookies()).get(IMPERSONATION_COOKIE)?.value;
    return raw ? decodeImpersonation(raw) : null;
  } catch {
    return null;
  }
}
