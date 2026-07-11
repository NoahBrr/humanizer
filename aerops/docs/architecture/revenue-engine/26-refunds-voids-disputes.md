# Refunds, Voids, and Disputes

> **Status:** Proposed — Phase 8 Part 2 · **Date:** 2026-07-10 · **Lead roles:** Financial Systems Architect; Principal Payments Architect at Stripe; Aviation Accounting Specialist · **Part of:** Revenue Engine design set ([README](./README.md))

---

## 1. Purpose & scope

This document is Part 2 deliverable 11: the complete workflow design for spec **Part V — Refunds, Voids, and Disputes**. It finalizes, for the Part 3 implementers:

- **Void** — when a Revenue Review/Invoice may be cancelled outright, by whom, and what happens to the approved snapshot, the ScheduledCharge, and the financial records already written at approval.
- **Refund** (full and partial) — the request → approve → apply → execute → settle pipeline against one specific settled `Payment`, including multi-refund bounds, partial-refund allocation math, tax reversal, Instructor Compensation impact, platform-fee treatment, ACH timing rules, and the dispute interaction.
- **Disputes** — the webhook-driven chargeback lifecycle: the `Dispute` record, funds impact under the doc 18 Connect model, the pilot-appropriate evidence workflow, and the financial consequences of a lost dispute.

The one invariant everything below serves: **money history is never mutated.** The original `Payment` row is never edited, the approved snapshot is never edited, and every reversal is a new signed record — `Refund` rows, reversal `TaxSnapshot` rows, signed `RevenueAllocation` reversal sets, reversing `LedgerEntry` journals, negative `InstructorEarning` rows, and cumulative signed `PlatformFee.reversedAmount`. "Silent financial mutation" and "refund without audit" are automatic rejection conditions (spec Part AB); this design makes both structurally impossible.

**Not in scope here:** the webhook route/parsing/tenancy pipeline itself (deliverable 8, doc 23 — this doc consumes its reduce hook), the idempotency key catalog (owned by [24-idempotency.md](./24-idempotency.md) — this doc uses K2 `rf_<refundId>` exactly as bound there), platform-fee commercial terms (deliverable 12, doc 27), the allocation/ledger writer internals (deliverable 13, doc 28), notification kinds and delivery (deliverable 16, doc 31), and final schema shapes for the NEW columns/models proposed in §5 (final call: `34-part2-database-additions.md`).

---

## 2. Relationship to Part 1 docs

Part 1 already designed most of this territory at the contract level. This document **finalizes provider mechanics and closes the open seams** — it does not reopen any Part 1 decision.

| Part 1 doc | What it bound | What this doc adds |
|---|---|---|
| [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) §2.2–2.3, §6.4–6.5 | The 16-status machine; `PARTIALLY_REFUNDED`/`REFUNDED`/`DISPUTED` transitions and their `Invoice.status` projections; the void matrix (pre-approval, post-approval-uncharged, never in-flight, never after collection); `VOIDED` terminal + regeneration | The exact transaction contents of each void variant (§3.1); which webhook reduce transaction writes each refund/dispute status transition (§3.2, §3.3) |
| [08-adjustments-discounts-credits.md](./08-adjustments-discounts-credits.md) §3.7 | The refund contract: REFUND `RevenueAdjustment` → `Refund` row 1:1 (`adjustmentId @unique` replay guard), destinations, in-tx amount cap (V12), always-second-approval default, reversal contract on `SUCCEEDED`, `FAILED` keeps its record | Provider execution (Stripe test mode), the settlement transaction, the FAILED-retry protocol (§3.2.6), the dispute-block rule, the ACH rules |
| [07-tax-model.md](./07-tax-model.md) §2.6, §5 rule 8 | The binding invariant: no refund on a taxed review without its reversal `TaxSnapshot` rows **in the same `$transaction`** | Which transaction that is (the settlement/reduce tx that marks the Refund `SUCCEEDED` — §3.2.5), and the proportional tax-reversal math (§3.2.4) |
| [12-revenue-allocation-and-reporting.md](./12-revenue-allocation-and-reporting.md) §2.2–2.5 | `REFUND`/`VOID` allocation-set math (line-targeted mirror vs proportional largest-remainder), the refund posting-matrix row, `PlatformFee` reversal semantics, `InstructorEarning` reversal-on-refund policy | Ratifies the hybrid allocation math as final (§3.2.4), extends the posting matrix with the three dispute journals (§3.3.4 — **no new `LedgerAccount` values**), fixes the compensation-decision storage (§5) |
| [13-database-model.md](./13-database-model.md) §4.10 | Canonical `Refund` and `Dispute` shapes, `RefundDestination`/`RefundStatus`/`DisputeStatus` enums, FK actions, indexes | Additive columns on `Dispute` and `Refund` plus one small new model (`DisputeEvidence`) — proposed in §5, arbitrated by `34-part2-database-additions.md` |
| [09-payment-timing-and-collection.md](./09-payment-timing-and-collection.md) | Payment truth = webhooks; reconcile-then-proceed for stuck states; late ACH returns arrive dispute-shaped; settled `Payment` rows never edited | The concrete ACH-return-as-dispute handling (§3.3.6) and refund staleness sweeps (§8) |
| [16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md) D3, D4; risk R6 | Single `revenue.*` permission prefix (D3); 90-day refund warning + hard-block provider refunds past the provider window with `CUSTOMER_CREDIT` fallback (D4); ACH return-timing risk posture | Applied throughout; the provider refund window is an adapter catalog constant, not org config (§4) |

Part 2 siblings referenced: **doc 18** (Stripe Connect architecture decision — merchant of record, refund/dispute ownership, application-fee mechanics under D1 direct charges), **doc 22** ([22-approval-to-payment.md](./22-approval-to-payment.md) — the settlement transaction this doc's reversal writes mirror), **doc 23** (webhook pipeline: signature → unique-insert → tenancy from local references → guarded reduce), **doc 24** ([24-idempotency.md](./24-idempotency.md) — key K2, unknown-outcome protocol §6, link L8/L12), **doc 25** (failure workflow — refund failure notifications reuse its escalation surfaces), **doc 27** (platform fee), **doc 28** (allocation/ledger writer), **doc 31** (notifications), **doc 33** (test plan), **doc 34** (`34-part2-database-additions.md`, final schema call).

---

## 3. How it works

### 3.1 Void

A void says *"this Revenue Review should not be collected — at all."* It is legal only **before payment initiation**: no `PaymentAttempt` has succeeded or is in flight, and Σ settled `Payment` rows against the Invoice = 0 (including offline cash/check and `ACCOUNT_CREDIT` payments). Anything already collected exits **only** through the refund flow. This is doc 03 §6.4 verbatim; the table below adds the Part 2 payment-engine and reversal-record obligations.

| Phase | Allowed? | Single `db.$transaction` contents | Post-commit |
|---|---|---|---|
| **Pre-approval** (`DRAFT`, `AWAITING_INSTRUCTOR_REVIEW`, `AWAITING_OPERATIONS_REVIEW`, `CHANGES_REQUESTED`) | Yes — `revenue.void` + required reason | Guarded `updateMany` claim review → `VOIDED` (expected-status check, `count === 0` → 409); Invoice → `VOID`; `voidedAt/ById/Reason` stamped. **No financial records exist yet** (nothing was snapshotted), so nothing to reverse. No `ScheduledCharge` exists — none is ever created (spec Part V: "no payment request created"). | `recordAudit('revenue_review.voided')` with reason; `emitDomainEvent('revenue_review.voided')` |
| **Post-approval, uncharged** (`APPROVED`, `PAYMENT_SCHEDULED`, `PAYMENT_FAILED` — nothing collected) | Yes — `revenue.void` + required reason | (1) Guarded claim review → `VOIDED` **and** in-tx verification: no `PaymentAttempt` in `CREATED`/`PROCESSING`/`SUCCEEDED`, Σ settled `Payment` = 0 (either failing → 409 with the current state named). (2) Guarded claim on the review's `ScheduledCharge` (`SCHEDULED`/`AWAITING_MANUAL`/`FAILED` → `CANCELLED`) — plus every supplementary adjustment `ScheduledCharge` in a claimable state (doc 08 §3.3). (3) `VOID` allocation set: full negative reversal of the review's net allocation across both dimensions (doc 12 §2.2). (4) Reversing `LedgerEntry` journal (doc 12 posting matrix: debit `REVENUE_*`/`TAX_PAYABLE`, credit `ACCOUNTS_RECEIVABLE`; discount contra reversed if present). (5) Reversal `TaxSnapshot` rows referencing the approval snapshot (doc 07 invariant — Tax Collected must net to zero for a voided review). (6) `InstructorEarning` reversal rows — **voids always auto-reverse**, regardless of `compensationRefundPolicy` (doc 12 §2.4: the review should never have existed). (7) `PlatformFee` → `VOIDED` (guarded claim; AeroOps earns nothing on uncollected revenue). (8) Invoice → `VOID`. | Same audit/event; org notification per doc 31 |
| **Payment in flight** (`PAYMENT_PROCESSING`, `ACH_PENDING`) | **No** | — | Refuse: "Payment in progress — wait for the result, then refund or void." Voiding mid-flight would desync provider truth. |
| **Collected** (`CARD_PAID`, `PAID`, `PARTIALLY_REFUNDED`) | **No** | — | Refuse with guidance: a full refund → `REFUNDED` is the "void" of a paid review (§3.2). |

**The approved snapshot survives the void.** `approvalSnapshot`, the frozen Invoice totals, the locked lines, the approval rows, and the TaxSnapshot all remain readable forever — the void adds reversal records *around* them and stamps `voidedAt/ById/Reason`. Audit explicitly records that an approved snapshot was voided. `VOIDED` is terminal; billing the flight again means **regenerating** a new review at current rates (doc 03 §6.5 — the R4 partial unique permits it).

**No provider interaction, ever.** A void never calls Stripe: by definition nothing was initiated (no `PaymentAttempt` exists in a live state), so there is no PaymentIntent to cancel in the happy path. If a `ScheduledCharge` claim races the payment runner, exactly one wins (the runner's guarded `PROCESSING` claim vs the void's `CANCELLED` claim — doc 24 M2); the loser returns 409 and the operator sees the surviving state.

### 3.2 Refunds

#### 3.2.1 Required inputs (spec Part V checklist → where each lives)

| Spec requirement | Where it is recorded |
|---|---|
| Original payment | `Refund.paymentId` (Restrict FK to the settled `Payment`; never edited) |
| Amount | `Refund.amount` + `RevenueAdjustment.amountDelta` (signed), `beforeAmount`/`afterAmount` |
| Reason | `RevenueAdjustment.reason` (required, non-empty) |
| Actor | `RevenueAdjustment.requestedById/Label` |
| Permission | `revenue.refund` to request; `revenue.refund_approve` to approve (§7) |
| Approval if threshold requires | `secondApprovalForRefunds` default **true** → every refund records `approvedBy*` + `secondApprovedBy*` (§7) |
| Stripe refund ID | `Refund.providerRefundId` (opaque `re_...`, safe metadata only) |
| Allocation reversal entries | Signed `REFUND` `RevenueAllocation` set, `sourceType: "Refund"`, `sourceId: refund.id` (§3.2.4) |
| Tax adjustment | Reversal `TaxSnapshot` rows in the settlement tx (§3.2.5) |
| Instructor-compensation impact policy | `compensationRefundPolicy` + `instructorClawbackPolicy` applied in the settlement tx; decision stored on `Refund.compensationImpact*` (§3.2.7, §5) |
| Platform-fee treatment | `PlatformFeePolicy.refundReversesFee` (snapshotted policy version) → `PlatformFee.reversedAmount` (§3.2.8) |
| Timestamp | `Refund.processedAt` (settlement), `createdAt`, adjustment `appliedAt`; allocation/ledger rows carry `effectiveAt` |

#### 3.2.2 State machines

`Refund.status` (enum bound in doc 13; writers below are exclusive):

| From | To | Written by | Trigger |
|---|---|---|---|
| — | `PENDING` | Adjustment engine (apply tx) | Guarded `APPROVED → APPLIED` claim on the REFUND adjustment creates the row (`adjustmentId @unique`) |
| `PENDING` | `PROCESSING` | Refund runner (guarded claim, post-commit) | `ORIGINAL_METHOD` only: claim taken immediately before the provider call |
| `PENDING` | `SUCCEEDED` | Adjustment engine (apply tx, same tx as row creation) | `CUSTOMER_CREDIT` / `MANUAL` destinations — no provider call; settle synchronously with the full reversal contract |
| `PROCESSING` | `SUCCEEDED` | Webhook reducer (doc 23) | Terminal provider refund event; the settlement tx (§3.2.5) |
| `PROCESSING` | `FAILED` | Webhook reducer, or the runner on an authoritative synchronous provider refusal | `failureReason` stored (safe code/message only) |
| `FAILED` | `PROCESSING` | Refund runner (guarded claim) | Authorized retry after reconcile — §3.2.6 |
| `PENDING`/`FAILED` | `CANCELLED` | Staff (`revenue.refund_approve`) | Abandoning a never-executed or failed refund; frees the remainder (§3.2.3); reason required |

Review-status coupling (doc 03 §2.3, written **only** in the settlement tx): cumulative succeeded refunds < collected total → `PARTIALLY_REFUNDED`; = collected total → `REFUNDED` (terminal). `Invoice.status` projection rides the same transaction.

#### 3.2.3 Multi-refund bounds — the remainder formula

Computed **inside** the apply transaction with the `Payment` row read under lock (interactive tx; the aggregate re-checked after the row read — doc 08 V12):

```
refundableRemainder(payment) =
    payment.amount
  − Σ Refund.amount   WHERE paymentId = payment.id AND status ∈ {PENDING, PROCESSING, SUCCEEDED}
  − Σ Dispute.amount  WHERE paymentId = payment.id AND status = LOST
```

- Request amount must be `> 0` and `≤ refundableRemainder`, in the payment's currency (must equal review currency — engine-enforced). Over-cap → 422 carrying the computed remainder.
- In-flight refunds (`PENDING`/`PROCESSING`) consume remainder; `FAILED`/`CANCELLED` do not.
- **Any dispute in `OPEN` or `UNDER_REVIEW` on the payment blocks new refunds entirely** (§3.2.9).
- Cumulative bound: because every refund row passes this check in a transaction that observes all prior rows, `Σ succeeded refunds ≤ captured amount` holds structurally — there is no code path that can over-refund.

#### 3.2.4 Partial-refund allocation math — decided

**Decision: hybrid — line-targeted when the operator selects charges, proportional largest-remainder otherwise.** This ratifies doc 12 §2.2 / doc 08 §3.7 as final; neither pure mode survives contact with real flight-school refunds:

- *Line-targeted* (`targetLineId`s carried on the REFUND adjustment): the reversal set mirrors **exactly** the selected lines' `REVENUE` categories and their snapshotted tax (via `TaxSnapshotItem.invoiceLineId`), scaled when a line is partially refunded. Used when the cause is known — "we billed 0.3 Hobbs too much," "the landing fee was wrong." Keeps category reporting truthful: an aircraft-billing error reverses aircraft revenue, not a smear across every category.
- *Proportional* (amount only, no target lines): the refund reverses pro-rata across the review's **net** `REVENUE` categories using the **largest-remainder method**, half-up division, so the parts sum exactly to the refunded amount. Used for goodwill/blanket refunds where forcing a line pick would be operator fiction.

Justification: a Director of Operations refunding a mis-billed Hobbs delta thinks in lines; an owner smoothing over a bad experience thinks in dollars. One mode alone either corrupts category reporting (pure proportional) or forces fake line attribution (pure targeted). **Simpler-workflow choice:** the UI leads with "Full refund" and "Specific charges"; free-amount goodwill is the third tab — the accurate path is the easy path.

**Worked example** (proportional). Collected review: aircraft 600.00 + instruction 300.00 + landing fee 50.00 + tax 50.00 = **1,000.00**; platform fee 3% of pre-tax base 950.00 = 28.50. Goodwill refund of **200.00**:

| Dimension | Category | Amount |
|---|---|---|
| REVENUE | `TAX` | −10.00 (= 200 × 50/1000) |
| REVENUE | `AIRCRAFT_REVENUE` | −120.00 (= 190 × 600/950) |
| REVENUE | `INSTRUCTOR_SERVICE_REVENUE` | −60.00 |
| REVENUE | `AIRPORT_LANDING_FEES` | −10.00 |
| PROCEEDS | `TAX` | −10.00 |
| PROCEEDS | `PLATFORM_FEE` | −5.70 (= 28.50 × 200/1000, §3.2.8) |
| PROCEEDS | `SCHOOL_RETAINED_REVENUE` | −184.30 (remainder — absorbs all rounding residue) |

Both dimensions sum to −200.00. The matching reversing journal (doc 12 posting matrix): debit `REVENUE_AIRCRAFT` 120.00, `REVENUE_INSTRUCTION` 60.00, `REVENUE_AIRPORT_FEES` 10.00, `TAX_PAYABLE` 10.00, `PLATFORM_FEE_PAYABLE` 5.70; credit `PAYMENT_CLEARING` 200.00, `PLATFORM_FEE_EXPENSE` 5.70 (Σ = 205.70 each side).

#### 3.2.5 Sequence — refund to `ORIGINAL_METHOD` (⚡ = async hop; each numbered step with a Tx label is one `db.$transaction`)

1. **[Tx R1 — request]** `revenue.refund` holder submits: payment, amount (or line picks), destination, reason. Engine validates review state (collected), remainder preview, dispute block, provider window (step 3's checks previewed for early feedback). Creates `RevenueAdjustment` kind `REFUND`, `PENDING_APPROVAL` (`ADJ-<seq>` via OrgSequence). Post-commit: `recordAudit('revenue.refund_requested')`, approver notification.
2. **[Tx R2 — approve]** `revenue.refund_approve` holder(s) approve: guarded `PENDING_APPROVAL → APPROVED` claim; `approvedBy*` + `secondApprovedBy*` recorded (always-second-approval default; separation of duties §7). Post-commit: audit.
3. **[Tx R3 — apply]** Guarded `APPROVED → APPLIED` claim. In the same tx: `Payment` row read + remainder check (§3.2.3); dispute block re-checked; **provider-window check** — `ORIGINAL_METHOD` past the provider refund window (adapter catalog constant per method type, D4) → refuse with `CUSTOMER_CREDIT`/`MANUAL` offered; `refundWarnAfterDays` (90) breach requires the operator to have confirmed the warning. Creates `Refund` `PENDING` under `adjustmentId @unique` (replay guard — doc 24 L8). **No provider call inside the transaction.**
4. ⚡ **[Refund runner, post-commit]** Guarded `PENDING → PROCESSING` claim, then the provider adapter call: `createRefund({ paymentIntentId, amount, refundApplicationFee, metadata: { aerops_refund, aerops_adjustment, aerops_org } })` with idempotency key **`rf_<refundId>`** (doc 24 K2), the connected-account context per doc 18, and a timeout. Authoritative synchronous refusal → `PROCESSING → FAILED` + safe `failureReason`. Acceptance → store `providerRefundId`; stay `PROCESSING`. Timeout/unknown → stay `PROCESSING`, doc 24 §6 unknown-outcome protocol; **never synthesize an outcome**.
5. ⚡ **[Webhook — settlement]** Terminal provider refund event arrives (doc 23: verify → unique-insert `PaymentProviderEvent` → tenancy from the local `Refund`/`PaymentAttempt` references, connected account must-match). **[Tx R4 — settle]** guarded `PROCESSING → SUCCEEDED` claim + the full reversal contract, all in this one transaction:
   - reversal `TaxSnapshot` rows referencing the originals (doc 07 invariant — same `$transaction`, no exceptions);
   - signed `REFUND` `RevenueAllocation` set (§3.2.4), `effectiveAt` = settlement time;
   - reversing `LedgerEntry` journal (sole writer `src/lib/ledger.ts`, doc 28);
   - `PlatformFee.reversedAmount` update + `EARNED → PARTIALLY_REVERSED | REVERSED` guarded claim (§3.2.8);
   - Instructor Compensation impact per policy (§3.2.7);
   - review → `PARTIALLY_REFUNDED`/`REFUNDED` + `Invoice.status` projection;
   - `Refund.processedAt`.
   Post-commit only: `recordAudit('revenue.refund_processed')` (provider reference + reversal row ids), `emitDomainEvent('payment.refunded')`, payer + org notifications (doc 31). A replayed event → `processedAt` already set on the stored event → 200 no-op (doc 23).
6. ⚡ **[Webhook — failure]** Provider refund failure event → guarded `PROCESSING → FAILED` + safe `failureReason`; no reversal records are written (no money moved back). Post-commit: `recordAudit('revenue.refund_failed')`, org notification with next-step guidance (§8).

`CUSTOMER_CREDIT` and `MANUAL` destinations collapse steps 4–5 into Tx R3: the `Refund` settles `SUCCEEDED` synchronously with the full reversal contract in the apply transaction (no provider call). `CUSTOMER_CREDIT` additionally creates the bounded `CustomerCredit` (origin = this adjustment; expiry per `creditExpiryMonths`); refused when `refundToCreditAllowed` is off. Refunding an `ACCOUNT_CREDIT`-method payment reopens the consumed credit via a negative `CreditApplication` (doc 08 §3.7), bounded by the original credit's expiry — also no provider call.

#### 3.2.6 Retrying a FAILED provider refund

Doc 08 binds "retry is a new provider attempt against the same `Refund`, never a duplicate row"; doc 24 binds the single derived key `rf_<refundId>` with no key-storage columns. Both hold under this protocol:

1. **Reconcile first, always:** the retry handler lists provider refunds for the PaymentIntent (and checks `providerRefundId` if stored). An existing in-flight/succeeded provider refund matching this `Refund` → adopt it (proceed to settlement via webhook/sweep), never create another.
2. **Retry no earlier than the provider idempotency-key TTL (24 h) after the failure** — the same `rf_<refundId>` key then executes fresh. Guarded `FAILED → PROCESSING` claim, then step 4 above. In practice a failed refund needs the org to fix something first (typically an insufficient connected-account balance), so next-day retry matches the real operational rhythm.
3. **Urgent path — cancel and reissue:** staff with `revenue.refund_approve` cancels the FAILED refund (`FAILED → CANCELLED`, reason required, audited). The cancelled row no longer consumes remainder, so a **new** REFUND adjustment → new `Refund` row → fresh `rf_<newRefundId>` key can execute immediately. Not a duplicate: the first refund is terminally cancelled and both rows remain in history.

Simpler-workflow choice: the default retry button simply says when it becomes available ("Retry available after 14:32 tomorrow — or cancel and re-issue now"), rather than exposing key-TTL mechanics.

#### 3.2.7 Instructor Compensation impact

Applied in the settlement transaction, driven by two existing org knobs (no new config):

| `compensationRefundPolicy` | Behavior in Tx R4 |
|---|---|
| `REQUIRE_APPROVAL` (default) | No earning rows written. `Refund.compensationImpact = PENDING_DECISION` when clawback is in scope (below); the Instructor Compensation queue surfaces it; a `revenue.compensation_approve` holder later records **Reverse** (writes the negative `InstructorEarning` rows, `reversesEarningId` + required `reversalReason`, per doc 12 §2.4 — exported originals net out through the next export) or **Keep** (`compensationImpact = KEPT`). Decision + actor + timestamp stored on the `Refund` (§5). The instructor did the work even if the customer was refunded — clawback is a human decision. |
| `AUTO_REVERSE` | Negative `InstructorEarning` rows written in Tx R4 itself; `compensationImpact = REVERSED`. |
| `NEVER` | `compensationImpact = NOT_APPLICABLE`; earnings untouched. |

**Scope** (`instructorClawbackPolicy = SERVICE_LINES_ONLY`, default): clawback is in scope **only for line-targeted refunds whose target lines include the instruction lines that earned the compensation** (via `InvoiceLine.instructorTimeEntryId` → `InstructorEarning.timeEntryId`), proportional to the refunded share of each line. Proportional/goodwill refunds never propose clawback — doc 08's "goodwill refunds leave earnings intact," now binding. Reversal amounts round half-up; a partially-refunded instruction line proposes a partial reversal.

#### 3.2.8 Platform-fee treatment

Per the doc 18 Connect model (D1: direct charges on the connected account + `application_fee_amount`) and the snapshotted `PlatformFeePolicy` version on the `PlatformFee` row — never a re-resolution of current policy:

- `refundReversesFee = true` (default): the adapter call sets `refund_application_fee: true`, and Stripe reverses the application fee **proportionally** to the refund. Local math mirrors it exactly so reconciliation ties out: `feeReversalDelta = round_half_up(effectiveFee × refundAmount ÷ collectedTotal)`, accumulated into the signed `PlatformFee.reversedAmount`, with a **final-refund true-up** — when cumulative succeeded refunds reach the full collected amount, `reversedAmount` trues up so the effective fee is exactly 0. Deliberately proportional (not a re-base under clamps) for refunds, matching Stripe's actual money movement — doc 12 §2.3 already prescribed proportional-on-refund; re-basing stays the rule for charge-side *adjustments* only. Any local-vs-provider divergence opens a `FEE_MISMATCH` `ReconciliationException`.
- `refundReversesFee = false`: `refund_application_fee: false`; `reversedAmount` untouched; the refund's `PROCEEDS` reversal takes the full amount from `TAX` + `SCHOOL_RETAINED_REVENUE` (the school bears the fee on refunded revenue — a platform commercial term, doc 27).
- `CUSTOMER_CREDIT`/`MANUAL` destinations: no provider fee movement exists, but the **bookkeeping is identical** (`reversedAmount` + reversal rows) so tenant books are rail-independent; platform-side settlement netting is doc 27 territory.
- The fee is hidden from students/payers in every surface (spec Part W); receipts show the refund only.

#### 3.2.9 Refunds × ACH and disputes

- **ACH before settlement: structurally impossible.** Under D4, an ACH payment produces its `Payment` row only at settlement (`ACH_PENDING` → `PAID`); before that there is nothing to refund — the refund picker simply has no eligible payment. The escape hatch for "stop this ACH" is: wait for the outcome, then refund (settled) or handle the return (failed). No cancel-in-flight path is offered in Part 2 (Stripe ACH debits are generally not cancelable once submitted).
- **ACH after settlement: allowed, with the return-risk warning.** An ACH debit can still return (administrative/unauthorized returns up to the NACHA 60-day consumer window) *after* AeroOps refunded it — the school can be out twice. Part 2 posture: warn, don't block — the refund confirmation for an ACH payment younger than 60 days states the risk plainly ("This bank payment can still be returned by the customer's bank until <date>. Refunding now means a later return would leave the school out both amounts."). No new config knob; a later return after refund arrives dispute-shaped (§3.3.6) and the over-reversal opens a `ReconciliationException` rather than double-writing reversal sets. ACH refunds also take days to land — the payer-facing copy says so (§9).
- **Disputes block refunds.** While any dispute on the payment is `OPEN` or `UNDER_REVIEW`: 409 — "This payment is under dispute; funds are already withdrawn. Resolve the dispute instead." (Stripe refuses refunds on actively disputed charges; we refuse first with a better message.) After `LOST`: the disputed amount is excluded from the remainder (§3.2.3) — usually 0 left. After `WON` or `WARNING_CLOSED`: refunds are available again.

### 3.3 Disputes

#### 3.3.1 Ownership and record

Under doc 18's model (D1: direct charges, the school is merchant of record), **the organization owns disputes**: the disputed amount plus the provider dispute fee are withdrawn from *its* connected account, and its evidence wins or loses the case. AeroOps' role is software: track, notify, deadline-manage, and keep the books true. `Dispute.liability` snapshots this ownership per dispute (`ORGANIZATION` default; `PLATFORM` exists for the cases doc 18 assigns to AeroOps, e.g. a platform-caused charge error) — spec Part V's "platform responsibility / organization responsibility" is this field plus the fee treatment in §3.3.5. The **customer** is derived from the linked review/invoice (payer or self-paying student) — no denormalized column; the five-identity separation stays intact.

The `Dispute` row (doc 13 §4.10 shape + §5 additive columns) is written **only by the webhook processor** — no human creates disputes. Ingestion is upsert-shaped (doc 24 L12): first event inserts under `@@unique([provider, providerDisputeId])`; later events move status forward through guarded claims ordered by Stripe's event `created` timestamp, never arrival order.

#### 3.3.2 Lifecycle (webhook-driven; doc 23 pipeline)

| Provider event | Guarded transition | Same-tx side effects | Post-commit |
|---|---|---|---|
| `charge.dispute.created` | — → `OPEN` (insert) | Row created: amount, currency, provider reason code, `evidenceDueBy`, `openedAt`, links to Payment/Invoice/Review resolved from local `providerPaymentIntentId`; review `CARD_PAID`/`PAID`/`PARTIALLY_REFUNDED` → `DISPUTED` + Invoice projection | `recordAudit('revenue.dispute_opened')`; org notification with deadline (doc 31); dashboard/queue flag |
| `charge.dispute.funds_withdrawn` | `fundsWithdrawnAt` stamped | Funds-withdrawal journal (§3.3.4); `disputeFeeAmount` captured from the event's balance transaction (safe metadata) | Audit |
| `charge.dispute.updated` (e.g. evidence under review) | `OPEN → UNDER_REVIEW` | — | Audit |
| `charge.dispute.closed` — won | `OPEN/UNDER_REVIEW → WON`; `resolvedAt` | Reinstatement journal (§3.3.4; fee return journaled only if the event's balance transactions show it); review `DISPUTED → PAID` | Audit; `emitDomainEvent('dispute.closed')`; org notification |
| `charge.dispute.closed` — lost | `OPEN/UNDER_REVIEW → LOST`; `resolvedAt` | The **chargeback settlement contract** (§3.3.5) — full reversal records in this one tx; review `DISPUTED → REFUNDED` (full) / `PARTIALLY_REFUNDED` (partial) | Audit; event; org notification |
| `charge.dispute.closed` — early-warning resolved without money movement | → `WARNING_CLOSED`; `resolvedAt` | Review `DISPUTED → PAID` (nothing moved) | Audit; notification |

All replay-safe: duplicate events no-op off `PaymentProviderEvent.processedAt`; out-of-order events are ordered by `created`; a `closed` arriving before `funds_withdrawn` still books the withdrawal facts from the closed event's balance transactions (the reducer keys journals off facts present in the event, not off local sequence assumptions).

#### 3.3.3 Evidence workflow — pilot-appropriate, deliberately not overbuilt

What Part 2 builds:

1. **Deadline tracking:** `evidenceDueBy` on the row; countdown chip on the review and the dispute queue; reminder notifications at 7 / 3 / 1 days before the deadline (engine constants, not config).
2. **Evidence storage:** staff with `revenue.dispute_manage` attach evidence files as **existing `Document` rows** (org-scoped, per the seams audit) through the append-only `DisputeEvidence` join (§5) with a short label ("Signed rental agreement", "Training record 2026-06-14", "Text thread with payer"). Aviation reality: the winning evidence is usually the signed rental/training agreement, the dispatch record, and the instructor's lesson record — all already in AeroOps.
3. **Submission tracking:** a "Mark evidence submitted" action stamps `evidenceSubmittedAt` + audit. **Actual submission to the card network happens in the Stripe dashboard** (surface depends on doc 18's account-type decision; the dispute detail links out). AeroOps records that it happened; it does not transmit evidence in Part 2.

What Part 2 deliberately does **not** build (spec Part V: "do not overbuild before pilot launch"): programmatic evidence submission via the Stripe dispute API, evidence templates/auto-assembly from dispatch + lesson records, and win-rate analytics — all Part 3 candidates (§10), with auto-assembly the highest-value one for flight schools. The `DisputeEvidence` join is the future-ready seam: Part 3's submission API reads the same rows.

4. **Missed deadline:** nothing local fires — Stripe auto-resolves (typically lost) and the `closed` event drives the outcome. AeroOps never invents a dispute outcome from its own timer.

#### 3.3.4 Funds impact — dispute journals (extends doc 12's posting matrix; **no new `LedgerAccount` values**)

| Event | Debit | Credit | Meaning |
|---|---|---|---|
| Funds withdrawn (dispute opened) | `ACCOUNTS_RECEIVABLE` (disputed amount); `PROCESSOR_FEES_EXPENSE` (dispute fee) | `PAYMENT_CLEARING` (amount + fee) | The customer's claim reopens the receivable; the provider fee is a processing cost — **never** labeled an AeroOps fee (spec Part W) |
| Won (funds reinstated) | `PAYMENT_CLEARING` (amount, + fee if the event shows its return) | `ACCOUNTS_RECEIVABLE` (amount); `PROCESSOR_FEES_EXPENSE` (fee, if returned) | Exact reversal of the withdrawal, driven by the event's balance-transaction facts |
| Lost (chargeback stands) | `REVENUE_*` per the `DISPUTE` reversal set (§3.3.5); `TAX_PAYABLE`; `PLATFORM_FEE_PAYABLE` (fee reversal, §3.3.5) | `ACCOUNTS_RECEIVABLE` (disputed amount); `PLATFORM_FEE_EXPENSE` (fee reversal) | Closes the reopened receivable against reversed revenue — same journal shape as a refund with `ACCOUNTS_RECEIVABLE` in place of `PAYMENT_CLEARING`; only the allocation set's event (`DISPUTE`, not `REFUND`) differs |

#### 3.3.5 Lost dispute — the chargeback settlement contract

A lost dispute is an **involuntary refund**: same reversal contract as §3.2.5 Tx R4, written in the `closed(lost)` reduce transaction, with these differences:

- **No `Refund` row and no `RevenueAdjustment`.** `Refund` records org-initiated refunds; conflating chargebacks with them would corrupt refund reporting and the `adjustmentId` contract. Provenance is the `Dispute` row itself: the allocation reversal set is `event: DISPUTE, sourceType: "Dispute", sourceId: dispute.id`. The dedicated `AllocationEvent.DISPUTE` value **ships** (doc 34 §7.2; doc 28 §5.2 and §6.5 set S4) precisely so lost-dispute clawbacks report separately from org-initiated `REFUND` sets — §11 Q3, decided.
- **Amount Due** derivation (ADR-035) extends with the lost-dispute term: `… − Σ settled Payments + Σ succeeded Refunds + Σ Dispute.amount WHERE status = LOST`. An extension, not a reinterpretation — Part 1 explicitly deferred dispute mechanics to Part 2. Largely display-level (the review is terminal `REFUNDED` after a full chargeback), but it keeps the R7 footing identity true.
- **Tax:** reversal `TaxSnapshot` rows in the same tx (proportional for partial chargebacks) — a lost dispute must not overstate Tax Collected any more than a refund may.
- **Platform fee:** reversed per `refundReversesFee` under the snapshotted policy version, same math as §3.2.8 — a lost dispute means the revenue was ultimately uncollected, and AeroOps earns nothing on uncollected revenue. Whether Stripe actually claws the application fee back from AeroOps' platform balance is doc 18/27 mechanics; the tenant-book records are written here regardless, and divergence surfaces as `FEE_MISMATCH`.
- **Instructor Compensation:** a **full** chargeback reverses everything, including instruction lines — so it is always in clawback scope. `REQUIRE_APPROVAL` (default) → `Dispute.compensationImpact = PENDING_DECISION`, same human-decision queue as §3.2.7; `AUTO_REVERSE` → negative rows for all the review's earnings in this tx; `NEVER` → untouched. A **partial** chargeback cannot be line-attributed (card networks dispute amounts, not line items) → always `PENDING_DECISION` under both `REQUIRE_APPROVAL` and `AUTO_REVERSE` (never auto-claw an ambiguous amount); `NEVER` → untouched.
- **Re-billing after a lost dispute is not automated.** The review closes `REFUNDED`; whether the school pursues the customer is a collections/commercial decision made outside the status machine (staff may create a manual review, clearly labeled — §11 Q2). The payer's `DISPUTED`/lost-dispute history feeds the *financial* checkout-restriction evaluator (doc 10 / doc 03 open Q6) — never the safety path.

#### 3.3.6 ACH returns that arrive dispute-shaped

A post-settlement ACH return (unauthorized-debit claims within the 60-day consumer window) arrives as a dispute event on an ACH charge. These are **unchallengeable** — there is no evidence phase: `evidenceDueBy` is null, the UI shows "Bank return — cannot be contested," and the lifecycle typically runs `OPEN → LOST` in short order, driving the §3.3.5 contract. If the payment had already been refunded (§3.2.9), the reducer computes the reversal against the **net** remaining collected value; an over-reversal (return + refund > collected) writes only up to net-zero and opens an `AMOUNT_MISMATCH` `ReconciliationException` for the accountant — books never go negative silently.

---

## 4. Configuration surface

**This document adds zero new configuration keys.** Every knob it consumes already exists in Part 1 — a deliberate simplicity stance: refunds and disputes are workflows, not settings pages.

| Key | Home | Default | Used here for |
|---|---|---|---|
| `secondApprovalForRefunds` | `RevenueWorkflowPolicy` | `true` | Every refund needs a second pair of eyes (§7) |
| `separationOfDutiesRequired` | `RevenueWorkflowPolicy` | `true` | Approver ≠ requester; second ∉ {requester, approver} |
| `refundToCreditAllowed` | `RevenueSettings` | `true` | Enables the `CUSTOMER_CREDIT` destination |
| `refundWarnAfterDays` | `RevenueSettings` | `90` | Age warning on old payments (D4: warn, not block) |
| `creditExpiryMonths` | `RevenueSettings` | `12` | Expiry of refund-issued credits |
| `compensationRefundPolicy` | `RevenueSettings` | `REQUIRE_APPROVAL` | §3.2.7 / §3.3.5 clawback behavior |
| `instructorClawbackPolicy` | `RevenueSettings` | `SERVICE_LINES_ONLY` | Clawback scope (line-targeted only) |
| `reconciliationStalePaymentDays` | `RevenueSettings` | `5` | Stale `PROCESSING` refund sweep threshold (§8) |
| `refundReversesFee` | `PlatformFeePolicy` — **platform-owned, never org-editable** | `true` | §3.2.8, §3.3.5 fee reversal |
| Provider refund window per method type | Adapter catalog constant in `src/lib` (contract-tested), **not** config | Stripe-published limits | D4 hard-block with credit fallback |
| Evidence reminder cadence (7/3/1 days) | Engine constant | — | §3.3.3 — not worth a settings row |

Platform Console (doc 18/19 surfaces) shows per-org dispute counts and fee-reversal totals under existing platform permissions; `Dispute.liability` overrides (marking a dispute platform-absorbed) are `authorizePlatform`-only and audited.

---

## 5. Data model additions (Prisma-flavored; final call in `34-part2-database-additions.md`)

Part 1's `Refund` and `Dispute` shapes (doc 13 §4.10) stand unchanged in every existing field. Additions are strictly additive:

```prisma
// ---- Dispute: additive columns (spec Part V tracking set) ----
enum DisputeLiability {
  ORGANIZATION // default under doc 18 (school is merchant of record)
  PLATFORM     // AeroOps-absorbed per doc 18's ownership carve-outs; authorizePlatform-only to set
}

enum CompensationImpactDecision {
  NOT_APPLICABLE   // policy NEVER, or no instruction lines in scope
  PENDING_DECISION // awaiting a revenue.compensation_approve holder (§3.2.7)
  REVERSED         // negative InstructorEarning rows written
  KEPT             // human decided the instructor keeps the compensation
}

model Dispute {
  // ... doc 13 §4.10 fields unchanged ...
  liability            DisputeLiability @default(ORGANIZATION)
  disputeFeeAmount     Decimal?         @db.Decimal(12, 2) // provider dispute fee, from event balance transactions (same currency)
  fundsWithdrawnAt     DateTime?
  fundsReinstatedAt    DateTime?
  evidenceSubmittedAt  DateTime?        // stamped by "Mark evidence submitted" (§3.3.3)
  outcomeNote          String?          // staff-entered context on WON/LOST/WARNING_CLOSED

  compensationImpact          CompensationImpactDecision @default(NOT_APPLICABLE)
  compensationDecidedById     String?
  compensationDecidedByLabel  String?
  compensationDecidedAt       DateTime?

  evidence DisputeEvidence[]

  @@index([organizationId, evidenceDueBy]) // deadline queue + reminder sweep
}

// ---- New: append-only evidence join (reuses the existing Document model) ----
model DisputeEvidence {
  id             String   @id @default(cuid())
  organizationId String
  disputeId      String
  documentId     String
  label          String   // "Signed rental agreement", "Lesson record 2026-06-14"
  addedById      String?
  addedByLabel   String
  createdAt      DateTime @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  dispute      Dispute      @relation(fields: [disputeId], references: [id], onDelete: Cascade)  // workflow child of its dispute
  document     Document     @relation(fields: [documentId], references: [id], onDelete: Restrict) // evidence must not silently vanish

  @@unique([disputeId, documentId])
  @@index([organizationId, createdAt])
}

// ---- Refund: additive columns (clawback decision storage, §3.2.7) ----
model Refund {
  // ... doc 13 §4.10 fields unchanged; no idempotency-key column (doc 24: rf_<refundId> is derived) ...
  compensationImpact          CompensationImpactDecision @default(NOT_APPLICABLE)
  compensationDecidedById     String?
  compensationDecidedByLabel  String?
  compensationDecidedAt       DateTime?
}
```

Notes for doc 34:

- `DisputeEvidence` joins org-snapshot capture/wipe/restore; wipe order slots it immediately **before** `Dispute` (between steps 6 and 7 of doc 13 §10.2). Schema-governance auto-coverage applies (org FK, explicit `onDelete`, tenant-scoped unique).
- The customer party on a dispute is **derived** from the linked review/invoice — no `payerId`/`studentId` columns on `Dispute` (rejected: denormalizing identity onto a provider-driven record invites drift; the links already exist).
- No changes to `Payment`, `RevenueAdjustment`, `ScheduledCharge`, `RevenueAllocation`, `LedgerEntry`, `PlatformFee`, any config singleton, or any enum — **by this doc**. Lost-dispute reversal sets do carry the additive `AllocationEvent.DISPUTE` value (lost-dispute clawback sets, reported separately from `REFUND` — §3.3.5); that enum addition is committed and owned by doc 28 §5.2 / doc 34 §7.2, not arbitrated here.
- Seed fixtures (both demo orgs): one partially-refunded review, one review with a `PENDING_DECISION` clawback, one open dispute with evidence attached and a near deadline, one lost dispute — so every queue and banner in §9 renders with real data.
- `STATUS_TONE` entries (single-source rule): all `RefundStatus` values (5), all `DisputeStatus` values (5), and the `CompensationImpactDecision` chip states.

---

## 6. Validation & business rules

| # | Rule |
|---|---|
| V1 | Void only per the §3.1 matrix; the no-attempt/no-collection checks run **inside** the void transaction, not as a pre-read. Never voidable in `PAYMENT_PROCESSING`/`ACH_PENDING`; never once collected. |
| V2 | Voided approved reviews retain their full snapshot, approvals, and TaxSnapshot; the void appends reversal records and stamps `voidedAt/ById/Reason`. Regeneration only via a new review (doc 03 §6.5). |
| V3 | A refund targets exactly one settled `Payment`; refund currency = payment currency = review currency (engine-enforced in-tx). |
| V4 | `amount > 0` and `≤ refundableRemainder` (§3.2.3), computed in the apply transaction. Cumulative succeeded refunds can never exceed the captured amount — structurally. |
| V5 | The original `Payment` row is never mutated by refund, dispute, or void — no field, ever. Contract-tested (static scan: no `payment.update` in refund/dispute engines). |
| V6 | Reversal records (`TaxSnapshot` reversals, `REFUND`/`VOID` allocation set, reversing journal, fee reversal, comp impact, review status) are written in **one** transaction — the one that marks the money moved (`SUCCEEDED` settle tx; apply tx for credit/manual destinations; the `closed(lost)` reduce tx for chargebacks; the void tx). No partial-reversal window exists. |
| V7 | No provider call inside any `db.$transaction` (spec Parts S/AB); every provider call carries its deterministic key (`rf_<refundId>`) and a timeout; unknown outcomes follow doc 24 §6 — never synthesized. |
| V8 | Refund status transitions are guarded claims; terminal truth for `ORIGINAL_METHOD` comes only from webhook-confirmed provider events (client/API optimism never marks refunded). |
| V9 | Disputes: rows written only by the webhook processor; tenancy from local references with connected-account must-match; transitions ordered by event `created`; replay no-ops. |
| V10 | Open/under-review dispute on a payment blocks new refunds (409 with guidance); `LOST` amounts consume remainder. |
| V11 | `ORIGINAL_METHOD` past the provider refund window → hard-block with `CUSTOMER_CREDIT`/`MANUAL` offered (D4); age > `refundWarnAfterDays` → explicit confirm. |
| V12 | Allocation reversal sets balance per dimension to the reversal amount; largest-remainder for proportional splits; half-up division; all rounding residue to `SCHOOL_RETAINED_REVENUE`; journals balance (Σ debits = Σ credits, one currency). Reports bucket on `effectiveAt`. |
| V13 | Lost-dispute reversals compute against **net** remaining collected value and never push the review's books past net-zero; overshoot opens `AMOUNT_MISMATCH` instead of writing it. |
| V14 | Fee reversal parity: local `reversedAmount` math must match provider application-fee movement; divergence → `FEE_MISMATCH` exception, never a silent adjust. |
| V15 | Compensation clawback rows are new signed `InstructorEarning` rows with `reversesEarningId` + required `reversalReason`; exported originals are netted by the next export, never un-exported. |
| V16 | Every mutation in this doc: `authorize({ mutating: true })`, `recordAudit` with reconstruct-without-DB-state metadata, `emitDomainEvent` post-commit only. Read-only impersonation blocks all of them. No AI pathway may void, refund, or decide clawbacks (constitution rule 8). |
| V17 | `REVENUE_CHARGING=off` degrades gracefully: `ORIGINAL_METHOD` unavailable for provider-collected payments (adapter absent — the destination is disabled with an explanatory note); `CUSTOMER_CREDIT`/`MANUAL` refunds of offline payments keep working; no dispute ingestion exists (no webhook secret → route inert). |

---

## 7. RBAC, approvals & audit

Permission keys (data in `src/lib/permissions.ts`, `revenue.*` per D3; module-gated via `MODULE_BY_PREFIX` `revenue → billing`):

| Key | Grants | Default role bundles |
|---|---|---|
| `revenue.void` | Void per §3.1 matrix (existing key, doc 03) | ADMIN tiers |
| `revenue.refund` | Request refunds (D3 rename of doc 08's `billing.refund`) | ACCOUNT_OWNER, SCHOOL_ADMIN, ACCOUNTANT |
| `revenue.refund_approve` | Approve refunds; retry/cancel FAILED refunds (D3 rename) | ACCOUNT_OWNER, SCHOOL_ADMIN, ACCOUNTANT |
| `revenue.dispute_manage` | **New.** Attach/label evidence, mark evidence submitted, add outcome notes | ACCOUNT_OWNER, SCHOOL_ADMIN, ACCOUNTANT |
| `revenue.compensation_approve` | Decide clawback proposals (existing key) | ACCOUNT_OWNER, SCHOOL_ADMIN |

Dispute *viewing* rides `revenue.review_view` (a dispute is part of its review's financial story). Instructors and students never see disputes, other customers, or fee treatment; instructors see a clawback only as its outcome on their own compensation (per Part 1 visibility rules). DISPATCHER and INSTRUCTOR hold none of the mutation keys by default; the Operations Director OrgRole template carries `revenue.refund`; refund **approval** stays with owner/admin/accountant bundles.

**Approval mechanics:** refunds are always-second-approval by default (`secondApprovalForRefunds = true`): `approvedById ≠ requestedById` and `secondApprovedById ∉ {requestedById, approvedById}` under `separationOfDutiesRequired`. Sole-approver orgs get the audit-flagged `SELF_APPROVED_SOLE_USER` relaxation (doc 03 D17/D18 family) — a one-person flight school must still be able to refund a customer, and the flag keeps it honest. Voids need no second approval (nothing was collected); high-risk voids are visible through the audit trail and the voided-reviews report.

**Audit actions** (every state change; `recordAudit`, dot-namespaced; ids/labels/amounts only — never provider secrets): `revenue_review.voided` (with reason + whether an approved snapshot was voided), `revenue.refund_requested`, `revenue.refund_approved`, `revenue.refund_applied`, `revenue.refund_processed` (provider ref + reversal row ids), `revenue.refund_failed`, `revenue.refund_cancelled`, `revenue.refund_retried`, `revenue.dispute_opened`, `revenue.dispute_updated`, `revenue.dispute_evidence_added`, `revenue.dispute_evidence_submitted`, `revenue.dispute_closed` (outcome + funds facts), `revenue.compensation_clawback_decided` (REVERSED/KEPT + reason).

**Domain events** (post-commit only; registered in `WEBHOOK_EVENTS` with live emit sites in this slice): `payment.refunded` (doc 08 §7.4), `dispute.opened`, `dispute.closed`. The in-process bus is fan-out only — refund/dispute correctness never depends on it (ADR-009).

---

## 8. Failure modes & edge cases

| Scenario | Behavior |
|---|---|
| Refund provider call times out / process dies mid-call | `Refund` stays `PROCESSING`; doc 24 §6 unknown-outcome protocol (`rf_<refundId>` within TTL, metadata search after); the reconciliation sweep flags `PROCESSING` older than `reconciliationStalePaymentDays` → `STALE_PENDING_PAYMENT` exception. Never a parallel refund. |
| Insufficient connected-account balance (Stripe refuses the refund) | `FAILED` + safe reason; org notification: "The school's Stripe balance can't cover this refund — it retries after incoming settlements arrive, or cancel and re-issue as customer credit." Retry per §3.2.6. |
| Refund webhook arrives before the runner stored `providerRefundId` | Event stored (unique-insert) but unmatched → left unprocessed; the bounded sweep re-drives it after the runner's write lands; matching falls back to PaymentIntent + `aerops_refund` metadata as a must-match cross-check (never attribution). |
| Duplicate submit / double-click at any step | Guarded claims + `adjustmentId @unique` → 409 naming the current state (doc 24 L8); no duplicate adjustment, refund row, provider call, or reversal set. |
| Refund succeeds, then the underlying ACH debit returns | Return arrives dispute-shaped (§3.3.6); reversal computed against net; overshoot → `AMOUNT_MISMATCH` exception + accountant notification. Books never silently go negative. |
| Dispute opened on an already partially-refunded payment | Allowed (card networks permit it); dispute block stops further refunds; lost-dispute reversal computes against net remaining value (V13). |
| Partial dispute amounts | Supported: `Dispute.amount < Payment.amount`; partial loss → `PARTIALLY_REFUNDED` review; compensation always `PENDING_DECISION` (§3.3.5). |
| Evidence deadline missed | No local action; provider `closed` event decides. Reminders (7/3/1) reduce the odds. |
| Connected account restricted/suspended mid-refund | Provider refusal → `FAILED` path; account status handling is doc 19/25 territory; the refund queue shows the account banner. |
| Webhook signature invalid / secret absent | Doc 23: 400 / route inert — no dispute or refund state can be forged. |
| Cross-tenant or mismatched connected-account event | Tenancy resolves from local rows only; account mismatch → event stored with `processingError`, `ReconciliationException` opened, nothing reduced. |
| Zero-amount or negative refund request | 400 — refunds are strictly positive; "reduce a charge" pre-collection is an adjustment (doc 08), not a refund. |
| Refund requested on a legacy (non-review) invoice payment | Out of scope: the refund flow requires a review-wrapped invoice; legacy manual payments keep today's manual correction paths. Recorded here so support doesn't promise otherwise. |

---

## 9. UX notes

- **Consequence-truthful controls everywhere** (the doc 03 wording rule): "Issue refund of $200.00 to Visa •••• 4242" / "Issue $200.00 as customer credit (expires 2027-07-10)" / "Record $200.00 refunded by check". Never a bare "Refund". The void control: "Void this Revenue Review — nothing will be charged"; post-approval it adds "The approved record is kept and marked Voided."
- **Refund modal, three tabs** (§3.2.4): *Full refund* (pre-filled remainder) · *Specific charges* (line pick with per-line refunded-so-far) · *Custom amount* (proportional; states that it spreads across categories). Live remainder math shown; warnings inline (age > 90 days; ACH 60-day return risk with the date; credit fallback when past the provider window).
- **ACH honesty:** payer-facing refund status shows "Refund initiated — bank refunds typically take 5–10 business days"; never "refunded" before the terminal webhook. Org-facing shows the `PROCESSING` state plainly.
- **Dispute banner on the review** (DISPUTED tone): amount, reason code in plain words ("Customer says they didn't authorize this charge"), **evidence-due countdown chip**, evidence checklist with one-click attach from existing org documents (rental agreement, dispatch record, lesson record — the things a flight school actually wins with), link out to the Stripe dashboard for submission, "Mark evidence submitted". Lost/won outcomes state the money facts: "Dispute lost — $200.00 and a $15.00 bank dispute fee were withdrawn from the school's account."
- **Clawback queue:** compensation decisions appear in the Instructor Compensation queue as "Refund on RR-1042 touched instruction charges — reverse $60.00 of Alex R.'s compensation?" with Keep/Reverse and required reason on Reverse. Instructors see only the applied outcome on their own records.
- **Students/payers never see:** platform fee treatment, dispute internals beyond their own payment's status, instructor compensation impact, other customers. Receipts show refunds as plain line entries.
- Light/dark + mobile parity; every queue has loading/empty/error states; every computed number (remainder, proportional split preview, fee reversal) carries its reasons on hover/expand.

---

## 10. Out of scope for Part 2 / deferred to Part 3

- **Programmatic dispute-evidence submission** via the Stripe API, evidence auto-assembly from dispatch/lesson/agreement records, and dispute analytics (win rates, payer risk scoring). Part 2 tracks, stores, notifies; submission happens in the Stripe dashboard (§3.3.3).
- **Automated re-billing / collections after a lost dispute** — manual review creation only, pending the §11 Q2 product call.
- **`WRITTEN_OFF`** — enum reserved, still no writer (unchanged from Part 1).
- **Refund receipts by email** — in-app Notification rows only; no email adapter exists (seams audit); nothing claims an email was sent.
- **Instructor payout clawback execution** — Part 2 records reversal rows; money recovery from instructors is outside AeroOps (export-side netting only, doc 12).
- **Payer-initiated refund requests** from the payer portal (Part 3 payer surface at the earliest).
- **Live charges, live refunds, live disputes** — Stripe **test mode only**; `REVENUE_CHARGING` has no `live` value in this phase; dispute flows are exercised with Stripe test-mode dispute triggers per doc 33. Nothing here is deployed.

---

## 11. Open questions

| # | Question | Recommendation | Decider |
|---|---|---|---|
| Q1 | **Platform-fee commercial terms on refunds and lost disputes:** confirm `refundReversesFee = true` stays the global default, and confirm the provider dispute fee is always an organization expense (`PROCESSOR_FEES_EXPENSE`), with AeroOps absorbing nothing by default. Extends doc 12 §10 Q1 / doc 27. | Keep `true`; org bears the dispute fee (it owns the dispute under doc 18). Revisit with the CEO pricing decision (feePercentBps is 0 until then, so this is cheap to decide later). | CEO + Head of Product |
| Q2 | **Re-billing after a lost dispute:** may staff regenerate a manual Revenue Review to pursue the amount (clearly labeled, no automation), or is a lost dispute commercially final in-product? | Allow manual review creation with a "re-bill after lost dispute" origin label and a warning; never automatic. | Head of Product + Aviation Accounting Specialist |
| Q3 | **Resolved — `AllocationEvent.DISPUTE` ships.** Whether lost-dispute clawback reversals carry a dedicated `AllocationEvent.DISPUTE` value or reuse `REFUND` with `sourceType: "Dispute"`. | **Decided: add `AllocationEvent.DISPUTE`** (lost-dispute clawback sets, reported separately from `REFUND`) — doc 28 §5.2 / §6.5 set S4 and doc 34 §7.2 commit it; §3.3.5 uses `event: DISPUTE, sourceType: "Dispute"` so chargebacks never fold into refund reporting. | Decided — doc 28 / `34-part2-database-additions.md` |
| Q4 | **ACH refund posture** (§3.2.9): warn-only inside the 60-day return window, or an org-configurable hold? | Warn-only, no new knob — aligns with D4 and keeps the settings surface flat for five real schools. | Head of Product |
| Q5 | **Instructor notification on clawback:** notify the instructor when a clawback is *proposed*, or only when a reversal is *applied*? | Only on applied reversals — proposals are an internal finance decision; premature notice creates conflict for money that may never move. | Head of Product + Chief Flight Instructor persona review |
