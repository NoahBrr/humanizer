import { headers } from "next/headers";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export type AuditInput = {
  organizationId?: string | null;
  actorUserId?: string | null;
  actorPlatformUserId?: string | null;
  actorLabel: string;
  action: string; // dot-namespaced verb, e.g. "dispatch.close", "org.suspend"
  entityType?: string;
  entityId?: string;
  oldValue?: unknown;
  newValue?: unknown;
};

/**
 * Append to the immutable audit trail. Never throws — an audit failure must
 * not break the operation it describes — but it is loudly logged.
 */
export async function recordAudit(input: AuditInput) {
  try {
    const h = await headers();
    await db.auditLog.create({
      data: {
        organizationId: input.organizationId ?? null,
        actorUserId: input.actorUserId ?? null,
        actorPlatformUserId: input.actorPlatformUserId ?? null,
        actorLabel: input.actorLabel,
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
