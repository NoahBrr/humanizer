# End-to-End Idempotency — the Exactly-Once Proof

> **Status:** Proposed — Phase 8 Part 2 · **Date:** 2026-07-10 · **Lead roles:** Principal Software Architect at Stripe; Database Architect; Reliability/SRE Engineer · **Part of:** Revenue Engine design set ([README](./README.md))

---

## 1. Purpose & scope

This document is Part 2 deliverable 9: the single place that proves the whole Revenue Engine pipeline is exactly-once, from aircraft return closeout to settled money. It owns the idempotency requirements of spec Parts S and T and **every duplicate-prevention rule** anywhere in the Part 1 + Part 2 design set. If a Part 3 implementer wants to know "can this operation double-fire, and what stops it?", the answer is here — either directly or by a pointer to the owning doc.

It covers, per pipeline link:

- the failure/duplicate scenario the link defends against (double-click approve, worker crash mid-call, webhook replay, Stripe delivery retry, batch+manual runner overlap, network timeout with unknown outcome),
- the enforcing mechanism (database constraint vs. guarded state claim vs. provider idempotency key — and which one is the *primary* defense),
- what the operator sees when the guard fires,
- the recovery path.

It also fixes the canonical **idempotency key catalog** for every provider operation, the **unknown-outcome protocol** (network timeout after a provider call), and the key **TTL rules** that Stripe semantics impose.

**Not in scope here:** the webhook route/handler design (deliverable 8), the failure *workflow* after a decline (deliverable 10), refund/dispute workflow (deliverable 11), platform-fee commercial design (deliverable 12), and the funds-flow mechanics of the application fee (doc 18). This doc constrains those designs; it does not restate them. Final schema shapes for any NEW column proposed here belong to `34-part2-database-additions.md`.

### Design stance (binding on Parts 2–3)

1. **The database is the source of exactly-once truth.** Every duplicate is stopped by a unique constraint or a guarded `updateMany` claim before any provider key matters. Provider idempotency keys are a *network-boundary* defense only — Stripe retains keys for roughly 24 hours, so a key can never be the durable guarantee.
2. **Deterministic keys from durable columns.** Every provider idempotency key is computed from columns already committed to Postgres before the provider call is made. Never from timestamps, random values, or process memory. A crashed worker that restarts recomputes the identical key.
3. **A retry is a new row.** Attempt N+1 is a new `PaymentAttempt` with a new key. A key is never reused with different request parameters (Stripe rejects that with a 400 `idempotency_key_in_use`/parameter-mismatch error, and rightly so).
4. **Unknown outcome ⇒ reconcile, never assume.** A timeout after a provider call leaves the local record in its pre-response state. We never synthesize a failure, never create a parallel attempt, and never retry before fetching the provider's view.
5. **Idempotency is not configurable.** No org or platform setting can weaken any guard in this document. The only configurable neighbors are retry cadence and reconciliation staleness thresholds, which sit *behind* the guards.

North-star check: every guard here converts a scary race ("did we charge the student twice?") into a boring, visible outcome — a 409 with instructions, a queue row, or a silent no-op. That is what makes an accountant and a Director of Operations trust the system on day one.

---

## 2. Relationship to Part 1 docs (what this extends and finalizes)

| Part 1 doc | What it bound | What this doc does |
|---|---|---|
| [13-database-model.md](./13-database-model.md) §7 | The idempotency & uniqueness inventory; every constraint named below | **Finalizes** — adopts the inventory verbatim as the primary defense layer; adds zero new mechanisms, one shape gap flagged (§12 Q1) |
| [13-database-model.md](./13-database-model.md) §4.12 | `ScheduledCharge`, `PaymentAttempt`, `PaymentProviderEvent` shapes incl. `idempotencyKey` format | Consumed exactly as written |
| [09-payment-timing-and-collection.md](./09-payment-timing-and-collection.md) §2.3–2.4, §2.9–2.10 | Guarded claims, stuck-attempt rule, queue-less runner, webhook pipeline | **Extends** — adds the full reconcile-then-proceed algorithm, TTL branch, and metadata contract |
| [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) §2.6 | The single approval transaction and its guarded claim | Consumed; §5 link L2 documents its duplicate defenses end to end |
| [02-operational-dispatch-and-closeout.md](./02-operational-dispatch-and-closeout.md) | Closeout atomicity, guarded `RELEASED → CLOSED` claim (ADR-011/ADR-025) | Consumed; §5 link L1 |
| [08-adjustments-discounts-credits.md](./08-adjustments-discounts-credits.md) §3.7, V12 | `Refund.adjustmentId @unique` replay guard; "refund id as the provider idempotency key"; in-tx amount cap | **Finalizes** the refund key format (`rf_<refundId>`, §4) — a namespaced rendering of doc 08's contract, same derivation input |
| [12-revenue-allocation-and-reporting.md](./12-revenue-allocation-and-reporting.md) §2.3 | `PlatformFee` accrue-once / earn-at-collection lifecycle | Consumed; §5 link L9 proves accrue-once and collect-once |
| [15-adr-proposals.md](./15-adr-proposals.md) ADR-033 | Exactly-once chain via structural uniqueness + guarded claims + deterministic keys; key format `sc_<scheduledChargeId>_a<attemptNumber>` | This doc is ADR-033's working drawing — nothing here re-litigates it |
| [16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md) D21 | Supplementary delta-charge trigger | Idempotency anchor for the supplementary charge specified in §9; shape conflict recorded in §12 Q1 |

Part 2 siblings this doc constrains: the funds-flow design (doc 18 — application-fee collection mechanics), the approval-to-payment workflow (deliverable 7), the webhook design (deliverable 8), the failure workflow (deliverable 10), the refund/dispute workflow (deliverable 11), the platform-fee design (deliverable 12), the payment test plan (deliverable 18), and `34-part2-database-additions.md` (final call on any NEW schema shape referenced here).

---

## 3. The three enforcement mechanisms

Every duplicate-prevention rule in the pipeline is one of exactly three mechanisms. Implementers must not invent a fourth.

| Mechanism | What it stops | Failure surface when it fires | Durability |
|---|---|---|---|
| **M1 — Database unique constraint** (Prisma `P2002` on insert) | Two rows that must not both exist: second review for a dispatch, second `ScheduledCharge` for a review, second `Payment` for an attempt, second webhook-event row, second refund for an adjustment, second platform fee for a review | Insert fails inside the transaction → whole tx rolls back → route returns 409 with a state-specific message | Permanent — survives crashes, redeploys, multi-instance races, and time |
| **M2 — Guarded `updateMany` state claim** (`WHERE id = ? AND status = ?` → `count === 0` ⇒ 409, the ADR-011 dispatch-close idiom) | Two actors driving the *same row* through the *same transition*: double-click approve, batch + manual runner overlap, duplicate webhook reduce | Loser gets `count === 0` → 409 "already in progress / already completed — refresh" (routes) or a per-row skip report (runners) | Permanent — it is a conditional write, atomic in Postgres |
| **M3 — Provider idempotency key** (Stripe `Idempotency-Key` header, deterministic per §4) | The network boundary: a request that may or may not have reached Stripe (timeout, crash mid-call, HTTP retry) | Stripe replays the original response (same params) or returns 400 on parameter mismatch | **~24 hours only** (Stripe key retention). Never the primary defense — M1/M2 always sit in front of and behind it |

Ordering rule (binding): for any money-moving operation, the sequence is **M2 claim (tx) → M1-protected row insert carrying the key (same tx) → commit → M3-keyed provider call (outside any tx) → M2-guarded outcome recording (new tx)**. Spec Part AB auto-rejects a Stripe call inside a long database transaction; this ordering is also what makes crash recovery deterministic (§6).

---

## 4. The idempotency key catalog (canonical)

Spec Part S requires keys derived from **organization + approved Revenue Review + payment attempt number + operation type**. The Part 1 chain satisfies this by construction: `ScheduledCharge` is 1:1 with the Revenue Review (`revenueReviewId @unique`) and org-scoped, so `scheduledChargeId` uniquely determines the organization and the review; `attemptNumber` is explicit; the prefix encodes the operation type. The derivation below is therefore the spec's derivation, compressed through the 1:1 chain — no information is lost.

| # | Provider operation | Key format | Derivation inputs (all durable columns, committed before the call) | Stored where |
|---|---|---|---|---|
| K1 | Create/confirm PaymentIntent (charge, incl. `application_fee_amount`) | `sc_<scheduledChargeId>_a<attemptNumber>` (fixed by ADR-033) | `PaymentAttempt.scheduledChargeId`, `.attemptNumber` | `PaymentAttempt.idempotencyKey @unique` |
| K2 | Create Refund | `rf_<refundId>` | `Refund.id` (row created by the guarded `APPROVED → APPLIED` claim, doc 08 §3.7) | Derived — reconstructable from the row id at any time; no column needed |
| K3 | Create provider Customer | `cust_<orgId>_<party>_<partyId>` | `PaymentCustomer` party identity (XOR payer/student) | Derived; local dedupe is the triple unique on `PaymentCustomer` (R20) |
| K4 | Create hosted SetupSession | none required | — | Abandoned sessions create nothing financial; dedupe happens at attach time via `PaymentMethodReference @@unique([organizationId, provider, providerPaymentMethodId])` + `fingerprint` |
| K5 | Detach payment method | none required | — | Naturally idempotent at the provider; locally a guarded `ACTIVE → DETACHED` status claim |
| K6 | Payout / dispute objects | none — AeroOps never *creates* these | — | Ingest-side dedupe only: `ProviderPayout`/`Dispute`/`PaymentProviderEvent` uniques |
| K7 | Create connected account (Connect onboarding, doc 19 §3.4) | `ca_<organizationId>` | `ConnectedAccount.organizationId` (once per org) | Derived — local dedupe is `ConnectedAccount.organizationId @unique`; the `acct_…` id is recorded by doc 19 §3.4's TX-2 guarded claim |

**Key rules (binding, contract-tested):**

1. **Persisted-before-call.** The row carrying (or determining) the key commits before the provider call is dispatched. A worker crash at any point can recompute the exact key from the database.
2. **New attempt = new key.** Retry is `attemptNumber + 1` ⇒ `sc_<id>_a<n+1>`. Never reuse a key with different parameters — Stripe treats key + request-body as a unit and 400s on mismatch. Because the attempt's `amount` is server-resolved and frozen on the attempt row at claim time, a replay of the *same* attempt always sends the *same* body (from the row, never recomputed), and a changed amount (e.g., a post-approval discount applied between failures) always lands on a new attempt with a new key.
3. **TTL implications.** Stripe retains idempotency keys ~24 hours. Consequences: (a) a key replay is only a safe reconciliation tool *within* 24 h of first use — after that the same key would create a **new** PaymentIntent, so the recovery protocol (§6) forbids blind re-sends past the TTL and switches to fetch/search; (b) determinism across long time spans is irrelevant to correctness — M1/M2 carry the guarantee once the TTL lapses; (c) key uniqueness in *our* database is forever (`idempotencyKey @unique`), so an expired provider key still can never be reissued locally with different meaning.
4. **Metadata contract.** Every PaymentIntent AeroOps creates carries server-set metadata: `aerops_org`, `aerops_review`, `aerops_scheduled_charge`, `aerops_attempt`, `aerops_key`. Every Refund carries `aerops_refund`, `aerops_adjustment`, `aerops_org`. Metadata is used only (a) as a must-match cross-check during webhook tenancy resolution (doc 09 §2.10 — never for attribution) and (b) as the post-TTL search handle in the unknown-outcome protocol. Under direct charges the connected-account holder can technically edit metadata, which is exactly why it is never trusted as the lookup key — local `@@unique([provider, providerPaymentIntentId])` is.

Simpler-workflow choice: one deterministic key scheme for everything, derived from row identity — no stored random keys, no key-generation service, nothing an operator has to look up. When support asks "what key did attempt 2 send?", the answer is readable off the row.

---

## 5. The chain, link by link

The exactly-once chain (ADR-033):

```
Dispatch ──(1 active review per dispatch)──► RevenueReview ──(1:1)──► Invoice
   ──(1:1)──► ScheduledCharge ──(serialized attempts)──► PaymentAttempt
   ──(1:1)──► Payment ──(capped, keyed)──► Refund
                         └──(1 fee per review)──► PlatformFee
```

Async hops are marked ⚡ (provider call, outside any transaction) and ⇠ (inbound webhook). Each link: **scenario → mechanism → operator view → recovery**.

### L1 — Aircraft return closeout → one Revenue Review

- **Scenario:** dispatcher double-clicks "Close out", two browser tabs, a retried HTTP request after a slow response, or a later attempt to bill the same flight again.
- **Mechanism:** the closeout transaction (ADR-025) opens with the guarded `Dispatch` claim `RELEASED → CLOSED` (M2 — the pattern `tests/dispatch-idempotency.test.ts` already scan-enforces); inside the same tx the Draft `RevenueReview` + DRAFT `Invoice` are created under the partial unique `RevenueReview(dispatchId) WHERE status <> 'VOIDED'` (M1, R4) and `RevenueReview.invoiceId @unique` (M1). `RR-`/`INV-` numbers come from `OrgSequence` `UPDATE … RETURNING` inside the tx — gap-tolerant, never colliding (M1 on `[organizationId, number]`).
- **Operator sees:** second click → 409 "This dispatch is already closed — its Revenue Review is RR-1042" with a link. Nothing half-created: the claim is first, so the loser's tx writes nothing.
- **Recovery:** none needed. Re-billing a flight after a void is deliberate: `VOIDED` is excluded from the partial unique, so regeneration creates a new review — the only sanctioned "second review per dispatch".

### L2 — Approval: one financial snapshot, one payment request

- **Scenario:** double-click on "Approve Revenue Review and charge the saved payment method"; two approvers racing; a stale client approving a review whose lines changed underneath it.
- **Mechanism (one `db.$transaction`, doc 03 §2.6):**
  1. Guarded claim to `APPROVED` **plus** an `updatedAt` concurrency token **plus** an `expectedTotal` check (M2) — a stale or duplicate approval gets `count === 0`.
  2. All snapshot side effects ride the same tx, each with its own M1 backstop: `ScheduledCharge.revenueReviewId @unique` + `.invoiceId @unique` (the spec Part S "payment-request/outbox record" — one per review, ever, created for every timing policy), `PlatformFee.revenueReviewId @unique`, `InstructorEarning.timeEntryId @unique`, `TaxSnapshot` rows, `RevenueAllocation` `@@unique([setId, dimension, category])`, the balanced approval `LedgerEntry` journal. All-or-nothing: a crash mid-tx rolls back everything including the claim.
  3. Spec Part S's "verify no duplicate payment request exists" is thus **structural**, not a pre-read: the readiness evaluator surfaces it early for UX, but the transaction relies on the constraints, never on a check-then-act read.
- **Operator sees:** loser gets 409 "This review was already approved (or changed since you loaded it) — refresh to see its current state." The winner's approval proceeds normally.
- **Recovery:** none needed; the losing request had no effect. ⚡ The charge handoff is strictly post-commit (Trigger 1, doc 09 §2.9).

### L3 — Runner claim: batch, manual, and platform sweeps cannot overlap

- **Scenario:** the "Run due payments now" button is clicked while the post-commit immediate path is mid-flight; the platform cross-org sweep overlaps an org sweep; two app instances run passes concurrently.
- **Mechanism:** every entry to `PROCESSING` is the guarded claim `ScheduledCharge SCHEDULED|AWAITING_MANUAL|FAILED → PROCESSING` (M2). Exactly one claimant wins per charge, regardless of trigger. Passes are bounded (`limit` 25) with per-row outcomes — a skipped row reports "already claimed", never errors.
- **Operator sees:** manual trigger on an already-claimed charge → 409 "Charge already in progress or completed — refresh to see its current state." Sweep reports show `claimed: n, skipped-already-processing: m`.
- **Recovery:** none needed. A claimant that dies is the stuck-attempt case → L4/§6.

### L4 — Attempt creation + provider call: the crash-anywhere link

- **Scenario:** worker crashes after claiming but before calling Stripe; crashes mid-call; the HTTP call times out with unknown outcome; the process is restarted and re-runs the work.
- **Mechanism (order is the contract):**
  1. *(tx)* Claim the charge (L3) **and** insert the `PaymentAttempt` row — `attemptNumber` = `attemptCount + 1`, `@@unique([scheduledChargeId, attemptNumber])` (M1) serializes attempts; `idempotencyKey` (K1) and the server-resolved `amount` are frozen on the row. Commit.
  2. ⚡ Call `createCharge(...)` with the row's key as the `Idempotency-Key` header and the metadata contract, under a hard timeout (engine constant, 15 s).
  3. *(tx)* Record the outcome via guarded attempt claim `CREATED → PROCESSING|FAILED` (M2); store `providerPaymentIntentId` under `@@unique([provider, providerPaymentIntentId])` (M1 — one local attempt per provider intent, so even a reconciliation bug cannot attach one intent to two attempts).
  - A crash between 1 and 2: the attempt sits in `CREATED`; the key was never used; recovery replays the identical call (§6) — Stripe sees it once.
  - A crash/timeout during 2: outcome unknown; the attempt sits in `CREATED`; §6 applies. **Never synthesize a failure.**
  - A crash between 2 and 3: Stripe has the intent, we don't have the id; §6's key-replay/metadata-search finds it.
  - An attempt in `CREATED`/`PROCESSING` **blocks any new attempt** on the same charge (stuck-attempt rule, doc 09 §2.4) — resolution is reconcile-then-proceed, never a parallel attempt.
- **Operator sees:** the review's Payment section shows "Payment Processing — started 14:02" and, if stuck past the staleness threshold, a `ReconciliationException(STALE_PENDING_PAYMENT)` row appears in the reconciliation queue with a "Reconcile now" action. Retry buttons are disabled while an attempt is in flight, with the reason shown.
- **Recovery:** §6 protocol, then either adopt the provider outcome or cancel the attempt and allow attempt N+1.

### L5 — Webhook ingestion: replay-safe by unique insert

- **Scenario:** Stripe retries delivery (it retries for days on non-2xx); an attacker replays a captured payload; the same event arrives on two app instances simultaneously.
- **Mechanism:** signature verification **first** (M-none: 400, nothing stored; route inert without `STRIPE_WEBHOOK_SECRET`); then unique insert into `PaymentProviderEvent @@unique([provider, providerEventId])` (M1). Duplicate delivery hits `P2002`: if the stored row has `processedAt` set → 200 no-op; if `processedAt` is null (a prior reduce failed) → re-run the reduce, which is itself idempotent (L6). Tenancy resolves from local references only; metadata is a must-match cross-check — mismatch stores the event unprocessed with a `processingError`.
- **Operator sees:** nothing — this is the guard that must be boring. Platform staff can see duplicate-delivery counts in the reconciliation report; a signature failure is logged (structured, no secrets) and rate-limited.
- **Recovery:** stored-but-unprocessed events (`processedAt IS NULL`) are re-driven by the bounded reconciliation sweep, so an event is never permanently dropped even if Stripe stops retrying.

### L6 — Webhook reduce: idempotent handlers, forward-only state

- **Scenario:** the same event processed twice (replay + sweep racing); events arriving out of order (`payment_intent.succeeded` before a stale `.processing`); a crash after the reduce but "before" stamping `processedAt`.
- **Mechanism:** the reduce runs in its own transaction: guarded attempt-state claim (e.g., `PROCESSING → SUCCEEDED`, M2) + all settlement side effects (L7) + `processedAt` stamp **in the same tx** — so "reduced but not stamped" cannot exist; a crash rolls both back and the re-run is safe. Out-of-order or duplicate reduces get `count === 0` from the claim → the event is marked processed with a `stale-transition` note, a deliberate no-op. Unknown event types are stored, marked ignored, never errored. The in-process event bus is never inbound payment truth (ADR-009) — bus fan-out happens post-commit only.
- **Operator sees:** nothing for duplicates. Stale-transition no-ops are visible in the event log for forensics.
- **Recovery:** re-run is always safe; the sweep re-drives failures.

### L7 — Settlement side effects: paid once, fee earned once

- **Scenario:** duplicate `succeeded` events (L5/L6 already filtered most); a reconciliation fetch and a webhook racing to settle the same attempt.
- **Mechanism:** the single settlement transaction (whoever wins the M2 attempt claim `PROCESSING → SUCCEEDED`) creates the `Payment` row under `Payment.paymentAttemptId @unique` (M1 — one Payment per successful attempt, forever), flips Invoice/Review status, flips `PlatformFee ACCRUED → EARNED` via guarded claim (M2) stamping `earnedAt`, and writes the settlement ledger journal + PROCEEDS allocation set (`@@unique([setId, dimension, category])`, M1). One winner ⇒ every side effect exactly once.
- **Operator sees:** the review moves to Card Paid / Paid exactly once; the Revenue Dashboard's collected tile counts it once.
- **Recovery:** if a settlement tx partially fails it rolls back whole; the attempt stays `PROCESSING` and the sweep retries the reduce.

### L8 — Refunds: one refund per authorization, keyed execution

- **Scenario:** double-submit of "Issue refund"; the refund adjustment re-applied after a timeout; Stripe refund call times out; refund webhook replayed.
- **Mechanism:** the REFUND `RevenueAdjustment` applies via guarded `APPROVED → APPLIED` claim (M2) which creates the `Refund` row `PENDING` under `Refund.adjustmentId @unique` (M1 — retrying the request cannot mint a second refund); the amount cap (captured − prior succeeded/in-flight refunds, doc 08 V12) is computed inside that transaction. ⚡ Post-commit, the provider call carries key K2 (`rf_<refundId>`); the outcome records `providerRefundId` and drives `PENDING → PROCESSING → SUCCEEDED|FAILED` through guarded claims fed by the L5/L6 pipeline. `MANUAL`/`CUSTOMER_CREDIT` destinations settle without a provider call (and `CustomerCredit.originAdjustmentId @unique` stops double credit issuance).
- **Operator sees:** duplicate submit → 409 "A refund for this adjustment already exists (Refund pending — see its status)." Over-cap request → 422 with the computed remaining refundable amount.
- **Recovery:** timeout on the provider call → the refund sits `PENDING` with the unknown-outcome protocol (§6, using `rf_<refundId>` within the TTL, metadata search after); the reconciliation sweep flags stale `PENDING` refunds.

### L9 — Platform fee: snapshotted once, collected once

- **Scenario:** duplicate approval trying to accrue two fees; duplicate settlement trying to earn the fee twice; a refund reversing the fee twice.
- **Mechanism:** *accrue-once* — the fee row is created in the approval tx under `PlatformFee.revenueReviewId @unique` (M1) with the full basis snapshot (policy version, bps, base). *Collect-once* — the fee is **not** a separate provider operation: under the D1 topology it rides the PaymentIntent as `application_fee_amount` (mechanics in doc 18), so collection inherits the charge's entire idempotency stack (K1 + L4 + L7); `EARNED` is flipped by the single settlement tx's guarded claim (M2), including for offline cash/check collections (guarded claim in the offline-payment tx). *Reverse-once* — reversals adjust the cumulative signed `reversedAmount` inside the refund settlement tx, bounded by `effective fee ≥ 0`, under the same single-winner claim.
- **Operator sees:** platform staff see one fee per review in the Platform Console, with accrual and earned timestamps; orgs see the fee once on their statement. Never double-billed, never labeled a Stripe fee.
- **Recovery:** none needed beyond the charge's own recovery — the fee has no independent failure mode by construction. Simpler-workflow choice: riding the charge (no separate fee transfer) removes an entire class of "fee collected but charge failed" reconciliation work.

### L10 — Retries: new attempt, new key, never a duplicate charge

- **Scenario:** auto-retry slot and a manual retry racing; a retry fired while the previous attempt's outcome is unknown; a hard decline retried by an eager operator.
- **Mechanism:** a retry requires the previous attempt to be **terminal** (`FAILED`/`CANCELLED`) — an in-flight attempt blocks (L4). The retry path is `ScheduledCharge FAILED → SCHEDULED` (auto slot) or a direct guarded claim to `PROCESSING` (manual), then L3/L4 as normal with `attemptNumber + 1` and a fresh key. Auto/manual overlap collapses to the L3 claim — one winner. Hard declines (`stolen_card`, `pickup_card`, `invalid_account`, ACH `R02`/`R03`/`R04`) are never auto-retried; the method goes `SUSPENDED`.
- **Operator sees:** retry on an in-flight or completed charge → 409 with the current state; retry after a hard decline → the button is replaced by "Ask the payer to update their payment method", with the safe decline reason.
- **Recovery:** covered by L4/§6.

### L11 — Offline recording vs. the automated pipeline

- **Scenario:** a front-desk cash payment recorded while a card attempt is mid-flight (double collection); an offline payment recorded against a DRAFT invoice.
- **Mechanism:** the offline-payments route refuses (409) while any attempt on the invoice's charge is `CREATED`/`PROCESSING`, and refuses pre-approval (Invoice `DRAFT`) — doc 09 §5.1.8. When offline payments settle the invoice, the `ScheduledCharge` moves `AWAITING_MANUAL|FAILED → COMPLETED` via guarded claim, closing the window where the runner could still charge.
- **Operator sees:** "A card payment for this invoice is processing — wait for its result before recording an offline payment."
- **Recovery:** none needed.

### L12 — Payout, dispute, and account events

- **Scenario:** replayed `payout.paid`, duplicate dispute events, repeated `account.updated`.
- **Mechanism:** all arrive through L5/L6. `ProviderPayout @@unique([organizationId, provider, providerPayoutId])` and `Dispute @@unique([provider, providerDisputeId])` (M1) make ingestion upsert-shaped: first event inserts, later events update status forward through guarded claims. `account.updated` reduces onto the connected-account status record last-write-wins **by Stripe's event `created` timestamp**, never by arrival order.
- **Operator sees:** one payout row, one dispute row, current account status — regardless of delivery weather.

---

## 6. The unknown-outcome protocol (binding)

Applies to any keyed provider call (charge K1, refund K2, customer K3) that ends in timeout, connection error, 5xx, or process death — any result other than an authoritative provider response.

**Never assume failure. Never create a parallel object. Reconcile via provider fetch before any retry.**

Numbered protocol (charge shown; refunds are identical with `rf_` keys and `providerRefundId`):

1. *(state)* The attempt remains `CREATED` (or `PROCESSING` if the intent id was stored before the loss). No status is synthesized. The stuck-attempt rule blocks new attempts.
2. *(detect)* Detection is threefold: the failed call's own error handler logs and returns a per-row "unknown outcome — queued for reconciliation" result; the reconciliation sweep selects attempts in `CREATED`/`PROCESSING` older than the staleness threshold and opens `ReconciliationException(STALE_PENDING_PAYMENT)`; an operator can trigger "Reconcile now" from the review.
3. *(resolve — decision tree, each step ⚡ outside any tx)*
   - **a. Intent id stored?** Fetch the PaymentIntent by `providerPaymentIntentId`; adopt its true state via the normal guarded reduce (L6). Done.
   - **b. No intent id, key age < TTL (24 h from `PaymentAttempt.createdAt`)?** Re-send the **identical** request — same key, same body reconstructed from the attempt row's stored `amount`/`currency`/method/metadata, never recomputed. Stripe returns the original outcome if the first call landed, or executes once if it never arrived. Either way: exactly one intent. Record and reduce.
   - **c. No intent id, key age ≥ TTL?** Blind re-send is now **forbidden** (it would mint a second intent). Search the connected account for a PaymentIntent with `metadata.aerops_attempt = <attemptId>`. Found → adopt (store the id under the `@@unique([provider, providerPaymentIntentId])` guard, reduce). Not found → the call provably never landed: guarded claim `CREATED → CANCELLED` with reason `unknown-outcome-expired`, which unblocks attempt N+1 (new row, new key).
4. *(record)* Every resolution writes `recordAudit` (`revenue.payment_attempt.reconciled`) with the branch taken, and resolves the `ReconciliationException` with a required note (auto-filled for automatic resolutions).

Race safety inside the protocol itself: two reconcilers (sweep + operator button) racing land on the same guarded claims — one wins, the other no-ops. Adoption of a found intent is M1-protected, so one provider intent can never attach to two attempts.

Operator view: the review shows "Payment outcome unknown — reconciling with the provider" (never "failed"); the payer sees nothing until truth is known. This is the single scariest race in the system rendered as a calm queue item.

---

## 7. Summary table — operation × key × constraint × recovery

| Operation | Provider key | Primary uniqueness constraint (M1) | Concurrency guard (M2) | Recovery path |
|---|---|---|---|---|
| Close dispatch → create review + invoice | — | Partial unique `RevenueReview(dispatchId) WHERE status <> 'VOIDED'`; `RevenueReview.invoiceId @unique`; `@@unique([organizationId, number])` | `Dispatch RELEASED → CLOSED` claim | Re-request is a 409 no-op; void → regenerate creates the sanctioned new review |
| Approve review (snapshot + payment request) | — | `ScheduledCharge.revenueReviewId/.invoiceId @unique`; `PlatformFee.revenueReviewId @unique`; `InstructorEarning.timeEntryId @unique`; allocation `@@unique([setId, dimension, category])` | Review claim → `APPROVED` + `updatedAt` token + `expectedTotal` | Tx is all-or-nothing; loser 409s; re-approve after rollback is safe |
| Runner claims a due charge | — | — | `ScheduledCharge → PROCESSING` claim | Loser skips/409s; dead claimant handled as stuck attempt |
| Charge (PaymentIntent, incl. application fee) | `sc_<scheduledChargeId>_a<n>` | `PaymentAttempt @@unique([scheduledChargeId, attemptNumber])`; `.idempotencyKey @unique`; `@@unique([provider, providerPaymentIntentId])` | Attempt `CREATED → PROCESSING/FAILED` claim | §6 protocol: fetch by id → key replay (<24 h) → metadata search → cancel & new attempt |
| Settle payment | — (⇠ webhook) | `Payment.paymentAttemptId @unique` | Attempt `PROCESSING → SUCCEEDED` claim (one settlement tx) | Duplicate events no-op; sweep re-drives unprocessed events |
| Webhook ingest | — | `PaymentProviderEvent @@unique([provider, providerEventId])` | `processedAt`-keyed reprocessing rule | Sweep re-runs `processedAt IS NULL` rows |
| Refund | `rf_<refundId>` | `Refund.adjustmentId @unique`; in-tx amount cap | Adjustment `APPROVED → APPLIED` claim; refund status claims | §6 with refund object; stale `PENDING` flagged by sweep |
| Platform fee accrual | — | `PlatformFee.revenueReviewId @unique` | rides the approval tx | rides approval recovery |
| Platform fee collection / reversal | inherits K1 / rides refund tx | same row (cumulative signed `reversedAmount`) | `ACCRUED → EARNED` claim; reversal in single refund-settlement tx | inherits charge/refund recovery — no independent failure mode |
| Provider customer create | `cust_<orgId>_<party>_<partyId>` | `PaymentCustomer` triple unique (R20) | check-local-first, insert under unique | Post-TTL duplicate `cus_` object is a harmless orphan; local row wins |
| Method save (hosted setup) | — | `PaymentMethodReference @@unique([org, provider, providerPaymentMethodId])` + fingerprint dedupe | status claims | Abandoned sessions are inert |
| Offline payment record | — | — | 409 while attempt in flight or invoice DRAFT; `ScheduledCharge → COMPLETED` claim on settle | none needed |
| Credit apply / promo redeem | — | `CreditApplication @@unique([creditId, revenueReviewId])`; `PromoCodeRedemption @@unique([promoCodeId, revenueReviewId])` | apply claims | 409 no-op |
| Payout / dispute ingest | — (⇠) | `ProviderPayout @@unique([org, provider, providerPayoutId])`; `Dispute @@unique([provider, providerDisputeId])` | forward-only status claims by event `created` | replay no-ops |
| Zero-total review | — (no attempt ever) | `ScheduledCharge` born `COMPLETED` in approval tx | approval claim | none — no provider surface exists |
| Supplementary delta charge (D21) | `sc_<supplementaryChargeId>_a<n>` (same K1 scheme) | one supplementary charge per adjustment (shape: §9/§12 Q1) | same L3/L4 claims | same as charge |

---

## 8. Configuration surface

Idempotency itself has **no configuration** — deliberately. What is configurable sits behind the guards:

| Setting | Level | Home (Part 1-bound) | Default | Idempotency relevance |
|---|---|---|---|---|
| `retryMode`, `maxAutoRetries`, `autoRetryDelaysDays` | Org | `OrgPaymentPolicy` | `MANUAL_ONLY`, 0, `[1,3,7]` | Governs *when* attempt N+1 is created — never whether it gets a fresh key/row |
| Reconciliation staleness thresholds (days) | Org | `RevenueSettings` (5/7 per doc 13) | 5 / 7 | When a stuck attempt/refund opens a `ReconciliationException` |
| Runner pass bound | Platform (engine constant) | `src/lib/payment-runner.ts` | 25 rows/pass | Bounds sweep work; no correctness effect |
| Provider call timeout | Platform (engine constant) | provider adapter | 15 s | Triggers the unknown-outcome protocol; never synthesizes failure |
| Key TTL horizon | Fixed by Stripe | protocol constant `IDEMPOTENCY_KEY_TTL_HOURS = 24` | 24 h | The §6 branch boundary — codified as a named constant with a contract test, not a magic number |
| `REVENUE_CHARGING` | Env | `off` \| `test` | `off` | Off = adapter absent; every guard above still holds for manual-invoice/offline flows |

No org- or platform-editable setting may disable a unique constraint, a guarded claim, key determinism, or the §6 protocol. Spec Part AB treats "missing idempotency" and "payment retry can duplicate charge" as automatic rejections; this table is the complete list of adjacent knobs, so an auditor can verify nothing else exists.

---

## 9. Data model additions

**Headline: none.** Every constraint this design relies on already exists in [13-database-model.md](./13-database-model.md) (§7 inventory, shapes in §4.12/§4.10/§4.13). That is the point — the exactly-once property was designed into the Part 1 schema, and this document is the proof that the inventory is sufficient. No new tables, no new key-storage columns (`rf_`/`cust_` keys are derivable from row ids; only `PaymentAttempt.idempotencyKey` is stored, as Part 1 bound, because the attempt row predates the intent id).

One shape gap requires a decision in `34-part2-database-additions.md` (recorded as a conflict in §12 Q1): doc 08 §3.4 designed the **supplementary delta charge** (collecting an upward correction on a paid review, D21) as a second `ScheduledCharge` with a nullable `adjustmentId` and "at most one supplementary charge per adjustment" semantics — but canonical doc 13 shipped `ScheduledCharge.revenueReviewId @unique` with no `adjustmentId` column, which structurally forbids any second charge on a review. Proposed additive resolution, final call owned by doc 34:

```prisma
model ScheduledCharge {
  // ... exactly as bound in 13 §4.12, plus:
  adjustmentId String?            // null = the original per-review anchor
  adjustment   RevenueAdjustment? @relation(fields: [adjustmentId], references: [id], onDelete: Restrict)
}
```

```sql
-- Replaces the plain unique on revenueReviewId (raw SQL in the migration,
-- same governance-allowlist path as the two Part 1 partial uniques):
CREATE UNIQUE INDEX "ScheduledCharge_review_anchor_key"
  ON "ScheduledCharge"("revenueReviewId") WHERE "adjustmentId" IS NULL;   -- one original anchor per review
CREATE UNIQUE INDEX "ScheduledCharge_adjustment_key"
  ON "ScheduledCharge"("adjustmentId") WHERE "adjustmentId" IS NOT NULL;  -- one supplementary charge per adjustment
-- Invoice anchor: same treatment for invoiceId.
```

Idempotency consequences are unchanged either way: the supplementary charge reuses the entire L3–L7 stack and the K1 key scheme with its own `scheduledChargeId`, so delta collection inherits exactly-once for free. Until doc 34 rules, no implementation may assume either shape.

---

## 10. Validation & business rules

| # | Rule (binding on Part 3 implementation) |
|---|---|
| I1 | Key formats in §4 are frozen. `sc_<scheduledChargeId>_a<attemptNumber>` is ADR-033's format, verbatim. A pure key-derivation module (`src/lib/payment-idempotency.ts`-shaped, framework-free) is the single source; contract tests pin every format string. |
| I2 | The key-carrying row commits before the provider call. Static source-scan test (the `dispatch-idempotency.test.ts` idiom) asserts the runner/refund engines contain no provider-adapter call inside a `$transaction` callback, and that attempt insertion precedes the adapter call. |
| I3 | Replay of an in-flight operation sends the request body reconstructed from the stored row — never recomputed from current invoice state. |
| I4 | A key is never reused with different parameters; a changed amount requires a new attempt row. Contract test: post-approval APPLIED discount between attempt 1 (failed) and attempt 2 yields a *lower* amount on attempt 2 with a *new* key. |
| I5 | No status is ever synthesized from a timeout. `FAILED` requires an authoritative provider response or webhook. Enforced by code review + the §6 protocol tests. |
| I6 | Blind key replay past `IDEMPOTENCY_KEY_TTL_HOURS` is forbidden (protocol branch c). Contract test on the branch function with a fixed clock. |
| I7 | Webhook reduce and `processedAt` stamp share one transaction; reduces are forward-only (stale transitions no-op). Part AC tests: webhook replay, out-of-order delivery, duplicate approval does not duplicate payment, idempotency-key reuse, failed-payment retry. |
| I8 | Every guarded-claim 409 carries an actionable, state-specific message (§13) — a bare "Conflict" is a design failure, same rule as the approve-control wording. |
| I9 | All duplicate-prevention tests run without a database or live Stripe credentials: pure key/branch/reducer functions with literal fixtures, plus static scans for route/engine shape (repo testing standards; spec Part AC). |
| I10 | Reconciliation resolutions require a note (`ReconciliationException` contract) and an audit row; automatic resolutions auto-fill both. |

---

## 11. RBAC, approvals & audit

No new permission keys — this design rides the doc 09 catalog:

| Action | Permission / gate |
|---|---|
| Manual charge, manual retry, "Run due payments now" (org) | `revenue.charge`, `authorize({mutating: true})` |
| "Reconcile now", resolve/ignore `ReconciliationException` | `revenue.reconciliation_manage`, `{mutating: true}` |
| Cross-org payment sweep, cross-org reconciliation sweep | `authorizePlatform({mutating: true})`; restricted-org scoping enforced |
| Webhook routes | PUBLIC (signature-verified), catalogued in `tests/constitution.test.ts` `PUBLIC_ROUTES` with written reason; rate-limited; inert without secret |
| Read-only impersonation | blocks every mutation above, including reconcile actions |

Audit actions (all `recordAudit`, reconstruct-without-DB-state metadata): `revenue.payment_attempt.created`, `.reconciled` (with §6 branch), `.cancelled_unknown_outcome`, `revenue.scheduled_charge.claimed` (runner passes log per-row; individual claims are attempt-level), `revenue.refund.executed`, `revenue.reconciliation.exception_opened/resolved`. Domain events unchanged from Part 1 (`payment.succeeded`/`payment.failed`, `reconciliation.exception_opened`) — post-commit only, never inbound truth.

Duplicate-*approval* prevention is separation-of-duties territory owned by doc 03 (approval kinds, `supersededAt`, `SECOND ≠ OPERATIONS`); this doc adds nothing there beyond the L2 transaction guards.

---

## 12. Failure modes & edge cases

| Crash/failure point | Outcome | Why it's safe |
|---|---|---|
| Crash inside approval tx | Full rollback incl. status claim | Single `$transaction`; re-approve starts clean |
| Crash after approval commit, before immediate charge trigger | Charge sits `SCHEDULED`, visible in the due queue | Trigger 1 is best-effort; Trigger 2 sweep picks it up — nothing silently skipped |
| Crash after runner claim, before attempt insert | Impossible as distinct state — claim and insert share one tx | L4 step 1 |
| Crash after attempt insert, before provider call | Attempt `CREATED`, key unused | §6 branch b replays; ≥ TTL branch c cancels safely (nothing existed) |
| Timeout / crash during provider call | Attempt `CREATED`, outcome unknown | §6; new attempts blocked meanwhile |
| Crash after provider call, before outcome tx | Intent exists, id unrecorded | §6 branch b/c finds it (key replay or metadata search); adoption is M1-guarded |
| Webhook lost entirely (provider gave up) | Attempt stuck `PROCESSING` | Reconciliation sweep fetches by stored intent id (branch a) |
| Two app instances race any transition | One winner | M2 claims are atomic conditional writes in Postgres — no coordination needed |
| Stripe returns 409 `idempotency_key_in_use` (concurrent identical replay) | Treat as "in flight": back off, re-fetch | Both callers were replaying the same attempt; state converges via branch a |
| Stripe returns key/parameter-mismatch 400 | `ReconciliationException`, attempt frozen, page platform staff | Indicates an I3/I4 violation — a bug, never auto-resolved |
| Clock skew across instances | None on correctness | No guard depends on wall-clock ordering; TTL branch uses `createdAt` vs. now with the 24 h constant conservatively (skew ≪ hours) |
| ACH return after settlement (NACHA late return) | Reversal-shaped event → adjustment/dispute path | Settled `Payment` never edited; doc 08/09 contracts |
| Org wiped mid-flight | Restrict chain refuses; wipe waits for terminal states | Doc 13 §8 FK policy; `PaymentProviderEvent` survives (SetNull, audit-grade) |
| In-memory rate limiter on webhook route under multi-instance burst | Per-instance limiting only | Acceptable: the limiter protects compute, not correctness — dedupe is M1. Noted for the Part 3 Redis swap |

---

## 13. UX notes

- **Guards read as state, not errors.** Every 409 names the current state and the next step: "This review was already approved — refresh", "Charge already in progress — refresh to see its current state", "A refund for this adjustment already exists." No stack traces, no "Conflict".
- **Unknown outcome is calm.** The review shows "Payment outcome unknown — reconciling with the provider" with a timestamp, never a red "Failed". Payers/students see nothing until truth is known, and never a raw provider error (Part U).
- **The reconciliation queue is an operator surface, not a log.** `ReconciliationException` rows appear on the Revenue Dashboard operations queue with one-click "Reconcile now"; resolutions demand a note. A flight-school accountant should be able to work this queue without knowing what an idempotency key is.
- **Duplicate protection is invisible when it works.** Webhook replays, sweep overlaps, and double-clicks produce no toast, no noise — silence is the feature. Forensics live in the audit trail and event log for platform staff.
- **Honest batch limitation** (doc 09 §2.9) stays surfaced: due charges are visible until run; nothing pretends a cron exists.

---

## 14. Out of scope for Part 2 / deferred to Part 3

- Implementation of every engine, route, test, and migration named here (Part 2 is design-only; Stripe test mode only; nothing deployed; no live charges).
- The Inngest scheduler adapter driving unattended reconciliation/batch cadence (D14) — until it lands, sweeps run from post-commit triggers and the API/manual passes; stuck attempts older than the staleness threshold rely on the queue being *looked at* (mitigated by dashboard prominence and notifications).
- Redis-backed rate limiting and any multi-instance coordination beyond Postgres claims (single-node assumption documented; correctness already multi-instance-safe via M1/M2).
- Dunning schedules, OVERDUE automation, email receipts (no email adapter exists).
- `/api/v1` public-API `Idempotency-Key` request headers (API_STANDARDS aspirational item) — unrelated to provider-side keys; nothing here blocks it.

---

## 15. Open questions

1. **[Part 1 conflict — needs doc 34 arbitration]** Supplementary delta-charge anchor: doc 08 §3.4 requires a second `ScheduledCharge` per REFUND-opposite (upward) adjustment with `adjustmentId` semantics; canonical doc 13 `ScheduledCharge.revenueReviewId @unique` forbids any second charge and carries no `adjustmentId`. §9 proposes the partial-unique pair (raw SQL, additive column). Doc 13 wins until `34-part2-database-additions.md` (with the doc-13 refresh owner) rules; D21's auto-vs-manual trigger choice (Head of Product) determines whether the anchor is even created automatically.
2. **[Product owner]** Reconciliation attention SLA before the scheduler lands: is "exception visible on the dashboard + notification to Finance roles" acceptable for GA pilots, or does an unresolved `STALE_PENDING_PAYMENT` older than N days need to pull the Inngest adapter forward from Part 3? (Money can sit in "outcome unknown" only as long as a human looks at the queue.)
3. **[Product owner, with doc 18]** When the §6 protocol cancels an expired unknown-outcome attempt and later discovers a matching intent was created anyway (metadata search false-negative window — e.g., connected-account metadata was stripped), the remedy is an automatic refund of the orphaned charge. Confirm auto-refund is acceptable without a human approval step in this one narrow case (it is the only path where AeroOps initiates a refund without an operator's REFUND adjustment), or require the exception queue to demand a human click. Recommendation: human click — volume will be ~zero and trust beats speed here.
