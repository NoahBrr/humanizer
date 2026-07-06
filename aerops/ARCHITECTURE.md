# AeroOps Architecture

How the platform is organized, how modules communicate, and how to build a
feature without breaking anything. Read this before your first PR; the
[README](./README.md) covers setup and demo logins.

## Shape

AeroOps is a single Next.js 15 (App Router) application backed by PostgreSQL
via Prisma. That is a deliberate stage-appropriate choice, not an accident:
the internal boundaries below are the future monorepo package seams
(`packages/scheduling`, `packages/maintenance`, …), and nothing crosses them
except through exported functions.

```
src/
  app/(app)/         Org-facing workspaces (dashboard, schedule, dispatch, …)
  app/platform/      Platform-staff admin (separate identity space)
  app/mission-control/  Full-screen live command center (outside the shell)
  app/(auth)/        Sign-in, invitations, public request forms
  app/api/           REST endpoints — every one goes through authorize()
  app/api/v1/*       Versioned public API (rewrite of the same handlers)
  lib/               THE ENGINE LAYER — all business logic lives here
  components/        UI: shell (nav/topbar/palette) + ui primitives
prisma/              Schema, migrations, demo seed
tests/               Vitest unit tests over the engine layer
```

## The rules (enforced, not aspirational)

1. **One authorization gate.** Every API route calls
   `authorize(permission, {mutating})` from `lib/session.ts`. It resolves the
   session (cookie or `Bearer aero_…` API key), scopes to the organization,
   checks suspension, permission, module gating, and read-only impersonation.
   No route checks permissions by hand.
2. **RBAC is data.** `lib/permissions.ts` is the catalog; role bundles and
   custom org roles reference it. UI, server pages, and APIs all gate from
   the same `session.permissions` set (`lib/rbac.ts` maps sections).
3. **Business logic lives in `lib/`, never in components or routes.**
   Routes validate (zod), authorize, call an engine, audit, emit events.
4. **Explainable engines.** Anything computed — conflicts, airworthiness,
   checkride readiness, fleet health, org health, insights, forecasts —
   returns its reasons alongside its answer. A number without a "why" is a
   bug.
5. **Organization scoping comes from the session**, never from client input.
   Cross-tenant queries are platform-admin routes only.
6. **Mutations are audited** (`recordAudit`) and the audit log is immutable —
   it is also the Mission Control command timeline.
7. **Canonical status colors** (`lib/status-colors.ts`) never change meaning.
   There is a test asserting this.

## Events

`lib/events.ts` is the domain event bus. Producers emit once:

```ts
await emitDomainEvent(orgId, "flight.closed", { aircraftId, ... });
```

Subscribers (outbound signed webhooks, workflow automations; next: analytics,
AI context) register in the bus — adding a consumer never touches domain
code. Subscriber failures are isolated and logged; they can never affect the
operation that emitted. The bus is in-process today; a durable queue slots in
behind `emitDomainEvent` without changing any call site.

Event vocabulary (also the webhook catalog): `lead.created`, `flight.closed`,
`aircraft.grounded`, `invoice.paid`, `schedule.cancelled`,
`maintenance.completed`.

## Real-time

Mission Control streams over Server-Sent Events
(`/api/mission-control/stream`): one snapshot builder
(`lib/mission-control.ts`) feeds every widget — no widget polls
independently. Snapshot sections are gated per viewer (module, business
profile, permission) server-side.

## Data

~55 Prisma models. Every org-owned record carries `organizationId` (scoped
indexes), location-aware where operational, soft-deletable where recoverable
(`deletedAt`), and audited on mutation. Normalized; computed values
(airworthiness, health, readiness) are derived at read time, never stored
and re-synced.

## Engines (the parts worth knowing)

| Engine | File | Answers |
|---|---|---|
| Scheduling conflicts | `lib/scheduling.ts` | can this booking exist, and if not, why + alternatives |
| Airworthiness | `lib/airworthiness.ts` | can this aircraft fly (enforced at dispatch release) |
| Work-order lifecycle | `lib/work-orders.ts` | which maintenance transitions are legal |
| Fleet health | `lib/fleet-health.ts` | 0–100 per aircraft, factor by factor |
| Org health | `lib/health-score.ts` | 0–100 per organization, six categories |
| Checkride readiness | `lib/readiness.ts` | is this student ready, factor by factor |
| Insights | `lib/insights.ts` | recommendations with why/data/confidence |
| Forecast | `lib/forecast.ts` | tomorrow's load + predicted conflicts |
| Automations | `lib/automations.ts` | org-toggleable workflow reactions to events |

## Security

NextAuth v5 (credentials + TOTP challenge, env-gated SSO), 12-char password
policy with breach list, sliding-window rate limits, sessionVersion
revocation (logout-all-devices), HMAC-signed impersonation cookies with
read-only enforcement, sha256-hashed API keys with permission scopes,
HMAC-SHA256-signed webhooks. The AI layer never mutates: dispatch, maintenance
approval, payments, and deletion always require a human through the
permissioned APIs.

## Testing

`npm test` — Vitest over the engine layer (`tests/`). The suite pins the
contracts that must never drift: state-machine legality, explainability
(factors sum to the score), the status-color meanings, RBAC catalog
integrity, TOTP/password/rate-limit behavior. Add a test when you add an
engine; routes are exercised end-to-end against the running app (see the
verification pattern in PR descriptions).

## Observability

`GET /api/health` (public, data-free) reports database reachability/latency,
uptime, and version for load balancers and status pages. Structured logging
via `lib/logger.ts`; webhook deliveries are recorded per attempt and visible
in Settings → Developers.

## Known limitations / roadmap

- In-process event bus and rate limiter → move behind a queue/Redis when
  horizontal scaling is needed (the seams are marked in the code).
- Adapters stubbed for production services: Stripe (billing), Twilio/SendGrid
  (SMS/email), Aviation Weather API (METAR/TAF), S3 (documents),
  ANTHROPIC_API_KEY enables the live AI narrator.
- Monorepo split, GraphQL facade, OpenAPI generation, background-job queue,
  and load tests are staged on the roadmap; the current boundaries were drawn
  so each lands without rewrites.
