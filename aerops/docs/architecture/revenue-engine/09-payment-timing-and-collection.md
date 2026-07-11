# Payment Timing & Collection

> **Status:** Proposed — Phase 8 Part 1 · **Date:** 2026-07-10 · **Lead roles:** Principal Payments Architect at Stripe; Reliability/SRE Engineer; SaaS Revenue Operations Architect · **Part of:** Revenue Engine design set ([README](./README.md))

This document designs **when and how an approved Revenue Review turns into money**: the org-configurable payment timing policies (spec Part I), the Payment section of the Revenue Review (spec Part B), payment identity and saved Payment Methods (`PaymentCustomer` / `PaymentMethodReference`), the `PaymentAttempt` lifecycle including ACH windows, idempotency end-to-end, and failure handling that honors principle 4 (no running balances) and principle 8 (no raw payment credentials).

**Hard boundary for Part 1:** this is design only. The Stripe Connect account model, platform-fee mechanics, and any live charging are **finalized in Part 2**. This document defines the provider-agnostic interface and the constraints Part 2 must satisfy: Stripe **test mode only**, nothing deployed, no production email, charging inert behind an env flag that defaults off.

---

## 1. Purpose & scope

### In scope

- The eight payment timing policies from Part I, with per-org defaults and per-review snapshots: charge immediately after approval (default), same-day batch, nightly batch, weekly batch, manual charge, manual invoice, ACH-only batch, custom future date.
- Snapshot semantics: the timing policy, resolved Payment Method, amount, and currency are frozen on the `ScheduledCharge` at approval; payer identity is frozen on the Revenue Review (`RevenueReview.payerId`/`billToLabel`/`billToPayerType`) and the Invoice (`payerId`/`billToLabel`), per `13-database-model.md` §4.4/§4.2.2. Changing organization policy later never alters an already-approved review.
- Payment readiness signals surfaced on the Revenue Review before approval (payer present, method on file, method/policy compatibility, warnings).
- `PaymentCustomer` and `PaymentMethodReference`: provider references and safe display metadata only. PCI stance: SAQ-A posture — card and bank capture happens exclusively on provider-hosted surfaces; PAN, CVV, bank account/routing numbers, raw payment tokens, and Stripe secret keys never enter AeroOps application data (spec principle 8, ADR-018, ADR-020).
- `PaymentAttempt` lifecycle (created → processing → succeeded/failed), retry policy, ACH pending/returned windows, and the mapping onto Revenue Review statuses **ACH Pending** and **Payment Failed**.
- Idempotency: exactly-once charging of a dispatch, per-approval idempotency keys, unique provider event IDs, idempotent webhook processing.
- Failure handling: a failed payment produces a per-invoice **Amount Due**, derived at read time — never a stored running balance (principle 4).
- Batch execution designed to work **without a queue**, because none exists today (audit finding: no queue, cron, or worker in the codebase; the in-process event bus and API-driven bounded ticks are the only execution seams; Inngest is planned but not provisioned).

### Out of scope (see §9)

Stripe Connect onboarding and fee splits, refund/dispute mechanics, dunning, payer portal payments, receipts by email, and the durable scheduler are Part 2–3 or sibling-doc territory.

### What exists today (audit grounding)

- Payments are manual records: `POST /api/invoices/[id]/payments` (`billing.record_payments`) creates a `Payment` row, flips `Invoice.status`, and **increments `Student.accountBalance`** — the exact running-balance pattern principle 4 retires. `Payment` has no status machine, no idempotency key, and `onDelete: Cascade` from `Invoice` (a financial record can be cascaded away).
- There is no Stripe SDK, no inbound webhook route, no provider customer/method models, and no currency column anywhere (`formatCurrency` hardcodes USD).
- The proven idempotency idiom is the dispatch-close guarded `updateMany` claim (`status: "RELEASED"` → `CLOSED`, `count === 0` aborts), regression-locked by `tests/dispatch-idempotency.test.ts`. This design reuses that shape for every money-moving state transition.
- The mandated inbound-idempotency pattern is the planned `BillingEvent` unique-insert table (PRODUCTION.md §13.2; API_STANDARDS.md names it the reference for all new inbound webhook/payment surfaces). That table belongs to the **platform subscription** money system; the Revenue Engine gets its own equivalent (§4.6) because ARCHITECTURE.md §13 forbids conflating the two money systems.

---

## 2. How it works — workflows and state machines

### 2.1 The collection pipeline

```
Revenue Review approved  ("Approve Revenue Review and charge the saved payment method")
        │  — one DB transaction: review locked, Invoice locked, ScheduledCharge created
        │    (policy + method + amount + currency snapshotted; payer frozen on the review; NO provider calls)
        ▼
ScheduledCharge  SCHEDULED / AWAITING_MANUAL
        │  — post-commit: immediate policy triggers the payment runner now;
        │    batch policies wait for runAfter; manual policies wait for a human
        ▼
Payment runner claims the charge  (guarded updateMany SCHEDULED→PROCESSING)
        │  — creates PaymentAttempt, calls provider adapter OUTSIDE any DB tx,
        │    Stripe idempotency key = attempt's idempotencyKey
        ▼
PaymentAttempt  CREATED → PROCESSING → SUCCEEDED | FAILED
        │                     │
        │   card: seconds     │   ACH: ~4 business-day pending window
        ▼                     ▼
SUCCEEDED: Payment row created (1:1 with attempt), Invoice PAID,
           Review → Card Paid (card; rolls to Paid per 16-risks D4) / Paid (ACH),
           receipt notification, `payment.succeeded` emitted
FAILED:    failureCode recorded, Review → Payment Failed,
           invoice keeps a derived Amount Due, retry per policy,
           `payment.failed` emitted
```

No provider call ever executes inside a database transaction (ADR-011; spec: operational closeout and approval must not wait for Stripe). The approval transaction commits first; charging is post-commit work.

### 2.2 Payment timing policies (Part I)

Org-level default with optional per-review override at approval time (§3). `runAfter` is computed **at approval** in the organization's `timeZone` and frozen on the `ScheduledCharge`.

| Policy | Enum value | `runAfter` computed at approval | Review status after approval |
|---|---|---|---|
| Charge immediately after approval **(default)** | `IMMEDIATE_ON_APPROVAL` | `now` — runner invoked post-commit | Payment Processing (card) / ACH Pending (bank) |
| Same-day batch | `SAME_DAY_BATCH` | today at `sameDayBatchHourLocal` (default 17:00); if already past, `now` (charges on the next runner pass, still the same day) | Payment Scheduled |
| Nightly batch | `NIGHTLY_BATCH` | next occurrence of `nightlyBatchHourLocal` (default 02:00) | Payment Scheduled |
| Weekly batch | `WEEKLY_BATCH` | next `weeklyBatchDay` at `weeklyBatchHourLocal` (default Monday 02:00) | Payment Scheduled |
| Manual charge | `MANUAL_CHARGE` | none — `AWAITING_MANUAL`; an authorized user initiates the charge | Payment Scheduled |
| Manual invoice | `MANUAL_INVOICE` | none — no charge planned; Invoice `OPEN` with `dueAt = approval + manualInvoiceNetDays` | Approved, with Amount Due |
| ACH-only batch | `ACH_ONLY_BATCH` | next batch per `achBatchCadence` (nightly or weekly), restricted to bank-account methods | Payment Scheduled |
| Custom future date | `CUSTOM_DATE` | approver-selected date at `nightlyBatchHourLocal`, bounded by `customDateMaxDays` (default 30) | Payment Scheduled |

**Snapshot rule (binding):** the effective policy, the resolved `PaymentMethodReference`, the invoice's locked total, and the currency are written to the `ScheduledCharge` row inside the approval transaction; payer identity is frozen at the same moment on the Revenue Review (`RevenueReview.payerId`/`billToLabel`/`billToPayerType`) and the Invoice (`payerId`/`billToLabel`), per `13-database-model.md` §4.4/§4.2.2 — the `ScheduledCharge` carries no payer columns. The `ScheduledCharge` is 1:1 with the Revenue Review and write-once for those fields — this is how "payment timing must be snapshotted onto the approved review" is satisfied. Editing `OrgPaymentPolicy` afterward affects only future approvals. These snapshot columns are point-in-time financial facts, not computed caches — the ADR carve-out from DATABASE_STANDARDS' derive-at-read-time rule is recorded in the design set's ADR proposal (see the architecture doc, `01-architecture.md`).

### 2.3 ScheduledCharge state machine

One `ScheduledCharge` per approved Revenue Review (`revenueReviewId @unique`) — created for **every** policy including `MANUAL_INVOICE`, so there is exactly one collection anchor per review regardless of path.

```
            ┌────────────┐   runAfter reached, runner claims   ┌────────────┐
approval ──►│ SCHEDULED  │ ───────────────────────────────────►│ PROCESSING │
            └────────────┘                                     └─────┬──────┘
            ┌───────────────┐  "Charge now" (revenue.charge)         │
approval ──►│AWAITING_MANUAL│ ────────────────────────────────►──────┤
            └───────────────┘                                        │
                                              attempt SUCCEEDED  ────┼──► COMPLETED
                                              attempt FAILED     ────┼──► FAILED
                                                                     │
   FAILED ──(auto-retry: runAfter=next retry slot)──► SCHEDULED      │
   FAILED ──(manual retry claim)────────────────────► PROCESSING     │
   any non-terminal ──(review voided / charge cancelled)──► CANCELLED
   AWAITING_MANUAL/FAILED ──(invoice settled by recorded offline payments)──► COMPLETED
```

- Every transition into `PROCESSING` is a guarded `updateMany` claim (`where: { id, status: { in: [...] } }`, `count === 0` → 409 "Charge already in progress or completed — refresh to see its current state"). This is the same-shape idempotency guard as dispatch close.
- `COMPLETED` means the invoice's Amount Due reached zero (charge succeeded, or offline payments recorded through the existing payments route settled it). Offline settlement is only reachable while no attempt is in flight: recording an offline payment against an invoice whose `ScheduledCharge` has a `PaymentAttempt` in `CREATED` or `PROCESSING` is refused with a 409 (§5.1.8) — this closes the double-collection window between the automated pipeline and offline recording.
- Only `status`, `runAfter` (retry slots), `attemptCount`, and `lastAttemptId` ever mutate after approval. Policy/method/amount/currency snapshot fields are write-once; the single permitted correction is re-pointing `paymentMethodReferenceId` while in `FAILED` or `AWAITING_MANUAL`, audited with before/after (§6). Historical attempts always preserve the method actually used.

### 2.4 PaymentAttempt state machine

Append-only trail: one row per charge try, never updated except along its own state machine, mirroring the `InventoryMovement` "every change, forever" idiom.

```
CREATED ──► PROCESSING ──► SUCCEEDED
   │             │
   │             └───────► FAILED   (decline, ACH return while pending)
   └────► FAILED  (provider rejected the request synchronously)
CREATED/PROCESSING ──► CANCELLED  (charge cancelled before provider confirmation)
```

| State | Meaning | Timestamps |
|---|---|---|
| `CREATED` | Row written by the claiming transaction; provider call not yet confirmed | `createdAt` |
| `PROCESSING` | Provider accepted the PaymentIntent; awaiting settlement. Cards pass through in seconds; **ACH sits here for the pending window (typically ~4 business days)** | `processingAt` |
| `SUCCEEDED` | Provider confirmed settlement/capture. A `Payment` row is created 1:1 (`Payment.paymentAttemptId @unique`) | `settledAt` |
| `FAILED` | Decline or ACH return; `failureCode`/`failureMessage` recorded (e.g. `card_declined`, `insufficient_funds`, ACH `R01`) | `failedAt` |
| `CANCELLED` | Charge withdrawn before confirmation (review voided while scheduled, operator cancel) | `cancelledAt` |

**Stuck-attempt rule (Reliability):** an attempt in `CREATED` or `PROCESSING` blocks any new attempt on the same `ScheduledCharge`. If the process crashed between the claim and recording the provider response, resolution is **reconcile-then-proceed**: query the provider using the stored `idempotencyKey`/metadata and settle the attempt's true state before anything new is created. Never create a parallel attempt; a retried provider call with the same idempotency key is safe by construction. Every provider call carries a timeout (Reliability-gate requirement); a timeout leaves the attempt in `CREATED` for reconciliation, it does not synthesize a failure.

### 2.5 Mapping to Revenue Review statuses

The Revenue Review status machine is owned by `03-revenue-review-lifecycle.md`; this table defines the collection-driven transitions it must expose.

| Collection state | Revenue Review status |
|---|---|
| `ScheduledCharge` SCHEDULED or AWAITING_MANUAL (charge planned) | Payment Scheduled |
| Attempt PROCESSING, method type CARD | Payment Processing |
| Attempt PROCESSING, method type US_BANK_ACCOUNT | **ACH Pending** |
| Attempt SUCCEEDED, method type CARD | **Card Paid** — rolls to Paid per the D4 timing decision (`16-risks-and-open-decisions.md`) |
| Attempt SUCCEEDED, method type US_BANK_ACCOUNT, invoice settled | Paid |
| Attempt FAILED, no attempt currently in flight | **Payment Failed** |
| Auto-retry slot pending after a failure | Payment Failed (UI shows "retry scheduled for …") |
| `MANUAL_INVOICE` approved, unpaid | Approved — with Amount Due shown |
| Manual/offline payments settle the invoice | Paid |

**Card Paid** is a distinct `RevenueReviewStatus` written by the payment engine — the canonical status set is `RevenueReviewStatus` in `13-database-model.md` §4.4 (includes `CARD_PAID`), with transitions Payment Processing → Card Paid → Paid owned by `03-revenue-review-lifecycle.md` §2.2–2.3. Only the Card Paid → Paid roll-forward timing (capture vs settlement/reconciliation) is open — decision D4 in `16-risks-and-open-decisions.md` (see open question 5).

### 2.6 ACH windows

- **Initiation:** ACH attempt enters `PROCESSING`; review → ACH Pending. The pending window is provider-controlled (Stripe: typically ~4 business days for standard ACH debits).
- **Return during the window:** provider `payment_failed` event (return codes R01 insufficient funds, R02 account closed, etc.) → attempt `FAILED` with the return code, review → Payment Failed, Amount Due derived (§2.8).
- **Settlement:** provider `succeeded` event → attempt `SUCCEEDED`, `Payment` created, review → Paid.
- **Late return after settlement** (rare — administrative returns, unauthorized-debit claims within the NACHA 60-day consumer window): arrives as a dispute/reversal-shaped provider event. Part 1 records the required transition — Paid → Payment Failed (or Disputed), with the reversal captured as an adjustment record, never by editing the settled `Payment` row — and defers the full Refund/Dispute mechanics to Part 2 and the adjustments design (`08-adjustments-discounts-credits.md`).

### 2.7 Retry policy

- Default: `retryMode = MANUAL_ONLY`. A failed charge notifies (in-app `Notification`; no email system exists) and waits for a human with `revenue.charge` to retry or for the payer to update their Payment Method.
- Optional auto-retry: `retryMode = AUTO`, `maxAutoRetries` (default 0, cap 3), retry slots at `autoRetryDelaysDays` offsets (default `[1, 3, 7]`). Each retry is a **new** `PaymentAttempt` with `attemptNumber + 1` and a fresh deterministic idempotency key; the `ScheduledCharge` goes `FAILED → SCHEDULED` with `runAfter` = the retry slot.
- **Hard declines are never auto-retried:** failure codes indicating a permanently unusable method (`stolen_card`, `pickup_card`, `invalid_account`, ACH `R02`/`R03`/`R04`) force `MANUAL_ONLY` handling for that charge and flag the `PaymentMethodReference` as `SUSPENDED` pending payer action.
- Retries duplicate no side effects: attempts are serialized by the claim (§2.3) and deduplicated at the provider by the per-attempt idempotency key — the Reliability gate's auto-reject ("retry logic that can duplicate side effects") is satisfied structurally.

### 2.8 Failure handling — Amount Due without a running balance (principle 4)

**Amount Due is always derived, never stored:**

```
amountDue(invoice) = invoice.total (frozen at approval)
                   + Σ signed line deltas of APPLIED post-approval
                     RevenueAdjustments, including their tax deltas
                     (08-adjustments-discounts-credits.md §3.3)
                   − Σ settled Payment.amount
                   + Σ succeeded Refund.amount   (Part 2)
```

The frozen `Invoice.subtotal`/`taxTotal`/`total` are written exactly once (`13-database-model.md` §6.1) and never recomputed; APPLIED post-approval adjustments (discounts, waivers, voids, corrections, late fees) append signed `InvoiceLine` rows, so the derivation **must** add their deltas — otherwise the payment runner's amount rule (§5.1) would charge a pre-discount total after a post-approval discount, and never bill the delta after an upward correction. **Contract-test requirement:** an APPLIED post-approval discount reduces the amount the payment runner resolves.

- Scope is **per invoice / per Revenue Review**. A payer- or student-level figure ("Total amount due: $412.50 across 2 invoices") is a read-time aggregation over that payer's open invoices — a query, not a column.
- Amount Due exists only in the states principle 4 permits: payment failed, ACH pending or returned, `MANUAL_INVOICE` policy, or org-permitted deferred payment (`deferredPaymentAllowed`). The immediate-charge default keeps it at zero for the normal case.
- `Student.accountBalance` is **demoted, not dropped**: the closeout decrement moves out with ADR-025 (the closeout transaction no longer creates a charge) and is replaced during the deprecation window by a decrement written in the review-approval (financial closeout) transaction; the payment increment is unchanged, so the legacy column keeps netting correctly for its legacy consumers (dashboards, ops warnings, import, seed) until retirement. No Revenue Engine surface reads it, and no new reader is added; `16-risks-and-open-decisions.md` R14's stored-vs-derived drift check guards the window. Retirement follows the additive-only two-release deprecation rule; the migration plan (`14-migration-plan.md`) owns sequencing, `13-database-model.md` owns the binding call.
- Student- and payer-facing language never says "account balance" — always **Amount Due**, itemized by the specific Revenue Reviews/invoices behind it.

### 2.9 Batch execution without a queue

Audit finding, stated plainly: **AeroOps has no queue, no cron, and no background worker.** The available seams are (a) in-process post-commit event-bus subscribers, (b) bounded API-driven ticks (the platform simulation-tick pattern), and (c) the planned Inngest adapter behind `emitDomainEvent` (not provisioned).

Design: one pure engine, three interchangeable triggers.

- **Engine:** `src/lib/payment-runner.ts` — `runDuePayments({ organizationId?, limit })`. Selects `ScheduledCharge` rows with `status = SCHEDULED AND runAfter <= now` (org-leading index), claims each with the guarded `updateMany`, creates the attempt, calls the provider adapter outside any transaction, records the outcome in a short follow-up transaction. Bounded (`limit`, default 25 per pass), per-row outcome reporting in the Import Center style — no silent row failures.
- **Trigger 1 — immediate:** after the approval transaction commits, `IMMEDIATE_ON_APPROVAL` charges run via the post-commit path (event-bus subscriber on `revenue_review.approved` or a direct post-commit engine call from the route — same placement as today's post-commit `recordAudit`/`emitDomainEvent`).
- **Trigger 2 — manual/API sweep:** `POST /api/revenue/payment-runs` (org-scoped, `revenue.charge`, `{mutating: true}`) runs due charges for the caller's org — the "Run due payments now" button on the Revenue Dashboard's due-charges queue. A platform-authorized sweep endpoint (`authorizePlatform`, `{mutating: true}`) may run bounded passes across orgs for operations use.
- **Trigger 3 — scheduler adapter (deferred):** when the queue/cron seam lands (Inngest per PRODUCTION.md), it invokes the identical engine on the batch cadence. No engine change; only a new caller.

**Honest limitation, surfaced in product:** until Trigger 3 exists, batch policies execute at the next runner pass, not at the exact batch time. Orgs selecting a batch policy see this stated in Settings, and the Revenue Dashboard shows the due-charges queue with the run-now control. Nothing is silently skipped — due charges remain `SCHEDULED` and visible until run.

### 2.10 Inbound provider events (webhooks)

Pipeline for `/api/webhooks/stripe-connect` (route naming finalized in Part 2; catalogued in `tests/constitution.test.ts` `PUBLIC_ROUTES` with a written reason; rate-limited via `lib/rate-limit.ts`):

1. **Verify signature first** (`constructEvent` with `STRIPE_WEBHOOK_SECRET`). Verification failure → 400, nothing stored. Route inert when the env var is unset.
2. **Unique insert** into `PaymentProviderEvent` (`@@unique([provider, providerEventId])`). Idempotency is defined on `processedAt`, **not** on the insert: on duplicate delivery, if the stored event has `processedAt` set → 200 no-op; if `processedAt` is null (a prior reduce failed, leaving `processingError`) → re-run the reduce, which is itself idempotent via the guarded attempt-state claim. A bounded sweep over `PaymentProviderEvent WHERE processedAt IS NULL AND processingError IS NOT NULL` runs in the payment runner / reconciliation pass, so a stored-but-unprocessed event is never permanently dropped even if the provider stops retrying.
3. **Resolve tenancy from local references only:** look up the locally stored `PaymentAttempt` via `providerPaymentIntentId` (`@@unique([provider, providerPaymentIntentId])`) plus the Connect account-id ↔ organization mapping, and take `organizationId` from the local row. `metadata.organizationId` / `metadata.paymentAttemptId` (set by AeroOps when the PaymentIntent was created) are used only as a cross-check that must match — on mismatch the event is stored unprocessed with a `processingError`. Metadata is part of the signed payload and, under the leading Connect recommendation (direct charges on connected accounts, `16-risks-and-open-decisions.md` D1), the connected-account holder controls object metadata — it is never trusted for attribution.
4. **Reduce:** look up the `PaymentAttempt` by provider reference; apply the transition through the same guarded state machine (`PROCESSING → SUCCEEDED` succeeds exactly once). Unknown event types are stored and marked ignored, not errored.
5. Post-transition side effects (review status, notification, `payment.succeeded`/`payment.failed` emit) run after the transition commits.

Do **not** rely on the in-process event bus for inbound payment truth — ADR-009 records that bus delivery is lost on crash and is unacceptable for billing-critical events. The DB state machines plus the `PaymentProviderEvent` table are the durable truth; the bus is fan-out only.

### 2.11 The Payment section of the Revenue Review (Part B)

Displayed on every Revenue Review before approval; values re-verified at the moment of approval:

| Field | Source | Behavior |
|---|---|---|
| Responsible payer | Payer resolution (`11-responsible-payers.md`) | Link to payer; "No payer — student self-pays" fallback; missing payer is a readiness warning |
| Payment timing policy | Org default, overridable at approval if org allows | Shows what will happen and when, in org-local time |
| Default payment method | Payer's default `PaymentMethodReference` | "Visa •••• 4242, exp 04/28" / "Checking •••• 6789 (verified)" — display metadata only |
| Card or ACH | `PaymentMethodReference.type` | Drives the post-approval status path (Payment Processing vs ACH Pending) |
| Payment readiness | Readiness evaluator (§5.2) | `READY` / `READY_WITH_WARNINGS` / `NOT_READY`, with the reason list — explainable-engine style, every signal carries its why |
| Missing-payment warnings | Readiness reasons | e.g. "No payment method on file — approval will use Manual invoice", "Card expires this month", "ACH method not yet verified", "Payer's last charge failed (card_declined, Jun 30)" |

At approval, whatever this section resolved to is what gets snapshotted. The approval control itself is specified in §7.

---

## 3. Configuration surface (org-level, strong defaults)

Stored on a dedicated tenant-scoped config model `OrgPaymentPolicy` (1:1 with `Organization`), following the OrgRole/LessonType structured-config pattern — no settings JSON blob. Edited via a zod-validated PATCH route with before/after `recordAudit` (`revenue.payment_policy_changed`), permission `revenue.payment_policy_manage`. **Do not overload `Organization.billingMode`** — that enum governs how the org pays AeroOps (platform subscription), a distinct money system (ARCHITECTURE.md §13).

| Setting | Type / values | Default | Notes |
|---|---|---|---|
| `defaultTimingPolicy` | `PaymentTimingPolicy` | `IMMEDIATE_ON_APPROVAL` | Spec-recommended default |
| `overridePolicies` | `PaymentTimingPolicy[]` | `[]` | Policies an approver may select per-review at approval; empty = no override |
| `sameDayBatchHourLocal` | Int 0–23 | `17` | Org `timeZone` |
| `nightlyBatchHourLocal` | Int 0–23 | `2` | |
| `weeklyBatchDay` | Int 0–6 (0 = Sunday) | `1` (Monday) | Convention matches `13-database-model.md` §4.12 |
| `weeklyBatchHourLocal` | Int 0–23 | `2` | |
| `achBatchCadence` | `NIGHTLY \| WEEKLY` | `NIGHTLY` | Cadence for `ACH_ONLY_BATCH` |
| `achOnlyFallback` | `HOLD_FOR_METHOD \| MANUAL_INVOICE` | `MANUAL_INVOICE` | When policy is ACH-only but the payer has no verified bank method |
| `customDateMaxDays` | Int | `30` | Bound for `CUSTOM_DATE` |
| `manualInvoiceNetDays` | Int | `14` | `dueAt` for `MANUAL_INVOICE` (matches today's closeout +14d) |
| `retryMode` | `MANUAL_ONLY \| AUTO` | `MANUAL_ONLY` | |
| `maxAutoRetries` | Int 0–3 | `0` | Ignored unless `retryMode = AUTO` |
| `autoRetryDelaysDays` | Int[] | `[1, 3, 7]` | Offsets from the failed attempt |
| `approveWithoutMethod` | `WARN \| BLOCK` | `WARN` | `WARN`: approval proceeds and falls back to `MANUAL_INVOICE`; `BLOCK`: approval disabled until a method exists |
| `deferredPaymentAllowed` | Boolean | `false` | Gate for org-permitted Amount Due beyond failure/ACH/manual-invoice cases; consumed by `10-checkout-restrictions.md` thresholds |

Currency: every monetary snapshot carries an explicit ISO 4217 currency column. Recommended: a single org-level default currency (`USD` initially — no currency column exists anywhere today) applied to all Revenue Engine records; whether it lives on `Organization` or on `OrgPaymentPolicy` is bound by `13-database-model.md`. Mixed currencies within one org are out of scope for Parts 1–2.

Environment flags (adapter seam, ADR-017 / storage.ts blueprint):

| Var | Values | Default | Effect |
|---|---|---|---|
| `REVENUE_CHARGING` | `off \| test` | `off` | `off`: provider adapter absent — charge/retry controls hidden, readiness reports "Payment provider not configured — manual invoice only"; manual invoicing and offline payment recording work fully. `test`: Stripe test-mode adapter active. A `live` value does not exist in this phase. |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | env only | unset | Never in application data (principle 8). Webhook route inert without the secret. Partial configuration fails loudly at boot via `assertProductionEnv` (`src/lib/env.ts`), never silently half-live. |

---

## 4. Data model proposal (Prisma-flavored)

Conventions applied throughout (schema-governance enforced): every org-owned model has `organizationId` + a real `Organization` relation with explicit `onDelete`, `createdAt @default(now())`, tenant-scoped uniques, org-leading indexes. Money is `Decimal @db.Decimal(12, 2)` paired with `currency @db.Char(3)` (ISO 4217) — **final precision/currency binding belongs to `13-database-model.md`**. All models below are additive; no existing column is dropped or reinterpreted.

### 4.1 Enums

```prisma
enum PaymentTimingPolicy {
  IMMEDIATE_ON_APPROVAL
  SAME_DAY_BATCH
  NIGHTLY_BATCH
  WEEKLY_BATCH
  MANUAL_CHARGE
  MANUAL_INVOICE
  ACH_ONLY_BATCH
  CUSTOM_DATE
}

enum ScheduledChargeStatus {
  SCHEDULED
  AWAITING_MANUAL
  PROCESSING
  COMPLETED
  FAILED
  CANCELLED
}

enum PaymentAttemptStatus {
  CREATED
  PROCESSING
  SUCCEEDED
  FAILED
  CANCELLED
}

enum PaymentAttemptTrigger {
  IMMEDIATE_ON_APPROVAL
  BATCH
  MANUAL
  AUTO_RETRY
}

enum PaymentProvider {
  STRIPE
}

enum StoredPaymentMethodType {
  CARD
  US_BANK_ACCOUNT
}

enum StoredPaymentMethodStatus {
  ACTIVE
  REQUIRES_VERIFICATION // ACH pending micro-deposit / instant verification
  SUSPENDED             // hard decline observed; payer action required
  DETACHED
}
```

New enum values ship in their own DDL migration before any code or backfill uses them (DATABASE_STANDARDS two-step rule).

### 4.2 OrgPaymentPolicy (new)

```prisma
model OrgPaymentPolicy {
  id                    String              @id @default(cuid())
  organizationId        String              @unique
  defaultTimingPolicy   PaymentTimingPolicy @default(IMMEDIATE_ON_APPROVAL)
  overridePolicies      PaymentTimingPolicy[] @default([])
  sameDayBatchHourLocal Int                 @default(17)
  nightlyBatchHourLocal Int                 @default(2)
  weeklyBatchDay        Int                 @default(1) // 0 = Sunday … 6 = Saturday; default 1 = Monday
  weeklyBatchHourLocal  Int                 @default(2)
  achBatchCadence       String              @default("NIGHTLY") // NIGHTLY | WEEKLY
  achOnlyFallback       String              @default("MANUAL_INVOICE") // HOLD_FOR_METHOD | MANUAL_INVOICE
  customDateMaxDays     Int                 @default(30)
  manualInvoiceNetDays  Int                 @default(14)
  retryMode             String              @default("MANUAL_ONLY") // MANUAL_ONLY | AUTO
  maxAutoRetries        Int                 @default(0)
  autoRetryDelaysDays   Int[]               @default([1, 3, 7])
  approveWithoutMethod  String              @default("WARN") // WARN | BLOCK
  deferredPaymentAllowed Boolean            @default(false)
  createdAt             DateTime            @default(now())
  updatedAt             DateTime            @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
}
```

Absent row = all defaults (strong defaults, zero setup — Product Principle 10). If the design set consolidates Revenue Engine org config into one settings model, these fields fold in; `13-database-model.md` binds it.

### 4.3 PaymentCustomer (new)

Maps a paying party (Responsible Payer, or the student self-paying) to a provider customer object. Org-scoped because under Stripe Connect the customer object lives on the org's connected account (account model finalized in Part 2 — this shape is deliberately provider-agnostic: `provider` + opaque reference).

```prisma
model PaymentCustomer {
  id                 String          @id @default(cuid())
  organizationId     String
  provider           PaymentProvider @default(STRIPE)
  providerCustomerId String          // opaque provider reference, e.g. cus_... — not a secret
  payerId            String?         // ResponsiblePayer (11-responsible-payers.md)
  studentId          String?         // self-pay fallback when no payer entity exists
  createdAt          DateTime        @default(now())
  updatedAt          DateTime        @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  // payer / student relations wired per 11-responsible-payers.md and 13-database-model.md
  methods      PaymentMethodReference[]

  @@unique([organizationId, provider, providerCustomerId])
  @@unique([organizationId, payerId])   // R20 — one provider customer per payer per org
  @@unique([organizationId, studentId]) // R20 — one provider customer per self-pay student per org
}
```

Exactly one of `payerId`/`studentId` is set (application-enforced; checked by the readiness evaluator). Spec Part K's identity separation holds: student receiving service ≠ payer ≠ provider customer ≠ organization receiving proceeds — this model is only the provider-customer edge.

### 4.4 PaymentMethodReference (new)

A saved Payment Method: **provider reference + safe display metadata only.**

```prisma
model PaymentMethodReference {
  id                      String                    @id @default(cuid())
  organizationId          String
  paymentCustomerId       String
  provider                PaymentProvider           @default(STRIPE)
  providerPaymentMethodId String                    // opaque, e.g. pm_...
  type                    StoredPaymentMethodType
  status                  StoredPaymentMethodStatus @default(ACTIVE)
  isDefault               Boolean                   @default(false)
  // Safe display metadata — the complete allowlist. Nothing else is ever stored.
  brand                   String?                   // "visa"
  last4                   String?                   // display only; never a full number
  expMonth                Int?
  expYear                 Int?
  bankName                String?
  fingerprint             String?                   // provider dedupe fingerprint (safe)
  createdAt               DateTime                  @default(now())
  updatedAt               DateTime                  @updatedAt
  detachedAt              DateTime?

  organization    Organization    @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  paymentCustomer PaymentCustomer @relation(fields: [paymentCustomerId], references: [id], onDelete: Cascade)

  @@unique([organizationId, provider, providerPaymentMethodId])
  @@index([paymentCustomerId, status])
}
```

**PCI stance (principle 8, binding on Part 2):** SAQ-A posture. Capture happens only on provider-hosted surfaces (Stripe hosted Checkout in setup mode / SetupIntent with provider-served elements); PAN, CVV, bank account and routing numbers, raw payment tokens, and provider secret keys never transit or persist in AeroOps. `providerCustomerId`/`providerPaymentMethodId` are opaque references, not credentials — they do not match the `*token`/`*secret` column patterns policed by `tests/token-security.test.ts` and require no allowlist entry; the design still forbids naming any column here `*token`/`*secret`. Removing a method sets `status = DETACHED` + `detachedAt` (and detaches at the provider); rows are never deleted — attempt history carries its own denormalized method snapshot (§4.6).

### 4.5 ScheduledCharge (new) — the per-approval snapshot and collection anchor

```prisma
model ScheduledCharge {
  id                       String                @id @default(cuid())
  organizationId           String
  revenueReviewId          String                @unique  // exactly one per approved review
  invoiceId                String                @unique  // and one per locked invoice
  // ---- write-once snapshot, frozen in the approval transaction ----
  // (no payer columns — payer identity freezes on RevenueReview.payerId/billToLabel/billToPayerType, 13 §4.4)
  policy                   PaymentTimingPolicy
  runAfter                 DateTime?             // null for MANUAL_CHARGE / MANUAL_INVOICE
  amount                   Decimal               @db.Decimal(12, 2) // invoice total locked at approval
  currency                 String                @db.Char(3)
  paymentMethodReferenceId String?               // resolved default at approval; re-pointable only in FAILED/AWAITING_MANUAL, audited
  // ---- mutable execution state ----
  status                   ScheduledChargeStatus @default(SCHEDULED)
  attemptCount             Int                   @default(0)
  lastAttemptId            String?
  createdAt                DateTime              @default(now())
  updatedAt                DateTime              @updatedAt

  organization    Organization            @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  invoice         Invoice                 @relation(fields: [invoiceId], references: [id], onDelete: Restrict)
  paymentMethod   PaymentMethodReference? @relation(fields: [paymentMethodReferenceId], references: [id], onDelete: SetNull)
  attempts        PaymentAttempt[]
  // revenueReview relation wired per 03-revenue-review-lifecycle.md

  @@index([organizationId, status, runAfter]) // org runner + dashboard queue
  @@index([status, runAfter])                 // platform sweep (authorizePlatform surfaces only)
  @@index([organizationId, createdAt])        // reporting/reconciliation axis
}
```

`revenueReviewId @unique` and `invoiceId @unique` are the DB-level heart of **exactly-once charging of a dispatch**: Dispatch → Revenue Review is 1:1 via the R4 partial unique (one non-VOIDED review per dispatch, per `02-operational-dispatch-and-closeout.md`/`03-revenue-review-lifecycle.md`/`16-risks-and-open-decisions.md` R4), review → ScheduledCharge is 1:1 here, and attempts are serialized by the claim. The same dispatch structurally cannot acquire two charge pipelines.

### 4.6 PaymentAttempt (new)

```prisma
model PaymentAttempt {
  id                       String                @id @default(cuid())
  organizationId           String
  scheduledChargeId        String
  invoiceId                String
  attemptNumber            Int                   // 1-based per ScheduledCharge
  trigger                  PaymentAttemptTrigger
  status                   PaymentAttemptStatus  @default(CREATED)
  amount                   Decimal               @db.Decimal(12, 2)
  currency                 String                @db.Char(3)
  // Deterministic per-approval idempotency key: "sc_<scheduledChargeId>_a<attemptNumber>".
  // Sent to the provider as the Idempotency-Key; unique here so a replay cannot mint a second attempt.
  idempotencyKey           String                @unique
  provider                 PaymentProvider       @default(STRIPE)
  providerPaymentIntentId  String?               // PaymentIntent reference once created
  // Denormalized method snapshot — no FK to PaymentMethodReference (13 §4.12); history survives method detachment
  methodType               StoredPaymentMethodType?
  methodBrand              String?
  methodLast4              String?
  failureCode              String?               // provider decline / ACH return code (R01, ...)
  failureMessage           String?
  initiatedByUserId        String?               // null for policy/batch-triggered attempts
  initiatedByLabel         String                // "Sarah Chen" | "system:payment-runner"
  createdAt                DateTime              @default(now())
  processingAt             DateTime?
  settledAt                DateTime?
  failedAt                 DateTime?
  cancelledAt              DateTime?

  organization    Organization            @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  scheduledCharge ScheduledCharge         @relation(fields: [scheduledChargeId], references: [id], onDelete: Restrict)
  invoice         Invoice                 @relation(fields: [invoiceId], references: [id], onDelete: Restrict)

  @@unique([scheduledChargeId, attemptNumber])
  @@unique([provider, providerPaymentIntentId])
  @@index([organizationId, status, createdAt]) // payment-status queues, reconciliation
  @@index([invoiceId])
}
```

`onDelete: Restrict` from `Invoice` is deliberate: a financial attempt record can never be cascaded away (contrast with today's `Payment` cascade, which `13-database-model.md` corrects).

### 4.7 PaymentProviderEvent (new) — inbound event idempotency

The Revenue Engine's equivalent of the mandated `BillingEvent` unique-insert pattern (PRODUCTION.md §13.2), kept as a **separate table** because tenant-payment events and platform-subscription events belong to two distinct money systems (ARCHITECTURE.md §13). The schema audit sketched this as "StripeWebhookEvent"; the provider-agnostic name is used here and `13-database-model.md` binds it.

```prisma
model PaymentProviderEvent {
  id              String          @id @default(cuid())
  provider        PaymentProvider @default(STRIPE)
  providerEventId String          // Stripe event id, e.g. evt_...
  type            String          // provider event type
  payload         Json            // retained for forensic replay
  organizationId  String?         // resolved server-side from local references, never from event metadata (§2.10); SetNull — forensic record outlives the tenant
  receivedAt      DateTime        @default(now())
  processedAt     DateTime?
  processingError String?

  organization Organization? @relation(fields: [organizationId], references: [id], onDelete: SetNull)

  @@unique([provider, providerEventId]) // dedupe anchor; processing idempotency keys off processedAt (§2.10)
  @@index([organizationId, receivedAt])
  @@index([type, receivedAt])
}
```

Audit-grade record: `SetNull` like `AuditLog`/`LoginEvent`, and **excluded from org-snapshot restore** (like `AuditLog`) — forensic history is never rewritten by a tenant restore. Global (not tenant-scoped) uniqueness on `providerEventId` is correct here: the value is provider-issued, arrives before tenancy is known, and the table is not queryable by tenants.

### 4.8 Extensions to existing models (additive)

**`Payment` (extend — never replace; it is read by billing pages, health-score, insights, mission-control, search, import, snapshot, and the seed):**

```prisma
model Payment {
  // existing: id, invoiceId, amount, method, reference, paidAt
  currency         String?  @db.Char(3)   // backfilled "USD" in a separate idempotent data migration
  paymentAttemptId String?  @unique        // exactly one Payment per successful attempt
  recordedByLabel  String?                 // actor label for manually recorded payments
}
```

A successful `PaymentAttempt` creates a `Payment` row (`method` mapped `CARD→CARD`, `US_BANK_ACCOUNT→ACH`; `reference = providerPaymentIntentId`) so every existing consumer keeps working unchanged. In the design set's vocabulary, `Payment` is the settled **PaymentTransaction** record; the existing model name is retained per the no-renames rule. Changing `Payment.invoice` from `Cascade` to `Restrict` is recommended (financial records must survive their invoice) — binding and sequencing in `13-database-model.md` / `14-migration-plan.md`.

**`Invoice` (fields this design depends on; owned by the lifecycle/database docs):** `currency @db.Char(3)`, snapshotted totals (`subtotal`/`taxTotal`/`total`, per `13-database-model.md` §4.2.2) locked at approval, `updatedAt`. Amount Due derivation (§2.8) requires the locked `total` plus the signed deltas of APPLIED post-approval adjustments.

**`RevenueReview` (model owned by `03-revenue-review-lifecycle.md`; this doc contributes the payment edge):** relation to `ScheduledCharge` (1:1), and the payment-driven statuses of §2.5.

**Not modified:** `Organization.billingMode`, `SubscriptionPlan`, and the planned `BillingEvent` — platform-subscription money system, out of bounds.

### 4.9 Cross-cutting wiring (same slice as the models)

- **org-snapshot.ts:** add `OrgPaymentPolicy`, `PaymentCustomer`, `PaymentMethodReference`, `ScheduledCharge`, `PaymentAttempt` to `TableKey`, capture, restore order, and the FK-safe wipe order (attempts before scheduled charges before invoices; method references before customers). `PaymentProviderEvent` is deliberately excluded (forensic, `SetNull`).
- **Seed fixtures (`prisma/seed.ts`):** both tenants get an `OrgPaymentPolicy` (demo org: immediate; Blue Ridge: nightly batch), payment customers/methods with fake `cus_`/`pm_` references, at least one review in each of Payment Scheduled / ACH Pending / **Payment Failed** (satisfying Part L's failed-payment fixture), without touching demo logins.
- **Status colors:** new Revenue Review / attempt statuses register in `src/lib/status-colors.ts` `STATUS_TONE` (single map, tested).
- **Domain events:** register `payment.succeeded` and `payment.failed` in `WEBHOOK_EVENTS` with live emit sites (constitution requires both); keep emitting `invoice.paid` when an invoice settles, for existing consumers.

---

## 5. Validation & business rules

### 5.1 Charge initiation (server-side, every path)

1. Review must be **Approved** with a locked financial snapshot; the `ScheduledCharge` must exist. No charge from any other state (400 with the reason).
2. Amount is resolved server-side: `min(snapshot amount, current Amount Due)`, with Amount Due derived per §2.8 — including the signed deltas of APPLIED post-approval adjustments — **never client-supplied** (Financial-gate auto-reject). If Amount Due is already zero, the claim resolves to `COMPLETED` and no attempt is created. Contract test (required): an APPLIED post-approval discount reduces the amount the payment runner resolves.
3. `amount > 0`; `currency` matches the invoice snapshot.
4. The `PaymentMethodReference` must belong to the same organization **and** to the payer's `PaymentCustomer` (body-supplied IDs verified org-owned before use; cross-tenant IDs are 404s).
5. Method must be usable: `ACTIVE` (not `REQUIRES_VERIFICATION`/`SUSPENDED`/`DETACHED`), card not expired, type compatible with the policy (`ACH_ONLY_BATCH` ⇒ `US_BANK_ACCOUNT`).
6. State-machine claim (§2.3) before any provider call; provider call outside any DB transaction; per-attempt idempotency key always sent.
7. `CUSTOM_DATE`: approval validates `now < date ≤ now + customDateMaxDays`.
8. Manual (offline) payments through the existing `billing.record_payments` route remain valid for open invoices; the route gains a server-side overpayment guard (amount ≤ Amount Due — today only the UI limits it) and settling the invoice transitions the `ScheduledCharge` to `COMPLETED`/`CANCELLED` accordingly. **Pre-approval status guard:** the route refuses any invoice whose Revenue Review is pre-approval (`Invoice.status` DRAFT) with a 409 — "Approve the Revenue Review before recording payment." Without this guard, `billing.record_payments` would let money be recorded against an unapproved, unlocked invoice, bypassing the approval gate that `03-revenue-review-lifecycle.md` establishes as the sole path to a locked financial snapshot. Legacy review-less invoices (pre-migration invoices with no Revenue Review) keep today's behavior unchanged. **In-flight guard:** recording an offline payment against an invoice whose `ScheduledCharge` has a `PaymentAttempt` in `CREATED` or `PROCESSING` is refused with a 409 — "Charge in flight — wait for the attempt outcome or cancel the scheduled charge first." The check runs inside the payment-recording transaction (guarded claim), so a race with the payment runner loses cleanly. Without it, an ACH attempt sitting in its ~4-business-day `PROCESSING` window (Amount Due still showing the full total) plus a recorded check would collect twice.

### 5.2 Payment readiness (evaluated at review generation, re-evaluated at approval)

Pure engine (`src/lib/payment-readiness.ts`), explainable-engine style: returns `READY | READY_WITH_WARNINGS | NOT_READY` plus a reason list — a number (or verdict) without a why is a bug.

| Check | Failure → |
|---|---|
| Responsible payer resolved (or student self-pay identity) | Warning: "No responsible payer" |
| `PaymentCustomer` exists for the payer | Warning (auto-created on first method save) |
| Default `PaymentMethodReference` on file, `ACTIVE` | `NOT_READY` for charging policies; `approveWithoutMethod` decides WARN-with-fallback vs BLOCK |
| Card expiry vs scheduled `runAfter` | Warning: "Card expires before the scheduled charge date" |
| ACH method verified | `NOT_READY` for ACH policies until verified |
| Method type compatible with policy | `NOT_READY` (ACH-only + card-only payer → `achOnlyFallback`) |
| Currency match (method customer vs invoice) | `NOT_READY` |
| Recent failed attempts for this payer | Warning with code and date |
| Provider configured (`REVENUE_CHARGING`) | Charging policies unavailable; manual invoice remains |

`NOT_READY` under `approveWithoutMethod = WARN` converts the effective policy to `MANUAL_INVOICE` at approval (stated on the approval control); under `BLOCK`, approval is disabled with the actionable reason. Readiness signals also feed the pre-flight financial checkout restrictions in `10-checkout-restrictions.md` (payment method missing, prior payment failed, Amount Due above threshold) — financial restrictions never block safety actions.

### 5.3 Money and transaction rules

- All monetary values Prisma `Decimal`; arithmetic on Decimal-safe paths, `Number()` conversion only at the display boundary. Rounding policy explicit at every division (none exists in this doc's math — amounts are snapshots and sums).
- Wherever money moves or multiple rows must agree: one `db.$transaction`. Provider calls never inside it. Post-commit side effects (audit, events, notifications) follow the dispatch-close template.
- Approved snapshots are immutable; corrections are new records (adjustments, refunds — sibling docs), never edits to settled `Payment`/`PaymentAttempt` rows.

### 5.4 Reliability & failure modes (SRE lens)

| Failure | Behavior |
|---|---|
| Stripe down / timeout at charge time | Attempt stays `CREATED`; charge visibly stuck-in-progress; reconcile-then-proceed via idempotency key (§2.4); operator sees it in the due-charges queue. Timeout mandatory on every provider call. |
| Crash after provider call, before recording | Same reconciliation path; the provider-side idempotency key guarantees at-most-once money movement. |
| Webhook lost / delayed | State remains `PROCESSING`; provider retries webhooks; a Part 2 reconciliation pass (provider list vs local `PROCESSING` attempts) is the designed backstop — attempts never silently expire. |
| Webhook duplicated | Idempotent on `processedAt` (§2.10): already-processed events 200 no-op; stored-but-unprocessed events re-run the reduce (itself idempotent via the guarded claim); the bounded sweep re-drives stored events whose reduce failed. |
| Offline payment recorded while an attempt is in flight | Refused with 409 inside the payment-recording transaction (§5.1.8) — the guarded claim means a race with the runner loses cleanly; no double collection. |
| Runner invoked concurrently (two operators, or operator + platform sweep) | Guarded claims make double-processing structurally impossible; the second claimer's `count === 0` skips the row. |
| Org policy edited mid-flight | Irrelevant to existing `ScheduledCharge` rows — snapshots are write-once. |
| Provider env unset | Adapter absent; charging surfaces disabled with an explicit message; nothing hard-fails (Production-gate rule: adapters degrade gracefully). |

---

## 6. RBAC, approvals & audit

### Permissions (data-driven — new keys in `src/lib/permissions.ts`; never role-name checks)

| Key | Grants | Default roles |
|---|---|---|
| `revenue.charge` | Initiate/retry/cancel a charge on an approved review; run the org's due-payments pass | ACCOUNT_OWNER, SCHOOL_ADMIN, ACCOUNTANT |
| `revenue.payment_methods_manage` | Start hosted method-setup sessions on behalf of a payer; detach methods | ACCOUNT_OWNER, SCHOOL_ADMIN, ACCOUNTANT |
| `revenue.payment_policy_manage` | Edit `OrgPaymentPolicy` | ACCOUNT_OWNER, SCHOOL_ADMIN |
| `billing.record_payments` (existing) | Record offline payments — unchanged | unchanged |

`revenue.approve` (approve-and-charge itself) is owned by `03-revenue-review-lifecycle.md`; approving a review whose snapshot says "charge immediately" is the human authorization for that charge — no separate `revenue.charge` grant is needed for the policy-driven path (principle 2's explicit control is the consent). The `revenue.` prefix must be added to `MODULE_BY_PREFIX` (`src/lib/session.ts`) mapped to the `billing` module so plan/profile module gating applies; whether Revenue Engine becomes its own module key is an architecture-doc decision.

All routes: `authorize(<permission>, { mutating: true })`; read-only impersonation and read-only API keys are therefore refused automatically. Platform sweep: `authorizePlatform` with `{ mutating: true }`. The webhook route joins `PUBLIC_ROUTES` with a written reason and rate limiting. **AI never initiates a charge** — every charge traces to a human approval (policy path) or a human `revenue.charge` action (manual path); constitution rule 8 holds.

### Audit actions (`recordAudit`, dot-namespaced; impersonation attribution centralized)

| Action | When | Metadata |
|---|---|---|
| `revenue.payment_policy_changed` | Org config PATCH | before/after values |
| `revenue.charge_scheduled` | Approval creates the ScheduledCharge | policy, runAfter, method last4/brand, amount, currency |
| `revenue.charge_initiated` | Attempt created | attemptId, attemptNumber, trigger, idempotencyKey |
| `revenue.charge_succeeded` / `revenue.charge_failed` | Terminal attempt state | providerPaymentIntentId, failureCode; actorLabel `system:stripe-webhook` for webhook-driven transitions (no session actor) |
| `revenue.charge_retried` / `revenue.charge_cancelled` | Manual retry/cancel | actor, reason (required for cancel) |
| `revenue.charge_method_changed` | Method re-pointed in FAILED/AWAITING_MANUAL | before/after method reference + display metadata |
| `revenue.payment_method_added` / `revenue.payment_method_detached` | Method lifecycle | display metadata only — **never provider payloads with sensitive fields, never keys/tokens** |

Every financial mutation is audited with metadata sufficient to reconstruct the ledger without current DB state (Financial-gate E3). Audit metadata contains IDs, labels, and safe display fields only.

---

## 7. UX notes (aviation-native, operational workflow first)

- **Nothing here touches the flight line.** Aircraft return and operational closeout (per `02-operational-dispatch-and-closeout.md`) complete with zero payment interaction — a dispatcher closing a flight never sees a charge control. Collection lives on the Revenue Dashboard and the Revenue Review.
- **The approval control states the financial consequence exactly** (principle 2). Immediate policy: **"Approve Revenue Review and charge the saved payment method"** with method and amount adjacent ("Visa •••• 4242 — $412.50"). Scheduled: "Approve Revenue Review — payment scheduled for the nightly batch (Jul 11, 2:00 AM ET)". Manual invoice: "Approve Revenue Review — invoice issued, due Jul 24. No card will be charged." No generic "Submit".
- **Readiness chips** on the review's Payment section: green READY / amber warnings / red NOT_READY, each expanding to its reasons with the next step ("Add a payment method" launches the provider-hosted setup — AeroOps never renders card fields).
- **Revenue Dashboard due-charges queue:** scheduled charges with local-time due stamps, ACH Pending items with expected settlement dates, failures with decline reasons and retry controls, and "Run due payments now" (`revenue.charge`). Batch-time caveat from §2.9 is shown where a batch policy is selected.
- **Amount Due language everywhere; "account balance" nowhere** in student/payer surfaces. Amount Due always itemizes the reviews behind it.
- Statuses (Payment Scheduled, Payment Processing, ACH Pending, Paid, Payment Failed) render via `STATUS_TONE` entries; light/dark and mobile parity; loading/empty/error states included. Failed-payment errors are actionable: "Charge failed: card_declined. Retry, choose another payment method, or switch this review to manual invoice."
- In-app `Notification` rows (new kinds `PAYMENT_FAILED`, `PAYMENT_RECEIPT`) are the only channel — no email system exists, and no production email is permitted in this phase.

---

## 8. Interactions with other Revenue Engine components

| Sibling doc | Interaction |
|---|---|
| `01-architecture.md` | Operational-vs-financial closeout boundary; ADR-025 (supersedes/extends ADR-011); the snapshot carve-out from the derive-at-read-time rule; module-key decision |
| `02-operational-dispatch-and-closeout.md` | Aircraft return creates the draft Revenue Review; Dispatch↔review 1:1 link is the first link in the exactly-once chain; no payment work in the closeout transaction |
| `03-revenue-review-lifecycle.md` | Owns review statuses and approval/locking; consumes §2.5's payment-driven transitions and §2.11's Payment section; `revenue.approve` |
| `05-aircraft-pricing-profiles.md` / `04-instructor-time-and-rates.md` | Produce the locked amounts this doc collects; Instructor Compensation is recorded at financial closeout, independent of collection timing |
| `08-adjustments-discounts-credits.md` | Post-approval corrections (refunds, waived fees, late ACH returns) are adjustment records against the settled trail — never edits |
| `11-responsible-payers.md` | Responsible Payer entity and student links; `PaymentCustomer` attaches to the payer; payer-facing visibility of Amount Due, receipts, and payment status |
| `10-checkout-restrictions.md` | Consumes readiness + Amount Due signals for financial restrictions (method missing, prior failure, threshold); financial blocks never touch safety gates |
| `13-database-model.md` | **Binding call** on all models/fields here: precision/currency placement, `Payment` cascade→restrict, event-table and settings-model naming, index set |
| `14-migration-plan.md` | Sequencing: enum DDL first, models, `Payment.currency` backfill (separate, idempotent, "USD"), org-snapshot/seed wiring, `Student.accountBalance` demotion schedule |

---

## 9. Out of scope for Part 1 / deferred to Parts 2–3

**Part 2 (implementation, test mode only — nothing deploys, no live charges):**
- Stripe **Connect account model, platform-fee mechanics, and application-fee splits** — explicitly deferred by the spec; this doc's provider-agnostic adapter (`createCustomer`, `createSetupSession` (hosted), `detachPaymentMethod`, `createCharge({ amount, currency, customerRef, methodRef, idempotencyKey, metadata })`, `parseWebhookEvent(signature, raw)`) is the interface Part 2 implements behind `REVENUE_CHARGING`.
- The actual `src/lib/stripe.ts`-style adapter, webhook route + `PUBLIC_ROUTES` catalog entry, Stripe CLI/test-clock verification, duplicate-event tests, and the `PROCESSING`-attempt reconciliation pass (which also runs the §2.10 bounded sweep of stored-but-unprocessed provider events).
- Refund, Dispute, and settled-ACH-return execution (state transitions named in §2.6).
- Payer-facing payment surfaces (hosted method setup from the payer portal, pay-now on a manual invoice).

**Part 3 / later:**
- Durable queue/cron adapter (Inngest) driving batch cadences exactly on time; dunning sequences; email receipts (needs the email adapter); payer spending alerts; multi-currency orgs; surcharging/convenience fees; prepaid packages and wallet balances (excluded by spec Part H).

**Explicit confirmations:** this phase deploys nothing, enables no live payments, sends no production email, and stores no raw payment credentials anywhere in the design.

---

## 10. Open questions

1. **Approval without a saved method — default posture.** Recommended `approveWithoutMethod = WARN` (fall back to manual invoice) so operations never stall; orgs wanting hard discipline set `BLOCK`. Product-owner confirmation requested.
2. **Auto-retry at GA.** Ship `MANUAL_ONLY` as the only mode initially, or expose `AUTO` (capped at 3) from day one? Recommendation: expose but default off; needs product sign-off because auto-retries generate payer-visible decline noise.
3. **Batch execution ownership before the queue exists.** Is the platform-authorized sweep endpoint (staff-triggered) an acceptable interim driver for nightly/weekly batches, or must the queue adapter land in Part 2 for any org to be offered batch policies?
4. **Single org currency.** This design assumes one currency per organization (default USD). Confirm no launch org needs mixed-currency invoicing before Part 2 hardcodes the assumption into the adapter.
5. **Card Paid → Paid roll-forward timing** (capture vs settlement/reconciliation) — open decision D4 in `16-risks-and-open-decisions.md`, coordinated with `03-revenue-review-lifecycle.md`. The `CARD_PAID` status itself is canonical (`13-database-model.md` §4.4) and not in question; either timing is implementable here.
6. **`Payment.invoice` cascade→restrict timing** — recommended in this doc, binding and migration sequencing owned by `13-database-model.md`/`14-migration-plan.md` (touches org wipe order and tenant deletion).
