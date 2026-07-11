# Payment Failure Workflow (Part U)

> **Status:** Proposed — Phase 8 Part 2 · **Date:** 2026-07-10 · **Lead roles:** Head of Product; Reliability/SRE Engineer; Director of Operations; Financial UX Designer · **Part of:** Revenue Engine design set ([README](./README.md))

This document is Part 2 Deliverable 10: **what happens when a payment fails** — the failure sequence, the safe failure vocabulary shown to customers, notification and escalation, authorized retry with duplicate-retry prevention, the org-configurable consequence policies wired into the Part 1 checkout-restriction matrix, and the handling of ACH returns that arrive after apparent success. It is design only: Stripe **test mode** is the only sanctioned environment, nothing deploys, no live charge occurs, and no production email is sent.

A payment failure is an ordinary Tuesday at a flight school — a student's debit card is out of money the week of a stage check, a sponsor's card rotated, an ACH debit bounced. The design goal, per the north-star question: the Director of Operations sees exactly what failed and what to do next; the accountant trusts that nothing was double-charged and nothing was silently forgiven; the payer gets a courteous, actionable message that never reads like a fraud accusation; and **nothing operational — training records, dispatch history, maintenance — is ever touched by a billing failure.**

---

## 1. Purpose & scope

### In scope

- The **failure sequence**: how a failed `PaymentAttempt` (synchronous decline or webhook-delivered failure) transitions the attempt, the `ScheduledCharge`, the Revenue Review (→ **Payment Failed**), and the Invoice projection, in one guarded transaction — and the post-commit notification/audit/event fan-out.
- The **safe failure vocabulary**: a fixed code catalog (`src/lib/payment-failures.ts`) mapping provider decline codes and ACH return codes to internal failure categories, staff-facing detail, and customer-friendly payer copy. Raw provider errors never reach students or payers (spec Part U hard rule; Part AB).
- **Retry design**: who may retry, the configured automatic retry schedule and its bounds, the method-update-then-retry flow, duplicate-retry prevention (mechanics owned by [24-idempotency.md](./24-idempotency.md)), and when retries stop and the review settles into a derived **Amount Due** (Part 1 principle 4 — never a running balance).
- **Escalation of unresolved failures**: the escalation clock, notification targets, and the optional financial hold.
- The **org-configurable consequence policy matrix** for the spec Part U options (warning only / prevent future booking / require Operations approval / block dispatch / membership financial hold / temporary override / notify Finance Manager / notify Account Owner) — expressed as configuration of the Part 1 checkout-restriction system ([10-checkout-restrictions.md](./10-checkout-restrictions.md)), **extended, not duplicated**.
- **ACH returned after apparent success**: the reversal workflow skeleton, with execution delegated to the Part 2 refunds/voids/disputes design (doc 26, Part V) and the allocation-reversal design (doc 28, Part X).

### Out of scope

Charge initiation and the payment runner ([09-payment-timing-and-collection.md](./09-payment-timing-and-collection.md), finalized by the Part 2 approval-to-payment doc 22); webhook plumbing and signature verification (doc 23, Part T); idempotency key mechanics ([24-idempotency.md](./24-idempotency.md)); refund/dispute execution (doc 26); notification channel implementation (doc 31, Part AA); dashboard layout (doc 30, Part Z). Final Prisma shapes for everything new here: [34-part2-database-additions.md](./34-part2-database-additions.md).

---

## 2. Relationship to Part 1 docs (extends / finalizes, never reinterprets)

| Part 1 doc | What this doc does with it |
|---|---|
| [13-database-model.md](./13-database-model.md) | **Canonical, binding.** `PaymentAttempt.failureCode/failureMessage`, `StoredPaymentMethodStatus.SUSPENDED`, `ScheduledCharge` state machine and its mutable-field set, `OrgPaymentPolicy` retry fields, `RevenueReviewStatus.PAYMENT_FAILED` are used exactly as bound. This doc defines **what gets written into** `failureCode`/`failureMessage` (§4) and proposes additive extensions (§6) that doc 34 finalizes. |
| [09-payment-timing-and-collection.md](./09-payment-timing-and-collection.md) | Extends §2.7 (retry policy — bounds and hard-decline rules are binding and restated, not changed), §2.8 (Amount Due derivation — consumed verbatim), §2.3/§2.4 (state machines — this doc adds the failure-side traversal detail and the local pre-flight failure convention), §2.6 (ACH windows — the late-return transition recorded there is executed here + doc 26). |
| [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) | Owns the review status machine. All `PAYMENT_FAILED` entry/exit transitions used here are rows in its §2.3 table; this doc adds no new review status. The `Paid → Payment Failed` settled-ACH-return transition is recorded in 09 §2.6 (doc 03's table carves out reversal paths from `PAID` terminality); doc 26 finalizes it. |
| [10-checkout-restrictions.md](./10-checkout-restrictions.md) | Extended. This doc **finalizes the Part-2-deferred data sources** for `PRIOR_PAYMENT_FAILED` (row 13) and `AMOUNT_DUE_OVER_THRESHOLD` (row 14, derived source), adds one additive `CheckoutRestrictionKey` (`MEMBERSHIP_FINANCIAL_HOLD`) and one additive policy column (`applyAtBooking`). Tiering, enforcement modes, override/review mechanics, and the three absolute rules (§1) are reused unchanged. |
| [08-adjustments-discounts-credits.md](./08-adjustments-discounts-credits.md) | Settled-return reversals follow its reversal contract (§3.7): appended signed records, never edits. |
| [16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md) | D4 (card-first, ACH opt-in, settlement-based ACH `PAID`), D19 (`PRIOR_PAYMENT_FAILED` default recommendation), R6 (ACH return timing), R7 (no scheduler) are honored as decided/recommended — not re-litigated. |
| [11-responsible-payers.md](./11-responsible-payers.md) | Payer identity, notification capability flags (`receivesNotifications`), and the Part 3 payer portal boundary. |

---

## 3. How it works — the failure sequence

### 3.1 Failure entry points

A payment failure reaches AeroOps by exactly three doors. All three converge on the same **failure transaction** (§3.2).

| # | Entry point | Async? | Examples |
|---|---|---|---|
| E1 | **Synchronous provider decline** — the payment runner's `createCharge` call returns a decline | Provider call is outside any DB tx (async hop); result handled immediately | `card_declined`, `insufficient_funds`, `expired_card` |
| E2 | **Webhook-delivered failure** — a stored `PaymentProviderEvent` reduces to a failed attempt | Yes — arrives minutes (card `requires_action` abandoned/failed) to days (ACH return in the pending window) later | `payment_intent.payment_failed`, ACH return `R01` during the ~4-business-day window |
| E3 | **Local pre-flight failure** — the runner claims a due charge but validation fails before any provider call (method `SUSPENDED`/`DETACHED`, card expired, currency mismatch) | No | `local_method_suspended`, `local_card_expired` |

**E3 convention (new in this doc, doc 34 finalizes):** for unattended triggers (`BATCH`, `AUTO_RETRY`), a pre-flight validation failure is recorded as a normal append-only `PaymentAttempt` that goes `CREATED → FAILED` synchronously with a `local_*` failure code and **no** `providerPaymentIntentId` — so the failure is visible in the attempt trail, the `ScheduledCharge` lands in `FAILED` (where method re-pointing is permitted per 13 §4.12), and the workflow below engages. For the human-initiated **Charge now** path the same validation returns an actionable `400` and creates no attempt — the human is standing right there; a row would be noise. `local_*` codes are catalog-reserved and can never collide with provider codes.

### 3.2 The failure transaction (one `db.$transaction`, DB-only)

Numbered steps; **T** marks the transaction boundary, **post** marks post-commit work. No provider call ever occurs inside the transaction (ADR-011/ADR-025 discipline; spec Part AB auto-reject).

1. **T-begin.** Guarded `updateMany` claim on the attempt: `WHERE id = :attemptId AND status IN ('CREATED','PROCESSING')` → `FAILED`, stamping `failedAt`, `failureCode` (normalized code, §4.1), `failureMessage` (catalog-safe message, §4.1). `count === 0` → the attempt already reached a terminal state; abort as a no-op (webhook replay safety — see [24-idempotency.md](./24-idempotency.md)).
2. **Retry decision** (pure function, §3.4): read `OrgPaymentPolicy` retry fields + the failure category's retry class + `attemptCount` → either a next auto-retry slot or none. Retry policy is evaluated **at each failure event** against org-current config (timing policy is snapshotted at approval; retry cadence deliberately is not — an org tightening its retry posture should not wait a release).
3. Guarded `ScheduledCharge` claim: `PROCESSING → FAILED` (no retry slot) or `PROCESSING → SCHEDULED` with `runAfter = failedAt + delay` (auto-retry slot granted). `attemptCount`/`lastAttemptId` updated. Same-claim idiom as 09 §2.3.
4. Guarded Revenue Review claim: `PAYMENT_PROCESSING → PAYMENT_FAILED` or `ACH_PENDING → PAYMENT_FAILED` (03 §2.3 rows). Invoice projection stays `OPEN` in the same transaction (`OVERDUE` remains a derived/legacy notion, never a review status).
5. **Method consequence** (category-driven, §4.2): hard declines and unauthorized ACH returns set the `PaymentMethodReference` to `SUSPENDED` (09 §2.7, binding). Soft declines leave the method `ACTIVE`.
6. **T-commit.**
7. **post:** `recordAudit('revenue.charge_failed', …)` with attempt id, normalized code, category, retry decision; `emitDomainEvent('payment.failed')` (registered in Part 1); **Notification fan-out** (§3.3). The in-process event bus is fan-out only — the committed rows are the truth (ADR-009).

Nothing else changes. **No training, dispatch, or maintenance record is written, reversed, or reopened by this transaction — structurally: the failure engine imports no operational module** (§7.1).

### 3.3 Notification fan-out (spec: notify payer + configured organization roles)

Channel reality (audit-grounded): AeroOps has in-app `Notification` rows only — **no email adapter exists**, and no production email is permitted this phase. The design does not pretend otherwise.

| Recipient | Channel (Part 2) | Content |
|---|---|---|
| **Payer** (or self-pay student) | In-app `Notification` (kind `PAYMENT_FAILED`) targeted at the payer's linked `User` where one exists and `StudentPayerRelationship.receivesNotifications` is true; **otherwise a staff task**: the failed-payments queue row exposes a copy-ready payer message drawn from the catalog (§4.3), so front desk can call/text/email manually. Never claims an email was sent. | Payer-facing catalog copy: what happened (safe category wording), the exact Amount Due and review number, the two actions (update payment method / contact the school). |
| **Org roles — actionable tier** | In-app `Notification` to every active member holding `revenue.charge` (they can retry) — the doc 10 §3.5 "notify permission holders" pattern. | Staff copy: review, payer, amount, normalized code + category, attempt count, next retry (if scheduled), deep link to the failed-payments queue. |
| **Org roles — configured extras** | Members of `OrgPaymentPolicy.failureNotifyRoleIds` OrgRoles (e.g. the org's "Finance Manager" role) | Same staff copy. |

Notifications are written post-commit, best-effort: the durable surface is the failed-payments queue (a query over `ScheduledCharge`/review state), so a crashed notification write loses a ping, never the failure itself. Repeat failures on the same charge refresh rather than multiply the payer notification (idempotent per review, mirroring 10 §3.5). Notification kinds/digest behavior are owned by doc 31 (Part AA); the additive `NotificationKind` values this doc needs are listed in §6.4.

### 3.4 Retry design

**Who may retry, and how (spec: allow authorized retry):**

| Trigger | Authorization | Mechanics |
|---|---|---|
| **Manual retry** ("Retry payment") | Human with `revenue.charge`, `{ mutating: true }` — read-only impersonation refused | Guarded claim `FAILED → PROCESSING`; **new** `PaymentAttempt` with `attemptNumber + 1`, fresh deterministic key `sc_<scheduledChargeId>_a<n>`, trigger `MANUAL`; amount re-resolved server-side = `min(snapshot amount, current Amount Due)` — never client-supplied |
| **Automatic retry** | Org configuration is the standing authorization: `retryMode = AUTO` (default `MANUAL_ONLY`), `maxAutoRetries` (default 0, hard cap 3), slots at `autoRetryDelaysDays` offsets (default `[1, 3, 7]`) — 09 §2.7 / 13 §4.14, binding | `FAILED → SCHEDULED` with `runAfter` = slot (written in the failure tx, §3.2 step 3); the payment runner claims it like any due charge, trigger `AUTO_RETRY` |
| **Retry after offline partial payment** | Same as manual retry | Amount re-resolution charges only the remainder; if Amount Due already reached zero the claim resolves `COMPLETED` and **no attempt is created** (09 §5.1.2) |
| **AI / automation** | **Never.** No AI pathway may initiate a charge or retry (constitution rule 8). Auto-retry is org-configured policy executed by the runner, not an agent decision. | — |

**Hard bounds (binding, from 09 §2.7 — restated, not changed):**

- Hard declines (`stolen_card`, `pickup_card`, `lost_card`, `fraudulent`, `invalid_account`, ACH `R02`/`R03`/`R04`) are **never auto-retried**; the method goes `SUSPENDED`; handling forces `MANUAL_ONLY` for that charge.
- Unauthorized ACH return codes (`R05`, `R07`, `R10`, `R11`, `R29`, `R51`) are **never re-debited against the same authorization** — a new attempt requires a new or re-verified method and fresh off-session consent (doc 20, Part Q). This is a consumer-protection posture (Reg E / NACHA), not a policy knob.
- An attempt in `CREATED`/`PROCESSING` **blocks any new attempt** on the same charge — resolution is reconcile-then-proceed via the stored idempotency key, never a parallel attempt (09 §2.4; [24-idempotency.md](./24-idempotency.md)).
- `attemptNumber` is `@@unique([scheduledChargeId, attemptNumber])` and every attempt's `idempotencyKey` is globally unique and deterministic — a double-submitted retry button, a runner race, and a webhook replay all collapse to one provider-side charge. **Duplicate-retry prevention is structural; this doc adds no second mechanism** ([24-idempotency.md](./24-idempotency.md) is canonical).
- Recording an offline payment while an attempt is in flight is refused with 409 (09 §5.1.8) — the double-collection window stays closed during retries.

**Method-update-then-retry flow (spec: offer payment-method update):**

1. The payer notification and the failed-payments queue both carry **Update payment method**.
2. Staff with `revenue.payment_methods_manage` generate a provider-hosted setup session for the payer's `PaymentCustomer` (SAQ-A: AeroOps never renders card fields) and hand the link to the payer. *(Async hop — payer completes on the provider surface on their own time.)* The Part 3 payer portal (doc 11 §10) makes this self-service; Part 2 ships the staff-generated link.
3. Webhook: SetupIntent completion → new `PaymentMethodReference` (`ACTIVE`, or `REQUIRES_VERIFICATION` for ACH) via the doc 23 pipeline. Staff holding `revenue.charge` are notified: "New payment method on file for <payer> — retry available."
4. A human retries. On the retry screen, if the charge's snapshot method is unusable and the payer now has a newer `ACTIVE` method, the UI pre-selects **re-point + retry** as one action: re-point `ScheduledCharge.paymentMethodReferenceId` (permitted only in `FAILED`/`AWAITING_MANUAL`, audited `revenue.charge_method_changed` with before/after — 13 §4.12) and the `FAILED → PROCESSING` claim in the same transaction, then the attempt proceeds normally.

**Simpler-workflow choice:** saving a new method does **not** auto-charge outstanding failed reviews. A surprise charge the moment a parent fixes a card is a trust-destroying experience and skirts consent; a one-click, human-confirmed retry costs the org five seconds. (A scheduled auto-retry slot that is already pending will use the re-pointed method at its normal time if staff re-point first; the runner never re-points on its own.)

**When retries stop** (any of): an attempt succeeds · `maxAutoRetries` reached · the failure category forbids retry (hard decline / unauthorized return) · the method is `SUSPENDED`/`DETACHED` with no replacement · the review is voided (charge → `CANCELLED`) · offline payments settle the invoice (charge → `COMPLETED`). When they stop without collection, the charge rests in `FAILED`, the review rests in **Payment Failed**, and the operative financial fact is the **derived Amount Due** (09 §2.8): frozen total + APPLIED adjustment deltas − settled payments + succeeded refunds, **per invoice**. No counter is incremented anywhere, no stored balance exists, and payer-level figures remain read-time aggregations — resolving the review (payment, void) makes every downstream consequence evaporate automatically because they all derive from current state (principle 4 holds; spec's "escalate to Amount Due" without a running-balance system).

### 3.5 Escalation of unresolved failures

**Escalation is a marker plus notifications — not a new review status.** *(Simpler-workflow choice: a 17th status would ripple through every queue, tone map, and transition table for what is operationally a flag; a queue filter on `failureEscalatedAt` gives the Director of Operations the same view for free.)*

1. **Trigger passes** (bounded, no scheduler exists — R7): the escalation check runs inside the payment runner's normal pass and the org/platform sweep API (09 §2.9 triggers). Selection: `ScheduledCharge` rows in `FAILED` with `failureEscalatedAt IS NULL`, no attempt in `CREATED`/`PROCESSING`, no future retry slot, and latest `failedAt` older than `OrgPaymentPolicy.escalationDays` (default 7).
2. **T:** guarded `updateMany` stamps `failureEscalatedAt` (`count === 0` → another pass won; skip). If `autoHoldAfterEscalation` is enabled (default **off**), a `FinancialHold` row (source `POLICY_ESCALATION`, §6.1) is created in the same transaction for the review's student subject.
3. **post:** `recordAudit('revenue.failure_escalated')`; `emitDomainEvent('payment.failure_escalated')` (new registration with this live emit site); escalation notifications ride the existing `PAYMENT_FAILED` topic thread (kind `PAYMENT_FAILED` — dedupe refresh + role-targeted counter rows, doc 31 §3.6; there is **no** separate `PAYMENT_FAILURE_ESCALATED` kind, doc 34 R-P8) to: members of `escalationNotifyRoleIds` OrgRoles, **plus always** every holder of `revenue.payment_policy_manage` (the owner/admin tier — this is how "Notify Account Owner" is guaranteed even in an unconfigured org).
4. **After escalation** the review is unchanged (`PAYMENT_FAILED`, derived Amount Due). Resolution paths, unchanged from doc 03: collect (retry / offline payment → `PAID`), void (`revenue.void`, only while nothing collected), or — future only — `WRITTEN_OFF` (enum reserved, **no writer in Parts 2–3**). The escalated state is visible as a red-tier chip in the failed-payments queue and the Operations revenue queue (doc 30).

### 3.6 ACH returned after apparent success (reversal path)

ACH settles days after initiation, and can return even after settlement (administrative returns; unauthorized-debit claims within the NACHA 60-day consumer window). Under D4, ACH reaches `PAID` **only on settlement** — so this path concerns genuinely settled money coming back.

1. *(Async hop)* Provider settled-return / dispute-shaped event arrives → doc 23 pipeline stores it (`PaymentProviderEvent` unique-insert), resolves tenancy from local references.
2. **Classification:** unauthorized codes (`R05`, `R07`, `R10`, `R11`, `R29`, `R51`) → the **dispute workflow** (doc 26, Part V; review → `DISPUTED` per 03 §2.3). Administrative/other returns (e.g. `R06`, `R08` post-settlement) → **settled-return reversal**, below.
3. **Reversal transaction** (executed by doc 26's engine — referenced here, designed there): the settled `Payment` row is **never edited** (08 §3.7). Appended records in one `db.$transaction`: the return recorded against the payment (doc 26's reversal record), signed **RevenueAllocation reversal set** (doc 28), **PlatformFee** reversal movement (EARNED → PARTIALLY_REVERSED/REVERSED — doc 27; "AeroOps earns nothing on uncollected revenue"), reversal `TaxSnapshot` rows (07 §5.8), `InstructorEarning` handling per `compensationRefundPolicy` (doc 29; default `REQUIRE_APPROVAL`), reversing `LedgerEntry` journal. Review: `PAID → PAYMENT_FAILED` (recorded in 09 §2.6; finalized in doc 26).
4. **Then this doc's standard failure workflow applies** — the review is a Payment Failed review with a derived Amount Due again: notifications (§3.3, with return-specific copy §4.3), method `SUSPENDED` for hard/unauthorized codes, **no auto-retry ever** for post-settlement returns (every re-collection is a human decision on a fresh or re-verified method), consequence policies (§5), escalation clock restarted from the return date (`failureEscalatedAt` cleared in the reversal tx).
5. A `ReconciliationException` is **not** opened for a clean return (it is an expected, fully-processed event); the reconciliation job (doc 23) opens exceptions only when provider and local state disagree.

**Hard rule restated for this path:** the lesson happened, the aircraft flew, the training record stands. A settled return reverses **money records only** — never the `LessonRecord`, never the `Dispatch`, never maintenance data (§7.1).

---

## 4. Safe failure vocabulary & customer-facing message catalog

### 4.1 What gets stored (finalizing 13 §4.12's `failureCode`/`failureMessage`)

| Field | Contents | Never contains |
|---|---|---|
| `PaymentAttempt.failureCode` | The **normalized code** from a fixed catalog: provider decline codes verbatim where stable (`card_declined`, `insufficient_funds`, `expired_card`, `authentication_required`, `stolen_card`, …), NACHA return codes (`R01`…), and AeroOps-local codes prefixed `local_` (`local_method_suspended`, `local_card_expired`, `local_currency_mismatch`, `local_provider_timeout` — the last written only after reconciliation confirms no provider intent exists) | Free-form provider text |
| `PaymentAttempt.failureMessage` | The catalog's **staff-facing safe message** for that code (deterministic, versioned in code) | Raw provider error strings, payer PII, provider request/response fragments |
| `PaymentProviderEvent.payload` | The full provider event, forensic-only (13 §4.12) | — (never surfaced to any org or payer UI; platform-forensic access only) |

The mapping lives in `src/lib/payment-failures.ts` as a pure, contract-tested catalog: `categoryFor(code)`, `staffMessageFor(code)`, `payerCopyFor(category, ctx)`, `retryClassFor(category)`, `methodConsequenceFor(category)`. **Category is derived from the stored code at read time — no category column** (keeps 13's `PaymentAttempt` shape untouched; the catalog can improve without migrations). Unknown/future codes map to `UNKNOWN` → generic copy, `MANUAL_ONLY` retry class, no method consequence — fail safe, never fail weird.

### 4.2 Failure categories

| Category | Example codes | Retry class | Method consequence | Notes |
|---|---|---|---|---|
| `SOFT_DECLINE` | `card_declined`, `generic_decline`, `do_not_honor`, `try_again_later`, `processing_error` | `AUTO_RETRYABLE` | none | The everyday case; auto-retry per org policy |
| `INSUFFICIENT_FUNDS` | `insufficient_funds`, ACH `R01`, `R09` | `AUTO_RETRYABLE` | none | Delay-based retries are genuinely effective here |
| `CARD_EXPIRED` | `expired_card`, `local_card_expired` | `ACTION_REQUIRED` (auto-retry pointless) | `SUSPENDED` | Readiness already warns pre-approval (09 §5.2) |
| `AUTHENTICATION_REQUIRED` | `authentication_required` (off-session 3DS) | `ACTION_REQUIRED` | none | Payer must confirm on a hosted surface (Part R "Requires action"); staff-assisted link in Part 2, payer portal in Part 3 |
| `HARD_DECLINE` | `stolen_card`, `pickup_card`, `lost_card`, `fraudulent`, `invalid_account`, ACH `R02`/`R03`/`R04` | `NEVER_SAME_METHOD` | `SUSPENDED` | Never auto-retried (09 §2.7, binding) |
| `ACH_UNAUTHORIZED` | `R05`, `R07`, `R10`, `R11`, `R29`, `R51` | `NEVER_SAME_METHOD` (+ fresh consent required) | `SUSPENDED` | Routes to dispute handling when post-settlement (§3.6) |
| `METHOD_UNUSABLE_LOCAL` | `local_method_suspended`, `local_method_detached`, `local_currency_mismatch` | `ACTION_REQUIRED` | (already unusable) | E3 pre-flight convention (§3.1) |
| `PROVIDER_UNAVAILABLE` | `local_provider_timeout` | `AUTO_RETRYABLE` | none | Only after reconcile-then-proceed proves no intent was created; a stuck attempt is never synthesized into a failure (09 §2.4) |
| `UNKNOWN` | anything unrecognized | `MANUAL_ONLY` | none | Fail safe |

### 4.3 Customer-friendly message catalog (payer/student-facing copy)

Rules first — these are hard (spec Part U + Part AB), enforced by a static contract test that asserts payer surfaces render only `payerCopyFor()` output:

- **Never raw provider errors to students or payers.** Not in UI, not in notifications, not in receipts, not in the payer portal (Part 3).
- **Never accusatory or alarming.** A `stolen_card` code must not tell the payer "this card was reported stolen" — that copy tips off actual fraud and humiliates the far-more-common false positive. Payer copy for the whole `HARD_DECLINE` family is deliberately generic.
- **Always actionable and specific about money**: the exact Amount Due, the review number, and the next step. Reassure that no money moved: a declined charge is scary until you say so.
- Vocabulary: "Amount Due", "Revenue Review", "payment method" — never "account balance", never codes, never "PaymentIntent".

| Category | Payer/student-facing copy (template) | Staff-facing detail (queue/notification) |
|---|---|---|
| `SOFT_DECLINE` | "Your payment of **{amount}** for **{reviewNumber}** didn't go through — your bank declined the charge, and **you have not been charged**. You can update your payment method or try again; {orgName} can also retry it for you." | "Declined ({code}). No funds captured. Retry available{nextRetry, e.g. ' — auto-retry scheduled Jul 12'}." |
| `INSUFFICIENT_FUNDS` | "Your payment of **{amount}** for **{reviewNumber}** couldn't be completed and **you have not been charged**. You may want to try again later or use a different payment method." | "Insufficient funds ({code}). Auto-retry {status per policy}." |
| `CARD_EXPIRED` | "The card on file (**{brand} •••• {last4}**) has expired, so your payment of **{amount}** for **{reviewNumber}** couldn't be processed. Please add a current payment method." | "Card expired {expMonth}/{expYear}. Method suspended; update required before retry." |
| `AUTHENTICATION_REQUIRED` | "Your bank needs you to confirm this payment of **{amount}** for **{reviewNumber}**. Use the secure link below to confirm — it takes under a minute." | "Bank requested authentication (3DS). Send confirmation link; do not retry blind." |
| `HARD_DECLINE` | "This payment method can't be used for your payment of **{amount}** for **{reviewNumber}**, and **you have not been charged**. Please use a different payment method, or contact {orgName} if you have questions." | "Hard decline ({code}) — never auto-retried. Method suspended. Collect a different method." *(Code visible to staff with `revenue.charge`; still never echoed to the payer.)* |
| `ACH_UNAUTHORIZED` | "Your bank returned this payment of **{amount}** for **{reviewNumber}**. Please contact {orgName} to arrange payment." | "ACH return {code} (unauthorized class). Do NOT re-debit — new authorization required. Consider the dispute workflow (doc 26)." |
| ACH soft return (`INSUFFICIENT_FUNDS` / `SOFT_DECLINE` via `R01`/`R09`) | "Your bank payment of **{amount}** for **{reviewNumber}** was returned by your bank and has not been completed. You can retry or use a different payment method." | "ACH return {code} during pending window. Retry per policy." |
| Settled ACH return (§3.6) | "Your bank reversed a completed payment of **{amount}** for **{reviewNumber}**. The amount is due again — please contact {orgName} to arrange payment." | "Post-settlement ACH return {code}. Money reversal executed (doc 26). No auto-retry; fresh method/consent required." |
| `METHOD_UNUSABLE_LOCAL` | "We couldn't process your payment of **{amount}** for **{reviewNumber}** because your saved payment method needs attention. Please add or update a payment method." | "Pre-flight failure ({code}) — no provider call made." |
| `PROVIDER_UNAVAILABLE` / `UNKNOWN` | "We couldn't process your payment of **{amount}** for **{reviewNumber}**. **You have not been charged.** {orgName} will retry, or you can contact them with any questions." | "{code}. Reconciliation-confirmed no charge. Manual review." |

Copy is a single code-owned source (the catalog), consumed by notifications, the payer portal (Part 3), receipts, and the copy-ready staff message in the failure queue — one place to get the tone right, one place lawyers ever need to review.

---

## 5. Consequence policies — the configurable matrix (wired into 10-checkout-restrictions.md)

The spec's eight configurable organization policies map onto the Part 1 checkout-restriction system plus this doc's notification/hold config. **One evaluator, one gate, one settings surface** — nothing here builds a second enforcement system.

| Spec Part U policy | Mechanism | Where configured | Default |
|---|---|---|---|
| **Warning only** | `PRIOR_PAYMENT_FAILED` = `WARN` (doc 10 row 13) | Settings → Checkout Restrictions | **Default** (`WARN`, per doc 10 matrix; D19's recommended hardening to `REQUIRE_REVIEW` remains an open owner call — this doc does not re-decide it) |
| **Prevent future booking** | New additive `CheckoutRestrictionPolicy.applyAtBooking` flag (§6.2) on FINANCIAL keys: when `true` and enforcement is `BLOCK`/`BLOCK_OVERRIDABLE`, creating a billable booking for the subject is refused with the same server-computed findings | Same rows, per key | **Off** (preserves doc 10 §3.4's advisory-only booking posture unless the org explicitly opts in) |
| **Require Operations approval** | `PRIOR_PAYMENT_FAILED` = `REQUIRE_REVIEW` — the doc 10 §3.5 request-review hand-off works unchanged (front desk requests, Operations clears remotely, release completes) | Same | Available; D19-recommended |
| **Block dispatch** | `PRIOR_PAYMENT_FAILED` (and/or `AMOUNT_DUE_OVER_THRESHOLD`) = `BLOCK` or `BLOCK_OVERRIDABLE` | Same | Available, off |
| **Place membership on financial hold** | New `FinancialHold` record (§6.1) + new FINANCIAL-tier key `MEMBERSHIP_FINANCIAL_HOLD` (§6.2). Manual placement by staff with `revenue.financial_hold_manage`; optional auto-placement at escalation (`autoHoldAfterEscalation`) | Hold: student profile / failure queue action. Key enforcement: Settings → Checkout Restrictions | Key default `BLOCK_OVERRIDABLE` (parity with `MEMBERSHIP_INACTIVE`, doc 10 row 15); auto-placement **off** |
| **Allow temporary override** | Doc 10's `BLOCK_OVERRIDABLE` + immutable one-time `DispatchRestrictionDecision` (`@@unique([dispatchId, key])`) — already designed; nothing new | `dispatch.override_restrictions` holders | Available |
| **Notify Finance Manager** | `OrgPaymentPolicy.failureNotifyRoleIds` (per-failure) and `escalationNotifyRoleIds` (at escalation) — org maps its own "Finance Manager" OrgRole in; RBAC stays data, no role-name checks | Settings → Payments | Empty (holders of `revenue.charge` are always notified regardless) |
| **Notify Account Owner** | Escalation always notifies holders of `revenue.payment_policy_manage` (owner/admin tier) in addition to configured roles | Built-in | **On at escalation** |

**Finalized evaluation semantics for the two Part-2-deferred doc 10 sources:**

- **`PRIOR_PAYMENT_FAILED` (row 13):** fires when the dispatch subject's resolved paying party (Responsible Payer via 11's resolution, else the self-pay student) currently has **≥ 1 Revenue Review in `PAYMENT_FAILED` with Amount Due > 0** in this org. The finding `basis` lists each review number, amount, failure age, and escalation state. It **clears itself the moment the reviews resolve** (paid or voided) — the consequence derives from current unresolved state, never from a demerit history, so there is no residue to manage and no running balance in disguise. Reviews in `ACH_PENDING` or with an in-flight attempt do not fire it.
- **`AMOUNT_DUE_OVER_THRESHOLD` (row 14):** switches from the interim `Student.accountBalance` source to the derived Amount Due aggregation (Σ over the paying party's open invoices, 09 §2.8) with no config change, exactly as row 14 planned. Failed-payment reviews are simply part of that sum.
- **`MEMBERSHIP_FINANCIAL_HOLD` (new key):** fires while an `ACTIVE` `FinancialHold` exists for the dispatch subject. FINANCIAL tier; modes `O·W·R·V·B·X`; default `BLOCK_OVERRIDABLE`. Like every FINANCIAL key it is skipped for maintenance/positioning dispatches, never gates aircraft return/closeout, and never touches safety actions (doc 10 §3.3 — unchanged and absolute).

**Booking-block mechanics (`applyAtBooking`):** evaluated at billable-booking creation (the schedule-event routes) for FINANCIAL keys only, subject-scoped exactly like release evaluation; staff holding `dispatch.override_restrictions` may proceed with a required reason (captured in `recordAudit('schedule.booking_financial_override')` — no new decision model; a booking is not a financial record, and the release gate still evaluates fresh at dispatch time, which remains the enforcement of record). Maintenance blocks and non-billable events are never evaluated. Because doc 10 §3.4 stated booking advisories never block and deferred booking-time work to Part 3, this opt-in flag is recorded as a deliberate, org-elected extension — default off preserves Part 1 behavior exactly; sequencing is open question 1.

---

## 6. Data model additions (Prisma-flavored — final shapes owned by [34-part2-database-additions.md](./34-part2-database-additions.md))

All additive; house rules apply (org FK + explicit `onDelete`, tenant-scoped uniques, org-leading indexes, `createdAt`; enforced by `tests/schema-governance.test.ts`). New enum values ship in their own DDL migration before first use.

### 6.1 FinancialHold (new)

```prisma
enum FinancialHoldStatus {
  ACTIVE
  LIFTED
}

enum FinancialHoldSource {
  MANUAL             // staff-placed
  POLICY_ESCALATION  // auto-placed by the escalation pass (autoHoldAfterEscalation)
}

/// "Membership financial hold" (customer-facing name). Anchored to the Student
/// because the student/renter is the dispatchable, billable subject across the
/// Revenue Engine (RevenueReview.studentId, doc 10's subject resolution). A hold
/// placed because a shared payer failed is created per affected student (the UI
/// offers "hold all students of this payer" as a bulk action). Rows are never
/// deleted — lifting stamps status/liftedAt (audit-shaped history).
model FinancialHold {
  id               String              @id @default(cuid())
  organizationId   String
  studentId        String
  status           FinancialHoldStatus @default(ACTIVE)
  source           FinancialHoldSource
  reason           String              // required, non-empty
  contextReviewIds String[]            @default([]) // advisory links to the failed reviews behind the hold
  placedByUserId   String?             // null for POLICY_ESCALATION
  placedByLabel    String              // "Sarah Chen" | "system:payment-runner"
  liftedAt         DateTime?
  liftedByUserId   String?
  liftedByLabel    String?
  liftedReason     String?             // required on manual lift (engine-enforced)
  createdAt        DateTime            @default(now())
  updatedAt        DateTime            @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  student      Student      @relation(fields: [studentId], references: [id], onDelete: Cascade)

  // Raw-SQL partial unique (R4 idiom; add to the schema-governance allowlist):
  //   ON FinancialHold(studentId) WHERE status = 'ACTIVE'
  // — one active hold per student; history preserved as LIFTED rows.
  @@index([organizationId, status])
  @@index([organizationId, studentId, createdAt])
}
```

Lifecycle: `POLICY_ESCALATION` holds **auto-lift** (system, audited) when the subject's aggregate Amount Due reaches zero — the consequence tracks the cause. `MANUAL` holds lift only by a human with `revenue.financial_hold_manage` + reason — staff placed it deliberately; the system does not second-guess them. Joins org-snapshot capture/wipe/restore and seed fixtures (one lifted hold in the demo org's history) in the same slice.

### 6.2 CheckoutRestrictionPolicy + CheckoutRestrictionKey (extend — doc 10 §5 model)

```prisma
enum CheckoutRestrictionKey {
  // ... existing 15 values (doc 10 §5), plus:
  MEMBERSHIP_FINANCIAL_HOLD // additive; own migration before use
}

model CheckoutRestrictionPolicy {
  // ... existing fields (doc 10 §5) ...
  /// FINANCIAL keys only (engine-clamped like the safety floor): when true and
  /// enforcement is BLOCK/BLOCK_OVERRIDABLE, billable-booking creation for the
  /// subject is also refused (§5). Default false = Part 1 behavior exactly.
  applyAtBooking Boolean @default(false)
}
```

### 6.3 OrgPaymentPolicy (extend — 13 §4.14 singleton) and ScheduledCharge (extend — 13 §4.12)

```prisma
model OrgPaymentPolicy {
  // ... bound fields incl. retryMode / maxAutoRetries / autoRetryDelaysDays ...
  escalationDays          Int      @default(7)   // days resting in FAILED before escalation
  failureNotifyRoleIds    String[] @default([])  // OrgRole ids notified on every failure (extras beyond revenue.charge holders)
  escalationNotifyRoleIds String[] @default([])  // OrgRole ids notified at escalation (owner tier always included)
  autoHoldAfterEscalation Boolean  @default(false) // auto-place a POLICY_ESCALATION FinancialHold at escalation
}

model ScheduledCharge {
  // ... bound fields ...
  failureEscalatedAt DateTime? // escalation claim marker; cleared when the charge leaves FAILED
}
```

`failureEscalatedAt` extends 09 §2.3's mutable-execution-state set (`status`, `runAfter`, `attemptCount`, `lastAttemptId`) with one more execution-state column — it is not a snapshot field and never write-once; doc 34 records the extension. All four `OrgPaymentPolicy` fields are zero-setup defaults (absent row = defaults); `escalationNotifyRoleIds`/`failureNotifyRoleIds` entries are validated org-owned `OrgRole` ids at write time (body-supplied-FK rule).

### 6.4 No changes needed (used as bound)

`PaymentAttempt` (failure fields exist — §4.1 defines their contents), `PaymentMethodReference.status = SUSPENDED`, `RevenueReviewStatus.PAYMENT_FAILED`, `PaymentProviderEvent`, `Refund`/`Dispute` (doc 26), `RevenueAllocation`/`PlatformFee` reversal shapes (docs 27/28). Additive `NotificationKind` values `PAYMENT_FAILED` and `PAYMENT_METHOD_REQUIRED` are owned by doc 31 (13 §11 already anticipates them); listed here as this workflow's requirement. There is **no** `PAYMENT_FAILURE_ESCALATED` kind — escalation (§3.5) reuses the `PAYMENT_FAILED` topic thread, refreshing its org-side counter row with role-targeted rows to the escalation roles rather than adding a twelfth kind (doc 34 R-P8; doc 31 §3.6/§5.1).

---

## 7. Validation & business rules

### 7.1 Hard rules — the spec Part U do-not list, verbatim and binding

> Do not:
>
> - **Reverse completed training records**
> - **Reopen aircraft dispatch automatically**
> - **Remove maintenance updates**
> - **Block emergency action**
> - **Expose raw provider errors to students**
>
> Use customer-friendly messages.

Enforcement is structural, not aspirational:

| Rule | Structural enforcement |
|---|---|
| Never reverse completed training records | The failure/reversal engines (`payment-failures.ts`, doc 26's reversal engine) import no training module and hold no FK to `LessonRecord`/`Endorsement`/`SyllabusEnrollment`; instructor-signed records are `Restrict` FKs repo-wide. Static source-scan test (dispatch-idempotency style) asserts no `lessonRecord`/`endorsement` write appears in any payment/failure engine or route. |
| Never reopen dispatch automatically | `Dispatch` `CLOSED` is terminal; no payment code path writes `Dispatch.status` (same static scan). A failed payment on a closed flight is a Revenue Review problem, period. |
| Never remove maintenance updates | Failure engines hold no maintenance imports; meters, components, squawks, and orders written at closeout are untouched by any financial transition. |
| Never block emergency action | Doc 10 rules restated as absolute: aircraft return, operational closeout, squawk filing, and grounding are **never** gated by any financial state, hold, or restriction; FINANCIAL keys skip maintenance/positioning dispatches; no configuration can change this (tier is code, not data). |
| Never expose raw provider errors to students | Payer/student surfaces render only `payerCopyFor()` output (§4.3); raw payloads live solely in `PaymentProviderEvent` (platform-forensic); contract test asserts every catalog category has payer + staff copy and greps payer-facing components for direct `failureMessage`/`payload` usage. |

### 7.2 Business rules

1. **Only the payment engine writes failure-side transitions** (review statuses 6–13/15 per doc 03) — every transition is a guarded `updateMany` claim; `count === 0` is a silent no-op for webhook replays and a 409 for human actions.
2. **The failure transaction is DB-only** — no provider calls inside it, ever (spec Part AB auto-reject). Provider truth arrives via E1 results or E2 webhooks; a provider timeout leaves the attempt in `CREATED` for reconcile-then-proceed (09 §2.4) — a failure is never synthesized.
3. **Amounts are server-resolved on every retry** (`min(snapshot, current Amount Due)`, Decimal end-to-end); a retry when Amount Due = 0 completes without an attempt. Client-supplied amounts are never accepted.
4. **Retry ceilings are hard**: `maxAutoRetries` caps at 3 in validation regardless of input; `NEVER_SAME_METHOD` categories refuse retry with the same method reference at the engine level (not just UI); unauthorized ACH categories additionally require a fresh consent record (doc 20) before any new attempt.
5. **Escalation is idempotent** (claim on `failureEscalatedAt`) and self-healing: leaving `FAILED` (retry claim, completion, cancellation) clears the marker in the same transition so a later relapse re-arms the clock.
6. **Holds require a reason**; manual lifts require a reason; holds never gate return/closeout; `SAFETY` tier remains untouchable by anything in this doc.
7. **Voiding a failed review** stays doc 03's rule: `revenue.void` + reason, only while no attempt succeeded or is in flight and Σ settled `Payment` rows = 0; the void cancels the charge (`→ CANCELLED`) atomically, which also halts retries and clears escalation.
8. **Partial offline collection** against a `PAYMENT_FAILED` review leaves the review in `PAYMENT_FAILED` (Invoice → `PARTIALLY_PAID` projection) with a reduced derived Amount Due; full collection transitions review → `PAID`, charge → `COMPLETED`.
9. **Tenancy**: every failure queue, hold, and notification is scoped by `session.organizationId`; webhook tenancy resolves from local `PaymentAttempt` references only (13 §4.12); cross-tenant references are 404s.
10. **No AI pathway** may retry, place/lift a hold, override a restriction, or mutate any financial record (constitution rule 8).

---

## 8. RBAC, approvals & audit

### Permissions (data in `src/lib/permissions.ts`; no new Role enum values)

| Key | Grants | Default roles |
|---|---|---|
| `revenue.charge` *(Part 1)* | Retry, reschedule, cancel a charge; re-point method in `FAILED`/`AWAITING_MANUAL`; run the org due-payments pass | ACCOUNT_OWNER, SCHOOL_ADMIN, ACCOUNTANT |
| `revenue.payment_methods_manage` *(Part 1)* | Generate hosted method-update sessions for a payer | ACCOUNT_OWNER, SCHOOL_ADMIN, ACCOUNTANT |
| `revenue.financial_hold_manage` **(new)** | Place and lift financial holds | ACCOUNT_OWNER, SCHOOL_ADMIN; recommended for the Operations Director OrgRole template |
| `dispatch.override_restrictions` / `dispatch.review_restrictions` *(doc 10)* | Temporary override / Operations clearance of financial findings | per doc 10 §8 |
| `revenue.payment_policy_manage` *(Part 1)* | Edit the §6.3 escalation/notification fields (same PATCH route as the rest of `OrgPaymentPolicy`) | ACCOUNT_OWNER, SCHOOL_ADMIN |

All mutations: `authorize(<key>, { mutating: true })` — read-only impersonation refused automatically. Escalation/auto-retry passes run as the payment runner (post-commit trigger, org sweep with `revenue.charge`, or platform sweep via `authorizePlatform({ mutating: true })`).

### Audit actions (`recordAudit`, reconstruct-without-DB-state metadata)

| Action | When | Metadata highlights |
|---|---|---|
| `revenue.charge_failed` *(Part 1)* | Failure tx commit | attempt id/number, normalized code, category, trigger, retry decision (next slot or none), method consequence |
| `revenue.charge_retried` *(Part 1)* | Manual retry claim | actor, new attempt number, resolved amount, method used |
| `revenue.charge_method_changed` *(Part 1)* | Re-point in `FAILED`/`AWAITING_MANUAL` | before/after method display metadata |
| `revenue.failure_escalated` **(new)** | Escalation claim | charge/review ids, days outstanding, amount due at escalation, notified role ids, hold placed? |
| `revenue.financial_hold_placed` / `revenue.financial_hold_lifted` **(new)** | Hold lifecycle | subject, source, reason, context review ids; lift reason |
| `schedule.booking_financial_override` **(new)** | Staff override a booking block | keys, findings summary, reason |

Domain events: `payment.failed` (Part 1 registration) emitted post-commit on every failure; `payment.failure_escalated` **(new)** registered in `WEBHOOK_EVENTS` with the §3.5 pass as its live emit site (constitution: registered ⇒ emitted). Webhook-driven transitions carry actor label `system:stripe-webhook`; runner transitions `system:payment-runner` (Part 1 convention).

---

## 9. Failure modes & edge cases (SRE lens)

| Scenario | Behavior |
|---|---|
| Failure webhook replays (same `providerEventId`) | `PaymentProviderEvent` unique-insert + `processedAt` idempotency (doc 23); the reduce's guarded claim finds the attempt already `FAILED` → no-op. One failure, one notification set. |
| Failure webhook for an attempt already `CANCELLED` (review voided in the race window — shouldn't occur since void is blocked while in flight) | Attempt claim fails (`count === 0`); event stored with `processingError`; `ReconciliationException` (`kind: STALE_PENDING_PAYMENT` family) opened for human review. Review stays `VOIDED` — terminal statuses are never reanimated by webhooks. |
| Provider timeout during a retry | Attempt rests in `CREATED`; **no failure is synthesized**; reconcile-then-proceed via the stored idempotency key (09 §2.4); the charge shows "attempt in progress — reconciling" in the queue, and new retries are structurally blocked meanwhile. |
| Two staff hit Retry simultaneously | Guarded `FAILED → PROCESSING` claim: one wins, the other gets 409 "Charge already in progress — refresh." One attempt, one provider call. |
| Auto-retry slot due while staff manually retries | Same claim — whoever claims first wins; the runner's `count === 0` skips the row. |
| Method updated while an auto-retry is `SCHEDULED` | Re-pointing is permitted only in `FAILED`/`AWAITING_MANUAL` (13 §4.12, binding), so a `SCHEDULED` retry always runs with its snapshot method. If that method is still usable, the slot proceeds normally. If it became unusable, either the runner E3-fails the slot into `FAILED`, or staff use **Charge now** (`SCHEDULED → PROCESSING`), whose pre-flight validation E3-fails immediately into `FAILED` — either way the charge lands in `FAILED`, where the one-click re-point + retry (§3.4) applies. The UI chains this as a single "Use new method and retry" action; every intermediate attempt is append-only and audited. |
| Payer has multiple failed reviews | Each review keeps its own derived Amount Due and failure trail; the payer-level figure anywhere in UI is a read-time aggregation; notifications reference specific reviews (itemized, per principle 4); doc 31 owns digesting multiple same-day notifications. |
| Escalation pass crashes mid-sweep | Bounded pass, per-row claims: completed rows stay escalated, the rest are picked up next pass. Nothing double-notifies (claim), nothing is lost (durable `FAILED` state is the queue). |
| Org edits `escalationDays` retroactively | Next pass evaluates against the new value — config reads are live (§3.2 step 2 note); already-escalated charges keep their marker. |
| Hold subject books via a different org member (shared aircraft partner, etc.) | Holds and financial keys are **subject-based** (doc 10 §2) — the block follows the student, not who is booking or releasing. |
| `REVENUE_CHARGING` off | No attempts exist, so no failures; offline recording and manual invoices work; restriction keys still evaluate Amount Due (manual-invoice orgs have failures of the human kind). |
| Settled ACH return after the review was partially refunded | Reversal math caps at what remains collected (doc 26's in-tx cap); review transition per doc 26; this doc's workflow handles the reinstated Amount Due. |

---

## 10. UX notes (aviation-calm, trust-first)

- **The failed-payments queue** (Revenue Dashboard, doc 30 owns placement) is the operational home: review number, payer, Amount Due, category chip, attempts count, age, next auto-retry, escalated badge. Row actions: **Retry** · **Update payment method** (generates the hosted link + copy-ready payer message) · **Record offline payment** · **Reschedule** · **Void** (only when eligible) · **Place hold**. Every action states its consequence on the button — "Retry — charge Visa •••• 4242 $412.50 now", never a bare "Retry" (the doc 03 consequence-wording rule extended to failure controls).
- **Category chips** (`Declined`, `Insufficient funds`, `Card expired`, `Action required`, `Bank return`, `Do not retry`) get `STATUS_TONE` entries — single-source, light/dark tested. `Escalated` renders as the red tier.
- **Payer-facing surfaces** show §4.3 copy only, always with the itemized Amount Due and a reassurance line when no money moved. Nothing a parent reads should require a phone call to decode — but the phone number is right there anyway.
- **Student profile / dispatch board**: an `ACTIVE` financial hold renders as a banner with the reason, who placed it, and the resolution path ("Resolve Amount Due of $412.50 or contact the office") — visible *before* the student drives to the airport, via the doc 10 preview endpoint and (if `applyAtBooking`) at booking time.
- **Failure detail drawer (staff)**: full attempt timeline (append-only trail), normalized codes, method history, audit links — the accountant's "prove nothing was double-charged" view is one click, not a support ticket.
- Mobile + light/dark parity; loading/empty/error states; empty state for the failure queue is a design feature: "No failed payments. Nice." — the healthy default deserves to feel healthy.

---

## 11. Out of scope for Part 2 / deferred to Part 3

- **Dunning sequences and email receipts/reminders** — no email adapter exists; Part 2 is in-app + copy-ready staff messages only ("do not claim email was sent"). Email lands with the platform email adapter (Part 3 / PRODUCTION.md §13.1) behind `EMAIL_ENABLED`.
- **Payer portal self-service** (view failed payment, update method, pay now) — Part 3 with doc 11's `/payer` surface and `authorizePayer()`; Part 2 ships the staff-generated hosted-setup link.
- **`WRITTEN_OFF`** — enum reserved (Part 1), **no writer in Parts 2–3**; write-off remains a named future resolution for exhausted failures.
- **Automatic late/OVERDUE fees** on failed or aging reviews — doc 06 §9 deferral stands.
- **Aging/collections reporting and exports** of failed-payment history — Part 3 Financial Export territory (doc 12).
- **Exact-time escalation/retry scheduling** — until the queue/cron adapter lands (D14/R7), passes run on the runner's triggers; late is possible, silent-skip and double-fire are not (`failureEscalatedAt`/`runAfter` are durable state). Limitation surfaced in Settings copy, per 09 §2.9.
- **Standing (multi-dispatch) waivers** for financial findings — doc 10 supports one-time overrides only; unchanged.

**Compliance confirmations:** this document deploys nothing, executes no charge (test mode is the only sanctioned environment and is not exercised by a design doc), sends no email, and stores no raw payment credentials or raw provider errors anywhere in the design.

---

## 12. Open questions (product owner)

1. **Booking-block sequencing (`applyAtBooking`).** Part U requires "prevent future booking" as a configurable policy; doc 10 §3.4 deferred all booking-time evaluation to Part 3 and kept advisories non-blocking. This design ships the flag default-off (Part 1 posture preserved). Does the booking-time enforcement point build in Part 2 alongside the failure workflow, or does the flag land schema-only with enforcement in Part 3? (Recorded here per the extend-don't-diverge rule.)
2. **Escalation default.** Is `escalationDays = 7` the right zero-config default for a flight school (a week of an unpaid $400 lesson), and should `autoHoldAfterEscalation` ever default on for any org profile? Recommendation: 7 days, auto-hold default off everywhere — holds are a relationship decision.
3. **Payer notification timing.** Spec Part U lists "notify payer" in the failure sequence, and this design notifies immediately. Several schools prefer to call the parent before any automated notice lands. Is an org-configurable staff-first grace window (e.g. notify payer after N hours unless staff mark "handled") permissible within the spec, or is immediate payer notification mandatory? Recommendation: immediate stays the default either way.
4. **`PRIOR_PAYMENT_FAILED` default enforcement** — D19 (doc 16) already holds this: `WARN` (doc 10 matrix) vs the recommended `REQUIRE_REVIEW`. The failure workflow works identically under either; flagged because Part 2 seeds the engine default constant. Not re-opened here — needs the D19 sign-off.
5. **Hold visibility to the payer/student.** Should an active financial hold be visible to the student/payer in Part 3 self-service surfaces (transparent, self-resolving) or staff-only (avoids embarrassment for sponsor-caused failures)? Recommendation: visible to the payer whose failure caused it; visible to the student as "contact the office" without financial detail when a third-party payer is involved (privacy boundary, doc 11).
