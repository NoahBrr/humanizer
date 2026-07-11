import { createHmac } from "crypto";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const WEBHOOK_EVENTS = [
  "lead.created",
  "flight.closed",
  "aircraft.grounded",
  "invoice.paid",
  "schedule.cancelled",
  "maintenance.completed",
  "revenue_review.approved",
] as const;

/**
 * Fire-and-forget outbound webhooks. Payloads are HMAC-SHA256 signed
 * (X-AeroOps-Signature) with the subscription's secret; every attempt is
 * logged to WebhookDelivery for developer observability. Failures never
 * affect the operation that emitted the event.
 */
export async function emitWebhook(organizationId: string, event: string, payload: Record<string, unknown>) {
  try {
    const hooks = await db.webhook.findMany({ where: { organizationId, isActive: true, events: { has: event } } });
    if (hooks.length === 0) return;

    const body = JSON.stringify({ event, organizationId, occurredAt: new Date().toISOString(), data: payload });
    await Promise.all(
      hooks.map(async (hook) => {
        let statusCode: number | null = null;
        let success = false;
        let error: string | null = null;
        try {
          const signature = createHmac("sha256", hook.secret).update(body).digest("hex");
          const res = await fetch(hook.url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-AeroOps-Event": event, "X-AeroOps-Signature": `sha256=${signature}` },
            body,
            signal: AbortSignal.timeout(5000),
          });
          statusCode = res.status;
          success = res.ok;
          if (!res.ok) error = `HTTP ${res.status}`;
        } catch (e) {
          error = String(e).slice(0, 200);
        }
        await db.webhookDelivery.create({ data: { webhookId: hook.id, event, statusCode, success, error } });
        if (!success) logger.warn("webhook delivery failed", { event, url: hook.url, error });
      }),
    );
  } catch (e) {
    logger.error("webhook emit failed", { event, error: String(e) });
  }
}
