import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, KeyRound, Webhook as WebhookIcon, BookOpen } from "lucide-react";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WEBHOOK_EVENTS } from "@/lib/webhooks";
import { formatDateTime } from "@/lib/utils";
import { DeveloperControls } from "./developer-controls";

export const dynamic = "force-dynamic";
export const metadata = { title: "Developers" };

const API_CATALOG = [
  ["GET /api/v1/schedule/events?start=&end=", "schedule.view", "List bookings in a window"],
  ["POST /api/v1/schedule/events", "schedule.create", "Create a booking (conflicts → 409 with suggestions)"],
  ["PATCH /api/v1/schedule/events/:id", "schedule.edit", "Move / resize / cancel (scope=series supported)"],
  ["POST /api/v1/dispatch/:id/release", "dispatch.release", "Pre-flight release (airworthiness enforced)"],
  ["POST /api/v1/dispatch/:id/close", "dispatch.close", "Closeout: bills, rolls meters, fires flight.closed"],
  ["PATCH /api/v1/aircraft/:id/status", "aircraft.ground", "Ground / return to line (fires aircraft.grounded)"],
  ["POST /api/v1/invoices/:id/payments", "billing.record_payments", "Record a payment (fires invoice.paid)"],
  ["PATCH /api/v1/leads", "students.manage", "Advance / convert CRM leads"],
  ["GET /api/v1/search?q=", "(scoped)", "Entity search across the organization"],
  ["POST /api/v1/ai/ask", "students.view", "Natural-language operational queries"],
] as const;

export default async function DevelopersPage() {
  const session = await getSession();
  if (!session!.permissions.has("settings.manage")) redirect("/dashboard");
  const organizationId = session!.organizationId;

  const [keys, hooks] = await Promise.all([
    db.apiKey.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } }),
    db.webhook.findMany({
      where: { organizationId },
      include: { deliveries: { orderBy: { createdAt: "desc" }, take: 5 } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div className="animate-fade-up space-y-4">
      <Link href="/settings" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Settings
      </Link>
      <PageHeader
        title="Developer Platform"
        description="Scoped API keys, signed webhooks, and the versioned public API — everything the web app uses, available to your integrations"
      />

      <DeveloperControls
        keys={keys.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes, readOnly: k.readOnly, revoked: !!k.revokedAt, lastUsedAt: k.lastUsedAt?.toISOString() ?? null }))}
        hooks={hooks.map((h) => ({ id: h.id, url: h.url, events: h.events, isActive: h.isActive }))}
        webhookEvents={[...WEBHOOK_EVENTS]}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5"><BookOpen className="h-4 w-4" /> API Reference (v1)</CardTitle>
            <CardDescription>
              Authenticate with <code className="rounded bg-muted px-1">Authorization: Bearer aero_…</code> — keys carry permission scopes and
              flow through the same authorization, module gating, and audit trail as signed-in users. Semantic versioning: breaking changes fork /api/v2.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {API_CATALOG.map(([endpoint, scope, desc]) => (
              <div key={endpoint} className="rounded-lg border border-border p-2 text-[11px]">
                <code className="font-semibold">{endpoint}</code>
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">{scope}</span>
                <p className="mt-0.5 text-muted-foreground">{desc}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5"><WebhookIcon className="h-4 w-4" /> Webhook Deliveries</CardTitle>
            <CardDescription>
              Payloads are signed <code className="rounded bg-muted px-1">X-AeroOps-Signature: sha256=…</code> with your endpoint secret. Every attempt is logged.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {hooks.length === 0 && <p className="text-xs text-muted-foreground">No webhooks registered yet.</p>}
            {hooks.flatMap((h) => h.deliveries.map((d) => (
              <div key={d.id} className="flex items-center justify-between text-[11px]">
                <span><code className="rounded bg-muted px-1">{d.event}</code> → {h.url.slice(0, 40)}…</span>
                <span className="flex items-center gap-2">
                  <Badge tone={d.success ? "green" : "red"}>{d.success ? `HTTP ${d.statusCode}` : d.error?.slice(0, 24) ?? "failed"}</Badge>
                  <span className="text-muted-foreground">{formatDateTime(d.createdAt)}</span>
                </span>
              </div>
            )))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5"><KeyRound className="h-4 w-4" /> Quick Start</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-[11px] leading-relaxed">{`# List this week's bookings with a scoped key
curl -H "Authorization: Bearer aero_..." \\
  "https://your-deployment/api/v1/schedule/events?start=2026-07-06T00:00:00Z&end=2026-07-13T00:00:00Z"

# Verify a webhook signature (Node)
const ok = crypto.timingSafeEqual(
  Buffer.from(header.replace("sha256=", ""), "hex"),
  crypto.createHmac("sha256", WHSEC).update(rawBody).digest());`}</pre>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Read-only keys are refused every mutation. OpenAPI export, SDKs, OAuth 2.0 apps, and the app marketplace build on these same primitives.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
