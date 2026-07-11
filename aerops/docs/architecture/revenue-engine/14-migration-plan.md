# Migration Plan

> **Status:** Proposed — Phase 8 Part 1 · **Date:** 2026-07-10 · **Lead roles:** Database Architect; Reliability/SRE Engineer · **Part of:** Revenue Engine design set ([README](./README.md))

This document sequences the schema changes that [13-database-model.md](./13-database-model.md) (canonical) defines: 43 new models, 4 extended models (`Dispatch`, `Invoice`, `InvoiceLine`, `Payment`), ~60 new enums, 3 additive values on one existing enum, two raw-SQL partial unique indexes, and three data-only backfills. Where this document and doc 13 could be read to disagree on a name, type, or constraint, doc 13 wins; this document owns **ordering, grouping, backfills, fixtures, and rollback posture**.

Scope: design only. **Part 1 creates no migration.** The first `prisma/schema.prisma` edit happens in Part 2, following this sequence. Every migration below is additive; nothing is dropped, converted, renamed, or reinterpreted (spec Part L migration safety; ADR-015 additive-only; DATABASE_STANDARDS migration rules).

---

## 1. Ground rules

1. **Named migrations only** — `npx prisma migrate dev --name <snake_case_slice>` from `aerops/`; history stays uniformly `TIMESTAMP_snake_case_name` (e.g. `20260707044928_import_center`).
2. **Additive-only within a release** — no destructive change ships in the same release as the code that stops using a column. App rollback (redeploy previous version) must always be DB-safe.
3. **DDL and data are separate migrations** — the ADR-023 pattern (`20260710031814_…_hardening` DDL, then `20260710032000_backfill_memberships_ownership` data). A new enum value or nullable column ships first; a **separate data-only migration** backfills; `NOT NULL` tightening waits a full release.
4. **Backfills are deterministic and idempotent** — re-runnable to the same result on fresh / seeded / legacy databases; a backfill **never guesses**. Anything ambiguous is surfaced by the read-only `scripts/migration-report.ts`, never silently resolved.
5. **Never edit an applied migration** — a mistake gets a follow-up migration.
6. **Every migration's FK targets must already exist** — the sequence below is a topological order over doc 13's relations; do not reorder across groups.
7. **Review the generated SQL of every migration** before applying. If Prisma emits an enum **type rebuild** (`CREATE TYPE … ; ALTER TABLE … ; DROP TYPE`) instead of `ALTER TYPE … ADD VALUE`, the schema edit was not additive — stop and fix the edit.

---

## 2. Ordered migration sequence

Eighteen migrations plus one deferred tightening migration, in six dependency groups: **existing-enum extension → independent config models → payer/rate/pricing/catalog models → review & payment models → allocation/ledger → data backfills**. Parts 2–3 author them in this order; each slice ships its migrations together with the engine code, tests, seed fixtures, and `org-snapshot.ts` wipe/capture updates for the models it creates (§7 point of no return P2).

Names below are the `--name` argument; Prisma prepends the timestamp.

### Group A — existing-enum extension (Part 2, first)

| # | Migration name | Contents | Notes |
|---|---|---|---|
| M1 | `revenue_engine_invoice_status_values` | `ALTER TYPE "InvoiceStatus" ADD VALUE` × 3: `PARTIALLY_REFUNDED`, `REFUNDED`, `DISPUTED` | **No table changes, no data writes.** Values stay unwritten until the Part 2 payment engine code deploys (doc 13 §5). `LineItemKind` is frozen and `PaymentMethod` unchanged — they never appear in any migration. Positioning it first satisfies the "own migration before first use" rule regardless of later slice boundaries |

### Group B — independent config models (Part 2)

| # | Migration name | New models | New enums | Depends on |
|---|---|---|---|---|
| M2 | `revenue_engine_org_config` | `OrgSequence`, `DispatchPolicy`, `RevenueWorkflowPolicy`, `OrgPaymentPolicy`, `RevenueSettings`, `CheckoutRestrictionPolicy`, `AccountingMapping` | `WarningMode`, `CheckoutRestrictionKey`, `RestrictionEnforcement`, `RestrictionCategory`, `PaymentTimingPolicy`, `TimeRoundingMode`, `FlightTimeSuggestionMode`, `HobbsDivergenceAction`, `InstructorClawbackPolicy`, `DiscountAllocationMode`, `CompensationApprovalMode`, `CompensationRefundPolicy`, `TaxProvider`, `TaxRoundingMode`, `TaxRoundingLevel`, `PricingBillingBasis`, `PricingRoundingRule`, `MappingSourceType` | Nothing but `Organization` |

All seven models FK only to `Organization` (Cascade). The shared enums (`PricingBillingBasis`, `PricingRoundingRule`, `TaxProvider`, `TaxRounding*`, `PaymentTimingPolicy`) land here because the config singletons reference them; later tables reuse the committed types — shipping an enum ahead of its "home" table is always safe, the reverse is not.

### Group C — payers, rate/pricing, catalog (Part 2)

| # | Migration name | New models | New enums | Depends on | Raw SQL hand-edit |
|---|---|---|---|---|---|
| M3 | `revenue_engine_responsible_payers` | `ResponsiblePayer`, `StudentPayerRelationship` | `PayerType`, `PayerStatus`, `PayerRelationshipStatus` | `User`, `Student`, `Document` (existing) | Partial unique (one ACTIVE default payer per student): `CREATE UNIQUE INDEX "StudentPayerRelationship_default_key" ON "StudentPayerRelationship"("studentId") WHERE "isDefault" AND status = 'ACTIVE';` |
| M4 | `revenue_engine_pricing_rate_profiles` | `AircraftPricingProfile`, `InstructorRateProfile`, `InstructorRateProfileLine` | `ProfileStatus`, `WetDryDesignation`, `TaxTreatment`, `InstructorRateKind`, `InstructorClassification`, `InstructorTimeCategory` | M2 (`PricingBillingBasis`, `PricingRoundingRule`); `Aircraft`, `Location`, `Instructor`, `Syllabus` | — |
| M5 | `revenue_engine_revenue_items` | `RevenueItem`, `RevenueItemLocation`, `RevenueItemProgram`, `RevenueItemAircraft` | `RevenueItemCategory`, `RevenueItemUnitBasis`, `RevenueItemAmountMode`, `RevenueItemRisk` | `Location`, `Syllabus`, `Aircraft` | — |
| M6 | `revenue_engine_tax_rules` | `TaxRule` | — | `Location` | — |

`InstructorTimeCategory` ships in M4 (first use: `InstructorRateProfileLine.category`) even though its home doc is instructor time; `TaxTreatment` ships in M4 (profiles) and is reused by M11.

### Group D — review & payment models (Part 2)

| # | Migration name | Contents | Depends on | Raw SQL hand-edit |
|---|---|---|---|---|
| M7 | `revenue_engine_dispatch_capture` | **Extend `Dispatch`** (all nullable/defaulted): `organizationId`, `locationId`, `payerId`, `pricingProfileId`, release capture (`conditionOut`, `squawksAcknowledged`, `intendedRoute`, `releaseNotes`, `restrictionSnapshot`), return capture (`conditionIn`, `oilAddedQt`, `airportsVisited`, `returnNotes`, `closedBy`, `closeoutWarnings`), `createdAt`/`updatedAt`, indexes `[organizationId, status]`, `[organizationId, closedAt]`. **New model** `DispatchRestrictionDecision` + enum `RestrictionDecisionKind` | M2 (restriction enums), M3 (`payerId`), M4 (`pricingProfileId`) | `updatedAt` on a non-empty table: edit generated SQL to `ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP` (§2.1). `createdAt DEFAULT now()` stamps existing rows with migration time — the documented approximation (doc 13 §4.2.1) |
| M8 | `revenue_engine_payment_rails` | **New models** `PaymentCustomer`, `PaymentMethodReference` + enums `PaymentProvider`, `StoredPaymentMethodType`, `StoredPaymentMethodStatus` | M3 (`payerId`), `Student` | — |
| M9 | `revenue_engine_revenue_reviews` | **New models** `RevenueReview`, `RevenueReviewApproval`, `InstructorTimeEntry` + enums `RevenueReviewStatus`, `RevenueApprovalKind`, `InstructorTimeSource`. **Extend `Invoice`** (all nullable): `payerId`, `billToLabel`, `currency Char(3)`, `subtotal`/`taxTotal`/`total Decimal(12,2)`, `approvedAt`, `updatedAt`, indexes `[payerId]`, `[organizationId, issuedAt]` | M2 (`PaymentTimingPolicy`), M3, M7 (`dispatchId` target), M8 (`paymentMethodRefId`) | R4 partial unique (one active Revenue Review per dispatch): `CREATE UNIQUE INDEX "RevenueReview_dispatch_active_key" ON "RevenueReview"("dispatchId") WHERE status <> 'VOIDED';` — safe at creation time (empty table). `Invoice.updatedAt`: same `DEFAULT CURRENT_TIMESTAMP` hand-edit as M7 |
| M10 | `revenue_engine_adjustments_credits` | **New models** `RevenueAdjustment`, `CustomerCredit`, `CreditApplication`, `PromoCode`, `PromoCodeRedemption` + enums `AdjustmentKind`, `AdjustmentStatus`, `CreditStatus`, `PromoDiscountType` | M9 (reviews), `InvoiceLine`, `Payment`, `Document` (existing) | — |
| M11 | `revenue_engine_invoice_line_provenance` | **Extend `InvoiceLine`** (all nullable/defaulted): `origin` + enum `RevenueLineOrigin`, `revenueItemId`, `itemCode`, `unitBasis`, `unitLabel`, `isTaxable`, `taxTreatmentOverride`, `taxOverrideReason`, `accountingCategoryCode`, `reason`, `note`, `attachmentDocumentId`, `addedByUserId`/`addedByLabel`, `requiresSecondApproval`, `adjustmentId`, `offsetsLineId`, `pricingProfileId`, `rateProfileId`/`rateProfileVersion`, `instructorTimeEntryId`, `rateResolution`, `createdAt`, index `[revenueItemId]` | M4, M5, M9, M10 (every FK target) | `createdAt` on a non-empty table: `ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP` — existing rows stamp to migration time (documented; `AuditLog` remains the authoritative history) |
| M12 | `revenue_engine_tax_snapshots` | **New models** `TaxSnapshot`, `TaxSnapshotItem` | M6, M9, M11 (`invoiceLineId` Restrict) | — |
| M13 | `revenue_engine_payment_collection` | **New models** `ScheduledCharge`, `PaymentAttempt`, `PaymentProviderEvent`, `Refund`, `Dispute` + enums `ScheduledChargeStatus`, `PaymentAttemptStatus`, `PaymentAttemptTrigger`, `RefundDestination`, `RefundStatus`, `DisputeStatus`. **Extend `Payment`** (all nullable): `organizationId`, `currency Char(3)`, `paymentAttemptId @unique`, `recordedByLabel`, index `[organizationId, paidAt]`; **FK action change** `Payment.invoice` Cascade → Restrict | M8, M9, M10 (`Refund.adjustmentId`) | The FK change generates `DROP CONSTRAINT` + `ADD CONSTRAINT … ON DELETE RESTRICT` — metadata-only, no table rewrite; brief `ACCESS EXCLUSIVE` lock, trivial at current row counts (§2.2) |

### Group E — allocation & ledger (Part 2 tail; the approval engine must not ship before these exist, because the approval transaction writes allocation, earning, fee, and ledger rows — doc 13 §6.1)

| # | Migration name | New models | New enums | Depends on |
|---|---|---|---|---|
| M14 | `revenue_engine_allocation_earnings_fees` | `RevenueAllocation`, `InstructorEarning`, `PlatformFeePolicy`, `PlatformFee`, `FinancialExportJob` | `AllocationEvent`, `AllocationDimension`, `AllocationCategory`, `InstructorEarningStatus`, `PlatformFeeBase`, `PlatformFeeStatus`, `ExportJobKind`, `ExportJobStatus` | M4 (`rateProfileId`), M9 (reviews, time entries), `SubscriptionPlan`, `Document`. `FinancialExportJob` rides here (not Part 3) because `InstructorEarning.exportJobId` needs its target; the export **engine** still lands in Part 3 |
| M15 | `revenue_engine_ledger_reconciliation` | `LedgerEntry`, `ProviderPayout`, `ReconciliationException` | `LedgerAccount`, `LedgerDirection`, `PayoutStatus`, `ReconciliationExceptionKind`, `ReconciliationExceptionStatus` | `Organization` only |

Back-relations added to `Organization`, `User`, `Student`, `Instructor`, `Aircraft`, `Location`, `Syllabus`, `ScheduleEvent`, `Document`, `SubscriptionPlan` (doc 13 §4.2.5) generate **no SQL** — they ride along in whichever migration adds the owning FK.

### Group F — data-only backfills (Part 2, after Group D/E DDL is applied)

Authored with `npx prisma migrate dev --create-only` and hand-written SQL (empty schema diff), the `backfill_memberships_ownership` precedent. Each is idempotent (`WHERE … IS NULL` / `ON CONFLICT`), deterministic, and touches **only** the new nullable columns — never a status, amount, kind, number, or relation that existed before Phase 8.

| # | Migration name | What it writes | SQL sketch |
|---|---|---|---|
| M16 | `backfill_dispatch_tenancy` | `Dispatch.organizationId` from the owning `ScheduleEvent` (required FK — always resolvable, nothing to guess); `Dispatch.locationId` from `ScheduleEvent.locationId`, fallback `Aircraft.locationId`, else stays `NULL` | `UPDATE "Dispatch" d SET "organizationId" = se."organizationId" FROM "ScheduleEvent" se WHERE se."id" = d."scheduleEventId" AND d."organizationId" IS NULL;` then the `COALESCE(se."locationId", a."locationId")` update with the same `IS NULL` guard |
| M17 | `backfill_billing_currency_and_org` | `Invoice.currency` → `'USD'` where `NULL`; `Payment.organizationId` from its invoice; `Payment.currency` → `'USD'` where `NULL` (justification §4) | `UPDATE "Invoice" SET "currency" = 'USD' WHERE "currency" IS NULL;` · `UPDATE "Payment" p SET "organizationId" = i."organizationId" FROM "Invoice" i WHERE i."id" = p."invoiceId" AND p."organizationId" IS NULL;` · `UPDATE "Payment" SET "currency" = 'USD' WHERE "currency" IS NULL;` |
| M18 | `backfill_org_sequences` | One `OrgSequence(key='invoice')` row per org that already has `INV-<digits>` invoice numbers, starting **above the largest existing numeric suffix**, so `OrgSequence` numbering (R3) can never collide with legacy numbers. `revenue_review` and `adjustment` sequences have no legacy numbers and are created lazily at first use | `INSERT INTO "OrgSequence" … SELECT gen_random_uuid()::text, i."organizationId", 'invoice', MAX((substring(i."number" from '^INV-([0-9]+)$'))::int) + 1, CURRENT_TIMESTAMP FROM "Invoice" i WHERE i."number" ~ '^INV-[0-9]+$' GROUP BY i."organizationId" ON CONFLICT ("organizationId", "key") DO UPDATE SET "nextValue" = GREATEST("OrgSequence"."nextValue", EXCLUDED."nextValue");` — invoices whose numbers do not match `INV-<digits>` (e.g. legacy `Date.now()` forms) are ignored by the seed calculation and listed by `scripts/migration-report.ts` |

Between M7/M13 and M16/M17, `Dispatch.organizationId` and `Payment.organizationId` are `NULL` on legacy rows — engines therefore **keep joining through `scheduleEvent`/`invoice` for tenant scope** until the tightening release (doc 13 §12 Q1); the direct columns are a reporting index until then, belt-and-braces after.

### Group G — tightening (a separate, later release; not part of the Phase 8 Part 2 release)

| # | Migration name | Contents | Gate |
|---|---|---|---|
| M19 | `tighten_revenue_engine_tenancy` | `SET NOT NULL` on `Dispatch.organizationId`, `Payment.organizationId`, `Invoice.currency`, `Payment.currency`; optionally drop the now-redundant `Dispatch @@index([status])` in favor of `[organizationId, status]` | Ships only after (a) one full release in which every writer populates these fields, (b) the §5 fixture matrix and `scripts/migration-report.ts` confirm **zero** `NULL`s in every environment. Additive-only rule: the code that depends on `NOT NULL` ships **after** this migration, never with it |

### 2.1 Required columns on non-empty tables

Prisma generates `ADD COLUMN … NOT NULL` **without a default** for `updatedAt @updatedAt` and `createdAt @default(now())` is fine, but a plain required column addition fails on populated tables. For M7, M9, and M11: run `--create-only`, then hand-edit to `NOT NULL DEFAULT CURRENT_TIMESTAMP`. Leaving the DB-level default in place permanently is harmless (`@updatedAt` is maintained client-side; `@default(now())` matches). This is the only class of hand-edit besides raw-SQL indexes and data backfills.

### 2.2 Locking and index builds

All `CREATE INDEX` statements are Prisma-default (non-`CONCURRENTLY`). Acceptable now — there is no production database (DATABASE_STANDARDS, aspirational-production notes) and dev/CI tables are small. When production exists (Neon move), index additions on hot tables get revisited (`CONCURRENTLY` cannot run inside Prisma's migration transaction and needs its own runbook); flagged for PRODUCTION.md §13.3, not a Phase 8 concern.

### 2.3 Cutover rule — the ADR-025 close-route flip

Group E states one direction of the gate (the approval engine must not ship before the allocation/ledger DDL). The converse binds equally and is a release rule, not a migration-ordering rule: **the ADR-025 close-route change (closeout creates a `RevenueReview` instead of finalizing an invoice — [02-operational-dispatch-and-closeout.md](./02-operational-dispatch-and-closeout.md), [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md)) must never deploy ahead of the surfaces that make a Revenue Review usable.** The close-route flip, the review/approval engine, the review-queue UI, and the offline-payment fallback ([09-payment-timing-and-collection.md](./09-payment-timing-and-collection.md)) ship in the **same release** — or, if the code lands across multiple deploys, behind **one feature flag flipped together**. Deploying the flip alone would strand every new closeout in a DRAFT review that no one can see, approve, or collect on. The flag (or release boundary) gates only the *creation* path — the close-route flip; the review queue and approval engine, once deployed, stay available regardless of the flag so any existing reviews can always be drained. All schema in M1–M15 may land ahead of this release: dormant additive schema is safe, and the cutover boundary is the code, never the DDL.

---

## 3. Postgres enum rules (binding for every migration above)

1. **`ALTER TYPE … ADD VALUE` only.** A newly added value cannot be *used* in the transaction that adds it, and Prisma runs each migration in one transaction — so an enum-extension migration must contain **zero data writes** of the new value (M1 is DDL-only; app code writes the values only after deploy). This is the DATABASE_STANDARDS two-step rule; the ADR-023 `ACCOUNT_OWNER` migration pair is the reference.
2. **No destructive enum change, ever.** Postgres has no `DROP VALUE`; removing or re-typing a value means a type rebuild that rewrites stored data — forbidden by spec Part L ("remove enum values destructively without approval") and by this plan unconditionally for Phase 8. No `RENAME VALUE` either: stored rows and code both bind to the spelling.
3. **Deprecation pattern:** if a value must be retired, it is *retained-but-deprecated* (the `SUPER_ADMIN` precedent) — writers stop, readers keep handling it, the value stays in the type.
4. **Brand-new enums** ship in the same DDL migration as their first-using table (doc 13 §4.1) — `CREATE TYPE` has no same-transaction restriction.
5. **Inventory of existing-enum changes in this plan:** `InvoiceStatus` +3 values (M1). Nothing else: `LineItemKind` frozen (projection via `legacyKindFor`), `PaymentMethod`/`DispatchStatus`/`EventStatus`/`Role`/`DocumentKind` untouched. Optional `NotificationKind` additions belong to the Part 2 notification slice under the same rules — own migration, no same-migration writes.
6. **Reviewer check:** generated SQL for any enum change must contain only `ALTER TYPE … ADD VALUE` lines (§1 rule 7).

---

## 4. Backfill plan for existing rows — coexistence, not reinterpretation

Existing invoices remain valid and are **never reinterpreted**. Legacy and Revenue Engine rows coexist in the same four tables, distinguished only by nullable linkage columns that legacy rows keep `NULL`:

| Table | Column(s) that stay `NULL` on legacy rows | What `NULL` means | Backfilled columns (labels only) |
|---|---|---|---|
| `Invoice` | `payerId`, `billToLabel`, `subtotal`, `taxTotal`, `total`, `approvedAt`; no `RevenueReview` back-relation row exists | Pre-Phase-8 / standalone invoice: student self-pay, totals derive at read exactly as today, **not** review-locked — every legacy billing surface and edit path behaves unchanged. `approvedAt IS NULL` means the immutability engine never gates it | `currency` → `'USD'` (M17); `updatedAt` → migration time (M9 DDL default) |
| `InvoiceLine` | `origin` (**the explicit legacy marker** — doc 13 R2), plus every provenance/snapshot/tax/adjustment column (`revenueItemId`, `itemCode`, `unitBasis`, `isTaxable`, `adjustmentId`, `offsetsLineId`, `pricingProfileId`, `rateProfileId`, `instructorTimeEntryId`, `rateResolution`, …) | Line predates the Revenue Engine; `kind`/`description`/`quantity`/`unitPrice` keep their exact semantics forever (frozen `LineItemKind`) | `createdAt` → migration time (M11 DDL default; documented approximation, audit trail authoritative) |
| `Payment` | `paymentAttemptId`, `recordedByLabel` | Manually recorded or pre-Phase-8 payment — not produced by the collection engine; cash/check recording keeps working unchanged | `organizationId` ← its invoice's org (M17); `currency` → `'USD'` (M17) |
| `Dispatch` | `payerId`, `pricingProfileId`, all release/return capture columns, `restrictionSnapshot`, `closeoutWarnings`, `closedBy` | Dispatched before payer/pricing capture existed; the pricing resolver treats a `NULL` selection as "no explicit choice" and falls through to defaults (doc 05 levels 2–6 / legacy fallback) | `organizationId` ← `ScheduleEvent` org, `locationId` ← event→aircraft `COALESCE` (M16); `createdAt`/`updatedAt` → migration time (M7 DDL defaults) |

Hard guarantees, enforced by review of every backfill's SQL:

- **No `UPDATE` ever rewrites** `status`, `kind`, `number`, `amount`, `quantity`, `unitPrice`, `method`, `reference`, or any FK that existed before Phase 8. The complete set of permitted writes to pre-existing rows is: `Dispatch.organizationId/locationId`, `Invoice.currency`, `Payment.organizationId/currency` — five tenancy/currency **labels**, nothing else.
- Legacy `Invoice.status` values keep today's meaning; the review-projection semantics (doc 03 §2.2) apply only to invoices that *have* a `RevenueReview` row — which no legacy invoice ever will.
- No draft `Invoice`/`RevenueReview` is retro-created for closed dispatches; the Revenue Review workflow applies only to closeouts that happen after the Part 2 engine deploys (ADR-025 forward-only).
- Backfills run twice in validation and must produce byte-identical table state (idempotency check, DATABASE_STANDARDS).

---

## 5. Money: no conversion, and why `'USD'`

- **No monetary conversion of any kind** (spec Part L). All values stay Prisma `Decimal` at their existing precision — `Payment.amount`/`InvoiceLine.unitPrice` remain `Decimal(10,2)`, never re-typed, never re-scaled, no integer-minor-unit conversion, no rounding pass. New columns are `Decimal(12,2)` per doc 13 §2.2. The binding representation decision and its rationale live in doc 13 §2.1; this plan's job is that **the word `USING` never appears next to a monetary column in any migration**.
- **Currency backfill `'USD'` is a label, not a conversion.** Justification: the pre-Phase-8 schema had no currency column because the system was single-currency by construction — every existing row was written by the current US-market billing flow (US flight schools, USD rates on `Aircraft.hourlyRateWet/Dry` and `Instructor.hourlyRate`; both seeded demo orgs are US operations). Stamping `'USD'` records the invariant that was always true; amounts are untouched. Multi-currency remains out of scope for Part 1 (doc 13 §2.3, §12 Q4); if an org were ever known to be non-USD before M17 runs, the backfill must not guess — it would exclude that org and surface it via `scripts/migration-report.ts` (none exists today).
- `NOT NULL` tightening of the currency columns is M19, a release later, per the additive-only rule.

---

## 6. Validation matrix (spec Part L)

Run the full matrix before the Part 2 release merges, and the affected rows on every PR that adds a migration. Assertions live in a vitest integration suite plus a Revenue Engine section in `scripts/migration-report.ts` (read-only). Every backfill is executed **twice** wherever it runs (idempotency proof).

| Fixture | What it validates | How | New seed fixtures needed? |
|---|---|---|---|
| **Fresh database** | Full history applies from zero: DDL order, FK targets exist at each step, raw-SQL partial uniques create, backfills are clean no-ops on empty tables | Empty DB → `npx prisma migrate deploy` (entire history incl. M1–M18) → `npm test` → `npm run seed`. Also `npx prisma migrate reset` round-trip (exercises the shadow-DB replay `migrate dev` depends on) | No |
| **Seeded database** (pre-Phase-8 data, then migrate) | Backfill correctness on realistic data: every `Dispatch` gets its event's org; every `Payment` gets its invoice's org + `'USD'`; row counts and status distributions byte-identical before/after (minus the five label columns); reruns converge | Check out pre-Phase-8 migration head → `migrate deploy` → `npm run seed` (current seed: 2 orgs, ~30 dispatches in 3 states, ~20 invoices w/ lines + card payments) → apply M1–M18 → assertion suite (`0` rows where `Dispatch.organizationId IS NULL`; `0` rows where `p."organizationId" <> i."organizationId"`; before/after count diff = 0) | No (assertion suite is new code, not fixtures) |
| **Existing invoice fixtures** | Coexistence & non-reinterpretation: legacy PAID/OPEN/OVERDUE invoices render identical derive-at-read totals; `origin IS NULL` on every legacy line; recording a manual payment against a legacy invoice still works; legacy invoices never acquire `approvedAt`/review lock | Post-migration, drive the legacy billing surfaces against the seeded invoices (`INV-1041+`, incl. the OVERDUE membership invoice with `MEMBERSHIP_FEE` + `LATE_FEE` lines) via API + UI checks | **Yes (small):** extend `prisma/seed.ts` with one `PARTIALLY_PAID` and one `VOID` legacy invoice so every pre-existing `InvoiceStatus` value is exercised |
| **Multi-organization fixtures** | Backfills never cross tenants; `OrgSequence` init is per-org and skips orgs without invoices (lazy creation covers them); the 26 built-in Revenue Items seed per-org on `[organizationId, code]` without collision; tenant-aware uniques hold with two orgs populated | Both seeded orgs (`golden-gate`, `blue-ridge`) through the seeded-database run; assert per-org sequence values and Revenue Item counts (26 × 2) | **Yes:** `blue-ridge` currently has no invoices/dispatches — add at least one closed dispatch + invoice + payment there, so the org-scoped backfills are proven with **two** data-bearing tenants, not one |
| **Failed-payment fixtures** | Payment-status queues and indexes; the uniqueness chain under retries (`[scheduledChargeId, attemptNumber]`, deterministic `idempotencyKey`); `PAYMENT_FAILED`/`ACH_PENDING` review states; Amount Due surfaces; staleness watch inputs; **later migrations/backfills never touch in-flight money rows** | Part 2 seed additions create them; assertion suite re-reads them unchanged after M16–M18 | **Yes (Part 2 slice, after M13):** one Revenue Review in `PAYMENT_FAILED` (`ScheduledCharge` FAILED, `PaymentAttempt` FAILED with `failureCode: "card_declined"`, `attemptCount: 1`) and one in `ACH_PENDING` (`PaymentAttempt` PROCESSING) |
| **Historical-rate fixtures** | Effective-dated versioning end to end: version-family uniques; resolver selects the currently-effective version; an approved review's snapshot stays pinned to the superseded version — changing a rate tomorrow does not alter yesterday's invoice (principle 5); `SUPERSEDED` derived at read, never stored | Part 2 seed additions + resolver contract tests + immutability contract test (re-approve nothing, re-read snapshot after creating v2) | **Yes (Part 2 slice, after M4/M9):** one `AircraftPricingProfile` family with v1 (APPROVED, `effectiveEnd` past) and v2 (APPROVED, current, different `rateAmount`); one `InstructorRateProfile` family per kind (BILLING, COMPENSATION) likewise; one approved Revenue Review whose lines/`approvalSnapshot` reference v1 |

Seed notes: the seed's `TRUNCATE "Organization", "AircraftType", "PlatformUser", "SubscriptionPlan", "AuditLog" CASCADE` root set already reaches every new table (all FK-reference `Organization` or `SubscriptionPlan`, including `PaymentProviderEvent` via its nullable org FK) — no new truncate roots needed. Doc 13 §12 Q7's seed-volume check (26 items × N orgs + policies + sample reviews) is part of the seeded-database run.

---

## 7. Rollback posture

Prisma has no down-migrations; **rollback means redeploying the previous app version while the schema stays** — which is exactly what additive-only buys. Per group:

| Step(s) | Rollback posture |
|---|---|
| M1 (enum values) | App rollback safe (values unwritten by old code). **Migration irreversible** — Postgres cannot drop enum values; abandonment = retained-but-deprecated (§3.3). Benign but permanent |
| M2–M15 (additive DDL) | App rollback safe — previous version never touches the new tables/columns. Schema stays; removing it would need an explicitly-approved destructive migration, out of Phase 8 scope |
| M9/M13 hand-edited defaults, partial uniques | Same as DDL; the raw SQL lives inside the migration files so shadow-DB replay and drift detection keep working — never apply raw SQL manually outside a migration |
| M13 FK Cascade→Restrict | Technically reversible (metadata ALTER back) — **never revert**: reverting re-arms the audit-doc-00 landmine (settled payments cascade-deleting with an invoice). Treat as one-way by policy |
| M16–M18 (backfills) | Idempotent and re-runnable; they only fill columns that were `NULL`, so "rollback" is meaningless and unneeded — old code ignores the columns entirely |
| M19 (tightening) | Reversible (`DROP NOT NULL`) but gated on a full clean release first; the code that assumes `NOT NULL` ships after it, so app rollback from that later release is still safe |

**Rollback across the close-route flip (§2.3):** rolling back the release that flips the close route (redeploying the previous version, or flipping the §2.3 flag off) makes **new** closeouts resume the old close route — invoice finalized at closeout, no `RevenueReview` created. Reviews already in flight are not orphaned: in-flight `DRAFT` (and `PAYMENT_FAILED`/`ACH_PENDING`) `RevenueReview` rows stay in the database untouched — the additive schema stays per §1 rule 2 — and **remain approvable through the review queue and approval engine after the redeploy**, since §2.3 keeps those surfaces live independent of the flag. No in-flight review is deleted, converted, or retro-finalized. Release notes for any such rollback must state the resulting split: old route for new closeouts, review queue for draining the in-flight backlog.

**Points of no return** (call them out in the release notes of the slice that crosses each):

- **P1 — M1 applied:** enum values exist forever (benign).
- **P2 — first real financial row written** (first `RevenueReview` approval / `PaymentAttempt` in any shared environment): from here on, even an approved cleanup must follow "never drop financial data" — correction is by adjustment/reversal rows only. **Precondition:** the `org-snapshot.ts` wipe order (doc 13 §10.2, 28 steps, `PaymentProviderEvent` excluded) and `OrgSnapshot` capture/restore support must already be live for every model that can hold money — they ship in the same slice as the DDL, before the engine code that writes rows.
- **P3 — M18 + numbering code live:** new invoices allocate `INV-<seq>` from `OrgSequence`; do not revert to the `Date.now()` generator mid-stream (forked numbering schemes in one org).
- **P4 — M19 applied:** pre-Phase-8 writers that insert `Dispatch`/`Payment` without org/currency now fail — which is why M19 waits until no such writer exists anywhere.

---

## 8. Forbidden operations (Phase 8, all parts — reviewer checklist)

1. No `DROP TABLE`, `DROP COLUMN`, or truncation of any existing model — including "temporarily".
2. No column re-type or precision change on existing columns — `Payment.amount`/`InvoiceLine.unitPrice`/`Student.accountBalance` stay `Decimal(10,2)`, `Instructor.hourlyRate` stays `Decimal(8,2)`; not even widening in Phase 8.
3. No renames: tables, columns, enums, or enum values (`InvoiceLine` is never renamed toward the spec's "InvoiceLineItem"; canonical vocabulary keeps the existing name).
4. No destructive enum operation: no value removal, no type rebuild, no `RENAME VALUE`, no reuse of a deprecated value for a new meaning.
5. No monetary conversion, re-scaling, rounding pass, or integer-minor-unit migration of stored values.
6. No `UPDATE` that reinterprets existing rows — the only writes to pre-existing rows are the five §4 label columns; existing invoices are never wrapped in retro-created reviews, never re-statused, never re-numbered.
7. No data-writing statement in the same migration as an `ALTER TYPE … ADD VALUE`.
8. No `NOT NULL`/constraint tightening in the same release as the column it tightens (M19 is its own release).
9. No `prisma migrate reset` or `prisma db push` against any shared database; no editing of an applied migration (follow-up migrations only).
10. No dropping `Dispatch @@index([status])` before M19; no removal of `Aircraft.hourlyRateWet/Dry`, `Instructor.hourlyRate`, or `Student.accountBalance` in Phase 8 — they are demoted, not dropped (§9.1).
11. No triggers or stored procedures for immutability — enforcement stays application-layer in the engines (doc 13 §6.3).
12. No cross-group reordering of the §2 sequence, and no migration whose FK target lands in a later migration.

---

## 9. Repo workflow, CI, and the constitution suite

**Authoring flow (Part 2/3 engineers):**

1. Edit `prisma/schema.prisma` with exactly one §2 group's changes (doc 13 is the source of the shapes — copy, don't re-derive).
2. From `aerops/`: `npx prisma migrate dev --name <name from §2>` against the local DB (`postgresql://aerops:aerops@localhost:5432/aerops`). For migrations needing hand-edits (M3, M7, M9, M11 raw SQL/defaults; M16–M18 data-only): `npx prisma migrate dev --create-only --name <name>`, edit `migration.sql`, then `npx prisma migrate dev` to apply. `migrate dev`'s shadow database replays the full history — hand-edited SQL is validated automatically on every subsequent migration.
3. Commit the schema change and its migration directory together, with the engine code, seed updates, wipe-order/`OrgSnapshot` updates, and tests of the same slice.
4. Reseed check: `npm run seed` must complete green (it TRUNCATE-CASCADEs and rebuilds; §6 seed notes).
5. Production (when it exists) applies with `npx prisma migrate deploy` as a release step before promoting the deploy — never `migrate dev` outside local development (aspirational per DATABASE_STANDARDS; stated here so Parts 2–3 build the habit).

**Must be green before any migration-bearing commit (repo quality gates):**

| Gate | What it checks for this plan |
|---|---|
| `npm test` — constitution & contract suites | `tests/constitution.test.ts` (every new Part 2/3 route behind `authorize()`); `tests/schema-governance.test.ts` — every new org-owned model has a real `Organization` relation, `createdAt` (or documented substitute), and tenant-aware (never global) natural-key uniques. **Action item:** the two raw-SQL partial unique indexes (R4 review-per-dispatch, default-payer) are invisible to the Prisma schema and need documented allowlist entries in that test (doc 13 §12 Q5) |
| `npm test` — token security | `tests/token-security.test.ts`: `ResponsiblePayer.inviteTokenHash` follows the hash-only ADR-020 pattern; no new raw `*token`/`*secret` column anywhere in the Revenue Engine schema |
| `npm run build` | Types + lint; regenerated Prisma client compiles against all engine code |
| `npm run seed` | Fixtures for every new model land in the same slice (§6); demo logins untouched (do-not-break rule 4) |
| New contract tests per slice | Engine contracts (resolver, approval immutability, exactly-once chain) plus the §6 assertion suite; migration report `scripts/migration-report.ts` extended with the Revenue Engine section (non-`INV-<digits>` numbers, `NULL` tenancy counts, legacy-row counts) and run read-only in every environment before M19 |

**Verification against the running app** (repo §8) belongs to each Part 2/3 slice: real requests incl. denial and cross-tenant paths against legacy invoices post-migration — the migrations themselves are verified by the §6 matrix.

### 9.1 Legacy-field retirement schedule (owned here per doc 13 §10.1)

| Field | Phase 8 Part 2 | Phase 8 Part 3 | Removal |
|---|---|---|---|
| `Instructor.hourlyRate` | Demoted to the tier-8 legacy BILLING fallback in the rate resolver; no new admin-UI writer | `migration-report` lists orgs still resolving through the fallback; seed creates real Instructor Rate Profiles | **Not in Phase 8.** A future release, only after zero fallback usage, with its own explicitly-approved destructive plan |
| `Aircraft.hourlyRateWet/Dry` | Stays — powers the virtual legacy fallback pricing profile (doc 05) so zero-config orgs bill exactly as today | Same; report lists orgs without an approved Aircraft Pricing Profile | Same posture — likely retained long-term |
| `Student.accountBalance` | Demoted: no new writers beyond legacy flows; Amount Due derives per-invoice (doc 09) | Report on residual divergence between the column and derived balances | **Not in Phase 8** |
| `Date.now()` invoice numbers | New invoices switch to `OrgSequence` `INV-<seq>` (M18 + code); existing numbers untouched forever | — | Nothing to remove — old numbers are data, not code |

---

## 10. Open questions

1. **M19 release timing** — "one full release later" needs a concrete date once Part 2's release cadence exists; gate is the §6 matrix + zero-`NULL` report, not the calendar (doc 13 §12 Q1).
2. **Schema-governance allowlist shape** for the two partial unique indexes — entry format to be settled when the test is touched in Part 2 (doc 13 §12 Q5).
3. **`CONCURRENTLY` index runbook** — required only when a production database exists; belongs to the Neon-move work in PRODUCTION.md §13.3, referenced from §2.2.

---

## 11. Related documents

[13-database-model.md](./13-database-model.md) (canonical shapes this plan sequences) · [00-current-billing-audit.md](./00-current-billing-audit.md) · [DATABASE_STANDARDS.md](../DATABASE_STANDARDS.md) (migration rules, backfill discipline) · [DECISIONS.md](../DECISIONS.md) (ADR-015 additive-only, ADR-021 tenancy, ADR-023 DDL/backfill pattern; ADR-025 proposed in doc 03) · `prisma/migrations/` (naming precedent) · `prisma/seed.ts` (fixture baseline §6)
