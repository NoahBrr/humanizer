# Reports & Exports — Revenue Reports, Instructor-Compensation Reports, and Financial Exports

> **Status:** Proposed — Phase 8 Part 3 · **Date:** 2026-07-11 · **Lead roles:** Aviation Accounting Specialist; SaaS Revenue Operations Architect; Documentation Engineer · **Part of:** Revenue Engine design set ([README](./README.md))

This is Part 3 deliverable 3 (of 4). It specifies the **report catalog** (financial + instructor-compensation reports), the **Excel export** built on the existing `exceljs` dependency, the **accounting-export adapter foundation** (`AccountingMapping` + `FinancialExportJob`, generic CSV journal + QuickBooks-shaped CSV), and **export security + honest labeling**. Written for the engineers building phase 7 ("Revenue reporting and accounting exports") of the [39-implementation-plan.md](./39-implementation-plan.md) sequence, immediately after.

Every figure reads **snapshotted, immutable records only** — `RevenueAllocation`, `LedgerEntry`, `InstructorEarning`, `PlatformFee`, `TaxSnapshot`, invoice snapshot totals — and never recomputes money from current rates (spec principle 5; the [00-current-billing-audit.md](./00-current-billing-audit.md) §7.4 float/duplication defect this surface retires). Nothing here deploys, calls Stripe, moves money, or sends production email.

**Binding sources.** [13-database-model.md](./13-database-model.md) is canonical for `FinancialExportJob`, `AccountingMapping`, `ExportJobKind`, `ExportJobStatus`, `MappingSourceType`, and the `LedgerAccount`/`AllocationCategory` enums. [34-part2-database-additions.md](./34-part2-database-additions.md) is canonical for the Part 2 additions this doc reports on (`AllocationCategory` +7 incl. `PROCESSOR_FEE`, `AllocationEvent` `SETTLEMENT`/`DISPUTE`, `InstructorEarning.earnedAt`, `PlatformFee.earnedAt`, `Payment.providerFeeAmount`). [28-revenue-allocation-ledger.md](./28-revenue-allocation-ledger.md) §8 is canonical for reporting-dimension resolution. [29-instructor-compensation.md](./29-instructor-compensation.md) §12 is canonical for the compensation report set and §1 for the required disclaimer. [12-revenue-allocation-and-reporting.md](./12-revenue-allocation-and-reporting.md) §2.7–2.8 and §6 are the Part 1 seams these reports and exports execute. Permission keys are catalogued canonically in the sibling **36-permissions-and-visibility.md**; where this doc names a key it cites the binding source (doc 12 §6 / doc 29 §11 / doc 30 §11) and defers the final matrix to 36. Conflicts are recorded in [§16 Open questions](#16-open-questions), never silently diverged.

---

## 1. Scope & the two export tiers

### In scope

- **Report catalog** — every financial report and every instructor-compensation report, each with name, purpose, persona, filters, columns, source query (citing docs 28/34 dimensions), and RBAC key (§4–§5).
- **Read-path architecture** — the `src/lib/revenue-reports.ts` reporting engine composing the same period-primitives as `revenue-dashboard.ts` (one-engine rule, §6).
- **Excel export** — `exceljs` workbook layout, worksheet-per-report, header/typing conventions, file naming, size limits, sync-vs-job generation path (§7).
- **Accounting-export adapter foundation** — `AccountingMapping` resolution, generic CSV journal + QuickBooks-shaped CSV column specs, shipped defaults, the pre-export unmapped-keys preview (§8).
- **`FinancialExportJob` lifecycle** — state machine, idempotent re-runs by kind, immutable artifacts via the existing `Document`/storage seam, manifest + checksum + per-row errors (§9).
- **Export security** — RBAC, tenant scoping, the authorized download route (never a public static URL), audit on every export incl. download, no cross-org data, the signed/expiring-download forward path (§10).
- **Honest labeling** — the verbatim disclaimer, where it renders, period + generation-time stamping (§11).

### Out of scope (owned by siblings)

- The Revenue **Dashboard** tiles/queues (`/billing`, `/billing/queue`) — [30-revenue-dashboard.md](./30-revenue-dashboard.md). Reports link *from* the dashboard; the dashboard does not duplicate them.
- Allocation/ledger **write** mechanics and the category math — [28-revenue-allocation-ledger.md](./28-revenue-allocation-ledger.md). Reports only *read* those rows.
- Compensation recognition/clawback **workflow** — [29-instructor-compensation.md](./29-instructor-compensation.md). This doc reports over the rows it produces and executes the deferred `INSTRUCTOR_COMPENSATION_CSV` runner (doc 29 §6.7).
- Reconciliation **detection/resolution** — [23-webhooks-and-reconciliation.md](./23-webhooks-and-reconciliation.md) / doc 12 §2.6. The Unmatched-Items and Payout-Reconciliation reports render the exception queue and `ProviderPayout` rows (§4.4).
- The full permission **matrix**, `SECTION_PERMISSIONS`/`SECTION_MODULES` wiring, and constitution-test additions — sibling doc 36. This doc names the keys it consumes and the one new nav/section it needs (§4.1).
- **QuickBooks Online API sync** (beyond CSV shape) — post-Part-3 (doc 12 §9). Part 3 ships the CSV adapters and the mapping model only.

### The two export tiers (design spine)

Two distinct paths, deliberately separated by weight and permission — collapsing them would either over-govern a quick screen dump or under-govern a filed financial artifact:

| Tier | Trigger | Path | Permission | Audit | Artifact |
|---|---|---|---|---|---|
| **Quick CSV** | "CSV" ghost button on an on-screen report/drill-down list | Client-side `downloadCsv()` (the existing `reports-client.tsx` idiom), bounded to the rows already rendered | `reports.export` (the existing key, now actually checked — §4.1) | none (a screen export of already-visible bounded rows) | none — an ephemeral browser download |
| **Financial Export** | "Financial Export" action → kind + period + filters | Server `FinancialExportJob`: exceljs workbook / accounting CSV, stored as a `Document` | `revenue.exports_run` | `revenue.export_created/_completed/_failed/_downloaded` | immutable `Document` + checksum + manifest |

*Simpler-workflow choice:* a Finance Manager who just wants the visible aircraft table gets it in one click (Quick CSV); a month-end accounting hand-off (audited, filed, re-runnable, mapped to a chart of accounts) is the Financial Export. Same reports, two exits sized to the job.

---

## 2. Relationship to Parts 1–2 docs

| Doc | This doc's relationship |
|---|---|
| [12](./12-revenue-allocation-and-reporting.md) §2.7 | **Executes.** The `FinancialExportJob` + `AccountingMapping` "ImportJob idiom in reverse" seam, the export kinds, the unmapped-key fallback order, and the `defaultExportSystem` config are designed there; this doc builds the runner, the exceljs writer, the two adapters, and the mapping resolver. |
| [12](./12-revenue-allocation-and-reporting.md) §2.8 | **Extends.** The Part 1 Revenue Report set (Revenue by Aircraft/Instructor/Program/Location/Period, A/R Aging, Tax Collected, Platform Fee Statement, Payout Reconciliation, Contractor Compensation) is the report catalog; §4 pins each to its query, filters, columns, and RBAC key, and adds the collected-vs-approved and allocation-category views the spec's Part 3 list names. |
| [12](./12-revenue-allocation-and-reporting.md) §6 | **Consumes verbatim.** `revenue.exports_run`, `billing.view`, `revenue.compensation_view`, `revenue.reconciliation_manage` and the `revenue.export_*` audit actions are used exactly as bound. |
| [28](./28-revenue-allocation-ledger.md) §8 | **Consumes.** Every dimension (aircraft/instructor/program/location/airport/card-vs-ACH/category/period) resolves by the bounded indexed joins bound there; §4 quotes them. |
| [29](./29-instructor-compensation.md) §12 | **Executes.** The compensation report list is reproduced in §5 with query + RBAC; §1's disclaimer is the honest-labeling rule (§11); §6.7 `INSTRUCTOR_COMPENSATION_CSV` handoff is the compensation export (§9.4). |
| [30](./30-revenue-dashboard.md) §3–§4 | **Coordinates.** Dashboard tiles link to these reports; §6 shares the one `revenue-dashboard.ts` engine (a figure is never computed twice). The Revenue-Report route the dashboard "links to" is pinned here to `/billing/reports/[report]` (`billing.view`), coordinating with doc 30 §3 (which left it unpinned) and doc 36 (§4.1). |
| [13](./13-database-model.md) §4.13 / [34](./34-part2-database-additions.md) | **Canonical, honored exactly.** Zero new models. `FinancialExportJob`/`AccountingMapping` shapes, the `ExportJobKind`/`ExportJobStatus`/`MappingSourceType` enums, and the wipe-order/snapshot placement are used as bound (§12). One small additive enum value is flagged for 13/34 (§12). |
| [00](./00-current-billing-audit.md) §7 | **Retires the defect.** `reports/page.tsx` and `executive/page.tsx` compute revenue as `flightTime × current rate`; §6 re-points them at the snapshot engine and adds `reports.export` enforcement the audit noted was missing. |

---

## 3. Report surface placement & navigation

Expand-in-place, per doc 30 §3 (no new top-level `/revenue`). Financial Revenue Reports need `billing.view` (doc 12 §6) — and a **Dispatcher holds `reports.view` but not `billing.view`** (the documented asymmetry in `DEFAULT_ROLE_PERMISSIONS`), so school revenue, platform fee, and net-to-school **cannot** live at the `reports.view`-gated `/reports` without leaking. Therefore:

| Surface | Route | Gate (`SECTION_PERMISSIONS` → `SECTION_MODULES`) | Notes |
|---|---|---|---|
| Financial Revenue Reports | `/billing/reports/[report]` **(new static segment)** | `billing.view` → `billing` | Linked from the Revenue Dashboard (doc 30 §4 ⑤). Static segment, precedence over `/billing/[id]` like the doc 30 §3 segments. Needs a `SECTION_PERMISSIONS`/`SECTION_MODULES` entry + nav plumbing — coordinated with doc 36 (§4.1). |
| Instructor-compensation reports | `/billing/reports/compensation/*` | `billing.view` for the section; each report engine-scoped by `revenue.compensation_view` vs `revenue.compensation_view_own` | The "My Compensation" self-view (`revenue.compensation_view_own`) is the same queries hard-scoped to the session instructor (doc 29 §12). |
| Financial Export console | `/billing/exports` **(new static segment)** | `revenue.exports_run` → `billing` | Job list, "New export", `AccountingMapping` editor, unmapped-keys preview, download (§9/§10). |
| Legacy operational analytics | `/reports` (existing) | `reports.view` (unchanged) | Its revenue tiles are re-pointed at the shared snapshot engine (doc 30 §3); it keeps operational analytics (flights, cancellations, utilization). Deep financial reports do **not** move here. |
| Executive | `/executive` (existing) | `reports.view` (unchanged) | Revenue figures re-pointed at the same engine (doc 30 §3). |

New nav item **Financial Exports** → `/billing/exports` joins the Business group beside Revenue/Reports (mirrors doc 30 §3.1 for Revenue Reviews / My Payments); the constitution `NAV_ITEMS ↔ SECTION_PERMISSIONS` test requires the matching section entries. Reports themselves are reached from the dashboard, not a top-level nav item.

---

## 4. Report catalog — financial reports

Conventions for every row below: **all queries are org-scoped from the session, bounded, windowed, and index-backed** (doc 12 V13 — no unbounded `findMany`); **period buckets on `RevenueAllocation.effectiveAt` / `LedgerEntry.effectiveAt` in `Organization.timeZone`** except Tax Collected (`TaxSnapshot.serviceDate`) and compensation (`InstructorEarning.earnedAt`); **aggregation is SQL `groupBy`/`aggregate` over `Decimal`**, never `findMany`-then-float-sum; every figure **drills to the immutable rows behind it** (a number without a why is a bug). Dimension joins are exactly doc 28 §8. Currency is the org's single snapshotted ISO code (doc 34 R-P14).

### 4.1 Permission keys used

Data-driven keys only; module gate `billing` via `MODULE_BY_PREFIX` `revenue → billing` (doc 12 §6; landed by doc 30 §9). Final matrix = doc 36.

| Key | Grants (report/export scope) | Default holders (doc 12 §6 / doc 29 §11) |
|---|---|---|
| `billing.view` *(existing)* | View all financial Revenue Reports, allocation breakdowns, platform-fee statement | ACCOUNT_OWNER, SCHOOL_ADMIN, ACCOUNTANT |
| `reports.view` *(existing)* | Legacy operational analytics `/reports`, `/executive` | +DISPATCHER |
| `reports.export` *(existing)* | **Quick CSV** of an on-screen report/drill-down (now enforced on the button — §6) | ACCOUNT_OWNER, SCHOOL_ADMIN, ACCOUNTANT, DISPATCHER |
| `revenue.exports_run` | Create/run/download `FinancialExportJob`; manage `AccountingMapping` | ACCOUNT_OWNER, SCHOOL_ADMIN, ACCOUNTANT |
| `revenue.compensation_view` | All instructor-compensation reports (every instructor) | ACCOUNT_OWNER, SCHOOL_ADMIN, ACCOUNTANT |
| `revenue.compensation_view_own` | Own compensation only (route-scoped to session instructor) | INSTRUCTOR (+ above) |
| `revenue.reconciliation_manage` | Unmatched-Items / Payout-Reconciliation resolve actions | ACCOUNT_OWNER, SCHOOL_ADMIN, ACCOUNTANT |

Rule (doc 30 §11): tiles/reports/exports a user lacks are **hidden, not disabled**. Read-only impersonation hides every mutating control (export create/run, mapping edit, exception resolve) **and** the route refuses `{mutating:true}` — both, not either.

### 4.2 Core dimension reports (spec Part 3: "revenue by aircraft/instructor/program/location/airport/period")

All source from `RevenueAllocation` (`APPROVAL` sets for billed; `REFUND`+`DISPUTE` for refunded) joined to `RevenueReview` FKs, plus `LedgerEntry` collections; the shared `revenue-reports.ts` composer (§6). RBAC: **`billing.view`** for all; Financial Export additionally **`revenue.exports_run`**.

| Report | Purpose | Persona | Filters | Columns | Source query (models · dimension per doc 28 §8) |
|---|---|---|---|---|---|
| **Revenue by Aircraft** | Which tails earn, and how efficiently | Owner, DoO | period, location, aircraft, program | Tail, Billed, Collected, Refunded, Billed hours, Effective $/hr, Net to school | `groupBy` `RevenueAllocation` (`event=APPROVAL`, `dimension=REVENUE`) on `revenueReviewId → RevenueReview.aircraftId`; hours from `RevenueReview.flightTime`; collected via `LedgerEntry` join. Idx `[organizationId, effectiveAt]` + `[revenueReviewId]`. `aircraftId` null → "No aircraft (ground/manual)". |
| **Revenue by Instructor** | Instructor-service revenue vs the cost of the instructor (margin) | Owner, CFI, Accountant | period, location, instructor, program | Instructor, Billed (total), `INSTRUCTOR_SERVICE_REVENUE`, Compensation accrued, Margin | Same join on `RevenueReview.instructorId`; compensation from `InstructorEarning.instructorId` (never mixed with revenue — separate query, doc 28 §8). Per-instructor comp rows additionally need `revenue.compensation_view`; without it the margin column is hidden (revenue-only view). |
| **Revenue by Program** | Revenue per syllabus/program | Owner, DoO, CFI | period, program, location | Program, Billed, Collected, Discounts, Unattributed row | Program resolved by the doc 28 §8 deterministic chain (`review → Dispatch → ScheduleEvent → SyllabusLesson → Syllabus`; else active enrollment at `effectiveAt`; else **"Unassigned"** — a visible bucket, never a silent drop). |
| **Revenue by Location** | Per-base performance | Owner, DoO | period, location | Location, Billed, Collected, Tax, Fees | Join `RevenueReview.locationId`. |
| **Revenue by Airport** | Landing/ramp-fee revenue by airport | Owner, Accountant | period, airport | Airport (ICAO), `AIRPORT_LANDING_FEES` billed, Total billed | `RevenueReview.locationId → Location.icao` (fallback: location name + "add ICAO" nudge). Per-visited-airport grain (`Dispatch.airportsVisited`) deferred (doc 28 §16 / §15). |
| **Revenue by Period** | The month-close revenue story | Owner, Accountant | day/week/month grain, location | Period, Billed, Adjustments (signed, incl. `VOID`/`WRITE_OFF`), Collected, Refunds, Platform fee, Processing cost, Net to school | Billed = `APPROVAL` REVENUE; Adjustments = signed Σ `ADJUSTMENT`+`VOID`+`WRITE_OFF`; Collected = `LedgerEntry` debits to `PAYMENT_CLEARING`+`CASH_ON_PREMISES`; Refunds = signed `REFUND`+`DISPUTE`; Net to school = Σ `SCHOOL_RETAINED_REVENUE` (net, incl. `SETTLEMENT` true-ups). |

Every dimension report shows an explicit **Unattributed** row when non-zero so totals foot to 100% (SetNull FKs — a sold aircraft / departed instructor leaves rows in "Unattributed (removed …)", never dropped, doc 30 §12).

### 4.3 Realization, aging, category, refunds, fees, tax

The remaining spec Part 3 financial reports. RBAC **`billing.view`** (+ `revenue.exports_run` to export) unless noted.

| Report | Purpose | Persona | Filters | Columns | Source query |
|---|---|---|---|---|---|
| **Collected vs Approved** (Realization) | Did what we billed actually arrive? | Owner, Accountant | period grain, location, payer | Period, Approved (billed), Collected, Δ Outstanding, Realization %, footing check | Approved = `APPROVAL` REVENUE sets; Collected = A/R-clearing debits; the **footing identity** `Billed + Adjustments − Collected = Δ Outstanding` (doc 12 §2.8 / R7) is displayed and, if the continuously-checked invariant is violated, the row renders `destructive` with a reconciliation link — never papered over. |
| **A/R Aging** (payment-status aging) | Who owes, how overdue | Accountant, DoO | as-of date, payer/student, location | Payer/Student, Current, 0–30, 31–60, 61–90, 90+, Total due | Derived **Amount Due** per invoice (ADR-035: frozen total + APPLIED adjustment deltas − settled payments + succeeded refunds) bucketed by invoice age; reconciles to the `ACCOUNTS_RECEIVABLE` ledger balance (invariant R3). Never reads the demoted `Student.accountBalance`. |
| **Revenue by Category** (allocation category totals) | The chart-of-accounts view of revenue | Accountant, Owner | period, dimension (REVENUE/PROCEEDS), category | Category (customer label), Dimension, Billed, Adjustments, Refunds, Net | `groupBy RevenueAllocation.category` on idx `[organizationId, category, effectiveAt]`. Covers all doc 34 categories incl. the +7 (`GROUND_INSTRUCTION_REVENUE`, `SIMULATOR_REVENUE`, `MEMBERSHIP_REVENUE`, `TRAINING_MATERIAL_REVENUE`, `MERCHANDISE_REVENUE`, `PROCESSOR_FEE`) and the PROCEEDS split (`TAX`, `PLATFORM_FEE`, `SCHOOL_RETAINED_REVENUE`). Ground/sim split is **forward-only** (pre-cutover rows read `INSTRUCTOR_SERVICE_REVENUE`, labeled — doc 28 §3.1). |
| **Refunds & Reversals** | Every dollar returned or clawed back, and why | Accountant, Owner | period, kind (refund/dispute), method, reason | Date, Review #, Kind (Refund / Lost dispute), Amount (signed), Method, Reason, Payer, Compensation impact | Signed `REFUND` **and** `DISPUTE` allocation sets (doc 28 keeps them **separate events** for exactly this reporting distinction) joined to `Refund`/`Dispute` rows. Processor fee is **not** returned on refunds — the report shows the honest net (doc 28 §6.4). |
| **Platform Fee Statement** | The school's view of the AeroOps fee | Owner, Accountant | period | Period, Accrued, Earned, Reversed, Net earned, Effective rate | `PlatformFee.amount − reversedAmount` where `status ∈ {EARNED, PARTIALLY_REVERSED}`, **bucketed on `PlatformFee.earnedAt`** (doc 34 R30/§5.8 — never `createdAt`). Labeled "AeroOps platform fee"; **never conflated** with the Stripe processing cost (spec Part W). |
| **Processing Costs** | What the card/bank processor took (card-vs-ACH economics) | Owner, Accountant | period, rail | Period, Card fees, ACH fees, Dispute fees, Total, % of collected | Σ `PROCESSOR_FEE` allocations (`SETTLEMENT` sets) / `PROCESSOR_FEES_EXPENSE` ledger, joined by `sourceType="Payment" → Payment.method` for the card-vs-ACH split (doc 28 §8). Actuals only — never estimated (doc 28 L9). |
| **Tax Collected** | Tax owed by jurisdiction, for filing prep | Accountant | period, jurisdiction, rule | Jurisdiction, Rule, Rule version, Taxable base, Tax amount, Corrections | **Accrual basis, bucketed on `TaxSnapshot.serviceDate`** (the one report not on `effectiveAt`, doc 12 §2.8). Corrections (reversal `TaxSnapshot`s) present as signed lines in the current period, each labeled with the original service period — a filed period is never restated. Carries the disclaimer prominently (§11). |

### 4.4 Reconciliation reports (view `billing.view`; resolve `revenue.reconciliation_manage`)

Rendered here for completeness; detection/resolution owned by doc 23 / doc 12 §2.6. They are the reconciliation queue filtered and grouped — no separate mechanism.

| Report | Columns | Source |
|---|---|---|
| **Unmatched Items** | Exception kind, expected/actual, provenance link, opened-at, age | `ReconciliationException` where `status=OPEN`, idx `[organizationId, status]`. |
| **Payout Reconciliation** | Payout gross → processor fees → net, per-transaction composition with `Payment`/`Refund`/Invoice/`PlatformFee` provenance, period roll-up to `PAYMENT_CLEARING` | `ProviderPayout` + matcher links; period nets foot to the `PAYMENT_CLEARING` movement (doc 12 §2.8; `SETTLED_TO_BANK` closes the payout leg, doc 28 §5.2). |

---

## 5. Report catalog — instructor-compensation reports

Reproduces doc 29 §12 with query + RBAC. **All bucket on `InstructorEarning.earnedAt`** in `Organization.timeZone` (`PENDING`/`HELD` rows have null `earnedAt` and appear only in accrual/aging views), idx `[organizationId, instructorId, earnedAt]` (doc 34 §5.9). **Snapshot rows only** — never recomputed from current rates. Dimensions join `InstructorEarning → RevenueReview` (location) and `→ timeEntry.scheduleEvent → Syllabus` (program). RBAC: **`revenue.compensation_view`** for all-instructor; a **`revenue.compensation_view_own`** holder gets the *same queries hard-scoped in the engine to their own instructor profile* (doc 29 §11 — self-scope is enforced in the query, not the UI; cross-instructor request → 404). Instructor compensation is **structurally never conflated with customer billing** (constitution / automatic-rejection condition) and never visible to students/payers.

| Report | Grain & filters | Definition | RBAC |
|---|---|---|---|
| **Compensation by Instructor** | instructor × period | Σ signed `amount` by status bucket — earned (`APPROVED`+`EXPORTED`), pending (`PENDING`), held (`HELD`); hours by category | view / view_own |
| **Compensation by Location** | location × period | join `RevenueReview.locationId`; same figures | view / view_own |
| **Compensation by Program** | program (Syllabus) × period | join `timeEntry.scheduleEvent → SyllabusLesson → Syllabus`; unattributed → explicit "No program" bucket | view / view_own |
| **Flight vs Ground split** | category group × period | pure catalog `categoryGroup()` (FLIGHT / GROUND / SIM / OTHER — contract-tested exhaustive over the category enum, doc 29 §12) | view / view_own |
| **Contractor totals / Employee totals** | classification × period | group by `classification` snapshot; `CONTRACTOR` / `EMPLOYEE` / `UNSPECIFIED` shown **separately, never merged** | view / view_own |
| **Pending-approval queue** | org | `status=PENDING` + derived open clawback proposals (doc 29 §6.4) | view |
| **Held / awaiting settlement** | org | `status=HELD` + review payment status + expected ACH window + days-held aging | view / view_own |
| **Export status** | export filter | `status ∈ {APPROVED (unexported), EXPORTED}`, `exportJobId`, `exportedAt` — the Part 3 handoff view | view |
| **Compensation liability** | org, point-in-time | `INSTRUCTOR_COMP_PAYABLE` ledger balance (invariant R6) + Held total — feeds doc 30's executive tile | `billing.view` (total) + `revenue.compensation_view` (per-instructor rows) |
| **Contractor Compensation (calendar year)** | contractor × year | hours + compensation by category, reversals netted, export status — **1099 preparation** (accrual until D44 adds the payment marker) | view |
| **Compensation gap report** | org | approved reviews with compensable entries but **no** earnings (late onboarding, doc 04 §2.7) | view |

Every figure links to the rows behind it. **Disclaimer (§11) renders on every compensation report and every compensation export preview** (doc 29 §14).

---

## 6. Read-path architecture (one engine, snapshots only)

1. **Server components** (`/billing/reports/[report]/page.tsx`, `dynamic='force-dynamic'`) resolve the session, org `timeZone`, active location, and the report params (period, filters), then call the reporting engine. Legacy `/reports` + `/executive` server components have their revenue math re-pointed at the same engine (doc 30 §3; retires the 00 §7.4 float defect).
2. **`src/lib/revenue-reports.ts`** — the parameterized report queries (billed/collected/refunded/net per dimension × period). It **composes the same period-primitive functions** exported by `src/lib/revenue-dashboard.ts` (`approvedInPeriod`, `collectedInPeriod`, `refundedInPeriod`, `platformFeeInPeriod`, `schoolRetainedInPeriod`, `processorCostInPeriod`) and adds only the `GROUP BY` dimension — **a figure is never computed twice** (one-engine rule, doc 30 §10.8 / ADR-035). Compensation reports read via `src/lib/instructor-compensation.ts` report queries (doc 29 §12). Aggregation/period-boundary math are **pure, framework-free, contract-tested** like `billing.ts`; the query layer is thin typed wrappers over `db.groupBy/aggregate`.
3. **Bounded + indexed** (§4 conventions). Drill-downs inherit the filter that produced the figure, so the list a user lands on sums to the figure they clicked.
4. **Client** (`reports-client.tsx` idiom): Recharts per the design-system spec (`ResponsiveContainer` in `h-60 CardContent`, theme-aware series pairs, muted 10px ticks, compact `$1.2k` formatters), `Table` (auto `overflow-x-auto`), `StatusBadge` via `statusToneOf()`. The **Quick-CSV** `downloadCsv(filename, headers, rows)` button is gated on `reports.export` (passed as a server-resolved boolean prop and re-checked on any server drill-down route) — closing the audit gap where the button rendered ungated (00 §7). A **second chart consumer** beyond `reports-client.tsx` triggers the design-system second-copy rule: the inline `COLORS`/`useMode()`/`tooltipStyle()` extract to a shared `src/components/charts/` module in this slice.

No async hops, no provider calls, no transactions in any report read path.

---

## 7. Excel export (existing `exceljs` dependency)

`exceljs@^4.4.0` is already a dependency, used server-side today **only for reading** uploads (`src/lib/import/parse.ts`: `(await import("exceljs")).default`, `workbook.xlsx.load`). Financial Export is the **same seam in the write direction** — `workbook.xlsx.writeBuffer()` → a `Buffer` — via the identical server-side dynamic import. No new dependency.

Generation lives in **`src/lib/revenue-export/xlsx.ts`** (workbook builder), driven by the `FinancialExportJob` runner (§9). Format is a **`params.format` field** (`"csv"` default per kind, `"xlsx"` optional) — **no new `ExportJobKind` value** (doc 13 canonical, additive-only). A single job renders one workbook whose worksheets are the report(s) intrinsic to its kind.

### 7.1 Workbook layout — Cover + one worksheet per report

| Kind + `format=xlsx` | Worksheets |
|---|---|
| `REVENUE_CSV` | **Cover** · Revenue by Category · Revenue by Aircraft · Revenue by Instructor · Revenue by Program · Revenue by Location · Revenue by Period · Collected vs Approved · Refunds & Reversals — all pivots of the one bounded allocation+ledger read over the period |
| `TAX_CSV` | **Cover** · Tax Collected (by jurisdiction/rule/version) |
| `INSTRUCTOR_COMPENSATION_CSV` | **Cover** · Compensation by Instructor · Flight vs Ground · Contractor Totals · Contractor Compensation (YTD) |
| `LEDGER_CSV` / `QUICKBOOKS_CSV` | **Cover** · Journal (accounting rows, §8) — CSV is the usual format for these (import target); xlsx available for human review |

**Worksheet 0 — Cover** (always first): org legal name; report/kind; period (start–end, org tz); basis (accrual; snapshot-sourced); generated-at (org tz) + generated-by actor label; export job id; SHA-256 checksum; a sheet index with row counts; and the **honest-labeling disclaimer block verbatim** (§11). The cover is the human-readable provenance of the artifact.

### 7.2 Header & typing conventions (per data worksheet)

| Element | Convention |
|---|---|
| Title row | Row 1, merged across columns, bold, report name + period |
| Header row | Row 2: bold, subtle fill, **frozen pane** (`worksheet.views=[{state:'frozen', ySplit:2}]`), `worksheet.autoFilter` on the header range |
| Money cells | `cell.numFmt = '#,##0.00;(#,##0.00)'` (parentheses for negatives), value = `Number(decimal.toFixed(2))`; a **Currency** column carries the ISO code and the cover states it. *Honesty note:* the spreadsheet is a **display artifact** — the immutable ledger stays the Decimal book of record; **totals are precomputed in the engine (Decimal) and written as values**, never a worksheet `SUM()` (avoids float drift so the workbook total equals the ledger total to the cent) |
| Date cells | `cell.numFmt='yyyy-mm-dd'`, value = JS `Date` at org-tz midnight |
| Text cells | explicit string type; ids/tail numbers never coerced to number (leading zeros preserved) |
| Totals row | bold, top border, precomputed Decimal totals |
| Column widths | sized to max content (bounded) |
| Colours | none load-bearing (Excel opens anywhere); status conveyed by text, not fill (accessibility parity with the app) |

### 7.3 File naming, size limits, sync vs job

**Name** (deterministic, tenant-prefixed, sortable, collision-free): `{orgSlug}_{kind-lower}_{YYYY-MM-DD}_{YYYY-MM-DD}_{jobShortId}.{xlsx|csv}` — e.g. `blue-ridge_revenue_2026-06-01_2026-06-30_a1b2c3.xlsx`. `orgSlug` and `jobShortId` (first 6 of the cuid) guarantee uniqueness; ISO dates sort chronologically. Stored as the `Document.name`.

**Generation path — a `FinancialExportJob` is always created** (audit + immutable artifact + idempotent re-run), but *when* it runs is sized to the work:

| Estimated rows (bounded pre-`count()` over the period) | Path |
|---|---|
| ≤ `EXPORT_SYNC_ROW_LIMIT` (proposed **5,000**) | **Synchronous**: job created `PENDING`→`RUNNING`, workbook/CSV built in-request, artifact stored, job `COMPLETED`, file streamed back in the same response (the `parse.ts` in-request idiom, write direction). Feels instant. |
| > sync limit, or multi-report pack, or a full fiscal year | **Deferred job**: job left `PENDING`; runner executes on the bounded server-tick / `waitUntil` idiom (the reconciliation-tick precedent) until a real queue seam lands (deferred, doc 12 §9); the requester is notified `EXPORT_READY` (doc 31, `NotificationKind.EXPORT_READY`) with the download link when `COMPLETED`. |
| > `EXPORT_MAX_ROWS` (proposed **250,000**) **or** period > **366 days** | **Refused** at create with an actionable message ("This range is too large to export at once — narrow the period or split by location"). Never an unbounded query (V13). |

The pre-`count()` and the unmapped-keys preview (§8.3) both run **before** the job is created, so the user sizes and fixes the export up front. Streaming/generation pages rows on the org-leading indexes (V13) — the workbook builder never materializes an unbounded set in memory.

---

## 8. Accounting-export adapter foundation

The internal `LedgerAccount` enum stays **fixed and testable**; per-org chart-of-accounts flexibility lives entirely at **export time** through `AccountingMapping` (doc 12 §2.5/§2.7). First two adapters: **generic CSV journal** and **QuickBooks-shaped CSV**. QuickBooks Online *API* sync is post-Part-3.

### 8.1 `AccountingMapping` usage & resolution order

`AccountingMapping` (doc 13 §4.13, canonical): `@@unique([organizationId, externalSystem, sourceType, sourceKey]) → externalAccount, externalClass?, externalItem?`. `MappingSourceType`: `ALLOCATION_CATEGORY | LEDGER_ACCOUNT | REVENUE_ITEM | TAX_CODE | PAYMENT_METHOD`. `externalSystem` selects the target (`"quickbooks"` | `"generic_csv"`, pre-set by `RevenueSettings.defaultExportSystem`).

**Resolution is a pure, contract-tested function** `resolveAccount(row, externalSystem)` in `src/lib/revenue-export/mapping.ts`, fixed fallback order (doc 12 §2.7), first hit wins:

1. Exact `REVENUE_ITEM` mapping for the line's `revenueItemId` (finest grain — lets one org split "Headsets" from "Books" even though both allocate to `MERCHANDISE_REVENUE`).
2. The mapping for the row's **allocation category** (`ALLOCATION_CATEGORY`) or, for journal rows, its **ledger account** (`LEDGER_ACCOUNT`); tax rows resolve `TAX_CODE`, collections resolve `PAYMENT_METHOD`.
3. The **shipped QuickBooks-shaped default** for that category/account (`src/lib/revenue-export/defaults.ts` — a seeded catalog so a zero-config org gets a working QuickBooks CSV, e.g. `AIRCRAFT_REVENUE → "Aircraft Rental Income"`, `TAX_PAYABLE → "Sales Tax Payable"`, `PROCESSOR_FEES_EXPENSE → "Merchant Processing Fees"`, `PLATFORM_FEE_EXPENSE → "Software / Platform Fees"`).

The seven new Part 2 allocation categories (doc 34) join the default catalog and are valid `ALLOCATION_CATEGORY` `sourceKey`s; every `RevenueItem.id` is a valid `REVENUE_ITEM` `sourceKey` (doc 06 seam).

### 8.2 Column specs

**Generic CSV journal** (`LEDGER_CSV`) — neutral, one row per `LedgerEntry`, rows sharing `journalId` share the first three columns:

`effective_date, journal_no, source_type, source_id, review_no, invoice_no, account_code, account_name, debit, credit, currency, memo, class, name`

**QuickBooks-shaped CSV** (`QUICKBOOKS_CSV`) — column headers/order aligned to the QuickBooks Online **Journal Entry import** shape (the exact header strings live in a config catalog `src/lib/revenue-export/quickbooks.ts` so tracking a QBO format change never touches the engine):

`Journal No, Journal Date, Currency, Account, Debits, Credits, Description, Name, Class, Location`

Both: one physical line per ledger row; `Account`/`Class` from `resolveAccount`; `Name` = student/payer label; debit/credit split from `LedgerEntry.direction` + `amount` (positive-amount-plus-direction convention, doc 28 §5.1). The adapter is a small interface — `AccountingAdapter { headers(): string[]; rows(journalRow, mapping): string[][] }` — with `GenericJournalAdapter` and `QuickBooksJournalAdapter` implementations selected by `externalSystem`.

**`REVENUE_CSV`** (one row per allocation): `effective_date, review_no, invoice_no, dimension, category, category_label, amount, currency, event, aircraft_tail, instructor, program, location, airport_icao`.

**`INSTRUCTOR_COMPENSATION_CSV`** (one row per earning): `earned_date, instructor, classification, category, category_group, hours, rate, amount, currency, review_no, status, exported_at, reversal_of`.

**`TAX_CSV`**: `service_date, jurisdiction, tax_rule, rule_version, taxable_base, tax_amount, currency, review_no, invoice_no, corrects_period`.

### 8.3 Unmapped keys are never a silent blank

An unmapped `sourceKey` produces a **per-row error** on the job (`rowErrors` `[{row, message}]` naming the key + affected rows), sets `errorCount`, and lands the job in **`COMPLETED_WITH_ERRORS`** (never a blank account cell — doc 12 §2.7). Before a mapped job (`LEDGER_CSV`/`QUICKBOOKS_CSV`) is created, the export console runs a **pre-export unmapped-keys preview** over the selected period so the org fixes `AccountingMapping` first — the Import Center's row-by-row-outcome idiom, in reverse. The mapping editor (`revenue.exports_run`) lists every source key seen in the period with its current/defaulted account and an "unmapped" flag.

---

## 9. `FinancialExportJob` lifecycle

`FinancialExportJob` (doc 13 §4.13, canonical — **zero new columns**): `kind`, `status`, `periodStart/End`, `params`, `rowCount`, `errorCount`, `rowErrors`, `exportedRecordIds` (manifest), `fileDocumentId`, `checksum`, `createdBy*`. `earnings InstructorEarning[]` back-relation for the compensation kind.

### 9.1 State machine (`ExportJobStatus`)

`PENDING → RUNNING → COMPLETED | COMPLETED_WITH_ERRORS | FAILED` (doc 13). Every transition audited (§10). `RUNNING` is claimed with a guarded `updateMany … WHERE id AND status='PENDING'` (count 0 → someone else claimed it; idempotent, ADR-033 idiom) so a retried tick never double-runs a job.

### 9.2 Idempotent re-runs (differ by kind)

| Kind | Idempotency |
|---|---|
| `REVENUE_CSV`, `LEDGER_CSV`, `QUICKBOOKS_CSV`, `TAX_CSV` | **Pure reads over immutable rows** — a re-run of the same (kind, period, filters, mapping) is deterministic and yields an **identical `checksum`**. Re-running is side-effect-free; the checksum proves equivalence. Each run is its own job + its own artifact (immutability, §9.3). |
| `INSTRUCTOR_COMPENSATION_CSV` | Selects `APPROVED` (unexported) earnings + `APPROVED` reversal rows and marks them `EXPORTED` + `exportJobId`/`exportedAt` **in the same transaction that finalizes the manifest** (doc 29 §6.7; a crash never half-marks). A re-run of the same period therefore picks up **only newly-approved / correction rows** (already-`EXPORTED` excluded) — additive-correct, never double-paying. An explicit **"reprint"** flag (`params.reprint=true`) re-renders already-exported rows **without** re-transitioning them, labeled `REPRINT` on the cover. |

### 9.3 Immutable artifacts via the `Document`/storage seam

- The workbook/CSV `Buffer` is written through the existing `getStorage().put(key, buffer, contentType)` seam (`src/lib/storage.ts`) under a server-generated key, then a **`Document`** row is created (`name` = §7.3 file name, `fileUrl` = the storage key, `kind` = `FINANCIAL_EXPORT` — a small additive `DocumentKind` value, §12) and its id set as `FinancialExportJob.fileDocumentId` (SetNull FK, doc 13).
- **Once `COMPLETED`, the artifact is never mutated.** Corrections are a **new** `FinancialExportJob` + a **new** `Document` (new key) — the ledger's append-only law extended to its exports. `checksum` (SHA-256 of the bytes) + `exportedRecordIds` (the manifest) make each artifact self-verifying and fully reconstructable.
- `Document.expiresAt` may set an org retention window (default: retained with the org — financial artifacts are the org's records; a retention policy is org-configurable, not a Part 3 default deletion). Snapshot/restore includes the job + its `Document` so a founder restore never loses financial exports (doc 12 §2.7 wipe-order placement).

### 9.4 Compensation export (doc 29 §6.7 handoff)

`INSTRUCTOR_COMPENSATION_CSV`: the job runner is the `T8 APPROVED → EXPORTED` writer (doc 29 §5). Part 2 shipped the columns/statuses/contract; Part 3 ships this runner and the CSV/xlsx generation. The manifest tx is the atomic `EXPORTED`-mark; nothing in Part 2 writes `EXPORTED`.

---

## 10. Export security

Financial exports are the highest-leakage surface in the Revenue Engine — a single artifact is the org's **complete** financial picture. Controls, each mapped to an automatic-rejection condition it structurally prevents:

| Control | Design | Prevents |
|---|---|---|
| **RBAC** | Create/run/download `FinancialExportJob` and manage `AccountingMapping` require **`revenue.exports_run`** (`{mutating:true}` on create/run/mapping-edit). Quick CSV requires `reports.export`. Underlying report visibility (`billing.view` / `revenue.compensation_view`) is checked before either — you cannot export what you cannot see. Server-side on the route, **never UI-only** (automatic-rejection condition). | "Permission checks exist only in the UI" |
| **Tenant scoping** | `organizationId` on the job and **every** query comes from the session, never the client (do-not-break rule 1). The runner's selects are all org-filtered; a static source-scan test asserts the export engine takes org from session. | "Cross-tenant financial access" |
| **Authorized download route — not a static URL** | **Critical:** `StorageAdapter.url(key)` returns a *public static path* (`/uploads/<key>`) with no auth, and the R2 adapter is a stub — so the raw `Document.fileUrl` is **never** handed to the browser for a financial export. Download is `GET /api/revenue/exports/[id]/download` → `authorize('revenue.exports_run')` → load job → **assert `job.organizationId === session.orgId`** (mismatch → 404, indistinguishable from nonexistent) → **stream the bytes** through the storage adapter with `Content-Disposition: attachment`. A leaked/guessed key alone grants nothing. | "Cross-tenant payment lookup" / cross-org leak via guessable URL |
| **Audit on every export — including download** | `recordAudit` on `revenue.export_created` / `_completed` / `_failed` (doc 12 §6) **and** `revenue.export_downloaded` (actor, job id, kind, period, checksum) — a complete financial artifact leaving the system is itself audit-worthy. | Unaudited financial-data egress |
| **No cross-org data in an artifact** | The manifest (`exportedRecordIds`) is single-org by construction; a contract test asserts every id in a job's manifest resolves to the job's org (Part AC "tenant isolation"). | Cross-tenant data in a file |
| **Impersonation** | Read-only impersonation refuses export **create/run** (`{mutating:true}`, session.ts gate) and hides the controls. **Download is also suppressed under read-only impersonation** — exfiltrating the org's complete financials while impersonating is refused even though a download is technically a read (belt-and-suspenders; recommendation, §16). | Impersonation-driven data egress |
| **Honest labeling** | Every artifact states period + generation time + basis + the "not an official tax document" disclaimer (§11). | Documentation claiming more than it is |

**Signed/expiring download — forward path.** The storage seam has **no signed-URL support today** (`url()` is a static path). So Part 3 serves via the authorized streaming route above. When the production storage adapter (R2) gains a `signedUrl(key, ttlSeconds)` method, the download route may `302` to a **short-TTL signed URL** instead of streaming — a per-request, expiring, tenant-checked link. This is an **additive `StorageAdapter` method**, not an owner decision; it is designed for and gated on the seam, and the authorized streaming route remains the fallback. No financial artifact is ever served as a durable public URL.

---

## 11. Honest-labeling rule (binding)

Every Financial Export artifact — Excel **Cover** worksheet, the preamble rows of every CSV, the report footer, and the export preview — carries, verbatim:

```
AeroOps Financial Export — {report / kind name}
Organization: {org legal name}
Period: {periodStart} to {periodEnd} ({org timeZone}; {accrual|as-of} basis)
Generated: {generatedAt, org timeZone} by {actor label}
Source: derived from immutable Revenue Engine records
        (allocations, ledger, earnings, tax snapshots)
Export job: {jobId} · Checksum (SHA-256): {checksum}

NOT AN OFFICIAL TAX DOCUMENT. AeroOps does not determine legal worker
classification and does not claim to generate official tax documents.
This report is for internal and accounting-preparation use. Consult a
qualified accountant or tax professional before filing.
```

The two bold sentences are the doc 29 §1 verbatim disclaimer (binding on every compensation surface and export) plus the spec's required "not an official tax document" framing. The **period** and **generation time** (with the org timezone) are always present so a stale artifact can never be mistaken for a live figure. **Tax Collected**, **Contractor Compensation**, and every **compensation** export carry the disclaimer most prominently — they are the reports users are tempted to file as-is. Customer-facing names use the canon exactly (Financial Export, Revenue Report, Instructor Compensation); backend terms (Invoice, LedgerEntry, PaymentIntent) are never renamed for a report.

---

## 12. Data-model touchpoints

**Zero new models** — `FinancialExportJob` and `AccountingMapping` are canonical in doc 13 §4.13; the reports read models bound in docs 13/34. This doc's schema footprint:

| Change | Detail | Owner |
|---|---|---|
| **`DocumentKind` +1** | Additive value **`FINANCIAL_EXPORT`** so export artifacts are typed (vs `OTHER`) and filterable; additive-enum discipline (two-step if `DocumentKind` is already deployed). Flagged for [13](./13-database-model.md)/[34](./34-part2-database-additions.md) alignment. | 13/34 |
| **`ExportJobKind`** | Used as-is (5 values); Excel is a `params.format` field, **no new kind**. If a bundled multi-report "Financial Statement Pack" workbook is later wanted as a first-class kind, it is one additive enum value — deferred (§15). | 13 |
| **Permission data** | `revenue.exports_run` (doc 12 §6) added to `PERMISSIONS` + `DEFAULT_ROLE_PERMISSIONS` (OWNER/ADMIN/ACCOUNTANT) + relevant `ROLE_TEMPLATES`; `reports.export` enforcement added to the Quick-CSV button path. Catalogued in doc 36. | 36 |
| **Nav/section wiring** | `/billing/reports/[report]`, `/billing/reports/compensation/*`, `/billing/exports` → `SECTION_PERMISSIONS` (`billing.view` / `revenue.exports_run`) + `SECTION_MODULES` (`billing`); "Financial Exports" `NAV_ITEMS` entry; the constitution `NAV↔SECTION_PERMISSIONS` test requires the mapping. | 36 |
| **`STATUS_TONE`** | `ExportJobStatus` tones registered **once** in `src/lib/status-colors.ts` (single-source rule): `PENDING` amber, `RUNNING` blue, `COMPLETED` green, `COMPLETED_WITH_ERRORS` orange, `FAILED` red. | this slice |
| **Config** | `RevenueSettings.defaultExportSystem` (`generic_csv` default, doc 13) drives the adapter/mapping target; consumed, not added. | 13 |
| **Snapshot/wipe order** | `FinancialExportJob` + `AccountingMapping` already placed in the doc 12 §2.7 / doc 13 §10 order (prepended ahead of invoice/instructor deletion; both join `TableKey`/capture/restore). | 13 |

---

## 13. Validation & business rules

1. **Snapshots only** — no report/export figure reads current rate/profile/config tables for money (doc 12 §2.8). Contract test: `revenue-reports.ts` and the export engine have no import of pricing/rate-profile modules.
2. **Decimal end-to-end** — aggregation in SQL over `Decimal`; totals precomputed in Decimal and written as values (§7.2); no `Number()` coercion of money in report/CSV code (the Excel display-cell conversion in §7.2 is the one bounded, documented exception, and totals are never worksheet `SUM()`s).
3. **Bucketing** — allocations/ledger on `effectiveAt`; platform fee on `earnedAt`; compensation on `earnedAt`; tax on `serviceDate` — never `createdAt` (docs 12/28/34).
4. **Bounded everything** — every query `take`/period-bounded on org-leading indexes; pre-`count()` sizes exports; hard caps refuse oversize (§7.3); export generation pages rows (V13).
5. **Atomic `EXPORTED`** — compensation export marks rows `EXPORTED` + writes the manifest in **one** transaction (doc 12 V12 / doc 29 §6.7).
6. **Immutable artifacts** — `COMPLETED` jobs' `Document`s are never rewritten; corrections are new jobs; `checksum` + manifest verify (§9.3).
7. **Unmapped ≠ blank** — a missing `AccountingMapping` is a per-row error + `COMPLETED_WITH_ERRORS`, surfaced pre-export (§8.3).
8. **Footing displayed & checked** — the `Billed + Adjustments − Collected = Δ Outstanding` identity (R7) shows on Collected-vs-Approved and Revenue-by-Period; a violated invariant renders `destructive` with a reconciliation link, never hidden (§4.3).
9. **Privacy isolation** — compensation reports engine-scope `_view_own` to the session instructor (404 across instructors); students/payers reach **no** report or export surface (their keys lack `billing.view`/`reports.view`/`revenue.compensation_view`; the self-view engine never imports the report/export engines — doc 30 §6, contract-tested).
10. **No AI pathway** creates, runs, or downloads an export, or edits a mapping (constitution rule 8).

---

## 14. Failure modes & edge cases

| Case | Behavior |
|---|---|
| Fresh org, no financial rows | Teaching `EmptyState`: "No revenue activity yet — reports fill in as Revenue Reviews are approved and paid." Export refused with the same message (nothing to export), never a blank file. |
| Legacy (pre-Phase-8) invoices | No allocations/journals; reports label the pre-allocation era; never silently backfilled (doc 28 §14). |
| Unmapped account keys | Per-row error + `COMPLETED_WITH_ERRORS`; the artifact still generates for the mapped rows; the preview surfaces the gap first (§8.3). |
| Range too large | Refused pre-create with an actionable narrow-it message (§7.3) — never an unbounded query or a timeout. |
| Deferred job never finishes (crash) | Job stays `RUNNING`/`PENDING`; the bounded tick re-claims (guarded, idempotent); a stale-`RUNNING` sweep re-runs or marks `FAILED` with a reason; no half-artifact is ever exposed (file is written before the `Document`/`fileDocumentId` link + `COMPLETED`). |
| Storage `put` fails | Job → `FAILED` with the storage error message; audited `revenue.export_failed`; no `Document` row, no partial link. |
| Concurrent identical export | Two `PENDING` jobs both run; each produces its own immutable artifact with an identical checksum (pure kinds) — safe; no shared mutable state. Compensation kind: the guarded `EXPORTED` claim means the second job's manifest simply finds those rows already exported (no double-mark). |
| Refund-heavy / negative period | Figures render **signed** with provenance (Collected < 0 legitimately) — never clamped to zero, never hidden (doc 30 §12). |
| Dimension row removed | SetNull → "Unattributed (removed …)" bucket; totals still foot. |
| Currency | Single org currency (Part 2); every report/export states the ISO code; a mixed-currency journal is structurally impossible (one currency per journal) and would error to reconciliation rather than sum across currencies. |
| Timezone / DST edges | Period boundaries from `Organization.timeZone`; pure period-math contract tests cover DST. A review approved 23:59 local buckets in the local day. |

---

## 15. UX notes

- **Design system only** (DESIGN_SYSTEM.md): `Card`/`CardTitle`, `PageHeader` (eyebrow "Revenue Engine"), `Table` (auto `overflow-x-auto`), `Button` (`ghost` "CSV", `default`/`secondary` for "New Financial Export"; `success` never for a read), `StatusBadge`/`statusToneOf()`, `EmptyState` (never a bare "No data"), `Skeleton`, tokens only — no raw hex; Recharts per the design-system spec.
- **Export console** (`/billing/exports`): a `Table` of jobs (kind, period, status badge, rows/errors, created-by, download), a "New Financial Export" drawer (kind → period → filters → format → the unmapped-keys preview → confirm), and the `AccountingMapping` editor. The download link hits the authorized route (§10), never a raw file URL. Errors are actionable ("3 account codes are unmapped — map them or the export will flag those rows"), following the Import Center's per-row-outcome reference.
- **Report pages**: filters are URL params (shareable, same-meaning links); the location toggle respects the `aerops-location` cookie; charts are theme-aware; every figure links to its rows.
- **States are the feature**: route-level `loading.tsx` skeletons mirroring the tile/table grid; per-section inline error states ("Couldn't load Revenue by Aircraft — Retry") — a failed section never blanks the page; quiet success toasts ("Financial Export ready — download").
- **Light/dark + desktop/tablet/mobile** parity (bottom nav below `lg`); tables scroll inside their own container so the page body never scrolls horizontally; figures carry full-precision `aria-label`s; the disclaimer is text, never colour-only.
- **Vocabulary**: Financial Export, Revenue Report, Revenue by *, Instructor Compensation, Amount Due — canon exactly; "check-in", "account balance" banned (AVIATION_STANDARDS, UX-gate). Operational people never see debits/credits; the journal/ledger export lives behind `billing.view`/`revenue.exports_run` accountant surfaces only.

---

## 16. Out of scope / deferred

- **QuickBooks Online API sync** (beyond the CSV shape) — post-Part-3 (doc 12 §9). Part 3 ships the two CSV adapters + the mapping model.
- **Scheduled / emailed reports & exports** — needs the queue seam and the email adapter (both deferred; the dev email-preview seam only, doc 31). Part 3 ships on-demand + in-app `EXPORT_READY`.
- **Signed/expiring download URLs** — designed (§10) but gated on the storage seam gaining `signedUrl()`; the authorized streaming route ships now.
- **A bundled "Financial Statement Pack" `ExportJobKind`** — one additive enum value if wanted later; §7 delivers multi-worksheet Excel via `params.format` without it.
- **Per-visited-airport landing-fee grain** (`Dispatch.airportsVisited`) — deferred (doc 28 §16); Revenue by Airport uses the review's location airport.
- **Cash-basis Tax Collected**, **multi-currency**, **configurable internal chart of accounts**, **saved custom report builder** — later phases (doc 12 §9); external mapping covers the known chart-of-accounts need.
- **1099/tax-document generation & instructor payout execution** — beyond Phase 8 (doc 29 §15); the disclaimer stands. Contractor Compensation totals stay accrual-based until D44 resolves the payment marker.

---

## 17. Open questions

Genuine product-owner / cross-doc calls only (engineering seams are resolved in the body):

1. **Export-download under read-only impersonation.** §10 recommends **suppressing** download of existing financial artifacts under read-only impersonation (a download exfiltrates the org's complete financials, even though it is technically a read). Confirm — this is a security-posture call, slightly stricter than the constitution's mutation-only impersonation block.
2. **Retention default for export artifacts.** §9.3 keeps artifacts with the org indefinitely (they are the org's financial records). Confirm no default retention/expiry window is imposed (an org-configurable retention policy is a later add) — a records-retention/compliance call, not an engineering one.
3. **`FINANCIAL_EXPORT` `DocumentKind` value** (for docs 13/34, consistency not product): §12 adds one additive `DocumentKind` value so export artifacts are typed rather than `OTHER`. Confirm the addition (or accept `OTHER` and filter by the `fileDocumentId` back-relation) when the Part 3 schema slice is authored.
4. **Sync/size thresholds.** `EXPORT_SYNC_ROW_LIMIT` (5,000), `EXPORT_MAX_ROWS` (250,000), and the 366-day period cap (§7.3) are proposed constants. Confirm against the five-school pilot's real month-end volumes; they are tunable config, not architecture.

---

## 18. Related documents

[12-revenue-allocation-and-reporting.md](./12-revenue-allocation-and-reporting.md) (§2.7 export seam, §2.8 report set, §6 RBAC/audit) · [28-revenue-allocation-ledger.md](./28-revenue-allocation-ledger.md) (§8 dimension resolution, category/event semantics) · [29-instructor-compensation.md](./29-instructor-compensation.md) (§1 disclaimer, §6.7 export handoff, §12 report list) · [30-revenue-dashboard.md](./30-revenue-dashboard.md) (the surface these reports link from; the shared engine) · [13-database-model.md](./13-database-model.md) §4.13 (`FinancialExportJob`, `AccountingMapping`, enums — canonical) · [34-part2-database-additions.md](./34-part2-database-additions.md) (Part 2 categories/events/`earnedAt` reported here) · **36-permissions-and-visibility.md** (the permission matrix these keys join) · [DESIGN_SYSTEM.md](../../design/DESIGN_SYSTEM.md) · [DATABASE_STANDARDS.md](../../architecture/DATABASE_STANDARDS.md).

### Compliance note

Design only. Nothing here deploys, generates a real export, calls Stripe, moves money, or sends production email; Stripe test mode is the only sanctioned environment and is not exercised. No Part 1 or Part 2 doc is modified or weakened; every extension is additive and every conflict is recorded above as an Open question rather than a silent divergence.
