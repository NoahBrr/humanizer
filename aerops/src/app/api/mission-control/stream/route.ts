import { authorize } from "@/lib/session";
import { buildMissionControlSnapshot } from "@/lib/mission-control";

export const dynamic = "force-dynamic";

const TICK_MS = 5000;

/**
 * Mission Control live feed — Server-Sent Events. The wall never refreshes:
 * clients hold this connection open and receive a fresh snapshot every tick
 * (EventSource reconnects automatically after drops). Financial data is
 * included only when the viewer holds billing.view, so a TV signed in as a
 * dispatcher never shows receivables.
 */
export async function GET(req: Request) {
  const { session, error } = await authorize("notifications.view");
  if (error) return error;

  const opts = {
    organizationId: session.organizationId,
    modules: session.modules,
    businessProfiles: session.businessProfiles,
    canSeeFinance: session.permissions.has("billing.view"),
    canSeeCrm: session.permissions.has("students.manage"),
    canSeeCfi: session.permissions.has("instructors.view"),
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        try { controller.close(); } catch { /* already closed */ }
      };
      req.signal.addEventListener("abort", close);

      const push = async () => {
        if (closed) return;
        try {
          const snapshot = await buildMissionControlSnapshot(opts);
          if (!closed) controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`));
        } catch {
          close();
        }
      };

      await push();
      const timer = setInterval(push, TICK_MS);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
