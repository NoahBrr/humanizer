import { NextResponse } from "next/server";
import { ingestWebhookEvent } from "@/lib/payment-webhooks";

/**
 * Stripe Connect webhook receiver (spec Part L, doc 39 §8). PUBLIC by design:
 * it is authenticated by Stripe's HMAC SIGNATURE — verified inside
 * ingestWebhookEvent BEFORE any processing — not by a user session. There is no
 * authorize() here on purpose (catalogued in the constitution's PUBLIC_ROUTES).
 *
 * Store-then-process: the event is persisted (and deduped) before it is acted
 * on, so a duplicate delivery is a no-op and a transient race returns non-2xx so
 * Stripe retries. No org scope comes from the body — the org is resolved from
 * the SIGNED account id only. Test mode only.
 */
export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature") ?? "";
  const raw = await req.text();
  const result = await ingestWebhookEvent(signature, raw, "connect", new Date());

  switch (result.status) {
    case "invalid_signature":
      return NextResponse.json({ error: "invalid signature" }, { status: 400 });
    case "deferred":
      // Stored but not yet processed (e.g. the charge row hasn't landed) — ask
      // Stripe to retry; the event is durable so nothing is lost.
      return NextResponse.json({ received: true, status: "deferred" }, { status: 503 });
    default:
      // processed | duplicate | unmapped | ignored_no_provider → ack.
      return NextResponse.json({ received: true, status: result.status });
  }
}
