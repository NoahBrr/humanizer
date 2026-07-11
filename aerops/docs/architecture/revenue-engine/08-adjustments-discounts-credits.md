# Adjustments, Discounts, and Credits

> **Status:** Proposed — Phase 8 Part 1 · **Date:** 2026-07-10 · **Lead roles:** Financial Systems Architect; Aviation Accounting Specialist; Director of Operations · **Part of:** Revenue Engine design set ([README](./README.md))

This document owns Part 1 deliverable 10 (spec Part H — Discounts, Credits, and Manual Adjustments): how money changes *after* charges are calculated — before approval, after approval, and after payment — without ever editing an approved financial snapshot.

---

## 1. Purpose & scope

An authorized user (holding the adjustment permissions defined in §7 — "Operations Director or higher" in the spec's terms, expressed as permission keys, never role names) may:

| # | Operation (Part H) | In scope for Part 1 design | Release 1 implementation |
|---|---|---|---|
| 1 | Apply discount | Yes | Yes |
| 2 | Waive fee | Yes | Yes |
| 3 | Add credit | Yes — bounded, non-wallet semantics (§3.5) | Yes |
| 4 | Void a line item | Yes | Yes |
| 5 | Correct a line item | Yes | Yes |
| 6 | Issue refund | Yes — design level; provider mechanics in Part 2 | Yes (manual + Stripe test mode in Part 2) |
| 7 | Apply promotional code | Yes | Yes (see open question 3) |
| 8 | Transfer responsibility to another payer | Yes | Yes |
| 9 | Split responsibility across payers | Marked future (spec: "if later supported") | **Deferred** — recorded in §10 |

Explicit first-release exclusions, per spec Part H (recorded as deferred in §10, never silently dropped):

- **No invoice merging.**
- **No unrestricted wallet balances.**
- **No prepaid packages.**

Everything here is DESIGN ONLY (Phase 8 Part 1). No schema, code, or migration changes ship with this document. Final money-column types are recommended as `Decimal(12,2)` plus an explicit ISO 4217 currency column; [13-database-model.md](./13-database-model.md) makes the binding call.

---

## 2. Core principle: append, never edit

**An approved Revenue Review snapshot is immutable. Every post-approval change is a new adjustment record — never an edit** (spec principle 5; Part L: "Corrections must use adjustment records").

This is a deliberate, documented carve-out from `DATABASE_STANDARDS.md` ("computed values are derived at read time, never stored"): an approved snapshot is a **point-in-time financial fact**, not a cache of a computable answer. Changing a rate, tax rule, or discount policy tomorrow must not alter yesterday's approved review. The Revenue Engine ADR (ADR-025 proposal, see the architecture doc) records this carve-out so the Performance and Architecture review gates have a written basis.

### 2.1 Three adjustment families

Every Part H operation falls into exactly one family. The family determines *what* the adjustment touches — and therefore what stays frozen.

| Family | Operations | What changes | What never changes |
|---|---|---|---|
| **Charge-side** | Discount, fee waiver, line void, line correction, promo code | What the payer owes (invoice total, via append-only lines; pre-tax) | Original approved lines, rate snapshots, tax snapshot versions |
| **Collection-side** | Refund, credit application | What has been / will be collected (payments, refunds, credit consumption; post-tax) | Invoice total, approved lines |
| **Responsibility-side** | Payer transfer (payer split deferred) | Who owes it (responsible-payer pointer) | Amounts, lines, snapshots |

The distinction is standard accounting practice and it resolves most edge cases mechanically: a **discount** reduces the taxable charge (charge-side, pre-tax); a **credit** is stored post-tax value consumed like a payment (collection-side); a **refund** returns collected money (collection-side). A discount on an already-paid review is not a discount — it is a refund or a credit issue (rule V9, §6).

### 2.2 How adjustments materialize

Charge-side adjustments never mutate locked `InvoiceLine` rows. They **append** new signed lines that reference the adjustment:

- **Void:** append one offsetting line (same `kind` as the target line, negative amount, `offsetsLineId` = target). Net revenue by category stays truthful.
- **Correction:** append the offsetting line **plus** a replacement line (target line's `kind`, corrected quantity/unit price) in the same transaction.
- **Discount / waiver / promo:** append a `DISCOUNT`-kind line (negative amount) referencing the adjustment (and the promo redemption, where applicable).
- **Tax delta:** the adjustment engine asks the tax engine for the tax effect **under the original review's snapshotted tax rule version** — never current rules. The result is written as an **additional signed `TaxSnapshot` (+ `TaxSnapshotItem`) row set** referencing the adjustment via `sourceType`/`sourceId` — never as a tax `InvoiceLine` ([07-tax-model.md](./07-tax-model.md) §4: tax is not a line and no `TAX` value is added to `LineItemKind`; corrections create reversal snapshots referencing the original, §5.8). These signed tax snapshots feed the Amount Due derivation ([09-payment-timing-and-collection.md](./09-payment-timing-and-collection.md) §2.8) and, for upward deltas, the supplementary `ScheduledCharge` amount (§3.3).

Because every existing consumer (billing pages, health-score, insights, Import Center) derives invoice totals by summing lines, append-only materialization keeps all current read paths correct with no reinterpretation of existing data.

Collection-side and responsibility-side adjustments touch no lines at all: refunds create `Refund` rows against specific payments; credits create `CreditApplication` rows consumed as `ACCOUNT_CREDIT`-method payments (the enum value already exists); payer transfers update the responsibility pointer under a guarded status check.

### 2.3 Part H required fields — traceability

| Spec requirement | Where it lives |
|---|---|
| Actor | `RevenueAdjustment.requestedById` + `requestedByLabel` (bare user-id string + denormalized label, matching the `AuditLog.actorUserId` convention so API-key and impersonation actors fit, and the record survives user deletion) |
| Reason | `RevenueAdjustment.reason` (required, non-empty) |
| Before/after amount | `beforeAmount`, `afterAmount`, `amountDelta` (all `Decimal(12,2)` + `currency`) |
| Approval status | `status` + `approvedById/Label/At` + `secondApprovedById/Label/At` |
| Effective date | `effectiveAt` (accounting period the adjustment lands in; defaults to `appliedAt`) |
| Related Revenue Review | `revenueReviewId` (required FK) |
| Audit record | `recordAudit` on every state change (action catalog in §7.3), `oldValue`/`newValue` carrying before/after amounts — plus centralized impersonation attribution for free |

---

## 3. How it works

### 3.1 Adjustment lifecycle

```
                        ┌──────────► REJECTED   (terminal; reason required)
                        │
  create ──► PENDING_APPROVAL ──► APPROVED ──► APPLIED   (terminal; financial effects committed)
                        │              │
                        └──────────────┴────► CANCELLED  (terminal; only before APPLIED)
```

| Transition | Who / how | Guards |
|---|---|---|
| create → `PENDING_APPROVAL` | `billing.adjust` (refunds: `billing.refund`) | Review in an adjustable status (§6 V8–V10); reason present; references org-owned (cross-tenant = 404) |
| create → `APPROVED` (auto-approve) | Creator holds the approve permission **and** no policy trigger fires (below every §4 threshold, non-high-risk, kind not always-second-approval) — see the precedence note below | Policy evaluation recorded in audit metadata (`autoApproved: true`, thresholds checked) |
| `PENDING_APPROVAL` → `APPROVED` | `billing.adjust_approve` (refunds: `billing.refund_approve`) | Separation of duties: `approvedById ≠ requestedById` when policy requires; second approval captured when policy requires (§4) |
| `APPROVED` → `APPLIED` | Engine, inside one `db.$transaction` | Guarded `updateMany({ where: { id, status: 'APPROVED' } })` claim — `count === 0` → 409, the same idempotency idiom as dispatch closeout. Financial effects (lines / refund row / credit / payer pointer) commit in the same transaction. No Stripe or other external calls inside the transaction — provider work is post-commit (Part 2). |
| `PENDING_APPROVAL` → `REJECTED` | Approver | `rejectedReason` required; staged draft lines removed (audited) |
| any pre-`APPLIED` → `CANCELLED` | Requester or approver | Never after `APPLIED` — an applied adjustment is itself immutable; to undo it, create a new opposing adjustment |

**An `APPLIED` adjustment is never edited or deleted.** Reversing a mistake is a new adjustment referencing the same review (and, in audit metadata, the adjustment it opposes). This is the same append-only discipline as `InventoryMovement`.

**Auto-approval vs separation of duties — precedence (binding).** `separationOfDutiesRequired` (§4; default `true`) does **not** disable the create → `APPROVED` path. Self-approval via auto-approve remains permitted only when no policy trigger fires: below every §4 threshold, a non-high-risk adjustment, and a kind that is not always-second-approval (refunds, damage-fee waivers). The audit metadata records `autoApproved: true` with the evaluated thresholds, so the trail shows exactly why no separate approver was required. For **every policy-triggered approval and all second approvals**, requester–approver separation is enforced: `approvedById ≠ requestedById` and `secondApprovedById ∉ {requestedById, approvedById}` (§7.2). This satisfies spec Part B — no one approves their own *high-risk* manual adjustment — without making routine below-threshold corrections a two-person ceremony for every org left on defaults.

### 3.2 Pre-approval path (Draft / Awaiting Instructor Review / Awaiting Operations Review / Changes Requested)

Before approval the Revenue Review is a working draft — but Part H operations are still uniform:

- **Ordinary draft editing is not an adjustment.** Fixing a quantity, correcting instructor time before submission, adding a Revenue Item line — these are draft edits, audited via `recordAudit` with before/after values (per [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md)), and need no `RevenueAdjustment` record.
- **The eight Part H operations always create a `RevenueAdjustment` record, even pre-approval.** A pre-approval discount, waiver, promo code, or credit issue gets the full actor/reason/before-after/approval-status shape. This keeps reporting uniform ("total discounts granted this month" is one query, regardless of when the discount was applied) and satisfies Part H's "every adjustment must include…" without a timing loophole.
- Pre-approval charge-side adjustments materialize immediately as **staged draft lines** (flagged with `adjustmentId`). They are folded into the approved snapshot at review approval.
- At review approval, the approval-policy engine ([03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md)) requires every attached adjustment to be `APPROVED` — pending ones either escalate the review (second approval for discounts, damage-fee waivers, manual items) or block approval with an actionable error. Review approval flips attached `APPROVED` adjustments to `APPLIED` in the same lock transaction.
- A rejected pre-approval adjustment removes its staged lines (audited) and returns the review to the editor with the rejection reason.

### 3.3 Post-approval path

After approval the snapshot is locked. The path depends on the family and on collection state:

| Review state | Charge-side reduction (discount/waiver/void/downward correction) | Charge-side increase (upward correction, late-discovered fee) | Collection-side | Responsibility-side |
|---|---|---|---|---|
| Approved / Payment Scheduled (batch not initiated) / Payment Failed | Allowed — appends signed lines; amount due recomputes | Allowed — appends lines; the delta is collected via a **supplementary `ScheduledCharge`** (mechanism below) | Credit application allowed (as `ACCOUNT_CREDIT` payment) | Payer transfer allowed |
| Payment Processing / ACH Pending (a Payment Attempt is in flight) | **Blocked** (V10) — changing the total mid-flight breaks reconciliation. Wait for the attempt to settle or fail. | **Blocked** (V10) | Refund not yet possible (nothing captured) | **Blocked** (V10) |
| Paid / Partially Refunded | **Not a discount — use a refund or credit issue** (V9). Charge-side reductions are refused with that exact guidance in the error message. | Allowed — appends lines; review returns to a balance-due state and the delta is collected via a **supplementary `ScheduledCharge`** (mechanism below) | Refund (§3.7); credit issue | Refused as a "transfer" — post-payment reassignment is a refund to the old payer + a new charge to the new payer, two explicit adjustments (V11) |
| Voided / Refunded (fully) | Blocked — terminal | Blocked | Refund history remains readable | Blocked |

**Collecting an upward delta — the supplementary `ScheduledCharge` mechanism.** The original `ScheduledCharge` can never collect an upward delta: it is one-per-review (`revenueReviewId` and `invoiceId` are `@unique`), its `amount` is a write-once snapshot of the approval-time total, and charge initiation caps at `min(snapshot amount, Amount Due)` ([09-payment-timing-and-collection.md](./09-payment-timing-and-collection.md) §5.1). So when an upward charge-side adjustment (upward `LINE_CORRECTION`, late-discovered fee) reaches `APPLIED`, the applying transaction also creates **one supplementary `ScheduledCharge` for that adjustment**:

- `adjustmentId` = the applied adjustment (nullable column on `ScheduledCharge`, null on original per-review anchors); **at most one supplementary charge per adjustment** — `@@unique([revenueReviewId, adjustmentId])` semantics via a partial unique index, the same structural exactly-once guarantee as the original anchor. Binding schema shape owned by [13-database-model.md](./13-database-model.md).
- `amount` = the adjustment's `amountDelta` **plus** its signed tax-snapshot delta (§2.2) — the collectable delta, never a recomputation of the review total. Initiation still caps at `min(amount, Amount Due)`.
- `policy` = the review's snapshotted payment timing policy; the supplementary charge flows through the same runner, retry, status, and Amount Due machinery as the original anchor ([09-payment-timing-and-collection.md](./09-payment-timing-and-collection.md)). Under `MANUAL_INVOICE`, it behaves like any manual-invoice anchor: no charge is planned and the delta shows as Amount Due.
- Whether the supplementary charge **auto-initiates** under the snapshotted policy or waits for a manual trigger is decision D21 ([16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md)); recommended default: auto-initiate, since the adjustment approval is the explicit human consent (open question 6).

### 3.4 Operation matrix

| Operation | Kind | Family | Pre-approval mechanics | Post-approval mechanics | Default approval policy (§4) |
|---|---|---|---|---|---|
| Apply discount | `DISCOUNT` | Charge | Staged negative `DISCOUNT` line (percent or fixed; percent computed on eligible pre-tax charge base, rounded half-up to the cent at the adjustment total) | Appended negative `DISCOUNT` line + signed snapshotted-version tax-snapshot delta (§2.2) | Second approval above 10% or $250 (whichever trips first) |
| Waive fee | `FEE_WAIVER` | Charge | Staged offsetting line against the fee line (full or partial) | Appended offsetting line against the locked fee line | Same thresholds as discount; **damage-fee waivers always require second approval**; Revenue Item flags (`requiresNote`, `requiresAttachment`, `requiresSecondApproval` — [06-revenue-items.md](./06-revenue-items.md)) are honored on the waiver too |
| Add credit | `CREDIT_ISSUE` | Collection | Creates a `CustomerCredit` (§3.5) on apply | Same — credit issue is independent of any review's lock state, but always records the related review that prompted it | Second approval above $500 |
| Void line item | `LINE_VOID` | Charge | Staged full offset of the target line | Appended full offset; one `APPLIED` void per target line (V6) | Second approval per manual-item policy |
| Correct line item | `LINE_CORRECTION` | Charge | Staged offset + replacement lines | Appended offset + replacement (corrected qty/unit price/description held on the adjustment) | Auto-approvable below thresholds |
| Issue refund | `REFUND` | Collection | n/a (nothing collected yet) | `Refund` row against a specific payment; reversal contract §3.7 | **Always second approval** (default on) |
| Apply promo code | `PROMO_CODE` | Charge | Staged `DISCOUNT` line + `PromoCodeRedemption` | Not applicable post-approval (promos attach before lock; post-lock goodwill is a discount/credit) | Auto-approvable (terms were pre-approved when the code was created) |
| Transfer payer | `PAYER_TRANSFER` | Responsibility | Change the draft's responsible payer (validated against approved payer links — [09-responsible-payers.md](./11-responsible-payers.md)); still recorded as an adjustment for uniform audit | Pointer update under guarded status check; `beforeAmount = afterAmount` (money unchanged); `fromPayerId`/`toPayerId` recorded | Requires `billing.adjust`; blocked while payment in flight |
| Split payer | — | Responsibility | — | — | **Deferred** (§10) |

### 3.5 Credits without a wallet

Part H requires "add credit"; the spec simultaneously forbids unrestricted wallet balances, and product principle 4 avoids open running balances. The design threads this with **bounded credits**:

1. **Every credit traces to an origin.** `CustomerCredit.originAdjustmentId` is required and unique — a credit exists only because an `APPLIED` `CREDIT_ISSUE` adjustment (with actor, reason, approval) created it. There is no top-up path, no purchase path (that would be prepaid packages — deferred), no cash-out path.
2. **Credits are post-tax stored value, consumed like a payment.** A credit never changes an approved total; it reduces the amount due. Consumption creates a `CreditApplication` and a payment record with the existing `ACCOUNT_CREDIT` method. This keeps snapshots immutable and keeps tax math untouched (goodwill credits do not retroactively change taxable base — the accountant-correct treatment).
3. **Credits are targeted or next-invoice, never free-floating.** `targetRevenueReviewId` set → applicable only to that review. Unset → the credit is offered against the holder's next Revenue Review at collection time ("next invoice" semantics). With `autoApplyCredits` on (default), the collection step consumes open credits before charging the saved Payment Method.
4. **Credits expire.** `expiresAt` required; default now + 12 months (org-configurable). Expiry is a status transition (`OPEN`/`PARTIALLY_APPLIED` → `EXPIRED`), audited, never a row deletion.
5. **Partial consumption is append-only.** Remaining value = `amount − SUM(applications)`, computed inside the applying transaction with the credit row locked — never stored as a mutable running balance (complies with the computed-at-read-time rule; the InventoryMovement idiom). `@@unique([creditId, revenueReviewId])` structurally prevents double-application to one review.
6. **Refund-to-credit is allowed but bounded the same way.** When a refund's destination is `CUSTOMER_CREDIT` (useful for cash/check-collected payments, or when the org prefers credit), the issued credit carries the refund's adjustment as its origin.

What makes this *not* a wallet: no deposits, no holder-directed spending, origin-traceable, expiring, consumed only through Revenue Review collection, and visible to the student/payer as "Credit available — applies to your next invoice," never as a spendable balance.

### 3.6 Promotional codes

Org-defined, tenant-scoped codes redeemed onto a Revenue Review before approval:

- **Definition:** code (unique per org, case-insensitive match), percent or fixed amount, optional cap for percent codes (`maxDiscountAmount`), category scoping (Revenue Item category keys; empty = whole review), effective window, `maxRedemptions`, `perPayerLimit` (default 1), active flag. Managing codes requires `billing.promo_manage`.
- **Redemption:** validates window, limits, scope, and org ownership; creates a `PromoCodeRedemption` + a `PROMO_CODE` adjustment materialized as a staged `DISCOUNT` line. The promo's terms are **snapshotted onto the adjustment** (percent/amount/cap at redemption time) — later edits to the code never change past redemptions.
- **One promo per review** (default; no stacking — open question 3). `@@unique([promoCodeId, revenueReviewId])` prevents double redemption of the same code on one review.
- Deactivating a code (`active = false`) stops new redemptions; existing redemptions and their reviews are untouched.

### 3.7 Refunds (design level — provider mechanics in Part 2)

A refund is a collection-side adjustment plus a `Refund` execution record:

1. **Request** (`billing.refund`): pick the review, the specific payment being refunded, full or partial amount, destination (`ORIGINAL_METHOD` | `CUSTOMER_CREDIT` | `MANUAL` for cash/check handed back), and reason. Refundable remainder = captured amount − prior `SUCCEEDED`/in-flight refunds against that payment, computed inside the transaction (V12).
2. **Approve** (`billing.refund_approve`): always a second pair of eyes by default; separation of duties applies.
3. **Apply:** guarded `APPROVED → APPLIED` claim creates the `Refund` row (`PENDING`). **One refund per adjustment** (`Refund.adjustmentId @unique`) is the replay guard: retrying the request cannot mint a second refund.
4. **Execute (Part 2):** the payments engine calls the provider post-commit (never inside a DB transaction), using the refund id as the provider idempotency key; Stripe webhook events drive `PENDING → PROCESSING → SUCCEEDED | FAILED` through the inbound-event idempotency table (BillingEvent pattern). `MANUAL` and `CUSTOMER_CREDIT` destinations settle without a provider call. Stripe test mode only; nothing in this phase touches live charges.
5. **Reversal contract (on `SUCCEEDED`)** — all reversals are **new signed rows, never edits**:
   - **Revenue Allocation:** negative allocation rows referencing the originals. Line-targeted refunds reverse exactly the allocations of those lines; blanket partial refunds reverse pro-rata across allocation buckets using the **largest-remainder method** so the parts sum exactly to the refunded amount (explicit rounding policy — Financial gate requirement). Contract owned by the Revenue Allocation section of the architecture doc ([02-architecture.md](./01-revenue-engine-architecture.md)).
   - **Instructor Compensation:** negative InstructorEarning adjustment rows per the org's clawback policy (§4): default `SERVICE_LINES_ONLY` — compensation reverses only when the refunded/voided line is the instruction line that earned it; goodwill refunds leave earnings intact. Contract owned by [05-instructor-rates-and-compensation.md](./04-instructor-time-and-rates.md).
   - **Ledger:** reversal `LedgerEntry` rows (append-only).
   - **Platform fee:** whether AeroOps returns its platform fee pro-rata is an open pricing decision (open question 1) — the reversal row structure supports either answer.
   - **Review/invoice status** → Partially Refunded / Refunded (status machine owned by [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md); enum additions land per the two-step enum migration rule).
6. A `FAILED` refund keeps its record with `failureReason`; retry is a new provider attempt against the same `Refund` (Part 2), never a duplicate row.

Refunding an `ACCOUNT_CREDIT`-method payment does not call a provider — it reopens the consumed credit via a negative `CreditApplication` (append-only), bounded by the original credit's expiry.

### 3.8 Payer transfer

- **Validations:** new payer must hold an approved, active link to the student ([09-responsible-payers.md](./11-responsible-payers.md)); review must be in a transferable state (§3.3); no Payment Attempt in flight (guarded check inside the transaction). Missing payment method on the new payer produces a warning, not a block (payment will simply fail readiness later — checkout-restriction semantics stay in their own doc).
- **Effect:** responsibility pointer on the review/invoice updates in one transaction with the adjustment's `APPLIED` claim. Amounts unchanged (`beforeAmount = afterAmount = current total`); `fromPayerId`/`toPayerId` carry the identity change; audit `newValue` records both.
- **After payment:** there is no post-payment "transfer." The supported path is two explicit adjustments — refund to the payer who paid, then collection from the new payer — so the money trail never shows value silently teleporting between customers.

---

## 4. Configuration surface

Adjustment policy has **two homes**, per the split ratified in [13-database-model.md](./13-database-model.md) (R15):

- **Approval keys** live on doc 03's org-scoped `RevenueWorkflowPolicy` ([03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md); typed columns, never a settings JSON blob). Two keys this doc originally proposed deduplicate into existing doc 03 columns — **doc 03's names win**: `refundSecondApproval` ≡ existing `secondApprovalForRefunds`; `separationOfDuties` ≡ existing `separationOfDutiesRequired`. **Discounts go the other way — this doc's mechanism wins (binding):** `discountSecondApprovalPercent`/`discountSecondApprovalAmount` (defaults 10% / $250) are the **single** discount second-approval mechanism; doc 03's review-level `secondApprovalForDiscounts` boolean is **dropped** in the consistency pass, and one recorded adjustment-level second approval (`secondApprovedBy*`) **satisfies the review-level `SECOND` approval kind for that adjustment** — no one is asked to approve the same discount twice.
- **Operational keys** live on the org `RevenueSettings` singleton ([13-database-model.md](./13-database-model.md) §4.14).

The adjustment-relevant keys and their **binding defaults**:

| Key | Home | Type | Default | Meaning |
|---|---|---|---|---|
| `discountSecondApprovalPercent` | `RevenueWorkflowPolicy` | Decimal(5,2) | `10.00` | Discounts/waivers above this % of the pre-tax review total require second approval |
| `discountSecondApprovalAmount` | `RevenueWorkflowPolicy` | Decimal(12,2) | `250.00` | …or above this absolute amount (whichever trips first) |
| `secondApprovalForRefunds` | `RevenueWorkflowPolicy` (existing doc 03 key) | Boolean | `true` | Every refund requires a second approver |
| `damageFeeWaiverSecondApproval` | `RevenueWorkflowPolicy` | Boolean | `true` | Waiving a damage-category fee always requires second approval |
| `creditIssueSecondApprovalAmount` | `RevenueWorkflowPolicy` | Decimal(12,2) | `500.00` | Credit issues above this amount require second approval |
| `separationOfDutiesRequired` | `RevenueWorkflowPolicy` (existing doc 03 key) | Boolean | `true` | Requester may not approve their own adjustment; approver ≠ second approver (spec Part B: "No one should approve their own high-risk manual adjustment…"); precedence with auto-approval in §3.1/§7.2 |
| `creditExpiryMonths` | `RevenueSettings` | Int | `12` | Default `expiresAt` horizon for new credits |
| `autoApplyCredits` | `RevenueSettings` | Boolean | `true` | Collection consumes open credits before charging the saved Payment Method |
| `refundToCreditAllowed` | `RevenueSettings` | Boolean | `true` | Refunds may be issued as bounded customer credit instead of a provider refund |
| `instructorClawbackPolicy` | `RevenueSettings` | Enum | `SERVICE_LINES_ONLY` | `NEVER` \| `SERVICE_LINES_ONLY` \| `ALWAYS_PRO_RATA` — when refunds/voids reverse Instructor Compensation |
| `promoCodesEnabled` | `RevenueSettings` | Boolean | `true` | Org-level kill switch; inert until codes exist, so the zero-setup default costs nothing |
| `refundWarnAfterDays` | `RevenueSettings` | Int | `90` | Warn (not block) on refunds of payments older than this — aligned to typical provider windows (open question 5) |
| `accountingClosedThrough` | `RevenueSettings` | DateTime? | `null` (no closed period) | The org's books are closed through this date. An adjustment `effectiveAt` on or before it rolls to the earliest open period (V13). Settable only by holders of `revenue.approve_finance` ([03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md)); every change is audited (`recordAudit`, old/new dates). Live from Part 2 — the period lock does not wait for `FinancialExportJob` (Part 3) |

Strong defaults, zero mandatory setup: an org that never opens these settings gets sane second-approval thresholds, bounded credits, and no behavioral surprises (product principle 10). Changing a policy affects **future** adjustments only — policy inputs that mattered are recorded in each adjustment's audit metadata.

---

## 5. Data model proposal

Prisma-flavored; all money `Decimal(12,2)` + ISO 4217 `currency` pending the binding call in [13-database-model.md](./13-database-model.md) (one exception: `correctedUnitPrice` is `(10,2)` because it must fit the `InvoiceLine.unitPrice` column it replaces — R11). All new enums land in their own migration before use; all models are additive; every org-owned model has a real `Organization` relation with explicit `onDelete`, `createdAt`, tenant-scoped uniques, and org-leading indexes (schema-governance test requirements). `RevenueReview` and `ResponsiblePayer` are owned by sibling docs; FKs here reference them.

### 5.1 `RevenueAdjustment` (new)

```prisma
enum AdjustmentKind {
  DISCOUNT
  FEE_WAIVER
  CREDIT_ISSUE
  LINE_VOID
  LINE_CORRECTION
  REFUND
  PROMO_CODE
  PAYER_TRANSFER
}

enum AdjustmentStatus {
  PENDING_APPROVAL
  APPROVED
  APPLIED
  REJECTED
  CANCELLED
}

model RevenueAdjustment {
  id              String           @id @default(cuid())
  organizationId  String
  number          String           // "ADJ-<seq>", per-org sequence (mechanism owned by 13-database-model.md)
  revenueReviewId String           // required — every adjustment relates to a Revenue Review (Part H)
  invoiceId       String?          // set once the review's invoice exists
  targetLineId    String?          // locked InvoiceLine being waived/voided/corrected
  kind            AdjustmentKind
  status          AdjustmentStatus @default(PENDING_APPROVAL)

  // Money facts (Part H: before/after amount). Signed delta; negative reduces charges.
  currency     String  @db.Char(3)         // ISO 4217; must equal the review currency (V1)
  beforeAmount Decimal @db.Decimal(12, 2)  // review (or target line) total before
  afterAmount  Decimal @db.Decimal(12, 2)  // total after
  amountDelta  Decimal @db.Decimal(12, 2)  // afterAmount - beforeAmount

  // Actor + reason (Part H). Bare user-id strings + denormalized labels, matching the
  // AuditLog convention — financial records must outlive user rows and fit apikey actors.
  reason                String
  requestedById         String
  requestedByLabel      String
  approvedById          String?
  approvedByLabel       String?
  approvedAt            DateTime?
  secondApprovedById    String?
  secondApprovedByLabel String?
  secondApprovedAt      DateTime?
  rejectedReason        String?

  effectiveAt DateTime?  // accounting effective date; defaults to appliedAt (V13)
  appliedAt   DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  // Kind-specific references
  promoCodeId String?
  fromPayerId String?   // PAYER_TRANSFER
  toPayerId   String?   // PAYER_TRANSFER

  // LINE_CORRECTION replacement values — the locked target line is never touched
  correctedQuantity    Decimal? @db.Decimal(8, 2)
  correctedUnitPrice   Decimal? @db.Decimal(10, 2) // matches InvoiceLine.unitPrice (10,2) — R11, 13-database-model.md
  correctedDescription String?

  supportingDocumentId String?   // Document FK (SetNull) — damage evidence, receipts

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  // revenueReview RevenueReview @relation(... onDelete: Restrict) — model owned by 03
  // targetLine InvoiceLine @relation("adjustmentTarget", ... onDelete: Restrict)
  refund       Refund?
  issuedCredit CustomerCredit?

  @@unique([organizationId, number])
  @@index([organizationId, status])     // approval queue
  @@index([organizationId, createdAt])  // reporting / exports
  @@index([revenueReviewId])
  @@index([promoCodeId])
}
```

Notes:

- `targetLineId` and `revenueReviewId` use `onDelete: Restrict` — applied adjustments are financial history and must never be cascaded away by an invoice or review deletion. The org-wipe order (§5.6) deletes adjustments first.
- "One `APPLIED` `LINE_VOID`/`LINE_CORRECTION` per target line" (V6) is enforced transactionally (status-machine guard inside the applying `$transaction`), because Prisma cannot express a partial unique index. 13-database-model.md may add a raw-SQL partial unique index (`WHERE status = 'APPLIED' AND kind IN (...)`) as belt-and-braces.
- No Json payload column: kind-specific data is explicit nullable columns (house style — money never hides in blobs).

### 5.2 `CustomerCredit` + `CreditApplication` (new)

```prisma
enum CreditStatus {
  OPEN
  PARTIALLY_APPLIED
  APPLIED
  EXPIRED
  CANCELLED
}

model CustomerCredit {
  id                    String       @id @default(cuid())
  organizationId        String
  studentId             String?      // exactly one holder set (V15):
  payerId               String?      // ResponsiblePayer (09-responsible-payers.md)
  originAdjustmentId    String       @unique  // bounded: every credit traces to an APPLIED CREDIT_ISSUE / refund adjustment
  amount                Decimal      @db.Decimal(12, 2)
  currency              String       @db.Char(3)
  targetRevenueReviewId String?      // set → applicable only to that review; unset → next invoice
  expiresAt             DateTime     // required; default now + RevenueSettings.creditExpiryMonths
  status                CreditStatus @default(OPEN)
  memo                  String?
  createdAt             DateTime     @default(now())
  updatedAt             DateTime     @updatedAt

  organization Organization        @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  applications CreditApplication[]

  @@index([organizationId, status])   // "open credits" collection lookup
  @@index([studentId])
  @@index([payerId])
}

model CreditApplication {
  id              String   @id @default(cuid())
  creditId        String   // tenant scope via parent credit (relation-scoped child, like InvoiceLine)
  revenueReviewId String
  invoiceId       String?
  paymentId       String?  // the ACCOUNT_CREDIT payment row this application settled (Part 2 wiring)
  amount          Decimal  @db.Decimal(12, 2)  // signed; negative rows reopen credit on refund of an ACCOUNT_CREDIT payment
  appliedById     String
  appliedByLabel  String
  createdAt       DateTime @default(now())

  credit CustomerCredit @relation(fields: [creditId], references: [id], onDelete: Restrict)

  @@unique([creditId, revenueReviewId])  // structurally prevents double-application to one review
  @@index([revenueReviewId])
}
```

Remaining value is always `amount − SUM(applications.amount)`, computed inside the applying transaction with the credit row locked — no stored mutable balance. `status` is a lifecycle marker (`PARTIALLY_APPLIED`/`APPLIED`/`EXPIRED`), updated in the same transaction as the application that caused it, and re-derivable from the applications at any time.

### 5.3 `PromoCode` + `PromoCodeRedemption` (new)

```prisma
enum PromoDiscountType {
  PERCENT
  FIXED_AMOUNT
}

model PromoCode {
  id                 String            @id @default(cuid())
  organizationId     String
  code               String            // stored uppercase; matched case-insensitively
  description        String?
  discountType       PromoDiscountType
  percentValue       Decimal?          @db.Decimal(5, 2)   // 0–100, required when PERCENT
  amountValue        Decimal?          @db.Decimal(12, 2)  // required when FIXED_AMOUNT
  currency           String            @db.Char(3)
  maxDiscountAmount  Decimal?          @db.Decimal(12, 2)  // cap for PERCENT codes
  appliesToCategories String[]         // Revenue Item category keys; empty = entire review
  maxRedemptions     Int?
  perPayerLimit      Int               @default(1)
  effectiveStart     DateTime
  effectiveEnd       DateTime?
  active             Boolean           @default(true)
  createdByLabel     String
  createdAt          DateTime          @default(now())
  updatedAt          DateTime          @updatedAt

  organization Organization          @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  redemptions  PromoCodeRedemption[]

  @@unique([organizationId, code])
  @@index([organizationId, active])
}

model PromoCodeRedemption {
  id              String   @id @default(cuid())
  promoCodeId     String
  revenueReviewId String
  adjustmentId    String   @unique  // 1:1 with the PROMO_CODE RevenueAdjustment
  amount          Decimal  @db.Decimal(12, 2)  // computed discount, snapshotted at redemption
  redeemedAt      DateTime @default(now())

  promoCode PromoCode @relation(fields: [promoCodeId], references: [id], onDelete: Restrict)

  @@unique([promoCodeId, revenueReviewId])
  @@index([promoCodeId])
}
```

### 5.4 `Refund` (new; provider mechanics Part 2)

```prisma
enum RefundStatus {
  PENDING
  PROCESSING
  SUCCEEDED
  FAILED
  CANCELLED
}

enum RefundDestination {
  ORIGINAL_METHOD  // provider refund (Stripe, test mode only this phase)
  CUSTOMER_CREDIT  // issues a bounded CustomerCredit instead
  MANUAL           // cash/check returned outside the provider; recorded here
}

model Refund {
  id               String            @id @default(cuid())
  organizationId   String
  adjustmentId     String            @unique  // one refund per adjustment — the structural replay guard
  paymentId        String            // the specific payment being reversed (Restrict; see note)
  amount           Decimal           @db.Decimal(12, 2)
  currency         String            @db.Char(3)
  destination      RefundDestination @default(ORIGINAL_METHOD)
  status           RefundStatus      @default(PENDING)
  providerRefundId String?           // opaque Stripe "re_..." reference — safe metadata only, never a secret
  failureReason    String?
  issuedCreditId   String?           // when destination = CUSTOMER_CREDIT
  createdAt        DateTime          @default(now())
  processedAt      DateTime?

  organization Organization      @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  adjustment   RevenueAdjustment @relation(fields: [adjustmentId], references: [id], onDelete: Restrict)

  @@index([organizationId, status])   // reconciliation queue
  @@index([paymentId])
}
```

Note: `Payment` currently `Cascade`-deletes with its `Invoice` — a financial-immutability defect flagged to [13-database-model.md](./13-database-model.md), which owns the fix (Cascade → Restrict). Per R17 there ([13-database-model.md](./13-database-model.md) §4.2.4): the spec's "PaymentTransaction" **is** the extended `Payment` — the extended `Payment` is the settled-money record, and `Refund.paymentId` binds to `Payment` with a `Restrict` FK, permanently. No separate settlement model ever supersedes `Payment`.

### 5.5 `InvoiceLine` (extend — reuses existing model; additive columns only)

```prisma
model InvoiceLine {
  // ...existing fields unchanged: id, invoiceId, kind, description, quantity, unitPrice...
  adjustmentId  String?  // set on adjustment-materialized lines; original lines stay null
  offsetsLineId String?  // self-reference: the locked line this line offsets (void/correction/waiver)
}
```

- Nullable, additive, no backfill needed — every existing line simply has `null` (meaning: an original, non-adjustment line). Existing invoices are never reinterpreted.
- Adjustment-materialized lines use `quantity = 1` and a **signed** `unitPrice` (negative for reductions); offset lines carry the *target line's* `kind` so net-revenue-by-kind reporting stays truthful; discounts/waivers/promos use the existing `DISCOUNT` kind. **No new `LineItemKind` values are required** (credits are not lines; refunds are not lines) — one less enum migration.
- Post-approval, original lines are frozen by the review lock ([03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md)); the engine permits appends only via an `APPLIED` adjustment. Enforcement is engine-level (single write path) — a DB trigger is deliberately out of scope for release 1.

### 5.6 Cross-cutting obligations

| Concern | Obligation |
|---|---|
| org-snapshot | Add `revenueAdjustments`, `customerCredits`, `creditApplications`, `promoCodes`, `promoCodeRedemptions`, `refunds` to `TableKey`, capture, restore insert order, and `wipeOrganizationData` — Restrict FKs mean these delete **before** invoices/reviews/payments in the canonical wipe order |
| Seed fixtures | Extend `prisma/seed.ts` in both tenant orgs: one applied discount adjustment, one open + one partially applied credit, one active promo code with a redemption, one refunded review (SUCCEEDED) and one FAILED refund — feeding the Part L validation matrix (fresh / seeded / multi-org / failed-payment / historical-rate) |
| Migrations | Two-step: enums + models + nullable `InvoiceLine` columns in the DDL migration; no data backfill required (all models greenfield); nothing dropped, nothing reinterpreted |
| status-colors | New `STATUS_TONE` entries for `AdjustmentStatus`, `CreditStatus`, `RefundStatus` (single-map rule; existing meanings untouched) |
| Import Center | Adjustment/credit/promo import is **out of scope** for release 1; the importer must not fabricate adjustment records for imported invoice deltas (recorded deferral) |

---

## 6. Validation & business rules

| # | Rule |
|---|---|
| V1 | Adjustment `currency` must equal the review currency. No cross-currency adjustments in release 1. |
| V2 | `reason` required and non-empty for every adjustment; `rejectedReason` required on rejection. Revenue Item flags escalate: damage-category targets require a note, and an attachment where the item is configured `requiresAttachment`. |
| V3 | All money math in Decimal — never float. Percent discounts round **half-up to the cent, computed once at the adjustment total** (not per line). Pro-rata reversals use the largest-remainder method so components sum exactly. |
| V4 | Charge-side reductions may not drive the review total below zero; the discount/waiver is capped at the eligible remaining charge. Credits apply up to the amount due; the surplus stays on the credit until expiry. |
| V5 | `afterAmount = beforeAmount + amountDelta`, enforced at write time. Payer transfers set `beforeAmount = afterAmount`. |
| V6 | At most one `APPLIED` `LINE_VOID` or `LINE_CORRECTION` per target line, enforced inside the applying transaction (guarded claim + target-line check); a voided line cannot be corrected and vice versa — correct the *replacement* line instead. |
| V7 | Every referenced entity (review, line, credit, promo, payer, payment, document) is loaded org-scoped from the session; a cross-tenant id is a 404 (indistinguishable from nonexistent). |
| V8 | Post-approval adjustments only against reviews in adjustable statuses (§3.3 matrix); illegal transitions return 400 with the reason and the correct next step. |
| V9 | Charge-side reductions on a Paid review are refused with: "This review is already paid — issue a refund or a customer credit instead." |
| V10 | No adjustment of any family while a Payment Attempt is in flight (Payment Processing / ACH Pending); the guarded transaction re-checks the status at claim time, so a race with an initiating charge loses cleanly (409). |
| V11 | No single-step payer transfer after payment capture — refund + re-collect, two adjustments. |
| V12 | Refund amount ≤ captured amount − prior succeeded/in-flight refunds for that payment, computed inside the transaction. `Refund.adjustmentId @unique` makes double-refund structurally impossible on retry. |
| V13 | `effectiveAt` defaults to `appliedAt`; it may not fall inside a **closed accounting period**. Two closure sources feed one check: **(a)** the org-level `accountingClosedThrough` date (§4) — settable only by `revenue.approve_finance` holders, every change audited — enforced from the moment this engine ships in Part 2, independent of export delivery; **(b)** once Financial Exports exist (Part 3), any period already delivered by a `FinancialExportJob`. An `effectiveAt` on or before the closed boundary rolls to the earliest open period; the roll is recorded in the adjustment's audit metadata (requested vs. effective date), and exports pick the adjustment up as a new record (delivered exports are never mutated). |
| V14 | Credit expiry: applications are refused against `EXPIRED`/`CANCELLED` credits; expiry sweeps are status transitions with audit rows, never deletions. |
| V15 | `CustomerCredit` has exactly one holder (`studentId` XOR `payerId`), validated at write time. |
| V16 | Applying any adjustment is a single `db.$transaction` (guarded status claim + all financial effect rows). No Stripe or other external calls inside any transaction — provider execution is post-commit (Part 2), per ADR-011's pattern. |
| V17 | No AI pathway may create, approve, or apply an adjustment or refund. Human actors through permissioned APIs only (constitution rule 8). Read-only impersonation blocks every mutating adjustment route (`{ mutating: true }`). |

---

## 7. RBAC, approvals & audit

### 7.1 Permission keys (new — added to `PERMISSIONS` in `src/lib/permissions.ts`)

The `billing.` prefix is deliberate: `MODULE_BY_PREFIX` already gates `billing.*` behind the org's billing module, so plan/profile gating applies with zero extra wiring.

| Key | Grants | Default roles (system bundles) |
|---|---|---|
| `billing.adjust` | Create/request adjustments: discount, waiver, credit issue, void, correction, promo redemption, payer transfer | ACCOUNT_OWNER, SCHOOL_ADMIN, ACCOUNTANT |
| `billing.adjust_approve` | Approve/reject/apply adjustments; act as second approver | ACCOUNT_OWNER, SCHOOL_ADMIN, ACCOUNTANT |
| `billing.refund` | Request refunds | ACCOUNT_OWNER, SCHOOL_ADMIN, ACCOUNTANT |
| `billing.refund_approve` | Approve refunds | ACCOUNT_OWNER, SCHOOL_ADMIN, ACCOUNTANT |
| `billing.promo_manage` | Create/edit/deactivate promo codes | ACCOUNT_OWNER, SCHOOL_ADMIN |

DISPATCHER and INSTRUCTOR get **none** of these by default — matching the spec's "Operations Director or higher." Orgs express "Operations Director," "Chief Flight Instructor," etc. through OrgRole bundles; an "Operations Director" role template carrying `billing.adjust` + `billing.adjust_approve` + `billing.refund` ships in Part 2 (`ROLE_TEMPLATES` in `src/lib/role-templates.ts`). Routes check permission keys, never role names.

### 7.2 Approval mechanics

- Policy evaluation (thresholds, always-second-approval kinds, separation of duties) happens in the adjustments engine (`src/lib` — pure, contract-tested, returning *reasons*: which policy fired, which threshold, who is eligible to approve — the explainable-engine pattern).
- Separation of duties is enforced in the engine, not the UI: with `separationOfDutiesRequired` on (doc 03's key name — §4), `approvedById ≠ requestedById` for every policy-triggered approval, and `secondApprovedById ∉ {requestedById, approvedById}` for all second approvals. Precedence with auto-approval (§3.1, binding): the flag does not make create → `APPROVED` unreachable — below-threshold, non-high-risk, non-always-second-approval adjustments still auto-approve on creation, with `autoApproved: true` recorded in audit metadata.
- Second approval is data on the adjustment (`secondApprovedBy*`), triggered by the §4 policy keys — discounts/waivers over threshold, all refunds, damage-fee waivers, large credit issues.
- Approval hooks integrate with the Revenue Review approval chain in [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md): a review cannot be approved while attached adjustments are `PENDING_APPROVAL`; approving a review with an over-threshold staged discount escalates per that doc's chain configuration. For discounts, the §4 thresholds are the single mechanism (the review-level `secondApprovalForDiscounts` boolean is dropped — §4), and a recorded adjustment-level second approval satisfies the review-level `SECOND` kind for that adjustment.

### 7.3 Audit actions (every state change; `recordAudit`, dot-namespaced)

| Action | `oldValue` / `newValue` payload |
|---|---|
| `billing.adjustment_created` | kind, before/after amounts, reason, review id, auto-approval evaluation |
| `billing.adjustment_approved` / `billing.adjustment_second_approved` | status change, policy trigger that required it |
| `billing.adjustment_rejected` / `billing.adjustment_cancelled` | status change, rejectedReason |
| `billing.adjustment_applied` | appended line ids / pointer changes, before/after totals |
| `billing.refund_requested` / `billing.refund_approved` | payment id, amount, destination |
| `billing.refund_processed` / `billing.refund_failed` (Part 2 emit sites) | provider reference, reversal row ids |
| `billing.credit_issued` / `billing.credit_applied` / `billing.credit_expired` | credit id, amounts, remaining value |
| `billing.promo_created` / `billing.promo_redeemed` | code terms snapshot, redemption amount |
| `billing.payer_transferred` | fromPayerId → toPayerId |

Impersonation attribution is centralized in `recordAudit` (ADR-023) — adjustment routes just pass `actorUserId: session.userId`. Audit metadata carries ids, labels, and amounts only — never provider secrets or payment credentials.

### 7.4 Domain events

Registered in `WEBHOOK_EVENTS` **only when their emit sites land** (constitution: every registered event has a live emitter — Part 2): `invoice.adjusted`, `payment.refunded`, `credit.issued`. The in-process bus is fan-out only; refund execution correctness never depends on bus delivery (DB state machine + inbound-event idempotency table are authoritative).

---

## 8. UX notes (aviation-native, operational workflow first)

- **Adjustments live on the Revenue Review detail**, not a separate accounting screen. A dispatcher closing out a return never sees adjustment machinery; it appears for holders of `billing.adjust` on the review they are looking at.
- **Plain operational language, explicit consequences.** "Waive landing fee — KAVL $15.00 → $0.00" with a required reason field, not "create contra-entry." The refund confirmation states every consequence before commit: "Refund $86.00 to Visa •••• 4242. Reverses $12.90 of instructor compensation for A. Rivera. Requires approval from a second reviewer." Financial consequence is never a surprise (product principle 2).
- **Approval queue** for `PENDING_APPROVAL` adjustments (badge count for approvers), served by the `[organizationId, status]` index; each entry shows requester, reason, before → after, and *why* it needs approval ("Discount 14% exceeds the 10% threshold").
- **The locked review renders original lines untouched**, with adjustment lines visually grouped beneath their adjustment (actor, date, reason on hover/tap) — the paper trail reads like a maintenance log entry: who, when, why, signed.
- **Credits are shown as "Credit available — applies to your next invoice"** with amount and expiry on the student/payer surface. Never "account balance," never a spendable wallet (product principle 4).
- Status chips come exclusively from `STATUS_TONE` (new entries; single-map rule). Light + dark parity, mobile parity, and loading/empty/error states are part of the feature; empty approval queue says so plainly ("No adjustments awaiting approval").
- Errors are actionable and name the next step (V9's refund/credit guidance is the reference).
- Read-only impersonation hides every adjustment mutation control, mirroring the existing payment-form gating.

---

## 9. Interactions with other Revenue Engine components

| Sibling doc | Contract |
|---|---|
| [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) | Owns Revenue Review statuses, the approval-policy engine, snapshot locking, and `RevenueWorkflowPolicy` — the §4 approval keys ride there (R15; the §4 operational keys live on `RevenueSettings`, [13-database-model.md](./13-database-model.md) §4.14). This doc supplies: adjustments block review approval while pending; review approval applies attached adjustments in the lock transaction; post-payment statuses (Partially Refunded / Refunded) are driven by refund settlement. |
| [04-aircraft-pricing-profiles.md](./05-aircraft-pricing-profiles.md) | Adjustments never mutate rate snapshots. A wrong rate on an approved review is fixed by `LINE_CORRECTION`, leaving the resolved-rate audit trail intact. |
| [05-instructor-rates-and-compensation.md](./04-instructor-time-and-rates.md) | Clawback contract (§3.7): negative InstructorEarning rows per `instructorClawbackPolicy`; voiding/correcting an instruction line adjusts compensation through the same reversal shape, never by editing earning rows. |
| [06-revenue-items.md](./06-revenue-items.md) | Revenue Item flags (`requiresNote`, `requiresAttachment`, `requiresSecondApproval`) bind to waivers and voids of lines sourced from that item; damage-category items trigger enhanced approval on the waiver as well as the charge. |
| [07-tax-model.md](./07-tax-model.md) | Charge-side adjustments request tax deltas computed under the **original review's snapshotted tax rule version**; credits are post-tax and never touch the tax base. |
| [09-responsible-payers.md](./11-responsible-payers.md) | Payer-transfer validation (approved active link), payer-held credits, and payer visibility of adjustment history on authorized invoices. |
| [02-architecture.md](./01-revenue-engine-architecture.md) | Revenue Allocation reversal rows, `LedgerEntry` reversal rows, platform-fee reversal policy (open question 1), and the operational-vs-financial closeout boundary that makes post-approval adjustment possible at all. |
| [09-payment-timing-and-collection.md](./09-payment-timing-and-collection.md) | `ScheduledCharge` anchors, the Amount Due derivation (§2.8 — includes this doc's signed adjustment lines and tax snapshots), and the runner/retry machinery the supplementary delta charge (§3.3) flows through. |
| Payments design (Part 2) | Provider refund execution (Stripe test mode), refund webhooks through the inbound-event idempotency table, `ACCOUNT_CREDIT` settlement wiring, Dispute handling (a Dispute may *suggest* a refund adjustment; it never auto-creates an applied one). |
| [13-database-model.md](./13-database-model.md) | Binding money/currency types; per-org sequence mechanism for `RevenueAdjustment.number`; the `Payment` cascade-delete fix and the R17 ruling (extended `Payment` is the settled-money record); the R15 policy-key split (`RevenueWorkflowPolicy` / `RevenueSettings` §4.14); the supplementary `ScheduledCharge` shape for upward-delta collection (§3.3); optional partial unique index for V6. |
| Financial Export design | Adjustments/refunds carry `effectiveAt` for period placement; anything applied after a period is exported appears as a new record in the next export (V13). Period closure is not export-dependent: the org `accountingClosedThrough` date (§4) enforces V13 from Part 2 onward, before `FinancialExportJob` exists; export delivery (Part 3) becomes a second closure source under the same check — a backdated adjustment can never silently restate a month the accountant has closed. |

---

## 10. Out of scope for Part 1 / deferred to Parts 2–3

| Item | Status | Notes |
|---|---|---|
| Invoice merging | **Deferred — not in release 1** (spec Part H) | The upward-correction path (§3.3) removes the main driver; revisit only with real demand. |
| Unrestricted wallet balances | **Rejected by design** | Bounded credits (§3.5) are the permanent answer; `Student.accountBalance` is demoted/transitioned per [13-database-model.md](./13-database-model.md), not extended. |
| Prepaid packages / block-time | **Deferred** | `CustomerCredit.originAdjustmentId` generalizes to a package origin later without schema rework; no package models now. |
| Payer split (multi-payer responsibility) | **Deferred** (spec: future phase) | `PAYER_TRANSFER` moves whole responsibility only. |
| Write-off | **Deferred** | Spec Part B lists "Written Off only if supported later"; when built, it will be an adjustment kind following this doc's shape. |
| Provider refund execution, refund webhooks, dispute-driven flows | **Part 2** | Design contracts fixed here (§3.7); Stripe test mode only; no live charges; nothing deployed. |
| DB-level append-only trigger on locked invoice lines | **Deferred** | Engine-level single-write-path enforcement in release 1. |
| Adjustment/credit/promo import via Import Center | **Deferred** | Importer never fabricates adjustment records. |
| Email receipts for adjustments/refunds | **Blocked/deferred** | No email adapter exists; in-app Notification rows only (additive `NotificationKind` values), no production email regardless. |

---

## 11. Open questions

1. **Platform-fee reversal on refunds** — does AeroOps return its platform fee pro-rata when a school refunds a customer? Pricing/positioning decision (CEO gate); the reversal row structure supports either answer, but the default must be chosen before Part 2 builds refund execution.
2. **Instructor clawback default** — is `SERVICE_LINES_ONLY` (reverse compensation only when the refunded/voided line is the instruction line that earned it) the right default for flight schools, or should goodwill refunds also claw back pro-rata? Needs Director of Operations / school-owner input.
3. **Promo codes in release 1 or fast-follow** — the model is small, but if release scope tightens, promo codes are the safest cut (discount adjustments cover the manual path). Product owner call, plus: allow stacking (default here: one code per review)?
4. **Credit expiry and unclaimed-property law** — 12-month default expiry is proposed, but expired-credit treatment varies by state (escheatment). Do we ship a tax-style disclaimer ("organizations remain responsible for legal treatment of expired credits") and make expiry org-configurable down to "never"?
5. **Refund window** — warn at 90 days is proposed; should orgs be able to hard-block provider refunds beyond a configured age (Stripe re-presentment limits), with `CUSTOMER_CREDIT` as the fallback destination?
6. **Trigger for supplementary delta charges** (D21 in [16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md)) — the collection *mechanism* is settled (§3.3: one supplementary `ScheduledCharge` per `APPLIED` upward adjustment); the remaining call is whether it auto-initiates under the review's snapshotted payment timing policy or always requires a human to trigger collection. (Default proposed: auto-initiate, since approval of the adjustment *is* the explicit human consent stating amount and consequence — but this needs product-owner confirmation against principle 2.)
