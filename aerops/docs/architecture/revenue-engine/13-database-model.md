# Database Model Proposal

> **Status:** Proposed — Phase 8 Part 1 · **Date:** 2026-07-10 · **Lead roles:** Database Architect; Principal Software Architect at Stripe; Financial Systems Architect · **Part of:** Revenue Engine design set ([README](./README.md))

This document is **canonical and binding** for the Revenue Engine data model. Where a design doc (00–12) and this document disagree on a name, type, constraint, or FK action, **this document wins**; every such override is listed in §3 so the consistency pass can align the other docs. Parts 2–3 implement the schema exactly as written here (sequencing and backfills per [14-migration-plan.md](./14-migration-plan.md)).

Scope: design only. Nothing here touches `prisma/schema.prisma` in Part 1; no migration is generated or run.

---

## 1. Part L audit — expected concepts → dispositions

Every model/concept named in spec Part L, audited against the current schema (`prisma/schema.prisma`, 54 models — field-level inventory in [00-current-billing-audit.md](./00-current-billing-audit.md)).

| Spec concept | Disposition | Canonical model | Notes |
|---|---|---|---|
| DispatchRecord | **Exists — extend** | `Dispatch` (schema ~L905) | Never a parallel model. Gains direct `organizationId` (backfilled), location, payer, pricing selection, checkout/return capture, restriction snapshot, timestamps (§4.2) |
| AircraftCheckOut | **Not needed as a model** | `Dispatch` release fields | Checkout is the PENDING→RELEASED transition + release-capture columns; splitting it into its own table would fragment one operational fact |
| AircraftCheckIn | **Not needed as a model** | `Dispatch` closeout fields | Return/closeout is RELEASED→CLOSED + return-capture columns (aviation-native vocabulary per doc 02; "check-in" appears only as spec mapping) |
| RevenueReview | **New model** | `RevenueReview` (+ `RevenueReviewApproval`) | Customer-facing workflow record wrapping exactly one backend `Invoice` (doc 03) |
| BillingCalculation | **Not needed as a table** | pure engine + snapshots | Calculation is a pure function (successor of `lib/billing.ts`); its *result* persists as InvoiceLine rows, `rateResolution` traces, and the approval snapshot. A stored calculation table would be a computed-value cache (banned by DATABASE_STANDARDS) |
| AircraftPricingProfile | **New model** | `AircraftPricingProfile` | Versioned, effective-dated, approval-gated (doc 05) |
| InstructorRateProfile | **New model** | `InstructorRateProfile` + `InstructorRateProfileLine` | One model, `kind` = BILLING \| COMPENSATION (doc 04, principle 6 structural) |
| InstructorTimeEntry | **New model** | `InstructorTimeEntry` | Categorized time on a Revenue Review (doc 04) |
| RevenueItem | **New model** | `RevenueItem` + `RevenueItemLocation/Program/Aircraft` | Org catalog, 26 seeded built-ins (doc 06) |
| RevenueReviewLineItem | **Exists — extend** | `InvoiceLine` | **Binding: there is no separate review-line model.** Review lines *are* `InvoiceLine` rows on the wrapped draft Invoice (§3 R1). Spec's "…LineItem" maps to the existing `InvoiceLine` name |
| TaxSnapshot | **New model** | `TaxSnapshot` + `TaxSnapshotItem` (+ `TaxRule`) | Append-only approval-time tax facts (doc 07) |
| DiscountAdjustment | **New model** | `RevenueAdjustment` | One umbrella adjustment record for all eight Part H operations (doc 08), plus `CustomerCredit`, `CreditApplication`, `PromoCode`, `PromoCodeRedemption` |
| ResponsiblePayer | **New model** | `ResponsiblePayer` | Org-scoped paying party, optional global `User` link (doc 11) |
| StudentPayerRelationship | **New model** | `StudentPayerRelationship` | Default-payer routing + capabilities + consent (doc 11) |
| Invoice | **Exists — extend** | `Invoice` (schema ~L1099) | Additive: currency, frozen totals, `approvedAt`, payer, `updatedAt`. Existing rows never reinterpreted |
| InvoiceLineItem | **Exists — extend** | `InvoiceLine` (schema ~L1132) | Existing name kept (canonical vocabulary). Additive provenance/snapshot/tax/adjustment columns |
| InvoiceApproval | **Covered — no new model of that name** | `RevenueReviewApproval` + `Invoice.approvedAt` | Approval is a review-level act; the invoice records only the lock marker |
| PaymentCustomer | **New model** | `PaymentCustomer` | Provider customer mapping per (org, paying party) (docs 09/11) |
| PaymentMethodReference | **New model** | `PaymentMethodReference` | Opaque provider reference + safe display metadata only (principle 8) |
| PaymentAttempt | **New model** | `PaymentAttempt` | Append-only charge tries with deterministic idempotency keys (doc 09) |
| PaymentTransaction | **Exists — extend** | `Payment` (schema ~L1154) | The settled-money record *is* `Payment`, hardened (currency, org scope, attempt link, Restrict FK). No new model |
| Refund | **New model** | `Refund` | Execution record 1:1 with its REFUND adjustment (doc 08); provider mechanics in Part 2 |
| Dispute | **New model — shape bound now, populated in Part 2** | `Dispute` | Needs provider webhooks to have a writer; schema ships with the payment slice so Part 2 adds no DDL surprise |
| RevenueAllocation | **New model** | `RevenueAllocation` | Signed, set-balanced, two-dimension splits (doc 12) |
| InstructorEarning | **New model** | `InstructorEarning` | Append-only compensation snapshots; merged shape (§3 R6) |
| PlatformFee | **New model** | `PlatformFee` + `PlatformFeePolicy` | Accrued at approval, earned at collection (doc 12) |
| WebhookEvent | **New model — renamed** | `PaymentProviderEvent` | Name avoids collision with the existing *outbound* `Webhook`/`WebhookDelivery` models (§3 R16). Unique `[provider, providerEventId]` |
| FinancialExportJob | **New model** | `FinancialExportJob` | ImportJob idiom in reverse; Part 3 executes (doc 12) |
| AccountingMapping | **New model** | `AccountingMapping` | Internal taxonomy → external chart of accounts (doc 12) |

Additional models the design set requires beyond the spec's expected list:

| Model | Why it exists | Owner doc |
|---|---|---|
| `RevenueWorkflowPolicy` | Org approval-workflow configuration (typed columns, not a settings blob) | 03 |
| `DispatchPolicy` | Org operational capture/validation configuration | 02 |
| `CheckoutRestrictionPolicy`, `DispatchRestrictionDecision` | Part J restriction config + immutable override/review decisions | 10 |
| `OrgPaymentPolicy` | Part I payment timing configuration | 09 |
| `ScheduledCharge` | Per-approval collection anchor; the exactly-once heart of collection | 09 |
| `TaxRule` | Effective-dated, versioned org/location tax rules | 07 |
| `CustomerCredit`, `CreditApplication`, `PromoCode`, `PromoCodeRedemption` | Part H credits and promo codes | 08 |
| `LedgerEntry` | Append-only double-entry reconciliation spine | 12 |
| `ProviderPayout`, `ReconciliationException` | Payout matching + exception queue | 12 |
| `RevenueSettings` | Org Revenue Engine settings singleton (consolidated here, §4.14) | 04/05/07/08/11/12 |
| `OrgSequence` | Gap-tolerant per-org number allocator for `RR-`/`ADJ-`/new `INV-` numbers (§7) | 13 (this doc) |

**Verdict:** 43 new models, 4 extended models (`Dispatch`, `Invoice`, `InvoiceLine`, `Payment`), back-relations on 8 more, 0 renamed, 0 dropped, 0 reinterpreted.

---

## 2. Binding money & currency decision

### 2.1 Representation: Prisma `Decimal`, not integer minor units

**Decision: all monetary values are Prisma `Decimal` (Postgres `numeric`) with an explicit ISO 4217 currency column on every new financial model.**

Rationale vs integer minor units:

- The entire existing schema is `Decimal` (`unitPrice`, `accountBalance`, `costParts`, …) and DATABASE_STANDARDS mandates "Money = `Decimal`, never float". Introducing integer cents would put two money representations in one database — every join, import, export, and report becomes a conversion hazard, which is exactly how off-by-100 bugs ship.
- Postgres `numeric` is exact; the float risk integer-cents guards against does not exist here. JS boundaries already convert explicitly (`Number(...)`/`Prisma.Decimal`), and all financial arithmetic runs server-side in Decimal (docs 06/07: client-supplied figures are never trusted).
- ISO 4217 minor-unit variance (JPY exponent 0, KWD exponent 3) is a **provider-boundary** problem: the Part 2 Stripe adapter converts `(Decimal, currency)` → provider minor units in one tested function. Storing minor units app-wide would bake one provider's wire format into the domain model.
- Migration safety (spec Part L): "convert monetary values without an explicit plan" is forbidden — staying Decimal means **no conversion at all** for existing rows.

### 2.2 Precision by field class (binding)

| Field class | Type | Examples |
|---|---|---|
| Monetary amounts, totals, rates, thresholds — **all new columns** | `Decimal @db.Decimal(12, 2)` | `RevenueReview.totalAtApproval`, `PaymentAttempt.amount`, `InstructorEarning.rate`, `AircraftPricingProfile.rateAmount`, policy thresholds |
| Existing monetary columns | **unchanged** | `InvoiceLine.unitPrice (10,2)`, `Payment.amount (10,2)`, `Student.accountBalance (10,2)`, `Instructor.hourlyRate (8,2)` — never re-typed in Part 1 |
| Values written back into an existing column | match the target column | `RevenueAdjustment.correctedUnitPrice` is `(10,2)` because it replaces `InvoiceLine.unitPrice (10,2)` |
| Percentages (discounts, linkage) | `Decimal @db.Decimal(5, 2)` | `percentOfBilling`, `discountSecondApprovalPercent` |
| Tax rates | `Decimal @db.Decimal(7, 4)` | `TaxRule.ratePercent` (6.0000 = 6%) |
| Platform fee percent | `Int` basis points | `feePercentBps` (no rounding ambiguity in policy) |
| Hours (instructor time) | `Decimal @db.Decimal(6, 2)` | `InstructorTimeEntry.hours` |
| Meters (Hobbs/Tach) | `Decimal @db.Decimal(9, 1)` | existing convention, reused on `RevenueReview` snapshots |
| Quantities on lines | existing `Decimal(8, 2)` | `InvoiceLine.quantity` unchanged |

`Decimal(12,2)` bounds a single value at 9,999,999,999.99 — four orders of magnitude above any plausible flight-school charge, small enough to catch fat-finger corruption at the type layer.

### 2.3 Currency columns (binding)

- Type: `String @db.Char(3)`, uppercase ISO 4217, validated against a catalog in `src/lib` (the `modules`/`permissions` String-catalog convention). Not a Postgres enum — currency lists grow, and enum extension requires migrations.
- **New models:** required, `@default("USD")`.
- **Extended legacy models** (`Invoice`, `Payment`): nullable column added, then a separate idempotent data migration backfills `"USD"`; `NOT NULL` tightening is a later release (additive-only rule).
- **One currency per document:** `InvoiceLine` carries no currency — lines inherit the invoice's; `RevenueReview.currency` must equal its invoice's; `ScheduledCharge`/`PaymentAttempt`/`Refund` amounts must equal the review currency (engine-enforced invariant, checked in-transaction). Part 1 additionally requires every currency to equal the org currency (multi-currency is out of scope; the columns make the data model ready).
- **Non-document money rows:** `PlatformFeePolicy.currency` (required, `@default("USD")`) denominates `feeFlatAmount`/`minFee`/`maxFee`; `ReconciliationException.currency` is nullable and set whenever `expectedAmount`/`actualAmount` are recorded. Every other new financial model (`TaxSnapshot`, `RevenueAdjustment`, `CustomerCredit`, `Refund`, `Dispute`, `ScheduledCharge`, `PaymentAttempt`, `RevenueAllocation`, `InstructorEarning`, `PlatformFee`, `LedgerEntry`, `ProviderPayout`) carries a required `currency` per the new-models rule above.

---

## 3. Naming & shape resolutions (canonical overrides)

Every decision below overrides or arbitrates something in docs 00–12. The consistency reviewer should align those docs to this table.

| # | Binding decision | Overrides / arbitrates | Why |
|---|---|---|---|
| R1 | **No `RevenueReviewLine` model.** Revenue Review lines are `InvoiceLine` rows on the review's wrapped draft `Invoice`. Doc 06's contributed line fields land on `InvoiceLine` as additive nullable columns (§4.2.3). `TaxSnapshotItem.reviewLineId` → **`invoiceLineId`**. | 02 (`RevenueReviewLine` skeleton), 06 (§4.2 "contributes to RevenueReviewLine"), 07 (`reviewLineId`); adopts 03 (§ "lines are InvoiceLine rows") | One line table for draft, approved, and adjustment lines: doc 08 already appends adjustment lines as `InvoiceLine`; two tables would mean a copy step at approval, doubled code paths, and empty draft invoices in every legacy billing surface. Reuse-and-extend beats a parallel abstraction (CLAUDE.md §3) |
| R2 | Line origin enum is **`RevenueLineOrigin { PRICING, INSTRUCTOR_TIME, RULE, RETURN_CAPTURE, MANUAL, ADJUSTMENT }`** on `InvoiceLine.origin` (nullable; `null` = pre-Phase-8 legacy row). | 02 (`source SYSTEM_SUGGESTED \| CHECK_IN_FEE \| INSTRUCTOR_ENTERED \| MANUAL`), 06 (4-value `PRICING \| RULE \| CHECK_IN \| MANUAL`) | Doc 06's names + the two origins it lacked: instructor-time lines (doc 04) and adjustment-materialized lines (doc 08). Doc 02's `SYSTEM_SUGGESTED` = `PRICING`; `INSTRUCTOR_ENTERED` = `INSTRUCTOR_TIME`; doc 06's `CHECK_IN`/doc 02's `CHECK_IN_FEE` = **`RETURN_CAPTURE`** — "check-in" is banned vocabulary (AVIATION_STANDARDS: schema, APIs, and UI share the aviation-native vocabulary end-to-end), and enum values are never renamed once shipped, so the banned word must not enter a permanent enum |
| R3 | Review numbers are **`RR-<seq>`**; adjustments **`ADJ-<seq>`**; new invoices move to **`INV-<seq>`** — all allocated from the new `OrgSequence` model inside the creating transaction (§7). Existing invoice numbers untouched. | 02 (`REV-####`); implements the mechanism 03/08 delegated here; replaces the `Date.now()` invoice generator (00 §gap table) | One allocator, three keys; doc 03 owns the review lifecycle so its prefix wins |
| R4 | **One *active* Revenue Review per dispatch** via a partial unique index `ON "RevenueReview"(dispatchId) WHERE status <> 'VOIDED'` (raw SQL migration). No `Dispatch.revenueReviewId` column — the FK lives on `RevenueReview.dispatchId`. | 02 (`dispatchId @unique` — one review *ever*), 00 (`Dispatch.revenueReviewId` sketch); adopts 03 | A voided review must be replaceable (doc 03 void/reopen rules) without ever permitting two live reviews — the absolute unique would strand a dispatch behind its own voided review |
| R5 | The responsible-payer FK is named **`payerId`** everywhere it appears (`Dispatch`, `RevenueReview`, `Invoice`, `CustomerCredit`, `PaymentCustomer`, `StudentPayerRelationship.payerId`). | 02 (`Dispatch.responsiblePayerId`); adopts 11 | One name for one concept across the whole financial chain |
| R6 | **`InstructorEarning` merged shape** (§4.7): status enum `InstructorEarningStatus { PENDING, APPROVED, EXPORTED, REVERSED }`; fields `timeEntryId`, `rate Decimal(12,2)`, `reversesEarningId`, `reversalReason`; `category InstructorTimeCategory` (typed, not String); keeps doc 04's `rateSource Json` trace, `customLabel`, and `timeEntryId @unique`; keeps doc 12's `approvedByUserId/approvedAt`, `exportJobId`. `PAID` is **not** in the enum (Part 3 adds it additively if instructor payouts ship). | 04 (`RECORDED \| EXPORTED`, `instructorTimeEntryId`, `adjustsEarningId/adjustmentReason`, `rate (8,2)`), 12 (`EarningStatus`, `compensationRate`, String category) | Doc 12's state machine supports `compensationApprovalMode = SEPARATE_APPROVAL` and refund reversals; doc 04's provenance trace is the richer audit. `AUTO_ON_REVIEW_APPROVAL` writes rows directly at `APPROVED` (doc 04's `RECORDED` semantics preserved) |
| R7 | One shared **`ProfileStatus { DRAFT, APPROVED, ARCHIVED }`** for both `AircraftPricingProfile` and `InstructorRateProfile`. `SUPERSEDED` is **derived at read** (a newer APPROVED version exists in the family), never stored. | 04 (`RateProfileStatus` with `SUPERSEDED`), 05 (`PricingProfileStatus`) | One enum, and a stored `SUPERSEDED` flag is a computed value re-synced on every new version — exactly what DATABASE_STANDARDS bans |
| R8 | `InstructorRateProfile` versioning uses **`familyId` + `version`** with `@@unique([organizationId, kind, familyId, version])`; `supersedesId` is dropped; `name` is not part of the unique. | 04 (`supersedesId`, `@@unique([organizationId, kind, name, version])`) | Same versioning idiom as `AircraftPricingProfile` (05) and `TaxRule` (`ruleKey` is the string form of a family key); name-based uniqueness breaks on rename |
| R9 | One **`TaxTreatment { TAXABLE, NON_TAXABLE }`** enum. Profiles carry a **nullable** `taxTreatment` (`null` = inherit); no `PricingTaxTreatment` enum, no `ORG_DEFAULT` value. | 05 (`PricingTaxTreatment @default(ORG_DEFAULT)`); adopts 07 | "Inherit" as `null` keeps one enum serving profile defaults and the audited per-line override; a stored ORG_DEFAULT sentinel duplicates what null already says |
| R10 | Taxability booleans are named **`isTaxable`** (on `RevenueItem` and the `InvoiceLine` snapshot). | 06 (`taxable`); arbitrates 06 vs 07 (`isTaxable`) | House boolean prefix rule (`isActive`, `isDemo`) |
| R11 | All new currency-denominated columns are `Decimal(12,2)` (§2.2), including instructor rates. | 04 (`rate (8,2)` on profile lines and earnings), 08 (`correctedUnitPrice (12,2)` → **(10,2)**, matching its target column) | One precision per field class; corrected values must fit the column they replace |
| R12 | New enum values spell **`CANCELLED`** (double-L). | 09 (`CANCELED` in `ScheduledChargeStatus`, `PaymentAttemptStatus`) | Existing enums (`DispatchStatus`, `MaintenanceStatus`, `EventStatus`, `CheckrideStatus`) all use `CANCELLED` |
| R13 | Locked totals live on **`Invoice.subtotal/taxTotal/total`**; `RevenueReview` keeps `totalAtApproval` + `approvalSnapshot` only. Doc 07's `RevenueReview.taxTotal` → **`Invoice.taxTotal`**. | 07 | The invoice is the accounting document of record; the review is workflow. One authoritative home per number |
| R14 | `Invoice` approval columns are **`approvedAt` only** — no `approvedBy`, no `lockedAt`. Approver identity lives on `RevenueReview.approvedById`, `RevenueReviewApproval`, and the audit trail. | 00 (sketch: `approvedBy/approvedAt/lockedAt`) | `approvedAt` *is* the lock marker; duplicating actor identity onto the invoice invites drift |
| R15 | Doc 08's policy keys split: **approval keys → `RevenueWorkflowPolicy`** (`discountSecondApprovalPercent`, `discountSecondApprovalAmount`, `damageFeeWaiverSecondApproval`, `creditIssueSecondApprovalAmount`); its `refundSecondApproval` ≡ existing `secondApprovalForRefunds` and `separationOfDuties` ≡ existing `separationOfDutiesRequired` (deduplicated, doc 03 names win). A `secondApprovalForDiscounts` boolean is **dropped** — the `discountSecondApprovalPercent`/`discountSecondApprovalAmount` threshold pair (defaults 10% / $250) is the single discount second-approval mechanism, aligned across docs [03](./03-revenue-review-lifecycle.md)/[08](./08-adjustments-discounts-credits.md). **Operational keys → `RevenueSettings`** (`creditExpiryMonths`, `autoApplyCredits`, `refundToCreditAllowed`, `instructorClawbackPolicy`, `promoCodesEnabled`, `refundWarnAfterDays`). | 08 | Approval policy has one home (doc 03's model); org behavior knobs have one home (the settings singleton) |
| R16 | The spec's **WebhookEvent** is **`PaymentProviderEvent`**. | spec Part L naming | `Webhook`/`WebhookDelivery` already exist for *outbound* tenant webhooks; naming an inbound provider-event table "WebhookEvent" would be a permanent source of confusion |
| R17 | The spec's **PaymentTransaction** is the extended **`Payment`**; `Refund.paymentId` binds to `Payment`. | arbitrates 08's "binds to PaymentTransaction if it supersedes Payment" | Reuse-and-extend; a parallel settled-money table would fork every billing consumer |
| R18 | Dispatch closeout actor is **`closedBy String?`** (display label, `releasedBy` precedent); authoritative identity in `AuditLog`. | 00 (`closedByUserId`); adopts 02 | Matches the documented createdBy-via-audit-log shortcut |
| R19 | **`Payment` gains `organizationId`** (nullable + backfill from its invoice, real Organization relation) and `@@index([organizationId, paidAt])`. | extends 00 (org-reachable `paidAt` index) and 09 | Payment reporting and reconciliation are org-leading query shapes; joining through Invoice for every aggregate fails the index-strategy rule |
| R20 | `PaymentCustomer` carries the **union** of uniques: `[organizationId, provider, providerCustomerId]`, `[organizationId, payerId]`, `[organizationId, studentId]`. | arbitrates 09 vs 11 | Both invariants are real: one provider object per row, one customer per paying party per org |
| R21 | `InvoiceLine` keeps existing `quantity (8,2)` / `unitPrice (10,2)`; **no `lineTotal` column, no per-line `currency`**. Pre-approval totals derive at read; approval freezes totals on `Invoice` and in `approvalSnapshot`. | 06 (`quantity (10,2)`, `unitAmount/lineTotal (12,2)`, line `currency`) | Existing columns are never re-typed (migration safety); a stored line total is a computed value; currency inherits from the document (§2.3) |
| R22 | `RevenueReview.paymentPolicyAtApproval` **stays** alongside `ScheduledCharge.policy` — both write-once in the same approval transaction. | none (confirms 03 + 09) | Not drift: two write-once copies of one immutable fact, one for review display, one operative |
| R23 | Line-to-time-entry provenance is a real FK: **`InvoiceLine.instructorTimeEntryId`** (SetNull). | extends 04 | Compensation reconciliation needs line↔entry pairing without parsing JSON traces |
| R24 | Doc 06's cross-references to "04-revenue-review.md" mean **[03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md)**; doc 02's to "09-responsible-payer-model.md" mean **[11-responsible-payers.md](./11-responsible-payers.md)** (editorial; file numbering drifted during writing). | 02, 06, 07, 11 link targets | Consistency pass fixes the links |
| R25 | Settings/config **selector** fields keep their owning doc's type: doc 09's String-typed knobs stay `String` (engine-validated catalogs), doc 04/12's enum-typed knobs stay enums. Anything **snapshotted onto a financial record or driving a state machine is always a Prisma enum**. | arbitrates 04/09/12 style split | Both idioms exist in the house style; the hard rule is only where type stability is a financial-integrity concern |
| R26 | The warning/restriction snapshots stay **three distinct point-in-time facts**: `Dispatch.restrictionSnapshot` (release restrictions, doc 10), `Dispatch.closeoutWarnings` (return warnings, doc 02), and `RevenueReview.warnings` (reviewer-facing copy). | none (confirms 02 + 10 boundary) | Documented so nobody "deduplicates" them into one blob |
| R27 | **`ScheduledCharge` carries no payer columns.** The responsible-payer snapshot lives on `RevenueReview.payerId`/`billToLabel`/`billToPayerType` and in `approvalSnapshot`, all written in the same approval transaction. | 09 (§2.2 snapshot-rule wording, §4.5 `payerId`/`payerLabel` on `ScheduledCharge`) | One snapshot home per fact (the R14 rationale): the charge reaches its payer through the review it is 1:1 with; duplicating payer identity onto the charge invites drift |
| R28 | **`PaymentAttempt` carries no Payment Method FK** — only the denormalized `methodType`/`methodBrand`/`methodLast4` snapshot. The operative FK is `ScheduledCharge.paymentMethodReferenceId`, snapshotted onto each attempt at creation. | 09 (§4.6 `paymentMethodReferenceId` on `PaymentAttempt`) | Append-only attempts must survive method detachment/deletion untouched; the re-pointable reference belongs on the charge, whose method selection each attempt records as display metadata |
| R29 | Doc 11 §4's seven org-level payer settings (`payerChargeApproval`, `payerApprovalWindowDays`, `adultStudentConsent`, `minorPayerPolicy`, `payerInvitationExpiryDays`, `billingAuthorizationVersion`, `payerNotificationsEnabled`) land as **typed columns on `RevenueSettings`** (§4.14). `payerChargeApproval`/`payerApprovalWindowDays` ship in the schema, but the flow they arm is **deferred to Phase 9** ([16 D7](./16-risks-and-open-decisions.md)) — default `OFF`, no writer until then; the §4.4 payer-approval columns stay dormant with them. The other five are Part 2 features and live here from the start. | 11 (§4 "binding storage decided in 13-database-model.md") | One settings singleton per org (the R15 rationale); consent, minor policy, invitation expiry, and authorization versioning need a home the moment payers ship |
| R30 | **Doc 13's field sets are binding where a sibling doc proposes a column this document omits.** The consistency pass drops these from their docs: 07 `TaxRule.notes`, `TaxSnapshot.ruleVersion` required (nullable here — provider-computed snapshots have no internal rule version); 08 `PromoCode.description`, `PromoCodeRedemption.redeemedAt` (`createdAt` *is* the redemption instant), `CustomerCredit.memo`; 09 `PaymentAttempt.paymentMethodReferenceId` (R28); 10 `CheckoutRestrictionPolicy.notes`; 12 `LedgerEntry.revenueReviewId`/`invoiceId`/`memo` (provenance lives in `sourceType`/`sourceId`), `RevenueAllocation.memo`, `PlatformFeePolicy.createdByLabel` (platform actor lives in `AuditLog`), `ReconciliationException.details`, `FinancialExportJob.startedAt`/`completedAt`. Four doc-12 fields go the other way — **this document adopts them**: `PlatformFeePolicy.currency`, `ReconciliationException.currency` (§2.3 explicit-currency rule), `PlatformFee.earnedAt` (earned-by-period reporting is impossible from `createdAt` accrual time alone), `RevenueAllocation.effectiveAt` (doc 12 §2.8 buckets every reporting surface on `effectiveAt`; without it, correction/refund sets would bucket differently in reports, ledger, and exports — copied in-transaction from the triggering journal/adjustment, §4.13). | 07, 08, 09, 10, 12 field lists | The §3 contract — this table enumerates every override so the consistency pass can align the set — requires the omissions to be catalogued, not silent |

---

## 4. Proposed schema (Prisma 6)

### 4.1 Conventions applied to every model below

- `id String @id @default(cuid())`; PascalCase singular model names; no `@@map`.
- **Tenant scoping:** every org-owned model carries `organizationId` with a real `Organization` relation and explicit `onDelete` (ADR-021 / schema-governance test). Relation-scoped children (`InvoiceLine`, `TaxSnapshotItem`, `CreditApplication`, `InstructorRateProfileLine`, `RevenueItem*` join tables, `PromoCodeRedemption`) scope through their parent, matching the `InvoiceLine`/`Squawk` precedent; writes verify same-org at the API layer.
- `createdAt DateTime @default(now())` on every model; `updatedAt @updatedAt` where rows have a mutable lifecycle. Lifecycle markers are `<verb>edAt`.
- Org-leading composite indexes for every tenant query shape (§9); tenant-aware uniques, never global ones, for org-owned natural keys.
- Actor attribution: bare `…ById String?` + denormalized `…ByLabel String` where a display name must survive user deletion; the `AuditLog` row is always the authoritative record (house convention).
- Every new enum and every new value on an existing enum ships in its own additive DDL migration **before** any code writes it (DATABASE_STANDARDS two-step rule). Enums used only by brand-new tables may ship in the same DDL migration as those tables.
- Prisma FK-action defaults are never relied on for financial records — every relation below states its action explicitly.

### 4.2 Extended existing models (additive only — no column renamed, re-typed, or dropped)

#### 4.2.1 `Dispatch` (consolidates docs 00 / 02 / 05 / 10 / 11)

```prisma
model Dispatch {
  id              String         @id @default(cuid())
  /// NEW — direct tenant scope. Ships nullable; idempotent backfill from
  /// ScheduleEvent.organizationId; NOT NULL tightened one release later
  /// (14-migration-plan.md). Queries keep joining through scheduleEvent
  /// until the tightening release.
  organizationId  String?
  scheduleEventId String         @unique
  aircraftId      String
  studentId       String?
  instructorId    String?
  /// NEW — from ScheduleEvent.locationId, fallback Aircraft.locationId.
  locationId      String?
  /// NEW — responsible payer captured at checkout (Part A); server-validated
  /// against an ACTIVE StudentPayerRelationship for the dispatch's student.
  payerId         String?
  /// NEW — explicit Aircraft Pricing Profile selection (resolution level 1,
  /// doc 05); server-validated org-owned + APPROVED + applicable + effective.
  pricingProfileId String?
  status          DispatchStatus @default(PENDING)

  // ---- Pre-flight release (existing — unchanged) ----
  fuelQty             String?
  oilQty              String?
  weatherAcknowledged Boolean   @default(false)
  documentsVerified   Boolean   @default(false)
  instructorApproved  Boolean   @default(false)
  studentApproved     Boolean   @default(false)
  releasedAt          DateTime?
  releasedBy          String?

  // ---- NEW — release capture (Part A checkout) ----
  conditionOut        String?
  squawksAcknowledged Boolean @default(false) // required true at release when open squawks exist
  intendedRoute       String? // captured only when DispatchPolicy.captureRoute
  releaseNotes        String?
  /// Point-in-time restriction findings at release (doc 10): passes, warnings,
  /// clearances, overrides. A historical fact, not a computed cache
  /// (documented DATABASE_STANDARDS carve-out).
  restrictionSnapshot Json?

  // ---- Post-flight closeout (existing — unchanged) ----
  hobbsOut       Decimal?  @db.Decimal(9, 1)
  hobbsIn        Decimal?  @db.Decimal(9, 1)
  tachOut        Decimal?  @db.Decimal(9, 1)
  tachIn         Decimal?  @db.Decimal(9, 1)
  flightTime     Decimal?  @db.Decimal(6, 1)
  landings       Int?
  nightTime      Decimal?  @db.Decimal(6, 1)
  instrumentTime Decimal?  @db.Decimal(6, 1)
  dualReceived   Decimal?  @db.Decimal(6, 1)
  dualGiven      Decimal?  @db.Decimal(6, 1)
  picTime        Decimal?  @db.Decimal(6, 1)
  fuelAddedGal   Decimal?  @db.Decimal(6, 1)
  closedAt       DateTime?

  // ---- NEW — return capture (Part A check-in) ----
  conditionIn      String?
  oilAddedQt       Decimal? @db.Decimal(4, 1)
  airportsVisited  String?  // identifiers, e.g. "KAVL, KGSP"
  returnNotes      String?
  /// Closeout actor display label (releasedBy precedent); authoritative
  /// identity in AuditLog (R18).
  closedBy         String?
  /// Warning codes, modes, and audited overrides evaluated at return (doc 02).
  closeoutWarnings Json?

  // NEW — standard timestamps; existing rows backfill to migration time.
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  scheduleEvent  ScheduleEvent           @relation(fields: [scheduleEventId], references: [id], onDelete: Cascade)
  organization   Organization?           @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  location       Location?               @relation(fields: [locationId], references: [id], onDelete: SetNull)
  aircraft       Aircraft                @relation(fields: [aircraftId], references: [id])
  student        Student?                @relation(fields: [studentId], references: [id])
  instructor     Instructor?             @relation(fields: [instructorId], references: [id])
  payer          ResponsiblePayer?       @relation(fields: [payerId], references: [id], onDelete: SetNull)
  pricingProfile AircraftPricingProfile? @relation(fields: [pricingProfileId], references: [id], onDelete: SetNull)

  revenueReviews       RevenueReview[]               // partial-unique: one non-VOIDED (R4)
  restrictionDecisions DispatchRestrictionDecision[]

  @@index([status])                    // existing — retained until the org backfill completes
  @@index([organizationId, status])    // NEW — dispatch board & queues
  @@index([organizationId, closedAt])  // NEW — utilization / org-date reporting
}
```

#### 4.2.2 `Invoice` (consolidates docs 00 / 03 / 07 / 09 / 11)

```prisma
model Invoice {
  id             String        @id @default(cuid())
  organizationId String
  studentId      String?
  /// NEW — bill-to party; null = student self-pay. All legacy rows stay null
  /// and keep their exact current meaning.
  payerId        String?
  /// NEW — immutable bill-to display snapshot, written at approval from the
  /// review's resolved payer.
  billToLabel    String?
  number         String        // existing; new invoices use OrgSequence "INV-<seq>" (R3)
  status         InvoiceStatus @default(OPEN)
  /// NEW — ISO 4217; nullable, backfilled "USD" by a separate data migration (§2.3).
  currency       String?       @db.Char(3)
  /// NEW — approved snapshot totals, written exactly once inside the approval
  /// transaction; null until approval. Point-in-time facts, not caches
  /// (documented derive-at-read carve-out; principle 5).
  subtotal       Decimal?      @db.Decimal(12, 2)
  taxTotal       Decimal?      @db.Decimal(12, 2)
  total          Decimal?      @db.Decimal(12, 2)
  /// NEW — the lock marker (R14). Lines of an approved invoice are never
  /// mutated (engine-enforced); corrections append adjustment lines.
  approvedAt     DateTime?
  issuedAt       DateTime      @default(now())
  dueAt          DateTime?
  memo           String?
  updatedAt      DateTime      @updatedAt // NEW — drift detection

  organization Organization      @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  student      Student?          @relation(fields: [studentId], references: [id])
  payer        ResponsiblePayer? @relation(fields: [payerId], references: [id], onDelete: Restrict)
  lines        InvoiceLine[]
  payments     Payment[]

  revenueReview      RevenueReview?      // 1:1 back-relation (FK on the review)
  scheduledCharge    ScheduledCharge?
  paymentAttempts    PaymentAttempt[]
  disputes           Dispute[]
  allocations        RevenueAllocation[]
  platformFees       PlatformFee[]
  creditApplications CreditApplication[]

  @@unique([organizationId, number])
  @@index([organizationId, status])
  @@index([studentId])
  @@index([payerId])                  // NEW — payer portal & reconciliation
  @@index([organizationId, issuedAt]) // NEW — org/date reporting
}
```

`InvoiceStatus` gains `PARTIALLY_REFUNDED`, `REFUNDED`, `DISPUTED` — one additive enum migration, values unwritten until the Part 2 payment engine ships (§5). Existing values keep their exact meaning; `Invoice.status` becomes a coarse projection of `RevenueReviewStatus` for review-wrapped invoices (doc 03 §2.2) while standalone legacy invoices keep today's behavior.

#### 4.2.3 `InvoiceLine` (absorbs doc 06's line field set per R1; docs 04 / 05 / 07 / 08)

```prisma
model InvoiceLine {
  id          String       @id @default(cuid())
  invoiceId   String
  kind        LineItemKind @default(OTHER) // FROZEN enum; catalog lines set it via legacyKindFor() (doc 06 §3.3)
  description String                        // doubles as the item-name snapshot at add time
  quantity    Decimal      @default(1) @db.Decimal(8, 2)  // meaning defined by unitBasis; FIXED forces 1
  unitPrice   Decimal      @db.Decimal(10, 2)             // signed: negative on discount/offset lines

  // ---- NEW — every column below is nullable or defaulted; all pre-Phase-8
  // ---- rows keep them null/default and are never reinterpreted.
  /// Line provenance (R2). null = legacy row created before the Revenue Engine.
  origin                 RevenueLineOrigin?
  revenueItemId          String?               // catalog provenance (doc 06)
  itemCode               String?               // immutable item-code snapshot at add time
  unitBasis              RevenueItemUnitBasis?
  unitLabel              String?               // PER_UNIT display unit, e.g. "quart"
  isTaxable              Boolean?              // default-treatment snapshot (R10); authoritative tax = TaxSnapshot
  taxTreatmentOverride   TaxTreatment?         // audited manual override — top of the doc 07 resolution order
  taxOverrideReason      String?               // required when the override is set (engine-enforced)
  accountingCategoryCode String?               // Part 3 export seam snapshot
  reason                 String?               // required for MANUAL origin (engine-enforced)
  note                   String?
  attachmentDocumentId   String?               // per-item evidence flag; enforced at review submission
  addedByUserId          String?               // on-row for separation-of-duties comparisons
  addedByLabel           String?
  requiresSecondApproval Boolean  @default(false) // item-config snapshot at add time (doc 06)
  adjustmentId           String?               // set on adjustment-materialized lines (doc 08)
  offsetsLineId          String?               // locked line this line offsets (void/correction/waiver)
  pricingProfileId       String?               // rate provenance (doc 05)
  rateProfileId          String?               // rate provenance (doc 04, BILLING kind)
  rateProfileVersion     Int?
  instructorTimeEntryId  String?               // line ↔ time-entry pairing (R23)
  rateResolution         Json?                 // resolver trace: level, candidates, ambiguity, rounding
  createdAt              DateTime @default(now()) // NEW; legacy rows backfill to migration time

  invoice        Invoice                 @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  revenueItem    RevenueItem?            @relation(fields: [revenueItemId], references: [id], onDelete: Restrict)
  adjustment     RevenueAdjustment?      @relation("AdjustmentLines", fields: [adjustmentId], references: [id], onDelete: Restrict)
  offsetsLine    InvoiceLine?            @relation("LineOffsets", fields: [offsetsLineId], references: [id], onDelete: SetNull)
  offsetBy       InvoiceLine[]           @relation("LineOffsets")
  pricingProfile AircraftPricingProfile? @relation(fields: [pricingProfileId], references: [id], onDelete: SetNull)
  rateProfile    InstructorRateProfile?  @relation(fields: [rateProfileId], references: [id], onDelete: SetNull)
  timeEntry      InstructorTimeEntry?    @relation(fields: [instructorTimeEntryId], references: [id], onDelete: SetNull)
  attachment     Document?               @relation("LineAttachments", fields: [attachmentDocumentId], references: [id], onDelete: SetNull)

  taxSnapshotItems     TaxSnapshotItem[]
  adjustmentsTargeting RevenueAdjustment[] @relation("AdjustmentTarget")

  @@index([invoiceId])
  @@index([revenueItemId]) // NEW — item usage / Restrict-delete checks
}
```

Line totals are **derived at read** (`quantity × unitPrice`, server-side Decimal); document totals freeze on `Invoice.subtotal/taxTotal/total` at approval (R21).

#### 4.2.4 `Payment` (docs 00 / 08 / 09; R17, R19)

```prisma
model Payment {
  id             String        @id @default(cuid())
  /// NEW — direct org scope for reporting/reconciliation (R19); nullable,
  /// backfilled from invoice.organizationId, tightened later.
  organizationId String?
  invoiceId      String
  amount         Decimal       @db.Decimal(10, 2) // existing precision kept (§2.2)
  /// NEW — ISO 4217; backfilled "USD".
  currency       String?       @db.Char(3)
  method         PaymentMethod @default(CARD)
  reference      String?       // Stripe payment intent id, check #, ... (existing)
  /// NEW — exactly one Payment per successful attempt (§7).
  paymentAttemptId String?     @unique
  /// NEW — actor label for manually recorded payments (cash/check).
  recordedByLabel  String?
  paidAt         DateTime      @default(now())

  organization Organization?   @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  /// CHANGED: Cascade → Restrict. A settled-money record must never
  /// cascade-delete with its invoice (00's landmine). Metadata-only ALTER;
  /// tenant wipe deletes payments before invoices (§10).
  invoice      Invoice         @relation(fields: [invoiceId], references: [id], onDelete: Restrict)
  attempt      PaymentAttempt? @relation(fields: [paymentAttemptId], references: [id], onDelete: Restrict)

  refunds            Refund[]
  creditApplications CreditApplication[]

  @@index([invoiceId])
  @@index([organizationId, paidAt]) // NEW — org/date payment reporting
}
```

#### 4.2.5 Back-relations added to other existing models (relations only — no columns)

| Model | New back-relations |
|---|---|
| `Organization` | `dispatchPolicy DispatchPolicy?`, `revenueWorkflowPolicy RevenueWorkflowPolicy?`, `orgPaymentPolicy OrgPaymentPolicy?`, `revenueSettings RevenueSettings?`, `orgSequences OrgSequence[]`, `revenueReviews RevenueReview[]`, `revenueReviewApprovals RevenueReviewApproval[]`, `instructorTimeEntries InstructorTimeEntry[]`, `instructorRateProfiles InstructorRateProfile[]`, `instructorEarnings InstructorEarning[]`, `aircraftPricingProfiles AircraftPricingProfile[]`, `revenueItems RevenueItem[]`, `taxRules TaxRule[]`, `taxSnapshots TaxSnapshot[]`, `revenueAdjustments RevenueAdjustment[]`, `customerCredits CustomerCredit[]`, `promoCodes PromoCode[]`, `refunds Refund[]`, `disputes Dispute[]`, `responsiblePayers ResponsiblePayer[]`, `studentPayerRelationships StudentPayerRelationship[]`, `paymentCustomers PaymentCustomer[]`, `paymentMethodReferences PaymentMethodReference[]`, `scheduledCharges ScheduledCharge[]`, `paymentAttempts PaymentAttempt[]`, `paymentProviderEvents PaymentProviderEvent[]`, `checkoutRestrictionPolicies CheckoutRestrictionPolicy[]`, `dispatchRestrictionDecisions DispatchRestrictionDecision[]`, `revenueAllocations RevenueAllocation[]`, `platformFeePolicies PlatformFeePolicy[]`, `platformFees PlatformFee[]`, `ledgerEntries LedgerEntry[]`, `providerPayouts ProviderPayout[]`, `reconciliationExceptions ReconciliationException[]`, `financialExportJobs FinancialExportJob[]`, `accountingMappings AccountingMapping[]`, `dispatches Dispatch[]`, `payments Payment[]` |
| `User` | `payerProfiles ResponsiblePayer[]`, `revenueApprovals RevenueReviewApproval[]` |
| `Student` | `payerRelationships StudentPayerRelationship[]`, `customerCredits CustomerCredit[]`, `paymentCustomers PaymentCustomer[]`, `revenueReviews RevenueReview[]` |
| `Instructor` | `timeEntries InstructorTimeEntry[]`, `rateProfiles InstructorRateProfile[]`, `earnings InstructorEarning[]`, `revenueReviews RevenueReview[]` (no column changes; `hourlyRate` demoted to legacy tier-8 BILLING fallback, retirement per 14-migration-plan.md) |
| `Aircraft` | `pricingProfiles AircraftPricingProfile[]`, `revenueItemScopes RevenueItemAircraft[]`, `revenueReviews RevenueReview[]` (`hourlyRateWet` stays — the virtual legacy fallback profile, doc 05) |
| `Location` | `dispatches Dispatch[]`, `pricingProfiles AircraftPricingProfile[]`, `rateProfiles InstructorRateProfile[]`, `taxRules TaxRule[]`, `revenueItemScopes RevenueItemLocation[]`, `revenueReviews RevenueReview[]` |
| `Syllabus` | `rateProfiles InstructorRateProfile[]`, `revenueItemScopes RevenueItemProgram[]` |
| `ScheduleEvent` | `instructorTimeEntries InstructorTimeEntry[]` |
| `Document` | `lineAttachments InvoiceLine[] @relation("LineAttachments")`, `payerConsentRelationships StudentPayerRelationship[] @relation("PayerConsentDocuments")`, `adjustmentEvidence RevenueAdjustment[]`, `exportFiles FinancialExportJob[]` |
| `SubscriptionPlan` | `platformFeePolicies PlatformFeePolicy[]` |

### 4.3 Per-org number sequences

```prisma
/// Gap-tolerant per-org allocator for human-readable numbers (R3).
/// Allocation runs inside the creating transaction:
///   UPDATE "OrgSequence" SET "nextValue" = "nextValue" + 1
///   WHERE "organizationId" = $1 AND "key" = $2 RETURNING "nextValue";
/// (row created lazily on first use). Rolled-back transactions may skip a
/// number — acceptable; uniqueness, not continuity, is the invariant.
model OrgSequence {
  id             String @id @default(cuid())
  organizationId String
  key            String // "invoice" | "revenue_review" | "adjustment" (engine catalog)
  nextValue      Int    @default(1)
  createdAt      DateTime @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, key])
}
```

### 4.4 Revenue Review & approval workflow (doc 03; payer fields from 11; operational snapshot from 02)

```prisma
enum RevenueReviewStatus {
  DRAFT
  AWAITING_INSTRUCTOR_REVIEW
  AWAITING_OPERATIONS_REVIEW
  CHANGES_REQUESTED
  APPROVED
  PAYMENT_SCHEDULED
  PAYMENT_PROCESSING
  CARD_PAID
  ACH_PENDING
  PAID
  PAYMENT_FAILED
  PARTIALLY_REFUNDED
  REFUNDED
  VOIDED
  DISPUTED
  WRITTEN_OFF // reserved — no writer in Parts 2–3 (doc 03)
}

enum RevenueApprovalKind {
  INSTRUCTOR_ROUTINE
  OPERATIONS
  SECOND
  FINANCE
}

model RevenueReview {
  id             String              @id @default(cuid())
  organizationId String
  number         String              // "RR-<seq>" via OrgSequence (R3)
  status         RevenueReviewStatus @default(DRAFT)
  currency       String              @default("USD") @db.Char(3)

  /// The wrapped backend Invoice — 1:1, required, created in the same
  /// closeout/creation transaction (doc 03, ADR-025).
  invoiceId  String  @unique
  /// Null for manual (non-flight) reviews. One non-VOIDED review per dispatch
  /// via partial unique index (R4, raw SQL):
  ///   CREATE UNIQUE INDEX "RevenueReview_dispatch_active_key"
  ///   ON "RevenueReview"("dispatchId") WHERE status <> 'VOIDED';
  dispatchId String?

  aircraftId   String?
  studentId    String?
  instructorId String?
  locationId   String?

  // ---- Payer routing & resolution (doc 11) ----
  payerId              String?    // resolved bill-to party; null = student self-pay
  payerResolutionBasis String?    // explicit_dispatch | student_default | self_pay | manual_override (engine catalog)
  billToLabel          String?    // frozen at approval — immutable thereafter
  billToPayerType      PayerType? // frozen at approval
  paymentMethodRefId   String?    // selected PaymentMethodReference, snapshotted at approval

  // Optional payer charge-approval flow (doc 11 §7, org-configurable via
  // RevenueSettings.payerChargeApproval). Columns ship now but stay dormant:
  // the flow is deferred to Phase 9 per 16 D7 (R29).
  payerApprovalRequestedAt DateTime?
  payerApprovedAt          DateTime?
  payerDeclinedAt          DateTime?
  payerDeclineReason       String?

  // ---- Immutable operational snapshot copied at creation (doc 02) ----
  flightDate DateTime?
  hobbsOut   Decimal?  @db.Decimal(9, 1)
  hobbsIn    Decimal?  @db.Decimal(9, 1)
  tachOut    Decimal?  @db.Decimal(9, 1)
  tachIn     Decimal?  @db.Decimal(9, 1)
  flightTime Decimal?  @db.Decimal(6, 1)
  landings   Int?
  warnings   Json?     // reviewer-facing copy of closeout warning annotations (R26)

  // ---- Risk & approval routing (doc 03) ----
  riskFlags              String[] @default([]) // MANUAL_ITEM | DISCOUNT | DAMAGE_FEE | OVER_THRESHOLD | TIME_OVERRIDE | ... (engine catalog)
  secondApprovalRequired Boolean  @default(false)

  // ---- Lifecycle actor fields (doc 03) ----
  submittedAt            DateTime?
  submittedById          String?
  changesRequestedAt     DateTime?
  changesRequestedById   String?
  changesRequestedReason String?
  approvedAt             DateTime?
  approvedById           String?
  /// Point-in-time frozen breakdown written in the approval transaction:
  /// lines, rate/tax provenance, payer, timing, labels. Never recomputed
  /// (principle 5; documented derive-at-read carve-out).
  approvalSnapshot        Json?
  totalAtApproval         Decimal?             @db.Decimal(12, 2)
  paymentPolicyAtApproval PaymentTimingPolicy? // write-once copy; operative value on ScheduledCharge (R22)
  scheduledChargeAt       DateTime?
  voidedAt                DateTime?
  voidedById              String?
  voidReason              String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  organization     Organization            @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  invoice          Invoice                 @relation(fields: [invoiceId], references: [id], onDelete: Restrict)
  dispatch         Dispatch?               @relation(fields: [dispatchId], references: [id], onDelete: SetNull)
  aircraft         Aircraft?               @relation(fields: [aircraftId], references: [id], onDelete: SetNull)
  student          Student?                @relation(fields: [studentId], references: [id], onDelete: SetNull)
  instructor       Instructor?             @relation(fields: [instructorId], references: [id], onDelete: SetNull)
  location         Location?               @relation(fields: [locationId], references: [id], onDelete: SetNull)
  payer            ResponsiblePayer?       @relation(fields: [payerId], references: [id], onDelete: Restrict)
  paymentMethodRef PaymentMethodReference? @relation(fields: [paymentMethodRefId], references: [id], onDelete: SetNull)

  approvals          RevenueReviewApproval[]
  timeEntries        InstructorTimeEntry[]
  earnings           InstructorEarning[]
  taxSnapshots       TaxSnapshot[]
  adjustments        RevenueAdjustment[]
  allocations        RevenueAllocation[]
  creditApplications CreditApplication[]
  promoRedemptions   PromoCodeRedemption[]
  targetedCredits    CustomerCredit[]        @relation("CreditTargetReview")
  scheduledCharge    ScheduledCharge?
  platformFee        PlatformFee?
  disputes           Dispute[]

  @@unique([organizationId, number])
  @@index([organizationId, status])                    // review queues
  @@index([organizationId, createdAt])                 // org/date reporting
  @@index([organizationId, status, scheduledChargeAt]) // batch pickup (doc 09)
  @@index([instructorId, status])                      // "My Revenue Reviews"
  @@index([dispatchId])
}

/// Append-only approval signatures (doc 03) — second/finance approvals without
/// extra statuses; the comparison basis for separation-of-duties enforcement.
model RevenueReviewApproval {
  id              String              @id @default(cuid())
  organizationId  String
  revenueReviewId String
  kind            RevenueApprovalKind
  approverUserId  String?
  approverLabel   String              // denormalized — survives user deletion
  note            String?
  createdAt       DateTime            @default(now())

  organization Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  review       RevenueReview @relation(fields: [revenueReviewId], references: [id], onDelete: Cascade)
  approver     User?         @relation(fields: [approverUserId], references: [id], onDelete: SetNull)

  @@unique([revenueReviewId, kind])
  @@index([organizationId, createdAt])
}

/// One row per org; absent row = code defaults (zero-setup). Approval-workflow
/// configuration only — typed columns, never a settings JSON (doc 03 + R15 keys).
model RevenueWorkflowPolicy {
  id                            String   @id @default(cuid())
  organizationId                String   @unique
  instructorSubmissionRequired  Boolean  @default(true)
  instructorMayApproveRoutine   Boolean  @default(false)
  routineApprovalMaxAmount      Decimal? @db.Decimal(12, 2)
  operationsApprovalRequired    Boolean  @default(true) // engine refuses zero-approver configs
  secondApprovalAmountThreshold Decimal? @db.Decimal(12, 2) // null = off
  secondApprovalForManualItems  Boolean  @default(false)
  secondApprovalForDamageFees   Boolean  @default(true)
  secondApprovalForRefunds      Boolean  @default(true)
  financeApprovalRequired       Boolean  @default(false)
  separationOfDutiesRequired    Boolean  @default(true)
  instructorSeesOwnCompensation Boolean  @default(false)
  // ---- Adjustment approval keys (doc 08 via R15). The threshold pair below
  // ---- is the single discount second-approval mechanism (docs 03/08 aligned);
  // ---- there is no separate boolean toggle for discounts.
  discountSecondApprovalPercent   Decimal @default(10.00) @db.Decimal(5, 2)
  discountSecondApprovalAmount    Decimal @default(250.00) @db.Decimal(12, 2)
  damageFeeWaiverSecondApproval   Boolean @default(true)
  creditIssueSecondApprovalAmount Decimal @default(500.00) @db.Decimal(12, 2)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
}
```

### 4.5 Operational dispatch configuration & checkout restrictions (docs 02 / 10)

```prisma
enum WarningMode {
  OFF
  WARN
  BLOCK
}

/// Per-org operational capture/validation config (doc 02); one optional row,
/// absent row = code defaults.
model DispatchPolicy {
  id             String @id @default(cuid())
  organizationId String @unique

  captureFuelStatus  Boolean @default(true)
  captureOilStatus   Boolean @default(true)
  captureRoute       Boolean @default(false)
  captureAirportFees Boolean @default(true)

  maxHobbsDeltaHours        Decimal @default(15.0) @db.Decimal(6, 1) // hard block above
  maxTachDeltaHours         Decimal @default(15.0) @db.Decimal(6, 1)
  warnHobbsDeltaHours       Decimal @default(8.0) @db.Decimal(6, 1)
  durationOverScheduleHours Decimal @default(2.0) @db.Decimal(4, 1)
  tachHobbsRatioMin         Decimal @default(0.50) @db.Decimal(4, 2)
  tachHobbsRatioMax         Decimal @default(1.10) @db.Decimal(4, 2)

  meterMismatchMode         WarningMode @default(WARN)
  unexpectedDurationMode    WarningMode @default(WARN)
  missingInstructorTimeMode WarningMode @default(WARN)
  missingPayerMode          WarningMode @default(WARN)
  missingPaymentMethodMode  WarningMode @default(WARN)
  unexpectedFeeMode         WarningMode @default(WARN)
  maintenanceThresholdMode  WarningMode @default(WARN)
  hobbsOutDriftMode         WarningMode @default(WARN)
  concurrentReleaseMode     WarningMode @default(BLOCK)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
}

enum CheckoutRestrictionKey {
  AIRCRAFT_GROUNDED
  MAINTENANCE_OVERDUE
  OPEN_CRITICAL_SQUAWK
  MEDICAL_EXPIRED
  CERTIFICATE_EXPIRED
  INSTRUCTOR_NOT_CURRENT
  STUDENT_NOT_CURRENT
  ENDORSEMENT_MISSING
  MAINTENANCE_DUE_SOON
  PROGRAM_REQUIREMENTS_INCOMPLETE
  INSURANCE_DOCUMENT_MISSING
  PAYMENT_METHOD_MISSING
  PRIOR_PAYMENT_FAILED
  AMOUNT_DUE_OVER_THRESHOLD
  MEMBERSHIP_INACTIVE
}

enum RestrictionEnforcement {
  OFF
  WARN
  REQUIRE_REVIEW
  BLOCK_OVERRIDABLE
  BLOCK
}

enum RestrictionCategory {
  SAFETY
  OPERATIONAL
  FINANCIAL
}

enum RestrictionDecisionKind {
  OVERRIDE
  REVIEW_CLEARED
}

/// Org config for one restriction key; absent row = engine default. SAFETY
/// keys never have rows (API-rejected, engine-ignored) — doc 10.
model CheckoutRestrictionPolicy {
  id              String                 @id @default(cuid())
  organizationId  String
  key             CheckoutRestrictionKey
  enforcement     RestrictionEnforcement
  thresholdAmount Decimal?               @db.Decimal(12, 2) // AMOUNT_DUE_OVER_THRESHOLD
  currency        String?                @db.Char(3)        // required when thresholdAmount set
  thresholdHours  Decimal?               @db.Decimal(6, 1)  // MAINTENANCE_DUE_SOON margin (default 10.0)
  thresholdDays   Int?                                      // default 14
  exemptOrgRoleIds String[]              @default([])       // FINANCIAL keys only; same-org OrgRole ids
  createdAt       DateTime               @default(now())
  updatedAt       DateTime               @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, key])
}

/// Immutable record of a human decision that let a restricted release proceed
/// (doc 10). One decision per (dispatch, key) — one-time-override semantics.
model DispatchRestrictionDecision {
  id                String                  @id @default(cuid())
  organizationId    String
  dispatchId        String
  key               CheckoutRestrictionKey
  kind              RestrictionDecisionKind
  category          RestrictionCategory     // snapshot; SAFETY can never appear (engine-enforced)
  enforcementAtTime RestrictionEnforcement  // mode in force at decision time
  findingDetail     String
  reason            String                  // required, non-empty
  actorUserId       String
  actorLabel        String
  createdAt         DateTime                @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  dispatch     Dispatch     @relation(fields: [dispatchId], references: [id], onDelete: Cascade) // AuditLog survives deletion

  @@unique([dispatchId, key])
  @@index([organizationId, createdAt])
  @@index([organizationId, key, createdAt])
}
```

### 4.6 Pricing & rate profiles (docs 04 / 05; R7–R9, R11)

```prisma
enum ProfileStatus {
  DRAFT
  APPROVED
  ARCHIVED
  // SUPERSEDED is derived at read (newer APPROVED version in the family) — R7
}

enum PricingBillingBasis {
  HOBBS
  TACH
  FIXED
  CUSTOM_UNIT
}

enum WetDryDesignation {
  WET
  DRY
  NOT_APPLICABLE
}

enum PricingRoundingRule {
  NEAREST_TENTH
  NEAREST_HUNDREDTH
  UP_TENTH
  UP_HUNDREDTH
  NONE
}

enum TaxTreatment {
  TAXABLE
  NON_TAXABLE
}

/// One way to price one aircraft (or the fleet) for one audience (doc 05).
/// Versioned + effective-dated; APPROVED rows are never edited in place.
model AircraftPricingProfile {
  id             String  @id @default(cuid())
  organizationId String
  aircraftId     String? // null = fleet-wide profile
  locationId     String? // location-specific rates (resolution L4)
  familyId       String  // version-family id (= id of version 1)
  version        Int     @default(1)
  name           String
  description    String?
  status         ProfileStatus @default(DRAFT)
  isDefault      Boolean @default(false) // org default (aircraftId null, L5) or aircraft default (L6)
  priority       Int     @default(100)   // within-level tiebreak, lower wins

  billingBasis    PricingBillingBasis @default(HOBBS)
  customUnitLabel String?             // required when billingBasis = CUSTOM_UNIT
  wetDry          WetDryDesignation   @default(WET)
  rateAmount      Decimal             @db.Decimal(12, 2)
  currency        String              @default("USD") @db.Char(3)
  minBillableQuantity Decimal?        @db.Decimal(6, 2) // in basis units, applied after rounding
  roundingRule    PricingRoundingRule @default(NEAREST_TENTH)
  taxTreatment    TaxTreatment?       // null = inherit (R9)
  includedFeeItemIds String[]         @default([]) // RevenueItem ids covered by the rate; engine-validated same-org

  eligibleMembershipRoles String[] @default([]) // Role names or "custom:<orgRoleId>"
  eligibleCustomerTypes   String[] @default([]) // member | non_member | student | discovery | renter | staff | owner
  eligibleProgramIds      String[] @default([]) // Syllabus ids (program = Syllabus)

  effectiveStart DateTime
  effectiveEnd   DateTime?

  createdById     String
  createdByLabel  String
  approvedById    String?
  approvedByLabel String?
  approvedAt      DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  aircraft     Aircraft?    @relation(fields: [aircraftId], references: [id], onDelete: Cascade)
  location     Location?    @relation(fields: [locationId], references: [id], onDelete: SetNull)

  dispatches   Dispatch[]
  invoiceLines InvoiceLine[]

  @@unique([organizationId, familyId, version])
  @@index([organizationId, status])
  @@index([organizationId, aircraftId, effectiveStart])
  @@index([organizationId, effectiveStart])
}

enum InstructorRateKind {
  BILLING      // what the customer is charged
  COMPENSATION // what the instructor earns — never inferred from BILLING (principle 6)
}

enum InstructorClassification {
  EMPLOYEE
  CONTRACTOR
  UNSPECIFIED
}

/// Effective-dated, versioned, approval-gated instructor rates (doc 04).
/// kind separates customer billing from instructor compensation structurally.
model InstructorRateProfile {
  id             String             @id @default(cuid())
  organizationId String
  kind           InstructorRateKind
  instructorId   String?            // null = org-wide default tier
  locationId     String?
  syllabusId     String?            // program scoping (program = Syllabus)
  name           String
  notes          String?
  familyId       String             // version-family id (R8)
  version        Int                @default(1)
  status         ProfileStatus      @default(DRAFT)
  priority       Int                @default(100)
  classification InstructorClassification @default(UNSPECIFIED) // COMPENSATION kind; AeroOps never determines legal worker classification (doc 04 disclaimer)
  currency       String             @default("USD") @db.Char(3)
  taxTreatment   TaxTreatment?      // BILLING kind; null = inherit (doc 07)
  effectiveFrom  DateTime
  effectiveTo    DateTime?          // half-open window; only future-dated caps post-approval

  createdByLabel  String
  approvedById    String?
  approvedByLabel String?
  approvedAt      DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  instructor   Instructor?  @relation(fields: [instructorId], references: [id], onDelete: Restrict)
  location     Location?    @relation(fields: [locationId], references: [id], onDelete: SetNull)
  syllabus     Syllabus?    @relation(fields: [syllabusId], references: [id], onDelete: SetNull)

  lines        InstructorRateProfileLine[]
  earnings     InstructorEarning[]
  invoiceLines InvoiceLine[]

  @@unique([organizationId, kind, familyId, version])
  @@index([organizationId, kind, status])
  @@index([organizationId, instructorId, kind])
  @@index([organizationId, effectiveFrom])
}

/// Per-time-category rate within a profile version. Exactly one of rate |
/// percentOfBilling (app-enforced); percentOfBilling is COMPENSATION-only and
/// legal only when RevenueSettings.allowCompensationLinkedToBilling (principle 6 opt-in).
model InstructorRateProfileLine {
  id               String                 @id @default(cuid())
  profileId        String
  category         InstructorTimeCategory
  customLabel      String                 @default("") // non-null sentinel so the unique holds
  rate             Decimal?               @db.Decimal(12, 2)
  percentOfBilling Decimal?               @db.Decimal(5, 2)
  minBillableHours Decimal?               @db.Decimal(4, 2)
  createdAt        DateTime               @default(now())

  profile InstructorRateProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  @@unique([profileId, category, customLabel])
}
```

### 4.7 Instructor time & compensation (doc 04; merged earning shape per R6)

```prisma
enum InstructorTimeCategory {
  FLIGHT_INSTRUCTION
  GROUND_INSTRUCTION
  PREFLIGHT_BRIEFING
  POSTFLIGHT_DEBRIEFING
  SIMULATOR_INSTRUCTION
  ORAL_PREPARATION
  CHECKRIDE_PREPARATION
  STAGE_CHECK
  GROUND_SCHOOL
  ADMINISTRATIVE
  CUSTOM
}

enum InstructorTimeSource {
  INSTRUCTOR_ENTERED
  HOBBS_SUGGESTED
  SUPERVISOR_ENTERED
  SUPERVISOR_OVERRIDE
}

/// One categorized block of instructional time on a Revenue Review (doc 04).
/// Editable pre-submission; locked at review approval (engine-enforced).
model InstructorTimeEntry {
  id              String @id @default(cuid())
  organizationId  String
  revenueReviewId String
  instructorId    String
  scheduleEventId String?

  category    InstructorTimeCategory
  customLabel String?                // required iff category = CUSTOM
  hours       Decimal @db.Decimal(6, 2) // canonical post-rounding entered hours
  suggestedHours Decimal? @db.Decimal(6, 2) // Hobbs suggestion snapshot (divergence rule)
  source      InstructorTimeSource
  billToCustomer Boolean             // category-driven default, audited toggle
  compensable    Boolean
  notes          String?
  confirmedByInstructorAt DateTime?  // gates submission under SUGGEST_CONFIRM
  overrideReason          String?    // latest override reason; full history in AuditLog
  /// Actor of the latest SUPERVISOR_ENTERED / SUPERVISOR_OVERRIDE mutation,
  /// written on every such mutation — the on-row basis for separation-of-duties
  /// comparisons (doc 03 §2.8: a TIME_OVERRIDE actor may not approve the same
  /// review), mirroring InvoiceLine.addedByUserId. AuditLog remains the
  /// authoritative history but is best-effort and never load-bearing here.
  overriddenById          String?
  overriddenByLabel       String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  organization  Organization   @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  review        RevenueReview  @relation(fields: [revenueReviewId], references: [id], onDelete: Cascade) // approved reviews are never deletable (app rule)
  instructor    Instructor     @relation(fields: [instructorId], references: [id], onDelete: Restrict)   // LessonRecord precedent — wipe-order impact
  scheduleEvent ScheduleEvent? @relation(fields: [scheduleEventId], references: [id], onDelete: SetNull)

  earning      InstructorEarning?
  invoiceLines InvoiceLine[]

  @@index([organizationId, createdAt])
  @@index([revenueReviewId])
  @@index([instructorId, createdAt])
}

enum InstructorEarningStatus {
  PENDING   // written when compensationApprovalMode = SEPARATE_APPROVAL
  APPROVED  // payable fact; AUTO_ON_REVIEW_APPROVAL writes rows here directly
  EXPORTED  // stamped atomically by a FinancialExportJob (Part 3)
  REVERSED  // fully offset by reversal rows
  // PAID is deliberately absent — added additively if Part 3 ships payouts (R6)
}

/// Append-only Instructor Compensation snapshot written at Revenue Review
/// approval (docs 04 + 12 merged per R6). Corrections/refund clawbacks are
/// signed reversal rows — never updates.
model InstructorEarning {
  id              String  @id @default(cuid())
  organizationId  String
  instructorId    String
  revenueReviewId String
  timeEntryId     String? @unique // 1:1 for primary earnings; null on reversal rows

  category    InstructorTimeCategory
  customLabel String?

  hours    Decimal @db.Decimal(6, 2)
  rate     Decimal @db.Decimal(12, 2)  // resolved compensation rate snapshot (R11)
  amount   Decimal @db.Decimal(12, 2)  // signed; reversal rows negative; round-half-up(hours × rate)
  currency String  @db.Char(3)

  classification     InstructorClassification // snapshot at approval
  rateProfileId      String?                  // provenance — SetNull so history survives config cleanup
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
  instructor      Instructor             @relation(fields: [instructorId], references: [id], onDelete: Restrict)
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
```

### 4.8 Revenue Item catalog (doc 06; R10)

```prisma
enum RevenueItemCategory {
  AIRPORT_FEE    // airport, landing, ramp, parking, overnight
  FUEL_OIL       // fuel surcharge, oil
  AIRCRAFT_FEE   // cleaning, damage, late return
  SCHEDULING_FEE // cancellation, no-show
  INSTRUCTION    // checkride prep, ground school, simulator, discovery upgrade
  RETAIL         // materials, books, headsets, merchandise
  MEMBERSHIP     // membership fees, club dues
  ADMINISTRATIVE // admin fees, examiner (pass-through) fees
  CUSTOM
}

enum RevenueItemUnitBasis {
  PER_HOUR
  PER_LANDING
  PER_FLIGHT
  PER_DAY
  PER_UNIT // quantity in unitLabel units (quart, each)
  FIXED    // quantity locked at 1
}

enum RevenueItemAmountMode {
  FIXED    // line amount locked to defaultAmount
  VARIABLE // entered per line, within min/max guardrails
}

enum RevenueItemRisk {
  NORMAL
  HIGH // non-configurable enhanced-approval floor (damage fees): reason + note, adder never sole approver
}

enum RevenueLineOrigin {
  PRICING         // generated by Aircraft Pricing Profile resolution
  INSTRUCTOR_TIME // generated from an InstructorTimeEntry (BILLING rate)
  RULE            // auto-applied Revenue Rule (reserved seam — §12 Q4)
  RETURN_CAPTURE  // captured at aircraft return (airport/landing/ramp fees) — the spec's "check-in" fees; the banned word never enters the schema (R2)
  MANUAL          // authorized user added; reason required
  ADJUSTMENT      // materialized by an APPLIED RevenueAdjustment (doc 08)
}

/// Org-owned catalog entry describing one kind of charge (doc 06). Seeded with
/// 26 editable built-ins per org (isSystem = true) + unlimited custom items.
/// Items deactivate, never delete, once referenced (InvoiceLine Restrict).
model RevenueItem {
  id             String              @id @default(cuid())
  organizationId String
  code           String              // stable immutable machine key
  name           String              // freely editable (lines snapshot it into description)
  description    String?
  category       RevenueItemCategory
  unitBasis      RevenueItemUnitBasis
  unitLabel      String?             // PER_UNIT display unit
  amountMode     RevenueItemAmountMode
  defaultAmount  Decimal?            @db.Decimal(12, 2) // seeds ship empty; required before a FIXED item is usable
  minAmount      Decimal?            @db.Decimal(12, 2)
  maxAmount      Decimal?            @db.Decimal(12, 2)
  currency       String              @default("USD") @db.Char(3)
  isTaxable      Boolean             @default(false)    // no-tax default (doc 07 resolution step 3; R10)
  riskLevel      RevenueItemRisk     @default(NORMAL)
  requiresNote           Boolean     @default(false)
  requiresAttachment     Boolean     @default(false)
  requiresSecondApproval Boolean     @default(false)
  defaultAccountingCategoryCode String? // Part 3 export seam
  isActive       Boolean             @default(true)
  effectiveFrom  DateTime?           // gates new adds only (org time zone)
  effectiveTo    DateTime?
  isSystem       Boolean             @default(false)
  displayOrder   Int                 @default(0)
  createdAt      DateTime            @default(now())
  updatedAt      DateTime            @updatedAt

  organization Organization          @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  locations    RevenueItemLocation[]
  programs     RevenueItemProgram[]
  aircraft     RevenueItemAircraft[]
  invoiceLines InvoiceLine[]

  @@unique([organizationId, code])
  @@index([organizationId, isActive, category])
}

/// Availability scoping join tables — no rows = available everywhere.
/// Relation-scoped through RevenueItem; same-org verified at write time.
model RevenueItemLocation {
  id            String   @id @default(cuid())
  revenueItemId String
  locationId    String
  createdAt     DateTime @default(now())

  revenueItem RevenueItem @relation(fields: [revenueItemId], references: [id], onDelete: Cascade)
  location    Location    @relation(fields: [locationId], references: [id], onDelete: Cascade)

  @@unique([revenueItemId, locationId])
  @@index([locationId])
}

model RevenueItemProgram {
  id            String   @id @default(cuid())
  revenueItemId String
  syllabusId    String   // program = Syllabus
  createdAt     DateTime @default(now())

  revenueItem RevenueItem @relation(fields: [revenueItemId], references: [id], onDelete: Cascade)
  syllabus    Syllabus    @relation(fields: [syllabusId], references: [id], onDelete: Cascade)

  @@unique([revenueItemId, syllabusId])
  @@index([syllabusId])
}

model RevenueItemAircraft {
  id            String   @id @default(cuid())
  revenueItemId String
  aircraftId    String
  createdAt     DateTime @default(now())

  revenueItem RevenueItem @relation(fields: [revenueItemId], references: [id], onDelete: Cascade)
  aircraft    Aircraft    @relation(fields: [aircraftId], references: [id], onDelete: Cascade)

  @@unique([revenueItemId, aircraftId])
  @@index([aircraftId])
}
```

### 4.9 Tax (doc 07; R1 renames `reviewLineId` → `invoiceLineId`)

```prisma
enum TaxProvider {
  INTERNAL
  STRIPE_TAX // reserved — selectable only when the Part 3 adapter + env exist
}

enum TaxRoundingMode {
  HALF_UP
  HALF_EVEN // reserved
}

enum TaxRoundingLevel {
  PER_RULE_TOTAL
  PER_LINE
}

/// One immutable, effective-dated version of an org- or location-scoped tax
/// rule (doc 07). Families identified by ruleKey; edits insert the next
/// version; referenced versions are frozen.
model TaxRule {
  id                String   @id @default(cuid())
  organizationId    String
  locationId        String?  // null = org-wide
  ruleKey           String   // stable family id across versions
  version           Int      @default(1)
  name              String   // e.g. "Georgia Sales Tax"
  jurisdictionLabel String   // org-entered; AeroOps never derives jurisdiction
  ratePercent       Decimal  @db.Decimal(7, 4) // 6.0000 = 6%
  appliesToKinds    String[] @default([])      // charge-class keys, engine-validated (lib catalog)
  effectiveStart    DateTime
  effectiveEnd      DateTime? // exclusive; no overlapping windows within a family
  isActive          Boolean  @default(true)
  deactivatedAt     DateTime?
  createdAt         DateTime @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  location     Location?    @relation(fields: [locationId], references: [id], onDelete: Cascade)
  snapshots    TaxSnapshot[]

  @@unique([organizationId, ruleKey, version])
  @@index([organizationId, isActive])
  @@index([organizationId, locationId, isActive])
}

/// Append-only point-in-time tax fact per (approved review, applied rule),
/// written inside the approval transaction. Copied values are authoritative;
/// the taxRuleId link is reporting convenience only.
model TaxSnapshot {
  id              String  @id @default(cuid())
  organizationId  String
  revenueReviewId String
  taxRuleId       String?

  ruleKey           String
  ruleVersion       Int?
  ruleName          String
  jurisdictionLabel String
  provider          TaxProvider @default(INTERNAL)
  providerRef       String?     // external calculation id (Part 3)
  ratePercent       Decimal?    @db.Decimal(7, 4) // nullable for provider-computed jurisdictions
  taxableBase       Decimal     @db.Decimal(12, 2)
  taxAmount         Decimal     @db.Decimal(12, 2)
  currency          String      @db.Char(3) // equals the review currency
  roundingMode      TaxRoundingMode
  roundingLevel     TaxRoundingLevel
  serviceDate       DateTime    // tax point used for rule resolution
  createdAt         DateTime    @default(now())

  organization Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  review       RevenueReview @relation(fields: [revenueReviewId], references: [id], onDelete: Cascade) // paired with the no-hard-delete app rule
  rule         TaxRule?      @relation(fields: [taxRuleId], references: [id], onDelete: SetNull)
  items        TaxSnapshotItem[]

  @@index([organizationId, createdAt])
  @@index([organizationId, taxRuleId])
  @@index([revenueReviewId])
}

/// Spec-required "applied items": which lines fed a snapshot's taxable base
/// (and per-line tax in PER_LINE mode). Relation-scoped through TaxSnapshot.
model TaxSnapshotItem {
  id              String   @id @default(cuid())
  taxSnapshotId   String
  invoiceLineId   String   // R1 — was reviewLineId in doc 07
  lineDescription String   // copied at approval for receipts/forensics
  lineKind        String   // line classification at approval
  taxableAmount   Decimal  @db.Decimal(12, 2) // signed contribution to the base
  taxAmount       Decimal? @db.Decimal(12, 2) // populated only in PER_LINE mode
  createdAt       DateTime @default(now())

  snapshot TaxSnapshot @relation(fields: [taxSnapshotId], references: [id], onDelete: Cascade)
  line     InvoiceLine @relation(fields: [invoiceLineId], references: [id], onDelete: Restrict)

  @@index([taxSnapshotId])
  @@index([invoiceLineId])
}
```

### 4.10 Adjustments, credits, promo codes, refunds, disputes (doc 08; Dispute bound here)

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

/// Umbrella authorization + money-fact record for all eight Part H operations
/// (doc 08). Approved snapshots are never edited — every post-approval change
/// is a RevenueAdjustment; APPLIED materializes appended signed InvoiceLine
/// rows (charge-side) or a Refund/CustomerCredit (collection-side).
model RevenueAdjustment {
  id              String           @id @default(cuid())
  organizationId  String
  number          String           // "ADJ-<seq>" via OrgSequence (R3)
  revenueReviewId String
  targetLineId    String?          // locked line being waived/voided/corrected
  kind            AdjustmentKind
  status          AdjustmentStatus @default(PENDING_APPROVAL)
  currency        String           @db.Char(3) // must equal review currency

  beforeAmount Decimal @db.Decimal(12, 2) // Part H before/after requirement
  afterAmount  Decimal @db.Decimal(12, 2)
  amountDelta  Decimal @db.Decimal(12, 2) // signed
  reason       String                     // required, non-empty

  requestedById         String?
  requestedByLabel      String
  approvedById          String?
  approvedByLabel       String?
  approvedAt            DateTime?
  secondApprovedById    String?
  secondApprovedByLabel String?
  secondApprovedAt      DateTime?

  effectiveAt DateTime? // accounting-period placement
  appliedAt   DateTime?

  // Kind-specific references
  promoCodeId          String?
  fromPayerId          String? // PAYER_TRANSFER
  toPayerId            String?
  correctedQuantity    Decimal? @db.Decimal(8, 2)  // matches InvoiceLine.quantity
  correctedUnitPrice   Decimal? @db.Decimal(10, 2) // matches InvoiceLine.unitPrice (R11)
  correctedDescription String?
  supportingDocumentId String?  // damage evidence / receipts

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  organization       Organization      @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  revenueReview      RevenueReview     @relation(fields: [revenueReviewId], references: [id], onDelete: Restrict)
  targetLine         InvoiceLine?      @relation("AdjustmentTarget", fields: [targetLineId], references: [id], onDelete: Restrict)
  promoCode          PromoCode?        @relation(fields: [promoCodeId], references: [id], onDelete: SetNull)
  fromPayer          ResponsiblePayer? @relation("AdjustmentFromPayer", fields: [fromPayerId], references: [id], onDelete: Restrict)
  toPayer            ResponsiblePayer? @relation("AdjustmentToPayer", fields: [toPayerId], references: [id], onDelete: Restrict)
  supportingDocument Document?         @relation(fields: [supportingDocumentId], references: [id], onDelete: SetNull)

  materializedLines InvoiceLine[]        @relation("AdjustmentLines")
  issuedCredits     CustomerCredit[]
  refund            Refund?
  promoRedemption   PromoCodeRedemption?

  @@unique([organizationId, number])
  @@index([organizationId, status])    // approval queue
  @@index([organizationId, createdAt]) // reporting
  @@index([revenueReviewId])
}

enum CreditStatus {
  OPEN
  PARTIALLY_APPLIED
  APPLIED
  EXPIRED
  CANCELLED
}

/// Bounded, origin-traced, expiring post-tax stored value — never a wallet
/// (doc 08). Issued only by an APPLIED CREDIT_ISSUE / refund-to-credit
/// adjustment; no top-up path exists.
model CustomerCredit {
  id                    String       @id @default(cuid())
  organizationId        String
  studentId             String?      // exactly one holder — XOR payerId (app-enforced)
  payerId               String?
  originAdjustmentId    String       @unique
  amount                Decimal      @db.Decimal(12, 2)
  currency              String       @db.Char(3)
  targetRevenueReviewId String?      // set = applicable only to that review
  expiresAt             DateTime     // default now + RevenueSettings.creditExpiryMonths
  status                CreditStatus @default(OPEN)
  createdAt             DateTime     @default(now())
  updatedAt             DateTime     @updatedAt

  organization     Organization      @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  student          Student?          @relation(fields: [studentId], references: [id], onDelete: SetNull)
  payer            ResponsiblePayer? @relation(fields: [payerId], references: [id], onDelete: Restrict)
  originAdjustment RevenueAdjustment @relation(fields: [originAdjustmentId], references: [id], onDelete: Restrict)
  targetReview     RevenueReview?    @relation("CreditTargetReview", fields: [targetRevenueReviewId], references: [id], onDelete: SetNull)
  applications     CreditApplication[]

  @@index([organizationId, status])
  @@index([studentId])
  @@index([payerId])
}

/// Append-only consumption ledger for credits (InventoryMovement idiom).
/// Remaining value is always derived in-transaction, never stored.
model CreditApplication {
  id              String  @id @default(cuid())
  creditId        String
  revenueReviewId String
  invoiceId       String?
  paymentId       String? // the ACCOUNT_CREDIT Payment that settled it (Part 2 wiring)
  amount          Decimal @db.Decimal(12, 2) // signed; negative rows reopen credit on refund
  appliedById     String?
  appliedByLabel  String
  createdAt       DateTime @default(now())

  credit  CustomerCredit @relation(fields: [creditId], references: [id], onDelete: Restrict)
  review  RevenueReview  @relation(fields: [revenueReviewId], references: [id], onDelete: Restrict)
  invoice Invoice?       @relation(fields: [invoiceId], references: [id], onDelete: Restrict)
  payment Payment?       @relation(fields: [paymentId], references: [id], onDelete: Restrict)

  @@unique([creditId, revenueReviewId]) // structural double-application guard
  @@index([revenueReviewId])
}

enum PromoDiscountType {
  PERCENT
  FIXED_AMOUNT
}

model PromoCode {
  id                 String            @id @default(cuid())
  organizationId     String
  code               String            // stored uppercase; matched case-insensitively
  discountType       PromoDiscountType
  percentValue       Decimal?          @db.Decimal(5, 2)
  amountValue        Decimal?          @db.Decimal(12, 2)
  currency           String            @default("USD") @db.Char(3)
  maxDiscountAmount  Decimal?          @db.Decimal(12, 2) // cap for percent codes
  appliesToCategories String[]         @default([])       // RevenueItemCategory keys; empty = whole review
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
  adjustments  RevenueAdjustment[]

  @@unique([organizationId, code])
  @@index([organizationId, active])
}

/// One redemption per (code, review), 1:1 with its PROMO_CODE adjustment;
/// snapshots the computed discount so later code edits never change history.
model PromoCodeRedemption {
  id              String  @id @default(cuid())
  promoCodeId     String
  revenueReviewId String
  adjustmentId    String  @unique
  amount          Decimal @db.Decimal(12, 2)
  createdAt       DateTime @default(now())

  promoCode  PromoCode         @relation(fields: [promoCodeId], references: [id], onDelete: Restrict)
  review     RevenueReview     @relation(fields: [revenueReviewId], references: [id], onDelete: Restrict)
  adjustment RevenueAdjustment @relation(fields: [adjustmentId], references: [id], onDelete: Restrict)

  @@unique([promoCodeId, revenueReviewId])
  @@index([promoCodeId])
}

enum RefundDestination {
  ORIGINAL_METHOD
  CUSTOMER_CREDIT
  MANUAL
}

enum RefundStatus {
  PENDING
  PROCESSING
  SUCCEEDED
  FAILED
  CANCELLED
}

/// Refund execution record against one specific Payment (doc 08). Amount is
/// capped at captured minus prior succeeded/in-flight refunds, checked
/// in-transaction. Provider mechanics (Stripe test mode, webhooks) land in Part 2.
model Refund {
  id               String            @id @default(cuid())
  organizationId   String
  adjustmentId     String            @unique // one refund per adjustment — replay guard
  paymentId        String
  amount           Decimal           @db.Decimal(12, 2)
  currency         String            @db.Char(3)
  destination      RefundDestination
  status           RefundStatus      @default(PENDING)
  providerRefundId String?           // opaque re_... reference — safe metadata only
  issuedCreditId   String?           // when destination = CUSTOMER_CREDIT
  failureReason    String?
  processedAt      DateTime?
  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt

  organization Organization      @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  adjustment   RevenueAdjustment @relation(fields: [adjustmentId], references: [id], onDelete: Restrict)
  payment      Payment           @relation(fields: [paymentId], references: [id], onDelete: Restrict)
  issuedCredit CustomerCredit?   @relation(fields: [issuedCreditId], references: [id], onDelete: SetNull)

  @@index([organizationId, status]) // reconciliation queue
  @@index([paymentId])
}

enum DisputeStatus {
  OPEN
  UNDER_REVIEW
  WON
  LOST
  WARNING_CLOSED
}

/// Provider dispute/chargeback record. Shape bound in Part 1; the writer is
/// the Part 2 webhook processor (no dispute can exist before live provider
/// events). Only opaque references and safe metadata are stored (principle 8).
model Dispute {
  id                String          @id @default(cuid())
  organizationId    String
  invoiceId         String
  revenueReviewId   String?
  paymentId         String?
  provider          PaymentProvider @default(STRIPE)
  providerDisputeId String
  amount            Decimal         @db.Decimal(12, 2)
  currency          String          @db.Char(3)
  reason            String?         // provider reason code
  status            DisputeStatus   @default(OPEN)
  evidenceDueBy     DateTime?
  openedAt          DateTime
  resolvedAt        DateTime?
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt

  organization Organization   @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  invoice      Invoice        @relation(fields: [invoiceId], references: [id], onDelete: Restrict)
  review       RevenueReview? @relation(fields: [revenueReviewId], references: [id], onDelete: SetNull)
  payment      Payment?       @relation(fields: [paymentId], references: [id], onDelete: Restrict)

  @@unique([provider, providerDisputeId])
  @@index([organizationId, status])
}
```

(`Payment` gains the back-relation `disputes Dispute[]`.)

### 4.11 Responsible payers (doc 11)

```prisma
enum PayerType {
  PARENT
  GUARDIAN
  EMPLOYER
  SCHOLARSHIP_SPONSOR
  UNIVERSITY
  CLUB_SPONSOR
  OTHER
}

enum PayerStatus {
  INVITED
  ACTIVE
  SUSPENDED
  ARCHIVED
}

enum PayerRelationshipStatus {
  PENDING
  ACTIVE
  REVOKED
}

/// Org-scoped registration of a paying party (doc 11) — identity #3 of the
/// five-way separation (student / customer identity / payer / Stripe customer
/// / org). Optionally linked to a global User; archived, never hard-deleted.
model ResponsiblePayer {
  id             String      @id @default(cuid())
  organizationId String
  userId         String?     // global login; null until invitation accepted
  payerType      PayerType
  displayName    String      // snapshotted onto approved reviews as billToLabel
  companyName    String?     // legal/billing entity for entity payers
  email          String
  phone          String?
  status         PayerStatus @default(INVITED)
  /// Consent to charge saved methods (per org).
  billingAuthorizationVersion    String?
  billingAuthorizationAcceptedAt DateTime?
  /// sha256 of the single-use invitation token (lib/tokens.ts, ADR-020).
  inviteTokenHash String?   @unique
  inviteExpiresAt DateTime?
  invitedByLabel  String?
  notes           String?   // staff-only
  archivedAt      DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user         User?        @relation(fields: [userId], references: [id], onDelete: SetNull)

  relationships    StudentPayerRelationship[]
  dispatches       Dispatch[]
  revenueReviews   RevenueReview[]
  invoices         Invoice[]
  credits          CustomerCredit[]
  paymentCustomers PaymentCustomer[]
  transfersFrom    RevenueAdjustment[]        @relation("AdjustmentFromPayer")
  transfersTo      RevenueAdjustment[]        @relation("AdjustmentToPayer")

  @@unique([organizationId, userId]) // one payer registration per user per org
  @@index([organizationId, status])
  @@index([organizationId, email])
  @@index([userId])
}

/// Org-scoped link between one Student and one ResponsiblePayer: routing
/// config, not a financial record — approved reviews snapshot payer identity
/// and survive revocation (doc 11).
model StudentPayerRelationship {
  id             String                  @id @default(cuid())
  organizationId String
  studentId      String
  payerId        String
  status         PayerRelationshipStatus @default(ACTIVE)
  /// One ACTIVE default per student via partial unique index (raw SQL):
  ///   CREATE UNIQUE INDEX "StudentPayerRelationship_default_key"
  ///   ON "StudentPayerRelationship"("studentId")
  ///   WHERE "isDefault" AND status = 'ACTIVE';
  isDefault      Boolean                 @default(false)
  canViewInvoices         Boolean @default(true)
  canManagePaymentMethods Boolean @default(true)
  receivesNotifications   Boolean @default(true)
  chargeApprovalRequired  Boolean @default(false)
  guardianConsentAt      DateTime?
  guardianConsentByLabel String?
  consentDocumentId      String?
  studentAcknowledgedAt  DateTime? // adult-student acknowledgment when org requires it
  revokedAt      DateTime?
  revokedReason  String?
  createdByLabel String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organization    Organization     @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  student         Student          @relation(fields: [studentId], references: [id], onDelete: Cascade)
  payer           ResponsiblePayer @relation(fields: [payerId], references: [id], onDelete: Restrict)
  consentDocument Document?        @relation("PayerConsentDocuments", fields: [consentDocumentId], references: [id], onDelete: SetNull)

  @@unique([studentId, payerId]) // re-link reactivates the row
  @@index([organizationId, status])
  @@index([payerId, status])
  @@index([studentId, status])
}
```

### 4.12 Payment collection (doc 09; docs 11/R20 for PaymentCustomer)

```prisma
enum PaymentTimingPolicy {
  IMMEDIATE_ON_APPROVAL // spec-recommended default
  SAME_DAY_BATCH
  NIGHTLY_BATCH
  WEEKLY_BATCH
  MANUAL_CHARGE
  MANUAL_INVOICE
  ACH_ONLY_BATCH
  CUSTOM_DATE
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
  REQUIRES_VERIFICATION
  SUSPENDED
  DETACHED
}

enum ScheduledChargeStatus {
  SCHEDULED
  AWAITING_MANUAL
  PROCESSING
  COMPLETED
  FAILED
  CANCELLED // R12 spelling
}

enum PaymentAttemptStatus {
  CREATED
  PROCESSING // holds the ACH pending window
  SUCCEEDED
  FAILED
  CANCELLED // R12 spelling
}

enum PaymentAttemptTrigger {
  IMMEDIATE_ON_APPROVAL
  BATCH
  MANUAL
  AUTO_RETRY
}

/// Per-org payment timing & collection configuration (Part I, doc 09).
/// One optional row; absent row = strong defaults. Config selectors are
/// String-typed with engine-validated catalogs (R25).
model OrgPaymentPolicy {
  id             String              @id @default(cuid())
  organizationId String              @unique
  defaultTimingPolicy PaymentTimingPolicy   @default(IMMEDIATE_ON_APPROVAL)
  overridePolicies    PaymentTimingPolicy[] @default([]) // approver may pick per review; empty = none

  sameDayBatchHourLocal Int @default(17) // org timeZone
  nightlyBatchHourLocal Int @default(2)
  weeklyBatchDay        Int @default(1)  // 0 = Sunday
  weeklyBatchHourLocal  Int @default(2)

  achBatchCadence      String @default("NIGHTLY")        // NIGHTLY | WEEKLY
  achOnlyFallback      String @default("MANUAL_INVOICE") // HOLD_FOR_METHOD | MANUAL_INVOICE
  customDateMaxDays    Int    @default(30)
  manualInvoiceNetDays Int    @default(14)

  retryMode           String @default("MANUAL_ONLY") // MANUAL_ONLY | AUTO
  maxAutoRetries      Int    @default(0)
  autoRetryDelaysDays Int[]  @default([1, 3, 7])

  approveWithoutMethod   String  @default("WARN") // WARN (falls back to manual invoice) | BLOCK
  deferredPaymentAllowed Boolean @default(false)  // principle 4 gate for org-permitted Amount Due

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
}

/// Org-scoped mapping of a paying party to a provider customer object (lives
/// on the org's connected account under Stripe Connect — Part 2). Created
/// lazily on first Payment Method save. Exactly one of payerId | studentId
/// (app-enforced XOR).
model PaymentCustomer {
  id                 String          @id @default(cuid())
  organizationId     String
  provider           PaymentProvider @default(STRIPE)
  providerCustomerId String          // opaque cus_... reference — not a secret
  payerId            String?
  studentId          String?
  createdAt          DateTime        @default(now())
  updatedAt          DateTime        @updatedAt

  organization Organization      @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  payer        ResponsiblePayer? @relation(fields: [payerId], references: [id], onDelete: SetNull)
  student      Student?          @relation(fields: [studentId], references: [id], onDelete: SetNull)
  methods      PaymentMethodReference[]

  @@unique([organizationId, provider, providerCustomerId]) // R20 — union of 09 + 11
  @@unique([organizationId, payerId])
  @@unique([organizationId, studentId])
}

/// Saved Payment Method: opaque provider reference + the complete safe-metadata
/// allowlist below — NOTHING else is ever stored (principle 8: no PAN, CVV,
/// bank numbers, or raw tokens). Rows are never deleted while attempts
/// reference them — they detach (status + detachedAt).
model PaymentMethodReference {
  id                      String                    @id @default(cuid())
  organizationId          String
  paymentCustomerId       String
  provider                PaymentProvider           @default(STRIPE)
  providerPaymentMethodId String                    // opaque pm_... reference
  type                    StoredPaymentMethodType
  status                  StoredPaymentMethodStatus @default(ACTIVE)
  // ---- Safe display metadata allowlist (complete) ----
  brand       String? // "visa"
  last4       String?
  expMonth    Int?
  expYear     Int?
  bankName    String?
  fingerprint String? // provider dedupe fingerprint — not a credential
  isDefault   Boolean   @default(false)
  detachedAt  DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  organization Organization    @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  customer     PaymentCustomer @relation(fields: [paymentCustomerId], references: [id], onDelete: Cascade)

  scheduledCharges ScheduledCharge[]
  revenueReviews   RevenueReview[]

  @@unique([organizationId, provider, providerPaymentMethodId])
  @@index([paymentCustomerId, status])
}

/// The per-approval collection anchor and immutable payment-timing snapshot
/// (doc 09). Exactly one per approved Revenue Review, created inside the
/// approval transaction for EVERY policy (including MANUAL_INVOICE). Status
/// moves only via guarded updateMany claims.
model ScheduledCharge {
  id              String              @id @default(cuid())
  organizationId  String
  revenueReviewId String              @unique // second link in the Dispatch→Review→Charge chain
  invoiceId       String              @unique
  policy          PaymentTimingPolicy // write-once snapshot of the effective policy
  runAfter        DateTime?           // computed at approval in org timeZone; null for MANUAL_*; mutable only for retry slots
  amount          Decimal             @db.Decimal(12, 2) // invoice total locked at approval
  currency        String              @db.Char(3)
  paymentMethodReferenceId String?    // re-pointable only in FAILED/AWAITING_MANUAL, audited
  status          ScheduledChargeStatus @default(SCHEDULED)
  attemptCount    Int                 @default(0)
  lastAttemptId   String?
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt

  organization Organization            @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  review       RevenueReview           @relation(fields: [revenueReviewId], references: [id], onDelete: Restrict)
  invoice      Invoice                 @relation(fields: [invoiceId], references: [id], onDelete: Restrict)
  method       PaymentMethodReference? @relation(fields: [paymentMethodReferenceId], references: [id], onDelete: SetNull)
  attempts     PaymentAttempt[]

  @@index([organizationId, status, runAfter]) // per-org runner queue
  @@index([status, runAfter])                 // platform batch sweep (cross-org, authorizePlatform-only)
  @@index([organizationId, createdAt])        // reconciliation
}

/// Append-only record of each charge try (doc 09). Carries the deterministic
/// per-attempt provider idempotency key; a stuck PROCESSING attempt is
/// resolved reconcile-then-proceed, never paralleled.
model PaymentAttempt {
  id                      String               @id @default(cuid())
  organizationId          String
  scheduledChargeId       String
  attemptNumber           Int
  invoiceId               String
  /// Deterministic: "sc_<scheduledChargeId>_a<attemptNumber>" — sent as the
  /// provider Idempotency-Key header.
  idempotencyKey          String               @unique
  provider                PaymentProvider      @default(STRIPE)
  providerPaymentIntentId String?              // opaque pi_... reference
  status                  PaymentAttemptStatus @default(CREATED)
  trigger                 PaymentAttemptTrigger
  amount                  Decimal              @db.Decimal(12, 2) // server-resolved, never client-supplied
  currency                String               @db.Char(3)
  // Denormalized method snapshot — survives method detachment
  methodType  StoredPaymentMethodType?
  methodBrand String?
  methodLast4 String?
  failureCode    String? // decline / ACH return code (R01...)
  failureMessage String?
  initiatedByUserId String?
  initiatedByLabel  String  // human, or "system:payment-runner"
  createdAt    DateTime  @default(now())
  processingAt DateTime?
  settledAt    DateTime?
  failedAt     DateTime?
  cancelledAt  DateTime?

  organization    Organization    @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  scheduledCharge ScheduledCharge @relation(fields: [scheduledChargeId], references: [id], onDelete: Restrict)
  invoice         Invoice         @relation(fields: [invoiceId], references: [id], onDelete: Restrict)
  payment         Payment?        // 1:1 back-relation (FK on Payment)

  @@unique([scheduledChargeId, attemptNumber])     // serializes retries
  @@unique([provider, providerPaymentIntentId])    // one local attempt per provider intent
  @@index([organizationId, status, createdAt])     // payment-status queues & reconciliation
  @@index([invoiceId])
}

/// Inbound provider webhook idempotency + forensic store (doc 09) — the spec's
/// "WebhookEvent" (R16). Unique-insert pattern: a duplicate delivery cannot
/// double-apply. Audit-grade: organizationId is SetNull (resolved server-side
/// from event metadata only) and the table is excluded from org-snapshot
/// wipe/restore, like AuditLog.
model PaymentProviderEvent {
  id              String          @id @default(cuid())
  provider        PaymentProvider @default(STRIPE)
  providerEventId String          // evt_...
  type            String
  payload         Json            // retained for forensic replay; never card/bank data (provider events carry none for our object set)
  organizationId  String?
  receivedAt      DateTime        @default(now())
  processedAt     DateTime?
  processingError String?

  organization Organization? @relation(fields: [organizationId], references: [id], onDelete: SetNull)

  @@unique([provider, providerEventId]) // Stripe event IDs must be unique (spec Part L)
  @@index([organizationId, receivedAt])
  @@index([type, receivedAt])
}
```

### 4.13 Allocation, platform fee, ledger, reconciliation, exports (doc 12)

```prisma
enum AllocationEvent {
  APPROVAL
  ADJUSTMENT
  REFUND
  VOID
  WRITE_OFF
}

enum AllocationDimension {
  REVENUE
  PROCEEDS
}

enum AllocationCategory {
  AIRCRAFT_REVENUE
  INSTRUCTOR_SERVICE_REVENUE
  AIRPORT_LANDING_FEES
  FUEL_REVENUE
  TAX
  OTHER_REVENUE
  PLATFORM_FEE            // PROCEEDS dimension only
  SCHOOL_RETAINED_REVENUE // PROCEEDS dimension only
}

/// Immutable, signed, set-balanced split of every financial event on a review
/// into Part B allocation categories, in two dimensions that each sum to the
/// event amount (doc 12). Refunds/adjustments/voids write signed reversal sets.
model RevenueAllocation {
  id              String              @id @default(cuid())
  organizationId  String
  revenueReviewId String
  invoiceId       String
  setId           String              // groups one balanced set per financial event
  event           AllocationEvent
  dimension       AllocationDimension
  category        AllocationCategory
  amount          Decimal             @db.Decimal(12, 2) // signed; reversals negative
  currency        String              @db.Char(3)
  sourceType      String?             // provenance of non-approval sets (RevenueAdjustment | Refund | ...)
  sourceId        String?
  /// Accounting-period bucket — copied in the same transaction from the
  /// effectiveAt of the triggering LedgerEntry journal (or of the adjustment/
  /// refund source that produced the set). Binding rule: every reporting
  /// surface and export (Revenue Dashboard, Revenue Reports, doc 12 §2.8
  /// report set, FinancialExportJob outputs) buckets allocations on
  /// effectiveAt, never createdAt, so correction/refund sets land in the same
  /// period across reports, ledger, and exports.
  effectiveAt     DateTime
  createdAt       DateTime            @default(now())

  organization Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  review       RevenueReview @relation(fields: [revenueReviewId], references: [id], onDelete: Restrict)
  invoice      Invoice       @relation(fields: [invoiceId], references: [id], onDelete: Restrict)

  @@unique([setId, dimension, category])
  @@index([organizationId, category, effectiveAt]) // Revenue Dashboard / Revenue Reports (period bucketing)
  @@index([organizationId, effectiveAt])
  @@index([revenueReviewId])
  @@index([invoiceId])
}

enum PlatformFeeBase {
  COLLECTED_PRETAX
  COLLECTED_TOTAL
}

enum PlatformFeeStatus {
  ACCRUED
  EARNED
  PARTIALLY_REVERSED
  REVERSED
  VOIDED
}

/// Platform-owned, effective-dated pricing for AeroOps' fee on collected
/// tenant revenue (doc 12). Resolution: org override → plan → global default
/// (both FKs null). Managed only via authorizePlatform surfaces; versions are
/// never overwritten.
model PlatformFeePolicy {
  id               String          @id @default(cuid())
  planId           String?
  organizationId   String?         // per-org override
  feePercentBps    Int             @default(0)
  feeFlatAmount    Decimal         @default(0) @db.Decimal(12, 2)
  feeBase          PlatformFeeBase @default(COLLECTED_PRETAX)
  minFee           Decimal?        @db.Decimal(12, 2)
  maxFee           Decimal?        @db.Decimal(12, 2)
  currency         String          @default("USD") @db.Char(3) // denominates feeFlatAmount/minFee/maxFee (§2.3)
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

/// AeroOps' earned fee for one paid Revenue Review — accrued at approval with
/// a full basis snapshot, earned at collection, reversed on refund (doc 12).
/// Tenant-visible; bridges tenant revenue and the platform money system.
model PlatformFee {
  id                String            @id @default(cuid())
  organizationId    String
  revenueReviewId   String            @unique
  invoiceId         String
  status            PlatformFeeStatus @default(ACCRUED)
  feePercentBps     Int
  feeFlatAmount     Decimal           @db.Decimal(12, 2)
  feeBase           PlatformFeeBase
  appliedBaseAmount Decimal           @db.Decimal(12, 2)
  amount            Decimal           @db.Decimal(12, 2)
  reversedAmount    Decimal           @default(0) @db.Decimal(12, 2)
  currency          String            @db.Char(3)
  policyId          String?
  policyVersion     Int?
  providerRef       String?           // Stripe application-fee id (Part 2) — opaque only
  /// Stamped in the settlement transaction that flips status → EARNED (doc 12).
  /// Earned-by-period reporting (Revenue Dashboard tile, Platform Fee
  /// Statement) buckets on this, never on createdAt (= accrual time).
  earnedAt          DateTime?
  createdAt         DateTime          @default(now())
  updatedAt         DateTime          @updatedAt

  organization Organization       @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  review       RevenueReview      @relation(fields: [revenueReviewId], references: [id], onDelete: Restrict)
  invoice      Invoice            @relation(fields: [invoiceId], references: [id], onDelete: Restrict)
  policy       PlatformFeePolicy? @relation(fields: [policyId], references: [id], onDelete: SetNull)

  @@index([organizationId, status])
  @@index([organizationId, createdAt])
}

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

enum LedgerDirection {
  DEBIT
  CREDIT
}

/// Append-only double-entry spine (doc 12). Sole writer: src/lib/ledger.ts.
/// Every journal balances (Σ debits = Σ credits, one currency per journal);
/// corrections are reversing journals, never edits or deletes.
model LedgerEntry {
  id             String          @id @default(cuid())
  organizationId String
  journalId      String
  event          String          // dot-namespaced financial event, e.g. "revenue_review.approved"
  account        LedgerAccount
  direction      LedgerDirection
  amount         Decimal         @db.Decimal(12, 2) // always > 0 (engine-enforced)
  currency       String          @db.Char(3)
  sourceType     String          // RevenueReview | Payment | Refund | PlatformFee | InstructorEarning | ...
  sourceId       String
  effectiveAt    DateTime        // reporting bucket in org timeZone
  createdAt      DateTime        @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId, account, effectiveAt])
  @@index([organizationId, journalId])
  @@index([sourceType, sourceId]) // reconciliation lookups
}

enum PayoutStatus {
  PENDING
  IN_TRANSIT
  PAID
  FAILED
  RECONCILED
  RECONCILED_WITH_EXCEPTIONS
}

/// Provider payout record (populated by the Part 2 webhook processor) for
/// payout ↔ ledger ↔ invoice matching (doc 12).
model ProviderPayout {
  id               String       @id @default(cuid())
  organizationId   String
  provider         String       @default("stripe")
  providerPayoutId String       // po_...
  status           PayoutStatus @default(PENDING)
  amount           Decimal      @db.Decimal(12, 2)
  grossAmount      Decimal      @db.Decimal(12, 2)
  feesAmount       Decimal      @db.Decimal(12, 2)
  currency         String       @db.Char(3)
  arrivalDate      DateTime?
  matchedCount     Int          @default(0)
  unmatchedCount   Int          @default(0)
  raw              Json?        // provider composition for forensics — never card/bank data
  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, provider, providerPayoutId])
  @@index([organizationId, status])
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

enum ReconciliationExceptionStatus {
  OPEN
  RESOLVED
  IGNORED
}

/// One row per unmatched/inconsistent item from the structural invariant
/// checks (R1–R6 in doc 12), payout matching, and staleness watches.
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
  currency         String?                       @db.Char(3) // set whenever expectedAmount/actualAmount are recorded (§2.3)
  detectedAt       DateTime                      @default(now())
  resolvedByUserId String?
  resolvedAt       DateTime?
  resolutionNote   String?                       // required to resolve (audited)
  createdAt        DateTime                      @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId, status])         // exception queue
  @@index([organizationId, kind, detectedAt])
}

enum ExportJobKind {
  REVENUE_CSV
  LEDGER_CSV
  QUICKBOOKS_CSV
  INSTRUCTOR_COMPENSATION_CSV
  TAX_CSV
}

enum ExportJobStatus {
  PENDING
  RUNNING
  COMPLETED
  COMPLETED_WITH_ERRORS
  FAILED
}

/// Org-scoped Financial Export job (ImportJob idiom in reverse; doc 12).
/// Part 3 executes. Marks compensation rows EXPORTED atomically with the
/// manifest write; nothing fails silently (per-row errors recorded).
model FinancialExportJob {
  id                String          @id @default(cuid())
  organizationId    String
  kind              ExportJobKind
  status            ExportJobStatus @default(PENDING)
  periodStart       DateTime
  periodEnd         DateTime
  params            Json?
  rowCount          Int             @default(0)
  errorCount        Int             @default(0)
  rowErrors         Json?           // [{ row, message }]
  exportedRecordIds Json?           // manifest (ImportJob.createdRecords idiom)
  fileDocumentId    String?         // export file stored via storage adapter as a Document
  checksum          String?
  createdById       String?
  createdByLabel    String
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt

  organization Organization        @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  file         Document?           @relation(fields: [fileDocumentId], references: [id], onDelete: SetNull)
  earnings     InstructorEarning[]

  @@index([organizationId, createdAt])
  @@index([organizationId, status])
}

enum MappingSourceType {
  ALLOCATION_CATEGORY
  LEDGER_ACCOUNT
  REVENUE_ITEM
  TAX_CODE
  PAYMENT_METHOD
}

/// Maps the fixed internal taxonomy to the org's external chart of accounts
/// for exports (doc 12) — where per-org accounting flexibility lives.
model AccountingMapping {
  id              String            @id @default(cuid())
  organizationId  String
  externalSystem  String            @default("quickbooks")
  sourceType      MappingSourceType
  sourceKey       String            // e.g. "AIRCRAFT_REVENUE" or a revenueItemId
  externalAccount String
  externalClass   String?
  externalItem    String?
  active          Boolean           @default(true)
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, externalSystem, sourceType, sourceKey])
}
```

### 4.14 Org Revenue Engine settings singleton (consolidates 04 / 05 / 07 / 08-R15 / 11 / 12)

```prisma
enum TimeRoundingMode {
  DECIMAL_FREE
  TENTH
  HUNDREDTH
  MINUTE
}

enum FlightTimeSuggestionMode {
  SUGGEST_CONFIRM // default — Hobbs suggests, instructor confirms
  AUTO_FILL       // org explicitly configures silent determination
  MANUAL_ONLY
}

enum HobbsDivergenceAction {
  WARN
  BLOCK
}

enum InstructorClawbackPolicy {
  NEVER
  SERVICE_LINES_ONLY
  ALWAYS_PRO_RATA
}

enum DiscountAllocationMode {
  TARGET_CATEGORY
  PROPORTIONAL
}

enum CompensationApprovalMode {
  AUTO_ON_REVIEW_APPROVAL
  SEPARATE_APPROVAL
}

enum CompensationRefundPolicy {
  REQUIRE_APPROVAL
  AUTO_REVERSE
  NEVER
}

enum PayerChargeApprovalMode {
  OFF              // chargeApprovalRequired flags on relationships are ignored
  PER_RELATIONSHIP // doc 11 §3.7 flow armed where the relationship flag is set
}

enum AdultStudentConsentMode {
  ORG_AUTHORITY       // staff link payers; student is notified (default)
  STUDENT_ACKNOWLEDGE // relationship stays PENDING until studentAcknowledgedAt
}

enum MinorPayerPolicy {
  OFF
  WARN
  REQUIRE
}

/// One row per org (absent row = defaults). Typed columns, never a settings
/// JSON blob. Behavior knobs only — approval policy lives on
/// RevenueWorkflowPolicy, payment timing on OrgPaymentPolicy, operational
/// capture on DispatchPolicy.
model RevenueSettings {
  id             String @id @default(cuid())
  organizationId String @unique

  // ---- Instructor time rules (doc 04) ----
  timeRoundingMode                TimeRoundingMode         @default(TENTH)
  minimumBillableIncrementHours   Decimal?                 @db.Decimal(4, 2)
  minimumGroundInstructionHours   Decimal?                 @db.Decimal(4, 2)
  defaultPreflightBriefingHours   Decimal                  @default(0.3) @db.Decimal(4, 2)
  defaultPostflightDebriefingHours Decimal                 @default(0.2) @db.Decimal(4, 2)
  flightTimeSuggestionMode        FlightTimeSuggestionMode @default(SUGGEST_CONFIRM)
  maxHobbsDivergenceHours         Decimal?                 @default(0.5) @db.Decimal(4, 2)
  hobbsDivergenceAction           HobbsDivergenceAction    @default(WARN)
  compensationUsesBilledQuantity  Boolean                  @default(true)
  allowCompensationLinkedToBilling Boolean                 @default(false) // principle 6 explicit opt-in gate
  allowRateSelfApproval           Boolean                  @default(true)  // self-approvals audit-flagged

  // ---- Pricing defaults (doc 05) ----
  defaultBillingBasis        PricingBillingBasis @default(HOBBS)
  defaultRoundingRule        PricingRoundingRule @default(NEAREST_TENTH)
  pricingSeparationOfDuties  Boolean             @default(false) // approvedById must differ from createdById

  // ---- Tax (doc 07) ----
  taxEnabled           Boolean          @default(false) // master switch — the no-tax default
  taxProvider          TaxProvider      @default(INTERNAL)
  taxRoundingMode      TaxRoundingMode  @default(HALF_UP)
  taxRoundingLevel     TaxRoundingLevel @default(PER_RULE_TOTAL)
  taxRegistrationLabel String?          // registration number for receipts — safe metadata, never a secret

  // ---- Credits / refunds / promos (doc 08 via R15) ----
  creditExpiryMonths       Int                      @default(12)
  autoApplyCredits         Boolean                  @default(true)
  refundToCreditAllowed    Boolean                  @default(true)
  instructorClawbackPolicy InstructorClawbackPolicy @default(SERVICE_LINES_ONLY)
  promoCodesEnabled        Boolean                  @default(true)
  refundWarnAfterDays      Int                      @default(90)

  // ---- Responsible payers (doc 11 §4; R29) ----
  /// The charge-approval flow these two knobs arm is deferred to Phase 9
  /// (16-risks-and-open-decisions.md D7); columns ship now, default OFF,
  /// no writer until then — they are the config home for §4.4's dormant
  /// payer-approval fields.
  payerChargeApproval         PayerChargeApprovalMode @default(OFF)
  payerApprovalWindowDays     Int                     @default(3)  // 1–14, engine-validated
  adultStudentConsent         AdultStudentConsentMode @default(ORG_AUTHORITY)
  minorPayerPolicy            MinorPayerPolicy        @default(WARN) // financial checkout restriction (doc 10) — never blocks emergency/safety actions
  payerInvitationExpiryDays   Int                     @default(14) // 1–60, engine-validated; expired invitations re-issuable
  billingAuthorizationVersion String                  @default("v1") // bumping forces re-acceptance before the next automatic charge
  payerNotificationsEnabled   Boolean                 @default(true) // master switch; per-relationship receivesNotifications still applies

  // ---- Allocation / compensation / reconciliation (doc 12) ----
  discountAllocationMode           DiscountAllocationMode   @default(TARGET_CATEGORY)
  compensationApprovalMode         CompensationApprovalMode @default(AUTO_ON_REVIEW_APPROVAL)
  compensationRefundPolicy         CompensationRefundPolicy @default(REQUIRE_APPROVAL)
  reconciliationStalePaymentDays   Int                      @default(5)
  reconciliationUnmatchedPayoutDays Int                     @default(7)
  defaultExportSystem              String                   @default("generic_csv") // quickbooks | generic_csv

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
}
```

---

## 5. Existing-enum extension strategy (binding)

Postgres cannot use a new enum value in the transaction that adds it, and dropping a value is destructive — so (DATABASE_STANDARDS two-step rule, ADR-023 precedent):

| Enum | Change | How |
|---|---|---|
| `InvoiceStatus` | **Add** `PARTIALLY_REFUNDED`, `REFUNDED`, `DISPUTED` | One additive DDL migration in the Part 2 payment slice, shipped **before** any code writes them. Existing values (`DRAFT OPEN PAID PARTIALLY_PAID VOID OVERDUE`) keep their exact meanings; no value is removed or renamed. For review-wrapped invoices, status becomes a projection of `RevenueReviewStatus` (doc 03 §2.2); standalone/legacy invoices behave exactly as today |
| `LineItemKind` | **Frozen** — no additions, no removals | New classification lives in `InvoiceLine.origin` + `revenueItemId` + `RevenueItem.category`. Catalog-sourced lines set `kind` via the pure projection `legacyKindFor(category, code)` (doc 06 §3.3, contract-tested) so every existing consumer keeps working unchanged |
| `PaymentMethod` | **Unchanged** | `StoredPaymentMethodType` (CARD, US_BANK_ACCOUNT) maps to existing `CARD`/`ACH` when `Payment` rows are created; `ACCOUNT_CREDIT` already covers credit consumption |
| `DispatchStatus`, `EventStatus`, `Role`, `DocumentKind` | **Unchanged** | No Revenue Engine need |
| `NotificationKind` | Optional additive values (e.g. `PAYMENT_FAILED`) may ship with Part 2 notification work | Same two-step rule; owned by the Part 2 implementation plan |

General rule restated for Parts 2–3: **never remove or rename an enum value; every new value on an existing enum gets its own additive migration before first use.** Brand-new enums may ship in the same DDL migration as the new tables that use them.

---

## 6. Immutability mechanics (binding)

### 6.1 What freezes, when

| Freeze point | What becomes immutable |
|---|---|
| **Rate/tax/item version approval** | `AircraftPricingProfile`, `InstructorRateProfile(+Line)` rows once `APPROVED` (only `effectiveEnd`/`effectiveTo` may be future-capped; edits insert the next version). `TaxRule` versions once referenced. `RevenueItem` history is protected by snapshot-at-add (the catalog row itself stays editable) |
| **Line add** | The line's item snapshot: `description`, `itemCode`, `unitBasis`, `unitLabel`, `isTaxable`, `requiresSecondApproval`, `accountingCategoryCode` — catalog edits never alter existing lines |
| **Revenue Review approval** (one `db.$transaction`) | All `InvoiceLine` rows of the wrapped invoice; `Invoice.subtotal/taxTotal/total/approvedAt/billToLabel`; `RevenueReview.approvalSnapshot/totalAtApproval/billToLabel/billToPayerType/paymentPolicyAtApproval`; `TaxSnapshot` + `TaxSnapshotItem` rows; `InstructorEarning` rows; `RevenueAllocation` APPROVAL set; `PlatformFee` accrual with basis snapshot; `ScheduledCharge.policy/amount/currency`; the approval `LedgerEntry` journal |
| **Adjustment APPLIED / payment events** | Appended rows only: signed `InvoiceLine` adjustment lines, `Refund`, `CustomerCredit`/`CreditApplication`, reversal `InstructorEarning` rows, signed `RevenueAllocation` reversal sets, reversing `LedgerEntry` journals, `PaymentAttempt` rows |

### 6.2 How snapshots are stored — the binding decision

**Hybrid: snapshot *rows* for anything queried or aggregated; one denormalized snapshot *JSON* for the full human-readable breakdown; frozen *columns* for document totals.**

- **Rows** (`TaxSnapshot`, `TaxSnapshotItem`, `InstructorEarning`, `RevenueAllocation`, `PlatformFee`, `LedgerEntry`): reporting, dashboards, exports, and reconciliation filter and sum these — JSON would force full-scan parsing and kill the index strategy.
- **JSON** (`RevenueReview.approvalSnapshot`): the complete point-in-time presentation (lines with provenance and labels, payer, timing, warnings) for receipts, dispute evidence, and forensics. Written once in the approval transaction, never recomputed, never queried by field.
- **Columns** (`Invoice.subtotal/taxTotal/total`, `RevenueReview.totalAtApproval`, `ScheduledCharge.amount`): the numbers other systems key on.

These are point-in-time **facts**, not caches — the documented carve-out from the DATABASE_STANDARDS derive-at-read rule. Pre-approval, nothing is stored: totals derive from lines at read.

### 6.3 Enforcement

Application-layer, in the engines (no DB triggers, matching house architecture):

- Every mutation path checks `invoice.approvedAt`/review status before touching lines; post-approval line mutation has **no code path** (doc 03 §risk table) — contract tests assert it.
- Post-approval money changes exist only as `RevenueAdjustment` (PENDING_APPROVAL → APPROVED → APPLIED via guarded `updateMany` claims) materializing **appended** records; `LINE_VOID`/`LINE_CORRECTION` append offsetting lines referencing `offsetsLineId` — originals are never edited.
- Append-only tables (`RevenueReviewApproval`, `TaxSnapshot*`, `InstructorEarning`, `RevenueAllocation`, `LedgerEntry`, `PaymentAttempt`, `CreditApplication`, `DispatchRestrictionDecision`) expose no update/delete API; corrections are new signed/reversing rows.
- Every financial mutation writes `recordAudit` + `emitDomainEvent` post-commit (house rule); the audit trail remains the authoritative actor record.

---

## 7. Idempotency & uniqueness inventory

The exactly-once chain — **Dispatch → RevenueReview → Invoice → ScheduledCharge → PaymentAttempt → Payment** — is enforced structurally at every hop:

| Invariant | Constraint |
|---|---|
| One active Revenue Review per dispatch (no duplicate billing) | Partial unique `RevenueReview(dispatchId) WHERE status <> 'VOIDED'` (raw SQL, R4) |
| One Invoice per review, one review per invoice | `RevenueReview.invoiceId @unique` (required 1:1) |
| One collection anchor per approved review | `ScheduledCharge.revenueReviewId @unique`, `ScheduledCharge.invoiceId @unique` |
| Serialized, replay-safe charge attempts | `PaymentAttempt @@unique([scheduledChargeId, attemptNumber])`; deterministic `idempotencyKey @unique` (`sc_<id>_a<n>`) sent as the provider Idempotency-Key; `@@unique([provider, providerPaymentIntentId])` |
| One settled Payment per successful attempt | `Payment.paymentAttemptId @unique` |
| Webhook processing idempotent; provider event IDs unique | `PaymentProviderEvent @@unique([provider, providerEventId])` — unique-insert before processing; duplicate delivery is a no-op |
| One refund per authorization | `Refund.adjustmentId @unique`; issuance capped in-transaction against prior refunds |
| No double credit application / promo redemption | `CreditApplication @@unique([creditId, revenueReviewId])`; `PromoCodeRedemption @@unique([promoCodeId, revenueReviewId])`, `.adjustmentId @unique`; `CustomerCredit.originAdjustmentId @unique` |
| One platform fee per review | `PlatformFee.revenueReviewId @unique` |
| One earning per time entry | `InstructorEarning.timeEntryId @unique` |
| One-time restriction override | `DispatchRestrictionDecision @@unique([dispatchId, key])` |
| Human-readable numbers unique per org | `@@unique([organizationId, number])` on `Invoice` (existing), `RevenueReview`, `RevenueAdjustment` — allocated from `OrgSequence` (`UPDATE … RETURNING` inside the creating transaction, §4.3), replacing the collision-prone `Date.now()` invoice generator for new invoices only |
| One provider object per row / one customer per party | `PaymentCustomer` triple unique (R20); `PaymentMethodReference @@unique([organizationId, provider, providerPaymentMethodId])`; `ProviderPayout @@unique([organizationId, provider, providerPayoutId])`; `Dispute @@unique([provider, providerDisputeId])` |
| One default payer per student | Partial unique on `StudentPayerRelationship` (raw SQL, §4.11); `@@unique([studentId, payerId])` |
| Config singletons | `organizationId @unique` on `DispatchPolicy`, `RevenueWorkflowPolicy`, `OrgPaymentPolicy`, `RevenueSettings`; `@@unique([organizationId, key])` on `CheckoutRestrictionPolicy`, `OrgSequence`; `@@unique([organizationId, code])` on `RevenueItem`/`PromoCode` |
| Version families | `@@unique([organizationId, familyId, version])` (pricing), `([organizationId, kind, familyId, version])` (instructor rates), `([organizationId, ruleKey, version])` (tax) |

State claims that gate side effects (charging, applying, batch pickup) use the **guarded `updateMany` claim** idiom (`WHERE id = ? AND status = ?` → check count) so concurrent runners cannot double-execute — the ADR-011 closeout pattern extended.

---

## 8. Foreign-key action policy (binding)

| Rule | Action | Applied to | Why |
|---|---|---|---|
| Org-owned records → `Organization` | `Cascade` | every new org-owned model except audit-grade | House rule (ADR-021): tenant deletion is a deliberate platform operation executed through the ordered wipe (§10), which deletes financial children first — the cascade is the backstop, never the mechanism. A raw `DELETE FROM "Organization"` is not a supported path (Restrict chains below would refuse it, exactly as `LessonRecord` already does) |
| Audit-grade rows | `SetNull` | `PaymentProviderEvent.organizationId` (joins `AuditLog`, `LoginEvent`) | Forensic trail outlives its subject; excluded from org-snapshot wipe/restore |
| **Financial fact → the financial record it evidences** | `Restrict` | `RevenueReview→Invoice`, `Payment→Invoice` (changed from Cascade), `Payment→PaymentAttempt`, `PaymentAttempt→ScheduledCharge/Invoice`, `ScheduledCharge→RevenueReview/Invoice`, `Refund→RevenueAdjustment/Payment`, `RevenueAdjustment→RevenueReview/targetLine`, `RevenueAllocation→RevenueReview/Invoice`, `PlatformFee→RevenueReview/Invoice`, `InstructorEarning→RevenueReview/Instructor/reversesEarning`, `TaxSnapshotItem→InvoiceLine`, `CreditApplication→CustomerCredit/RevenueReview/Invoice/Payment`, `CustomerCredit→originAdjustment/payer`, `PromoCodeRedemption→all three parents`, `Dispute→Invoice/Payment`, `InvoiceLine→RevenueItem/RevenueAdjustment`, `Invoice/RevenueReview→ResponsiblePayer` | **Approved financial records never cascade-delete.** An incidental delete anywhere upstream must fail loudly rather than silently erase money history; the only sanctioned hard-delete is the ordered tenant wipe |
| Workflow children of their document | `Cascade` | `InvoiceLine→Invoice`, `RevenueReviewApproval/InstructorTimeEntry/TaxSnapshot→RevenueReview`, `TaxSnapshotItem→TaxSnapshot`, `InstructorRateProfileLine→profile`, `RevenueItem* joins`, `PaymentMethodReference→PaymentCustomer`, `DispatchRestrictionDecision→Dispatch` | The child has no meaning without its parent; parents are themselves Restrict-protected once financially significant, so the cascade can only fire through the sanctioned wipe (or pre-approval deletion, where it is correct) |
| Provenance / configuration references | `SetNull` | profile links on lines/dispatches, `taxRuleId` on snapshots, locations, schedule events, documents, users, `payerId`/`studentId` on `PaymentCustomer`, `paymentMethodReferenceId` on `ScheduledCharge`/`RevenueReview` | History must outlive configuration; copied snapshot fields on the row remain authoritative |
| Instructor-signed records | `Restrict` | `InstructorTimeEntry.instructor`, `InstructorEarning.instructor`, `InstructorRateProfile.instructor` | Extends the `LessonRecord`/`Endorsement` precedent: an instructor with financial history cannot be hard-deleted; wipe order updated (§10) |

---

## 9. Index coverage matrix (spec Part L requirement)

| Query family | Indexes |
|---|---|
| **Review queues by status** | `RevenueReview [organizationId, status]`, `[instructorId, status]`, `[organizationId, status, scheduledChargeAt]`; `RevenueAdjustment [organizationId, status]`; `ReconciliationException [organizationId, status]` |
| **Payment statuses** | `ScheduledCharge [organizationId, status, runAfter]` + `[status, runAfter]` (platform sweep); `PaymentAttempt [organizationId, status, createdAt]`; `Refund [organizationId, status]`; `Dispute [organizationId, status]`; `PlatformFee [organizationId, status]`; `InstructorEarning [organizationId, status]`; `ProviderPayout [organizationId, status]` |
| **Org/date reporting** | `[organizationId, createdAt]` on `RevenueReview`, `RevenueAdjustment`, `TaxSnapshot`, `InstructorEarning`, `RevenueReviewApproval`, `PlatformFee`, `ScheduledCharge`, `FinancialExportJob`, `DispatchRestrictionDecision`; `Invoice [organizationId, issuedAt]`; `Payment [organizationId, paidAt]`; `LedgerEntry [organizationId, account, effectiveAt]`; `RevenueAllocation [organizationId, category, effectiveAt]` (allocations bucket on `effectiveAt`, §4.13); `Dispatch [organizationId, closedAt]`; `InstructorEarning [organizationId, instructorId, createdAt]` |
| **Reconciliation lookups** | `PaymentProviderEvent @@unique([provider, providerEventId])` + `[type, receivedAt]`; `PaymentAttempt @@unique([provider, providerPaymentIntentId])`; `LedgerEntry [sourceType, sourceId]` + `[organizationId, journalId]`; `ProviderPayout` unique; `CreditApplication [revenueReviewId]`; `TaxSnapshotItem [invoiceLineId]`; `Refund [paymentId]`; `Invoice [payerId]` |
| **Resolution / effective-dating** | `AircraftPricingProfile [organizationId, aircraftId, effectiveStart]` + `[organizationId, effectiveStart]`; `InstructorRateProfile [organizationId, instructorId, kind]` + `[organizationId, kind, status]` + `[organizationId, effectiveFrom]`; `TaxRule [organizationId, locationId, isActive]` |

Every tenant-scoped query pattern leads with `organizationId` (house index strategy); the single cross-org index (`ScheduledCharge [status, runAfter]`) serves only the platform batch runner behind `authorizePlatform()`.

---

## 10. Integration with existing models & org-snapshot wipe order

### 10.1 What existing models become

- **`Dispatch`** — still the single operational dispatch record; now directly tenant-scoped, payer- and pricing-aware, with full checkout/return capture. No behavior of PENDING→RELEASED→CLOSED changes; the closeout transaction creates a Draft `RevenueReview` + `DRAFT` `Invoice` instead of an `OPEN` invoice (ADR-025 supersedes ADR-011's invoice clause; docs 02/03).
- **`Invoice`** — still the accounting document of record and the API every legacy consumer reads. Review-wrapped invoices gain frozen totals and a status projection; legacy/manual invoices behave exactly as today. Never reinterpreted: null `currency`/`revenueReview`/`payerId` mark pre-Phase-8 rows.
- **`InvoiceLine`** — still the only line table; new provenance/snapshot columns are null on legacy rows. `kind` semantics unchanged forever (frozen enum + projection).
- **`Payment`** — still the settled-money record (the spec's PaymentTransaction); hardened (Restrict, currency, org scope, attempt link). Manual cash/check recording keeps working unchanged.
- **`Student.accountBalance`** — demoted: no new writer besides legacy flows; Amount Due is derived per-invoice (doc 09). Retirement plan in 14-migration-plan.md.
- **`Instructor.hourlyRate`** — legacy tier-8 BILLING fallback only; two-release deprecation per 14-migration-plan.md.
- **`Aircraft.hourlyRateWet/Dry`** — power the virtual legacy fallback pricing profile (doc 05) so zero-config orgs bill exactly as today.

### 10.2 Wipe-order placement (`wipeOrganizationData()` in `src/lib/org-snapshot.ts`)

New deletion order inserted **before** the existing "events before invoices" step; Restrict chains dictate it (children first):

1. `TaxSnapshotItem` → 2. `TaxSnapshot` → 3. `CreditApplication` → 4. `CustomerCredit` → 5. `PromoCodeRedemption` → 6. `Refund` → 7. `Dispute` → 8. `Payment` → 9. `PaymentAttempt` → 10. `ScheduledCharge` → 11. `RevenueAllocation` → 12. `PlatformFee` → 13. `InstructorEarning` → 14. `RevenueAdjustment` → 15. `InstructorTimeEntry` + `RevenueReviewApproval` (or via review cascade) → 16. `RevenueReview` → 17. **existing invoice step** (`InvoiceLine` cascades) → 18. `RevenueItemLocation/Program/Aircraft` → `RevenueItem` → 19. `PromoCode` → 20. `TaxRule` → 21. `InstructorRateProfileLine` → `InstructorRateProfile` → 22. `AircraftPricingProfile` → 23. `DispatchRestrictionDecision` (or via dispatch cascade) → **existing dispatch/aircraft steps** → 24. `PaymentMethodReference` → 25. `PaymentCustomer` → 26. `StudentPayerRelationship` → 27. `ResponsiblePayer` → 28. singletons & config (`DispatchPolicy`, `RevenueWorkflowPolicy`, `OrgPaymentPolicy`, `RevenueSettings`, `CheckoutRestrictionPolicy`, `AccountingMapping`, `OrgSequence`) + `FinancialExportJob`, `ProviderPayout`, `ReconciliationException`, `LedgerEntry` → **existing users/roles/departments step**.

`PaymentProviderEvent` is **excluded** from wipe/restore (audit-grade, `SetNull`), like `AuditLog`. All included models join `OrgSnapshot` capture/restore in the same slice that creates them, and both seeded demo orgs get fixtures (26 built-in Revenue Items via idempotent upsert on `[organizationId, code]`, default policies, sample reviews) — otherwise founder snapshot/restore silently loses financial data.

### 10.3 Migration-safety summary (details in 14-migration-plan.md)

Additive DDL first (enums + tables + nullable columns + new indexes); separate deterministic, idempotent data-only backfills (`Dispatch.organizationId/locationId/createdAt`, `Invoice.currency/updatedAt`, `Payment.organizationId/currency`, `InvoiceLine.createdAt`); partial unique indexes via raw SQL migrations; `Payment.invoice` Cascade→Restrict is a metadata-only ALTER; `NOT NULL` tightening ships a release later; nothing dropped, converted, or reinterpreted. Validate against the six spec fixtures: fresh, seeded, existing-invoice, multi-organization, failed-payment, historical-rate.

---

## 11. RBAC, audit, events

Owned by the workflow docs (03–12) — this document only fixes the storage: RBAC stays data in `src/lib/permissions.ts` (new `revenue.*`/`billing.*` keys, never hardcoded role checks); every mutation writes `recordAudit`; domain events go through `emitDomainEvent`. No schema support is needed beyond the actor-label columns already specified.

---

## 12. Open questions

1. **`Dispatch.organizationId` NOT NULL timing** — the two-step backfill needs a release boundary; until tightened, engines must keep the join-through-`scheduleEvent` scope check as belt-and-braces (14-migration-plan.md owns the schedule).
2. **`CARD_PAID` → `PAID` timing** (doc 03 Q3) — capture-time vs settlement-reconciliation; product decision, affects receipts. Schema supports both.
3. **Revenue Rule model** — the canonical vocabulary reserves "Revenue Rule" and `RevenueLineOrigin.RULE`, but no Part 1 doc defines a rule-config model (auto-applied fees currently come only from `DispatchPolicy` capture + Revenue Item availability; Part 1 position: [01-revenue-engine-architecture.md](./01-revenue-engine-architecture.md) §7.1). If Part 2 wants org-authored auto-application rules, it adds a `RevenueRule` model additively (go/no-go: D43 in [16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md) §2.2); the origin enum value is already reserved.
4. **Multi-currency** — columns are ready; Part 1 enforces org-currency-only at the engine. Where the org currency itself lives (`Organization` column vs `RevenueSettings`) is deferred to the Part 2 slice that first needs it; recommendation: `RevenueSettings.currency` with `"USD"` default.
5. **Partial unique indexes vs schema-governance tests** — the two raw-SQL indexes (R4, default payer) are invisible to Prisma's schema; the governance test suite needs an allowlist entry documenting them.
6. **`riskFlags`/`payerResolutionBasis`/`appliesToKinds` catalogs** — String[] values validated in `src/lib`; the exact catalog files and contract tests are Part 2 implementation details.
7. **Seed volume** — 26 Revenue Items × N orgs plus default policies grows the seed; confirm `npm run seed` stays within its performance budget.

---

## 13. Related documents

[00-current-billing-audit.md](./00-current-billing-audit.md) (current state) · [02](./02-operational-dispatch-and-closeout.md)–[12](./12-revenue-allocation-and-reporting.md) (workflow designs this schema serves) · [14-migration-plan.md](./14-migration-plan.md) (sequencing, backfills, fixtures) · [DATABASE_STANDARDS.md](../DATABASE_STANDARDS.md) · [DECISIONS.md](../DECISIONS.md) (ADR-011, ADR-020, ADR-021, ADR-023; ADR-025 proposed in doc 03)
