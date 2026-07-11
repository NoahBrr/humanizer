# Revenue Allocation & Ledger Mechanics — Part 2

> **Status:** Proposed — Phase 8 Part 2 · **Date:** 2026-07-10 · **Lead roles:** Aviation Accounting Specialist; Financial Systems Architect; SaaS Revenue Operations Architect · **Part of:** Revenue Engine design set ([README](./README.md))

---

## 1. Purpose & scope

Part 1's [12-revenue-allocation-and-reporting.md](./12-revenue-allocation-and-reporting.md) designed the allocation/ledger system before any payment mechanics existed. This document is the Part 2 deepening (spec **Part X**, deliverable 13): it finalizes the ledger mechanics **now that payment reality exists** — real Stripe charges on connected accounts, an actual (not estimated) Stripe processing fee learned only at settlement, application-fee deduction at source, refunds, lost disputes, and provider payouts.

It owns:

1. The **full Part X category set** — every category the spec lists, mapped onto the binding `AllocationCategory` enum (additive extensions only), with an explicit statement of which figures are known at approval versus only at payment settlement.
2. The **two-stage allocation design**: approval-time allocation from the immutable snapshot, plus settlement-time **true-up sets** for provider-fee actuals — always additional rows, never overwrites.
3. The **finalized posting matrix** for provider-collected money (card, ACH), offline money (cash/check), refunds, disputes, waivers, and payouts — with worked, balanced journals for the six canonical scenarios.
4. The **ledger-style requirements** of Part X restated as enforceable invariants.
5. The **reporting-dimension mapping** consumed by [30-revenue-dashboard.md](./30-revenue-dashboard.md).

**Not in this document:** the webhook pipeline and event-claim transaction shape (Part T doc of this set; doc 09 §2.10 baseline), refund/dispute workflow and permissions (Part V doc; doc 08 contracts), platform-fee policy models and commercial mechanics (Part W doc; doc 12 §2.3 baseline), instructor-compensation recognition policies (Part Y doc), the dashboard itself (30), and final DDL arbitration ([34-part2-database-additions.md](./34-part2-database-additions.md) makes the final call on every new shape proposed in §11).

North-star check: a school's accountant must be able to open any month and answer *"what did we bill, what did we collect, what did Stripe take, what did AeroOps take, and what did we keep?"* — with every number tracing to immutable rows, and with the operational staff never having seen a debit or credit.

---

## 2. Relationship to Part 1 docs

| Part 1 doc | This doc's relationship |
|---|---|
| [12-revenue-allocation-and-reporting.md](./12-revenue-allocation-and-reporting.md) | **Extends.** The two-dimension balanced-set model, allocation events, ledger account taxonomy, reconciliation invariants R1–R7, and report semantics all stand. This doc adds the settlement stage, provider-fee actuals, dispute postings, and finalizes two posting-matrix rows doc 12 explicitly marked "(Part 2)" — see §5.4 and Open question 1. |
| [13-database-model.md](./13-database-model.md) | **Binding.** All Part 1 model/enum shapes (`RevenueAllocation` §4.13 incl. `effectiveAt`, `LedgerEntry` with no memo/review columns per R30, `PlatformFee.earnedAt`, `Payment` §4.2.4) are used exactly as written. New enum values and column additions proposed here are additive and finalized in 34. |
| [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) | Owns the approval transaction in which the APPROVAL set, approval journal, `PlatformFee` (ACCRUED), and `InstructorEarning` rows are written. Unchanged. |
| [07-tax-model.md](./07-tax-model.md), [08-adjustments-discounts-credits.md](./08-adjustments-discounts-credits.md) | Tax snapshots and adjustment/refund records trigger the ADJUSTMENT/REFUND sets exactly per Part 1; this doc adds their PROCEEDS-side interaction with the new `PROCESSOR_FEE` category (none — see §4.3). |
| [09-payment-timing-and-collection.md](./09-payment-timing-and-collection.md) | Settlement postings run inside the idempotent webhook-processing transaction designed there; the fee true-up is a new post-settlement async hop added here (§9). |
| [06-revenue-items.md](./06-revenue-items.md) | `RevenueItem.defaultAccountingCategoryCode` becomes a live seam: it now names an `AllocationCategory` and drives fine-grained category resolution (§3.2). |
| [14-migration-plan.md](./14-migration-plan.md) | New enum values ship in their own additive DDL migrations before any writer, slotted by 34 into the M-sequence (after M14/M15, since they extend enums created there). |

Nothing in Part 1 is reinterpreted. One Part 1 provisional detail is superseded with cause and flagged (§5.4, Open question 1).

---

## 3. The category set — Part X, complete

### 3.1 Category disposition table

Every category the spec lists, where it lives, and **when its amount is known**:

| Spec category (Part X) | Lives as | `AllocationCategory` value | Dimension | Known at |
|---|---|---|---|---|
| Aircraft rental revenue | Part 1 value | `AIRCRAFT_REVENUE` | REVENUE | Approval (snapshot) |
| Instructor-service revenue (flight) | Part 1 value | `INSTRUCTOR_SERVICE_REVENUE` | REVENUE | Approval |
| Ground-instruction revenue | **NEW value** | `GROUND_INSTRUCTION_REVENUE` | REVENUE | Approval |
| Simulator revenue | **NEW value** | `SIMULATOR_REVENUE` | REVENUE | Approval |
| Airport fees / Landing fees / Ramp fees | Part 1 value (one category) | `AIRPORT_LANDING_FEES` | REVENUE | Approval |
| Fuel surcharge | Part 1 value | `FUEL_REVENUE` | REVENUE | Approval |
| Membership revenue | **NEW value** | `MEMBERSHIP_REVENUE` | REVENUE | Approval |
| Training-material revenue | **NEW value** | `TRAINING_MATERIAL_REVENUE` | REVENUE | Approval |
| Merchandise revenue | **NEW value** | `MERCHANDISE_REVENUE` | REVENUE | Approval |
| Tax liability | Part 1 value | `TAX` | both | Approval (TaxSnapshot) |
| AeroOps platform fee | Part 1 value | `PLATFORM_FEE` | PROCEEDS | Approval (policy snapshot; accrued) — **earned** at settlement |
| **Stripe processing expense** | **NEW value** | `PROCESSOR_FEE` | PROCEEDS | **Settlement only** (actual balance-transaction fee — never estimated, never posted at approval) |
| School retained revenue | Part 1 value | `SCHOOL_RETAINED_REVENUE` | PROCEEDS | Residual — first cut at approval, trued down at settlement (§7) |
| Refund reserve | **Reserved value, no writer in Part 2** | `REFUND_RESERVE` | PROCEEDS | — (deferred, §16) |
| Instructor compensation liability | **Not an allocation category** (Part 1 binding decision, doc 12 §2.1) — lives as `InstructorEarning` rows + `INSTRUCTOR_COMP_EXPENSE`/`INSTRUCTOR_COMP_PAYABLE` ledger postings | — | cost side | Approval |
| Other configured categories | Part 1 value + item-level codes | `OTHER_REVENUE` (+ `RevenueItem.defaultAccountingCategoryCode` / `AccountingMapping` for finer external grain) | REVENUE | Approval |

Decisions embedded above:

- **Airport/landing/ramp stay one category.** Simpler-workflow choice: a Director of Operations thinks "airport fees", not three ledger buckets; the per-item grain (landing vs ramp vs overnight) survives on `InvoiceLine.itemCode` and exports via `AccountingMapping` (`REVENUE_ITEM` sourceKey), so an org that wants three external accounts gets them at export time without three internal categories.
- **Ground instruction and simulator split out.** The spec, the Part Y "flight versus ground" reports, and the Part Z dashboard all need this grain. The split is **forward-only**: allocation rows written before the new enum values ship keep `INSTRUCTOR_SERVICE_REVENUE` (immutable point-in-time facts, ADR-028); reports simply show both categories. No backfill, no reinterpretation.
- **Instructor compensation is deliberately not re-litigated.** Doc 12 §2.1's rationale stands: compensation is a cost paid from school retained revenue, not a slice of the customer's invoice. The spec lists it as a *potential* category; the Revenue Dashboard sources "Instructor compensation liability" from the `INSTRUCTOR_COMP_PAYABLE` ledger balance and `InstructorEarning` rows (§8).
- **`PROCESSOR_FEE` is provider-agnostic.** UI labels it by the actual provider ("Card processing (Stripe)"). Per spec Part W: the AeroOps platform fee and the Stripe processing fee are **two distinct rows, two distinct categories, never conflated or mislabeled**.
- **`REFUND_RESERVE` ships as a reserved enum value with no writer** (like `RevenueLineOrigin.RULE` in Part 1). AeroOps never custodies funds (Part O preferred outcome), so a refund reserve is org bookkeeping policy, not money movement; no pilot school has asked for it. Adding the value now means adding a writer later is purely additive. Open question 3 confirms the deferral.

### 3.2 Line → REVENUE-category resolution (engine rule, `src/lib/revenue-allocation.ts`)

Resolved per locked `InvoiceLine` inside the approval transaction, first match wins:

1. `InvoiceLine.accountingCategoryCode` snapshot, when it names an `AllocationCategory` (REVENUE dimension values only; anything else → per-row resolution falls through).
2. The line's `RevenueItem.defaultAccountingCategoryCode` (doc 06 seam — now validated against the REVENUE-dimension catalog; the 26 seeded items ship with explicit codes, e.g. ground-school items → `GROUND_INSTRUCTION_REVENUE`, headset/logo items → `MERCHANDISE_REVENUE`).
3. Static `RevenueItemCategory` fallback: `AIRPORT_FEE → AIRPORT_LANDING_FEES`; `FUEL_OIL → FUEL_REVENUE`; `INSTRUCTION → INSTRUCTOR_SERVICE_REVENUE`; `MEMBERSHIP → MEMBERSHIP_REVENUE`; `RETAIL → TRAINING_MATERIAL_REVENUE` (simpler-workflow choice: flight-school retail is dominantly training materials; merchandise requires an explicit item code); `AIRCRAFT_FEE`/`SCHEDULING_FEE`/`ADMINISTRATIVE`/`CUSTOM → OTHER_REVENUE`.
4. Static `LineItemKind` fallback (legacy lines, no Revenue Item): `AIRCRAFT_RENTAL → AIRCRAFT_REVENUE`; `INSTRUCTOR_TIME → INSTRUCTOR_SERVICE_REVENUE`; `GROUND_INSTRUCTION → GROUND_INSTRUCTION_REVENUE`; `SIMULATOR_TIME → SIMULATOR_REVENUE`; `FUEL_SURCHARGE → FUEL_REVENUE`; `MEMBERSHIP_FEE → MEMBERSHIP_REVENUE`; `SUPPLY → TRAINING_MATERIAL_REVENUE`; `LATE_FEE`/`OTHER → OTHER_REVENUE`.
5. Discount lines allocate **negative** to their target line's resolved category (`discountAllocationMode = TARGET_CATEGORY` default) or proportionally (largest-remainder) under `PROPORTIONAL` — unchanged from doc 12.

The mapping is a pure, contract-tested catalog. It is versioned in code only — the resolved category is snapshotted onto the allocation row, so a future mapping change never rewrites history.

---

## 4. Two-stage allocation

### 4.1 Stage 1 — approval (everything the snapshot knows)

Unchanged from doc 12 §2.2, now with the widened category set. Inside the doc 03 approval transaction, the `APPROVAL` set is written: REVENUE dimension from the locked lines + TaxSnapshot; PROCEEDS dimension = `TAX` + `PLATFORM_FEE` (accrued from the snapshotted policy) + `SCHOOL_RETAINED_REVENUE` residual computed last (all rounding residue lands there). Both dimensions sum to the frozen invoice total.

**What Stage 1 deliberately does not contain: the processor fee.** At approval the charge has not happened; the actual Stripe fee is unknowable (rates differ by card brand/country/rail, and estimates in the books are lies waiting to be reconciled). The books never carry an estimated fee.

### 4.2 Stage 2 — settlement true-up (what only the provider knows)

When a payment settles, two things are learned:

| Fact | Source | When |
|---|---|---|
| The platform fee is **earned** (was: accrued) | Our own `PlatformFee` snapshot — the amount was always known; only its status changes | Settlement webhook transaction |
| The **actual processor fee** | The charge's Stripe balance transaction | Usually *after* the settlement webhook (the event payload carries a balance-transaction id, not the expanded fee — expanding requires a provider call, which never happens inside a transaction) |

The processor fee posts as a **`SETTLEMENT` true-up set** (new additive `AllocationEvent` value) plus a matching ledger journal, in its own transaction, when the actual fee is known:

- **Set amount = 0.** The customer's charge did not change; only the split of proceeds did. PROCEEDS rows: `PROCESSOR_FEE +fee`, `SCHOOL_RETAINED_REVENUE −fee`. REVENUE dimension: no rows.
- This requires one stated refinement of doc 12's V1 (an extension, not a weakening): *each dimension present in a set sums to the set amount; a dimension with **no rows** sums to zero and is valid only when the set amount is zero.* A zero-amount set is balanced by construction.
- **Never overwriting, always additional entries** (spec: "Do not overwrite a category total"): the approval set's `SCHOOL_RETAINED_REVENUE 480.20` row is immutable forever; the true-up appends `−14.80`. Every reported category total is `Σ` of signed immutable rows — there is no stored total anywhere to overwrite.

The same `SETTLEMENT` event covers **all provider-fee actuals**: per-charge processing fees and per-dispute fees (§6.5). `sourceType`/`sourceId` name the triggering record (`Payment`, `Dispute`).

### 4.3 Interaction with later events

Refund/adjustment/void/dispute sets are computed against the review's **net REVENUE categories** exactly as in doc 12 §2.2. `PROCESSOR_FEE` rows never participate in refund proportionality — Stripe does not return the original processing fee on refunds, so the true-up set stands untouched (the worked full-refund example in §6.4 shows the honest consequence: a fully refunded review leaves the school net-negative by exactly the processor fee).

---

## 5. Ledger mechanics finalized

### 5.1 Conventions (binding restatement)

- **Ledger:** direction + positive amount. Every journal (rows sharing `journalId`) satisfies Σ debits = Σ credits, one currency per journal, every `amount > 0`. Equivalent signed-sum rule: signing debits `+` and credits `−`, every journal sums to zero.
- **Allocations:** signed amounts; per set and per dimension, Σ = the set's event amount.
- Sole ledger writer: `src/lib/ledger.ts`, always inside the same `db.$transaction` as the state change it describes. Sole allocation writer: `src/lib/revenue-allocation.ts`, same rule. Both engines assert balance **before** insert; both are pure functions over typed inputs (DB-free contract tests per Part AC "Revenue allocation balancing").
- `effectiveAt` is the reporting bucket everywhere (allocations copy it in-transaction from the triggering journal — doc 13 §4.13, binding).

### 5.2 One additive ledger account

`LedgerAccount` gains **one** value (own migration before first writer):

| Account | Type | Normal balance | Meaning |
|---|---|---|---|
| `SETTLED_TO_BANK` | Asset (terminal) | Debit | Funds that left the provider balance for the school's bank account via a payout. Terminal in AeroOps' books — bank accounting is out of scope. |

Why it's needed: doc 12's provisional payout row balanced only because processor fees were still parked in `PAYMENT_CLEARING` at payout time. With fees now expensed per charge at settlement (§5.4), the payout journal needs an explicit destination to balance — and gains an exact invariant for free: **`PAYMENT_CLEARING` balance = settled-not-yet-paid-out funds, to the cent** (refined R4, §12).

No other ledger accounts are added. The finer REVENUE-dimension grain (ground/sim/membership/retail) intentionally does **not** mirror into `LedgerAccount`: `REVENUE_INSTRUCTION` continues to cover flight/ground/sim and `REVENUE_OTHER` covers membership/retail (doc 12's fixed-taxonomy principle) — allocations carry the reporting grain; `AccountingMapping` carries the export grain. Simpler-workflow choice: accountants get grain where they look for it (reports/exports), and the internal ledger stays small and testable.

### 5.3 Finalized posting matrix

Supersedes the two rows doc 12 marked "(Part 2)"; all other rows unchanged. Async hops marked ⇢.

| # | Event | Tx boundary | Debits | Credits |
|---|---|---|---|---|
| P1 | Revenue Review approved | approval tx (doc 03) | `ACCOUNTS_RECEIVABLE` total; `CONTRA_REVENUE_DISCOUNTS` discounts; `INSTRUCTOR_COMP_EXPENSE` comp | `REVENUE_*` gross by category; `TAX_PAYABLE`; `INSTRUCTOR_COMP_PAYABLE` comp |
| P2 | **Provider payment settled** (card or ACH `payment_intent.succeeded`) | webhook reduce tx | `PAYMENT_CLEARING` (amount − application fee); `PLATFORM_FEE_EXPENSE` (application fee) | `ACCOUNTS_RECEIVABLE` (amount) |
| P3 | ⇢ **Processor-fee actual recorded** (balance transaction fetched post-commit, or taken from payout composition — whichever arrives first) | own tx, guarded claim (§9 step 4) | `PROCESSOR_FEES_EXPENSE` (actual fee) | `PAYMENT_CLEARING` (actual fee) |
| P4 | Manual/offline payment recorded (cash/check) | recording tx | `CASH_ON_PREMISES`; `PLATFORM_FEE_EXPENSE` | `ACCOUNTS_RECEIVABLE`; `PLATFORM_FEE_PAYABLE` |
| P5 | Refund succeeded (incl. settled-ACH return) | webhook reduce tx (provider) / refund tx (credit destination) | `REVENUE_*`/`TAX_PAYABLE` reversal by category; `PAYMENT_CLEARING` (application fee returned, when fee reverses) | `PAYMENT_CLEARING` (refund amount); `PLATFORM_FEE_EXPENSE` (fee reversal) |
| P6 | Dispute **lost** | webhook reduce tx | `REVENUE_*`/`TAX_PAYABLE` reversal; `PAYMENT_CLEARING` (application fee returned, per policy) | `PAYMENT_CLEARING` (disputed amount); `PLATFORM_FEE_EXPENSE` (fee reversal) |
| P7 | ⇢ Dispute fee recorded | own tx, guarded claim | `PROCESSOR_FEES_EXPENSE` (dispute fee) | `PAYMENT_CLEARING` (dispute fee) |
| P8 | Payout paid (`payout.paid`) | webhook reduce tx | `SETTLED_TO_BANK` (payout amount) | `PAYMENT_CLEARING` (payout amount) |
| P9 | Void (pre-payment) / Write-off / Adjustment / Earning reversal | per doc 12 | unchanged | unchanged |

### 5.4 The two finalized rows — divergence recorded

Doc 12's provisional matrix posted `PLATFORM_FEE_PAYABLE` on every payment success and `PROCESSOR_FEES_EXPENSE` at payout time. With the Connect model finalized (Part O ADR: direct charges on the connected account, `application_fee_amount` deducted at source):

- **Provider-collected payments (P2):** the application fee never passes through the school's hands — it is deducted before the money reaches the school's Stripe balance. Posting a payable that is extinguished in the same instant would be fiction; the fee posts expense-direct and `PAYMENT_CLEARING` is booked net of it. `PLATFORM_FEE_PAYABLE` remains live **only for offline collections (P4)**, where AeroOps genuinely must collect its earned fee later (netting/invoicing — Part W doc).
- **Processor fees (P3) post per charge at settlement, not lumped at payout.** Balance-transaction data makes per-review attribution possible; per-charge posting makes the Revenue-by-* reports and the R4 invariant exact.

This supersedes two provisional rows of a Part 1 doc. Both were explicitly deferred to Part 2 in doc 12 ("(populated in Part 2)", "(Part 2)"), but because the `PLATFORM_FEE_PAYABLE`-on-settlement row was written without that marker, the divergence is recorded as **Open question 1** for the Part 1 refresh agent to align doc 12 §2.5 — this doc does not edit doc 12.

---

## 6. Worked postings — six scenarios, every entry, every group balanced

Shared fixture, review **RR-1042** (single org, USD): aircraft rental $300.00 · flight instruction $120.00 · ground instruction $40.00 · landing fee $10.00 · fuel surcharge $20.00 → subtotal **$490.00**; tax (TaxSnapshot) **$10.00**; total **$500.00**. Platform fee policy: 200 bps on `COLLECTED_PRETAX` → **$9.80**. Instructor compensation accrual: **$70.00**.

Approval (identical in every scenario) — journal **J1** + set **S1**:

| J1 `revenue_review.approved` | Debit | Credit |
|---|---|---|
| ACCOUNTS_RECEIVABLE | 500.00 | |
| INSTRUCTOR_COMP_EXPENSE | 70.00 | |
| REVENUE_AIRCRAFT | | 300.00 |
| REVENUE_INSTRUCTION | | 160.00 |
| REVENUE_AIRPORT_FEES | | 10.00 |
| REVENUE_FUEL | | 20.00 |
| TAX_PAYABLE | | 10.00 |
| INSTRUCTOR_COMP_PAYABLE | | 70.00 |
| **Check** | **570.00** | **570.00** ✓ |

| S1 — APPROVAL, amount +500.00 | REVENUE | PROCEEDS |
|---|---|---|
| AIRCRAFT_REVENUE | +300.00 | |
| INSTRUCTOR_SERVICE_REVENUE | +120.00 | |
| GROUND_INSTRUCTION_REVENUE | +40.00 | |
| AIRPORT_LANDING_FEES | +10.00 | |
| FUEL_REVENUE | +20.00 | |
| TAX | +10.00 | +10.00 |
| PLATFORM_FEE | | +9.80 |
| SCHOOL_RETAINED_REVENUE | | +480.20 |
| **Check (per dimension)** | **+500.00** ✓ | **+500.00** ✓ |

### 6.1 Card success (actual Stripe fee $14.80)

| J2 `payment.succeeded` (webhook tx) | Debit | Credit |
|---|---|---|
| PAYMENT_CLEARING | 490.20 | |
| PLATFORM_FEE_EXPENSE | 9.80 | |
| ACCOUNTS_RECEIVABLE | | 500.00 |
| **Check** | **500.00** | **500.00** ✓ |

Same tx: `PlatformFee` → `EARNED` (`earnedAt` stamped); review → `CARD_PAID`/`PAID` per D4.

⇢ async: balance transaction fetched → **J3** + set **S2** (own tx, guarded claim on `Payment.providerFeeRecordedAt IS NULL`):

| J3 `payment.fee_recorded` | Debit | Credit | | S2 — SETTLEMENT, amount 0.00 | PROCEEDS |
|---|---|---|---|---|---|
| PROCESSOR_FEES_EXPENSE | 14.80 | | | PROCESSOR_FEE | +14.80 |
| PAYMENT_CLEARING | | 14.80 | | SCHOOL_RETAINED_REVENUE | −14.80 |
| **Check** | **14.80** | **14.80** ✓ | | **Check** | **0.00** ✓ (REVENUE dim: no rows = 0 ✓) |

⇢ payout arrives ($475.40): **J8** debit `SETTLED_TO_BANK` 475.40 / credit `PAYMENT_CLEARING` 475.40 ✓. Clearing for this review: 490.20 − 14.80 − 475.40 = **0.00** ✓. School retained (Σ rows): 480.20 − 14.80 = **465.40** = 500 − 10 tax − 9.80 platform − 14.80 processor ✓.

### 6.2 ACH success (actual Stripe fee $4.00)

At initiation: **no journal, no set** — A/R stands, review shows *ACH Pending* (~4 business days; never treated as settled, Part AB). At `payment_intent.succeeded`:

- **J2′** identical to J2 (clearing 490.20 / fee expense 9.80 / A/R 500.00) ✓ — `PlatformFee` → `EARNED`, review → `PAID` (D4: ACH is paid only on settlement).
- ⇢ **J3′** processor 4.00 / clearing 4.00 ✓; **S2′** SETTLEMENT 0.00: `PROCESSOR_FEE +4.00`, `SCHOOL_RETAINED_REVENUE −4.00` ✓.
- School retained: 480.20 − 4.00 = **476.20**; expected payout 486.20 = clearing balance ✓. The card-vs-ACH fee difference ($10.80 on this review) is now a *fact in the books*, which is what makes the dashboard's card-vs-ACH economics tile honest.

### 6.3 Partial refund — $100.00, untargeted (proportional, largest-remainder), after 6.1

Proportions over net REVENUE: 300/120/40/10/20/10 per 500 → 60.00 / 24.00 / 8.00 / 2.00 / 4.00 / 2.00 (sums exactly; residue rule not needed here). Platform fee reverses proportionally (`refundReversesFee = true`): 9.80 × 100/500 = **$1.96**.

| S3 — REFUND, amount −100.00 | REVENUE | PROCEEDS |
|---|---|---|
| AIRCRAFT_REVENUE | −60.00 | |
| INSTRUCTOR_SERVICE_REVENUE | −24.00 | |
| GROUND_INSTRUCTION_REVENUE | −8.00 | |
| AIRPORT_LANDING_FEES | −2.00 | |
| FUEL_REVENUE | −4.00 | |
| TAX | −2.00 | −2.00 |
| PLATFORM_FEE | | −1.96 |
| SCHOOL_RETAINED_REVENUE | | −96.04 |
| **Check** | **−100.00** ✓ | **−100.00** ✓ |

| J5 `refund.succeeded` (webhook tx; reversal TaxSnapshot written same tx per doc 07) | Debit | Credit |
|---|---|---|
| REVENUE_AIRCRAFT | 60.00 | |
| REVENUE_INSTRUCTION | 32.00 | |
| REVENUE_AIRPORT_FEES | 2.00 | |
| REVENUE_FUEL | 4.00 | |
| TAX_PAYABLE | 2.00 | |
| PAYMENT_CLEARING (application fee returned) | 1.96 | |
| PAYMENT_CLEARING (refund out) | | 100.00 |
| PLATFORM_FEE_EXPENSE (fee reversal) | | 1.96 |
| **Check** | **101.96** | **101.96** ✓ |

`PlatformFee.reversedAmount = 1.96`, status `PARTIALLY_REVERSED`. No processor entry — Stripe keeps the original processing fee. Compensation impact: reversal *proposal* per `compensationRefundPolicy` (Part Y doc).

### 6.4 Full refund — $500.00 (fresh instance of 6.1)

**S3′** — REFUND, amount −500.00: full negative mirror of S1 (REVENUE: −300/−120/−40/−10/−20/−10; PROCEEDS: TAX −10.00, PLATFORM_FEE −9.80, SCHOOL_RETAINED_REVENUE −480.20). Both dimensions **−500.00** ✓.

| J5′ `refund.succeeded` | Debit | Credit |
|---|---|---|
| REVENUE_AIRCRAFT 300.00 · REVENUE_INSTRUCTION 160.00 · REVENUE_AIRPORT_FEES 10.00 · REVENUE_FUEL 20.00 · TAX_PAYABLE 10.00 | 500.00 | |
| PAYMENT_CLEARING (application fee returned) | 9.80 | |
| PAYMENT_CLEARING (refund out) | | 500.00 |
| PLATFORM_FEE_EXPENSE | | 9.80 |
| **Check** | **509.80** | **509.80** ✓ |

`PlatformFee` → `REVERSED`. Review → `REFUNDED`. **The S2 true-up set stands**: Σ `SCHOOL_RETAINED_REVENUE` = 480.20 − 14.80 − 480.20 = **−14.80** — the school's true cost of fully refunding a card payment is exactly the unreturned processor fee. The dashboard shows this instead of pretending refunds are free.

### 6.5 Lost dispute (fresh instance of 6.1; dispute fee $15.00)

Dispute opens → status/notification only, **no journal** (funds withheld by the provider are a reconciliation visibility, §14 / Open question 5). Dispute **lost** (webhook tx):

**S4** — DISPUTE (new additive `AllocationEvent` value), amount −500.00 — identical rows to S3′ (platform fee reversed per default policy, Open question 2). Both dimensions −500.00 ✓. **J6** — identical shape to J5′ (509.80 = 509.80 ✓), `event = "dispute.lost"`, `sourceType = "Dispute"`.

⇢ dispute fee actual: **J7** debit `PROCESSOR_FEES_EXPENSE` 15.00 / credit `PAYMENT_CLEARING` 15.00 ✓; **S5** — SETTLEMENT, amount 0.00: `PROCESSOR_FEE +15.00`, `SCHOOL_RETAINED_REVENUE −15.00` ✓ (`sourceType = "Dispute"`, guarded claim on `Dispute.disputeFeeRecordedAt IS NULL`).

Net school retained: 480.20 − 14.80 − 480.20 − 15.00 = **−29.80**. Review → `DISPUTED`. A lost dispute reverses revenue by category (a forced refund), not `BAD_DEBT_EXPENSE` — bad debt is reserved for write-offs of *uncollected* A/R; here money was collected and clawed back.

### 6.6 Platform-fee waiver month (Part W waiver model)

Waiver = an effective-dated `PlatformFeePolicy` version with `feePercentBps = 0`, `feeFlatAmount = 0` (platform-owned; never a special code path). Same review, approved inside the waiver window:

- **S1w** — APPROVAL +500.00: REVENUE identical to S1; PROCEEDS: `TAX +10.00`, `SCHOOL_RETAINED_REVENUE +490.00` — **no `PLATFORM_FEE` row** (zero-amount rows are never written). Both dimensions +500.00 ✓.
- `PlatformFee` row **is** still written (V7 uniqueness + audit visibility of the waiver): `amount 0.00`, policy version snapshotted, `ACCRUED → EARNED` at settlement as usual. It posts **no ledger lines** (`amount > 0` rule).
- **J2w**: debit `PAYMENT_CLEARING` 500.00 / credit `ACCOUNTS_RECEIVABLE` 500.00 ✓ (no fee lines).
- ⇢ **J3w**: processor 14.80 as usual; **S2w**: `PROCESSOR_FEE +14.80` / `SCHOOL_RETAINED_REVENUE −14.80` ✓.
- School retained: 490.00 − 14.80 = **475.20** = payout ✓. The Platform Fee Statement shows the review with fee $0.00 and the policy version that waived it — the waiver is a visible fact, not an absence.

---

## 7. School retained revenue — derivation rule

`SCHOOL_RETAINED_REVENUE` is **always a computed residual, never an input and never a stored total**:

1. Within each set that carries a PROCEEDS dimension with nonzero amount, it is computed **last**: `set amount − Σ(other PROCEEDS rows)`. All rounding residue from tax/fee math lands here (doc 12 V4) — never in tax, never in either fee, never charged to the customer.
2. Reported "school retained revenue" (dashboard tile, Revenue by Period, exports) = `Σ SCHOOL_RETAINED_REVENUE` rows over the window, bucketed by `effectiveAt`. There is no column, cache, or running total to overwrite — satisfying the spec's "Do not overwrite a category total" structurally.
3. Settlement/dispute-fee true-ups adjust it only by appending signed rows (§4.2). Consequently the figure has two honest readings the dashboard must distinguish: **retained (before processing costs)** = Σ over APPROVAL/ADJUSTMENT/REFUND/VOID/DISPUTE sets, and **retained (net)** = Σ over all sets including SETTLEMENT. The dashboard leads with net (30 owns presentation).

---

## 8. Reporting-dimension mapping (consumed by [30-revenue-dashboard.md](./30-revenue-dashboard.md))

Allocations deliberately carry **no** denormalized dimension columns (doc 13 binding shape). Dimensions resolve by bounded, indexed joins:

| Dimension | Resolution path | Notes |
|---|---|---|
| Aircraft | `RevenueAllocation.revenueReviewId → RevenueReview.aircraftId` | null for ground-only/manual reviews → "No aircraft" bucket |
| Instructor | `→ RevenueReview.instructorId`; compensation figures from `InstructorEarning.instructorId` | revenue-vs-compensation margin joins both, never mixes them |
| Location | `→ RevenueReview.locationId` | |
| Program | `→ RevenueReview → Dispatch → ScheduleEvent → lesson/syllabus`; fallback: student's active enrollment at `effectiveAt`; else "Unassigned" | never guessed; "Unassigned" is a visible bucket, not a silent drop |
| Airport | `→ RevenueReview.locationId → Location` airport identifier | per-visited-airport landing-fee detail (from `Dispatch.airportsVisited` / RETURN_CAPTURE lines) is deferred (§16) |
| Card vs ACH | settlement journals `sourceType = "Payment"` → `Payment.method`; processor-fee sets join the same way | approval-side figures have no rail; rail dimensions apply to collected money only |
| Category | `RevenueAllocation.category` directly (`[organizationId, category, effectiveAt]` index) | ground/sim split available from cutover forward; earlier rows report as `INSTRUCTOR_SERVICE_REVENUE`, labeled |
| Period | `effectiveAt` in org `timeZone` — every surface except Tax Collected (`TaxSnapshot.serviceDate`, doc 12) | |

All queries windowed and bounded; no unbounded `findMany` (doc 12 V13).

---

## 9. Sequences — transaction boundaries and async hops

**Card/ACH collection with fee true-up** (numbered; `[tx]` = one `db.$transaction`; ⇢ = async hop; no provider call ever inside a tx):

1. `[tx A — approval, doc 03]` guarded claim → freeze invoice → **S1 APPROVAL set + J1 approval journal + PlatformFee ACCRUED + InstructorEarning rows** written by the engines with pre-insert balance assertions. Post-commit: audit, events, payment-runner handoff.
2. ⇢ Payment runner creates the provider charge (idempotency key `sc_<id>_a<n>`, ADR-033). No local financial postings.
3. ⇢ Webhook `payment_intent.succeeded`: `[tx B1]` unique-insert `PaymentProviderEvent`. `[tx B2 — reduce]` guarded attempt claim → create `Payment` → **J2 settlement journal** → `PlatformFee → EARNED` (`earnedAt`) → review status → allocations: none (nothing about the split is new yet). Post-commit: receipts/notifications.
4. ⇢ Fee true-up (payment runner post-settlement step, and the bounded reconciliation sweep as backstop): fetch balance transaction (provider call, outside any tx, with timeout) → `[tx C]` **guarded claim** `updateMany Payment WHERE id AND providerFeeRecordedAt IS NULL` (count 0 → someone else recorded it; stop) → write `providerFeeAmount`/`providerBalanceTransactionId`/`providerFeeRecordedAt` → **J3 fee journal + S2 SETTLEMENT set** (`effectiveAt` = settlement journal's `effectiveAt`, so both stages bucket in the same period) → audit `revenue.provider_fee_recorded`.
   - Alternate source: if `payout.paid` composition arrives first, the payout matcher runs the identical claim — first writer wins, exactly once, structurally.
5. ⇢ Webhook `payout.paid`: `[tx D]` upsert `ProviderPayout` → **J8 payout journal** → matcher links balance transactions → any mismatch (incl. provider application fee ≠ local effective `PlatformFee`) opens `ReconciliationException` (`FEE_MISMATCH`/`AMOUNT_MISMATCH`).

**Refund / lost dispute:** the doc 08/Part V execution writes its set + journal inside the same webhook-reduce (provider destinations) or mutation (credit destination) transaction as the state change, riding that flow's idempotency (`Refund.adjustmentId @unique`; dispute status guarded claim). The dispute-fee true-up follows step 4's pattern against `Dispute.disputeFeeRecordedAt`.

---

## 10. Configuration surface

**No new org-level configuration.** Deliberate: allocation must be trustworthy by construction, not tunable into inconsistency. Existing knobs that apply here, unchanged (doc 12 §3 / doc 13 singletons): `discountAllocationMode`, `compensationApprovalMode`, `compensationRefundPolicy`, `reconciliationStalePaymentDays` (5), `reconciliationUnmatchedPayoutDays` (7), `defaultExportSystem`.

**Platform-level** (all `authorizePlatform`-only; Part W doc owns the models): `PlatformFeePolicy` versions including zero-fee waiver versions (§6.6); proposed **`feeReversesOnLostDispute Boolean @default(true)`** policy flag (Open question 2) alongside the existing `refundReversesFee`. The fee true-up staleness watch reuses `reconciliationStalePaymentDays` — no new knob.

---

## 11. Data model additions (Prisma-flavored; final call in [34-part2-database-additions.md](./34-part2-database-additions.md))

**Zero new models.** Additive enum values + guarded-claim columns on two existing Part 1 models only. Every new enum value ships in its own DDL migration before any writer (doc 14 rule).

```prisma
enum AllocationCategory {
  // ... existing 8 values (13 §4.13) unchanged ...
  GROUND_INSTRUCTION_REVENUE // NEW — REVENUE dim; forward-only split from INSTRUCTOR_SERVICE_REVENUE
  SIMULATOR_REVENUE          // NEW — REVENUE dim
  MEMBERSHIP_REVENUE         // NEW — REVENUE dim
  TRAINING_MATERIAL_REVENUE  // NEW — REVENUE dim
  MERCHANDISE_REVENUE        // NEW — REVENUE dim
  PROCESSOR_FEE              // NEW — PROCEEDS dim only; provider fee actuals (settlement true-up)
  REFUND_RESERVE             // NEW — PROCEEDS dim only; RESERVED, no writer in Part 2 (§3.1)
}

enum AllocationEvent {
  // ... existing 5 values unchanged ...
  SETTLEMENT // NEW — zero-amount provider-fee true-up sets (charge fee, dispute fee)
  DISPUTE    // NEW — lost-dispute clawback sets (distinct from REFUND for reporting)
}

enum LedgerAccount {
  // ... existing 16 values unchanged ...
  SETTLED_TO_BANK // NEW — asset; payout destination; terminal in AeroOps books (§5.2)
}

model Payment {
  // ... 13 §4.2.4 shape unchanged, plus:
  providerBalanceTransactionId String?   // opaque txn_... — safe reference only
  providerFeeAmount            Decimal?  @db.Decimal(12, 2) // actual processor fee
  providerFeeRecordedAt        DateTime? // guarded-claim token: exactly one fee journal/set per Payment
}

model Dispute {
  // ... Part 1 bound shape unchanged, plus:
  disputeFeeAmount     Decimal?  @db.Decimal(12, 2) // provider dispute fee actual
  disputeFeeRecordedAt DateTime? // guarded-claim token: exactly one dispute-fee journal/set per Dispute
}
```

Constraints/indexes: no changes — the Part 1 uniques (`@@unique([setId, dimension, category])`, journal/index set on `LedgerEntry`) already cover the new values. Org-snapshot capture/wipe/restore and both seed orgs already include these tables (doc 12 schema notes); seeds gain: one card-settled review with fee true-up set, one ACH-settled review, one lost-dispute review, one waiver-month review — `demo1234` logins intact.

---

## 12. Validation & business rules

Part X's ledger-style requirements as invariants, with enforcement:

| # | Requirement (spec) | Rule | Enforcement |
|---|---|---|---|
| L1 | Immutable | `RevenueAllocation` and `LedgerEntry` rows are insert-only; no update/delete API exists; corrections are new signed sets / reversing journals | Engines expose only `post()`; static source-scan test (dispatch-idempotency idiom) asserts no `ledgerEntry.update/delete`/`revenueAllocation.update/delete` call sites; append-only per doc 12 V2 |
| L2 | Balanced | Journals: Σ debits = Σ credits, amounts > 0. Sets: each dimension sums to the set amount; a dimension with no rows is valid only for zero-amount sets (§4.2) | Pre-insert assertions in both engines inside the tx; contract tests (Part AC "revenue allocation balancing"); continuous R1/R2 checks → `ReconciliationException` |
| L3 | Currency explicit | Every row carries ISO 4217 `Char(3)`; one currency per journal and per set, equal to the review's snapshotted currency; provider fee currency must match the payment currency | Engine assertion; mismatch aborts the tx (provider-side mismatch → `FEE_MISMATCH` exception, never a silent conversion) |
| L4 | Linked to invoice/payment/refund/dispute | Allocations carry `revenueReviewId` + `invoiceId` FKs (Restrict) + `sourceType`/`sourceId`; ledger rows carry `sourceType`/`sourceId` (`Payment`, `Refund`, `Dispute`, `PlatformFee`, `RevenueReview`, `ProviderPayout`) | FK Restrict per doc 13 §8; `[sourceType, sourceId]` index; reconciliation matcher joins on it |
| L5 | Reversible only via adjustment entries | Refund/dispute/void/adjustment events append signed reversal sets and reversing journals referencing their source; nothing is edited | Doc 08 adjustment umbrella is the only correction path; V10 caps (reversals never exceed what they reverse) |
| L6 | Organization scoped | `organizationId` + real relation + explicit `onDelete` on every row; org from session only | `tests/schema-governance.test.ts` auto-scan; `authorize()` on every route |
| L7 | Auditable | Every triggering mutation `recordAudit`s (`revenue.allocated`, `revenue.provider_fee_recorded`, fee/dispute transitions) with reconstruct-without-DB metadata; rows attribute via source provenance | Doc 12 §6 audit table + §13 additions; constitution tests |
| L8 | Reporting ready | `[organizationId, category, effectiveAt]`, `[organizationId, account, effectiveAt]` indexes; every surface buckets on `effectiveAt`; bounded windows | Doc 13 index set; performance gate |
| L9 | Fee actuals are never estimates | No processor-fee posting until the provider's balance-transaction fact is in hand; approval-stage books contain no fee estimate | Engine has no estimation input; fee journal requires `providerFeeAmount` from the claim tx |
| L10 | Exactly-once true-up | One SETTLEMENT set + one fee journal per `Payment` (and per `Dispute`) | Guarded `updateMany` claim on `providerFeeRecordedAt` / `disputeFeeRecordedAt` `IS NULL` (ADR-033 idiom) |
| L11 | Zero-amount rows never written | Waived fees, zero tax, empty categories produce no rows (their absence is the fact); `PlatformFee` row itself still records the waiver | Engine filters before insert; §6.6 |

**Reconciliation invariants** (extends doc 12 §2.6; violations open `ReconciliationException`):

- **R4 (refined, now exact):** `PAYMENT_CLEARING` balance = Σ settled provider payments (net of application fees) − recorded processor/dispute fees − provider refund/dispute outflows (net of returned application fees) − `SETTLED_TO_BANK` payouts — i.e. funds sitting in the provider balance, to the cent.
- **R8 (new):** every settled provider `Payment` has `providerFeeRecordedAt` within `reconciliationStalePaymentDays`; every lost `Dispute` has `disputeFeeRecordedAt` within the same window. Breach → `STALE_PENDING_PAYMENT`-family exception (kind reused; `details` names the fee gap).
- **R9 (new):** per settled payment, provider-reported application fee = local `PlatformFee` effective amount (`amount − reversedAmount`); mismatch → `FEE_MISMATCH`.
- R1–R3, R5–R7 unchanged (R2 restated per L2's zero-amount-set refinement).

---

## 13. RBAC, approvals & audit

- **No new permission keys.** Reuses Part 1's catalog: `billing.view` (dashboard/reports), `revenue.allocation_view` (Allocation section incl. platform fee), `revenue.reconciliation_manage` (exception queue, manual sweep trigger). Processor-fee figures are visible under `billing.view` — they are the school's own costs.
- **No human approval gates in this doc's flows**: allocation and ledger writes are consequences of already-approved/authorized events (approval tx, webhook settlements, permissioned refunds). No AI pathway writes any of these records (constitution rule 8).
- **Audit additions** (via `recordAudit`): `revenue.provider_fee_recorded` (payment or dispute; payload: source id, fee amount, balance-transaction ref, journal id). Existing `revenue.allocated` covers every set insert including SETTLEMENT/DISPUTE events. Platform-fee and reconciliation audit actions per doc 12 §6 unchanged.
- **Domain events:** none added. Fee recording is internal bookkeeping; external signals ride the existing `payment.succeeded`/`payment.failed`/refund/reconciliation events. (Avoids WEBHOOK_EVENTS growth without a consumer.)
- Students/payers never see allocations, the ledger, platform-fee terms, or processor fees (Part AB); instructors see only their own compensation. Read-only impersonation blocks the sweep/resolve mutations.

---

## 14. Failure modes & edge cases

| Case | Behavior |
|---|---|
| Balance-transaction fetch fails / times out | Payment stays settled and correct; fee true-up simply hasn't happened. Retried by the runner's post-settlement step and the bounded reconciliation sweep; R8 opens an exception if stale. Never synthesized, never estimated. |
| Webhook and payout race on the fee | Both paths run the same guarded claim; first writer wins; loser is a no-op (count 0). |
| Provider fee arrives with unexpected currency | No posting; `FEE_MISMATCH` exception with both values — single-currency org assumption is asserted, never coerced. |
| Zero-total review (doc 09) | `APPROVAL` set amount 0 with no rows (or discount rows netting to 0 across both dimensions); no settlement stage (no charge); `PlatformFee` amount 0. |
| Multiple partial refunds | Each refund computes proportions over the review's **remaining net** REVENUE categories (largest-remainder each time), so cumulative reversals can never exceed the original category amounts (V10). |
| Settled-ACH return (late R05/R10-class returns after `succeeded`) | Posted as a full-reversal **REFUND** set + P5 journal with `sourceType = "PaymentReturn"`; any provider return fee posts via the SETTLEMENT true-up path. Part T/V docs own detection. |
| Dispute opened (funds withheld by provider) | Status + notification only; no journal until resolution. Withheld funds appear as a payout-matching variance handled by the reconciliation matcher — Open question 5 covers whether a "funds withheld" ledger view is wanted later. |
| Dispute won | No allocation/ledger effect (money never left); dispute fee, if charged and not returned, posts via the true-up path. |
| Offline payment on a provider-charged review (or vice versa) | Doc 09's 409 guards prevent double collection; each collected payment posts its own P2/P4 journal against remaining A/R. |
| Legacy invoices (pre-Phase 8) | No allocations, no journals; reports label the pre-allocation era (doc 12 schema notes) — never backfilled silently (doc 12 Open Q6 stands). |
| Enum value ships before writer | By construction (own migration first); reports tolerate categories with zero rows. |

---

## 15. UX notes

- The Revenue Review's **"Where this money goes"** strip (doc 12 §7) gains one line after settlement: *"Card processing (Stripe): −$14.80"* — clearly separate from *"AeroOps fee: −$9.80"*. Before settlement it shows *"Card processing: pending settlement"* rather than a fake number. Never label the AeroOps fee as a Stripe fee or vice versa (Part W).
- "Your school keeps" always presents the **net** residual (Σ retained rows) with a tap-through to the set-by-set composition — every number links to its rows.
- Debits/credits remain accountant-only (Ledger detail view under the Revenue Dashboard, `billing.view`); dispatchers and instructors never see them.
- New enum values get `STATUS_TONE`/label entries where surfaced; category display names come from one code catalog (customer-facing: "Ground instruction", "Simulator", "Training materials", "Merchandise", "Membership", "Card/bank processing", "AeroOps fee", "Your school keeps").
- A fully-refunded review shows its honest economics (*"Net after refund: −$14.80 — card processing fees are not returned on refunds"*) — trust is built by not hiding costs.

---

## 16. Out of scope for Part 2 / deferred to Part 3+

| Item | Disposition |
|---|---|
| `REFUND_RESERVE` writer (org-configurable reserve carve-out) | Reserved enum value only; deferred pending real demand (Open question 3) |
| Per-visited-airport landing-fee reporting grain (beyond the review's location airport) | Part 3 (needs RETURN_CAPTURE line ↔ airport linkage in reports) |
| `WRITE_OFF` sets/postings going live | With doc 03's `WRITTEN_OFF` status decision (enum reserved, no writer in Parts 2–3) |
| CSV/QuickBooks export execution over these rows; `AccountingMapping` UI (incl. mapping the seven new category values) | Part 3 (doc 12 §2.7 shapes stand; new categories join `MappingSourceType.ALLOCATION_CATEGORY` sourceKeys) |
| Instructor payout execution; bank-side accounting past `SETTLED_TO_BANK` | Out of scope entirely (export is the boundary) |
| Cash-basis tax reporting; multi-currency; configurable internal chart of accounts | Per doc 12 §9, unchanged |
| Stripe Tax provider-computed tax in allocations | Part 3 (`TaxSnapshot.provider = STRIPE_TAX` reserved) |

Confirmations: this document is design only — nothing here deploys, calls Stripe, moves money, or sends email; Stripe test mode is the only sanctioned environment and is not exercised in this phase.

---

## 17. Open questions

1. **Doc 12 posting-matrix alignment (Part 1 refresh agent).** §5.4 finalizes provider-collected settlements as fee-deducted-at-source (no `PLATFORM_FEE_PAYABLE` leg; `PLATFORM_FEE_PAYABLE` remains for offline collections) and moves processor-fee expensing from payout time to per-charge settlement. Doc 12 §2.5's provisional matrix rows should be updated to match by the designated refresh agent — recorded here rather than silently diverged from.
2. **Platform-fee treatment on lost disputes** (commercial, product owner/CEO): proposed default `feeReversesOnLostDispute = true` (AeroOps earns nothing on clawed-back revenue, consistent with `refundReversesFee`). Confirm — this is a pricing-terms call, not a mechanics call.
3. **Refund reserve deferral**: confirm that `REFUND_RESERVE` ships as a reserved value with no writer in Part 2 (rationale §3.1 — AeroOps never custodies funds; a reserve is org bookkeeping policy).
4. **Ground/simulator split cutover**: confirm the forward-only mapping (pre-cutover allocation rows keep `INSTRUCTOR_SERVICE_REVENUE`; reports label the boundary). The alternative — an explicitly-approved deterministic backfill of historical sets — is safe but reopens doc 12 Open Q6.
5. **Dispute-open funds visibility**: is reconciliation-matcher visibility of provider-withheld dispute funds sufficient for pilot schools, or should a later phase add a "funds withheld" ledger presentation? (No schema impact either way today.)
6. *(Inherited, still open — doc 12 Q1/Q2)*: whether the platform fee applies to offline collections, and whether `COLLECTED_PRETAX` should also exclude pass-through airport fees — both change `PlatformFee` inputs, not this doc's mechanics.
