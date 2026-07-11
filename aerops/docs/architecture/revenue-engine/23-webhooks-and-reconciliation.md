# Webhooks & Reconciliation

> **Status:** Proposed — Phase 8 Part 2 · **Date:** 2026-07-10 · **Lead roles:** Principal Payments Architect at Stripe; Security Engineer at Cloudflare; Reliability/SRE Engineer · **Part of:** Revenue Engine design set ([README](./README.md))

This document is Part 2 deliverable 8 (spec Part T): the inbound Stripe webhook design for Revenue Engine payments, and the reconciliation job that guarantees AeroOps and Stripe converge even when webhooks are late, lost, duplicated, or out of order. It finalizes the pipeline sketched in `09-payment-timing-and-collection.md` §2.10 and `01-revenue-engine-architecture.md` §TX-4.

**Posture, stated once:** the webhook is the *only* thing that marks money as moved. A client redirect is a UX hint, never a paid-marker (see §8, and the card/ACH flows in doc 21). Stripe test mode only; nothing here is deployed or exercised against live keys in this phase.

---

## 1. Purpose & scope

### In scope

- Endpoint design for the two Revenue Engine webhook endpoints (Connect events, platform-account events), their signing secrets, PUBLIC-route cataloguing, and separation from the future SaaS-billing endpoint (per `17-two-financial-systems.md`).
- The **store-then-process** pipeline: signature verification before any side effect, unique-insert of `PaymentProviderEvent`, idempotent reduce with status tracking, retry, and a dead-letter state.
- Tenant and connected-account context validation; quarantine on mismatch.
- The event-type handling matrix: every relevant Stripe event → local state transitions + side effects, each idempotent.
- Ordering hazards and the re-fetch-as-truth resolution strategy.
- Retry/backoff behavior toward Stripe's delivery policy; structured logging with no secrets or PII.
- The **reconciliation job**: detectors, execution model without queue infrastructure, report surface, and the auto-heal vs flag-for-human remediation matrix.

### Out of scope (see §12)

- What each downstream state transition *means* financially — owned by the sibling docs this reduces into: settlement/ledger (`12-revenue-allocation-and-reporting.md`), refunds/disputes (Part V doc), failure workflow (Part U doc), connected-account onboarding (Part P doc), card/ACH provider flows (doc 21).
- Final Prisma shapes — proposed here, ratified in `34-part2-database-additions.md`.
- The SaaS-billing webhook (`/api/webhooks/stripe`) — Stripe Billing territory, owned by `17-two-financial-systems.md` and PRODUCTION.md §13.2 / ADR-018. It shares the store-then-process *pattern* (its `BillingEvent` table is the same idiom) but shares no route, no secret, no table, and no code path with Revenue Engine payments.

---

## 2. Relationship to Part 1 docs (binding inputs) and Part 2 siblings

| Document | What this doc takes from it / adds to it |
|---|---|
| `13-database-model.md` §4.12 (canonical) | `PaymentProviderEvent` shape (`@@unique([provider, providerEventId])`, `payload Json`, `organizationId?` SetNull, `receivedAt`/`processedAt`/`processingError`, excluded from org-snapshot wipe/restore) — implemented exactly; this doc proposes **additive** columns for processing-status tracking (§6), final call in `34-part2-database-additions.md`. `PaymentAttempt` (`@@unique([provider, providerPaymentIntentId])`, guarded state machine), `ScheduledCharge`, `Refund`, `Dispute`, `ProviderPayout`, `ReconciliationException` — consumed as bound, no shape changes. |
| `09-payment-timing-and-collection.md` §2.10 | The five-step pipeline (verify → unique-insert → resolve tenancy locally → guarded reduce → post-commit side effects) is binding; this doc finalizes route names, per-endpoint secrets, the processing state machine, and the sweep. §2.4's stuck-attempt reconcile-then-proceed rule and §2.9's three-trigger runner pattern are reused verbatim for the reconciliation job. |
| `01-revenue-engine-architecture.md` §11, TX-4 | `/api/webhooks/stripe-connect` route group, threat-model rows (webhook forgery/replay), settlement transaction contents. |
| `03-revenue-review-lifecycle.md` | Review status transitions the reducers drive (Payment Processing / ACH Pending / Card Paid / Paid / Payment Failed / Disputed); only the payment engine writes those statuses. |
| `12-revenue-allocation-and-reporting.md` | `ReconciliationException` workflow (OPEN → RESOLVED\|IGNORED, required note, `revenue.reconciliation_manage`), R1–R7 invariants, payout matching, `RevenueSettings.reconciliationStalePaymentDays`/`reconciliationUnmatchedPayoutDays` defaults (5/7). The exception queue is the unmatched-items report — this doc adds detectors, never a parallel report mechanism. |
| `16-risks-and-open-decisions.md` D1 | Direct charges on Express connected accounts + `application_fee_amount` (finalized by the Part O ADR, doc 18). Consequence for webhooks: **payment objects live on connected accounts** → Connect endpoint; **application-fee objects live on the platform account** → platform endpoint. |
| ADR-032 / doc 09 §adapter | `parseWebhookEvent(signature, raw)` is the adapter seam; finalized here as `parseWebhookEvent(signature, raw, endpoint)` where `endpoint` selects the signing secret (§3.3 — an endpoint discriminator, not a new capability). |
| ADR-033 | No new idempotency mechanisms invented: unique event insert + guarded `updateMany` claims + deterministic attempt keys are the only tools used here. |
| Part 2 siblings | `17-two-financial-systems.md` (endpoint/secret separation), doc 18 (Connect ADR), doc 19 (Part P — `ConnectedAccount` model and onboarding statuses; this doc consumes its `providerAccountId ↔ organizationId` mapping), doc 20 (Part Q — payment methods/SetupIntents), doc 21 (Parts R/S — card/ACH flows, approval→payment; redirect-never-marks-paid), doc 22 (Part U — failure workflow the `payment_failed` reducer hands into), the Part V refunds/disputes doc, `34-part2-database-additions.md` (final Prisma shapes). Cross-links resolve in the Part 2 README refresh. |

Nothing in Part 1 is reinterpreted. Two Part 1 statements are *finalized* (not weakened): (a) doc 09 §2.10 named `STRIPE_WEBHOOK_SECRET` generically — this doc assigns per-endpoint secrets (§3.2) and leaves `STRIPE_WEBHOOK_SECRET` to the SaaS-billing endpoint per PRODUCTION.md; (b) doc 09 left the route naming to Part 2 — fixed here.

---

## 3. Endpoint design

### 3.1 Three endpoints, three secrets, two systems

Per `17-two-financial-systems.md`, the two financial systems never share a webhook surface. Within the Revenue Engine, direct charges on connected accounts (D1) split events across two Stripe delivery scopes, so the Revenue Engine itself needs two endpoints:

| Endpoint | System | Stripe registration | Signing secret (env) | Events |
|---|---|---|---|---|
| `POST /api/webhooks/stripe-connect` | Revenue Engine | Platform account, **"Listen to events on connected accounts"** | `STRIPE_CONNECT_WEBHOOK_SECRET` | Everything that happens on a school's connected account: `payment_intent.*`, `charge.refunded`, `charge.refund.updated`, `charge.dispute.*`, `payment_method.*`, `setup_intent.*`, `payout.*`, `account.updated`, `capability.updated`, `account.application.deauthorized`. Every delivery carries a top-level `account` (`acct_…`) field. |
| `POST /api/webhooks/stripe-platform` | Revenue Engine | Platform account, own-account events | `STRIPE_PLATFORM_WEBHOOK_SECRET` | The small set of Revenue Engine objects that live on the platform account under direct charges: `application_fee.refunded`, `application_fee.refund.updated`. Deliberately minimal. |
| `POST /api/webhooks/stripe` | SaaS billing (future) | Platform account, own-account events | `STRIPE_WEBHOOK_SECRET` | Stripe Billing subscription events → `BillingEvent`. **Not Revenue Engine.** Owned by `17-two-financial-systems.md` / PRODUCTION.md §13.2. Listed here only to fix the boundary: its handler never touches Revenue Engine tables, and the Revenue Engine handlers never touch `Organization.subscriptionStatus` or `BillingEvent`. |

Rationale for separate secrets even where Stripe would permit sharing an endpoint: secret rotation, blast-radius isolation, and environment separation are per-endpoint concerns; a compromised or misconfigured SaaS-billing secret must not grant any signature validity against tenant payment state (Part AB: provider environment separation).

Both Revenue Engine routes are thin wrappers over one shared ingest engine, `src/lib/provider-events.ts` (§4), tagged with the endpoint they came from.

### 3.2 Environment & flag behavior

| Condition | Behavior |
|---|---|
| `REVENUE_CHARGING=off` (default) | Routes exist but are inert: respond `503` with a static body, log a `warn`, store nothing. No Stripe endpoint should be registered in this state; a 503 (rather than 200) makes a stray registration loudly visible in the Stripe dashboard instead of silently swallowing events. |
| `REVENUE_CHARGING=test` but the endpoint's secret unset | Fail loudly at boot: `assertProductionEnv()` in `src/lib/env.ts` validates that `test` requires `STRIPE_CONNECT_SECRET_KEY`, `STRIPE_CONNECT_WEBHOOK_SECRET`, and `STRIPE_PLATFORM_WEBHOOK_SECRET` together (partial config is a boot error per ADR-032). If reached at request time anyway, respond `503`, store nothing. |
| Secret present | Full pipeline (§4). |
| `event.livemode = true` received | This phase has no live mode. Signature-verified live events are **stored and quarantined** (`QUARANTINED`, reason `LIVEMODE_IN_TEST_PHASE`), platform alert raised, never reduced. A forged unverifiable one dies at step 2 regardless. |

Secrets are env-only, never logged, never stored in a column (no `*secret`/`*token` columns exist in any payment model — Part 1 principle 8).

### 3.3 Route mechanics (first provider-payload PUBLIC routes in the codebase)

Order of operations inside each route handler — **verification precedes every side effect, including the insert**:

1. **Rate limit** — `rateLimit('stripe-connect:' + clientIp(req), 600, 60_000)` (per-endpoint key). Generous because Stripe legitimately bursts (batch charges → batch webhooks) and the limiter is in-memory per instance; its job is junk-flood damping, not security. Signature verification is the security boundary.
2. **Read the raw body** — `await req.text()` before any JSON parsing. Signature verification requires the exact raw bytes; Next.js App Router route handlers give us this directly (no body-parser middleware to fight). A static test asserts no `req.json()` call precedes `parseWebhookEvent` in these routes.
3. **Verify the signature** — `parseWebhookEvent(signature, raw, endpoint)` in `src/lib/stripe-connect.ts` (`stripe.webhooks.constructEvent` with the endpoint's secret, default 300 s timestamp tolerance — replay damping at the transport layer). Failure → `400`, structured log (`event: 'webhook.signature_failed'`, no body content), **nothing stored**. Missing signature header → same.
4. **Ingest** (§4): unique-insert, then bounded inline reduce, then respond.

**Constitution cataloguing:** both routes are added to `PUBLIC_ROUTES` in `tests/constitution.test.ts` with written reasons, e.g.:

```ts
"api/webhooks/stripe-connect/route.ts",  // Stripe Connect events: unauthenticated by
                                         // nature; signature-verified with
                                         // STRIPE_CONNECT_WEBHOOK_SECRET before any
                                         // side effect; rate-limited; inert unless
                                         // REVENUE_CHARGING=test.
"api/webhooks/stripe-platform/route.ts", // Stripe platform-account events
                                         // (application fees): same posture,
                                         // STRIPE_PLATFORM_WEBHOOK_SECRET.
```

**Response-code contract toward Stripe** (drives Stripe's retry machinery, §9):

| Situation | Response |
|---|---|
| Signature invalid / missing | `400` (Stripe retries; if it's an attacker, they get nothing) |
| Flag off / secret unset | `503` |
| Event stored (fresh or duplicate), regardless of reduce outcome | `200` |
| Storage itself failed (DB unavailable, insert error other than unique violation) | `500` — Stripe retries; the unique insert makes the retry safe |

**Simpler-workflow choice:** we return `200` once the event is durably stored even if the reduce fails, and own the retries via the sweep (§4.4) — rather than returning `500` to make Stripe redeliver. Stripe disables endpoints that fail persistently, which would take *all* schools' payment truth down because one event's handler has a bug; our own retry queue keeps the failure visible to platform staff in one place instead.

---

## 4. Store-then-process pipeline

### 4.1 Event processing state machine

`PaymentProviderEvent` gains an explicit processing status (additive columns, §6). Doc 13's binding semantics are preserved: `processedAt` is stamped exactly when processing reaches a terminal *handled* state, and duplicate-delivery idempotency keys off it.

```
             ┌────────────► PROCESSED    (reduce applied; processedAt set)
             │
RECEIVED ────┼────────────► IGNORED     (unhandled/irrelevant type; processedAt set)
             │
             ├──► RETRYING ──► PROCESSED | IGNORED | DEAD_LETTER
             │       ▲  │
             │       └──┘  (sweep re-runs the reduce, bounded attempts)
             │
             └────────────► QUARANTINED (tenancy/livemode violation; human-only exit)
```

| State | Meaning | Exit |
|---|---|---|
| `RECEIVED` | Stored, signature-verified, not yet reduced | Inline reduce (same request) or first sweep pass |
| `PROCESSED` | Reduce committed (including convergent no-ops on stale events) | Terminal |
| `IGNORED` | Event type not in the handling matrix, or precondition made it permanently irrelevant | Terminal |
| `RETRYING` | Reduce threw or a precondition was unmet (`processingError` records why); sweep retries | `PROCESSED`/`IGNORED`, or `DEAD_LETTER` after `maxProcessAttempts` (default 8) |
| `QUARANTINED` | Tenancy cross-check mismatch, connected-account resolution failure, or livemode violation | Human only: platform staff resolve the underlying cause, then explicitly requeue (audited) or close |
| `DEAD_LETTER` | Retry budget exhausted | Human only: fix handler/data, requeue (audited). A `ReconciliationException(FAILED_EVENT_PROCESSING)` is opened when a row enters this state |

`QUARANTINED` and `DEAD_LETTER` rows are never silently dropped: each opens/updates a `ReconciliationException` and raises a platform notification (§11.5).

### 4.2 Ingest sequence (per delivery)

Numbered; `[TX]` marks database transactions, `[ASYNC]` marks async hops, `[PROVIDER]` marks Stripe API calls (never inside a transaction — Part AB auto-reject).

1. Rate limit, raw body, signature verification (§3.3). Fail → 400, stop.
2. **[TX-A] Unique insert** of `PaymentProviderEvent` `{provider: STRIPE, providerEventId: event.id, type, payload, endpoint, connectedAccountId: event.account ?? null, livemode, apiVersion, processingStatus: RECEIVED}`. On unique-violation (`[provider, providerEventId]`): read the existing row — if `processedAt` set → respond `200` (recorded no-op; duplicate counter incremented in the run log); if not set → fall through to step 4 against the existing row (Stripe's redelivery becomes our retry).
3. Livemode guard: `livemode=true` → `[TX]` set `QUARANTINED`/`LIVEMODE_IN_TEST_PHASE`, open exception, respond `200` (we stored it; redelivering won't change our answer).
4. **Inline reduce with a time budget** (~5 s wall clock, well under Stripe's delivery timeout): run §4.3. If the budget would be exceeded (e.g. the reduce needs a provider re-fetch that is slow), leave the row `RECEIVED`/`RETRYING` for the sweep and respond.
5. Respond `200`.

### 4.3 Reduce sequence (per event; idempotent, re-runnable)

1. **Resolve connected-account context** (Connect endpoint): `event.account` must resolve to exactly one org via `ConnectedAccount.providerAccountId @unique` (model owned by the Part P doc / doc 34). No match → `QUARANTINED` (`UNKNOWN_CONNECTED_ACCOUNT`) + exception. Platform endpoint events resolve tenancy purely from the referenced local object.
2. **Resolve the local anchor from local references only** (doc 09 §2.10 step 3, binding): e.g. `PaymentAttempt` by `@@unique([provider, providerPaymentIntentId])`, `Refund` by `providerRefundId`, `Dispute` by `@@unique([provider, providerDisputeId])`, `PaymentMethodReference` by `@@unique([organizationId, provider, providerPaymentMethodId])`, `ConnectedAccount` by account id. `organizationId` is taken from the local row.
3. **Tenancy cross-check (must-match, never attribution):** the local row's `organizationId` must equal the org resolved from `event.account`, and where AeroOps set `metadata.organizationId` / `metadata.paymentAttemptId` at object creation, those must match too. Any mismatch → `QUARANTINED` (`TENANT_MISMATCH`) + exception + platform alert. **Never partially applied, never applied to "the closest org".** Under direct charges the connected-account holder controls object metadata — it is a cross-check, not a source of truth.
4. **Precondition check / ordering resolution** (§7): if the event implies a state the local machine hasn't reached, re-fetch the authoritative provider object `[PROVIDER]` (with the connected-account header) *before* opening the transaction, and fast-forward through the normal guarded machine first. If the event is *behind* local state → convergent no-op, mark `PROCESSED`.
5. **[TX-B] Guarded reduce transaction:** apply the transition(s) from the handling matrix (§5) via the same guarded `updateMany` claims the payment runner uses (`PROCESSING → SUCCEEDED` succeeds exactly once, etc.), write the dependent financial rows in the same transaction (settlement journal, `Payment`, `PlatformFee` earned-claim, …), and stamp the event: `updateMany WHERE id AND processedAt IS NULL SET processedAt, processingStatus = PROCESSED`. If the claim count is 0 anywhere, the transaction ends as a recorded no-op (another instance won the race) — still `PROCESSED`.
6. **[ASYNC] Post-commit side effects only:** `recordAudit` (system actor, §13), `emitDomainEvent` (`payment.succeeded` / `payment.failed` / etc. — fan-out only, never inbound truth, ADR-009), `Notification` rows per the Part AA doc.
7. On thrown error: `[TX]` `processingStatus = RETRYING`, `processingError` = safe message (no payload echo), `processAttempts++`, `lastProcessAttemptAt = now`. The sweep (§4.4) re-runs it.

Concurrency across instances is safe by construction: the unique insert serializes storage; the guarded claims and the `processedAt IS NULL` stamp serialize application. Two instances reducing the same event concurrently produce one applied transition and one recorded no-op.

### 4.4 The unprocessed-event sweep

A bounded pass (`limit` default 50, oldest first) over `PaymentProviderEvent WHERE processingStatus IN (RECEIVED, RETRYING)` re-runs §4.3 per row. Backoff is attempt-count-based (attempt *n* eligible after `2^n` minutes since `lastProcessAttemptAt`, capped at 6 h); after `maxProcessAttempts` (default 8) → `DEAD_LETTER` + exception. The sweep runs as detector D5 of the reconciliation job (§11) and also piggybacks on every payment-runner pass (doc 09 §2.9), so a stored-but-unprocessed event is retried even if Stripe never redelivers.

---

## 5. Event-type handling matrix

All handlers live in `src/lib/provider-events.ts` and are **pure-decision + guarded-write**: a pure function computes the intended transitions from the event and current local state (unit-testable with fixture JSON, no DB — repo testing standard), and a thin applier executes them via guarded claims. `E` = endpoint (`C` connect, `P` platform). Side effects marked ✉ (notification per Part AA doc), 📒 (ledger journal via `src/lib/ledger.ts`, same transaction), 🔔 (domain event, post-commit).

| Stripe event | E | Local anchor | State transitions (all guarded, same `[TX-B]`) | Side effects | Idempotency guard |
|---|---|---|---|---|---|
| `payment_intent.processing` | C | `PaymentAttempt` by intent id | Attempt `CREATED → PROCESSING` (`processingAt`); review → Payment Processing (card) / ACH Pending (`US_BANK_ACCOUNT`) per doc 09 §2.5 | ✉ ACH initiated/pending | Claim on attempt status |
| `payment_intent.succeeded` | C | `PaymentAttempt` | Attempt `PROCESSING → SUCCEEDED` (`settledAt`); create `Payment` (`paymentAttemptId @unique`); `ScheduledCharge → COMPLETED`; `PlatformFee ACCRUED → EARNED` (`earnedAt`); review → Card Paid (card, rolls to Paid per D4) / Paid (ACH); `Invoice` projection → PAID | 📒 settlement journal; ✉ receipt/payment succeeded; 🔔 `payment.succeeded` | Attempt claim + `Payment.paymentAttemptId @unique` + `PlatformFee` status claim |
| `payment_intent.payment_failed` | C | `PaymentAttempt` | Attempt `CREATED/PROCESSING → FAILED` (`failureCode`/`failureMessage` from `last_payment_error` / ACH return code — safe codes only, no raw message to students); `ScheduledCharge → FAILED`; review → Payment Failed. Retry scheduling & org failure policies: hand off to the Part U engine (doc 22) post-commit | ✉ payer + configured org roles; 🔔 `payment.failed` | Attempt claim |
| `payment_intent.requires_action` | C | `PaymentAttempt` | Off-session charge needs customer action (SCA/microdeposit). Attempt stays `PROCESSING` with the action recorded; doc 21 owns the customer-action flow. If the action expires, `payment_failed` follows | ✉ action required | No-op if already terminal |
| `payment_intent.canceled` | C | `PaymentAttempt` | Attempt `CREATED/PROCESSING → CANCELLED` (`cancelledAt`); `ScheduledCharge` per its machine | — | Attempt claim |
| `charge.refunded`, `charge.refund.updated` | C | `Refund` by `providerRefundId`; parent `Payment` via charge → intent → attempt | `Refund PROCESSING → SUCCEEDED` (or `→ FAILED` with reason). On success, in the same tx: refund reversal journal, REFUND allocation set, tax-reversal snapshot, platform-fee reversal per policy — mechanics owned by the Part V doc and docs 07/08/12; review → Partially Refunded / Refunded | 📒 reversal journal; ✉ refund issued; 🔔 refund event | Refund status claim; `Refund.adjustmentId @unique` already guarantees one execution record |
| `charge.dispute.created` | C | `Dispute` upsert by `@@unique([provider, providerDisputeId])`; payment via charge | Create `Dispute` (OPEN, amount, reason, `evidenceDueBy`, `openedAt`); review → Disputed; `Invoice` → DISPUTED | ✉ dispute opened (org roles + platform); 🔔 dispute event | Unique upsert |
| `charge.dispute.updated` / `closed` | C | `Dispute` | Status per provider mapping (`UNDER_REVIEW`, `WON`, `LOST`, `WARNING_CLOSED`; `resolvedAt`). LOST → funds-reversal handling per Part V doc | ✉ status change | Monotonic status guard |
| `payment_method.updated` / `.automatically_updated` | C | `PaymentMethodReference` | Refresh **allowlist metadata only** (brand, last4, expMonth/expYear, bankName) — card-account-updater changes land here | — | Plain update; convergent |
| `payment_method.detached` | C | `PaymentMethodReference` | `→ DETACHED`, `detachedAt`; never deleted | ✉ payment method required, if it was the default with open scheduled charges | Status claim |
| `setup_intent.succeeded` | C | `PaymentCustomer` + method via doc 20's flow | Create/activate `PaymentMethodReference` (`ACTIVE`, or `REQUIRES_VERIFICATION` for unverified ACH); consent record linkage per doc 20 | ✉ method saved | `@@unique([organizationId, provider, providerPaymentMethodId])` upsert |
| `setup_intent.setup_failed` | C | attempt context from metadata cross-check | No method row created; record for the payer surface | ✉ setup failed | No-op safe |
| `account.updated`, `capability.updated` | C | `ConnectedAccount` by `event.account` | **Doorbell only — never apply the payload:** re-fetch the Account `[PROVIDER]` pre-tx, then sync `chargesEnabled`/`payoutsEnabled`/requirements/status (Part P statuses) with a monotonic `lastStatusSyncAt` guard. If charges become disabled/restricted: pause the org's runner via the readiness gate, open `ReconciliationException(CONNECTED_ACCOUNT_RESTRICTED)` | ✉ platform + org owner on restriction; 🔔 account status event | `lastStatusSyncAt` monotonic guard |
| `account.application.deauthorized` | C | `ConnectedAccount` | `→ DISABLED`; all charging for the org stops (readiness gate fails closed) | ✉ platform alert (high) | Status claim |
| `payout.paid`, `payout.failed`, `payout.updated` | C | `ProviderPayout` upsert by `@@unique([organizationId, provider, providerPayoutId])` | Upsert payout (gross/fees/net, `arrivalDate`, status); enqueue payout-matching in the next reconciliation pass (doc 12 §payout matching; `PROCESSOR_FEES_EXPENSE` postings ride the matcher, not the webhook) | — | Unique upsert |
| `application_fee.refunded`, `application_fee.refund.updated` | P | `PlatformFee` via the fee's originating payment | Cross-check against the expected `PlatformFee` reversal written by the refund flow; mismatch → `ReconciliationException(FEE_MISMATCH)`. Never independently mutates fee amounts | — | Convergent check |
| anything else | C/P | — | `IGNORED`, `processedAt` stamped | — | — |

Two hard rules cut across every row:

- **Only the payment engine writes review statuses 6–13 and 15** (Part 1 binding) — the reducers *are* the payment engine's inbound half; no other code path may write these.
- **Amounts are never taken from the event for financial writes.** The event identifies the object; amounts come from the local snapshot (`ScheduledCharge.amount`, `Refund.amount`) and are cross-checked against the provider object — mismatch opens `AMOUNT_MISMATCH`, and the reduce stops without applying (flag-for-human, §11.4).

---

## 6. Data model additions (proposed; final shapes ratified in `34-part2-database-additions.md`)

### 6.1 `PaymentProviderEvent` — additive columns

Doc 13 §4.12's shape is kept exactly; these columns are added (all nullable or defaulted → additive migration, own migration for the enum per the two-step rule):

```prisma
enum ProviderEventEndpoint {
  CONNECT
  PLATFORM
}

enum ProviderEventStatus {
  RECEIVED
  PROCESSED
  IGNORED
  RETRYING
  QUARANTINED
  DEAD_LETTER
}

model PaymentProviderEvent {
  // ---- existing (13 §4.12, binding): id, provider, providerEventId, type,
  //      payload, organizationId?, receivedAt, processedAt, processingError ----

  // ---- Part 2 additive ----
  endpoint             ProviderEventEndpoint @default(CONNECT)
  connectedAccountId   String?               // top-level event.account (acct_…); opaque, not a secret
  livemode             Boolean               @default(false)
  apiVersion           String?
  processingStatus     ProviderEventStatus   @default(RECEIVED)
  processAttempts      Int                   @default(0)
  lastProcessAttemptAt DateTime?
  quarantineReason     String?               // LIVEMODE_IN_TEST_PHASE | UNKNOWN_CONNECTED_ACCOUNT | TENANT_MISMATCH

  @@index([processingStatus, receivedAt])    // the sweep queue
  @@index([connectedAccountId, receivedAt])  // quarantine triage / backfill watermark
}
```

Invariant (contract-tested): `processedAt IS NOT NULL ⟺ processingStatus IN (PROCESSED, IGNORED)` — doc 13's `processedAt`-keyed duplicate handling is unchanged. Table remains excluded from org-snapshot wipe/restore; `organizationId` remains SetNull and is only ever written from local-reference resolution.

### 6.2 `ReconciliationExceptionKind` — additive enum values

Doc 13's seven values stand; four are added (own migration before first writer):

```prisma
enum ReconciliationExceptionKind {
  // existing: MISSING_LOCAL_TRANSACTION, MISSING_PROVIDER_TRANSACTION,
  // AMOUNT_MISMATCH, FEE_MISMATCH, UNBALANCED_JOURNAL, ALLOCATION_MISMATCH,
  // STALE_PENDING_PAYMENT
  STATE_MISMATCH               // provider object state ≠ AeroOps state and forward fast-forward can't resolve it
  FAILED_EVENT_PROCESSING      // event entered DEAD_LETTER
  QUARANTINED_EVENT            // tenancy/livemode quarantine needing human review
  CONNECTED_ACCOUNT_RESTRICTED // charges/payouts disabled or requirements past due on an active org
}
```

### 6.3 `ReconciliationRun` — new (small)

Operational trust record: "when did reconciliation last run, and what did it find." One row per bounded pass per org.

```prisma
enum ReconciliationRunTrigger {
  PIGGYBACK        // tail of a payment-runner pass (bounded micro-pass)
  MANUAL           // org-initiated run
  PLATFORM_SWEEP   // platform-initiated cross-org pass (one row per org touched)
  SCHEDULER        // future Inngest adapter (D14 seam)
}

model ReconciliationRun {
  id             String                   @id @default(cuid())
  organizationId String
  trigger        ReconciliationRunTrigger
  startedAt      DateTime                 @default(now())
  finishedAt     DateTime?
  itemsScanned   Int                      @default(0)
  exceptionsOpened Int                    @default(0)
  eventsReplayed Int                      @default(0)
  autoHealed     Int                      @default(0)
  summary        Json?                    // per-detector counters; no PII, no payloads
  createdAt      DateTime                 @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId, startedAt])
}
```

### 6.4 Consumed (owned elsewhere — listed for the dependency, not redefined)

- `ConnectedAccount` (Part P doc / doc 34): this design depends on `providerAccountId String @unique` (globally unique — the tenancy resolver), `organizationId @unique` (one account per org), `chargesEnabled`/`payoutsEnabled Boolean`, Part P status enum, `lastStatusSyncAt DateTime?`.
- No shape changes to `PaymentAttempt`, `ScheduledCharge`, `Payment`, `Refund`, `Dispute`, `ProviderPayout`, `ReconciliationException` (beyond §6.2's enum values), per doc 13.

---

## 7. Ordering hazards & resolution strategy

Stripe does not guarantee delivery order. The design principle, applied uniformly: **the event is a doorbell; the re-fetched provider object is the truth.** Every reducer is *convergent* — applying any subset of events in any order, any number of times, ends at the same local state, because transitions are monotonic guarded claims and unmet preconditions trigger a provider re-fetch + fast-forward rather than a guess.

| Hazard | Example | Resolution |
|---|---|---|
| Success event lost/late, dependent event first | `charge.refund.updated` arrives while the attempt is still `PROCESSING` (no `Payment` row) | Precondition unmet → `[PROVIDER]` re-fetch the PaymentIntent pre-tx. Provider says succeeded → run the settlement reduce (same handler as `payment_intent.succeeded` — one code path) first, then the refund reduce, in order, each its own guarded tx. Provider not succeeded either → `RETRYING` (`PRECONDITION_UNMET`); the sweep re-checks |
| Stale event behind local state | `payment_intent.processing` delivered after `succeeded` was applied | Guarded claim finds no row in the expected prior state → convergent no-op, `PROCESSED` |
| Two updates race | `account.updated` v1 and v2 arrive reversed | Payload never applied: both trigger an Account re-fetch; `lastStatusSyncAt` monotonic guard makes the second sync a no-op |
| Child before parent | `charge.dispute.updated` before `.created` | Upsert-by-provider-id from the re-fetched Dispute object; `.created` later is a convergent no-op |
| Duplicate delivery | Same `evt_…` delivered twice (or once per instance) | `@@unique([provider, providerEventId])` + `processedAt` check → recorded no-op, `200` |
| Same underlying change, two events | `charge.refunded` and `charge.refund.updated` for one refund | Both reduce to the same guarded `Refund` claim; second is a no-op |
| Crash between provider call and local write (outbound side) | Attempt stuck in `CREATED` | Not a webhook problem to solve twice: doc 09 §2.4 reconcile-then-proceed, executed by detector D1 (§11) using the stored deterministic idempotency key |

Provider re-fetches always happen **before** the reduce transaction opens (`[PROVIDER]` never inside `[TX]`), always carry the connected-account header and a timeout, and are budgeted (at most one re-fetch chain per event per pass; exceeding budget → `RETRYING`).

---

## 8. No trust in client redirects

Binding restatement (Part AB auto-reject: "client redirect marks payment paid"):

- The card/ACH flows in doc 21 may use provider-hosted surfaces with `return_url`s. The return/redirect renders **"Payment submitted — confirming…"** UX only. It never writes `SUCCEEDED`, never creates a `Payment`, never moves a review to Card Paid/Paid.
- The only writers of paid-markers are (a) the webhook reducers (§5) and (b) the reconciliation job's fast-forward path (§11) — which is the same truth source, the provider API, through the same guarded machine and the same handler code.
- The pending UI polls local state (or listens on the existing SSE seam); it never asks Stripe from the client.
- Static test: the doc-21 return-route source must not reference the attempt/payment state machines' success transitions.

---

## 9. Retry & backoff toward Stripe

- Stripe retries failed deliveries with exponential backoff (up to ~3 days in live mode; a handful of retries in test mode) and **disables endpoints that fail for extended periods**. Our contract (§3.3) is engineered for that: `400` only for signature failures, `500` only for storage failures, `200` for everything stored — so sustained non-2xx means exactly "attacker" or "our database is down", both of which we want loud.
- Respond fast: the inline reduce is time-budgeted (§4.2); anything slow defers to the sweep. Target p99 route latency well under Stripe's delivery timeout; the unavoidable work before responding is signature verification + one insert.
- Stripe redelivery of a stored-but-unprocessed event is welcome (it re-runs the reduce) but not relied upon: the sweep retries on our schedule (§4.4) regardless.
- Endpoint health (delivery failures, disabled endpoints) is checked by detector D7 during platform reconciliation passes via the events list API watermark — a silent gap in received events is detected even if Stripe never tells us.

---

## 10. Structured logging (no secrets, no PII)

Every pipeline step logs through `src/lib/logger.ts` (JSON lines in production) with a fixed field set:

```
{ event: "webhook.received" | "webhook.signature_failed" | "webhook.stored"
        | "webhook.duplicate" | "webhook.reduced" | "webhook.quarantined"
        | "webhook.retrying" | "webhook.dead_letter",
  endpoint, providerEventId, type, connectedAccountId, organizationId?,
  outcome, attempt, durationMs }
```

**Never logged:** raw bodies or payload fragments, signature headers, secrets, client secrets, PANs/bank data (never present anyway — principle 8), customer names/emails (present in some Stripe payloads, e.g. `billing_details` — the reason payload content stays out of logs entirely), Stripe error message bodies (log the code, not the message). The forensic `payload Json` lives only in the `PaymentProviderEvent` row, readable only via platform permission (§13), excluded from org exports and org-snapshot restore. `processingError` and `ReconciliationException` fields store safe codes/summaries, not payload echoes.

---

## 11. The reconciliation job

### 11.1 Shape

One pure-core engine, `src/lib/reconciliation.ts` — `runReconciliation({ organizationId, detectors?, limit })`. Detection logic is pure (rows in → findings out; DB-free unit tests with fixtures); a thin executor loads bounded row sets, invokes detectors, and applies remediations. Bounded (`limit` default 50 items per detector per pass), per-item outcome reporting in the Import Center idiom — no silent row failures. Each pass writes one `ReconciliationRun` row.

### 11.2 Detectors

| # | Detects (spec Part T) | Query / method | Window (default) | Remediation |
|---|---|---|---|---|
| D1 | **Payment attempts without terminal webhook** | `PaymentAttempt` in `CREATED` older than 30 min (engine constant), or `PROCESSING` where card > 24 h / ACH > `RevenueSettings.reconciliationStalePaymentDays` (5) business-day-adjusted | per above | `[PROVIDER]` retrieve the PaymentIntent via stored intent id / deterministic idempotency key (doc 09 §2.4). Provider terminal → **auto-heal**: fast-forward through the normal reducer (settlement or failure — identical code path, identical side effects). Provider still pending → leave, re-check next pass. Provider unreachable/object missing → `STALE_PENDING_PAYMENT` exception |
| D2 | **Provider state ≠ AeroOps state** | Re-fetch provider objects for a bounded sample: attempts that went terminal in the lookback window, open `Refund`/`Dispute` rows | lookback 7 days | Local *behind* provider → auto-heal forward via reducers. Local *ahead* of provider, or amount/currency mismatch → `STATE_MISMATCH` / `AMOUNT_MISMATCH` exception — **never** rewind local state automatically |
| D3 | **Missing events** | `[PROVIDER]` events list API per connected account since the per-account watermark (max `receivedAt` per `connectedAccountId`, minus 10 min overlap); compare against stored `providerEventId`s | watermark + overlap | Feed missing events into the **same ingest pipeline** (§4.2 from step 2 — unique insert dedupes the overlap; a backfilled event is indistinguishable from a delivered one). Sustained gaps → platform alert (possible endpoint misconfiguration/disable) |
| D4 | **Duplicate events** | Structural no-ops counted at ingest | — | None needed (dedup is by constraint); counter surfaces in the run summary — an anomaly spike is an operator signal, not an exception |
| D5 | **Failed webhook processing** | The §4.4 sweep: `processingStatus IN (RECEIVED, RETRYING)` | backoff schedule | Re-run reduce; exhausted → `DEAD_LETTER` + `FAILED_EVENT_PROCESSING` exception + platform alert. `QUARANTINED` rows are listed (never auto-requeued) |
| D6 | **Connected-account restrictions** | `[PROVIDER]` re-fetch Account for orgs with charging enabled and `lastStatusSyncAt` older than 24 h; plus any `ConnectedAccount` already non-ENABLED with open `ScheduledCharge` rows | 24 h | Sync status (monotonic guard); restricted/disabled → `CONNECTED_ACCOUNT_RESTRICTED` exception, readiness gate fails closed (no new attempts), notify platform + org owner per Part P doc |
| D7 | **Payout & fee matching + structural invariants** | Doc 12's payout matcher (`ProviderPayout` vs settled payments; `reconciliationUnmatchedPayoutDays` = 7) and R1–R7 invariant checks (balanced journals, allocation sets, footing identity) | doc 12 | Owned by doc 12; hosted in the same runner so orgs have **one** reconciliation surface. Findings use the existing kinds (`MISSING_*`, `FEE_MISMATCH`, `UNBALANCED_JOURNAL`, `ALLOCATION_MISMATCH`) |

Ordering within a pass: D5 first (apply what we already have), then D1/D2 (targeted re-fetches), then D3 (gap backfill), then D6, then D7. Detectors needing provider list APIs (D2 sample, D3, D6) run only in MANUAL / PLATFORM_SWEEP / SCHEDULER passes — the piggyback micro-pass (Trigger 1) runs D5 + D1 only, keeping the post-commit path cheap and provider-call-free except for targeted stuck-attempt lookups.

### 11.3 Execution without queue infrastructure

Same three-trigger pattern as the payment runner (doc 09 §2.9 — one engine, interchangeable callers), honestly surfaced:

- **Trigger 1 — piggyback:** a bounded micro-pass (D5 + D1, `limit` 10) runs at the tail of every payment-runner pass and after every webhook batch that left `RETRYING` rows. Keeps the common case self-healing with zero operator action.
- **Trigger 2 — manual/API:** `POST /api/revenue/reconciliation-runs` (org-scoped, `revenue.reconciliation_manage`, `{mutating: true}`) — the "Reconcile now" button on the Revenue Dashboard's reconciliation panel. Platform counterpart: `POST /api/platform/payments/reconciliation-runs` (`authorizePlatform`, `{mutating: true}`, restricted-org scoping enforced) runs bounded cross-org sweeps, one `ReconciliationRun` row per org touched.
- **Trigger 3 — scheduler (deferred, D14):** when the Inngest adapter lands, it calls the identical engine hourly (D5/D1) and daily (full pass). No engine change; a new caller only.

**Honest limitation, surfaced in product:** until Trigger 3 exists, unattended time-based reconciliation does not happen; the piggyback covers active orgs, and quiet orgs are covered by platform sweeps. The dashboard shows "Last reconciled: {time}" from `ReconciliationRun` so nobody has to guess (north-star: an accountant should *see* freshness, not assume it).

### 11.4 Remediation matrix — auto-heal vs flag-for-human

| Class | Examples | Action |
|---|---|---|
| **Safe auto-heal** (forward-only, through the same guarded machines the reducers use; audited with system actor) | Local behind provider (missed success/failure); unprocessed event replay; missing-event backfill; account status sync; payment-method metadata refresh; duplicate no-ops | Applied automatically; counted in `ReconciliationRun.autoHealed`; every state change audited + notified exactly as if the webhook had arrived |
| **Flag-for-human** (anything ambiguous, backward, or financial-fact-touching) | Local ahead of provider; amount/currency/fee mismatch; quarantined tenancy mismatch; dead-letter events; live-mode event; disputes anomalies; account restricted | `ReconciliationException` (OPEN), notification to `revenue.reconciliation_manage` holders and/or platform staff; resolution requires the existing doc 12 workflow (required note, audited). **Auto-heal never edits financial snapshots, never rewinds a state machine, never deletes anything** |

### 11.5 Report surface

- **Org:** Revenue Dashboard → Reconciliation panel (gated `revenue.reconciliation_manage`): open exceptions grouped by kind with plain-language explanations and next actions, "Last reconciled" badge, "Reconcile now" button, recent run summaries. This *is* doc 12's unmatched-items report with the new kinds folded in — one queue, not two.
- **Platform:** Platform Console → Payments health view (new panel following the `organizations/[id]` panel idiom; permission keys coordinated with the Part P doc — read via `platform.billing.view`, sweep/requeue via a new mutating key, e.g. `platform.payments.operate`): quarantine queue, dead-letter queue, cross-org exception counts, per-org last-run freshness, event-ingest volume/duplicate counters. No payload contents shown by default; payload inspection is an explicit, audited action.
- **Machine:** each run's `summary Json` + structured logs; `reconciliation.exception_opened` domain event (already registered in Part 1) fires per opened exception.

---

## 12. Configuration surface

Zero org setup required (Part 1 principle 10). Everything below defaults sensibly; org-facing knobs already exist in Part 1 singletons.

| Level | Setting | Home | Default |
|---|---|---|---|
| Org | `reconciliationStalePaymentDays` | `RevenueSettings` (Part 1, exists) | 5 |
| Org | `reconciliationUnmatchedPayoutDays` | `RevenueSettings` (Part 1, exists) | 7 |
| Platform (env) | `STRIPE_CONNECT_WEBHOOK_SECRET`, `STRIPE_PLATFORM_WEBHOOK_SECRET` | env only; validated together with `STRIPE_CONNECT_SECRET_KEY` when `REVENUE_CHARGING=test` (`assertProductionEnv`) | unset (routes inert) |
| Platform (code constants, `src/lib/provider-events.ts` / `reconciliation.ts`) | inline reduce budget 5 s; sweep `limit` 50; `maxProcessAttempts` 8; backoff `2^n` min cap 6 h; stale `CREATED` 30 min; stale card `PROCESSING` 24 h; backfill overlap 10 min; account re-sync 24 h; D2 lookback 7 days | code, contract-tested | as listed |

No per-org webhook configuration, no org-visible secrets, no org-editable thresholds beyond the two existing `RevenueSettings` fields. **Simpler-workflow choice:** thresholds are code constants, not a settings screen — five pilot schools need reconciliation to *work*, not to be tuned; knobs move to config only when a real org needs a different value.

---

## 13. RBAC, approvals & audit

| Concern | Rule |
|---|---|
| Webhook routes | PUBLIC (catalogued, §3.3) — authorization is the signature. No session, no org context from the request; tenancy resolved per §4.3 only |
| Org reconciliation | `revenue.reconciliation_manage` (Part 1 key, unchanged): view queue, resolve/ignore exceptions (required note), trigger org runs |
| Platform surfaces | `authorizePlatform` + `platform.billing.view` (read); new `platform.payments.operate` key (data-only addition to `PLATFORM_PERMISSIONS`; mutating per the `.view` convention) for cross-org sweeps, quarantine requeue, dead-letter requeue. Restricted-org scoping (`restrictedOrgIds`) enforced on org-targeting platform routes (constitution-tested) |
| Payload inspection | Platform-only, explicit action, audited (`platform.payments.event_payload_viewed`) — payloads can contain customer PII |
| System actor | Webhook- and reconciliation-driven mutations audit with actor labels `system:stripe-webhook` / `system:reconciliation` (the doc 09 `system:payment-runner` convention), with `providerEventId` / `reconciliationRunId` in the audit metadata so any transition reconstructs without DB state |
| Audit actions | `revenue.provider_event_quarantined`, `revenue.provider_event_requeued` (human, mutating), `revenue.provider_event_dead_lettered`, `revenue.reconciliation_run` (trigger, counters), plus the existing `revenue.reconciliation_resolved`/`_ignored`. Every reducer state change also carries its domain-specific audit action (payment settled, refund succeeded, …) exactly as the outbound engine writes them |
| Impersonation | Read-only impersonation can view queues, never requeue/resolve (blocked at `authorize`, Part 1 binding) |
| AI | No AI pathway may requeue, resolve, or trigger reconciliation mutations (constitution rule 8) |

Approvals: none of this doc's operations are approval-gated (they move records toward provider truth, never money toward anyone); refund/dispute approvals stay in their owning docs.

---

## 14. Validation & business rules

1. **Verify-before-everything:** no parse, no insert, no log-of-content before signature verification succeeds (static source-scan test, dispatch-idempotency style).
2. **Store-before-process:** no reducer runs against an event that is not a `PaymentProviderEvent` row (backfilled events included).
3. **Local-references-only tenancy:** `organizationId` on the event row is written only from resolved local rows; `event.account` must map via `ConnectedAccount.providerAccountId @unique`; metadata is must-match only. Any disagreement → quarantine, whole-event; partial application is forbidden.
4. **One code path per truth transition:** webhook reducer, redelivery, sweep retry, backfill, and reconciliation fast-forward all execute the *same* handler functions. There is no second implementation of "mark this attempt succeeded."
5. **No provider calls inside transactions** (Part AB auto-reject); every provider call has a timeout and, where applicable, the stored deterministic idempotency key; a timeout leaves state for reconcile-then-proceed — never a synthesized failure, never a parallel attempt.
6. **Amounts from snapshots, never from events** (§5); currency must match the document currency (engine-enforced in-tx, Part 1 §2.3); mismatch → exception, no write.
7. **ACH is never instant:** no reducer maps `payment_intent.processing` to any paid status; only `succeeded` settles, and returns after settlement route through the Part V reversal flow — never by editing the settled `Payment` (Part 1 binding).
8. **Monotonic machines:** stale events are convergent no-ops; nothing ever rewinds automatically.
9. **Testing (Part AC):** reducers and detectors are pure functions tested with Stripe fixture JSON (no DB, no mocks of Prisma, no live credentials — repo standard); static scans assert PUBLIC_ROUTES entries, verify-before-store, and no-provider-call-inside-`$transaction`; replay/duplicate/invalid-signature/connected-account-mismatch tests come from fixtures through the pure core.

---

## 15. Failure modes & edge cases

| Failure | Behavior |
|---|---|
| DB down at delivery | `500`; Stripe retries; unique insert makes retries safe |
| Crash after insert, before reduce | Row stays `RECEIVED`; sweep or Stripe redelivery completes it |
| Crash mid-reduce | Transaction rolled back atomically (including the `processedAt` stamp); retry re-runs guarded claims |
| Handler bug on one event type | That event goes `RETRYING → DEAD_LETTER` + exception + alert; endpoint stays healthy (200s); other types unaffected |
| Stripe disables the endpoint (sustained failure) | D3 backfill detects the gap from the events list; platform alert; re-enable + backfill converges |
| Secret rotated | Old-secret deliveries fail signature (400) until rotation completes; Stripe's dual-secret rotation window recommended in the runbook; D3 covers any gap |
| Event for an org whose account was deauthorized | Anchor resolution fails or account is DISABLED → quarantine; no charging (readiness gate already closed) |
| Multi-instance concurrency | Unique insert + guarded claims + `processedAt IS NULL` stamp: one applier wins, others no-op. In-memory rate limiter per instance is acceptable (damping only) |
| Event flood (many schools' batch charges) | Inline reduce budget + `RECEIVED` backlog + bounded sweeps: ingestion never blocks on processing; backlog is visible in the platform health view |
| Payload containing unexpected PII | Never logged; stored payload is platform-gated; retention is open question Q1 |
| Refund event for a payment AeroOps never recorded | No local anchor → re-fetch chain fails to find a local attempt → `MISSING_LOCAL_TRANSACTION` exception (never a synthesized Payment) |
| Zero-total reviews | Complete without attempts (Part 1); no webhook involvement — reconciliation ignores them by construction |

---

## 16. UX notes

- **Dispatcher/DO:** payment statuses update automatically ("Card Paid — confirmed by processor at 14:02"). The pending state after a redirect says "confirming with the payment processor…", never "paid".
- **Accountant:** the Reconciliation panel speaks plain language: "1 payment is taking longer than expected (ACH, day 6 of ~4 business days) — we're checking with the processor automatically"; "Last reconciled 12 minutes ago". Every exception carries provenance links (review, invoice, attempt, provider reference) and a suggested next action. Freshness is shown, never assumed.
- **Owner:** trust comes from visible convergence — the dashboard's collected figures footnote "confirmed by processor webhooks; reconciled {time}".
- **Platform staff:** quarantine and dead-letter queues are worklists with one-click (audited) requeue after the cause is fixed; payload view is deliberate and audited.
- Status tones for any new surfaced states come from `STATUS_TONE` (single source); customer-facing failure text uses safe mapped messages (doc 22), never raw provider errors.

---

## 17. Out of scope for Part 2 / deferred to Part 3+

- **Scheduler-driven reconciliation** (Trigger 3, Inngest per D14) — engine ships Trigger-1/2-ready; the adapter is a new caller only.
- **Email notifications** for exceptions/receipts — in-app `Notification` rows only; no email adapter exists (Part AA doc owns the abstraction and the "do not claim email was sent" rule).
- **Dispute evidence workflow** beyond record/status/deadline tracking (Part V doc; spec says don't overbuild pre-pilot).
- **SaaS-billing webhook implementation** (`/api/webhooks/stripe`, `BillingEvent`) — separate system, separate schedule (`17-two-financial-systems.md`).
- **Multi-region/multi-instance hardening** (shared rate limiter, advisory-lock coordination of sweeps) — single-node posture documented; DB constraints already make concurrent processing safe, so this is an efficiency concern, not a correctness one.
- **Automated payout-to-ledger `PROCESSOR_FEES_EXPENSE` postings** — ride doc 12's payout matcher as designed there; only ingestion (`payout.*` upsert) lands with this doc.
- **Live mode** — `REVENUE_CHARGING` has no live value in this phase; the livemode quarantine guard (§3.2) is removed only by the Part 3 launch review with the approved threat model and legal/accounting sign-off.

---

## 18. Open questions

1. **Event payload retention (product owner + counsel):** `PaymentProviderEvent.payload` is kept for forensic replay and is excluded from org wipe/restore. Some payloads contain customer PII (names/emails in `billing_details`). Retain indefinitely, or prune payload bodies (keeping the envelope row) after N months (recommendation: 18 months, envelope kept forever)? Affects privacy posture and storage, not correctness.
2. **Alerting channel & SLA for quarantine/dead-letter (owner/ops):** with no email adapter and no pager, platform alerts are in-console + `Notification` rows. Is "seen at next platform-staff session, plus during any platform sweep" acceptable for the pilot, or does the pilot require an external alert hook (would pull a minimal ops-email/webhook adapter into Part 3 scope)?
3. **Platform sweep cadence pre-scheduler (ops staffing):** until Inngest lands, full reconciliation for quiet orgs happens only when platform staff run the sweep. Recommendation: a documented daily manual sweep in the pilot runbook. Confirm this is operationally staffed, or prioritize the scheduler adapter earlier in Part 3.
4. **`ProviderEventEndpoint` vs a second provider (architecture, low urgency):** the endpoint discriminator assumes Stripe's two delivery scopes. If a second provider ever lands, does the discriminator generalize (per-provider endpoint catalog) or does each provider get its own event table? Recorded so `34-part2-database-additions.md` can shape the enum with headroom; recommendation: keep the enum, one table per the existing `provider` column.
