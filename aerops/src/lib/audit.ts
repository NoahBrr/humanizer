import { headers } from "next/headers";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { readActiveImpersonation } from "@/lib/impersonation";
import { computeAttribution } from "@/lib/audit-attribution";

export type AuditInput = {
  organizationId?: string | null;
  actorUserId?: string | null;
  actorPlatformUserId?: string | null;
  /** Set explicitly only by the impersonation start/end routes; customer routes
   *  never set these — they are derived centrally (see below). */
  impersonatedUserId?: string | null;
  impersonationSessionId?: string | null;
  actorLabel: string;
  action: string; // dot-namespaced verb, e.g. "dispatch.close", "org.suspend"
  entityType?: string;
  entityId?: string;
  oldValue?: unknown;
  newValue?: unknown;
};

/**
 * Append to the immutable audit trail. Never throws — an audit failure must not
 * break the operation it describes — but it is loudly logged.
 *
 * Impersonation attribution is centralized here (ADR-023 / Priority 1): every
 * affected customer route already records `actorUserId: session.userId`, and
 * during impersonation `session.userId` is the impersonated CUSTOMER. When a
 * customer-attributed action is written inside an active impersonation session,
 * the real actor is the platform staff member — so the entry is re-attributed:
 * the staff member becomes `actorPlatformUserId`, the customer is preserved as
 * `impersonatedUserId`, the support session is linked via `impersonationSessionId`,
 * and `actorUserId` is cleared so no row ever implies the customer acted
 * independently. This means all ~37 routes inherit correct attribution without
 * per-route changes; the fix lives in one place.
 */
export async function recordAudit(input: AuditInput) {
  try {
    const h = await headers();

    // Only a customer-attributed action (no explicit platform actor) can be an
    // impersonated action; platform routes set actorPlatformUserId themselves.
    // The attribution decision itself is a pure, unit-tested function.
    const imp =
      input.actorUserId && !input.actorPlatformUserId ? await readActiveImpersonation() : null;
    const attribution = computeAttribution(input, imp);

    await db.auditLog.create({
      data: {
        organizationId: input.organizationId ?? null,
        ...attribution,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        oldValue: input.oldValue === undefined ? undefined : JSON.parse(JSON.stringify(input.oldValue)),
        newValue: input.newValue === undefined ? undefined : JSON.parse(JSON.stringify(input.newValue)),
        ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip"),
        userAgent: h.get("user-agent")?.slice(0, 250),
      },
    });
  } catch (e) {
    logger.error("audit record failed", { action: input.action, error: String(e) });
  }
}
