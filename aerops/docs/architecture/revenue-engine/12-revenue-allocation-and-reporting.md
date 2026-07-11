# Revenue Allocation, Instructor Earnings, Platform Fee, Reconciliation & Reporting

> **Status:** Proposed — Phase 8 Part 1 · **Date:** 2026-07-10 · **Lead roles:** SaaS Revenue Operations Architect; Aviation Accounting Specialist; Financial Systems Architect · **Part of:** Revenue Engine design set ([README](./README.md))

---

## 1. Purpose & scope

This document designs the back half of the Revenue Engine mission workflow — everything that happens **after** a Revenue Review is approved and payment collected:

- The school receives its proceeds → **RevenueAllocation** (customer-facing: Revenue Allocation)
- AeroOps earns its platform fee → **PlatformFee** + **PlatformFeePolicy**
- Instructor compensation is recorded → **InstructorEarning** (customer-facing: Instructor Compensation)
- Financial records are reconciled → **LedgerEntry** (append-only spine) + **ProviderPayout** + **ReconciliationException**
- Reports and exports are updated → **Revenue Dashboard**, **Revenue Report** definitions, **FinancialExportJob** + **AccountingMapping** (customer-facing: Financial Export)

It also owns the **Allocation section of Part B** of the Phase 8 spec: how one approved Revenue Review's total is split into aircraft revenue, instructor-service revenue, airport/landing fees, fuel revenue, tax, platform fee, school retained revenue, and other — with the enforced invariant that the allocation always sums to the invoice total.

**Not in this document:** the Revenue Review state machine and approval transaction (Revenue Review lifecycle doc, doc 03), instructor rate/compensation *profiles* and time entry (doc 04), aircraft pricing profiles (doc 05), Revenue Item catalog (doc 06), tax rules and TaxSnapshot (doc 07), adjustments/refunds/discount mechanics (doc 08), payment methods/timing/PaymentAttempt/PaymentTransaction (doc 09), responsible payers (doc 11), checkout restrictions (doc 10). Final, binding column types, precisions, and index DDL are arbitrated by [13-database-model.md](./13-database-model.md). This document defines *what* those records mean, *when* they are created, and *how* they stay consistent.

**Design constraints honored throughout** (see the audits and governance library):

- Money is Prisma `Decimal`, never float. New money columns here are `Decimal(12,2)` plus an explicit ISO 4217 `currency` column (doc 13 makes the binding precision call).
- Approved financial records are immutable point-in-time facts — an explicit carve-out from the "computed values are derived at read time" rule (DATABASE_STANDARDS.md). Changing a rate or policy tomorrow never changes yesterday's allocation. Corrections are new signed records, never updates.
- Everything is tenant-scoped from the session, authorized via `authorize()`, audited via `recordAudit`, evented via `emitDomainEvent`, additive-only in migration terms.
- No Stripe or other external call ever runs inside a database transaction (ADR-011). Part 1 designs; Part 2 implements payment movement; Part 3 implements accounting sync.
- Tenant operations billing and AeroOps subscription billing remain **two distinct money systems** (ARCHITECTURE.md §13). The platform fee is the one deliberate bridge between them and is designed here so the boundary stays explicit: the fee is a *record in the tenant's books* (an expense/payable line the org can see) whose collection mechanics belong to AeroOps' own system in Part 2.

---

## 2. How it works — workflows and state machines

### 2.1 The allocation model: two dimensions, always balanced

Every approved Revenue Review's money is described twice, in the same table, from two angles:

| Dimension | Question it answers | Categories | Invariant |
|---|---|---|---|
| `REVENUE` | *What was this money charged for?* | `AIRCRAFT_REVENUE`, `INSTRUCTOR_SERVICE_REVENUE`, `AIRPORT_LANDING_FEES`, `FUEL_REVENUE`, `TAX`, `OTHER_REVENUE` | sums to the event amount |
| `PROCEEDS` | *Where does this money go?* | `PLATFORM_FEE`, `TAX`, `SCHOOL_RETAINED_REVENUE` | sums to the event amount |

Both dimensions independently sum to the same number: the approved invoice snapshot total (at approval), or the signed delta of a later event (refund, adjustment, void, write-off). This covers all eight Part B allocation categories in one enum, without double-counting: `TAX` appears in both dimensions because tax is a pass-through in both views; `PLATFORM_FEE` and `SCHOOL_RETAINED_REVENUE` are proceeds categories, not charge categories.

**Instructor compensation is deliberately *not* an allocation category.** It is a cost-side record (`InstructorEarning`) shown in the Revenue Review's Allocation section for context, but it is paid out of `SCHOOL_RETAINED_REVENUE` and does not slice the customer's invoice total (spec principle 6: billing and compensation are separate systems).

### 2.2 Allocation sets: one balanced set per financial event

`RevenueAllocation` rows are grouped into **sets** (`setId`). Each set is produced by exactly one financial event and is balanced at insert time:

| Event (`AllocationEvent`) | Trigger | Set amount | Sign |
|---|---|---|---|
| `APPROVAL` | Revenue Review approved & invoice locked (doc 03) | invoice snapshot total | positive |
| `ADJUSTMENT` | Post-approval adjustment record applied (doc 08) | adjustment delta | signed |
| `REFUND` | Refund issued (doc 08 / doc 09) | refund amount | negative |
| `VOID` | Approved review voided before payment | invoice snapshot total | negative (full reversal) |
| `WRITE_OFF` | Review written off (status supported later) | outstanding balance | negative |

Invariants (engine-enforced, see §5):

1. Within a set: `sum(rows where dimension = REVENUE) == sum(rows where dimension = PROCEEDS) == set amount`.
2. Across all sets of a review: the running sum per dimension always equals the invoice's **net** financial value (total − refunds ± adjustments − write-offs).
3. Rows are append-only. There is no update or delete path; reversal sets carry negative amounts and reference their source event.

**How the `APPROVAL` set is computed** (inside the approval transaction defined in doc 03):

- `REVENUE` dimension: each locked `InvoiceLine` resolves to a category — legacy `LineItemKind` values map statically (`AIRCRAFT_RENTAL → AIRCRAFT_REVENUE`; `INSTRUCTOR_TIME`/`GROUND_INSTRUCTION`/`SIMULATOR_TIME → INSTRUCTOR_SERVICE_REVENUE`; `FUEL_SURCHARGE → FUEL_REVENUE`; the rest → `OTHER_REVENUE`); Revenue Items carry their own default allocation category (doc 06, "default accounting category"); airport/landing/ramp/parking fee items map to `AIRPORT_LANDING_FEES`. Discount lines allocate **negative** to the category of the item they discount (`discountAllocationMode` default), or to `OTHER_REVENUE` when unattributed. `TAX` comes from the review's TaxSnapshot (doc 07).
- `PROCEEDS` dimension: `TAX` (same amount as the REVENUE-dimension tax), `PLATFORM_FEE` (per §2.3), `SCHOOL_RETAINED_REVENUE` = set amount − tax − platform fee. Computed last, so **every rounding residue lands in school retained revenue** — never in tax, never in the platform fee, never charged to the customer.

**How `ADJUSTMENT` sets are computed** (an `APPLIED` post-approval charge-side adjustment, doc 08 §3.3): the REVENUE dimension mirrors the adjustment's signed lines by category, plus the snapshotted-version tax delta (doc 08). The PROCEEDS dimension carries `TAX` = that tax delta, `PLATFORM_FEE` = the **signed platform-fee delta** recomputed on the adjusted base under the snapshotted policy version (§2.3), and `SCHOOL_RETAINED_REVENUE` = the remainder — computed last, absorbing rounding residue exactly as in the APPROVAL set.

**How `REFUND` sets are computed:** when a refund targets specific lines (doc 08), the REVENUE reversal mirrors those lines' categories; an untargeted refund reverses proportionally across the review's net REVENUE categories using the **largest-remainder method** so cents always reconcile. The PROCEEDS reversal reduces tax proportionally to refunded taxable amounts, reverses platform fee per the platform fee refund policy (§2.3), and puts the remainder against school retained revenue.

### 2.3 PlatformFee — AeroOps' earned fee per paid review

The platform fee is what AeroOps earns on tenant revenue collected through the Revenue Engine. Part 1 designs the **computation and accrual**; the actual money movement (Stripe Connect application fees / destination charges) is finalized in Part 2.

- **Policy** lives in `PlatformFeePolicy` — **platform-owned data, never org-editable** (it is AeroOps' pricing). Resolution order: per-org override → per-plan policy → global default. Policies are effective-dated and versioned; changing a policy never alters already-approved reviews.
- **Basis:** `feePercentBps` (basis points, integer — no float percentages) applied to a configured base (`COLLECTED_PRETAX` default: invoice total minus tax) plus optional `feeFlatAmount`, with optional min/max clamps. Basis, base amount, and resolved policy version are snapshotted onto the `PlatformFee` row at approval.
- **Lifecycle:**

```
                approval                     payment settles
  (policy) ───► ACCRUED ────────────────────► EARNED ──► PARTIALLY_REVERSED ──► REVERSED
                   │                                          (refunds, signed reversedAmount)
                   └──► VOIDED  (review voided / written off before collection)
```

- The fee **accrues at approval** (it appears in the APPROVAL allocation set's PROCEEDS dimension so the school sees exactly what it will net) but is **earned only when payment actually collects** — "per paid review". Ledger entries for the fee post at payment settlement, not approval (§2.5). A review that is voided or written off voids its fee: AeroOps earns nothing on uncollected revenue.
- **Post-approval charge-side adjustments re-base the fee.** When an `APPLIED` post-approval charge-side adjustment (doc 08 §3.3 — discounts, waivers, corrections before collection; upward corrections any time) changes what the customer will actually pay, the engine recomputes the fee on the adjusted base under the **snapshotted policy version** — same `feePercentBps`, `feeFlatAmount`, `feeBase`, min/max clamps; never a re-resolution of current policy — and writes the signed difference into `reversedAmount` (cumulative, signed: downward adjustments increase it, upward corrections decrease it; effective fee = `amount` − `reversedAmount`, engine-guarded to stay ≥ 0 and ≤ the clamped recompute on the net base). A pre-collection reduction therefore reduces the fee **before** it is ever marked `EARNED` — the fee is always computed on what actually collects, never on the approval-time base alone, preserving "AeroOps earns nothing on uncollected revenue". For an upward correction on a Paid review, the incremental fee follows the delta's own collection (earned only when the delta collects). The same signed fee delta is the `PLATFORM_FEE` component of the ADJUSTMENT allocation set's PROCEEDS dimension (§2.2); doc 08 §3.3's matrix mirrors this rule.
- On refund, the fee reverses proportionally by default (mirroring Stripe's application-fee refund behavior); whether AeroOps keeps its fee on refunds is a platform-level policy flag (open question §10).
- Offline collections (cash/check recorded manually) still mark the fee `EARNED` — collection *mechanics* differ (there is no Connect charge to deduct from; settlement is netted or invoiced platform-side in Part 2), but the accrual record is identical, keeping tenant books consistent regardless of payment rail.

### 2.4 InstructorEarning — Instructor Compensation records

Created at Revenue Review approval, inside the approval transaction, from the **compensation rates** resolved and snapshotted per doc 04 — never inferred from the customer-facing instructor charge unless the org explicitly configured that linkage (spec principle 6).

- One row per (instructor time entry × time category) on the approved review: hours, compensation rate snapshot, rate-profile version reference, employment/contractor classification snapshot, amount = hours × rate (rounded half-up to cents), currency.
- **Status flow:**

```
  PENDING ──► APPROVED ──► EXPORTED          (payout execution is out of scope for Part 1)
     │            │
     └────────────┴──► REVERSED   (original row terminal-marked; reversal is a NEW negative row)
```

- `compensationApprovalMode` (org config, §3) decides whether rows are born `APPROVED` (default — zero-setup orgs shouldn't need a second finance step) or born `PENDING` awaiting a separate compensation approval by a holder of `revenue.compensation_approve`.
- `EXPORTED` is set atomically by a `FinancialExportJob` compensation run (§2.7). Exported rows are never un-exported; a correction after export is a new signed row that flows through the next export.
- **Reversal on refund:** when a refund or void reverses `INSTRUCTOR_SERVICE_REVENUE`, the engine *proposes* an earning reversal. Default policy `REQUIRE_APPROVAL`: the instructor did the work even if the customer was refunded, so clawback is a human decision. `AUTO_REVERSE` and `NEVER` are configurable. A **void** (the review should never have existed) always auto-reverses. A reversal is a new row with negative `amount` and `reversesEarningId` pointing at the original; if the original was already `EXPORTED`, the negative row flows `PENDING → APPROVED → EXPORTED` so the next compensation export nets it out — history is never rewritten.
- Contractor support (spec Part E): the classification snapshot plus hours/category/amount per row is exactly the contractor record set the spec requires (flight/ground/other hours, compensation earned, adjustments, approval status, export status, associated lesson/Revenue Review/organization). The UI carries the required disclaimer: **AeroOps does not determine legal worker classification.**

### 2.5 LedgerEntry — the append-only reconciliation spine

Every financial event emits a **balanced journal**: a group of `LedgerEntry` rows sharing a `journalId` where debits equal credits. Ledger rows are append-only (the `InventoryMovement` idiom, upgraded to double-entry): no updates, no deletes; corrections are reversing journals. The only writer is the posting engine `src/lib/ledger.ts` (Part 2), always inside the same `db.$transaction` as the state change it describes.

**Account taxonomy** (fixed internal enum — org-facing chart-of-accounts flexibility happens at export time via `AccountingMapping`, §2.7, not by making the internal ledger configurable):

| `LedgerAccount` | Type | Normal balance | Meaning |
|---|---|---|---|
| `ACCOUNTS_RECEIVABLE` | Asset | Debit | Approved, not yet collected |
| `PAYMENT_CLEARING` | Asset | Debit | Collected by provider, not yet paid out to the school |
| `CASH_ON_PREMISES` | Asset | Debit | Manual cash/check collections |
| `REVENUE_AIRCRAFT` | Revenue | Credit | Aircraft rental revenue |
| `REVENUE_INSTRUCTION` | Revenue | Credit | Instructor-service revenue (flight/ground/sim) |
| `REVENUE_AIRPORT_FEES` | Revenue | Credit | Airport/landing/ramp/parking fees |
| `REVENUE_FUEL` | Revenue | Credit | Fuel surcharges / fuel revenue |
| `REVENUE_OTHER` | Revenue | Credit | Everything else (supplies, membership, custom items) |
| `CONTRA_REVENUE_DISCOUNTS` | Contra-revenue | Debit | Discounts, credits, waived fees |
| `TAX_PAYABLE` | Liability | Credit | Tax collected, owed to a jurisdiction |
| `PLATFORM_FEE_EXPENSE` | Expense | Debit | AeroOps fee as a school expense |
| `PLATFORM_FEE_PAYABLE` | Liability | Credit | Fee earned by AeroOps, not yet settled |
| `INSTRUCTOR_COMP_EXPENSE` | Expense | Debit | Compensation accrued to instructors |
| `INSTRUCTOR_COMP_PAYABLE` | Liability | Credit | Compensation owed, not yet paid/exported externally |
| `PROCESSOR_FEES_EXPENSE` | Expense | Debit | Stripe processing fees (populated in Part 2) |
| `BAD_DEBT_EXPENSE` | Expense | Debit | Write-offs |

**Posting matrix** (the canonical event → journal mapping; doc 03/08/09 own *when* these events fire):

| Event | Debit | Credit |
|---|---|---|
| Revenue Review approved | `ACCOUNTS_RECEIVABLE` (total); `CONTRA_REVENUE_DISCOUNTS` (discount total); `INSTRUCTOR_COMP_EXPENSE` (comp accrual) | `REVENUE_*` per category (gross); `TAX_PAYABLE` (tax); `INSTRUCTOR_COMP_PAYABLE` (comp accrual) |
| Payment succeeded (card/ACH settled) | `PAYMENT_CLEARING` (amount); `PLATFORM_FEE_EXPENSE` (fee earned) | `ACCOUNTS_RECEIVABLE` (amount); `PLATFORM_FEE_PAYABLE` (fee earned) |
| Manual payment recorded (cash/check) | `CASH_ON_PREMISES`; `PLATFORM_FEE_EXPENSE` | `ACCOUNTS_RECEIVABLE`; `PLATFORM_FEE_PAYABLE` |
| Refund issued | `REVENUE_*` / `TAX_PAYABLE` (reversal); `PLATFORM_FEE_PAYABLE` (fee reversal) | `PAYMENT_CLEARING` (refund amount); `PLATFORM_FEE_EXPENSE` (fee reversal) |
| Adjustment (post-approval) | signed delta between `ACCOUNTS_RECEIVABLE` and `REVENUE_*`/`TAX_PAYABLE` | — |
| Void (pre-payment) | `REVENUE_*`, `TAX_PAYABLE` | `ACCOUNTS_RECEIVABLE` |
| Write-off | `BAD_DEBT_EXPENSE` | `ACCOUNTS_RECEIVABLE` |
| Payout paid (Part 2) | `PROCESSOR_FEES_EXPENSE`; (bank settlement out of scope) | `PAYMENT_CLEARING` |
| Earning reversed | `INSTRUCTOR_COMP_PAYABLE` | `INSTRUCTOR_COMP_EXPENSE` |

Every journal carries `sourceType`/`sourceId` provenance (e.g. `RevenueReview`, `PaymentTransaction`, `Refund`, `PlatformFee`, `InstructorEarning`) so any report figure traces to rows — the Financial Systems Reviewer gate requires that a report's numbers be traceable, and the ledger is how.

### 2.6 Reconciliation

Three layers, from always-on to Part 2:

1. **Structural invariants, checked continuously** (verification engine, runnable on demand from the Revenue Dashboard and via a bounded platform-authorized tick — the simulation-tick idiom — until a real queue lands):
   - R1: every `journalId` balances (Σ debits = Σ credits).
   - R2: per review, net REVENUE allocations == net PROCEEDS allocations == the invoice's net snapshot value.
   - R3: `ACCOUNTS_RECEIVABLE` ledger balance == Σ open invoice balances (from snapshot totals minus payments).
   - R4: `PAYMENT_CLEARING` balance == Σ succeeded-but-not-paid-out PaymentTransactions (meaningful from Part 2).
   - R5: `PLATFORM_FEE_PAYABLE` balance == Σ earned-not-settled PlatformFee amounts.
   - R6: `INSTRUCTOR_COMP_PAYABLE` balance == Σ approved, non-reversed InstructorEarning amounts (net of reversal rows).
   - R7: per period, Σ APPROVAL sets + Σ signed ADJUSTMENT/VOID/WRITE_OFF sets − A/R-clearing collections == Δ `ACCOUNTS_RECEIVABLE` — the reporting footing identity (§2.8): billed + adjustments − collected = Δ outstanding.
   Any violation opens a `ReconciliationException` (`UNBALANCED_JOURNAL`, `ALLOCATION_MISMATCH`, …). Violations should be impossible by construction; the checker exists because "impossible" is not a control.
2. **Provider payout matching (designed now, live in Part 2):** each Stripe `payout.paid` event (arriving through the idempotent inbound webhook table, doc 09 / PRODUCTION.md §13.2) creates a `ProviderPayout` row with the provider's balance-transaction composition retained in `raw`. The matcher links every provider balance transaction → local `PaymentTransaction`/`Refund` → its ledger journal → its Invoice/Revenue Review. Anything unmatched, and any amount or fee mismatch, opens a `ReconciliationException` (`MISSING_LOCAL_TRANSACTION`, `MISSING_PROVIDER_TRANSACTION`, `AMOUNT_MISMATCH`, `FEE_MISMATCH`). A payout whose every transaction matches is marked `RECONCILED`.
3. **Staleness watches:** payments `PROCESSING`/ACH-pending beyond a configured threshold, and succeeded payments absent from any payout after N days, open `STALE_PENDING_PAYMENT` exceptions.

**Exception workflow:** `OPEN → RESOLVED | IGNORED`. Resolution requires `revenue.reconciliation_manage`, a required resolution note, and is audited with before/after. The **unmatched items report** (§2.8) is simply the exception queue filtered and grouped — no separate mechanism.

### 2.7 Financial Exports — FinancialExportJob + AccountingMapping (Part 3 seam)

Design level only in Part 1; CSV generation lands in Part 3 (QuickBooks Online API sync later still).

- **FinancialExportJob** is the org-scoped job record (the `ImportJob` idiom in reverse): kind, period, filters, status `PENDING → RUNNING → COMPLETED | COMPLETED_WITH_ERRORS | FAILED`, per-row error reporting (nothing fails silently), a manifest of exported record ids, a checksum, and a file reference stored through the existing storage adapter as a `Document`. Export kinds:

| Kind | Content shape |
|---|---|
| `REVENUE_CSV` | One row per allocation: date, review #, invoice #, dimension, category, amount, currency, aircraft, instructor, program, location |
| `LEDGER_CSV` / `QUICKBOOKS_CSV` | Journal-style rows: date, journal #, mapped external account, debit, credit, memo, class, name — external account/class resolved through AccountingMapping |
| `INSTRUCTOR_COMPENSATION_CSV` | One row per earning: instructor, classification, category, hours, rate, amount, review #, status — the contractor-payment handoff |
| `TAX_CSV` | Tax collected by jurisdiction/rule version (from TaxSnapshot + TAX allocations) |

- Compensation export runs mark included `InstructorEarning` rows `EXPORTED` in the **same transaction** that finalizes the manifest — a crashed export never half-marks rows.
- Exports are read-only over financial records except for that export-status transition. Re-running a period is safe: already-`EXPORTED` earnings are excluded (or explicitly included as a signed correction re-export), and revenue/ledger exports are pure reads keyed by the immutable rows.
- **AccountingMapping** translates the internal taxonomy to the org's external chart of accounts: `(organizationId, externalSystem, sourceType, sourceKey) → externalAccount/externalClass`. Source types: allocation category, ledger account, Revenue Item, tax code, payment method. AeroOps ships sensible QuickBooks-shaped defaults per category; orgs remap freely without touching the internal ledger. This is deliberately where per-org accounting flexibility lives — the internal `LedgerAccount` enum stays fixed and testable.
- **An unmapped `sourceKey` is never a silent blank.** Export mapping resolves in a fixed fallback order: exact `REVENUE_ITEM` mapping → the mapping for the item's allocation category / the row's ledger account → the shipped QuickBooks-shaped default for that category/account. A key that still resolves to nothing produces a per-row error on the `FinancialExportJob` (`rowErrors`, job status `COMPLETED_WITH_ERRORS`) identifying the key and the affected rows, and the export UI runs a pre-export "unmapped keys" preview over the selected period so the org can fix its `AccountingMapping` before the job is created.

### 2.8 Revenue Dashboard and Revenue Reports

All reporting reads **snapshotted records only** — `RevenueAllocation`, `LedgerEntry`, `InstructorEarning`, `PlatformFee`, invoice snapshot totals. Nothing recomputes money from *current* rates. This replaces the existing math in `src/app/(app)/reports/page.tsx` and `src/app/(app)/executive/page.tsx`, which today multiply flight time by the aircraft's current `hourlyRateWet` — historical revenue silently changes when a rate changes, the exact violation of spec principle 5 this design removes.

**Revenue Dashboard** (customer-facing landing surface of the Revenue Engine, gated by `billing.view`):

| Tile / queue | Source |
|---|---|
| Collected today / MTD | `PAYMENT_CLEARING` + `CASH_ON_PREMISES` postings by `effectiveAt` |
| Billed (approved) MTD | APPROVAL allocation sets by period |
| Adjustments MTD | ADJUSTMENT + VOID + WRITE_OFF allocation sets by period, signed |
| Outstanding (Amount Due) | `ACCOUNTS_RECEIVABLE` ledger balance, with aging buckets |
| Awaiting review / awaiting payment / failed payments | Revenue Review status counts (doc 03) |
| Instructor Compensation accrued / pending approval | InstructorEarning by status |
| Platform fees this period | PlatformFee `EARNED` by period (org-visible transparency) |
| Reconciliation exceptions | `ReconciliationException` where status `OPEN` |

**Revenue Report** definitions (parameterized, code-defined; a saved custom report builder is deferred). Dimensions resolve by joining allocations → Revenue Review → its aircraft / instructor / program / location; periods bucket by `effectiveAt` in the organization's `timeZone`:

| Report | Grain | Key figures |
|---|---|---|
| Revenue by Aircraft | aircraft × period | billed, collected, refunded, billed hours, effective $/hr |
| Revenue by Instructor | instructor × period | instructor-service revenue billed vs compensation accrued → margin per instructor |
| Revenue by Program | program × period | billed, collected, discounts |
| Revenue by Location | location × period | billed, collected, tax, fees |
| Revenue by Period | day/week/month | billed, adjustments (signed, incl. voids/write-offs), collected, refunds, platform fee, net to school |
| A/R Aging | payer/student × bucket | outstanding by 0–30/31–60/61–90/90+ |
| Tax Collected | jurisdiction × period | taxable base, tax amount, rule version |
| Platform Fee Statement | period | accrued, earned, reversed — the org's view of AeroOps' fee |
| Unmatched Items (reconciliation) | exception kind | open exceptions with provenance links |
| Payout Reconciliation | provider payout × period | payout gross/fees/net, per-transaction composition with provenance links, period roll-up to `PAYMENT_CLEARING` |
| Contractor Compensation (calendar year) | contractor-classified instructor × calendar year | hours and compensation by category, reversals netted, export status — 1099 preparation |

**Report semantics** (pinned here so every figure foots):

- **Footing identity (verified continuously as R7, §2.6):** for any period, `Billed + Adjustments − Collected = Δ Outstanding` — where *Billed* is the APPROVAL allocation sets, *Adjustments* is the signed sum of ADJUSTMENT, VOID, and WRITE_OFF sets, *Collected* is the A/R-clearing collections (`PAYMENT_CLEARING` + `CASH_ON_PREMISES` debits against `ACCOUNTS_RECEIVABLE`), and *Outstanding* is the `ACCOUNTS_RECEIVABLE` balance. Refunds deliberately do not enter this identity: a refund reverses revenue against `PAYMENT_CLEARING` (§2.5) and never reopens A/R, so it foots inside net-to-school instead. The dashboard shows all four figures so the identity can be checked by eye.
- **Tax Collected is accrual-basis**, bucketed on `TaxSnapshot.serviceDate` (doc 07) — the one report that does not bucket on `effectiveAt`. Corrections (reversal TaxSnapshots from adjustments and refunds, docs 07/08) present as signed correction lines in the current period, each labeled with the original service period it corrects — a filed period is never silently restated. Cash-basis tax reporting is an explicit non-goal for Part 1 (§9).
- **Payout Reconciliation** (shape designed now; data live when `ProviderPayout` populates in Part 2): one section per `ProviderPayout` — gross → processor fees → net — then every composed provider balance transaction linked through the §2.6 matcher to its `PaymentTransaction`/`Refund`, its Invoice, its Revenue Review, and its `PlatformFee`, with any open `ReconciliationException` shown inline. The period roll-up of payout nets foots to the `PAYMENT_CLEARING` movement for the period, so tying a bank deposit to its payments, invoices, processor fees, and platform fees never requires the exception queue or raw provider JSON.
- **Contractor Compensation (calendar year)** totals hours and compensation per contractor-classified instructor per calendar year (org `timeZone`), reversals netted, export status shown — the figures a school needs to prepare 1099s. Part 1 totals are accruals (approved/exported earnings): `PAID` is deliberately absent from `InstructorEarningStatus` (§4), and an open decision in [16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md) covers an externally-paid marker (or activating the reserved `PAID` status) so annual totals can reflect payments actually made rather than accruals.

All report queries are bounded and windowed (no unbounded `findMany`), backed by the org-leading indexes in §4. CSV export of any report goes through `reports.export` today and `FinancialExportJob` once Part 3 lands.

---

## 3. Configuration surface

Org-level options (strong defaults; zero-setup orgs get correct behavior). These fields live on the shared org-level Revenue Engine configuration record proposed in the payment-timing/configuration design (doc 09); [13-database-model.md](./13-database-model.md) arbitrates the final home. Per house style this is typed columns / a dedicated config table — never a settings JSON blob.

| Option | Values | Default | Notes |
|---|---|---|---|
| `discountAllocationMode` | `TARGET_CATEGORY` \| `PROPORTIONAL` | `TARGET_CATEGORY` | Where discount amounts allocate in the REVENUE dimension |
| `compensationApprovalMode` | `AUTO_ON_REVIEW_APPROVAL` \| `SEPARATE_APPROVAL` | `AUTO_ON_REVIEW_APPROVAL` | Whether InstructorEarning rows are born APPROVED or PENDING |
| `compensationRefundPolicy` | `REQUIRE_APPROVAL` \| `AUTO_REVERSE` \| `NEVER` | `REQUIRE_APPROVAL` | Earning reversal behavior when a refund touches instructor-service revenue (voids always auto-reverse) |
| `reconciliationStalePaymentDays` | int | `5` | Days a processing/pending payment may sit before a `STALE_PENDING_PAYMENT` exception opens |
| `reconciliationUnmatchedPayoutDays` | int | `7` | Days a succeeded payment may be absent from payouts (Part 2) before an exception opens |
| `defaultExportSystem` | `quickbooks` \| `generic_csv` | `generic_csv` | Pre-selects AccountingMapping target and export format |

Platform-owned (NOT org-editable — AeroOps pricing, managed via `authorizePlatform` surfaces only):

| Option | Values | Default | Notes |
|---|---|---|---|
| `PlatformFeePolicy.feePercentBps` | int (basis points) | `0` until the commercial decision (§10) | Percent component of the fee |
| `PlatformFeePolicy.feeFlatAmount` | Decimal(12,2) | `0` | Flat component per paid review |
| `PlatformFeePolicy.feeBase` | `COLLECTED_PRETAX` \| `COLLECTED_TOTAL` | `COLLECTED_PRETAX` | Fee never applies to tax by default |
| `PlatformFeePolicy.minFee` / `maxFee` | Decimal(12,2)? | unset | Optional clamps |
| `refundReversesFee` | boolean | `true` | Whether customer refunds reverse AeroOps' fee proportionally |

Report timezone and fiscal boundaries reuse `Organization.timeZone`; no new fiscal-calendar configuration in Part 1.

---

## 4. Data model proposal (Prisma-flavored)

All models: `id String @id @default(cuid())`, real `Organization` relation with explicit `onDelete`, `createdAt DateTime @default(now())`, tenant-scoped uniques, org-leading indexes — per `tests/schema-governance.test.ts`. `RevenueReview`, `PaymentTransaction`, `Refund`, `TaxSnapshot`, and `InstructorTimeEntry` are defined in docs 03/09/07/04; referenced here by FK. Precision/type finalization: doc 13.

```prisma
// ---------- Allocation ----------

enum AllocationDimension { REVENUE PROCEEDS }

enum AllocationCategory {
  AIRCRAFT_REVENUE
  INSTRUCTOR_SERVICE_REVENUE
  AIRPORT_LANDING_FEES
  FUEL_REVENUE
  TAX
  OTHER_REVENUE
  PLATFORM_FEE              // PROCEEDS dimension only
  SCHOOL_RETAINED_REVENUE   // PROCEEDS dimension only
}

enum AllocationEvent { APPROVAL ADJUSTMENT REFUND VOID WRITE_OFF }

/// Immutable, signed, set-balanced split of every financial event on a
/// Revenue Review. Point-in-time facts, not computed caches (ADR carve-out).
model RevenueAllocation {
  id              String              @id @default(cuid())
  organizationId  String
  revenueReviewId String
  invoiceId       String
  setId           String              // one balanced set per financial event
  event           AllocationEvent
  dimension       AllocationDimension
  category        AllocationCategory
  amount          Decimal             @db.Decimal(12, 2) // signed; reversals negative
  currency        String              @db.Char(3)        // ISO 4217, snapshotted
  sourceType      String?             // provenance of non-approval sets: "Refund", "DiscountAdjustment", ...
  sourceId        String?
  memo            String?
  createdAt       DateTime            @default(now())

  organization  Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  revenueReview RevenueReview @relation(fields: [revenueReviewId], references: [id], onDelete: Restrict)
  invoice       Invoice       @relation(fields: [invoiceId], references: [id], onDelete: Restrict)

  @@unique([setId, dimension, category])          // one row per category per dimension per set
  @@index([organizationId, category, createdAt])  // category reporting
  @@index([organizationId, createdAt])            // period reporting
  @@index([revenueReviewId])
  @@index([invoiceId])
}

// ---------- Platform fee ----------

enum PlatformFeeBase { COLLECTED_PRETAX COLLECTED_TOTAL }

enum PlatformFeeStatus { ACCRUED EARNED PARTIALLY_REVERSED REVERSED VOIDED }

/// Platform-owned pricing: what AeroOps charges on collected tenant revenue.
/// Managed only via authorizePlatform surfaces; effective-dated, never
/// overwritten. Binding shape: 13 §4.13. Currency-agnostic (the fee row
/// snapshots the review's currency); platform-actor attribution lives in
/// AuditLog (`platform.fee_policy_changed`), not on the row.
model PlatformFeePolicy {
  id               String          @id @default(cuid())
  planId           String?         // plan-level default
  organizationId   String?         // per-org override (wins over plan)
  feePercentBps    Int             @default(0)           // basis points — no float percentages
  feeFlatAmount    Decimal         @default(0) @db.Decimal(12, 2)
  feeBase          PlatformFeeBase @default(COLLECTED_PRETAX)
  minFee           Decimal?        @db.Decimal(12, 2)
  maxFee           Decimal?        @db.Decimal(12, 2)
  refundReversesFee Boolean        @default(true)
  effectiveFrom    DateTime
  effectiveTo      DateTime?
  version          Int             @default(1)
  createdAt        DateTime        @default(now())

  plan         SubscriptionPlan? @relation(fields: [planId], references: [id], onDelete: SetNull)
  organization Organization?     @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  fees         PlatformFee[]

  @@index([organizationId, effectiveFrom])
  @@index([planId])
}

/// AeroOps' earned fee for one Revenue Review — accrued at approval,
/// earned at collection. The tenant-visible record; Connect movement in
/// Part 2. Binding shape: 13 §4.13. No `earnedAt` column: the earned moment
/// is the payment-settlement journal's `effectiveAt` plus the audited status
/// transition. `reversedAmount` is the cumulative signed fee delta (§2.3).
model PlatformFee {
  id                String            @id @default(cuid())
  organizationId    String
  revenueReviewId   String            @unique          // exactly one fee per review
  invoiceId         String
  status            PlatformFeeStatus @default(ACCRUED)
  feePercentBps     Int               // policy snapshot at approval
  feeFlatAmount     Decimal           @db.Decimal(12, 2)
  feeBase           PlatformFeeBase
  appliedBaseAmount Decimal           @db.Decimal(12, 2) // the base the percent applied to
  amount            Decimal           @db.Decimal(12, 2)
  reversedAmount    Decimal           @default(0) @db.Decimal(12, 2)
  currency          String            @db.Char(3)
  policyId          String?           // resolved PlatformFeePolicy (+version) provenance
  policyVersion     Int?
  providerRef       String?           // Stripe application-fee / transfer id — Part 2, opaque reference only
  createdAt         DateTime          @default(now())
  updatedAt         DateTime          @updatedAt

  organization Organization       @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  review       RevenueReview      @relation(fields: [revenueReviewId], references: [id], onDelete: Restrict)
  invoice      Invoice            @relation(fields: [invoiceId], references: [id], onDelete: Restrict)
  policy       PlatformFeePolicy? @relation(fields: [policyId], references: [id], onDelete: SetNull)

  @@index([organizationId, status])
  @@index([organizationId, createdAt])
}

// ---------- Instructor compensation ----------

enum InstructorEarningStatus {
  PENDING   // written when compensationApprovalMode = SEPARATE_APPROVAL
  APPROVED  // payable fact; AUTO_ON_REVIEW_APPROVAL writes rows here directly
  EXPORTED  // stamped atomically by a FinancialExportJob (Part 3)
  REVERSED  // fully offset by reversal rows
  // PAID is deliberately absent — added additively if Part 3 ships payouts (13 §3 R6)
}

/// Instructor Compensation record — snapshotted from compensation rates
/// (doc 04) at Revenue Review approval. Corrections are new signed rows.
/// Binding shape: 13 §4.7 (merged earning shape, R6). `InstructorTimeCategory`
/// and `InstructorClassification` are doc 04's enums (13 §4.6/§4.7): anything
/// snapshotted onto a financial record is a typed enum, never a String (R25).
model InstructorEarning {
  id              String  @id @default(cuid())
  organizationId  String
  instructorId    String
  revenueReviewId String
  timeEntryId     String? @unique // InstructorTimeEntry (docs 03/04); 1:1 for primary earnings, null on reversal rows

  category    InstructorTimeCategory
  customLabel String?                // required iff category = CUSTOM

  hours    Decimal @db.Decimal(6, 2)
  rate     Decimal @db.Decimal(12, 2)  // resolved compensation rate snapshot
  amount   Decimal @db.Decimal(12, 2)  // signed; reversal rows negative; round-half-up(hours × rate)
  currency String  @db.Char(3)

  classification     InstructorClassification // snapshot at approval — EMPLOYEE | CONTRACTOR | UNSPECIFIED
  rateProfileId      String?                  // Instructor Rate Profile provenance (doc 04)
  rateProfileVersion Int?
  rateSource         Json?                    // resolution trace: tier, candidates, linkage math, ambiguity

  status           InstructorEarningStatus @default(PENDING)
  approvedByUserId String?
  approvedAt       DateTime?
  exportJobId      String?
  exportedAt       DateTime?

  reversesEarningId String? // set on reversal rows
  reversalReason    String? // required on reversal rows (engine-enforced)
  notes             String?

  createdAt DateTime @default(now()) // = approval time for primary rows

  organization    Organization           @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  instructor      Instructor             @relation(fields: [instructorId], references: [id], onDelete: Restrict) // like LessonRecord/Endorsement — changes the canonical wipe order
  revenueReview   RevenueReview          @relation(fields: [revenueReviewId], references: [id], onDelete: Restrict)
  timeEntry       InstructorTimeEntry?   @relation(fields: [timeEntryId], references: [id], onDelete: SetNull)
  rateProfile     InstructorRateProfile? @relation(fields: [rateProfileId], references: [id], onDelete: SetNull)
  exportJob       FinancialExportJob?    @relation(fields: [exportJobId], references: [id], onDelete: SetNull)
  reversesEarning InstructorEarning?     @relation("EarningReversal", fields: [reversesEarningId], references: [id], onDelete: Restrict)
  reversals       InstructorEarning[]    @relation("EarningReversal")

  @@index([organizationId, instructorId, createdAt])
  @@index([organizationId, status])
  @@index([organizationId, createdAt])
  @@index([revenueReviewId])
}

// ---------- Ledger ----------

enum LedgerAccount {
  ACCOUNTS_RECEIVABLE
  PAYMENT_CLEARING
  CASH_ON_PREMISES
  REVENUE_AIRCRAFT
  REVENUE_INSTRUCTION
  REVENUE_AIRPORT_FEES
  REVENUE_FUEL
  REVENUE_OTHER
  CONTRA_REVENUE_DISCOUNTS
  TAX_PAYABLE
  PLATFORM_FEE_EXPENSE
  PLATFORM_FEE_PAYABLE
  INSTRUCTOR_COMP_EXPENSE
  INSTRUCTOR_COMP_PAYABLE
  PROCESSOR_FEES_EXPENSE
  BAD_DEBT_EXPENSE
}

enum LedgerDirection { DEBIT CREDIT }

/// Append-only double-entry spine. Rows are never updated or deleted;
/// corrections are reversing journals. Sole writer: src/lib/ledger.ts.
model LedgerEntry {
  id              String          @id @default(cuid())
  organizationId  String
  journalId       String          // groups one balanced journal
  event           String          // dot-namespaced: "revenue_review.approved", "payment.succeeded", ...
  account         LedgerAccount
  direction       LedgerDirection
  amount          Decimal         @db.Decimal(12, 2) // always > 0; sign carried by direction
  currency        String          @db.Char(3)
  sourceType      String          // "RevenueReview" | "PaymentTransaction" | "Refund" | "PlatformFee" | "InstructorEarning" | ...
  sourceId        String
  revenueReviewId String?
  invoiceId       String?
  effectiveAt     DateTime        // event time; reports bucket on this in org timeZone
  memo            String?
  createdAt       DateTime        @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId, account, effectiveAt]) // balances & period reporting
  @@index([organizationId, journalId])            // journal integrity checks
  @@index([organizationId, effectiveAt])
  @@index([sourceType, sourceId])                 // provenance / reconciliation joins
}

// ---------- Reconciliation ----------

enum PayoutStatus { PENDING IN_TRANSIT PAID FAILED RECONCILED RECONCILED_WITH_EXCEPTIONS }

/// Shape defined in Part 1; populated by the Part 2 payout webhook.
model ProviderPayout {
  id               String       @id @default(cuid())
  organizationId   String
  provider         String       @default("stripe")
  providerPayoutId String       // opaque provider reference — safe to store
  status           PayoutStatus @default(PENDING)
  amount           Decimal      @db.Decimal(12, 2)
  grossAmount      Decimal?     @db.Decimal(12, 2)
  feesAmount       Decimal?     @db.Decimal(12, 2)
  currency         String       @db.Char(3)
  arrivalDate      DateTime?
  matchedCount     Int          @default(0)
  unmatchedCount   Int          @default(0)
  raw              Json?        // provider composition retained for forensics — no card/bank data ever
  createdAt        DateTime     @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, provider, providerPayoutId]) // tenant-scoped natural key (ADR-021)
  @@index([organizationId, status, createdAt])
}

enum ReconciliationExceptionKind {
  MISSING_LOCAL_TRANSACTION
  MISSING_PROVIDER_TRANSACTION
  AMOUNT_MISMATCH
  FEE_MISMATCH
  UNBALANCED_JOURNAL
  ALLOCATION_MISMATCH
  STALE_PENDING_PAYMENT
}

enum ReconciliationExceptionStatus { OPEN RESOLVED IGNORED }

/// One row per unmatched/inconsistent item — the "report of unmatched items"
/// is this queue. Resolution requires a note and is audited.
model ReconciliationException {
  id               String                        @id @default(cuid())
  organizationId   String
  kind             ReconciliationExceptionKind
  status           ReconciliationExceptionStatus @default(OPEN)
  providerRef      String?
  sourceType       String?
  sourceId         String?
  payoutId         String?
  expectedAmount   Decimal?                      @db.Decimal(12, 2)
  actualAmount     Decimal?                      @db.Decimal(12, 2)
  currency         String?                       @db.Char(3)
  details          Json?
  detectedAt       DateTime                      @default(now())
  resolvedByUserId String?
  resolvedAt       DateTime?
  resolutionNote   String?
  createdAt        DateTime                      @default(now())

  organization Organization    @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  payout       ProviderPayout? @relation(fields: [payoutId], references: [id], onDelete: SetNull)

  @@index([organizationId, status, detectedAt])
  @@index([organizationId, kind])
}

// ---------- Export seam (Part 3) ----------

enum ExportJobKind { REVENUE_CSV LEDGER_CSV QUICKBOOKS_CSV INSTRUCTOR_COMPENSATION_CSV TAX_CSV }

enum ExportJobStatus { PENDING RUNNING COMPLETED COMPLETED_WITH_ERRORS FAILED }

/// Financial Export job — the ImportJob idiom in reverse: per-row outcomes,
/// manifest of exported record ids, file via the storage adapter.
model FinancialExportJob {
  id                String          @id @default(cuid())
  organizationId    String
  kind              ExportJobKind
  status            ExportJobStatus @default(PENDING)
  periodStart       DateTime
  periodEnd         DateTime
  params            Json?           // filters: location, aircraft, instructor, program
  rowCount          Int             @default(0)
  errorCount        Int             @default(0)
  rowErrors         Json?           // per-row outcomes — nothing fails silently
  exportedRecordIds Json?           // manifest (ImportJob.createdRecords idiom)
  fileDocumentId    String?         // generated file stored as a Document
  checksum          String?
  createdByUserId   String?
  createdByLabel    String
  startedAt         DateTime?
  completedAt       DateTime?
  createdAt         DateTime        @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  earnings     InstructorEarning[]

  @@index([organizationId, createdAt])
  @@index([organizationId, kind, status])
}

enum MappingSourceType { ALLOCATION_CATEGORY LEDGER_ACCOUNT REVENUE_ITEM TAX_CODE PAYMENT_METHOD }

/// Maps the fixed internal taxonomy to the org's external chart of accounts.
model AccountingMapping {
  id              String            @id @default(cuid())
  organizationId  String
  externalSystem  String            @default("quickbooks")
  sourceType      MappingSourceType
  sourceKey       String            // e.g. "AIRCRAFT_REVENUE", "TAX_PAYABLE", revenueItemId
  externalAccount String            // external account name/code
  externalClass   String?
  externalItem    String?
  active          Boolean           @default(true)
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, externalSystem, sourceType, sourceKey])
  @@index([organizationId, externalSystem])
}
```

**Schema notes**

- **FK actions are deliberate:** org-owned records `Cascade` from `Organization` (house pattern); but `Invoice`/`RevenueReview`/`Instructor` relations on financial records are `Restrict` — an invoice or instructor with allocations/earnings cannot be deleted out from under its financial history. This extends the LessonRecord/Endorsement RESTRICT precedent and **changes the canonical wipe order** in `src/lib/org-snapshot.ts`: new deletion order prepends `ReconciliationException → ProviderPayout → LedgerEntry → RevenueAllocation → PlatformFee → InstructorEarning → FinancialExportJob → AccountingMapping` ahead of invoice and instructor deletion. All eight models join `TableKey`, capture, wipe, and restore lists — unlike `AuditLog`, these are the org's books and **must** survive snapshot/restore or a founder restore silently loses financial data.
- **No DB-level cross-row sum constraint:** Postgres cannot express "this set balances" as a CHECK, and house style avoids raw-SQL triggers in a Prisma-managed schema (considered and rejected). Enforcement is: single posting engine writes in-transaction with assertion before insert → contract tests → continuous verification (R1–R7) → `ReconciliationException` on any drift.
- **`PlatformFeePolicy` is platform data** living alongside `SubscriptionPlan` on the AeroOps side of the two-money-systems boundary; `PlatformFee` is the tenant-side record. The policy's `organizationId` relation exists only for the override case and cascades with the org.
- **Migrations:** all additive — new enums and models in a DDL migration first, any seed/backfill in a separate idempotent data-only migration (DATABASE_STANDARDS.md two-step pattern). Nothing here alters `Invoice`, `InvoiceLine`, or `Payment`; historical invoices predating Phase 8 simply have no allocation/ledger history (reports label the pre-Phase-8 period accordingly — no silent reinterpretation, per spec Part L).
- **Seed fixtures** (same slice as the models): approved + paid reviews with full allocation sets, ledger journals, earned platform fees, and instructor earnings in **both** seeded orgs; one refunded review with reversal sets; one failed-payment review; one historical-rate fixture (rate changed after approval, allocation unchanged) — covering the spec's validation matrix while keeping `demo1234` logins intact.

---

## 5. Validation & business rules

| # | Rule | Enforcement |
|---|---|---|
| V1 | Per allocation set: Σ(REVENUE rows) = Σ(PROCEEDS rows) = the event amount; APPROVAL set amount = invoice snapshot total | Posting engine asserts pre-insert inside the transaction; contract test; verification job (R2) |
| V2 | Allocations, ledger entries, platform-fee snapshots, and earnings are never updated after insert (status/`reversedAmount`/export fields on `PlatformFee`/`InstructorEarning` are the only mutable columns, each transition guarded) | No update paths in the engine API; state transitions via guarded `updateMany` claims (the dispatch-close idempotency pattern); audit on every transition |
| V3 | Every journal balances: Σ debits = Σ credits, single currency per journal | Posting engine assertion; verification job (R1) |
| V4 | Rounding: money divisions round half-up to cents; proportional splits use largest-remainder; **all residue lands in `SCHOOL_RETAINED_REVENUE`** | Pure functions in the allocation engine (`src/lib/revenue-allocation.ts`), Decimal-safe math (no float arithmetic on money), contract-tested — the Financial gate requires an explicit rounding policy at every division |
| V5 | Platform fee: `amount = clamp(round(appliedBase × feePercentBps / 10000) + feeFlatAmount, minFee, maxFee)`; percent in integer basis points; base excludes tax under `COLLECTED_PRETAX` | Pure fee function, snapshot of every input on the `PlatformFee` row |
| V6 | Instructor earnings derive only from compensation rate snapshots (doc 04), never from the customer billing rate unless the org explicitly configured that linkage | Allocation engine reads the compensation snapshot written at approval; contract test |
| V7 | One `PlatformFee` per review; one APPROVAL allocation set per review — a review cannot be allocated twice | `@@unique(revenueReviewId)` on PlatformFee; `@@unique([setId, dimension, category])` + engine guard that an APPROVAL set exists at most once per review (checked inside the approval transaction) |
| V8 | Single currency per review: all child records inherit the review's snapshotted currency; mixed-currency journals rejected | Posting engine assertion |
| V9 | Financial postings happen in the same `db.$transaction` as the state change they describe; no external calls inside any transaction | Code review + the ADR-011 pattern; webhook-driven postings run inside the idempotent webhook-processing transaction (doc 09) after the unique-insert event claim |
| V10 | Reversals reference their source (`reversesEarningId`, `sourceType`/`sourceId`) and cannot exceed what they reverse (e.g. Σ refund fee reversals ≤ the effective fee; the signed adjustment re-base keeps the effective fee `amount − reversedAmount` ≥ 0 and ≤ the clamped recompute on the net base — §2.3) | Engine guards; verification job |
| V11 | Exception resolution requires a non-empty `resolutionNote` | zod validation on the route; audited with before/after |
| V12 | Export jobs report per-row outcomes; compensation export marks rows `EXPORTED` atomically with the manifest write | Import Center idiom; single transaction for manifest + status flips |
| V13 | No unbounded `findMany`: reports and exports query bounded windows on org-leading indexes | Performance gate; export jobs stream in pages |

---

## 6. RBAC, approvals & audit

### Permission keys (join `src/lib/permissions.ts`; data-driven, never role-name checks)

The Revenue Engine ships inside the existing **billing** feature module. New keys under a `revenue.` prefix require adding `revenue → billing` to `MODULE_BY_PREFIX` in `src/lib/session.ts` so plan/profile module gating applies automatically.

| Permission | Grants | Default roles |
|---|---|---|
| `billing.view` *(existing)* | Revenue Dashboard, Revenue Reports, allocation breakdowns, platform-fee statement | ACCOUNT_OWNER, SCHOOL_ADMIN, ACCOUNTANT |
| `revenue.compensation_view` | View all Instructor Compensation records | ACCOUNT_OWNER, SCHOOL_ADMIN, ACCOUNTANT |
| `revenue.compensation_view_own` | Instructor sees their own earnings only (route scopes to `session.userId`'s instructor profile) | INSTRUCTOR (+ above) |
| `revenue.compensation_approve` | Approve/reverse earnings under `SEPARATE_APPROVAL` mode and refund-reversal proposals | ACCOUNT_OWNER, SCHOOL_ADMIN, ACCOUNTANT |
| `revenue.exports_run` | Create/download FinancialExportJobs, manage AccountingMapping | ACCOUNT_OWNER, SCHOOL_ADMIN, ACCOUNTANT |
| `revenue.reconciliation_manage` | View exception queue, resolve/ignore exceptions, trigger verification runs | ACCOUNT_OWNER, SCHOOL_ADMIN, ACCOUNTANT |

Role templates (`src/lib/role-templates.ts`) gain these keys where sensible (e.g. "Read-Only Auditor" gets the view keys). `PlatformFeePolicy` management is **platform-only** (`authorizePlatform`, `{mutating:true}` — refused during impersonation per the constitution tests).

### Approvals & separation of duties

- Under `SEPARATE_APPROVAL`, an instructor who also holds `revenue.compensation_approve` **cannot approve their own earnings** — engine-enforced (compare the earning's instructor userId to the session userId), not a role check.
- Earning reversal on refund under `REQUIRE_APPROVAL` creates a pending reversal proposal surfaced on the Revenue Dashboard; approving it requires `revenue.compensation_approve` and a reason.
- All mutating routes pass `{mutating:true}` so read-only impersonation and read-only API keys are refused. **No AI pathway mutates any of these records** (constitution rule 8) — allocations, fees, earnings, and ledger postings happen only as consequences of human-initiated, permissioned actions.

### Audit actions (via `recordAudit`, dot-namespaced; impersonation attribution centralized)

| Action | When | old/new value payload |
|---|---|---|
| `revenue.allocated` | Allocation set inserted (any event) | set id, event, per-dimension totals |
| `revenue.platform_fee_accrued` / `_earned` / `_reversed` / `_voided` | PlatformFee transitions | status before/after, amounts, policy version |
| `revenue.compensation_approved` / `_reversed` / `_reversal_proposed` | Earning transitions | earning id, amounts, reason |
| `revenue.export_created` / `_completed` / `_failed` | Export job lifecycle | kind, period, rowCount/errorCount, checksum |
| `revenue.reconciliation_resolved` / `_ignored` | Exception resolution | exception kind, expected/actual, resolution note |
| `platform.fee_policy_changed` | PlatformFeePolicy create/supersede (platform surface) | policy before/after |

Ledger journals themselves are not duplicated into AuditLog (they are already immutable, attributed via `sourceType`/`sourceId` to an audited action); the *triggering* mutation is what's audited — audit metadata stays sufficient to reconstruct the ledger without the database's current state (Financial gate E3).

### Domain events

Register in `WEBHOOK_EVENTS` with live emit sites (constitution vocabulary test): `export.completed`, `reconciliation.exception_opened`. Allocation/fee/earning creation rides the events owned by sibling docs (`revenue_review.approved`, `payment.succeeded`, `payment.failed`, refund events — doc 03/09); this doc adds no duplicate emissions for those.

---

## 7. UX notes (aviation-native, operational workflow first)

- **Operational people never see debits and credits.** The dispatcher's and instructor's world ends at the Revenue Review. The ledger, journals, and account taxonomy appear only in an accountant-facing "Ledger" detail view under the Revenue Dashboard, gated by `billing.view`.
- **The Allocation section of a Revenue Review reads as plain language**, not accounting: *"Where this money goes: Aircraft $312.00 · Instruction $127.50 · Airport fees $15.00 · Tax $22.71 · AeroOps fee $9.10 · Your school keeps $445.40."* Instructor Compensation shows alongside it, clearly labeled as separate from what the customer was charged.
- **Terminology:** dispatch / release / return / closeout — never "check-in" (AVIATION_STANDARDS.md; UX-gate enforced). This surface speaks of a flight being *returned and closed*, a review being *approved*, money being *collected*. Customer-facing names exactly as the canon: Revenue Dashboard, Revenue Review, Revenue Allocation, Instructor Compensation, Financial Export, Revenue Report.
- **Revenue Dashboard is queue-first:** the top of the page is what needs a human (reviews awaiting action, failed payments, pending compensation approvals, open reconciliation exceptions), then the money tiles, then report links. Every number links to the rows behind it — a number without a "why" is a bug.
- New statuses (`ACCRUED`, `EARNED`, `REVERSED`, `PENDING`, `APPROVED`, `EXPORTED`, `OPEN`, `RESOLVED`, `IGNORED`, payout statuses) register in the single `STATUS_TONE` map in `src/lib/status-colors.ts`; existing meanings unchanged.
- Design-system components only; light + dark parity; mobile parity (bottom nav); loading/empty/error states are part of the feature. Empty states teach: a fresh org's Revenue Dashboard explains what will appear once the first Revenue Review is approved.
- `formatCurrency` (`src/lib/utils.ts`) becomes currency-aware (takes the record's ISO code) rather than hardcoded USD — display-level only in Part 1 since orgs are single-currency (§9).
- Instructors get a "My Compensation" view (own rows only): period totals, per-flight detail, status chips — answering "what am I owed for July?" without exposing anyone else's numbers. Contractor rows carry the worker-classification disclaimer.

---

## 8. Interactions with other Revenue Engine components

| Component (doc) | Interaction |
|---|---|
| Revenue Engine architecture & ADR (doc 01 / ADR-025) | The immutable-snapshot carve-out, the approval-transaction boundary, and the two-money-systems bridge for the platform fee are ratified there; this doc supplies the allocation/ledger specifics |
| Operational checkout & return (doc 02) | Produces the closed Dispatch and draft Revenue Review. **No financial records from this doc are written at operational closeout** — allocation begins at approval, keeping aircraft return fast and Stripe-free (ADR-011) |
| Revenue Review lifecycle (doc 03) | Owns the approval transaction in which the APPROVAL allocation set, `PlatformFee` (ACCRUED), `InstructorEarning` rows, and the approval journal are created atomically with the invoice lock. Owns Revenue Review statuses; this doc consumes `Approved`, `Paid`, `Payment Failed`, `Refunded`, `Voided` |
| Instructor Rate Profiles & compensation rates (doc 04) | Source of compensation rate, classification, and rate-profile version snapshotted onto `InstructorEarning`; billing-vs-compensation separation is defined there and honored here (V6) |
| Aircraft Pricing Profiles (doc 05) | Rate snapshots determine line amounts that feed `AIRCRAFT_REVENUE`; no direct coupling beyond the locked lines |
| Revenue Items (doc 06) | Each Revenue Item's default accounting category is an `AllocationCategory`, and its id is a valid `AccountingMapping` sourceKey |
| Taxes & TaxSnapshot (doc 07) | TaxSnapshot amounts become `TAX` allocations in both dimensions and `TAX_PAYABLE` postings; the Tax Collected report reads both |
| Adjustments, discounts, refunds (doc 08) | Every adjustment/refund record triggers exactly one balanced allocation set + journal here (ADJUSTMENT/REFUND events), plus fee/earning reversal handling |
| Payment methods, timing, attempts (doc 09) | `PaymentTransaction` success/failure/settlement events drive the payment/refund postings, fee earning, and the idempotent webhook-processing transaction those postings run inside; payment timing snapshot determines *when* — never *whether* — the collection journal posts |
| Responsible payers (doc 11) | A/R aging and payment-status surfaces group by responsible payer; payer-visible receipts read allocation snapshots (never internal ledger accounts) |
| Checkout restrictions (doc 10) | "Amount due above threshold" restrictions read the derived Amount Due (A/R per payer/student from this doc's records) instead of `Student.accountBalance` as that column is demoted |
| Database model (doc 13, binding) | Final precision/type/index DDL, the `RevenueReview` model definition, invoice snapshot-total columns, and the `Student.accountBalance` transition plan |
| Migration plan (doc 14) | Sequencing of the DDL + backfill migrations, seed fixture updates, org-snapshot wiring |

---

## 9. Out of scope for Part 1 / deferred to Parts 2–3

| Item | Part |
|---|---|
| Stripe Connect account provisioning, destination charges/application fees, actual platform-fee **money movement** and settlement netting | Part 2 |
| Payout webhook ingestion (`ProviderPayout` population) and live provider-side reconciliation; `PROCESSOR_FEES_EXPENSE` postings | Part 2 |
| Payment execution itself (attempts, retries, ACH lifecycle) — designed in doc 09 | Part 2 |
| Ledger posting engine going live (`src/lib/ledger.ts` ships with the approval/payment flows) | Part 2 |
| CSV/QuickBooks export generation, AccountingMapping management UI, export file download | Part 3 |
| QuickBooks Online API sync (beyond CSV shape) | Post-Part 3 |
| Instructor payout **execution** (payroll/contractor payment rails); marking payables externally paid | Out of scope entirely — export is the Part 1–3 boundary |
| Multi-currency organizations (schema carries ISO currency everywhere; engines assert single currency per org) | Later phase |
| Saved custom report builder; scheduled/emailed reports (no email provider exists; nightly runs need the queue seam) | Later phase |
| Cash-basis Tax Collected reporting (Part 1 basis is accrual on `TaxSnapshot.serviceDate`, §2.8) | Later phase |
| Configurable internal chart of accounts (external mapping covers the known need) | Reconsider on demand |
| Write-off workflow UI (`WRITE_OFF` event + `BAD_DEBT_EXPENSE` are designed; the status/flow ships only if doc 03 includes Written Off) | With doc 03 decision |

Confirmations: nothing here deploys anything, enables live payments, calls Stripe, or sends email — Part 1 is design only.

---

## 10. Open questions

1. **Platform fee commercial terms** (product owner / CEO — ROADMAP already flags "pricing/fees decision needed"): default `feePercentBps`/`feeFlatAmount` per plan; whether the fee applies to offline (cash/check) collections or only processor-collected revenue; whether `refundReversesFee` stays `true` (AeroOps refunds its fee when the customer is refunded).
2. **Fee base composition:** `COLLECTED_PRETAX` excludes tax — should it also exclude pass-through airport/landing fees the school merely collects on an airport's behalf?
3. **Compensation reversal default:** `REQUIRE_APPROVAL` on refunds is the proposed default — confirm with flight-school operators that automatic clawback (`AUTO_REVERSE`) should not be the default for any segment (e.g. clubs with volunteer instructors).
4. **Employee vs contractor export scope:** should `INSTRUCTOR_COMPENSATION_CSV` include employee-classified instructors (feeding payroll systems) in Part 3, or contractors only at first?
5. **Platform-fee transparency:** the design shows AeroOps' fee to the org on every review and in the Platform Fee Statement. Confirm this positioning (transparent fee) versus netting it invisibly into settlement — a product/commercial call that changes UX copy, not the data model.
6. **Pre-Phase-8 history in reports:** reports label the pre-allocation era and read legacy invoices' derived totals for continuity. Is a one-time, explicitly-approved backfill of APPROVAL allocation sets for existing PAID invoices wanted (deterministic from their lines), or do we keep the clean cutover? (Backfills never guess; legacy lines map cleanly by `LineItemKind`, so both options are safe.)
