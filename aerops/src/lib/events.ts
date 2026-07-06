import { emitWebhook, WEBHOOK_EVENTS } from "@/lib/webhooks";
import { runMaintenanceForecast } from "@/lib/automations";
import { logger } from "@/lib/logger";

/**
 * The AeroOps domain event bus (Section 17). Everything that happens is an
 * event; producers emit once and never know who is listening. Subscribers —
 * outbound webhooks, workflow automations, and whatever comes next
 * (analytics, AI context, Mission Control push) — register here instead of
 * being called at every mutation site, so systems stay decoupled and adding
 * a consumer never touches domain code.
 *
 * Subscriber failures are isolated: one consumer crashing never affects the
 * operation that emitted the event, and never affects the other consumers.
 * This runs in-process today; the seam is exactly where a queue (SQS,
 * pg-boss) lands when delivery needs to survive restarts.
 */
export const DOMAIN_EVENTS = WEBHOOK_EVENTS;
export type DomainEvent = (typeof DOMAIN_EVENTS)[number];

export type DomainEventPayload = Record<string, unknown> & { aircraftId?: string };

type Subscriber = {
  name: string;
  handle: (organizationId: string, event: DomainEvent, payload: DomainEventPayload) => Promise<void>;
};

const subscribers: Subscriber[] = [
  {
    // Outbound webhooks: signed delivery to every registered endpoint.
    name: "webhooks",
    handle: (organizationId, event, payload) => emitWebhook(organizationId, event, payload),
  },
  {
    // Workflow automations: each checks its own org-level enable flag.
    name: "automations",
    handle: async (organizationId, event, payload) => {
      if (event === "flight.closed" && typeof payload.aircraftId === "string") {
        await runMaintenanceForecast(organizationId, payload.aircraftId);
      }
    },
  },
];

export async function emitDomainEvent(organizationId: string, event: DomainEvent, payload: DomainEventPayload) {
  await Promise.all(
    subscribers.map(async (s) => {
      try {
        await s.handle(organizationId, event, payload);
      } catch (e) {
        logger.error("event subscriber failed", { subscriber: s.name, event, error: String(e) });
      }
    }),
  );
}
