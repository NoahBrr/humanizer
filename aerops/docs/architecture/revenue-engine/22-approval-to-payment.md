# Approval to Payment — Execution Workflow

> **Status:** Proposed — Phase 8 Part 2 · **Date:** 2026-07-10 · **Lead roles:** Principal Software Architect at Stripe; Financial Systems Architect; Reliability/SRE Engineer · **Part of:** Revenue Engine design set ([README](./README.md))

This document is the heart of Part 2 (spec Part S): how an approvable Revenue Review becomes exactly one settled payment. It specifies the **approval readiness checklist**, the **approval transaction** (one `db.$transaction`, no provider calls), the **payment-request outbox**, the **payment worker** that executes charges in a codebase with no queue, and the **idempotency guarantees** at every hop. It is design only: Stripe test mode is the only sanctioned environment, nothing deploys, no live charges.

North-star framing: an approver at a five-instructor flight school must be able to look at one button, know exactly what money will move and when, click it once, and trust that a crashed server, a double-click, a replayed webhook, or an impatient second operator cannot move that money twice. Everything below serves that sentence.

---

## 1. Purpose & scope

### In scope

- The ten-point readiness checklist gating the approve-and-charge control (spec Part S), each check bound to its data source.
- The approval transaction: Part 1's binding sequence ([03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) §2.6) restated with the Part 2 additions — connected-account gate, platform-fee accrual inputs, and the **outbox** framing of `ScheduledCharge`.
- The payment worker: `src/lib/payment-runner.ts` execution contract — trigger, claim, attempt creation, provider call with connected-account context and application fee, provider-ID capture, hand-off to webhooks.
- Crash/retry semantics at every step of the worker.
- The charge-operation idempotency keys and the duplicate-prevention matrix (invoices, intents, charges, platform fees, payouts, refunds), each tied to its enforcing mechanism.

### Out of scope (owned by siblings)

- Connect topology, merchant of record, fee split mechanics — the Connect ADR (doc 18). This doc assumes its D1-recommended shape: **direct charges on the org's connected account, `application_fee_amount` collecting the platform fee, school as merchant of record** ([16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md) D1).
- Connected-account onboarding model and statuses (doc 19) — this doc *consumes* its readiness fields.
- Saved-method capture and off-session consent records (doc 20 / spec Part Q) — this doc *consumes* consent state.
- Card/ACH provider state details (doc 21 / spec Part R).
- Webhook ingestion, the reduce, and the reconciliation job — [23-webhooks-and-reconciliation.md](./23-webhooks-and-reconciliation.md). The worker's contract ends at "attempt PROCESSING, awaiting webhook."
- The end-to-end idempotency registry — [24-idempotency.md](./24-idempotency.md). §5 here defines the charge-operation keys and coordinates; 24 owns the full story.
- Failure workflow after a terminal decline (spec Part U), refunds/voids/disputes (spec Part V), platform-fee commercial models (spec Part W) — sibling Part 2 docs.
- Final Prisma shapes for anything new — [34-part2-database-additions.md](./34-part2-database-additions.md) makes the final call; §6 proposes.

---

## 2. Relationship to Part 1 docs

Part 1 already designed most of Part S. This doc **finalizes and extends — never reinterprets**:

| Part 1 doc | What it fixed (binding) | What this doc adds |
|---|---|---|
| [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) §2.6–2.8 | The approval transaction sequence, guarded claim + `updatedAt`/`expectedTotal` optimistic concurrency, approval kinds, separation of duties, the consequence-truthful control-label table | The full Part S readiness checklist in front of the control; the in-transaction re-verification subset; the outbox framing of step 5's `ScheduledCharge` creation |
| [09-payment-timing-and-collection.md](./09-payment-timing-and-collection.md) §2.1–2.4, §2.9, §5.1 | `ScheduledCharge`/`PaymentAttempt` state machines, queue-less runner (engine + three triggers), server-side amount resolution, stuck-attempt reconcile-then-proceed | The concrete per-step worker contract with transaction boundaries, connected-account context, application-fee inclusion, and the crash matrix |
| [13-database-model.md](./13-database-model.md) §4.4, §4.12, §7, §8 | **Canonical** model shapes, the exactly-once chain Dispatch → RevenueReview → Invoice → ScheduledCharge → PaymentAttempt → Payment, deterministic key format `sc_<scheduledChargeId>_a<attemptNumber>` (ADR-033) | Two additive `PaymentAttempt` columns proposed for 34 to bind (§6.2) |
| [12-revenue-allocation-and-reporting.md](./12-revenue-allocation-and-reporting.md) | APPROVAL allocation set + `PlatformFee` ACCRUED written inside the approval transaction; V7 one-fee/one-set-per-review | The "allocations reconcile" readiness check = the preview of that set balancing before the control enables |
| [11-responsible-payers.md](./11-responsible-payers.md), [04-instructor-time-and-rates.md](./04-instructor-time-and-rates.md), [07-tax-model.md](./07-tax-model.md) | Payer resolution, instructor time confirmation, tax snapshots at approval | Their outputs as named readiness checks |

**Terminology note:** the spec's "payment-request/outbox record" **is** Part 1's `ScheduledCharge` — no new `PaymentRequest` model is introduced (§4.1). The spec's "PaymentTransaction" is the extended existing `Payment` model (13 §4.2.4, R17).

---

## 3. How it works

### 3.1 End-to-end sequence

Numbered steps; `[TX]` marks a database transaction boundary, `[ASYNC]` marks an asynchronous hop (process boundary, provider round-trip, or webhook wait). Provider calls never occur inside any `[TX]` (spec Part S; Part AB auto-reject).

```
 1. Approver opens the Revenue Review (AWAITING_OPERATIONS_REVIEW).
 2. Readiness checklist evaluates (§3.2) → control enabled with the
    consequence-truthful label, or disabled with actionable reasons (§3.3).
 3. Approver clicks "Approve Revenue Review and charge the saved
    payment method" (request carries updatedAt token + expectedTotal).
 4. [TX — approval transaction, §3.4] claim → recompute → freeze →
    snapshot → allocation/fee/earnings/tax/ledger rows →
    ScheduledCharge (outbox) insert → review status write. COMMIT.
 5. Post-commit: recordAudit, emitDomainEvent('revenue_review.approved'),
    Trigger 1 invokes the payment runner for IMMEDIATE_ON_APPROVAL.
 6. [ASYNC — worker, §3.6] runner claims the ScheduledCharge:
    [TX A] SCHEDULED→PROCESSING + PaymentAttempt CREATED (idempotency
    key minted) + review → PAYMENT_PROCESSING/ACH_PENDING path. COMMIT.
 7. [ASYNC — provider] adapter createCharge(): PaymentIntent on the
    connected account, application_fee_amount, Idempotency-Key header,
    timeout enforced. NO transaction open during this call.
 8. [TX B] store providerPaymentIntentId, attempt CREATED→PROCESSING
    (guarded). COMMIT. Worker's job ends here.
 9. [ASYNC — webhook] provider event arrives → 23-webhooks-and-
    reconciliation.md reduces attempt PROCESSING→SUCCEEDED/FAILED in its
    own transaction: Payment row, Invoice PAID, review status, PlatformFee
    EARNED, settlement ledger journal, receipt notification.
10. Reconciliation job (23) sweeps: unclaimed SCHEDULED past runAfter,
    stuck CREATED attempts, stale PROCESSING attempts, stored-but-
    unprocessed provider events. Nothing silently expires.
```

Batch/custom-date policies stop after step 4 with the review in `PAYMENT_SCHEDULED`; steps 6–9 run when `runAfter` arrives (Trigger 2/3). Manual-charge policy waits in `AWAITING_MANUAL` for a human with `revenue.charge`. Manual-invoice policy never enters steps 6–9; collection is offline recording or a Part 2 payer pay-now surface (doc 21).

### 3.2 Approval readiness checklist (spec Part S, verbatim coverage)

Evaluated by the pure engine `src/lib/payment-readiness.ts` (extends doc 09 §5.2 — Part 2 adds checks 6, 9, 10 and the consent clause of check 5). Evaluated on review load, re-evaluated on every review mutation, and **re-verified server-side at approval** (final column). A verdict without a reason list is a bug.

| # | Check (spec wording) | Data source (model · doc) | Enforced again inside the approval TX? |
|---|---|---|---|
| 1 | Review is complete | `RevenueReview.status` is an approvable state per the doc 03 §2.3 transition table; wrapped Invoice has ≥ 1 `InvoiceLine` (or explicit zero-total confirmation, doc 09 §5.2); no pricing/rate resolution ambiguity outstanding (ADR-030 blocks approval, never closeout) · 13 §4.4/§4.2.3, docs 03/05 | Yes — the guarded status claim |
| 2 | Required instructor time is present | When the review carries `instructorId` and `RevenueWorkflowPolicy.instructorSubmissionRequired`: `InstructorTimeEntry` rows exist with `confirmedByInstructorAt` set, or an audited supervisor override · 13 §4.7, doc 04 | Yes — re-read before freeze |
| 3 | Required approvals exist | One **active** (`supersededAt IS NULL`) `RevenueReviewApproval` row per required kind (`OPERATIONS`, `SECOND`, `FINANCE` per `RevenueWorkflowPolicy`); separation-of-duties rules pass · 13 §4.4, doc 03 §2.7–2.8 | Yes — re-read; the final kind is recorded in this TX |
| 4 | Responsible payer exists | `RevenueReview.payerId` resolved, **or** explicit student self-pay (`payerId` null + `studentId` present + `payerResolutionBasis = self_pay`) · 13 §4.4, doc 11. Missing both ⇒ `MISSING_PAYER` risk flag, not approvable to a charging policy | Yes — payer identity freezes in this TX |
| 5 | Saved payment method exists | Paying party's `PaymentCustomer` has a default `PaymentMethodReference` in `ACTIVE` status, card unexpired, ACH verified, type compatible with the policy · 13 §4.12, doc 09 §5.2 — **plus** an unrevoked off-session consent record for that payer/method (spec Part Q; model owned by doc 20) | No — snapshot only; re-verified by the worker pre-flight (§3.6), since methods/consent can change between approval and a batch run |
| 6 | Connected account is ready | Org's connected-account record (doc 19 / spec Part P): canonical charge gate `chargesEnabled === true && derivedStatus ∈ {ENABLED, REQUIREMENTS_DUE}` (doc 34 R-P2 / doc 19 §3.8 — overrides the older "must be `ENABLED` to charge"; `REQUIREMENTS_DUE` with charges still enabled is Stripe's normal eventually-due-paperwork state, so it charges **ready-with-warnings**, not blocked — blocking there would halt a working school's collections for a form Stripe has not deadlined); `REVENUE_CHARGING = test` and adapter configured (13/doc 09 env flags) | No — re-verified by the worker pre-flight |
| 7 | Currency is supported | `RevenueReview.currency = Invoice.currency` = org currency, present in the `src/lib` ISO 4217 catalog, and equal to the connected account's default currency (single-currency rule, 13 §2.3) · 13 §2.3, doc 19 | Yes — engine-enforced document-currency equality |
| 8 | Invoice totals reconcile | Server-side Decimal recompute from `InvoiceLine` rows equals the `expectedTotal` the approver saw · doc 03 §2.6 step 2 | Yes — recompute is step 2 of the TX; mismatch → 409 |
| 9 | Revenue allocations reconcile | The APPROVAL `RevenueAllocation` set **preview** computes and balances: each dimension (REVENUE, PROCEEDS) sums exactly to the recomputed total; rounding residue lands in `SCHOOL_RETAINED_REVENUE` (largest-remainder, half-up) · doc 12 §2, allocation engine | Yes — the set is written in this TX with an engine balance guard; imbalance aborts the TX |
| 10 | No duplicate payment request exists | No `ScheduledCharge` exists for this `revenueReviewId`/`invoiceId` (its existence means the review already approved) · 13 §7 uniques | Yes — structurally: the `@unique` constraints make a duplicate insert impossible; the status claim makes it unreachable |

Checks 1–4 and 7–10 are hard gates for *any* approval. Checks 5–6 interact with `OrgPaymentPolicy.approveWithoutMethod` (§3.3): they gate the **charging** variants of the control, not approval itself, under `WARN`.

Server-side rule: the approval route re-runs the full checklist before opening the transaction, and the transactional subset again inside it (last column). The UI checklist is a courtesy; the route is the enforcement.

### 3.3 The approve control — labels and disabled state

The control label always states the exact financial consequence, per the binding doc 03 §2.6 table. Verbatim for the immediate policy: **"Approve Revenue Review and charge the saved payment method"**, with method and amount adjacent ("Visa •••• 4242 — $412.50"). The seven other timing-policy variants are exactly doc 03 §2.6's wording table; this doc adds none and changes none.

**Disabled-state UX rule (spec Part S):** until every applicable check passes, the control is disabled and lists **all** currently failing checks at once, each with an actionable next step and a link that lands on the fix:

> Approve is unavailable — 3 items need attention:
> • Instructor time not confirmed — *Remind Alex Reeve* (last reminded 2d ago)
> • No payment method on file for payer Dana Marsh — *Send payment-method setup link*
> • Second approval required (total exceeds $2,500) — *Notify approvers*

Simpler-workflow choice: show every failing reason simultaneously rather than revealing them one at a time — a Director of Operations fixes a review in one pass, not four round-trips.

`approveWithoutMethod` interaction (D13, default `WARN`):

| Failing check | `WARN` (default) | `BLOCK` |
|---|---|---|
| 5 — saved method / consent | Control swaps to the truthful manual-invoice variant: "Approve Revenue Review and issue the invoice for manual payment", with an inline note "No saved payment method — falling back to manual invoice" | Control disabled with the reason and setup link |
| 6 — connected account not ready / `REVENUE_CHARGING=off` | Same manual-invoice fallback, note "Payment provider not configured — manual invoice only" | Control disabled |
| Any of 1–4, 7–10 | Control disabled — no fallback exists for an incomplete or irreconcilable review | Control disabled |

The label the approver clicks is always the consequence that will actually execute — a control that says "charge" while the engine would fall back to manual invoice is a design failure (principle 2).

### 3.4 The approval transaction

One `db.$transaction`, extending doc 03 §2.6 (binding) with the Part 2 items marked ●. **No Stripe/provider call anywhere inside** — Part AB auto-rejects "Stripe API call inside long database transaction," and ADR-011/ADR-025 already forbid it. All writes are local, fast, and index-backed; the transaction stays short.

| Step | Action | Notes |
|---|---|---|
| 1 | **Claim**: guarded `updateMany` from the expected status to `APPROVED`, keyed on `id + status + updatedAt` token; request carries `expectedTotal` | `count === 0` or total mismatch → 409 "This review changed since you loaded it — reload before approving." Optimistic concurrency: a stale screen can never approve unseen numbers |
| 2 | **Recompute** totals server-side in Decimal from `InvoiceLine` rows | Client figures never trusted; result must equal `expectedTotal` |
| 3 | **Re-verify** the transactional readiness subset (§3.2 last column) | Active approval kinds, instructor time, payer, currency equality |
| 4 | **Record approver + timestamp**: final `RevenueReviewApproval` row; `approvedAt`/`approvedById` on the review | Append-only; one active row per kind (partial unique) |
| 5 | **Snapshot rates/taxes/lines**: freeze `Invoice.subtotal/taxTotal/total/currency/approvedAt`, Invoice `DRAFT → OPEN`; write `approvalSnapshot` Json (lines + rate/tax provenance + payer + method + allocation preview + timing) · write `TaxSnapshot`(+Items) rows | Lines immutable hereafter; ADR-028 carve-out |
| 6 | **Snapshot payment timing**: `paymentPolicyAtApproval`, `scheduledChargeAt` on the review | Effective policy = org default or permitted per-review override |
| 7 | **Snapshot platform fee** ●: resolve the effective `PlatformFeePolicy` version (org override → plan → global default) and create `PlatformFee` `ACCRUED` with the full basis snapshot (`feePercentBps`, `feeFlatAmount`, `feeBase`, `appliedBaseAmount`, `policyId` + version) | doc 12 §2.3; `revenueReviewId @unique` — one fee per review. Fee math and richer Part W models live in the platform-fee doc; this TX only snapshots and accrues |
| 8 | **Write** `InstructorEarning` rows and the balanced APPROVAL `RevenueAllocation` set (engine guard: dimensions balance or the TX aborts) and the approval `LedgerEntry` journal via `src/lib/ledger.ts` | doc 12; sole ledger writer, same TX as the state change |
| 9 | **Create the payment-request OUTBOX record** ●: insert `ScheduledCharge` with write-once `policy`, `runAfter` (computed in org `timeZone`), `amount` (= frozen invoice total), `currency`, `paymentMethodReferenceId` | Created for **every** policy including `MANUAL_INVOICE` (one collection anchor per review). Zero-total review: born `COMPLETED`, no attempt will ever exist |
| 10 | **Mark review Approved or Payment Scheduled**: `APPROVED` for `IMMEDIATE_ON_APPROVAL` and `MANUAL_INVOICE`; `PAYMENT_SCHEDULED` for batch/`CUSTOM_DATE`/`MANUAL_CHARGE`; `PAID` for a zero-total review; Invoice status projection rides the same TX | Matches doc 03 §2.3 / doc 09 §2.2 exactly |
| 11 | (Deprecation window only) `Student.accountBalance` dual-write decrement | doc 09 §2.8 / doc 14 schedule; no new readers |
| — | **COMMIT** | |
| 12 | **Post-commit only**: `recordAudit('revenue_review.approved')`, `emitDomainEvent('revenue_review.approved')`, Trigger 1 payment-runner invocation for `IMMEDIATE_ON_APPROVAL` | Never inside the TX |

### 3.5 The outbox pattern — why `ScheduledCharge` is the payment request

The spec requires a "payment-request/outbox record" created in the approval transaction. Part 1's `ScheduledCharge` (13 §4.12) **is** that record; this doc formalizes the outbox semantics rather than adding a table:

- **Durable intent before any side effect.** The decision to charge is committed atomically with the approval. If the process dies one nanosecond after commit, the intent is not lost — it is a `SCHEDULED` row with `runAfter <= now`.
- **Recovery is re-reading, not remembering.** No in-memory state, event-bus delivery, or HTTP response carries the obligation to charge. Any later runner pass (Trigger 1 retry, Trigger 2 sweep, reconciliation) re-reads `ScheduledCharge WHERE status = 'SCHEDULED' AND runAfter <= now` and drives it forward. The in-process event bus is fan-out only, never payment truth (ADR-009).
- **At-least-once dispatch, at-most-once money.** The outbox makes the provider call *at-least-once*; the deterministic per-attempt idempotency key (§5) makes provider-side creation *at-most-once*. Together: exactly-once.
- **Crash between commit and provider call** — the exact scenario the spec names — recovers with zero operator action: the row sits visibly in the due-charges queue until a pass picks it up. Nothing is silently skipped, nothing double-fires.

Simpler-workflow choice: reuse `ScheduledCharge` as the outbox instead of adding a separate `PaymentRequest` table — an accountant investigating "did we charge this?" inspects **one** record that is simultaneously the schedule, the snapshot, and the outbox, instead of joining two.

### 3.6 The payment worker

There is no queue, cron, or worker runtime in the codebase (seams audit; doc 09 §2.9 designed for exactly this). The worker is a **pure engine with three interchangeable triggers**:

- **Engine:** `src/lib/payment-runner.ts` — `runDuePayments({ organizationId?, limit = 25 })`. Bounded passes, per-row outcome reporting (Import Center style), no unbounded `findMany`.
- **Trigger 1 — post-commit:** the approval route invokes the engine for that review's charge immediately after the approval TX commits (`IMMEDIATE_ON_APPROVAL` and human "Charge now").
- **Trigger 2 — API sweep:** `POST /api/revenue/payment-runs` (org-scoped, `revenue.charge`, `{ mutating: true }`) — the "Run due payments now" control; plus a platform-authorized cross-org sweep (`authorizePlatform`, `{ mutating: true }`) for operations.
- **Trigger 3 — scheduler adapter (deferred, D14):** Inngest invokes the identical engine when it lands; batch policies are withheld from orgs until then. No engine change, only a new caller.

**Per-charge execution contract** (each step's transaction boundary explicit):

| Step | Boundary | Action |
|---|---|---|
| W0 | no TX | **Pre-flight** (re-verifies the non-transactional readiness checks at run time): method still `ACTIVE`/unexpired/verified; off-session consent unrevoked (doc 20); connected account still `chargesEnabled`; adapter configured. Failure → guarded transition `SCHEDULED → AWAITING_MANUAL` with an audited machine-readable hold reason (`method_detached`, `consent_revoked`, `account_not_ready`), notification to `revenue.charge` holders, payer notified where actionable. **No attempt row is created and no provider call is made.** This edge is a Part 2 additive extension to doc 09 §2.3's graph (no new enum values) — a blocked charge lands in the manual queue with its reason instead of being retried forever or silently skipped |
| W1 | **[TX A]** short | Guarded claim `SCHEDULED/AWAITING_MANUAL/FAILED(retry) → PROCESSING` (`count === 0` → skip: another runner owns it). In the same TX: resolve `amount = min(ScheduledCharge.amount, Amount Due derived per doc 09 §2.8)` — if zero, resolve the charge `COMPLETED` and stop (no attempt); create `PaymentAttempt` (`attemptNumber = attemptCount + 1`, status `CREATED`, deterministic `idempotencyKey = "sc_<scheduledChargeId>_a<attemptNumber>"`, denormalized method snapshot, `trigger`, `initiatedByLabel`); compute and store `applicationFeeAmount` from the review's `PlatformFee` under its **snapshotted** policy version, re-based if `amount` differs from the accrual basis (fee doc owns the math); increment `attemptCount`, set `lastAttemptId`; write the review transition (`APPROVED/PAYMENT_SCHEDULED → PAYMENT_PROCESSING`). COMMIT |
| W2 | **no TX — provider call** | Adapter `createCharge()` (ADR-032 interface): create-and-confirm a PaymentIntent **on the org's connected account** (direct charge per the Connect ADR, doc 18 — `Stripe-Account` context from the doc 19 account record), `off_session: true`, saved `customerRef`/`methodRef`, `amount`/`currency` converted by the **single tested minor-units function** (13 §2.1 — the only place Decimal meets provider units), `application_fee_amount` = minor units of W1's `applicationFeeAmount`, **`Idempotency-Key` header = the attempt's `idempotencyKey`**, `metadata: { organizationId, paymentAttemptId, revenueReviewNumber }` (cross-check only — never attribution, doc 09 §2.10). **Mandatory timeout.** A timeout or crash leaves the attempt in `CREATED` — never synthesize a failure |
| W3 | **[TX B]** short | Record the outcome: store `providerPaymentIntentId` (`@@unique([provider, providerPaymentIntentId])`); guarded attempt transition `CREATED → PROCESSING` (+`processingAt`) on acceptance; **`CREATED → REQUIRES_ACTION`** (+`requiresActionAt = now`, `actionExpiresAt = requiresActionAt + CARD_ACTION_WINDOW_HOURS` = 72h) when an off-session intent returns `authentication_required` (off-session SCA / 3DS) — the review **stays** `PAYMENT_PROCESSING`, the attempt is **never auto-retried**, and the charge can still settle if the payer authenticates in-window (the settlement reduce accepts `REQUIRES_ACTION → SUCCEEDED`, doc 23); only on window expiry does the cross-org sweep fail it (`→ FAILED`, review `→ PAYMENT_FAILED`) for human retry per doc 21 §4.5 (the `REQUIRES_ACTION` enum + `requiresActionAt`/`actionExpiresAt` are owned by doc 34 §5.1; full card-flow handling in doc 21); or `CREATED → FAILED` (+`failureCode`/`failureMessage`) on a synchronous hard rejection (hard decline). On a `FAILED` outcome only, `ScheduledCharge → FAILED` and review `→ PAYMENT_FAILED` in the same TX, retry policy per doc 09 §2.7 (spec Part U doc owns escalation). COMMIT |
| W4 | **[ASYNC]** | **Await webhook.** Even a card intent that confirms synchronously is *not* marked paid here — final status is webhook-confirmed only (spec Part R / Part AB auto-reject "client redirect marks payment paid" generalizes to: no runner-side settlement). [23-webhooks-and-reconciliation.md](./23-webhooks-and-reconciliation.md) owns `PROCESSING → SUCCEEDED/FAILED`, the `Payment` row, Invoice `PAID`, review `CARD_PAID`/`ACH_PENDING`→`PAID`, `PlatformFee` `EARNED`, the settlement ledger journal, and receipts. Cards resolve in seconds; ACH sits in `PROCESSING` ~4 business days with the review in `ACH_PENDING` |

Post-W3 side effects (audit `revenue.charge_initiated`, `payment.failed` emit on synchronous failure, notifications) run post-commit, per house pattern.

### 3.7 Worker crash/retry matrix

The Reliability contract: at every crash point, recovery is deterministic, requires no human memory, and cannot double-charge. "Sweep" = Trigger 2 pass or the 23 reconciliation job.

| Crash / failure point | Observable state | Recovery | Double-charge risk |
|---|---|---|---|
| After approval COMMIT, before Trigger 1 runs | `ScheduledCharge SCHEDULED`, `runAfter <= now`; review `APPROVED` | Outbox re-read: next sweep claims and runs it | None — no provider call happened |
| Between TX A and the provider call (W2 never sent) | Charge `PROCESSING`, attempt `CREATED`, no `providerPaymentIntentId` | **Reconcile-then-proceed** on the *same* attempt: re-issue `createCharge` with the stored idempotency key. If the original request never reached the provider, this creates the intent; if it did, the provider returns the original. Never a parallel attempt (doc 09 §2.4) | None — same key, provider dedupes |
| Provider call timed out / crashed after send, before TX B | Same as above | Same reconcile-then-proceed. Caveat: Stripe idempotency keys dedupe for ~24 h — an attempt stuck `CREATED` longer than that must first be resolved by **searching provider objects by `metadata.paymentAttemptId`** before any re-issue (24-idempotency.md owns the stale-key procedure) | None within the key window; guarded by metadata search beyond it |
| After TX B (attempt `PROCESSING`), webhook lost/delayed | Attempt `PROCESSING`; review `PAYMENT_PROCESSING`/`ACH_PENDING` | Provider retries webhooks; the 23 reconciliation job polls provider state for attempts `PROCESSING` beyond the expected window and applies the terminal state through the same guarded reduce | None — reduce is a guarded claim, applies once |
| Two concurrent runners (operator + platform sweep, double-click on "Charge now") | One claims; the other's `updateMany` returns `count === 0` | Loser skips the row and reports "already in progress" | None — structural |
| Duplicate approval request (double-click, retried HTTP) | First TX wins; second claim 409s at step 1 | Client refreshes; `ScheduledCharge` uniques are the backstop — a second outbox row is impossible | None — spec Part AC test "duplicate approval does not duplicate payment" is satisfied structurally |
| W0 pre-flight fails at run time (method detached, consent revoked, account restricted between approval and batch run) | Charge `AWAITING_MANUAL` with hold reason | Human resolves (new method, re-consent, account fix) and re-initiates via `revenue.charge`; or converts to manual invoice / voids per doc 03 rules | None — no attempt was created |
| Review voided while `SCHEDULED`/`AWAITING_MANUAL` | Void TX (doc 03 §6.4) transitions the charge `→ CANCELLED` | Terminal; regeneration creates a new review + new charge | None — void is refused once an attempt is in flight or anything was collected |

### 3.8 Review-status outcomes after approval (summary)

| Policy | In the approval TX | After worker W1/W3 | After webhook (23) |
|---|---|---|---|
| `IMMEDIATE_ON_APPROVAL` | `APPROVED` | `PAYMENT_PROCESSING` (card) / `ACH_PENDING` (bank) or `PAYMENT_FAILED` | `CARD_PAID` → `PAID` (D4 timing) / `PAID` / `PAYMENT_FAILED` |
| Batch / `CUSTOM_DATE` | `PAYMENT_SCHEDULED` | same as above at `runAfter` | same |
| `MANUAL_CHARGE` | `PAYMENT_SCHEDULED` (charge `AWAITING_MANUAL`) | on human "Charge now" | same |
| `MANUAL_INVOICE` | `APPROVED` (Amount Due shown; Invoice `OPEN`, `dueAt` = +`manualInvoiceNetDays`) | n/a | n/a — offline recording or payer pay-now settles it |
| Zero total | `PAID` (charge born `COMPLETED`) | n/a | n/a |

Only the payment engine writes statuses 6–13/15 (doc 03); `Invoice.status` projection rides the same transaction as each review transition.

---

## 4. Configuration surface

No new configuration is introduced by this document. It consumes:

| Surface | Owner | Fields consumed here (defaults) |
|---|---|---|
| `OrgPaymentPolicy` (org-level singleton) | docs 09/13 §4.12 | `defaultTimingPolicy` (`IMMEDIATE_ON_APPROVAL`), `overridePolicies` (`[]`), batch hours/day, `retryMode` (`MANUAL_ONLY`), `maxAutoRetries` (0, cap 3), `autoRetryDelaysDays` (`[1,3,7]`), `approveWithoutMethod` (`WARN`), `manualInvoiceNetDays` (14), `customDateMaxDays` (30) |
| `RevenueWorkflowPolicy` (org-level singleton) | doc 03 §3 | Required approval kinds, `secondApprovalAmountThreshold`, `separationOfDutiesRequired` (true), `financeApprovalRequired` (false) — drives readiness check 3 |
| `PlatformFeePolicy` (platform-owned, versioned, effective-dated) | doc 12 / Part 2 platform-fee doc | Resolved + snapshotted at approval step 7. **Never org-editable** (`authorizePlatform` only — Part AB auto-reject otherwise) |
| Connected-account record | doc 19 | `status`, `chargesEnabled`, `providerAccountId`, `defaultCurrency` — readiness check 6 + W2 context |
| Env flags | doc 09 §3 / `src/lib/env.ts` | `REVENUE_CHARGING` (`off` default \| `test`; **no `live` value exists this phase**), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` — partial config fails loudly at boot |
| Runner pass limit | engine constant | 25 per pass (doc 09 §2.9) — deliberately not org-configurable |

D14 stands: batch timing policies are withheld from org selection until Trigger 3 (scheduler) lands; GA offers charge-immediately, manual charge, manual invoice.

---

## 5. Idempotency (charge operation; end-to-end registry in [24-idempotency.md](./24-idempotency.md))

### 5.1 Key derivation

Spec Part S requires stable keys derived from **(organization, approved Revenue Review, payment attempt number, operation type)**. Part 1 fixed the charge-operation format (ADR-033, binding — do not reinvent):

```
idempotencyKey = "sc_<scheduledChargeId>_a<attemptNumber>"
```

This satisfies the spec's derivation exactly: `scheduledChargeId` is 1:1 with the approved review (`revenueReviewId @unique`), which is org-scoped and 1:1 with its invoice and (via R4) its dispatch — so the key transitively encodes organization + review; `attemptNumber` is the attempt component; the `sc_`/`_a` shape is the operation-type discriminator (charge). The key is minted **inside TX A** on the `PaymentAttempt` row (`@unique`) and sent verbatim as the provider `Idempotency-Key` header — the same durable value gates both the local row and the provider object, so DB and provider can never disagree about which try a request belongs to. Retries are **new attempts** with `attemptNumber + 1` and fresh keys — a failed key is never reused for new money movement.

Other operation types (refund, method detach, account onboarding) follow the same `<operation>_<recordId>[_<n>]` deterministic convention; 24-idempotency.md owns that registry and the stale-key (>24 h) reconciliation procedure referenced in §3.7.

### 5.2 Duplicate-prevention matrix (spec Part S list, each tied to its mechanism)

| Duplicate prevented | Database enforcement | Provider enforcement |
|---|---|---|
| Duplicate **invoices** | One active review per dispatch (R4 partial unique); `RevenueReview.invoiceId @unique`; `Invoice @@unique([organizationId, number])` via `OrgSequence` | n/a — invoices are AeroOps-local records |
| Duplicate **payment intents** | `PaymentAttempt.idempotencyKey @unique`; `@@unique([provider, providerPaymentIntentId])` — a replayed provider response cannot mint a second local attempt | `Idempotency-Key` header: replayed create returns the original intent |
| Duplicate **charges** | `ScheduledCharge.revenueReviewId/invoiceId @unique` (one pipeline per review); `@@unique([scheduledChargeId, attemptNumber])` + guarded `updateMany` claims serialize attempts; stuck attempts block new ones | One confirm per intent; key dedupe on the create-and-confirm call |
| Duplicate **platform fees** | `PlatformFee.revenueReviewId @unique` (one accrual per review); `EARNED` stamped by the guarded settlement reduce (once) | `application_fee_amount` rides the PaymentIntent — it inherits the intent's idempotency; there is no separate fee call to duplicate |
| Duplicate **payouts** | AeroOps never initiates payouts (direct charges: Stripe pays out the connected account on its own schedule); the local mirror `ProviderPayout @@unique([organizationId, provider, providerPayoutId])` cannot record one payout twice | Provider-side entirely |
| Duplicate **refunds** | `Refund.adjustmentId @unique` (one execution per authorized refund adjustment); amount capped in-TX against prior succeeded/in-flight refunds | Deterministic refund idempotency key (refund doc + 24) |

Webhook replay safety (`PaymentProviderEvent @@unique([provider, providerEventId])`, `processedAt`-keyed reduce) is owned by 23; the attempt-level guarded claims above are what make its reduce idempotent.

---

## 6. Data model additions

### 6.1 Reused as bound — no changes

`ScheduledCharge`, `PaymentAttempt`, `PaymentCustomer`, `PaymentMethodReference`, `PaymentProviderEvent`, `RevenueReview`, `RevenueReviewApproval`, `Invoice`, `Payment`, `PlatformFee`, `RevenueAllocation`, `InstructorEarning`, `LedgerEntry`, `OrgPaymentPolicy`, `RevenueWorkflowPolicy` — all exactly as [13-database-model.md](./13-database-model.md) binds them. **This document introduces no new model.** The spec's PaymentRequest/outbox = `ScheduledCharge`; the spec's PaymentTransaction = extended `Payment` (R17).

### 6.2 Proposed additive columns on `PaymentAttempt` (final call: [34-part2-database-additions.md](./34-part2-database-additions.md))

```prisma
model PaymentAttempt {
  // ... exactly as 13 §4.12, plus:
  applicationFeeAmount Decimal? @db.Decimal(12, 2) // platform fee sent on THIS intent (W1);
                                                   // local expectation for FEE_MISMATCH reconciliation
  providerAccountId    String?                     // connected account (acct_...) the intent was created on;
                                                   // denormalized so attempt provenance survives account
                                                   // re-onboarding; webhook cross-check input (23)
}
```

Justification: Part AB requires the platform fee to be *reconciled*; `ReconciliationException.FEE_MISMATCH` needs a per-attempt local expectation (the accrued `PlatformFee.amount` can lawfully differ from a partial attempt's re-based fee). `providerAccountId` pins each attempt to the account it actually executed on — required for the 23 tenancy cross-check and for orgs that ever re-onboard a new connected account. Both nullable, additive, no backfill needed (null = pre-Part-2 rows / fee-free attempts).

### 6.3 Consumed models owned elsewhere

| Model | Owner | Fields this doc reads |
|---|---|---|
| Connected-account record (Part L expected name `PaymentCustomer`-adjacent; doc 19 names it — spec Part P) | doc 19 / 34 | `providerAccountId`, `status`, `chargesEnabled`, `defaultCurrency`, `requirementsDue` |
| Off-session consent record (spec Part Q) | doc 20 / 34 | active-consent lookup by (payer/student, method) for readiness check 5 and W0 pre-flight |

---

## 7. Validation & business rules

1. **Approval route**: requires `updatedAt` token + `expectedTotal`; recompute mismatch → 409. Negative totals blocked; zero totals need explicit confirmation and short-circuit to `PAID` (doc 09 §5.2).
2. **Amount resolution** (every charge path): `amount = min(ScheduledCharge.amount, derived Amount Due)` — server-resolved in Decimal, **never client-supplied** (Financial-gate auto-reject). Amount Due includes signed deltas of APPLIED post-approval adjustments, so a post-approval discount reduces what the runner charges (contract-tested, doc 09 §5.1.2).
3. **Currency**: one currency per document chain — review = invoice = charge = attempt, engine-enforced in-TX (13 §2.3). Minor-unit conversion happens only in the adapter via the single tested function.
4. **Consent**: no off-session charge without an active consent record (spec Part Q) — checked at readiness (check 5) *and* at W0, because consent can be revoked between approval and a scheduled run.
5. **Provider-call hygiene**: never inside a transaction; always with a timeout; always with the per-attempt idempotency key; timeout leaves `CREATED` for reconcile-then-proceed — never synthesize failure, never create a parallel attempt.
6. **Offline-payment interlocks** (doc 09 §5.1.8, restated as binding here): offline recording refused pre-approval (Invoice `DRAFT`, 409) and while an attempt is in `CREATED`/`PROCESSING` (409) — closes the double-collection window with a ~4-day ACH attempt in flight.
7. **Immutability**: nothing in the worker mutates approved snapshots. `ScheduledCharge` snapshot fields are write-once; the only permitted correction is re-pointing `paymentMethodReferenceId` in `FAILED`/`AWAITING_MANUAL`, audited (13 §4.12).
8. **State claims**: every transition that gates a side effect — approval claim, charge claim, attempt transitions, webhook reduce — is a guarded `updateMany` (`count === 0` → 409/skip). Static source-scan tests in the `tests/dispatch-idempotency.test.ts` style regress the approval route and runner shapes (spec Part AC; test plan doc owns the suite).

---

## 8. RBAC, approvals & audit

Permissions are data in `src/lib/permissions.ts` (no role-name checks); all mutations via `authorize(..., { mutating: true })` — read-only impersonation is refused automatically. No AI pathway may approve, charge, or mutate financial records (constitution rule 8).

| Action | Permission | Owner doc |
|---|---|---|
| Approve (any kind); the approve-and-charge control | `revenue.approve` (`revenue.approve_finance` for FINANCE; `revenue.approve_routine` for instructor-routine) | doc 03 §6.1. Approving a review whose snapshot says "charge immediately" **is** the human authorization for that charge — no separate grant needed on the policy path |
| Manual "Charge now", retry, cancel, run org due-payments pass | `revenue.charge` | doc 09 §6 |
| Cross-org sweep | `authorizePlatform` `{ mutating: true }` | doc 09 §6 |
| Edit `OrgPaymentPolicy` | `revenue.payment_policy_manage` | doc 09 §6 |
| Edit `PlatformFeePolicy` | platform roles only — **never** org staff | doc 12 / platform-fee doc |

Audit actions (all via `recordAudit`, reconstruct-without-DB-state metadata; doc 09 §6 table applies, plus):

| Action | When | Metadata |
|---|---|---|
| `revenue_review.approved` (existing) | Post-commit of the approval TX | approver, expectedTotal, policy, snapshot pointer |
| `revenue.charge_scheduled` | Approval creates the `ScheduledCharge` | policy, runAfter, method brand/last4, amount, currency |
| `revenue.charge_initiated` | W1/W3 | attemptId, attemptNumber, trigger, idempotencyKey, applicationFeeAmount, providerAccountId |
| `revenue.charge_held` **(new)** | W0 pre-flight moves `SCHEDULED → AWAITING_MANUAL` | hold reason code, actorLabel `system:payment-runner` |
| `revenue.charge_succeeded` / `revenue.charge_failed` | Terminal attempt state (webhook reduce, 23) | providerPaymentIntentId, failureCode; actorLabel `system:stripe-webhook` |

Domain events: `revenue_review.approved` (approval post-commit), `payment.succeeded`/`payment.failed` (emitted by 23's reduce, post-commit) — all registered in `WEBHOOK_EVENTS` with live emit sites (constitution-tested). Audit metadata never contains provider payloads, secrets, or anything beyond the safe-display allowlist.

---

## 9. Failure modes & edge cases

| Scenario | Behavior |
|---|---|
| Approver's screen is stale (line added by someone else) | 409 at claim: `updatedAt`/`expectedTotal` mismatch — reload and re-approve the corrected numbers; earlier approval kinds already superseded per doc 03 §2.7 |
| Allocation preview fails to balance (engine bug, exotic rounding) | Readiness check 9 disables the control; if it slips through, the in-TX balance guard aborts the approval — an unbalanced financial fact is never committed |
| Post-approval adjustment APPLIED before the charge runs | W1 amount resolution picks up the delta (`min(snapshot, Amount Due)`); platform fee re-based under the snapshotted policy version (fee doc) |
| Amount Due reaches zero before the run (offline payment settled it) | W1 resolves the charge `COMPLETED`; no attempt, no provider call |
| Connected account restricted between approval and a scheduled run | W0 → `AWAITING_MANUAL` (`account_not_ready`), org notified; nothing charged against a non-ready account (spec Part P) |
| Payer revokes off-session consent after approval | W0 → `AWAITING_MANUAL` (`consent_revoked`); payer offered on-session pay-now / method re-setup (docs 20/21) |
| Off-session card requires SCA (`authentication_required`) | **Not** a synchronous failure and **not** the hard-decline family. At W3 the attempt moves `CREATED → REQUIRES_ACTION` (not `FAILED`), the review **stays** `PAYMENT_PROCESSING`, and `actionExpiresAt = requiresActionAt + 72h` (`CARD_ACTION_WINDOW_HOURS`); never auto-retried. The charge can still settle if the payer authenticates in-window (settlement reduce accepts `REQUIRES_ACTION → SUCCEEDED`; enum owned by doc 34 §5.1). Only on window expiry does the cross-org expiry sweep fail it (`→ FAILED`, review `PAYMENT_FAILED`), after which the payer is offered an on-session path for human retry (doc 21 §4.5) |
| ACH attempt in flight for 4 business days | Review `ACH_PENDING` with the expected window shown; offline recording 409s; void refused; operational records fully usable throughout (spec Part R) |
| Stripe outage at charge time | Attempt stuck `CREATED`, visibly in the queue; reconcile-then-proceed via the stored key; timeout mandatory, failure never synthesized |
| `REVENUE_CHARGING=off` | Adapter absent; charging policies unavailable in readiness; approval still works via manual-invoice fallback (`WARN`) — schools without payments run the full review workflow unimpeded |
| Runner pass hits the 25-row limit | Remaining rows stay `SCHEDULED` and visible; next pass continues — bounded work, no starvation of visibility |
| Review voided while charge scheduled | Void TX cancels the charge (`CANCELLED`); refused once an attempt succeeded/in-flight or anything was collected — use the refund flow (doc 03 §6.4) |

---

## 10. UX notes

- **One truthful button.** The consequence-labeled control (§3.3) with amount + method adjacent is the single financial commitment point. A bare "Approve" or a label that doesn't match the engine's actual behavior is a design failure.
- **Every blocker, at once, with a fix.** The disabled control enumerates all failing checks with one-click next steps (§3.3). The approver never plays whack-a-mole.
- **"What happens next" timeline** on the approved review: Approved → charge scheduled (local time) → processing → paid, with the current step highlighted — a Director of Operations can answer a parent's "was I charged?" without opening Stripe. ACH shows the expected settlement window explicitly.
- **Due-charges queue** on the Revenue Dashboard: `SCHEDULED` past-due, `AWAITING_MANUAL` with hold reasons, failures with decline reason + retry, "Run due payments now" (`revenue.charge`). Batch-timing caveat (§4/D14) stated wherever a batch policy appears — nothing pretends a scheduler exists.
- **Held charges are loud.** A `charge_held` hold (consent revoked, method detached, account restricted) generates a notification and an amber queue chip with the reason and the fix link — money never pools silently.
- Statuses render via `STATUS_TONE` only; light/dark + mobile parity; loading/empty/error states included. Payer-facing copy says **Amount Due**, itemized; never "account balance"; raw provider errors never shown to students (spec Part U).

---

## 11. Out of scope for Part 2 / deferred to Part 3

- **Trigger 3 scheduler (Inngest)** driving batch cadences exactly on time; until then batch policies stay withheld (D14) and the sweep is the interim driver.
- **Dunning sequences and failure escalation policies** beyond the single-failure path — the Part U failure-workflow doc designs them; automated multi-step dunning executes in Part 3.
- **Email receipts** — no email adapter exists; in-app `Notification` rows only, "email sent" is never claimed.
- **Payer-initiated pay-now surfaces** beyond what doc 21 scopes for Part 2.
- **`WRITTEN_OFF`** — enum reserved, no writer in Parts 2–3.
- **Live charging** — `REVENUE_CHARGING` has no `live` value this phase; nothing here deploys; the Connect ADR requires owner review, an approved threat model before implementation, and legal/accounting review before any live launch.

---

## 12. Open questions

1. **(Owner)** **Hold vs auto-fallback for run-time pre-flight failures.** When a scheduled charge fails W0 (consent revoked, method detached, account restricted), this doc holds it in `AWAITING_MANUAL` with notification. Alternative: auto-convert to manual invoice (`dueAt` = +`manualInvoiceNetDays`). Recommendation: **hold + notify** — an operator decision about someone's money should be a human act; confirm.
2. **(Owner)** **Interim batch ownership** (inherited, doc 09 Q3 / D14): is the platform-staff sweep an acceptable interim driver if a pilot org is granted a batch policy before the scheduler lands, or are batch policies strictly withheld until Trigger 3? Recommendation: strictly withheld — simpler and honest.
3. **(Owner)** **Stale-attempt re-drive authority.** An attempt stuck `CREATED` past the ~24 h provider idempotency window requires the metadata-search reconciliation before re-issue (§3.7). May org staff with `revenue.charge` trigger that reconcile-then-proceed, or is >24 h staleness platform-staff-only? Recommendation: org staff may trigger it — the procedure is safe by construction — with the audit trail marking the staleness.
4. **(Coordination — 34)** Bind the two additive `PaymentAttempt` columns (`applicationFeeAmount`, `providerAccountId`, §6.2).
5. **(Coordination — 03/13)** Record the additive `ScheduledCharge` edge `SCHEDULED → AWAITING_MANUAL` (W0 hold) in the canonical state machine; no enum change, one new transition + `revenue.charge_held` audit action. If the Part 1 owners judge this a reinterpretation rather than an extension, the fallback is claim-then-immediate-`FAILED`-attempt with a local failure code — noisier for operators, hence not preferred.
6. **(Inherited)** D4 `CARD_PAID → PAID` roll-forward timing — owned by 23 + doc 03; either timing works with this workflow unchanged.
