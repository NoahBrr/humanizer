# Platform Fee — Agreements, Computation, Collection & Reconciliation

> **Status:** Proposed — Phase 8 Part 2 · **Date:** 2026-07-10 · **Lead roles:** SaaS Revenue Operations Architect; Financial Systems Architect; Head of Product · **Part of:** Revenue Engine design set ([README](./README.md))

This document is Part 2 deliverable 12 (spec Part W): the complete design of AeroOps' platform fee — the fee AeroOps earns on tenant revenue collected through the Revenue Engine. It finalizes the commercial-model surface (per-organization **Platform Fee Agreements** with percentage / fixed / combined / per-rail / volume-tier / introductory / negotiated / waiver terms), the computation and immutable snapshot at Revenue Review approval, the collection mechanics under the Connect model chosen in [18-stripe-connect-decision.md](./18-stripe-connect-decision.md), refund/dispute interaction, reconciliation, and the disclosure rules.

The platform fee is the **one deliberate bridge** between AeroOps' two money systems (spec Part N; ARCHITECTURE.md §13; [12-revenue-allocation-and-reporting.md](./12-revenue-allocation-and-reporting.md) §1): its *record* lives in the tenant's books (an expense the school can always see and reconcile), its *pricing* is AeroOps platform data (never org-editable), and its *collection* rides the connected-account charge or a platform-side settlement. Nothing else crosses that boundary.

---

## 1. Purpose & scope

**In scope (this document):**

- The Platform Fee Agreement concept: what an org's fee terms are, every commercial model the spec requires, and how terms are versioned, effective-dated, and resolved.
- Additive extensions to the doc-13 `PlatformFeePolicy` / `PlatformFee` models (per-rail terms, volume tiers, agreement kind, accrual-time rail/tier snapshot) — final Prisma shapes ratified in [34-part2-database-additions.md](./34-part2-database-additions.md).
- The fee computation at approval: inputs, base definition (pre-tax, justified in §6.1), rail resolution, tier resolution, rounding, clamps, and the immutable snapshot.
- Collection mechanics per rail (Connect `application_fee_amount` on direct charges; offline collections earning into `PLATFORM_FEE_PAYABLE`).
- Interaction with refunds (proportional reversal per [26-refunds-voids-and-disputes.md](./26-refunds-voids-disputes.md)), disputes, ACH returns, and voids.
- Reconciliation: expected fee vs provider-reported application fee, drift → `FEE_MISMATCH` exceptions per [23-webhooks-and-reconciliation.md](./23-webhooks-and-reconciliation.md).
- RBAC (platform-side management, org-side read-only, student/payer invisibility), audit, Platform Console surface (per [19-connected-account-onboarding.md](./19-connected-account-onboarding.md)'s console section), and disclosure copy rules.

**Not in scope:** payment execution itself (docs 21–24), refund execution mechanics (doc 26), allocation set math beyond the `PLATFORM_FEE` component (doc 28), SaaS subscription billing (PRODUCTION.md §13.2 — a different money system), instructor payouts, and the actual platform-side invoicing of offline-earned fees (Part 3, §11).

**North-star check.** To a school owner, the fee must be *boring*: a predictable line they agreed to, visible in their own books, reversed when their customer is refunded, and never blocking their operation. Every rule below is written so a misconfiguration or edge case costs **AeroOps** money or attention — never the school's workflow, and never the student's trust.

---

## 2. Relationship to Part 1 docs

| Part 1 doc | What this document does with it |
|---|---|
| [13-database-model.md](./13-database-model.md) §4.13 | **Binding.** `PlatformFeePolicy` and `PlatformFee` model names, existing fields, enums (`PlatformFeeBase`, `PlatformFeeStatus`), uniques (`PlatformFee.revenueReviewId @unique`), FK actions, and indexes are implemented exactly as written. This doc adds **additive columns and one child table only** (§5); nothing is renamed, dropped, or reinterpreted. R30's field-drop decisions (no `createdByLabel`, no `notes` — actor and rationale live in `AuditLog`) are honored. |
| [12-revenue-allocation-and-reporting.md](./12-revenue-allocation-and-reporting.md) §2.3, §2.5, §10 | **Extended/finalized.** Accrue-at-approval / earn-at-collection lifecycle, `COLLECTED_PRETAX` default base, basis-point math (V5), re-base-under-snapshotted-version rule for post-approval adjustments, ledger accounts (`PLATFORM_FEE_EXPENSE`, `PLATFORM_FEE_PAYABLE`), reconciliation invariant R5, and the audit-action names (`revenue.platform_fee_*`, `platform.fee_policy_changed`) all carry forward unchanged. This doc finalizes what doc 12 deferred to Part 2: per-rail terms, tiers, collection mechanics, refund/dispute treatment, and the console surface. One additive lifecycle extension (ACH return, §4.7) is recorded in §12. |
| [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) §2.6 | **Consumed.** The fee accrual (§4.3) is step 5 territory of the one-`db.$transaction` approval; the fee never adds an approval step, never blocks approval, and never appears in the approve-control wording (which is fixed by doc 03's consequence-truthful table). |
| [09-payment-timing-and-collection.md](./09-payment-timing-and-collection.md) | **Consumed.** The payment runner and attempt machinery carry the fee to the provider (§4.4); the fee adds no new attempt states and no new idempotency mechanism — `application_fee_amount` rides the attempt's existing deterministic key (ADR-033). |
| [08-adjustments-discounts-credits.md](./08-adjustments-discounts-credits.md) §3.3 | **Consumed.** Post-approval charge-side adjustments re-base the fee under the snapshotted agreement version via signed `reversedAmount` — that rule is doc 12 §2.3's; this doc reuses it verbatim for rail switches (§4.5). |
| [16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md) D1 | **Consumed.** Direct charges on connected accounts + `application_fee_amount`, school as merchant of record — ratified in [18-stripe-connect-decision.md](./18-stripe-connect-decision.md). This doc references that decision and does not re-open it. |

**Naming (binding resolution).** Spec Part W's concept is the **Platform Fee Agreement** — that is the customer/console-facing vocabulary used on every surface ("Your AeroOps fee agreement", "Fee agreement version 3"). The Prisma model remains **`PlatformFeePolicy`**, exactly as doc 13 bound it: one Platform Fee Agreement = the effective-dated version chain of `PlatformFeePolicy` rows at one scope (org, plan, or global). This mirrors the Revenue Review ↔ Invoice split (ADR-026): product vocabulary on top, doc-13 backend names untouched. No parallel "PlatformFeeAgreement" table exists or ships.

---

## 3. The Platform Fee Agreement — commercial models & resolution

### 3.1 Every spec-required model, mapped

| Spec Part W model | How it's expressed |
|---|---|
| Percentage fee | `feePercentBps` (integer basis points; e.g. 290 = 2.90%) |
| Fixed fee | `feeFlatAmount` per collected review, `feePercentBps = 0` |
| Fixed plus percentage | Both fields non-zero — the formula (§6.2) always sums them |
| Different card fee | Base terms (`feePercentBps` / `feeFlatAmount`) **are** the card terms |
| Different ACH fee | `achFeePercentBps` / `achFeeFlatAmount` (nullable — null = same as card) |
| Volume tier | `PlatformFeeTier` child rows: month-to-date volume thresholds select the percent (§3.4) |
| Introductory fee | An org-scope version with a bounded `effectiveFrom`/`effectiveTo` window and `kind INTRODUCTORY`; on expiry, resolution falls through to the next org version or the plan/global default (§3.3) |
| Negotiated enterprise fee | An org-scope version (`kind NEGOTIATED`) — precedence puts it above plan and global terms |
| Fee waiver | An org-scope version with `kind WAIVER`; the engine forces the computed fee to 0 and validation requires all numeric terms to be 0 (§6.4) |
| Custom effective dates | `effectiveFrom` / `effectiveTo` on every version; no-overlap enforced per scope (§3.2) |

`kind` (`STANDARD | INTRODUCTORY | NEGOTIATED | WAIVER`) is **display/audit metadata only** — the fee math reads exclusively the numeric fields, so a mislabeled kind can never change money (except `WAIVER`, which is a validation constraint forcing zeros, not an alternate formula).

### 3.2 Versioning rules

- Versions are **append-only**: an agreement is never edited in place. "Change the fee" = create the next version at the same scope; the creating transaction stamps the prior open version's `effectiveTo = new.effectiveFrom` (guarded update — see §4.1). This is the `AircraftPricingProfile` versioning discipline (ADR-029) applied to platform pricing.
- `version` increments within a scope (org / plan / global). No two versions at one scope may have overlapping effective windows — engine-enforced inside the creating transaction (the `TaxRule` no-overlap rule, doc 07).
- **No retroactive versions**: `effectiveFrom ≥ now()` at creation (small clock-skew tolerance of 5 minutes). Retroactive pricing would silently change what an approver believed they agreed to; corrections to already-accrued fees are not made by policy edits — accrued `PlatformFee` rows are never re-resolved against new versions (doc 12 §2.3, binding).
- Deleting a version is not supported once any `PlatformFee` references it (`PlatformFee.policyId` is `SetNull` provenance, but the copied snapshot fields remain authoritative). A never-referenced, not-yet-effective version may be hard-deleted from the console (audited) — the one sanctioned delete.

### 3.3 Resolution precedence (selection rule)

At resolution instant `t` (= the review's `approvedAt`, server clock — see §6.1 for why):

1. **Org agreement**: the `PlatformFeePolicy` with `organizationId = org` and `effectiveFrom ≤ t < coalesce(effectiveTo, ∞)`.
2. **Plan agreement**: same window test with `planId = org's current planId`, `organizationId` null.
3. **Global default**: same window test with both `planId` and `organizationId` null.
4. **Nothing resolves** → the fee is **$0.00 with `policyId = null`** and approval proceeds (§9, F1). A missing agreement is AeroOps' pricing gap, never the school's problem.

No-overlap per scope makes each step deterministic (at most one candidate). An expired introductory version simply stops matching step 1 and resolution falls through — the console must preview this fall-through (§10.1).

Simpler-workflow choice: precedence is a fixed three-level chain, not a rule engine — a Platform Billing admin can always answer "what fee does this school pay today?" by looking at at most three rows.

### 3.4 Volume tiers

A version may carry ordered `PlatformFeeTier` rows. Tier selection:

- **Volume metric:** the org's month-to-date accrued fee base — `Σ appliedBaseAmount` of the org's non-`VOIDED` `PlatformFee` rows with `createdAt` in the current **UTC calendar month**, computed inside the approval transaction (bounded aggregate, indexed by `[organizationId, createdAt]`). Org-level regardless of plan or agreement changes mid-month.
- **Selection:** first tier in `sortOrder` whose `monthlyVolumeUpTo` is null (top tier) or strictly greater than the MTD volume. The tier supplies `feePercentBps` (and optionally `achFeePercentBps`); flat amounts and clamps stay at the version level.
- **Slab, not marginal, not retroactive:** the selected tier's percent applies to the *whole review*, chosen from MTD volume at the accrual instant. There is no month-end true-up and no marginal split within a review.

Simpler-workflow choice: slab-at-accrual over marginal/retroactive tiering — the approver-visible fee is final at approval and explainable in one sentence ("your school's volume this month put this review in the 2.5% tier"), at the cost of a small boundary discontinuity AeroOps absorbs commercially.

---

## 4. How it works — workflows and sequences

### 4.1 Creating/superseding an agreement version (Platform Console)

Actor: platform staff holding `platform.fees.manage` (§8.1). Route: `POST /api/platform/fee-agreements` (global/plan scope) or `POST /api/platform/organizations/[id]/fee-agreement` (org scope) — thin routes: `authorizePlatform({ mutating: true, orgId? })` → zod → engine → audit.

One `db.$transaction`:

1. Validate terms (§6.4): non-negative integers/decimals, `WAIVER` ⇒ all zeros, tiers contiguous and strictly increasing, `minFee ≤ maxFee`, `effectiveFrom ≥ now − 5min`, currency equals the target org's currency for org scope (single-currency Parts 1–2).
2. Load the currently open version at the same scope `FOR UPDATE`; reject if a future-dated version already overlaps the requested window (409 with the conflicting version identified).
3. Stamp the open version's `effectiveTo = new.effectiveFrom` (guarded `updateMany` on `id` + `effectiveTo IS NULL`; count 0 with an open version present → 409 concurrent-edit).
4. Insert the new `PlatformFeePolicy` (version = prior + 1 at scope) and its `PlatformFeeTier` rows.
5. `recordAudit("platform.fee_policy_changed")` with full before/after terms (both versions' complete field sets — reconstructable without DB state).

Post-commit: none. No provider objects exist for fee agreements; Stripe sees a per-charge `application_fee_amount`, never a fee catalog.

### 4.2 Reading the agreement (org staff)

`GET /api/revenue/platform-fee-agreement` — `authorize("revenue.allocation_view")`, returns the **resolved effective terms** for the caller's org (current version summary + scheduled upcoming version + kind + effective window), never other orgs' terms, never plan-wide pricing tables. Read-only by construction: no org-scoped mutation route for fee data exists anywhere (Part AB auto-reject; enforced by test, §8.4).

### 4.3 Accrual at Revenue Review approval — inside the approval transaction

Runs as part of doc 03 §2.6's single `db.$transaction`, in step-5 territory (after totals freeze, alongside `TaxSnapshot`/`InstructorEarning`/allocation writes). Pure computation lives in `src/lib/platform-fee.ts` (framework-free, contract-tested — the `src/lib/billing.ts` idiom); the transaction only feeds it inputs and writes its outputs.

1. **Resolve** the agreement version per §3.3 at `approvedAt`.
2. **Resolve the rail** (`PlatformFeeRail`): the review's saved `PaymentMethodReference.type` — `CARD → CARD`, `US_BANK_ACCOUNT → ACH`. No saved method (manual invoice / offline expectation) → `OFFLINE`, which uses base (card) terms. The rail is an accrual-time expectation; §4.5 corrects it if collection happens on a different rail.
3. **Resolve tier** per §3.4 (if the version has tiers), yielding effective `bps` (+ per-rail override) for this review.
4. **Compute the base**: `feeBase = COLLECTED_PRETAX` (default) → frozen `Invoice.subtotal` (post-discount, pre-tax — discount lines are signed `InvoiceLine` rows already netted into subtotal); `COLLECTED_TOTAL` → frozen `Invoice.total`. Both are the just-frozen approval columns — never recomputed later.
5. **Compute the fee** per the formula in §6.2 (round, clamp, cap at `Invoice.total`, waiver/zero guards).
6. **Write the `PlatformFee` row** (`status ACCRUED`) with the full basis snapshot: `feePercentBps`/`feeFlatAmount` (the *applied* rail+tier numbers), `feeBase`, `appliedBaseAmount`, `amount`, `currency`, `policyId`/`policyVersion`, plus the Part 2 additions `railApplied`, `volumeAtAccrual`, `appliedTierIndex`, and `termsSnapshot` (the resolved version's complete terms including both rails and the tier table — so every later re-base under the snapshotted version, §4.5, is self-contained even if provenance FKs go null).
7. The **`PLATFORM_FEE` component of the APPROVAL allocation set's PROCEEDS dimension** equals `amount` (doc 12 §2.2 / doc 28) — the school sees its expected net at approval time.
8. **No ledger entries at accrual** (doc 12 §2.5, binding): fee journals post at settlement.

Post-commit (async): `recordAudit("revenue.platform_fee_accrued")` rides the approval's audit/event emission (doc 03 §2.6 step 6). The fee never blocks, delays, or reorders approval.

### 4.4 Carrying the fee to the provider — charge creation (async, post-commit)

Owned by the payment runner (doc 09; doc 22). Fee-relevant additions only:

1. Runner claims the `ScheduledCharge`/`PaymentAttempt` per doc 09's guarded-claim machinery (own transaction).
2. **Rail re-base check** (same claim transaction): if the attempt's method type implies a rail different from `PlatformFee.railApplied` (method was re-pointed in `FAILED`/`AWAITING_MANUAL`), recompute the fee for the actual rail **under `termsSnapshot`** (same version, same tier index — never a re-resolution) and write the signed difference into `reversedAmount` (doc 12 §2.3 mechanics), update `railApplied`, `recordAudit("revenue.platform_fee_reversed")` with the rail-switch reason. Effective fee = `amount − reversedAmount`, engine-guarded `≥ 0`.
3. — *async provider hop (never inside any transaction)* — `createCharge({...})` on the org's connected account (direct charge per [18-stripe-connect-decision.md](./18-stripe-connect-decision.md)) with `application_fee_amount = toMinorUnits(min(effectiveFee, attemptAmount), currency)` — the single tested minor-unit converter at the adapter boundary (ADR-027). The attempt's existing deterministic idempotency key (`sc_<scheduledChargeId>_a<attemptNumber>`, ADR-033) makes the fee exactly-once *with* the charge; a duplicate charge is impossible, therefore a duplicate fee collection is impossible. No separate fee idempotency key exists at charge time.
4. Zero effective fee (waiver, $0 default, fully re-based) → the charge is created **without** `application_fee_amount`.

### 4.5 Settlement — fee becomes EARNED (webhook reduce, own transaction)

Within the webhook reduce transaction of [23-webhooks-and-reconciliation.md](./23-webhooks-and-reconciliation.md) that settles the payment (card capture per D4, ACH settlement) and writes the `Payment` row:

1. Guarded `updateMany` claim: `PlatformFee` `ACCRUED → EARNED` (WHERE `revenueReviewId` AND `status = 'ACCRUED'`), stamping `earnedAt = now()` — the doc-13 §4.13 contract ("stamped in the settlement transaction").
2. Store `providerRef` = the Stripe application fee id (`fee_...`) from the charge object — opaque reference only.
3. **Offline settlements** (manual cash/check `Payment` recording that completes collection): same claim, `providerRef` stays null, `railApplied` set to `OFFLINE` if it wasn't (with the §4.4-step-2 re-base if offline terms differ — they don't by default, §5.1).
4. **Ledger journals** (sole writer `src/lib/ledger.ts`, same transaction, one balanced journal each; effective fee `F = amount − reversedAmount`):

| Rail | Journal at settlement |
|---|---|
| `CARD` / `ACH` (Connect — fee withheld from proceeds by Stripe) | `DR PLATFORM_FEE_EXPENSE F` / `CR PAYMENT_CLEARING F` |
| `OFFLINE` (no processor; AeroOps settles platform-side later) | `DR PLATFORM_FEE_EXPENSE F` / `CR PLATFORM_FEE_PAYABLE F` |

   With Connect fees withheld at source, `PLATFORM_FEE_PAYABLE` carries **only** offline-earned, not-yet-settled fees — exactly doc 12's reconciliation invariant R5.
5. Fees earn **only at full collection**: the claim runs in the settlement that moves the review to `CARD_PAID`/`PAID`. A partial offline payment leaves the fee `ACCRUED`. Simpler-workflow choice: whole-fee-at-full-collection over pro-rata earning on partials — partial collection is rare (offline installments), and pro-rata earning would make every fee report a moving fraction.

Post-commit: `recordAudit("revenue.platform_fee_earned")`.

### 4.6 Refunds (per doc 26) — proportional reversal

When a `Refund` succeeds (webhook reduce transaction for provider refunds; the manual-refund transaction for `MANUAL`/offline destinations):

1. If the snapshotted `refundReversesFee` is **false** → no fee change (AeroOps keeps its fee; the REFUND allocation set's PROCEEDS `PLATFORM_FEE` component is 0).
2. If **true** (default):
   - Provider rail: the refund execution (doc 26) passes `refund_application_fee: true`; the **provider-reported** application-fee-refund amount from the webhook is written into `reversedAmount` (cumulative) — provider actuals are money truth; our own computation is the *expectation* used for reconciliation (§7).
   - Offline/manual rail (no provider figure): `reversal = roundHalfUp(effectiveFee × refundAmount / netCollectedBeforeRefund)`, guarded `≤ effectiveFee`.
   - **Residue rule:** a refund that brings net collected to zero reverses the entire remaining effective fee exactly — no orphaned cents from repeated proportional rounding.
3. Status: `EARNED → PARTIALLY_REVERSED` (effective fee > 0) or `→ REVERSED` (effective fee = 0), via guarded claim.
4. Reversing ledger journal (same transaction): Connect rail `DR PAYMENT_CLEARING r` / `CR PLATFORM_FEE_EXPENSE r`; offline rail `DR PLATFORM_FEE_PAYABLE r` / `CR PLATFORM_FEE_EXPENSE r`.
5. The REFUND allocation set's PROCEEDS dimension carries the signed `PLATFORM_FEE` component `−r` (doc 12 §2.2).

Post-commit: `recordAudit("revenue.platform_fee_reversed")` with refund linkage.

### 4.7 ACH returns — un-earning a fee

An ACH return (doc 21/doc 24: settled payment later returned, R-code) arrives days after the fee flipped `EARNED`. The money never durably arrived, so the fee was never durably earned:

1. In the return's reduce transaction: guarded claim `PlatformFee` `EARNED → ACCRUED`, clear `earnedAt`, keep `providerRef` history in the audit entry; post the exact reversing journal of §4.5 step 4.
2. Stripe reverses the application fee on the returned charge automatically for direct-charge ACH returns; the reconciliation pass (§7) confirms provider actuals match.
3. If a later retry collects, §4.5 runs again — the fee re-earns with a fresh `earnedAt`.

`EARNED → ACCRUED` is an **additive extension** to doc 12 §2.3's lifecycle diagram (which predates Part R's `Returned` state) — recorded in §12 for the Part 1 refresh agents. Reversal semantics (`reversedAmount`) are deliberately *not* used here: a bounced settlement is "not yet collected", not "collected then given back", and reports must not count it as either earned or reversed.

### 4.8 Disputes

- Dispute **opened**: no fee change. The fee stays `EARNED`; speculative reversal would whipsaw reports on every won dispute.
- Dispute **LOST**: treated as a refund of the disputed amount for fee purposes — §4.6 runs with the disputed amount, honoring the snapshotted `refundReversesFee`. Under direct charges the provider does **not** auto-return the application fee on a lost dispute; the platform issues an application-fee refund via the adapter (post-commit provider hop) with deterministic idempotency key `pf_<platformFeeId>_dsp_<disputeId>`, confirmed by the subsequent `application_fee.refund.updated` event before `reversedAmount` is written from provider actuals.
- Dispute **WON** / `WARNING_CLOSED`: no fee change.
- The provider's **dispute fee** (e.g. Stripe's fixed dispute charge) is a processor cost of the merchant of record — the school, per doc 18 — posted to `PROCESSOR_FEES_EXPENSE` by payout ingestion (doc 23). It is never recorded as, netted into, or labeled an AeroOps fee (§6.6).

### 4.9 Voids and zero-total reviews

- Review voided pre-collection (doc 03 §6.4–6.5): the void transaction claims `PlatformFee` `ACCRUED → VOIDED`. AeroOps earns nothing on uncollected revenue (doc 12 §2.3, binding). `VOIDED` is terminal.
- Zero-total review (approved with confirm, `ScheduledCharge` resolves `COMPLETED`, no attempt): the §6.2 cap (`fee ≤ Invoice.total`) forces `amount = 0`; the row is still written (`ACCRUED → EARNED` in the same approval flow that marks the review `PAID`) so every review has exactly one fee row and reporting needs no special case.

---

## 5. Configuration surface

### 5.1 Platform-level (the only writable level)

| Setting | Where | Default | Notes |
|---|---|---|---|
| Global default agreement | `PlatformFeePolicy` (planId null, organizationId null) | `feePercentBps 0`, `feeFlatAmount 0`, `feeBase COLLECTED_PRETAX`, `refundReversesFee true`, no tiers, no ACH override | **$0 until the CEO pricing decision** (doc 12 §10 Q1, carried in §13). Shipping $0 keeps GA safe: no school is charged a fee nobody priced. |
| Per-plan agreements | `PlatformFeePolicy` (planId set) | none | Optional plan-tier pricing |
| Per-org agreements | `PlatformFeePolicy` (organizationId set) | none | Negotiated / introductory / waiver |
| ACH rail terms | `achFeePercentBps` / `achFeeFlatAmount` on any version | null (= card terms) | Per-rail pricing |
| Volume tiers | `PlatformFeeTier` rows on any version | none | §3.4 |
| Refund behavior | `refundReversesFee` on the version | `true` | Snapshotted per fee via `termsSnapshot`; applies to refunds and lost disputes (§4.6, §4.8) |
| Offline collections | — | fee applies (base terms) | Doc 12 §2.3's posture; commercial confirmation open (§13 Q2) |

`OFFLINE` rail terms are deliberately not separately configurable in Part 2: offline collections use base terms. A third rail column set would triple the console's surface for a case no pilot school has asked to price differently.

### 5.2 Org-level

**None writable.** Org staff get read-only surfaces (§4.2, §10.2). There is no org setting, flag, or override that changes fee math — Part AB auto-rejects "platform fee editable by organization staff", and this design satisfies it structurally: no route, no field, no UI.

---

## 6. Fee computation — base, formula, rounding, disclosure

### 6.1 The base: pre-tax collected, resolved at approval — decided and justified

**Base = `COLLECTED_PRETAX` (frozen `Invoice.subtotal`) by default.** Justification:

1. **Tax is pass-through.** The school collects tax on behalf of a jurisdiction and remits it; it never keeps that money. A fee on `total` would make AeroOps earn on funds the school merely forwards — schools in high-tax jurisdictions would pay AeroOps more for identical service. That fails the trustworthiness test with any accountant.
2. **Predictability.** Pre-tax fees are stable across locations and tax-rule changes; the owner can compute their effective rate from their own price sheet.
3. **`COLLECTED_TOTAL` remains available** per version for negotiated deals where total-based pricing was explicitly agreed — the choice is snapshotted, so a deal's meaning never drifts.

**Resolution instant = `approvedAt`.** Approval is when every other financial fact freezes (doc 03 §2.6); the approver sees the school's net (allocation preview) computed under exactly the agreement version in force at that moment. Using flight date would apply pricing to periods before the review existed; using collection date would make the approver-visible net a guess. Simpler-workflow choice: one resolution instant shared with every other snapshot, so "what the approver saw" and "what was charged" can never diverge by version.

**"Collected" discipline.** Although *resolved and computed* at approval, the fee is *earned* only on collection and is re-based downward by any pre-collection adjustment (doc 12 §2.3) — so the fee is always ultimately a function of what actually collected, under approval-time terms.

### 6.2 The formula (pure function, `src/lib/platform-fee.ts`)

```
railTerms(v, rail):            # v = resolved version terms (from termsSnapshot on re-base)
  CARD, OFFLINE → { bps: v.feePercentBps,                       flat: v.feeFlatAmount }
  ACH           → { bps: v.achFeePercentBps ?? v.feePercentBps, flat: v.achFeeFlatAmount ?? v.feeFlatAmount }

tierBps(v, rail, mtdVolume):   # only if v has tiers; else railTerms(v, rail).bps
  t = first tier by sortOrder where monthlyVolumeUpTo is null OR mtdVolume < monthlyVolumeUpTo
  → rail == ACH ? (t.achFeePercentBps ?? t.feePercentBps) : t.feePercentBps

appliedBase = feeBase == COLLECTED_PRETAX ? invoice.subtotal : invoice.total   # frozen Decimals

raw = roundHalfUp2dp(appliedBase × bps / 10000) + flat
fee = clamp(raw, minFee ?? raw, maxFee ?? raw)      # version-level clamps, both rails
fee = min(fee, invoice.total)                        # never exceeds what the customer pays (cap wins over minFee)
if v.kind == WAIVER → fee = 0                        # belt-and-braces; validation already forced zeros
```

All arithmetic in Prisma `Decimal` (ADR-027) — bps math is exact; the single rounding point is `roundHalfUp2dp`. Minor-unit conversion happens **only** at the provider-adapter boundary (§4.4 step 3). Percent is always integer basis points — float percentages are banned (doc 13 §2).

### 6.3 Rounding rules (currency-safe)

| Operation | Rule |
|---|---|
| Percent application | Exact Decimal multiply, then round half-up to 2 dp — once |
| Proportional refund reversal (offline rail) | Round half-up to 2 dp per refund; cumulative `reversedAmount ≤ amount`; full-refund residue rule (§4.6) absorbs remainder |
| Provider-rail refund reversal | Provider-reported amount copied verbatim (already in whole minor units) |
| Allocation interaction | The fee amount enters PROCEEDS as-is; **all rounding residue in the PROCEEDS dimension lands in `SCHOOL_RETAINED_REVENUE`, never in the fee** (doc 12 §2.2, binding — the fee is never inflated by a rounding crumb) |
| Minor units | `toMinorUnits(Decimal, currency)` — the one tested converter; USD-only in Parts 1–2, exponent-aware by contract for later currencies |

### 6.4 Term validation (at version creation)

- `feePercentBps`, `achFeePercentBps`, tier bps: integers, `0 ≤ bps ≤ 10000`.
- `feeFlatAmount`, `achFeeFlatAmount`, `minFee`, `maxFee`: `≥ 0`, `Decimal(12,2)`; `minFee ≤ maxFee` when both set.
- `kind WAIVER` ⇒ every numeric term = 0 and no tiers.
- Tiers: `sortOrder` contiguous from 0; `monthlyVolumeUpTo` strictly increasing; exactly the last tier has `monthlyVolumeUpTo = null`; at least 2 tiers if any.
- `currency` uppercase ISO 4217 from the `src/lib` catalog; org-scope versions must match the org's currency.
- Effective window: §3.2 (no overlap, no retroactivity).

### 6.5 Snapshot semantics (ADR-028 compliance)

The `PlatformFee` row is the immutable point-in-time fact: applied bps/flat/base/rail/tier/volume, `appliedBaseAmount`, `amount`, `currency`, policy provenance, and `termsSnapshot` (full version terms) — written once in the approval transaction. The **only** mutable columns are `status`, `reversedAmount`, `earnedAt`, `railApplied`, and `providerRef`, each transition a guarded `updateMany` claim with audit (doc 12 V2). Changing an agreement never touches existing fees; recomputation after approval always runs under `termsSnapshot`, never against current policy.

### 6.6 Disclosure rules (spec Part W, binding on every surface)

| Audience | What they see |
|---|---|
| **Students / payers** | **Nothing.** No fee line on invoices or receipts, no fee field in any payer/student API response, no fee amount in payment UI. The customer pays the school's prices; the fee is a cost inside the school's proceeds, exactly like card processing. Payer-surface routes must not select `PlatformFee`/`PlatformFeePolicy` (tested, §8.4). If a future legal/commercial requirement forces disclosure, that is a deliberate product change — not a toggle shipped now. |
| **Org staff** (financial roles) | Full transparency: agreement terms summary (§4.2), per-review fee in the allocation preview and approval snapshot, "Platform fees this period" dashboard tile, and the Platform Fee Statement report (doc 12 §2.8) — accrued / earned / reversed by period. Positioning confirmation is §13 Q4. |
| **Platform staff** | Everything, per §8.1 permissions. |

**Labeling (auto-reject territory):** the AeroOps fee is always labeled **"AeroOps platform fee"**. Stripe's processing cost is always labeled **"Payment processing fees"** (`PROCESSOR_FEES_EXPENSE`, populated by payout ingestion — doc 23). The two are never summed into one line, never shown under one heading, and no surface may describe the AeroOps fee as a Stripe/processing fee or vice versa. Exports carry them as distinct mapped keys in `AccountingMapping`.

---

## 7. Reconciliation (per [23-webhooks-and-reconciliation.md](./23-webhooks-and-reconciliation.md))

The fee has an *expectation* (local computation) and an *actual* (provider-reported application fee amounts on charges, application-fee refunds, and payout balance transactions). The reconciliation pass compares them per payment:

| Check | Expected | Actual | On drift |
|---|---|---|---|
| Fee collected | `min(effectiveFee, attemptAmount)` at charge creation | Charge's application fee amount (from `PaymentProviderEvent` payload / balance transaction) | `ReconciliationException` kind `FEE_MISMATCH` with `expectedAmount`/`actualAmount`/`currency` |
| Fee refund | §4.6 proportional expectation | Provider application-fee-refund amount | Amount copied to `reversedAmount` regardless (provider = money truth); exception opened if drift > $0.02 |
| Fee present but no local `EARNED` | — | Application fee on a settled charge with local fee not `EARNED` | `FEE_MISMATCH` (processing gap) |
| Local `EARNED` (Connect rail) but no provider fee | Effective fee > 0 | No application fee on the charge | `FEE_MISMATCH` (charge created without fee — runner bug) |
| Ledger invariant R5 | `PLATFORM_FEE_PAYABLE` balance | Σ offline-earned, not-yet-settled effective fees | `UNBALANCED_JOURNAL`/`FEE_MISMATCH` per doc 12 §2.6 |
| Unpriced reviews (platform-side report, not an org exception) | Global default exists with non-zero terms | `PlatformFee` rows with `policyId null` | Platform Console fee report flag (§10.1) — AeroOps' pricing gap, not the org's books |

Exceptions are org-scoped rows in the existing `ReconciliationException` queue (`OPEN → RESOLVED | IGNORED`, required `resolutionNote`). The Payout Reconciliation report (doc 12 §2.8) already links each payout's balance transactions to their `PlatformFee` rows — no new report shape is needed, only population.

---

## 8. RBAC, approvals & audit

### 8.1 Platform-side (the only write path)

Two new keys in the `PLATFORM_PERMISSIONS` catalog (`src/lib/platform-permissions.ts` — data change, house pattern):

| Key | Meaning | Granted to (`PLATFORM_ROLE_PERMISSIONS`) |
|---|---|---|
| `platform.fees.view` | View platform fee agreements, fee reports, unpriced-review flags | `FOUNDER_SUPER_ADMIN`, `FOUNDER` (Platform Admin Plus), `PLATFORM_ADMIN`, `BILLING_ADMIN` (Platform Billing) — plus `AUDITOR` (Platform Read Only) automatically via the `VIEW_ONLY` derivation |
| `platform.fees.manage` | Create/supersede agreement versions at any scope; delete never-effective drafts | `FOUNDER_SUPER_ADMIN`, `FOUNDER`, `PLATFORM_ADMIN`, `BILLING_ADMIN` |

Routes derive role lists via `platformRolesWith()` — never hardcoded role arrays. All fee-agreement mutations pass `authorizePlatform({ mutating: true })` (refused under read-only impersonation, constitution-tested); org-scoped agreement routes also pass `orgId` for restricted-staff scope enforcement. `SUPPORT_ENGINEER`, `CUSTOMER_SUCCESS`, and `SOFTWARE_ENGINEER` get neither key — pricing is a commercial capability, aligned with the existing `platform.pricing.change` boundary.

### 8.2 Org-side (read-only)

- Agreement summary, fee tiles, Platform Fee Statement: `revenue.allocation_view` (Part 1 key — financial reporting audience). No new org permission.
- No org permission grants any fee write. `revenue.payment_policy_manage` governs *timing*, never fees.

### 8.3 Audit actions (names bound in doc 12 §6; reused, not reinvented)

| Action | When | Metadata (reconstructable without DB state) |
|---|---|---|
| `platform.fee_policy_changed` | Version create/supersede/draft-delete | Scope, both versions' full terms incl. tiers, effective windows, actor platform user |
| `revenue.platform_fee_accrued` | Approval tx (post-commit record) | Review/invoice ids, applied terms, base, rail, tier, volume, amount, policy id+version |
| `revenue.platform_fee_earned` | Settlement claim | Amounts, rail, providerRef, payment linkage |
| `revenue.platform_fee_reversed` | Refund/dispute/adjustment/rail re-base | Signed delta, cumulative `reversedAmount`, cause linkage (refundId/disputeId/adjustmentId/attemptId) |
| `revenue.platform_fee_voided` | Void tx | Review id, reason |

No new domain events: fee transitions are audit-grade platform/tenant bookkeeping, and dashboards read snapshot rows. (`payment.succeeded` etc. already fire from their owning flows; registering fee events with no consumer would violate the WEBHOOK_EVENTS live-emit-site rule.)

### 8.4 Machine-enforced guarantees (Part AB / Part AC)

- Static scan test: no route under `src/app/api/` outside `api/platform/**` may write `PlatformFeePolicy`/`PlatformFeeTier` (regex over route sources, the `dispatch-idempotency.test.ts` idiom) — structurally encodes "platform fee editable only by platform roles".
- Static scan test: no route under payer/student self-service surfaces selects `platformFee`/`platformFeePolicy`.
- Contract tests on the pure engine (no DB, no Stripe credentials): every §3.1 model, clamps, cap-over-min, zero-total, waiver, rail fallback, tier boundaries (exactly-at-threshold), proportional reversal + residue rule, rail-switch re-base under `termsSnapshot`, and rounding half-up cases — the spec Part AC "platform fee calculation" entry.
- `tests/schema-governance.test.ts` auto-covers the extended models; `PlatformFeeTier` carries no `organizationId` by design (platform-owned child data, like `SubscriptionPlan`) — catalogued in the governance allowlist with a written reason.

---

## 9. Failure modes & edge cases

| # | Case | Behavior |
|---|---|---|
| F1 | No agreement resolves (no global default) | $0 fee accrues with `policyId null`; approval proceeds; structured warn log; platform fee report flags the unpriced review (§7). Never blocks the school. Simpler-workflow choice: AeroOps forfeits an unpriced fee rather than stalling a school's approval on a platform misconfiguration. |
| F2 | Agreement currency ≠ review currency | Same as F1 ($0 fee, flagged) — a platform pricing error must not block tenant operations. Single-currency Parts 1–2 makes this near-impossible; the guard exists for the multi-currency future. |
| F3 | `minFee` exceeds invoice total | Cap wins: fee = `Invoice.total` (§6.2). A $5 minimum on a $3 review charges $3, never creates negative school proceeds. |
| F4 | Effective fee exceeds attempt amount (partial amount due after credits) | Charge-time cap `min(effectiveFee, attemptAmount)`; shortfall surfaces as expected-vs-actual drift → informational `FEE_MISMATCH` (§7). |
| F5 | Concurrent approvals racing MTD tier volume | Each approval reads committed rows at its own tx time; two same-instant approvals may both land in the lower tier. Accepted slack (documented) — tier boundaries are commercial, not accounting, precision. |
| F6 | Method re-pointed to a different rail after accrual | §4.4 step 2 re-base under `termsSnapshot`, audited. Never re-resolves current policy. |
| F7 | ACH return after fee earned | `EARNED → ACCRUED` revert + reversing journal (§4.7); retry re-earns. |
| F8 | Refund with `refundReversesFee false` | Fee retained; REFUND allocation set's fee component = 0; org's statement shows retained fee explicitly (no silent netting). |
| F9 | Dispute lost after partial refund | Reversal capped: cumulative `reversedAmount ≤ amount`; residue rule applies when net collected hits zero. |
| F10 | Version created while another admin superseding same scope | Step-3 guarded update fails → 409 with conflicting version named; no torn windows (§4.1). |
| F11 | Plan change mid-month | Resolution uses the plan at each review's `approvedAt`; MTD tier volume is org-level and unaffected (§3.4). |
| F12 | Review voided after accrual | Fee `VOIDED` in the void tx (§4.9); regeneration accrues a fresh fee on the new review under the version effective at *its* approval. |
| F13 | Webhook replay / duplicate settlement events | Guarded claims are idempotent (`ACCRUED → EARNED` count-0 no-op); `PaymentProviderEvent` unique-insert already dedupes upstream (ADR-033). |
| F14 | Offline payment recorded for a review whose fee was rail-based on CARD | §4.5 step 3 re-base to OFFLINE terms (identical to base in Part 2 → delta 0), `railApplied` corrected for reporting truth. |

---

## 10. UX notes

### 10.1 Platform Console (extends [19-connected-account-onboarding.md](./19-connected-account-onboarding.md)'s console section)

- **Org detail page** (`src/app/platform/organizations/[id]/page.tsx`): new gated **"Platform Fee Agreement"** panel (existing panel-component idiom) — current effective version (kind badge, terms in plain language: "2.9% of pre-tax collected revenue (card) · 0.8% (ACH) · min $0.50"), scheduled upcoming version, full version history timeline with actor + audit linkage, and the resolved-from indicator ("Using plan default — no org agreement"). Visible with `platform.fees.view`; "New version" action with `platform.fees.manage`.
- **Global fee administration** (`/platform/fees`): global default + per-plan agreements, same version-chain UI; the unpriced-reviews flag (§7) surfaces here.
- **Version creation wizard**: scope → kind → terms (per-rail, tiers) → effective window → **worked examples** ("a $500 pre-tax card review this month → $15.00 fee; ACH → $4.00") → diff against the current version → confirm with consequence wording: "Create fee agreement version 4 for Coastal Flight Academy — takes effect Aug 1, 2026 (UTC)". Every computed number carries its reasons (house rule).
- Fee reports bucket **earned** figures on `earnedAt`, accrual counts on `createdAt` — mirroring doc 13's field contract.

### 10.2 Org-facing (tenant app)

- **Settings → Revenue → "AeroOps fee"**: read-only card with the resolved effective terms and effective-since date, plus one sentence of positioning ("AeroOps charges this fee only on revenue you actually collect. It is separate from card processing costs."). Gated `revenue.allocation_view`. No edit affordance exists — not a disabled button; the surface is informational by design.
- **Revenue Dashboard**: "Platform fees this period" tile (doc 12 §2.8) — `EARNED` by period.
- **Approval screen**: the allocation preview (doc 03) shows "AeroOps platform fee −$X · Estimated net to school $Y". The approve control wording is unchanged (doc 03's table is binding — the fee never appears in the button).
- **Platform Fee Statement** report: accrued / earned / reversed per period with per-review drill-down — the org's audit view of AeroOps' fee.

### 10.3 Student/payer surfaces

None. See §6.6. Receipts and invoices render the school's lines and totals only.

---

## 11. Out of scope for Part 2 / deferred to Part 3+

- **Platform-side settlement of offline-earned fees** (invoicing the school via SaaS billing, or netting against future Connect payouts): Part 2 records the receivable (`PLATFORM_FEE_PAYABLE`) and reports it in the console; the collection mechanism is Part 3 + the commercial decision (§13 Q2).
- **Fee revenue recognition on AeroOps' own books** (platform-side accounting beyond the tenant-ledger mirror) — the tenant's `LedgerEntry` spine is the tenant's books; AeroOps' corporate accounting is out of product scope.
- **Surcharging / passing the fee to customers** as an invoice line — rejected for Part 2 (disclosure posture §6.6; card-network surcharge rules are a compliance project of their own).
- **Per-Revenue-Item or per-category fee rates**, custom fee formulas, and rule-engine pricing — the §3.1 model set covers every spec-required agreement; anything richer needs a real commercial driver first.
- **Retroactive volume true-ups / marginal tiering** (§3.4 rejected alternative).
- **Manual platform adjustments to individual accrued fees** (goodwill credits on a single fee) — Part 3 if needed; until then the version chain + waiver covers commercial gestures.
- **Multi-currency agreements** — blocked on the org-currency decision (doc 13 §12); the currency guards (F2, §6.4) are already in place.

---

## 12. Part 1 consistency notes (for the designated refresh agents — not edited here)

1. **Doc 12 §2.3 lifecycle diagram**: this doc adds the `EARNED → ACCRUED` revert for ACH returns (§4.7) — an additive transition motivated by spec Part R's `Returned` state, which Part 1 did not model. No Part 1 semantics are weakened ("AeroOps earns nothing on uncollected revenue" is *strengthened*). Doc 12's diagram should gain the transition when refreshed.
2. **Doc 13 §4.13 `PlatformFeePolicy`/`PlatformFee`**: additive columns + `PlatformFeeTier` child table (§5 here; final call in [34-part2-database-additions.md](./34-part2-database-additions.md)). All doc-13 fields, uniques, and FK actions unchanged.

---

## 13. Data model additions (Prisma-flavored; final shapes in [34-part2-database-additions.md](./34-part2-database-additions.md))

New enums (additive; own DDL migration before first use, doc 14 rule):

```prisma
enum PlatformFeeRail {
  CARD
  ACH
  OFFLINE
}

enum PlatformFeePolicyKind {
  STANDARD
  INTRODUCTORY
  NEGOTIATED
  WAIVER
}
```

`PlatformFeePolicy` — doc 13 §4.13 shape retained verbatim, plus:

```prisma
model PlatformFeePolicy {
  // ...all doc-13 fields unchanged (feePercentBps, feeFlatAmount, feeBase,
  // minFee, maxFee, currency, refundReversesFee, effectiveFrom, effectiveTo,
  // version, planId, organizationId, createdAt, relations)...

  kind             PlatformFeePolicyKind @default(STANDARD) // display/audit metadata; WAIVER additionally validated to all-zero terms
  label            String?                                  // console display, e.g. "Founding-school intro — 6 months"
  achFeePercentBps Int?                                     // null = card terms apply to ACH
  achFeeFlatAmount Decimal?              @db.Decimal(12, 2) // null = card flat applies to ACH

  tiers PlatformFeeTier[]
}
```

`PlatformFeeTier` — new child table (platform-owned data, like `SubscriptionPlan`; no `organizationId` — catalogued in the schema-governance allowlist with this reason):

```prisma
/// Volume tier rows of one PlatformFeePolicy version. Selection: first row by
/// sortOrder whose monthlyVolumeUpTo is null (top tier) or exceeds the org's
/// month-to-date accrued fee base (UTC calendar month). Percent-only overrides;
/// flat amounts and clamps stay on the version. Immutable once the version is
/// effective (versions are append-only, §3.2).
model PlatformFeeTier {
  id                String   @id @default(cuid())
  policyId          String
  sortOrder         Int
  monthlyVolumeUpTo Decimal? @db.Decimal(14, 2) // null = top tier (unbounded)
  feePercentBps     Int
  achFeePercentBps  Int?                        // null = card bps applies to ACH in this tier
  createdAt         DateTime @default(now())

  policy PlatformFeePolicy @relation(fields: [policyId], references: [id], onDelete: Cascade)

  @@unique([policyId, sortOrder])
}
```

`PlatformFee` — doc 13 §4.13 shape retained verbatim, plus:

```prisma
model PlatformFee {
  // ...all doc-13 fields unchanged (organizationId, revenueReviewId @unique,
  // invoiceId, status, feePercentBps, feeFlatAmount, feeBase, appliedBaseAmount,
  // amount, reversedAmount, currency, policyId, policyVersion, providerRef,
  // earnedAt, createdAt, updatedAt, relations, indexes)...

  railApplied      PlatformFeeRail?                    // accrual-time expected rail; corrected at collection (§4.4–4.5)
  volumeAtAccrual  Decimal?         @db.Decimal(14, 2) // MTD volume used for tier selection — the fee's "reasons"
  appliedTierIndex Int?                                // sortOrder of the tier applied (null = untiered)
  /// Write-once copy of the resolved agreement version's complete terms
  /// (both rails + tier table + refundReversesFee + kind). Every post-approval
  /// recompute (rail switch, adjustment re-base) runs against THIS, never
  /// against current policy — self-contained even if policyId goes null.
  termsSnapshot    Json?
}
```

Migration placement: these additions ride Part 2's schema slice per [14-migration-plan.md](./14-migration-plan.md) ordering — enums first in their own migration, columns/table with M14's allocation/fee group (must exist before the approval engine ships). All additive; nullable columns mean pre-existing rows (none expected — the tables are new in Part 2) need no backfill.

---

## 14. Open questions

| # | Question | Owner | Default until decided |
|---|---|---|---|
| Q1 | **Commercial terms**: global default `feePercentBps`/`feeFlatAmount`, per-rail numbers, tier schedule, per-plan pricing (carried from doc 12 §10 Q1; ROADMAP flags "pricing/fees decision needed") | CEO / product owner | Global default $0 — no school is charged an unpriced fee |
| Q2 | **Offline collections**: confirm the fee applies to cash/check collections (doc 12 §2.3 posture, kept here), and choose the Part 3 settlement mechanism for offline-earned fees (platform invoice via SaaS billing vs netting against Connect payouts) | CEO / product owner | Fee accrues + earns on offline; settlement deferred, receivable reported (§11) |
| Q3 | **Lost disputes**: confirm `refundReversesFee = true` also governs lost disputes (this doc's §4.8 default — AeroOps returns its fee on charged-back revenue) vs a separate dispute flag | Product owner | Same flag governs both |
| Q4 | **Org transparency positioning** (doc 12 §10 Q5): confirm fee-transparent-to-org (agreement summary, per-review fee, Platform Fee Statement — this doc's design) vs netting invisibly into settlement. Spec Part W requires hiding only from *students*; org visibility is the open commercial call. Changes UX copy only, not the data model. | CEO / product owner | Transparent to org financial roles |
| Q5 | **Doc 12 lifecycle refresh**: mirror the additive `EARNED → ACCRUED` ACH-return transition (§4.7, §12) into doc 12 §2.3's diagram | Part 1 refresh agent | This doc is authoritative for Part 2 implementation |
