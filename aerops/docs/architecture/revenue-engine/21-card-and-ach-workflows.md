# Card & ACH Workflows

> **Status:** Proposed — Phase 8 Part 2 · **Date:** 2026-07-10 · **Lead roles:** Principal Payments Architect at Stripe; Reliability/SRE Engineer; Financial UX Designer · **Part of:** Revenue Engine design set ([README](./README.md))

This document owns spec **Part R — Card and ACH Behavior** (Part 2 deliverables 5 and 6). It defines the rail-level behavior of the two payment rails that ride Part 1's collection pipeline: the **card** workflow (including 3-D Secure requires-action handling for off-session charges and the decline-message catalog) and the **ACH Direct Debit** workflow (including verification gates, the pending window, R-code returns, and the late-return reversal path). Everything here is design only: Stripe **test mode** is the only sanctioned environment, nothing deploys, no live charge is ever created, and `REVENUE_CHARGING` has no `live` value in this phase.

The one-sentence contract of this document: **a Revenue Review is marked paid by a webhook-confirmed provider event and by nothing else** — cards just make you wait seconds and ACH makes you wait days, and every surface tells the truth about which wait the customer is in.

---

## 1. Purpose & scope

### In scope

- The **card payment state machine**: the seven provider-level states from spec Part R (`Requires payment method`, `Requires confirmation`, `Requires action`, `Processing`, `Succeeded`, `Failed`, `Canceled`) mapped onto `PaymentAttempt` statuses ([13-database-model.md](./13-database-model.md) §4.12) and Revenue Review statuses ([03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) §2.2).
- The binding **webhook-truth rule**: webhook-confirmed (or reconciliation-pass provider-read-confirmed) status is the only source of paid truth; a client redirect or a synchronous confirm response never marks anything paid (spec Part AB auto-reject).
- **Requires-action (3DS/SCA) handling for off-session charges**: pending representation, payer notification, completion paths available in Part 2, and the expiry policy.
- **Decline classification**: card decline codes and ACH return codes (R-codes) → retry eligibility, method consequences, consent consequences, and safe customer-facing messages.
- The **ACH Direct Debit state machine**: the ten spec states (`Setup pending`, `Verification required`, `Ready`, `Payment processing`, `ACH pending`, `Succeeded`, `Failed`, `Returned`, `Disputed`, `Canceled`) mapped onto method status, attempt status, and review status; the hard rule that initiation never marks paid.
- **Expected-processing-window display**, ACH return handling, and the **late-return-after-apparent-settlement reversal path** (referencing [26-refunds-voids-disputes.md](./26-refunds-voids-disputes.md) and [28-revenue-allocation-ledger.md](./28-revenue-allocation-ledger.md)).
- Per-rail display requirements and the guarantee that **operational records remain complete regardless of rail state**.
- Finalization of open decision **D4** ([16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md) §2): card-first launch, ACH behind org opt-in, `CARD_PAID` → `PAID` at capture, ACH `PAID` only at settlement.

### Out of scope (owned by siblings)

| Concern | Owner |
|---|---|
| Hosted method setup, instant vs micro-deposit verification mechanics, off-session consent records, consent revocation storage | [20-payment-methods-and-consent.md](./20-payment-methods-and-consent.md) |
| The approval transaction and approval-to-runner handoff | Part 2 approval-to-payment workflow doc (deliverable 7); Part 1 contract in [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) §2.6 and [09-payment-timing-and-collection.md](./09-payment-timing-and-collection.md) §2.1 |
| Webhook route, signature verification, `PaymentProviderEvent` ingestion, tenancy resolution, reconciliation job | Part 2 webhook design doc (deliverable 8); Part 1 contract in [09-payment-timing-and-collection.md](./09-payment-timing-and-collection.md) §2.10 |
| Failure escalation policies (booking blocks, financial holds, dunning UX) | Part 2 failure workflow doc (deliverable 10) |
| Refund/void/dispute execution mechanics, evidence workflow, provider refund limits | [26-refunds-voids-disputes.md](./26-refunds-voids-disputes.md) |
| Platform-fee math, rail-differentiated fees, fee reversal mechanics | Part 2 platform-fee doc (deliverable 12) with [12-revenue-allocation-and-reporting.md](./12-revenue-allocation-and-reporting.md) |
| Allocation sets, settlement journals, reversing journals | [28-revenue-allocation-ledger.md](./28-revenue-allocation-ledger.md) |
| Instructor-compensation recognition policies (including "held until ACH settles") | Part 2 instructor-compensation doc (deliverable 14) |
| Notification kinds and delivery | Part 2 notification doc (deliverable 16) |
| Final Prisma shapes for the additive deltas proposed in §7 | [34-part2-database-additions.md](./34-part2-database-additions.md) |

---

## 2. Relationship to Part 1 docs

This document **extends** Part 1 by filename and re-litigates nothing:

| Part 1 doc | What this doc consumes / extends |
|---|---|
| [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) | The 16-value `RevenueReviewStatus` machine and its payment-engine-owned transitions (statuses 6–13, 15) are consumed **exactly as written**. This doc adds no review status. One genuine gap between docs 03 and 09 (the `Paid → Payment Failed` late-return edge) is recorded in §13, not silently resolved. |
| [09-payment-timing-and-collection.md](./09-payment-timing-and-collection.md) | The collection pipeline (§2.1), `ScheduledCharge`/`PaymentAttempt` machines (§2.3–2.4), review-status mapping (§2.5), ACH windows (§2.6), retry policy (§2.7), webhook pipeline contract (§2.10), and readiness engine (§5.2) are the substrate. This doc adds the provider-state layer per rail on top of them. |
| [13-database-model.md](./13-database-model.md) | Canonical for every model/enum/status name used here. §7 proposes three small **additive** deltas (a `PaymentAttemptStatus` value, three `PaymentAttempt` columns, one `OrgPaymentPolicy` column, one `Refund` field pair); final shape call belongs to [34-part2-database-additions.md](./34-part2-database-additions.md). |
| [16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md) | **Finalizes D4** per its recommendation (§4.1 below) and implements the R6 mitigations (ACH return timing vs recognition). |
| [08-adjustments-discounts-credits.md](./08-adjustments-discounts-credits.md) | The `RevenueAdjustment` umbrella is the only correction mechanism; provider-initiated reversals in §5.7 materialize through it. |
| [07-tax-model.md](./07-tax-model.md) | The reversal-TaxSnapshot-in-same-transaction invariant applies to the late-return reversal path. |
| [11-responsible-payers.md](./11-responsible-payers.md) | Payer identity, notification capability flags, and the five-identity separation. |
| [14-migration-plan.md](./14-migration-plan.md) | All §7 deltas ride migration M13 (payment collection) — the enums and models involved have not shipped, so no separate enum-value migration is triggered (the two-step rule applies only to values added to *existing* enums). |

**What this document finalizes** (previously open): D4 (§4.1); the requires-action design for off-session card charges (§4.5); the ACH R-code catalog and NACHA re-presentment cap (§5.6); the late-return reversal path (§5.7); rail-level staleness clocks for the reconciliation job (§5.5, consumed by the webhook/reconciliation doc).

---

## 3. Shared rail rules

These rules apply to both rails and are restated once so the per-rail sections stay concrete.

1. **Webhook truth only.** A `PaymentAttempt` reaches `SUCCEEDED` — and a `Payment` row, fee earning, settlement journal, and `PAID` review status exist — only via (a) a signature-verified provider webhook event reduced through the [09 §2.10] pipeline, or (b) the reconciliation pass reading the provider object directly (a server-side provider API read — still provider truth). A synchronous `createCharge` response reporting success is recorded as advisory metadata (`providerStatus`) and changes no financial state. A client redirect or browser callback is never an input to payment state at all. (Spec Part R; Part AB auto-rejects "client redirect marks payment paid".)
2. **Failure asymmetry.** Synchronous *failures* are terminal-safe and recorded immediately (`CREATED → FAILED` on a synchronous decline) — failing fast releases nothing and unblocks the failure workflow. Synchronous *successes* are never terminal. The webhook reduce is idempotent against both orderings via the guarded claim.
3. **Exactly-once is structural** (ADR-033, [13-database-model.md](./13-database-model.md) §7): guarded `updateMany` claims on every transition, deterministic idempotency key `sc_<scheduledChargeId>_a<attemptNumber>` sent as the provider `Idempotency-Key` header, `@@unique([provider, providerPaymentIntentId])`, `Payment.paymentAttemptId @unique`. No rail introduces an alternative idempotency mechanism.
4. **No provider call inside any DB transaction.** Every provider call carries a timeout; a timeout leaves the attempt in `CREATED` for reconcile-then-proceed ([09 §2.4]) — never synthesize a failure, never create a parallel attempt.
5. **One failure catalog.** `src/lib/payment-failure-catalog.ts` (new, pure, contract-tested — no DB): `classifyCardDecline(code)` and `classifyAchReturn(code)` return `{ class, autoRetryEligible, suspendMethod, revokesConsent, payerMessage, staffGuidance }`. Unknown codes classify conservatively: no auto-retry, generic payer message, staff review. Raw provider error strings never reach payers or students (spec Part U); org staff see the `failureCode` plus catalog guidance. Per R25, the classification is derived at read/decision time from the stored `failureCode` — no category column is stored.
6. **Minor-units conversion happens only in the provider adapter** — one tested function `(Decimal, currency) → provider integer units` (ADR-027). All local storage stays `Decimal(12,2)` + ISO 4217 `Char(3)`.
7. **Charges execute on the org's connected account** (direct charges with `application_fee_amount`, per the Part 2 Connect ADR — deliverable 1 — following D1's recommendation), so the school's statement descriptor appears on the payer's statement. A recognizable descriptor is itself dispute prevention; descriptor configuration is owned by the Connect onboarding doc (deliverable 3).

---

## 4. Card payments (Part 2 deliverable 5)

### 4.1 Rail profile and the D4 finalization

Cards authorize and capture in seconds, but the *confirmed* outcome still arrives as a `payment_intent.succeeded` / `payment_intent.payment_failed` webhook. Declines are synchronous most of the time; 3DS challenges are rare for US-issued cards but must be handled correctly for off-session charges; chargebacks arrive weeks later as disputes (owned by [26-refunds-voids-disputes.md](./26-refunds-voids-disputes.md)).

**D4 is finalized here as recommended in [16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md):**

- **Card-first launch.** Card is the default rail; ACH is available only behind explicit org opt-in (`OrgPaymentPolicy.achDebitEnabled`, §6).
- **`PAID` at card capture.** When the settlement reduce processes `payment_intent.succeeded`, it records the `PAYMENT_PROCESSING → CARD_PAID` transition and immediately rolls `CARD_PAID → PAID` **inside the same reduce transaction** — two audited transitions, one transaction. The payer and the org see **Paid** the moment the webhook lands; `CARD_PAID` never rests as a visible status at GA. It remains in the enum as the audited waypoint doc 03 defines and as structural headroom for a future settlement-based recognition policy. *Simpler-workflow choice: one fewer status for a Director of Operations to learn; the audit trail still records both edges.*
- **ACH reaches `PAID` only on settlement** (§5) — the `ACH_PENDING` status exists for exactly this.

### 4.2 Card state machine — spec states mapped to Part 1 statuses

The spec's seven card states are Stripe PaymentIntent lifecycle states. AeroOps charges off-session with a saved method (`confirm: true` at creation), so two of the seven are transient by construction and observable only after a crash. The full mapping:

| Spec Part R state | Provider meaning in our off-session flow | `PaymentAttemptStatus` | `ScheduledCharge` | Revenue Review status | Written by |
|---|---|---|---|---|---|
| Requires payment method (pre-attempt) | No saved method exists — no PaymentIntent is ever created | *(no attempt)* | `SCHEDULED`/`AWAITING_MANUAL` | Approved / Payment Scheduled, readiness `NOT_READY` ([09 §5.2]; `approveWithoutMethod` WARN → effective policy `MANUAL_INVOICE`) | Readiness engine |
| Requires payment method (post-decline) | Stripe returns the intent to `requires_payment_method` with `last_payment_error` after a decline | `FAILED` (+ `failureCode`) | `FAILED` | **Payment Failed** | Sync outcome tx or webhook reduce |
| Requires confirmation | Transient — we create-and-confirm in one call; observable only if the process crashed between create and confirm | `CREATED` (stuck) | `PROCESSING` | Payment Processing | Reconcile-then-proceed (§10 row 2) |
| Requires action | Off-session confirm raised `authentication_required`; intent parked at `requires_action` | **`REQUIRES_ACTION`** (new value, §7) | `PROCESSING` | Payment Processing (badge: "bank verification required") | Sync outcome tx |
| Processing | Intent accepted, capture in flight (usually seconds) | `PROCESSING` | `PROCESSING` | **Payment Processing** | Claim tx / sync outcome tx |
| Succeeded | `payment_intent.succeeded` webhook | `SUCCEEDED` | `COMPLETED` | **Card Paid → Paid** (same tx, §4.1) | Webhook reduce only |
| Failed | `payment_intent.payment_failed` webhook, or synchronous decline | `FAILED` | `FAILED` | **Payment Failed** | Webhook reduce or sync outcome tx |
| Canceled | Intent canceled before confirmation — review voided or operator cancel | `CANCELLED` | `CANCELLED` | Voided (void path) / Payment Failed (action-window expiry, which cancels the intent provider-side but records `FAILED` locally with `failureCode = authentication_not_completed` — the payer never authenticated, so the failure workflow must engage) | Void/cancel tx; expiry sweep |

The review status machine is untouched: every review transition above already exists in [03 §2.3]. Requires-action is represented at the **attempt** level; the review deliberately stays `PAYMENT_PROCESSING` (an attempt is genuinely in flight, waiting on the customer). *Simpler-workflow choice: no 17th review status — the queue card carries a "bank verification required" chip driven by the attempt state instead.*

### 4.3 Card charge sequence (transaction boundaries marked)

Immediate-on-approval path shown; batch/manual paths differ only in what triggers step 2 ([09 §2.2]).

1. **[tx A — approval transaction]** (owned by [03 §2.6] / the approval-to-payment doc): review claimed to `APPROVED`, snapshot frozen, `ScheduledCharge` created (`SCHEDULED`, method/amount/currency snapshotted). No provider calls. Commit.
2. **[tx B — claim transaction]** (payment runner, post-commit): guarded `updateMany` claims `ScheduledCharge SCHEDULED → PROCESSING`; inserts `PaymentAttempt` (`CREATED`, `attemptNumber`, idempotency key `sc_<id>_a<n>`, amount = `min(snapshot, Amount Due)` server-resolved, method display snapshot); guarded claim moves the review `APPROVED/PAYMENT_SCHEDULED → PAYMENT_PROCESSING`. Pre-flight validation runs here (method `ACTIVE`, not expired, org-owned, currency match — [09 §5.1]); a pre-flight failure short-circuits: attempt `CREATED → FAILED` with a **local** `failureCode` (`expired_card`, `method_unavailable`) and no provider call, review → `PAYMENT_FAILED`. Commit.
3. **[async — provider call, no transaction]**: `createCharge` → Stripe `paymentIntents.create` on the connected account: saved customer + method, `off_session: true`, `confirm: true`, `application_fee_amount`, `metadata: { organizationId, paymentAttemptId, revenueReviewId }` (cross-check only, never attribution — [09 §2.10.3]), `Idempotency-Key` header, mandatory timeout.
4. **[tx C — sync outcome transaction]**, keyed by the sync result:
   - Intent accepted (`processing` or even `succeeded` in the response): guarded claim `CREATED → PROCESSING`; store `providerPaymentIntentId` + `providerStatus`. **Even a synchronous `succeeded` writes only `PROCESSING`** — rule 3.1. If the claim count is 0 because the webhook already terminalized the attempt (§10 row 1), this is a benign no-op, not a 409.
   - Synchronous decline (`card_error`): guarded claim `CREATED → FAILED`, `failureCode`/`failureMessage` stored; `ScheduledCharge PROCESSING → FAILED`; review `PAYMENT_PROCESSING → PAYMENT_FAILED`.
   - `authentication_required`: guarded claim `CREATED → REQUIRES_ACTION`; `requiresActionAt = now`, `actionExpiresAt = now + 72h`; store intent id + `providerStatus = 'requires_action'`. Review stays `PAYMENT_PROCESSING`.
   - Timeout / network error / process crash: no write — attempt stays `CREATED`; reconcile-then-proceed (§10 row 2).
   - Post-commit: `recordAudit`, notifications per outcome (deliverable 16), `payment.failed` emit on failure.
5. **[async — webhook]** `payment_intent.succeeded` arrives at the Connect webhook route (deliverable 8): signature verified → `PaymentProviderEvent` unique-insert → tenancy resolved from the local attempt via `providerPaymentIntentId`.
6. **[tx D — settlement reduce transaction]**: guarded claim attempt `IN (CREATED, PROCESSING, REQUIRES_ACTION) → SUCCEEDED` (`settledAt`); create the 1:1 `Payment` row; `ScheduledCharge → COMPLETED`; review `PAYMENT_PROCESSING → CARD_PAID → PAID` (both edges audited, §4.1); `Invoice → PAID`; `PlatformFee ACCRUED → EARNED` (`earnedAt`); settlement allocation records and the balanced settlement journal via `src/lib/ledger.ts` per [28-revenue-allocation-ledger.md](./28-revenue-allocation-ledger.md); instructor-compensation recognition hook for payment-conditioned policies (deliverable 14). All local DB writes; commit; mark the provider event `processedAt`.
   - Post-commit: `recordAudit('revenue.charge_succeeded', actorLabel: 'system:stripe-webhook')`, `emitDomainEvent('payment.succeeded')`, receipt notification.
7. **[async — reconciliation backstop]** (deliverable 8): attempts sitting in `PROCESSING` past the staleness clock (§5.5) are resolved by reading the provider object directly and running the same reduce; `payment_intent.payment_failed` events run the failure reduce (attempt → `FAILED`, charge → `FAILED`, review → `PAYMENT_FAILED`, retry per [09 §2.7]).

### 4.4 The webhook-truth rule, stated for implementers

- `PaymentAttempt.status = SUCCEEDED`, the `Payment` row, `Invoice.PAID`, review `CARD_PAID`/`PAID`, `PlatformFee.EARNED`, and the settlement journal have **exactly two writers**: the webhook reduce (tx D) and the reconciliation pass running the identical reduce from a provider API read. Nothing else — not the sync response handler, not any UI callback, not any route — may write them. Contract test (deliverable 18): static source scan asserting the settlement reduce is the only code path that sets `PaymentAttemptStatus.SUCCEEDED` (the `tests/dispatch-idempotency.test.ts` idiom).
- There is **no client redirect in the off-session flow at all** — charges are initiated server-side against saved methods. When Part 3 adds payer-facing pay-now/authentication surfaces, the browser return URL renders "Payment processing — we'll confirm shortly" and polls read models; it never posts a state change.

### 4.5 Requires-action (3DS) for off-session charges

What happens when an off-session charge needs authentication:

1. **Detection** — step 4 of §4.3: Stripe raises `authentication_required`; the intent parks at `requires_action`. Attempt → `REQUIRES_ACTION` (guarded claim), `actionExpiresAt = requiresActionAt + 72 hours`. *Simpler-workflow choice: a fixed 72-hour platform constant (`CARD_ACTION_WINDOW_HOURS = 72`, `src/lib/payment-runner.ts`) instead of an org knob — 3DS is rare on US cards, and one well-chosen default beats a setting nobody understands.*
2. **Pending representation** — the review stays **Payment Processing**; the review's Payment section, the Operations queue card, and the dashboard show a "Bank verification required — expires Jul 13, 9:14 AM" chip from the attempt state. The charge is visibly in flight; nothing looks stuck silently.
3. **Notify** — post-commit: in-app `Notification` to the payer's linked `User` (when one exists, per [11-responsible-payers.md](./11-responsible-payers.md) capability flags) and to org roles configured by the failure-workflow doc (deliverable 10). Payer copy: "Your bank requires verification to complete this payment." No production email exists; nothing claims an email was sent (spec Part AA).
4. **Completion** — the settlement reduce accepts `REQUIRES_ACTION → SUCCEEDED`, so *any* authenticated completion confirmed by webhook settles normally. **Part 2 honesty:** with no payer portal until Part 3, there is no in-product surface on which the payer can complete 3DS; the org-facing UI says so ("The payer's bank needs them to verify this charge. If they can't, add a different payment method or switch to manual invoice."). The Part 3 payer surface completes the intent by fetching a **fresh client secret from the provider at render time** — the secret is never persisted (principle 8: no client secrets stored after use).
5. **Expiry** — a bounded sweep in the payment-runner/reconciliation pass selects `REQUIRES_ACTION` attempts past `actionExpiresAt`:
   - **[async]** cancel the PaymentIntent at the provider (idempotent; timeout).
   - **[tx]** guarded claim `REQUIRES_ACTION → FAILED`, `failureCode = 'authentication_not_completed'` (local catalog code); `ScheduledCharge PROCESSING → FAILED`; review `PAYMENT_PROCESSING → PAYMENT_FAILED`. Post-commit: audit (`revenue.charge_action_expired`), notifications, `payment.failed` emit. The normal failure workflow (retry with another method, manual invoice, offline collection) takes over.
   - **Race:** if the provider cancel returns "already succeeded" (the payer authenticated at the last moment), the sweep does **not** fail the attempt — it runs the settlement reduce from provider truth. The provider serializes the outcome; guarded claims keep the local transition exactly-once.
6. **Never auto-retried** — `authentication_required` is not a decline; an automatic retry would hit the same challenge. Retry after expiry is human-driven (`revenue.charge`) and the readiness panel steers toward a different method.

### 4.6 Decline categories → safe customer-facing messages

Catalog classes (card). "Auto-retry" means eligible for the org's `AUTO` retry schedule ([09 §2.7]); manual retry by `revenue.charge` holders is always allowed unless noted.

| Class | Example `failureCode`s | Auto-retry | Method consequence | Payer/student-facing message (verbatim catalog) | Staff guidance |
|---|---|---|---|---|---|
| `SOFT_DECLINE` | `insufficient_funds`, `generic_decline`, `do_not_honor`, `try_again_later`, `withdrawal_count_limit_exceeded` | Yes | None | "Your card was declined. Please try a different card or contact your bank." (`insufficient_funds` variant: "Your card was declined due to insufficient funds.") | Retry per schedule or ask payer for another method |
| `HARD_DECLINE` | `stolen_card`, `lost_card`, `pickup_card`, `fraudulent`, `restricted_card`, `security_violation`, `merchant_blacklist` | **Never** | `PaymentMethodReference → SUSPENDED` (system, audited) | "This card was declined. Please use a different payment method." — **the fraud signal is never disclosed to the payer** | Code visible to org staff; do not retry this method, ever; collect via another method or offline |
| `CARD_DATA` | `expired_card`, `incorrect_number`, `invalid_account`, `card_not_supported`, `currency_not_supported`, `incorrect_cvc` | No | None (readiness already flags expiry from stored `expMonth`/`expYear`) | "This card has expired. Please update your payment method." / "This card can't be used for this payment. Please add a different payment method." | Payer must re-add the method via hosted setup ([20-payment-methods-and-consent.md](./20-payment-methods-and-consent.md)) |
| `AUTHENTICATION_REQUIRED` | `authentication_required` | Never (see §4.5.6) | None | "Your bank requires additional verification for this payment." | §4.5 flow |
| `PROCESSING_ERROR` | `processing_error`, `issuer_not_available`, `reenter_transaction` | Yes (transient) | None | "There was a temporary problem processing your payment." + consequence-truthful retry line ("We'll retry automatically on Jul 12." only when a retry is actually scheduled) | Retry; escalate to ReconciliationException if repeated |
| `CONTACT_BANK` | `call_issuer`, `pickup_card` excluded (hard) | No | None | "Your card was declined. Please contact your bank, or use a different payment method." | Manual retry only after the payer reports resolution |
| *(unknown code)* | anything unlisted | No | None | "Your card was declined. Please try a different payment method or contact your school." | Staff review; catalog gets extended by PR with contract test |

Hard-decline handling matches [09 §2.7] exactly: never auto-retried, method `SUSPENDED` pending payer action.

### 4.7 Card display requirements

- Review Payment section pre-approval: "Visa •••• 4242, exp 04/28" (display allowlist only) with readiness chips; approve control wording verbatim per [03]/[09 §7] — "**Approve Revenue Review and charge the saved payment method**" with method and amount adjacent.
- In-flight: **Payment Processing** badge (existing `STATUS_TONE` entry); requires-action chip when applicable (§4.5.2).
- Terminal: **Paid** with paid-at timestamp and receipt link; **Payment Failed** with the catalog payer message on payer-visible surfaces and `failureCode` + staff guidance on org surfaces, plus the three actions from [09 §7]: retry, choose another method, switch to manual invoice.

---

## 5. ACH Direct Debit (Part 2 deliverable 6)

### 5.1 Rail profile

ACH is asynchronous end to end. A debit initiated today typically settles in **~4 business days** (Stripe standard ACH debits); it can return (fail) throughout that window; unauthorized-debit returns can arrive up to **60 calendar days** after settlement on consumer accounts (NACHA), and consumer ACH disputes are final — there is no evidence/representment path. Bank accounts also require **verification** before first use. Every design choice below follows from those three facts. ACH is **off by default** and enabled per org (`achDebitEnabled`, §6) per D4; risk register R6's mitigations are implemented here.

**The two hard rules (spec Part R + Part AB):** initiation never marks anything paid, and nothing anywhere treats ACH as instant settlement.

### 5.2 Method-level states — setup pending / verification required / ready

Owned by [20-payment-methods-and-consent.md](./20-payment-methods-and-consent.md); consumed here as the charging gate.

| Spec state | Meaning | `PaymentMethodReference` representation | Chargeable? |
|---|---|---|---|
| Setup pending | Hosted setup session started (provider-hosted surface — AeroOps never renders bank fields), not yet completed | No row yet (row created on completion webhook/return, per doc 20) | No |
| Verification required | Micro-deposit verification in progress: descriptor-code deposit typically lands in 1–2 business days; payer enters the code on the hosted surface. (Instant verification via Stripe Financial Connections skips this state entirely.) | `status = REQUIRES_VERIFICATION` | **No** — readiness `NOT_READY` for ACH ([09 §5.2]); runner pre-flight refuses |
| Ready | Verified; off-session debit consent recorded (consent record + NACHA authorization language per doc 20) | `status = ACTIVE` | Yes, if `achDebitEnabled` and consent unrevoked |

Verification failure or abandonment leaves/returns the row to `REQUIRES_VERIFICATION`/`DETACHED` per doc 20. This doc adds one rail rule: **a debit is never initiated against a non-`ACTIVE` bank method** (V1, §8) — belt (readiness) and suspenders (runner pre-flight).

### 5.3 Payment-level state machine — spec states mapped to Part 1 statuses

| Spec Part R state | Provider meaning | `PaymentAttemptStatus` | `ScheduledCharge` | Revenue Review status | Written by |
|---|---|---|---|---|---|
| Payment processing | Runner claimed the charge; debit submission in flight (seconds) | `CREATED` | `PROCESSING` | **Payment Processing** | Claim tx |
| ACH pending | Provider accepted the debit (intent status `processing`); the ~4-business-day window is open | `PROCESSING` | `PROCESSING` | **ACH Pending** (`ACH_PENDING`) — **never Paid** | Sync outcome tx (webhook `payment_intent.processing` reduce is an idempotent confirm) |
| Succeeded | `payment_intent.succeeded` webhook — funds settled | `SUCCEEDED` | `COMPLETED` | **Paid** (single edge `ACH_PENDING → PAID`; no ACH analog of `CARD_PAID`) | Webhook reduce only |
| Failed | Synchronous rejection at submission (rare: method unusable, consent revoked) | `FAILED` (local or provider code) | `FAILED` | **Payment Failed** | Sync outcome tx |
| Returned | `payment_intent.payment_failed` with an R-code during the pending window | `FAILED` (`failureCode = 'R01'…`) | `FAILED` | **Payment Failed** | Webhook reduce |
| Disputed | Unauthorized-debit return, including after apparent settlement (§5.7) | attempt stays `SUCCEEDED` (settled fact); reversal appended | `COMPLETED` (settled fact) | **Disputed → Refunded** (doc 03 edges) | Late-return reduce |
| Canceled | Review voided while the charge was still `SCHEDULED`/`AWAITING_MANUAL` — before debit submission | `CANCELLED` (if an attempt existed pre-submission) | `CANCELLED` | Voided | Void tx |

Doc 03's edges are used exactly: `Approved/Payment Scheduled → Payment Processing → ACH Pending → Paid | Payment Failed`. Part 1 already forbids voiding a review in `PAYMENT_PROCESSING`/`ACH_PENDING` ([03 §6.4]) — an initiated ACH debit cannot be recalled, so the design never pretends it can. "Wait for the outcome" is the only honest instruction, and it is the one the UI gives.

### 5.4 ACH charge sequence (transaction boundaries marked)

Steps 1–2 are identical to §4.3 (approval tx, claim tx) with one addition in pre-flight: `achDebitEnabled = true`, method `type = US_BANK_ACCOUNT`, `status = ACTIVE`, consent unrevoked (doc 20).

3. **[async — provider call, no transaction]**: `createCharge` → PaymentIntent on the connected account, `payment_method_types: ['us_bank_account']`, saved customer + verified method, mandate/consent reference (doc 20), `off_session: true`, `confirm: true`, `application_fee_amount`, metadata cross-check fields, `Idempotency-Key`, timeout.
4. **[tx C — sync outcome transaction]**: debit accepted (intent `processing`) → guarded claim attempt `CREATED → PROCESSING` (`processingAt = now`), store intent id + `providerStatus`; review `PAYMENT_PROCESSING → ACH_PENDING`. **No money is recognized: no `Payment` row, no fee earning, no journal, no Paid anywhere.** Post-commit: audit, "ACH payment initiated — expected to complete by {date}" notifications (payer + org per deliverable 16).
   - Synchronous rejection → attempt `CREATED → FAILED`, charge `FAILED`, review → `PAYMENT_FAILED`, as §4.3.4.
5. **[async — pending window, ~4 business days]**. The review sits in **ACH Pending**. Operational life continues untouched (§5.9). Offline payment recording against this invoice is refused with 409 while the attempt is in flight ([09 §5.1.8]) — the double-collection window stays closed.
6. **[async — webhook `payment_intent.succeeded`] → [tx D — settlement reduce]**: guarded claim attempt `PROCESSING → SUCCEEDED` (`settledAt`); `Payment` row; `ScheduledCharge → COMPLETED`; review `ACH_PENDING → PAID`; `Invoice → PAID`; `PlatformFee → EARNED`; settlement allocation + journal per [28-revenue-allocation-ledger.md](./28-revenue-allocation-ledger.md); the **"held until ACH settles"** compensation-recognition hook fires here (deliverable 14). Post-commit: audit, `payment.succeeded`, settlement receipt ("Payment completed" — distinct from the initiation notice; the initiation notice is never called a receipt).
7. **[async — webhook `payment_intent.payment_failed` (return during the window)] → [tx E — return reduce]**: guarded claim attempt `PROCESSING → FAILED` with `failureCode = R-code`; `ScheduledCharge PROCESSING → FAILED`; review `ACH_PENDING → PAYMENT_FAILED`; catalog consequences applied in the same tx (method suspension, consent revocation flag per §5.6). Post-commit: audit (`revenue.ach_return_recorded`), `payment.failed`, notifications with the safe message.
8. **[async — reconciliation backstop]**: §5.5 staleness clock; plus the [09 §2.10] bounded sweep of stored-but-unprocessed events.

### 5.5 Expected processing window — display and staleness

- **Expected completion date** = `businessDaysAfter(attempt.processingAt, 4)` in the org `timeZone` — a pure helper in `src/lib/payment-runner.ts` (weekends excluded; US bank holidays not modeled, which is why customer copy always says "typically"). **Derived at read, never stored** (*simpler-workflow choice: no column to drift; the timestamp + a pure function is the truth*).
- Shown, per spec Part R, on: the review's Payment section ("ACH Pending — initiated Jul 10, expected to complete by Thu, Jul 16 (typically 4 business days)"), the payer/student view, the Operations queue ACH Pending lane (sorted by expected date), and the initiation notification.
- **Final result after webhook**: the same surfaces flip to Paid (with settled date) or Payment Failed (with the safe return message) only when the reduce commits — never optimistically.
- **Staleness clocks for the reconciliation job** (rail rule handed to deliverable 8): for `CARD` attempts the clock starts at `processingAt`; for `US_BANK_ACCOUNT` attempts it starts at the **expected-settlement date**, not initiation — then `RevenueSettings.reconciliationStalePaymentDays` (default 5, [13 §4.14]) applies. This stops every weekend-spanning ACH debit from false-positiving as a `STALE_PENDING_PAYMENT` `ReconciliationException` while still catching genuinely lost webhooks.

### 5.6 Return handling — R-codes → classification and safe messages

`classifyAchReturn(code)` catalog. "Auto-retry" is bounded by V7's NACHA re-presentment cap regardless of org policy.

| Class | R-codes | Auto-retry | Method consequence | Consent consequence | Payer/student-facing message (verbatim catalog) |
|---|---|---|---|---|---|
| `ACH_SOFT` | R01 (insufficient funds), R09 (uncollected funds) | Yes — max **2 re-presentments total** per original attempt (V7) | None | None | "Your bank account had insufficient funds for this payment." |
| `ACH_HARD_ACCOUNT` | R02 (account closed), R03 (no account), R04 (invalid account number), R12 (branch sold), R13 (invalid routing), R16 (account frozen²), R20 (non-transaction account) | **Never** | `SUSPENDED` (system, audited) | None | R02: "This bank account is closed. Please add a different payment method." · R03/R04/R13: "Your bank could not process this account. Please re-add your bank details." · R16²: "Your bank was unable to process this payment. Please use a different payment method." · R20: "This account type doesn't support this kind of payment. Please add a checking account." |
| `ACH_AUTH_REVOKED` | R05, R07 (authorization revoked), R08 (payment stopped), R10 (customer advises not authorized), R11 (not in accordance with authorization), R29 (corporate not authorized) | **Never** — re-debiting a revoked authorization violates NACHA | `SUSPENDED` | **Consent recorded as revoked** ([20-payment-methods-and-consent.md](./20-payment-methods-and-consent.md) revocation record, actor `system:stripe-webhook`); new consent + re-verification required before this account is ever debited again | R08: "A stop payment was placed on this payment. Please contact your school to arrange payment." · Others: "Your bank reported this payment as not authorized, and it has been stopped. Please contact your school to arrange payment." |
| `ACH_ADMIN` | R06 (ODFI request), R17, R24 (duplicate), other administrative codes | No | None | None | "Your bank returned this payment. Please contact your school." |
| *(unknown)* | any unlisted R-code | No | None | None | "Your bank returned this payment. Please contact your school." |

² R16 can be OFAC-related — the payer-facing message is deliberately generic; org staff see the code with guidance "account frozen — do not retry; direct the payer to their bank."

Hard-code handling extends [09 §2.7] (which named R02/R03/R04) to the full account-unusable and authorization-revoked families — an extension, not a reinterpretation: the Part 1 list was illustrative ("e.g."). The catalog is the single source; contract tests pin every row (deliverable 18).

**V7 — NACHA re-presentment cap (binding rail rule):** an entry returned R01/R09 may be re-presented at most **twice**. The engine counts prior R01/R09-failed attempts on the `ScheduledCharge` and refuses a third ACH retry — auto *or manual* — with the actionable reason "ACH retry limit reached for this payment (bank network rule). Collect with a different method or record an offline payment." `maxAutoRetries` can only tighten this, never loosen it.

### 5.7 Late returns after apparent settlement — the reversal path

A settled ACH payment (`Payment` row written, review `PAID`, fee `EARNED`, settlement journal posted) can still come back — administrative returns shortly after settlement, and unauthorized-debit claims up to 60 days on consumer accounts. The rail rule: **the settled records are never edited; the reversal is appended** (ADR-028). Two delivery shapes arrive from the provider, and the webhook doc routes both to one late-return reducer:

**Shape A — dispute-shaped (unauthorized family: R05/R07/R10/R11/R29).** Consumer ACH disputes are final: the funds are already pulled back and there is no evidence or representment path (the provider typically delivers the dispute already lost).

1. **[tx — late-return reduce, one transaction]**
   - Insert `Dispute` ([13 §4.10]): `providerDisputeId` (`@@unique([provider, providerDisputeId])` is the replay guard), amount, currency, `reason` = R-code, `openedAt`; status `OPEN → LOST` with `resolvedAt` recorded in the same reduce when the event carries the final outcome (both statuses audited).
   - Review guarded claim `PAID → DISPUTED`, then `DISPUTED → REFUNDED` on the lost outcome (both edges exist in [03 §2.3]: "dispute lost — chargeback recorded as refund-equivalent"); `Invoice → DISPUTED → REFUNDED` projection in the same tx.
   - Refund-equivalent records per [26-refunds-voids-disputes.md](./26-refunds-voids-disputes.md): system `RevenueAdjustment` (kind `REFUND`, actor label `system:stripe-webhook`, auto-`APPLIED` — it records an external fact, see §13 Q3) + `Refund` row (`origin = PROVIDER_RETURN` §7, `destination = ORIGINAL_METHOD`, `status = SUCCEEDED`, provider reference stored). The settled `Payment` row is untouched.
   - Financial reversals, same tx: `REFUND` allocation reversal set + reversing settlement journal via [28-revenue-allocation-ledger.md](./28-revenue-allocation-ledger.md); `PlatformFee EARNED → REVERSED/PARTIALLY_REVERSED` per `refundReversesFee` (deliverable 12); reversal `TaxSnapshot` ([07-tax-model.md](./07-tax-model.md) same-transaction invariant); `InstructorEarning` reversal per `compensationRefundPolicy` (default `REQUIRE_APPROVAL` — a reversal task is queued rather than auto-written).
   - Method `SUSPENDED` + consent revocation recorded (as §5.6 `ACH_AUTH_REVOKED`).
2. **Post-commit:** audit (`revenue.ach_late_return_reversed`), org notifications ("ACH payment reversed by the payer's bank — $412.50, RR-0042"), payer notification, domain event.
3. **Re-collection:** Amount Due restores by derivation (ADR-035: `− Σ settled Payments + Σ succeeded Refunds` nets the collection back out). The org **must not re-debit** (authorization revoked); collection is a different method or offline, coordinated with the customer — the review page says exactly that. Further mechanics (customer-credit offsets, write-off posture) belong to [26-refunds-voids-disputes.md](./26-refunds-voids-disputes.md).

**Shape B — refund-shaped (administrative late returns: R06 and similar bank-error corrections).** The provider claws the funds back as a provider-initiated refund object AeroOps never requested.

1. **[tx — late-return reduce]**: system `RevenueAdjustment` (kind `REFUND`, system actor, auto-`APPLIED`, reason "Provider-initiated ACH return R06") + `Refund` row (`origin = PROVIDER_RETURN`, `SUCCEEDED`, `providerRefundId` — proposed nullable-unique replay guard, §7) + the same allocation/journal/fee/tax/compensation reversals as Shape A. Review guarded claim `PAID → PAYMENT_FAILED` and `ScheduledCharge COMPLETED → FAILED` — the two edges [09 §2.6] requires for late returns; [03 §2.3]'s table omits the review edge and this is recorded as an open question (§13 Q2) rather than silently diverged from. Method is **not** suspended (no authorization problem) unless the code classifies hard.
2. **Post-commit:** audit, notifications, `payment.failed` emit.
3. **Re-collection:** the review is back in the standard **Payment Failed** workflow — Amount Due restored by derivation, manual retry permitted for catalog-retry-eligible codes (never auto-retried after a late return), method update or offline collection otherwise. This is why Shape B lands on `PAYMENT_FAILED` rather than `REFUNDED`: the debt genuinely stands and the org needs the normal collection tools, not a terminal status.

**Idempotency:** both shapes are replay-safe three ways — `PaymentProviderEvent` `processedAt` no-op, the provider-object unique (`providerDisputeId` / proposed `providerRefundId`), and guarded review/charge claims.

### 5.8 ACH display requirements (spec Part R, verbatim honored)

- **ACH Pending** badge (existing `STATUS_TONE` entry) everywhere the review appears.
- **Expected processing window** per §5.5 on review, payer view, queue, and initiation notice.
- **Final result after webhook** — and only after: Paid with settled date, or the safe return message.
- **Return/failure status**: payer surfaces show the catalog message; org surfaces show R-code, class, retry eligibility (including the V7 cap counter: "Re-presentment 1 of 2"), and next actions.
- The approve control for an ACH-method review keeps the verbatim Part S wording — "**Approve Revenue Review and charge the saved payment method**" — with the method line "Checking •••• 6789 (verified)" and the consequence-truthful sub-line: "ACH payments typically take 4 business days to complete. This review will show ACH Pending until the bank confirms."

### 5.9 Operational records remain complete regardless of rail state

Binding restatement of spec Parts R and U for this rail (and cards equally):

- The dispatch stays closed, Hobbs/tach snapshots, squawks, training/lesson records, maintenance updates, and aircraft status are **complete and untouched** while a payment is pending, failed, returned, or disputed. No rail state reopens a dispatch, reverses a training record, or removes a maintenance update — there is no code path, matching ADR-025's separation of operational and financial closeout.
- ACH Pending is a **financial** state only. Whether a payer with pending/failed ACH may book or dispatch again is a *configured* financial checkout restriction ([10-checkout-restrictions.md](./10-checkout-restrictions.md)) consuming readiness and Amount Due signals — never an automatic operational reversal, and never a SAFETY-tier gate.
- Reporting: an ACH-pending review's approval-time records (allocation `APPROVAL` set, `TaxSnapshot`, `InstructorEarning`, accrued `PlatformFee`) exist in full from the approval transaction — dashboards distinguish **approved** vs **collected** revenue ([12-revenue-allocation-and-reporting.md](./12-revenue-allocation-and-reporting.md)); nothing waits for settlement to be reportable.

---

## 6. Configuration surface

### Org-level (`OrgPaymentPolicy` unless noted; typed columns, absent row = defaults; zod-validated PATCH, before/after `recordAudit`, permission `revenue.payment_policy_manage`)

| Setting | Type | Default | Consumed here as |
|---|---|---|---|
| `achDebitEnabled` **(new — §7)** | Boolean | `false` | D4 org opt-in. Off: bank-method setup surfaces hidden (doc 20), ACH policies unavailable, readiness reports "ACH not enabled for this organization." Turning it off with debits in flight lets them complete; it only stops new initiations. |
| `retryMode` / `maxAutoRetries` / `autoRetryDelaysDays` | existing ([13 §4.12]) | `MANUAL_ONLY` / 0 / `[1,3,7]` | Retry schedule per rail; V7 caps ACH regardless |
| `approveWithoutMethod` | existing | `WARN` | "Requires payment method" pre-attempt state (§4.2 row 1) |
| `achBatchCadence`, `achOnlyFallback` | existing | `NIGHTLY`, `MANUAL_INVOICE` | ACH-only policy behavior ([09 §2.2]) |
| `RevenueSettings.reconciliationStalePaymentDays` | existing ([13 §4.14]) | 5 | Staleness clock input; ACH clock starts at expected settlement (§5.5) |
| `RevenueSettings.compensationRefundPolicy` | existing | `REQUIRE_APPROVAL` | Late-return earning reversals (§5.7) |

### Platform-level

| Item | Value | Notes |
|---|---|---|
| `REVENUE_CHARGING` | `off \| test` (no `live` this phase) | `off`: adapter absent, both rails degrade to manual invoice + offline recording ([09 §3]) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | env only | Partial config fails loudly at boot (`assertProductionEnv`); webhook route inert without its secret |
| `CARD_ACTION_WINDOW_HOURS` | code constant, `72` | §4.5; not org-configurable at GA (*simpler-workflow choice*) |
| `ACH_EXPECTED_BUSINESS_DAYS` | code constant, `4` | §5.5 display window |
| `ACH_REPRESENTMENT_LIMIT` | code constant, `2` | V7 — a NACHA network rule, never configurable |
| `PlatformFeePolicy` | platform-owned ([13 §4.13]) | If Part W rail-differentiated fees ship (deliverable 12), the accrual basis snapshot uses the rail of the method snapshotted at approval; re-pointing the method across rails in `FAILED`/`AWAITING_MANUAL` re-bases the `ACCRUED` fee under the *snapshotted policy version* — mechanics owned by the platform-fee doc, seam recorded here |

---

## 7. Data model additions (Prisma-flavored; final call in [34-part2-database-additions.md](./34-part2-database-additions.md))

**No new models.** Three additive deltas to shapes bound in [13-database-model.md](./13-database-model.md) §4.12/§4.10, all riding migration M13 (the enums/models involved have not shipped, so the values are present from enum birth — the two-step enum rule applies only to values added to already-shipped enums):

```prisma
enum PaymentAttemptStatus {
  CREATED
  PROCESSING        // holds the ACH pending window (13 §4.12)
  REQUIRES_ACTION   // NEW — off-session card charge awaiting customer authentication (spec Part R); §4.5
  SUCCEEDED
  FAILED
  CANCELLED
}

model PaymentAttempt {
  // ... exactly as 13 §4.12, plus:
  providerStatus   String?   // last observed provider intent status — advisory/forensic only, never drives money
  requiresActionAt DateTime? // set on CREATED → REQUIRES_ACTION
  actionExpiresAt  DateTime? // requiresActionAt + CARD_ACTION_WINDOW_HOURS; expiry-sweep selector
  // proposed index for the expiry sweep (bounded, org-agnostic like [status, runAfter]):
  // @@index([status, actionExpiresAt])
}

model OrgPaymentPolicy {
  // ... exactly as 13 §4.12, plus:
  achDebitEnabled Boolean @default(false) // D4: ACH behind explicit org opt-in
}

enum RefundOrigin {
  ORG_INITIATED   // the doc-08 adjustment-driven path
  PROVIDER_RETURN // provider-initiated reversal (ACH late return / final ACH dispute) — §5.7
}

model Refund {
  // ... exactly as 13 §4.10, plus:
  origin           RefundOrigin @default(ORG_INITIATED)
  // providerRefundId String?  — existing column; ADD @unique (nullable unique; Postgres permits
  // multiple NULLs) as the provider-initiated replay guard. Shared with 26; 34 arbitrates.
}
```

Rules the deltas carry:

- `REQUIRES_ACTION` participates in the "in-flight blocks everything" set: the stuck-attempt rule, the offline-recording 409, and the void prohibition all treat `REQUIRES_ACTION` like `CREATED`/`PROCESSING` (V5).
- `providerStatus` is **never** an input to financial transitions — it exists for the reconciliation pass and forensics. Guarded claims key on `PaymentAttemptStatus` only.
- No decline-category column is stored: classification derives from `failureCode` through the pure catalog (§3.5), keeping the R25 posture (catalog-validated, contract-tested) without snapshot drift.
- Schema-governance: no change to org FK / onDelete / tenant-scoped-unique posture — all deltas are columns/values on models whose governance doc 13 already fixed.

---

## 8. Validation & business rules

| # | Rule |
|---|---|
| V1 | An ACH debit is initiated only when `achDebitEnabled = true`, method `type = US_BANK_ACCOUNT`, `status = ACTIVE` (verified), and off-session consent is recorded and unrevoked (doc 20). Enforced at readiness **and** runner pre-flight; pre-flight failure → local-coded `FAILED` attempt, no provider call. |
| V2 | `PaymentAttemptStatus.SUCCEEDED` (and everything downstream of it — `Payment` row, `PAID`, `EARNED`, settlement journal) is written only by the settlement reduce, fed by a verified webhook or a reconciliation-pass provider read. Sync responses and client redirects never mark paid. Static source-scan test required (§4.4). |
| V3 | Synchronous failures are terminal immediately (`CREATED → FAILED`); a later contradicting webhook is reconciled via terminal-state stickiness + `ReconciliationException` on mismatch (§10). |
| V4 | Amount/currency rules per [09 §5.1] unchanged: server-resolved `min(snapshot, Amount Due)`, `> 0`, currency equals the invoice snapshot; zero Amount Due resolves the charge `COMPLETED` with no attempt. |
| V5 | No review void and no offline payment recording while an attempt is in `CREATED`, `PROCESSING`, **or `REQUIRES_ACTION`** (extends Part 1's in-flight set by the new value; same 409s). |
| V6 | Hard declines and hard/authorization-revoked ACH returns are never auto-retried; the method is `SUSPENDED` (system actor, audited); `ACH_AUTH_REVOKED` codes additionally record consent revocation, and that account is never debited again without new consent + re-verification (doc 20). |
| V7 | ACH re-presentment cap: at most 2 retries per original R01/R09-returned attempt chain, counted per `ScheduledCharge`, binding over auto **and** manual retries. |
| V8 | `REQUIRES_ACTION` expires at `actionExpiresAt` (72h): provider cancel first (outside tx), then guarded local fail with `failureCode = 'authentication_not_completed'`; a provider "already succeeded" answer routes to the settlement reduce instead. `authentication_required` is never auto-retried. |
| V9 | Provider-initiated reversals (§5.7) append records only — system `RevenueAdjustment` + `Refund(origin = PROVIDER_RETURN)` + reversal allocation set + reversing journal + fee/tax/compensation reversals — and never mutate the settled `Payment`/`PaymentAttempt` rows. |
| V10 | Payers and students see only catalog messages; `failureCode` and staff guidance render on org surfaces only; fraud-family signals are never disclosed to the payer. No provider payloads, secrets, or raw errors in logs (structured logger, safe fields only). |
| V11 | Expected-settlement dates are derived (`processingAt` + 4 business days, org timezone), never stored; customer copy always says "typically". |
| V12 | Re-pointing a `ScheduledCharge` method across rails (card ↔ bank, only in `FAILED`/`AWAITING_MANUAL`, audited) re-evaluates readiness, retry rules, and — if the fee policy is rail-differentiated — triggers `PlatformFee` re-basing under the snapshotted policy version (deliverable 12 owns the math). |
| V13 | No rail state touches operational records (§5.9): nothing reopens a dispatch, reverses training records, or removes maintenance updates; financial holds are configured checkout restrictions only, never SAFETY-tier. |
| V14 | Every provider call: timeout mandatory, idempotency key mandatory (charge creation), executed outside any DB transaction; a timeout leaves `CREATED` for reconcile-then-proceed. |

---

## 9. RBAC, approvals & audit

**Permissions — no new keys.** This doc rides Part 1's set ([09 §6]): `revenue.charge` (retry, charge-now, run due payments, cancel), `revenue.payment_methods_manage`, `revenue.payment_policy_manage` (now also gates `achDebitEnabled`), `billing.record_payments` (offline). The policy-driven immediate charge is authorized by the human approval itself ([09 §6]). Webhook-driven transitions have no session actor: audit rows carry `actorLabel: 'system:stripe-webhook'`; sweep transitions carry `'system:payment-runner'`. AI initiates nothing (constitution rule 8); read-only impersonation blocks every mutation here.

**Audit actions** (additive to [09 §6]'s table; `recordAudit` with reconstruct-without-DB-state metadata):

| Action | When | Metadata |
|---|---|---|
| `revenue.charge_requires_action` | `CREATED → REQUIRES_ACTION` | attemptId, intent id, `actionExpiresAt` |
| `revenue.charge_action_expired` | Expiry sweep fails the attempt | attemptId, window, provider cancel outcome |
| `revenue.ach_return_recorded` | Return reduce (window returns) | attemptId, R-code, class, retry eligibility, re-presentment count |
| `revenue.ach_late_return_reversed` | §5.7 reduce (either shape) | shape, provider dispute/refund id, amount, reversal record ids (adjustment, refund, journal, fee, tax snapshot) |
| `revenue.payment_method_suspended` | Catalog-driven suspension (V6) | method display metadata, triggering code, consent revocation flag |

**Domain events:** `payment.succeeded` / `payment.failed` (registered in Part 1) are emitted post-commit by the reduces above. Proposed additions `payment.requires_action` and `payment.ach_returned` — emit sites are the sync-outcome tx and return reduce respectively; registration in `WEBHOOK_EVENTS` is coordinated with the webhook/notification docs (deliverables 8/16) because the constitution test requires every registered event to have a live emit site.

**`STATUS_TONE`:** no new review statuses, so no new review tones; the attempt-level chips ("Bank verification required", "ACH Pending — expected Jul 16", "Re-presentment 1 of 2") get tone entries in the same single-source file.

---

## 10. Failure modes & edge cases (SRE lens)

| # | Failure / race | Behavior |
|---|---|---|
| 1 | Webhook `succeeded` arrives before the sync-outcome tx writes | Settlement reduce claims `CREATED → SUCCEEDED` (claim set includes `CREATED`); the runner's later `CREATED → PROCESSING` claim returns count 0 and is treated as a **benign no-op** (the runner verifies terminal state; it does not 409). |
| 2 | Crash/timeout between claim and provider response | Attempt stuck `CREATED`; reconcile-then-proceed: re-issue `createCharge` with the stored idempotency key (returns the same intent) or read the intent, then apply the true state. Never a parallel attempt ([09 §2.4]). A stuck `requires_confirmation` intent found this way is canceled at the provider and the attempt failed locally (`reconciled_stale_intent`). |
| 3 | `payment_failed` webhook after local `SUCCEEDED` (out of order / contradiction) | Terminal states are sticky (guarded claims). Event stored, marked processed with note `ignored: attempt terminal`; if the provider object genuinely contradicts local state, the reconciliation pass opens a `ReconciliationException (AMOUNT_MISMATCH / STALE_PENDING_PAYMENT)` instead of mutating money. |
| 4 | Duplicate webhook delivery | `PaymentProviderEvent` `processedAt` idempotency ([09 §2.10]): processed → 200 no-op; stored-unprocessed → idempotent re-reduce. |
| 5 | 3DS completed at the same moment the expiry sweep cancels | Provider serializes: exactly one of cancel/succeed wins at Stripe. The sweep's cancel error ("already succeeded") routes to the settlement reduce; the local claim runs once (§4.5.5). |
| 6 | Card expires or method detached between approval and a batch run | Runner pre-flight fails the attempt locally (`expired_card` / `method_unavailable`, no provider call); review → Payment Failed; staff re-point the method (audited) and retry. |
| 7 | ACH return arrives while an auto-retry slot is already scheduled | Retries serialize on the `ScheduledCharge` claim + `attemptNumber` unique; the return applies to its own attempt; the retry decision re-runs the catalog (a hard code cancels the pending slot). |
| 8 | Offline payment recorded during the ACH pending window | Refused 409 inside the recording transaction ([09 §5.1.8]) — the double-collection window stays closed. |
| 9 | Late return after partial org-initiated refunds already succeeded | Reversal amount is capped in-tx at settled minus prior succeeded/in-flight refunds (Refund cap rule, [13 §4.10]); residual handling owned by [26-refunds-voids-disputes.md](./26-refunds-voids-disputes.md). |
| 10 | `achDebitEnabled` toggled off mid-flight | In-flight debits complete normally (initiation gate only); readiness stops offering ACH for new approvals. |
| 11 | Stripe outage at charge time | Attempt `CREATED`, visibly stuck in the due-charges queue; timeout + reconcile-then-proceed; nothing silently retried without the idempotency key. |
| 12 | Webhook lost entirely | Provider retries; the §5.5 staleness clock then the reconciliation pass (provider list vs local `PROCESSING`/`REQUIRES_ACTION` attempts) is the designed backstop — attempts never silently expire. |
| 13 | Connected account becomes restricted while charges are scheduled | Runner pre-flight consults connected-account readiness (deliverable 3); due charges stay `SCHEDULED` with an actionable org-facing reason, never fail silently. |

---

## 11. UX notes (Financial UX lens — the five-personas test)

- **Dispatcher / CFI:** payment rails never appear on the flight line. Aircraft return closes with zero payment interaction; everything here lives on the Revenue Review and Revenue Dashboard.
- **Director of Operations:** the Operations queue gets rail-aware lanes — ACH Pending (with expected dates, sorted soonest-first), Payment Failed (with catalog guidance and the three actions: retry / change method / switch to manual invoice), Bank-verification-required. Every pending state shows *when something will happen next*; nothing sits unexplained.
- **Accountant:** approved vs collected are distinct figures everywhere; ACH Pending items carry expected dates; the late-return reversal produces a visibly balanced paper trail (adjustment → refund → reversing journal → fee reversal) rather than an edited payment. Receipts: card receipt at Paid; ACH initiation notice is labeled "payment initiated", and only settlement produces "payment completed" — the word *receipt* is reserved for settled money.
- **Owner:** the dashboard's Card vs ACH split (deliverable 15) and the ACH Pending total quantify settlement exposure at a glance; failed payments carry safe, specific reasons.
- **Payer/student:** Amount Due language only, itemized; catalog messages only; the payment method line always shows brand/bank + last4; ACH surfaces set the timing expectation up front ("typically 4 business days") so a pending payment never reads as a broken one. Trust is built by never showing a state the money isn't actually in.
- All badges via `STATUS_TONE`; light/dark and mobile parity; loading/empty/error states on the queues; every readiness/failure verdict carries its reasons (explainable-engine rule).

---

## 12. Out of scope for Part 2 / deferred to Part 3

- **Payer-facing surfaces**: the 3DS completion page (fresh client secret fetched at render, never stored), pay-now on manual invoices, payer method self-service — Part 3 payer portal ([11-responsible-payers.md](./11-responsible-payers.md) §10). Until then, requires-action attempts usually expire to Payment Failed (§4.5.4) — stated honestly in product copy.
- **Email delivery** of receipts/failure notices — no email adapter exists; in-app `Notification` rows only; nothing claims an email was sent.
- **Exact-time batch/dunning execution** — needs the queue/cron adapter (D14); until then the runner-pass model with the surfaced limitation ([09 §2.9]).
- **Same-day ACH, ACH credit transfers, instant payout products, card wallets (Apple Pay/Google Pay/Link), network tokens, surcharging, adaptive/smart retry timing, multi-currency** — all Part 3 or later; several are permanent non-goals pending product review.
- **Per-payer ACH outstanding-exposure caps** as checkout restrictions — Part 3 (§13 Q4).
- **Card dispute (chargeback) evidence workflow** — [26-refunds-voids-disputes.md](./26-refunds-voids-disputes.md); this doc only consumes the `PAID → DISPUTED` review edge.
- **Explicit confirmations:** this document designs against Stripe **test mode** only; no live charge occurs, nothing deploys, no production email is sent, and no raw card/bank data is stored anywhere in this design.

---

## 13. Open questions

1. **D4 ratification (Head of Product + Aviation Accounting Specialist).** This doc implements D4 exactly as recommended: card-first, ACH behind `achDebitEnabled`, **`PAID` at card capture** (`CARD_PAID` recorded and rolled in the same settlement reduce, §4.1), ACH `PAID` only at settlement. Receipts and payer-visible status language depend on it — please ratify or redirect before implementation of the settlement reduce.
2. **Part 1 transition-table alignment (recorded conflict, not a divergence).** [09 §2.6] requires `Paid → Payment Failed` for administrative ACH late returns, but [03 §2.3]'s transition table lacks that review edge, and [09 §2.3]'s `ScheduledCharge` machine lacks the matching `COMPLETED → FAILED` edge. §5.7 Shape B adopts doc 09's explicit requirement, with both new edges written **only** by the late-return reducer. The designated Part 1 refresh agents should add both edges to the doc 03/09 tables (or overrule, in which case Shape B lands on `REFUNDED` and loses the re-collection workflow — not recommended).
3. **Provider-initiated reversal approvals.** §5.7 auto-`APPLIE`s the system `RevenueAdjustment` for provider-initiated reversals, bypassing `secondApprovalForRefunds` (default `true`) on the grounds that AeroOps is recording an external fact, not deciding a refund — fully audited with `system:stripe-webhook` attribution. Confirm this posture (the alternative — a human approval queue for money the bank already took — creates books that knowingly lag reality).
4. **ACH exposure posture (risk R6 residue).** Should Part 3 add a configurable per-payer cap on outstanding ACH-pending amounts feeding the financial checkout restrictions (e.g., warn/block new dispatch above $X pending)? Recommendation: yes, Part 3, as a `10-checkout-restrictions.md` FINANCIAL-tier key; nothing in Part 2 blocks it. Product owner sizing requested.

---

## Related documents

Part 1: [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) · [08-adjustments-discounts-credits.md](./08-adjustments-discounts-credits.md) · [09-payment-timing-and-collection.md](./09-payment-timing-and-collection.md) · [13-database-model.md](./13-database-model.md) (canonical) · [14-migration-plan.md](./14-migration-plan.md) · [16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md)
Part 2: [20-payment-methods-and-consent.md](./20-payment-methods-and-consent.md) · [26-refunds-voids-disputes.md](./26-refunds-voids-disputes.md) · [28-revenue-allocation-ledger.md](./28-revenue-allocation-ledger.md) · [34-part2-database-additions.md](./34-part2-database-additions.md) · webhook, failure-workflow, platform-fee, compensation, notification, and test-plan documents by deliverable number.
