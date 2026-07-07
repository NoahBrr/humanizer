# AeroOps API Standards

How every API route in `src/app/api/` is written. These standards describe
what the codebase actually does; anything not yet true is marked
**(aspirational — not yet enforced)**. Rules marked ⚖ are machine-enforced
by `tests/constitution.test.ts`.

The canonical route shape (see `src/app/api/import/run/route.ts`,
`src/app/api/dispatch/[id]/close/route.ts`):

```
authorize → zod-validate → load + org-scope check → engine call →
db write ($transaction where rows must agree) → recordAudit →
emitDomainEvent → JSON response
```

Business logic never lives in the route — routes validate, authorize, call
a `src/lib` engine, audit, and emit.

## REST conventions

| Rule | Practice |
|---|---|
| Verbs | `GET` read, `POST` create/action, `PATCH` partial update, `DELETE` remove |
| Resources | Plural nouns: `/api/leads`, `/api/invoices/[id]/payments` |
| Actions | Domain verbs as sub-resources when a state transition isn't CRUD: `/api/dispatch/[id]/release`, `/api/dispatch/[id]/close`, `/api/import/jobs/[id]/rollback` |
| State machines | Illegal transitions are 400 with the reason (`"Dispatch is not released"`), never silently coerced |
| Scoped lookups | Fetch with the org in the `where` clause and return 404 on miss — a cross-tenant id is indistinguishable from a nonexistent one |

## Route naming

| Namespace | Audience | Gate |
|---|---|---|
| `/api/*` | Tenant app + public API | `authorize(permission, { mutating })` |
| `/api/platform/*` | AeroOps staff only | `authorizePlatform([roles])` |
| `/api/developer/*` | Org admins managing keys/webhooks | `authorize(...)` |
| `/api/auth/*`, `/api/health`, `/api/demo-requests` | Public by design | Catalogued exceptions (see Authorization) |

File convention: one `route.ts` per resource path, dynamic segments in
brackets (`[id]`), params awaited (`const { id } = await params`).

## Versioning strategy

- `/api/v1/:path*` is a **rewrite** of `/api/:path*` (`next.config.ts`) —
  handlers live unversioned until a breaking change forks a v2
  implementation. There is exactly one implementation today.
- Public API follows SemVer intent: `/api/v1` is frozen once external
  consumers exist; breaking changes = new `/api/v2` handlers, never
  in-place mutation (PRODUCTION.md §9.53).
- API keys work identically on both paths because the key resolves through
  the same `authorize()` gate — v1 is a real public API, not a parallel
  implementation.

## Response formats

- JSON only, via `NextResponse.json()`. **No envelope** — the resource is
  keyed by name at the top level: `{ events }`, `{ invitation, inviteUrl }`,
  `{ dispatch, flightTime, total }`.
- Side-effect-only success: `{ ok: true }` (optionally with ids:
  `{ ok: true, requestId }`).
- Creation returns **201** (consistent across all 17 creating routes);
  reads and actions return 200.
- Secrets are returned exactly once, at creation: the full `aero_` key
  (`/api/developer/keys`) and the webhook secret (`/api/developer/webhooks`)
  are never retrievable again.

## Error formats

- Shape: `{ error: string }` with the appropriate status code.
- ⚖-adjacent rule from CONSTITUTION.md: **error strings tell the caller
  what to do next.** Examples in code: `"This API key is read-only — create
  a key with write scopes for mutations."`, `"The closeout could not be
  saved. Nothing was billed — please try again."`
- zod failures return `{ error: body.error.flatten() }` at 400 (the `error`
  field is an object in this one case).
- Status code usage as practiced:

| Code | Meaning here |
|---|---|
| 400 | Validation failure, unknown reference, illegal state transition |
| 401 | No session / invalid or revoked API key |
| 402 | Plan seat limit reached (`/api/invitations/accept`) |
| 403 | Missing permission, suspended org, read-only key/impersonation, module not enabled |
| 404 | Not found — including rows outside the caller's org |
| 409 | Duplicate (taken slug, existing account) |
| 429 | Rate limited |
| 500 | Unexpected failure; message states what was and wasn't persisted |

## Pagination

- No cursor/offset pagination exists today. List endpoints are **bounded
  queries**: a required or defaulted filter window plus a hard `take`
  (schedule events: date range + `take: 1000`; global search: `take: 4–5`
  per entity; inventory movements: latest 5).
- When an endpoint needs true pagination (audit log export, public API
  lists), use cursor pagination on the existing `[organizationId,
  createdAt]` indexes **(aspirational — not yet enforced)**. Do not add
  unbounded `findMany` calls in the meantime.

## Validation

- **zod at every boundary** (CONSTITUTION.md conventions). Every request
  body goes through `schema.safeParse(await req.json())`; failure is an
  immediate 400. No handler trusts `req.json()` raw.
- Schemas constrain aggressively: lengths (`max(200)`), enums from
  canonical lists (`z.enum(IMPORT_SOURCES...)`), row caps
  (`IMPORT_LIMITS.maxRows`), positive/integer numerics for meters and money
  inputs.
- Client-supplied org/tenant identifiers are **never** accepted —
  `organizationId` always comes from `session.organizationId`.

## Authentication

Two credentials, one resolution path (`src/lib/session.ts`):

| Credential | Mechanics |
|---|---|
| Browser cookie | NextAuth v5 JWT (credentials + TOTP challenge). `sessionVersion` mismatch kills stale JWTs ("log out all devices") |
| `Authorization: Bearer aero_...` | API key, **sha256-hashed at rest** (`ApiKey.keyHash @unique`); the Bearer header beats the cookie. Revoked keys 401. `lastUsedAt` updated fire-and-forget |

- Both resolve to the same `AppSession` shape; keys get
  `permissions = key.scopes` and, when `readOnly`, a synthetic read-only
  impersonation that blocks every `mutating` call.
- Platform staff are a separate identity table (`PlatformUser`);
  impersonation is an HMAC-signed, 60-minute cookie verified with
  `timingSafeEqual`.
- Session resolution goes through `getSession()` — never `auth()` directly.

## Authorization

- ⚖ **One gate.** Every route calls `authorize(permission, { mutating })`
  or `authorizePlatform(roles)` and returns the prebuilt error response:
  `const { session, error } = await authorize(...); if (error) return error;`
- `authorize()` checks, in order: session (401) → individual account (403)
  → suspended org (403) → read-only impersonation/key on mutations (403) →
  permission (403) → module gating by permission prefix
  (`billing.* / maintenance.* / reports.* / documents.*` require the org's
  plan/profile to include the module — 403).
- Exactly **two exception categories**, each allowlisted with a written
  reason in `tests/constitution.test.ts`:
  1. `PUBLIC_ROUTES` — public by design (NextAuth handler, health,
     register, pre-auth MFA check, invitation accept, demo requests).
  2. `SELF_SERVICE_ROUTES` — signed-in users acting on their own account
     (MFA, password, sessions, org create/join). The test still requires
     `getSession()` + a 401 path.
  Adding a route to either list without a reason fails the build.
- Permissions are data (`src/lib/permissions.ts`); routes check permission
  keys, never role names.

## Rate limiting

- `src/lib/rate-limit.ts`: **sliding-window, in-memory per instance**.
  `rateLimit(key, limit, windowMs)` returns
  `{ allowed, retryAfterS }`; keys are `purpose:${clientIp(req)}`
  (e.g. `register:1.2.3.4`, `org-create:...` at 3/hour).
- Applied to every public and self-service surface: register, mfa-check,
  invitation accept, invite-link redeem, join requests, org create, demo
  requests, leads intake, password change, AI ask.
- Rejections are 429 with an actionable message; `Retry-After` header set
  where implemented (register, mfa-check).
- The store swaps to Upstash Redis with the same interface when running
  multiple instances (PRODUCTION.md §3.15) **(aspirational — not yet
  enforced)**. Per-key limits against `SubscriptionPlan.apiRequestsPerDay`
  are likewise planned, not wired (PRODUCTION.md §3.14).

## Logging

- Structured logging via `src/lib/logger.ts`: JSON lines in production,
  `key=value` in dev; no dependencies. Sentry forwarding planned
  (PRODUCTION.md §13.5) **(aspirational — not yet enforced)**.
- **Every mutation is audited** via `recordAudit()` (`src/lib/audit.ts`):
  actor, org, dot-namespaced action (`dispatch.close`), entity, old/new
  values, IP, user agent. Audit failure never breaks the operation but is
  loudly logged. The audit log is immutable.
- Login attempts (success and failure) land in `LoginEvent`; webhook
  deliveries in `WebhookDelivery` per attempt, visible in Settings →
  Developers.
- Domain events go through `emitDomainEvent()` only; ⚖ `emitWebhook` is
  callable only inside `src/lib`.

## Idempotency

- No idempotency-key header exists today. Duplicate protection is
  **state-machine guards**: closing a dispatch requires `status ===
  "RELEASED"` (a replayed close is a 400), imports are explicit
  dry-run-then-commit with a rollback manifest.
- Outbound webhooks are signed (`X-AeroOps-Signature: sha256=<hmac-sha256
  hex of the body>`, plus `X-AeroOps-Event`); consumers deduplicate on
  their side; payload carries `{ event, organizationId, occurredAt, data }`.
- The **reference pattern for inbound idempotency** is the planned Stripe
  webhook handler (PRODUCTION.md §13.2): a `BillingEvent` table with
  `stripeEventId @unique` — idempotency by unique insert, payload retained
  for forensic replay **(aspirational — not yet enforced)**. New inbound
  webhook/payment surfaces must follow it.
- Client-facing idempotency keys for POSTs on `/api/v1` **(aspirational —
  not yet enforced)**.

## API documentation requirements

- The webhook event catalog is code (`WEBHOOK_EVENTS` in
  `src/lib/webhooks.ts` / `DOMAIN_EVENTS` in `src/lib/events.ts`) and ⚖
  must not drift: every registered event needs a live emit site, tested.
  The catalog surfaces to customers in Settings → Developers.
- The permission catalog (`src/lib/permissions.ts`) doubles as the API-key
  scope documentation — scope keys are permission keys.
- OpenAPI generation is staged on the roadmap (ARCHITECTURE.md known
  limitations) **(aspirational — not yet enforced)**. Until it lands: a new
  or changed route documents itself through its zod schema, its
  constitution-test entry (if excepted), and actionable error strings — and
  PR descriptions record the real requests used to verify it, including
  denial and cross-tenant paths.

## Related documents

- [CONSTITUTION.md](../../CONSTITUTION.md) — the enforced rules
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system shape and engines
- [SECURITY_STANDARDS.md](./SECURITY_STANDARDS.md) — auth, tenancy, secrets
- [ENGINEERING_HANDBOOK.md](../engineering/ENGINEERING_HANDBOOK.md) — how we work
- [PRODUCTION.md](../../PRODUCTION.md) — launch plan (§13 blockers, §16 env matrix)
