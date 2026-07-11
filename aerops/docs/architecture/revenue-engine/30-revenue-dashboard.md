# Revenue Dashboard — Executive, Operations Queue, and Student/Payer Surfaces

> **Status:** Proposed — Phase 8 Part 2 · **Date:** 2026-07-10 · **Lead roles:** Financial UX Designer; Head of Product; Head of Human Interface Design at Apple; Aviation UX Lead at Boeing Digital Aviation · **Part of:** Revenue Engine design set ([README](./README.md))

This document is Part 2 Deliverable 15 (spec Part Z): the Revenue Dashboard that replaces/expands the existing billing pages. It designs **three strictly separated surfaces** — the **executive dashboard** (money truth for owners and Finance Managers), the **operations revenue queue** (the daily working surface for dispatchers, instructors, and approvers), and the **student/payer view** (only their own money, nothing else, ever). Every figure on every surface maps to a snapshotted record bound in [13-database-model.md](./13-database-model.md); nothing recomputes money from current rates, and no client-side event ever marks anything paid (spec Part AB).

North-star test: an owner opens one page and knows, without a calculator, what was billed today, what actually arrived, and what needs a human. A dispatcher works one queue top-to-bottom and is done. A student sees a plain "Amount Due" they can trust — and nothing about anyone else. If a number can't answer "why?", it links to the rows behind it or it doesn't ship.

---

## 1. Purpose & scope

### In scope

- **Migration posture** for the existing billing pages (`src/app/(app)/billing/page.tsx`, `billing/[id]/page.tsx` — audited in [00-current-billing-audit.md](./00-current-billing-audit.md) §7): expand in place, keep URLs (§3).
- **Executive revenue dashboard** — every spec Part Z metric mapped to its exact source query, status set, bucketing column, and index (§4).
- **Operations revenue queue** — every spec Part Z queue with filter predicate, sort/urgency rules, and actions-in-context (§5).
- **Student/payer view** — own-records-only summary, invoice, payment status, receipt, refund, Amount Due, Payment Methods, history; plus the hard never-show list as enforceable RBAC statements (§6).
- Read-path architecture (`src/lib/revenue-dashboard.ts` engine, server components, bounded queries), RBAC/nav wiring (`SECTION_PERMISSIONS`, `MODULE_BY_PREFIX`), `STATUS_TONE` additions, loading/empty/error states, light/dark + mobile parity per [docs/design/DESIGN_SYSTEM.md](../../design/DESIGN_SYSTEM.md).

### Out of scope (owned by siblings)

- The Revenue Review **detail screen** (anatomy, line editing, approval controls) — [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) §2.1. Queue cards link into it.
- Allocation write mechanics and category math — doc 28 (Part 2 Revenue Allocation design) and [12-revenue-allocation-and-reporting.md](./12-revenue-allocation-and-reporting.md); this doc only *reads* their rows.
- Charge execution, retries, failure handling — [22-approval-to-payment.md](./22-approval-to-payment.md), doc 25 (failure workflow). Queue actions delegate to their routes.
- Refund/dispute flows (doc 26), platform-fee policy management (doc 27, platform console), instructor-compensation screens (doc 29 — the dashboard links to "My Compensation" and the comp report, never re-implements them).
- Notifications that *point at* these surfaces — doc 31.
- Full Revenue Report definitions — [12-revenue-allocation-and-reporting.md](./12-revenue-allocation-and-reporting.md) §2.8 owns the report set; the dashboard links to reports, it does not duplicate them.
- Final Prisma arbitration for anything new — [34-part2-database-additions.md](./34-part2-database-additions.md). This doc proposes **zero new models and zero new columns** (§9) — its schema footprint is nav/permission data plus `STATUS_TONE` entries.

---

## 2. Relationship to Part 1 docs

| Part 1 doc | What this doc extends or finalizes |
|---|---|
| [00-current-billing-audit.md](./00-current-billing-audit.md) §7 | The audited billing list/detail pages and the float-summing reports/executive revenue math are the surfaces being replaced/expanded; §3 states the migration posture the audit asked for. |
| [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) | Finalizes the queue *surface* around doc 03's binding queue semantics: oldest-first default, age chips, needs-my-approval split, approve-from-card/bulk-approve for routine-only, submit-on-instructor's-behalf, reminder/escalation (§2.7, §2.10, §2.11). Status machine and `revenue.*` permission defaults (§6.1) are consumed verbatim. |
| [09-payment-timing-and-collection.md](./09-payment-timing-and-collection.md) | Payment-readiness engine (`READY / READY_WITH_WARNINGS / NOT_READY` + reasons) feeds the missing-payment-method queue and card chips; payment statuses 6–13 feed tiles and queues. |
| [11-responsible-payers.md](./11-responsible-payers.md) | The payer-visibility boundary (capability flags on `StudentPayerRelationship`, five-identity separation) governs §6; the `/payer` portal surface itself is Part 3 (doc 11 §10) — §6 defines the view contract it will render. |
| [12-revenue-allocation-and-reporting.md](./12-revenue-allocation-and-reporting.md) §2.8 | The Part 1 dashboard sketch (tile/source table, footing identity, `effectiveAt` bucketing, queue-first layout) is expanded here into the full three-surface design. Report definitions stay in doc 12; every dimension tile in §4.3 resolves exactly as doc 12 and doc 28 bind. |
| [13-database-model.md](./13-database-model.md) | Canonical for every model, status, and index this doc queries. No shape here deviates; where §4 names an index it is quoting doc 13. |

Nothing in Part 1 is reinterpreted. One posture tension with the Part 2 spec (Part W fee visibility vs doc 12's org-transparent platform-fee tile) is recorded in §15, not silently resolved.

---

## 3. Migration posture — expand in place, keep URLs

**Decision: the existing `/billing` section is expanded, not replaced; every existing URL keeps working.** *Simpler-workflow choice:* a new `/revenue` top-level section would be cleaner naming but breaks bookmarks, nav muscle memory, `SECTION_PERMISSIONS`/`SECTION_MODULES` wiring, and the `billing` module gating that already exists — five real schools onboarding tomorrow get a familiar door with a better room behind it.

| Surface | Route | What changes |
|---|---|---|
| Revenue Dashboard (executive, §4) | `/billing` | The current invoice-list landing page is **replaced** by the Revenue Dashboard. Nav label changes `Billing → Revenue` (label-only; href, icon, permission unchanged — mirrors the `ROLE_LABELS` display-language pattern). The aspirational "Stripe & QuickBooks sync-ready" header copy (00 §7.1) is deleted — no claims ahead of capability. |
| Operations revenue queue (§5) | `/billing/queue` | New page. New nav item **Revenue Reviews** in the Business group. |
| Student/payer view (§6) | `/billing/my` | New page. Nav item **My Payments**, visible only to holders of the new `revenue.self_view` key (§11). |
| Legacy invoice list | `/billing/invoices` | The current `/billing` page content moves here unchanged (last-60 list, stat cards retired in favor of the dashboard tiles). Linked from the dashboard as "All invoices". |
| Invoice detail | `/billing/[id]` | Kept as-is for legacy (non-review) invoices, including the manual `PaymentForm` (offline recording per doc 09 rules). For review-wrapped invoices it server-redirects to the owning Revenue Review screen (`RevenueReview.invoiceId @unique` lookup) so there is exactly one editing surface per document. Next.js static segments (`/billing/queue`, `/billing/invoices`, `/billing/my`, `/billing/reviews`) take precedence over `[id]` — no route collision. |
| Revenue Review screen | `/billing/reviews/[id]` | Owned by doc 03 §2.1; queue cards and tiles deep-link here. |
| Reports | `/reports` (existing) | Unchanged URL; doc 12 re-points the revenue math at snapshots. The dashboard links to each Revenue Report. |
| Executive page | `/executive` (existing) | Its revenue figures (currently `flightTime × current rate` — the 00 §7.4 violation) are re-pointed at the same `src/lib/revenue-dashboard.ts` engine functions as `/billing` tiles. One engine, two consumers, zero duplicated math. Consolidation of the two executive surfaces is a Part 3 question (§15). |

The dispatch board's client-side duplicated billing formula (00 §7.3) is replaced by the pricing-resolution preview endpoint (doc 05/22 territory) — noted here only so no dashboard figure is ever computed client-side.

---

## 4. Surface 1 — Executive Revenue Dashboard (`/billing`)

Layout order (doc 12 §2.8 binding: queue-first): ① attention strip → ② today tiles → ③ month tiles + footing strip → ④ dimension tiles → ⑤ report links. Every tile is a design-system `Card` with the figure, a one-line basis ("why"), and a drill-down link to the rows behind it.

### 4.1 "Approved" vs "collected" — precise definitions

These two words anchor the whole surface and are defined once, from statuses and ledger accounts only:

- **Approved (billed)** — the sum of `APPROVAL`-event `RevenueAllocation` sets (`dimension = REVENUE`, all categories including `TAX`), bucketed on `effectiveAt` in the organization's `timeZone`. An amount is "approved" the moment the doc 03 §2.6 approval transaction commits — the invoice total froze, allocations were written in the same tx. Equal by construction to Σ `RevenueReview.totalAtApproval` for reviews approved in the period (invariant R2/R7, doc 12 §2.6); the allocation query is the pinned source because the footing identity foots from it.
- **Collected** — the sum of `LedgerEntry` **debits** to `PAYMENT_CLEARING` + `CASH_ON_PREMISES`, bucketed on `effectiveAt`. Money is "collected" only when a settlement transaction wrote it: card capture (webhook-confirmed — review `CARD_PAID`/`PAID`), ACH **settlement** (never initiation — Part AB), or an offline cash/check/credit recording. **Decision: offline collections are included** — a Director of Operations asking "what came in today?" means all of it; the card-vs-ACH tile breaks out channels. ACH sitting in its ~4-business-day window is **not** collected; it is the ACH Pending tile.

Neither figure is ever derived from `Invoice.status`, `Payment` rows joined at render time, client redirects, or current rates. Approved comes from allocation snapshots; collected comes from the ledger. That is what makes the numbers trustworthy enough to read to an accountant over the phone.

### 4.2 Metric → query map

Every spec Part Z metric, its exact source, and the doc 13 index it rides. All period bucketing is `effectiveAt` in `Organization.timeZone` (the one exception, Tax Collected, lives in doc 12's report set, not on the dashboard). All aggregation is SQL (`aggregate`/`groupBy`) over Decimal — never `findMany`-then-float-sum (the 00 §7 defect this surface retires).

| Spec metric | Definition & source query | Index (doc 13) | Drill-down |
|---|---|---|---|
| Today's approved revenue | Σ `RevenueAllocation.amount` where `event = APPROVAL`, `dimension = REVENUE`, `effectiveAt` in org-tz today | `[organizationId, effectiveAt]` | Reviews approved today (`[organizationId, status]` + `approvedAt` filter) |
| Today's collected revenue | Σ `LedgerEntry.amount` where `account IN (PAYMENT_CLEARING, CASH_ON_PREMISES)`, `direction = DEBIT`, `effectiveAt` today; sub-line: offline portion (`CASH_ON_PREMISES`) | `[organizationId, account, effectiveAt]` | Settled `Payment` rows today (`[organizationId, paidAt]`, R19) |
| Revenue this month | Both figures above, MTD, shown as a **pair** — Billed MTD and Collected MTD are never conflated into one "revenue" number | same | Revenue by Period report |
| Revenue by aircraft | `groupBy` APPROVAL allocations MTD joined `RevenueAllocation → RevenueReview.aircraftId`; top 5 + "view report" | `[organizationId, effectiveAt]` + `[revenueReviewId]` | Revenue by Aircraft report (doc 12) |
| Revenue by instructor | Same join on `RevenueReview.instructorId`, category `INSTRUCTOR_SERVICE_REVENUE` shown beside total billed | same | Revenue by Instructor report |
| Revenue by program | Same rows, program resolved per §4.3 | same | Revenue by Program report |
| Revenue by location | Same join on `RevenueReview.locationId` | same | Revenue by Location report |
| Revenue by airport | Location dimension displayed by `Location.icao` (§4.3) | same | Revenue by Location report, airport grouping |
| Card versus ACH | `groupBy Payment.method` of settled payments MTD → Card / ACH / Offline (CASH, CHECK, ACCOUNT_CREDIT, GIFT_CERTIFICATE) with amounts and counts | `[organizationId, paidAt]` | Payment list filtered by method |
| Pending Revenue Reviews | Counts by status for statuses 1–4 (`DRAFT`, `AWAITING_INSTRUCTOR_REVIEW`, `AWAITING_OPERATIONS_REVIEW`, `CHANGES_REQUESTED`); second line: Approved awaiting collection (`APPROVED`, `PAYMENT_SCHEDULED`, `PAYMENT_PROCESSING`) with Σ `totalAtApproval` | `[organizationId, status]` | Queue (§5), pre-filtered |
| Failed payments | Count of reviews `status = PAYMENT_FAILED` + Σ derived Amount Due (ADR-035, computed per review over the bounded set) | `[organizationId, status]` | Queue → Payment failed |
| ACH pending | Count of reviews `status = ACH_PENDING` + Σ in-flight `PaymentAttempt.amount` (`status = PROCESSING`, `methodType = US_BANK_ACCOUNT`) with oldest expected-settlement date | `[organizationId, status]`; attempt `[organizationId, status, createdAt]` | Queue → ACH pending |
| Refunds | Σ signed `REFUND`-event allocation sets MTD (drill-down to succeeded `Refund` rows) | `[organizationId, effectiveAt]`; Refund `[organizationId, status]` | Refund list (doc 26 surface) |
| Platform fees | Σ `PlatformFee.amount − reversedAmount` where `status IN (EARNED, PARTIALLY_REVERSED)`, bucketed on `earnedAt` MTD (doc 13 binding: earned-by-period buckets on `earnedAt`, never `createdAt`) — org-transparent per doc 12; labeled "AeroOps platform fee", never conflated with Stripe processing cost (spec Part W) | `[organizationId, status]` | Platform Fee Statement report |
| School retained revenue | Σ `PROCEEDS`-dimension allocations, `category = SCHOOL_RETAINED_REVENUE`, MTD | `[organizationId, category, effectiveAt]` | Revenue by Period report, net-to-school column |
| Instructor compensation liability | `INSTRUCTOR_COMP_PAYABLE` ledger balance (credits − debits, all time) — the true "what we owe instructors right now"; sub-lines by `InstructorEarning.status` (`PENDING` / `APPROVED` / `EXPORTED`, reversals netted) | `[organizationId, account, effectiveAt]`; earnings `[organizationId, status]` | Instructor Compensation report (doc 29); rows visible only with `revenue.compensation_view` |

**Attention strip** (above the tiles, rendered only when non-empty): open `ReconciliationException` count (`[organizationId, status]`), reviews `DISPUTED`, pending compensation-reversal proposals (doc 12 §6), and stuck attempts flagged by the doc 23 reconciliation pass. Each links to its owning queue/surface. Money problems are never buried below the fold.

**Footing strip** (doc 12 §2.8 binding, shown under the month tiles): `Billed + Adjustments − Collected = Δ Outstanding` with all four figures displayed so the identity can be checked by eye — Adjustments = signed Σ of `ADJUSTMENT`+`VOID`+`WRITE_OFF` sets MTD; Outstanding = `ACCOUNTS_RECEIVABLE` balance with aging buckets. If the continuously-checked invariant (R7) is violated, the strip renders in `destructive` tone with a link to the reconciliation queue — the dashboard never papers over a broken identity.

### 4.3 Dimension resolution (aircraft / instructor / program / location / airport)

Dimensions are resolved **at read** by joining allocations → `RevenueReview` foreign keys (doc 12 §2.8 / doc 28) — never stored on the allocation row, never recomputed from current config:

- **Aircraft / instructor / location** — direct `RevenueReview.aircraftId / instructorId / locationId` (SetNull FKs: a deleted aircraft leaves rows attributed to "Unattributed (removed aircraft)", never dropped from totals).
- **Airport** — `Location.icao` of the review's location (fallback: location name with an "add ICAO" nudge for settings holders). Multi-airport attribution from `Dispatch.airportsVisited` is deferred (§14) — landing-fee revenue by visited airport is a report enhancement, not a launch tile.
- **Program** — deterministic chain, first match wins: (1) `review.dispatchId → Dispatch.scheduleEventId → ScheduleEvent.syllabusLessonId → SyllabusLesson → Syllabus`; (2) the student's single `ACTIVE SyllabusEnrollment` covering `flightDate` — if exactly one; (3) **Unattributed**. Ambiguity never guesses (ADR-030 spirit); the Unattributed bucket is always shown when non-zero so totals foot to 100%.

Every dimension tile shows top 5 MTD + an explicit "Unattributed" row when non-zero + a link to the full doc 12 report. Charts follow the design-system chart spec (Recharts, `ResponsiveContainer` in `h-60` `CardContent`, theme-aware series pairs, muted 10px ticks, compact `$1.2k` formatters).

### 4.4 Read-path architecture

1. Server component (`src/app/(app)/billing/page.tsx`) resolves the session (`billing.view` + `billing` module gate) and org `timeZone`.
2. Calls `src/lib/revenue-dashboard.ts` engine functions — each returns `{ figure, currency, basis, drillDownHref, asOf }`. Period-boundary math (org-tz day/month edges), urgency scoring (§5.2), program resolution, and the footing check are **pure, framework-free functions** contract-tested like `billing.ts`; the query layer is thin typed wrappers over `db.groupBy/aggregate`.
3. All queries are org-scoped from the session, bounded, and index-backed (§4.2 column). No unbounded `findMany`; per-review derived figures (Amount Due) compute only over already-bounded queue sets.
4. **No async hops in the read path.** The dashboard is server-rendered truth as of render time (`asOf` timestamp shown as "As of 14:32 local · Refresh"). No SSE/polling in Part 2 (§14): after the payment runner (post-commit hop, doc 22) and the webhook reduce (async, doc 23) commit, the next render reflects them. An honest slightly-stale number beats a fake-live one; nothing on this page pretends a charge settled before the webhook said so (Part AB).

---

## 5. Surface 2 — Operations revenue queue (`/billing/queue`)

The daily working surface. One page, tabbed queues, org-scoped from the session, engine-scoped per role (instructors see own reviews only — doc 03 §6.1). Defaults to the **active location** (house rule: location-sensitive surfaces respect the `aerops-location` cookie) with an "All locations" toggle; the toggle state is a URL param so links shared between staff mean the same thing.

### 5.1 Queue matrix

All queues query `[organizationId, status]` (doc 13) with bounded `take` (50, oldest-first, paginated); flag-based queues filter `riskFlags` in SQL over the already-status-bounded set — active-review counts at real schools are tens, not thousands, so no new index is required (revisit in doc 34 only if telemetry disagrees).

| Spec queue | Predicate | Default sort | Actions in context (permission) |
|---|---|---|---|
| Draft reviews | `status = DRAFT` | oldest-first | Open · Submit (`revenue.review_submit`) · Edit charges (`revenue.review_edit`) · Void with reason (`revenue.void`) |
| Awaiting instructor | `status = AWAITING_INSTRUCTOR_REVIEW`; **overdue** chip after `instructorReviewReminderHours` (default 48) | oldest-first | Remind instructor · **Submit on instructor's behalf, reason required** (`revenue.review_edit`, doc 03 §2.11) |
| Awaiting Operations approval | `status = AWAITING_OPERATIONS_REVIEW`, split **Needs my approval** / **Awaiting another approver** (doc 03 §2.7 — session user vs missing approval kind) | oldest-first within split | Open · **Approve-from-card** (routine per doc 03 §2.5 only) · **Bulk approve** (routine only, per-review claims — §5.3) · Request changes with reason (`revenue.approve`) · Escalate for second approval |
| Changes requested | `status = CHANGES_REQUESTED`; card shows the reason + "Resubmitted after changes" chip on return (doc 03) | oldest-first | Open (instructor path: correct & resubmit — `revenue.review_submit`) |
| Missing payment method | active pre-payment statuses (1–5) AND readiness reason `MISSING_PAYMENT_METHOD` (riskFlag / doc 09 §5.2 readiness engine) | approval-imminent first (status 3 before 1) | Request method from payer (doc 31 notification) · Select saved method (`revenue.payment_methods_manage`) · Switch to Manual Invoice (`revenue.charge`) |
| Payment failed | `status = PAYMENT_FAILED`; card shows safe `failureCode`/`failureMessage` from the latest `PaymentAttempt` (never raw provider errors — spec Part U) and hard-decline markers (no-retry) | oldest failure first | Retry charge (`revenue.charge`, doc 22 — blocked while an attempt is in flight) · Re-point method in `FAILED` (`revenue.payment_methods_manage`, audited) · Record offline payment (`billing.record_payments`) · Escalate per org failure policy (doc 25) |
| ACH pending | `status = ACH_PENDING`; card shows initiation date + expected settlement window (~4 business days, doc 09) and days elapsed | oldest-first | None (informational — deliberately action-free; the only exit is the webhook). Stale beyond `reconciliationStalePaymentDays` → exception chip |
| High-value review | active statuses (1–5) AND (`OVER_THRESHOLD` riskFlag OR `secondApprovalRequired`); threshold = `RevenueWorkflowPolicy.secondApprovalAmountThreshold` — *simpler-workflow choice:* the high-value queue reuses the second-approval threshold rather than adding a separate knob; one number to configure, one meaning of "high-value" | largest total first (the exception queue where amount outranks age) | Open · missing-approval-kind chips ("Awaiting second approval — total exceeds $2,500") |
| Manual items requiring approval | active statuses AND riskFlags ∩ {`MANUAL_ITEM`, `DAMAGE_FEE`} | oldest-first | Open (second-approval flow per doc 03; damage-fee adder-never-sole-approver rule surfaces as a card chip) |

A review can appear in multiple queues (a failed payment can also be high-value); the tab badges therefore show per-queue counts, and the "All needing attention" default tab de-duplicates by review, ordered by urgency (§5.2).

### 5.2 Urgency & sort rules

- **Within a queue: oldest-first, always** (doc 03 §2.11 binding), except High-value (largest-first). Every card carries a days-in-status age chip; age ≥ 7 days renders the chip in `warning` tone.
- **Across queues** (the "All needing attention" tab), fixed priority: ① Payment failed (money already promised and not collected) → ② Missing payment method with approval imminent → ③ Needs my approval → ④ Changes requested → ⑤ Awaiting instructor (overdue only) → ⑥ Draft older than 24h → ⑦ everything else. ACH pending never ranks as urgent — it is normal physics, not a problem, and teaching operators that distinction is part of the design.
- Filters: risk flag ("show me everything with a discount"), aircraft tail, instructor, student, payer, amount band. Filters compose with the location toggle; all are URL params.

### 5.3 Actions in context — transaction boundaries

Queue actions are thin wrappers over sibling-owned routes; the queue never grows its own mutation semantics:

1. **Approve-from-card / bulk approve** — routine reviews only (doc 03 §2.5). The server re-verifies routineness and claims **each review individually** with its own `updatedAt` token + `expectedTotal` (doc 03 §2.10) — one stale review 409s alone with its reason inline on the card; the rest proceed. Each approval runs the full doc 03 §2.6 transaction **(tx)**; the charge itself is a post-commit hand-off to the payment runner **(async hop, doc 22)**; the card flips to `PAYMENT_PROCESSING` only when the runner's claim commits, and to Card Paid/Paid only after the webhook reduce **(async hop, doc 23)**. The button carries the consequence-truthful verbatim wording per timing policy ("Approve Revenue Review and charge the saved payment method") — a bare "Approve" is a design failure (doc 03).
2. **Retry charge** — `POST` to the doc 22 retry route: guarded `updateMany` claim on the `ScheduledCharge`, new `PaymentAttempt` with incremented `attemptNumber` **(tx)**, provider call post-claim with deterministic idempotency key **(async)**. The queue disables the button while any attempt is `CREATED`/`PROCESSING` (reconcile-then-proceed, never a parallel attempt) and for hard declines (method `SUSPENDED`).
3. **Submit on instructor's behalf / request changes / void / select method** — doc 03/09-owned routes; every mutation `authorize({mutating:true})` + `recordAudit` + post-commit `emitDomainEvent`. Read-only impersonation hides all mutating controls (UI) and is refused at the route (gate) — both, not either.

### 5.4 Card anatomy

One card = one Revenue Review (doc 03 §5 card contract, restated for the queue): review number `RR-1042`, status badge (`STATUS_TONE`), tail number, student (payer chip when different — "Bill to: Acme Aviation Scholarship"), instructor, flight date, current total (or `totalAtApproval` once frozen), risk-flag chips, payment-readiness chip, age chip, and the context actions (§5.1). Tail number and total get typographic priority — a Chief Flight Instructor scans by aircraft and size, in that order. Cards are information-complete: approving from the card requires no click-through for routine reviews, which is the entire point of routineness.

---

## 6. Surface 3 — Student/payer view (`/billing/my`)

The answer to "what do I owe?" — a recorded ROADMAP deferral, closed here. Students and payers get **their own** financial story, complete and honest, and structurally nothing else.

### 6.1 What they see (own records only)

Identity resolution is server-side from the session, never from a client parameter: `session.userId → Student (userId @unique)` for students; payers reach the same view contract through the Part 3 `/payer` portal (`authorizePayer`, doc 11) scoped by `StudentPayerRelationship` capability flags (`canViewInvoices` gates invoice detail; `canManagePaymentMethods` gates method actions).

| Spec item | What renders | Source |
|---|---|---|
| Revenue Review summary | Their reviews, customer-facing status names verbatim (doc 03 §2.2), flight date, aircraft, line summary from `approvalSnapshot` once approved (point-in-time truth — never recomputed) | `RevenueReview` where `studentId` = own (`[organizationId, status]`, student filter); payer: where `payerId` = own |
| Invoice | The wrapped invoice's frozen lines and totals, itemized | `Invoice` + `InvoiceLine` via `review.invoiceId` |
| Payment status | Customer-facing status + plain-language ACH copy: "ACH payments typically take about 4 business days to clear" with the expected window (spec Part R display rules) | review status; latest attempt's safe method snapshot (`methodBrand`/`methodLast4`) |
| Receipt | In-app receipt per settled payment: receipt of payment for invoice `INV-…`, date, amount, method brand + last4, itemized breakdown from `approvalSnapshot`. PDF/email receipts deferred (doc 31 / Part 3) — the view never claims an email was sent | `Payment` rows via own invoices |
| Refund | Refund status and amount against the original payment ("$150.00 refunded to Visa •• 4242, May 3"), including refund-to-credit with remaining credit shown | `Refund` via own payments; `CustomerCredit` where holder = own |
| Amount due | **"Amount Due"** — verbatim vocabulary, never "account balance" (ADR-035) — derived at read per invoice: frozen total + APPLIED adjustment deltas − settled payments + succeeded refunds; itemized per review with a total across their open reviews | ADR-035 derivation over own invoices only |
| Payment method | Methods on file: safe metadata only (brand, last4, exp, bank name — the doc 13 closed allowlist), default marker, expiring-soon nudge. "Update payment method" launches the provider-hosted setup flow (doc 20) when `REVENUE_CHARGING=test` and the org enables self-service; otherwise shows "Contact your school to update your payment method" — the control never dead-ends silently | `PaymentMethodReference` via own `PaymentCustomer` |
| Payment history | Chronological settled payments, refunds, and credits applied, with receipts | own `Payment`/`Refund`/`CreditApplication` |

### 6.2 The never-show list — hard RBAC statements

Spec Part Z verbatim, each bound to its enforcement mechanism and its Part AB automatic-rejection condition:

| Never show | Enforcement | Part AB rejection it prevents |
|---|---|---|
| **School revenue** | The `/billing/my` page and its data loaders accept no org-wide query: every Prisma call in the self-view engine (`src/lib/revenue-self.ts`) is scoped `studentId`/`payerId` = session-resolved own identity. No aggregate function from `revenue-dashboard.ts` is importable into the self-view route (static source-scan test, dispatch-idempotency style: the self-view route file must not reference the dashboard engine module). | "Student can view organization revenue" |
| **Instructor compensation** | `InstructorEarning` is never selected by any self-view loader; the review serializer for students/payers omits allocation, compensation, and instructor-rate provenance fields entirely (allowlist serializer — fields enumerated, not blocklisted). | "Instructor can view another instructor's compensation without permission" (and students seeing any) |
| **Platform fee agreement** | `PlatformFee`/`PlatformFeePolicy` never appear in any self-view query or serializer; fee amounts are invisible in customer-facing breakdowns (spec Part W: hidden from students). | Platform-fee exposure |
| **Other customers** | Own-identity scoping (above) plus the house cross-tenant rule: any id in the URL not owned by the session identity → 404, indistinguishable from nonexistent. Payers see only students linked by an `ACTIVE` (or historically snapshotted) `StudentPayerRelationship`, and training records are never included (doc 11 privacy boundary — payers see money, not lesson content). | "Cross-tenant payment lookup" |
| **Organization-wide reports** | `/reports`, `/executive`, `/billing` (dashboard), `/billing/queue` remain gated by keys (`reports.view`, `billing.view`, `revenue.review_view`) that the STUDENT bundle does not hold; nav items disappear via `SECTION_PERMISSIONS`; direct navigation renders the permission-denied state. | Report exposure |

These are contract-tested (Part AC "student visibility restrictions", "tenant isolation"): a STUDENT session requesting the dashboard/queue/reports routes gets denied; a student's self-view response body is asserted to contain **no** `InstructorEarning`, `PlatformFee`, `RevenueAllocation`, or foreign-student identifiers.

### 6.3 Tone and honesty rules

Plain financial language, no jargon: "Amount Due", "Paid", "Refunded", "Payment didn't go through — please update your payment method" (customer-friendly failure copy, never raw decline codes — spec Part U). Every charge is itemized — a student who can see *why* the number is what it is calls the front desk less and trusts the school more. If a review is pre-approval, the view shows "Being prepared — your school is reviewing this flight's charges" with no editable anything; students never see drafts churn line-by-line.

---

## 7. How it works — sequences

**Dashboard read (no transactions, no provider calls):** session → engine functions (§4.4) → render. Period math pure; queries indexed; `asOf` shown.

**Queue action → money movement (by reference, boundaries marked):**

1. Operator clicks the consequence-truthful approve control on a routine card.
2. **(tx)** doc 03 §2.6 approval transaction: guarded claim → server-side Decimal recompute → freeze → snapshot → `ScheduledCharge` etc. Commit.
3. Post-commit: `recordAudit`, `emitDomainEvent('revenue_review.approved')`, payment-runner hand-off **(async hop)**.
4. **(tx)** runner claims the `ScheduledCharge` (guarded `updateMany`), appends `PaymentAttempt`. Commit. Provider call outside any tx with deterministic idempotency key **(async, doc 22)**.
5. Webhook arrives **(async hop, doc 23)**: **(tx)** unique-insert `PaymentProviderEvent` → guarded reduce → review `CARD_PAID`/`PAID`/`PAYMENT_FAILED`, `Payment` row, settlement ledger journal, `PlatformFee → EARNED`. Commit. Post-commit notifications (doc 31).
6. Next dashboard/queue/self-view render reflects the new truth. The student's view and the owner's tile change because the **same rows** changed — there is no separate "student truth".

---

## 8. Configuration surface

**Decision: this feature adds zero new configuration.** Every knob it responds to already exists (zero-setup principle 10 — a fresh org gets a correct dashboard with no setup):

| Consumed config | Owner | Effect here |
|---|---|---|
| `Organization.timeZone` | existing | "Today"/MTD bucket boundaries |
| `RevenueWorkflowPolicy.secondApprovalAmountThreshold` | doc 03 | High-value queue threshold (§5.1) |
| `RevenueWorkflowPolicy.instructorReviewReminderHours` (48) | doc 03 | Overdue-instructor chip + escalation surfacing |
| `RevenueWorkflowPolicy.instructorSeesOwnCompensation` (false) | doc 03/04 | Whether an instructor's own review cards show their comp line |
| `OrgPaymentPolicy.approveWithoutMethod` (WARN) | doc 09 | Missing-method queue severity (WARN: warning chip; BLOCK: approval disabled with reason) |
| `RevenueSettings` payer/credit settings | doc 13 R29 | Self-view credit display, payer capability surface |
| `reconciliationStalePaymentDays` (5) | doc 12 | ACH-pending stale chip / exception linkage |
| Platform-level | — | None. `PlatformFeePolicy` management and the Connect console are doc 27/19 platform surfaces; this dashboard only displays org-visible outcomes. |

---

## 9. Data model additions

**None — deliberately.** All three surfaces read models bound in [13-database-model.md](./13-database-model.md); adding tables for a dashboard would either duplicate snapshots or cache derivables, violating ADR-035/derive-at-read. Specifically rejected: dashboard-metrics cache tables (premature — §4.2 queries are index-backed aggregates over bounded data), saved dashboard-preference rows (deferred, §14), and a GIN index on `RevenueReview.riskFlags` (flag filters run inside status-bounded sets; flagged for [34-part2-database-additions.md](./34-part2-database-additions.md) only if real-volume telemetry demands it).

Non-schema data changes shipped with this surface:

- `src/lib/permissions.ts`: new key `revenue.self_view` ("View your own invoices, payments, and Amount Due") — added to the STUDENT default bundle; harmless for staff who also train.
- `src/lib/rbac.ts` `SECTION_PERMISSIONS`: `"/billing/queue": "revenue.review_view"`, `"/billing/my": "revenue.self_view"`; `src/lib/features.ts` `SECTION_MODULES`: both new hrefs → `billing`. (`/billing` keeps `billing.view`/`billing`.) Nav-config entries added for both (constitution test requires the mapping).
- `src/lib/session.ts` `MODULE_BY_PREFIX`: `revenue → billing` (doc 12 §6 requirement; lands with the first `revenue.*` route in Part 2/3 slices).
- `src/lib/status-colors.ts` `STATUS_TONE` additions (§13).

---

## 10. Validation & business rules

1. **Snapshots only.** No dashboard/report figure may read current rate/profile/config tables for money (doc 12 §2.8 binding). Contract test: `revenue-dashboard.ts` has no import/reference to pricing or rate-profile modules.
2. **Decimal end-to-end.** Aggregation happens in SQL over `Decimal` columns; engine functions pass `Prisma.Decimal` through to formatting. `formatCurrency` becomes currency-aware (record's ISO code — doc 12 §7); no `Number()` coercion of money in any new surface code.
3. **Bucketing.** Allocations/ledger bucket on `effectiveAt`; platform fees on `earnedAt`; payments on `paidAt` — never `createdAt` (doc 13 bindings quoted in §4.2).
4. **Amount Due derived, never stored** (ADR-035) — computed per invoice over bounded sets only; `Student.accountBalance` gets no new readers (deprecation schedule, doc 14).
5. **Footing identity displayed and checked** (§4.2); violation renders destructively and links to reconciliation — never hidden, never auto-"corrected" at render.
6. **Statuses are the only state source.** Tiles/queues key exclusively on `RevenueReviewStatus`, ledger accounts, and model statuses from doc 13 — never on `Invoice.status` projections for review-wrapped documents, never on provider objects.
7. **Bounded everything.** Every list `take`-bounded + paginated; every aggregate period-bounded; drill-downs inherit the filter that produced the figure, so the list a user lands on always sums to the tile they clicked.
8. **One engine.** `/billing` tiles, `/executive` revenue figures, and queue badge counts all call the same `revenue-dashboard.ts` functions — a figure may not be computed twice in two places (the 00 §7.3 client-duplication defect, prohibited by rule).

---

## 11. RBAC, approvals & audit

Data-driven keys only (never role names); module gate `billing` applies to all revenue surfaces via `SECTION_MODULES`/`MODULE_BY_PREFIX`.

| Surface / element | Required key(s) | Default holders (doc 03 §6.1 / doc 12 §6) |
|---|---|---|
| `/billing` dashboard page + money tiles + footing strip | `billing.view` | ACCOUNT_OWNER, SCHOOL_ADMIN, ACCOUNTANT |
| Platform-fee & school-retained tiles | `billing.view` (doc 12: org-transparent) — posture tension with spec Part W logged in §15 | same |
| Instructor-comp liability tile total | `billing.view`; per-instructor drill-down rows additionally `revenue.compensation_view` | OWNER/ADMIN/ACCOUNTANT |
| Reconciliation attention items | `revenue.reconciliation_manage` (hidden otherwise, not disabled) | OWNER/ADMIN/ACCOUNTANT |
| `/billing/queue` page | `revenue.review_view` (instructors: engine-scoped to own reviews) | ADMIN tiers, DISPATCHER, ACCOUNTANT, INSTRUCTOR (own) |
| Queue actions | Per-action keys exactly as doc 03 §6.1 / §5.1 tables here (`revenue.review_submit/review_edit/approve/approve_routine/approve_finance/void/charge/payment_methods_manage`, `billing.record_payments`) | per doc 03 |
| `/billing/my` self view | `revenue.self_view` (new, §9) — data additionally scoped to session identity; the key alone never exposes another person's rows | STUDENT |
| Payer portal view | `authorizePayer()` + relationship capability flags (Part 3, doc 11) | payers |
| Legacy `/billing/invoices`, `/billing/[id]` | `billing.view` / `billing.record_payments` (unchanged meanings) | as today |

Rules: tiles and actions a user lacks are **hidden, not disabled** — a Finance Manager's dashboard and a dispatcher's dashboard are different pages that never advertise inaccessible money. Read-only impersonation views everything its permission set allows but every mutating control is hidden and every route refuses `{mutating:true}` (constitution). No AI pathway may act from any of these surfaces (constitution rule 8).

**Audit:** dashboards are reads — no audit rows for viewing (consistent with house convention; the platform console decides separately for cross-org views). Every queue *action* is audited by its owning route (doc 03/09/22 audit actions). CSV export of any drill-down list rides `reports.export` and is audited by the export path.

---

## 12. Failure modes & edge cases

| Case | Behavior |
|---|---|
| Fresh org, zero reviews | Teaching empty states (design-system `EmptyState`): "No revenue activity yet — your first approved Revenue Review will appear here, from dispatch to payment." Queue: "Nothing needs attention. Reviews appear here when flights close." Never a bare "No data". |
| `REVENUE_CHARGING=off` | Tiles/queues render fully (they read local truth); charge-dependent actions (retry, approve-and-charge wording) degrade per doc 09 — manual invoice + offline recording still work; the approve control states the true consequence for the effective policy. |
| Webhook lag / ACH window | Reviews sit honestly in Payment Processing / ACH Pending with elapsed time; collected tiles exclude them (Part AB: ACH never treated as instant). Stale beyond policy days → `STALE_PENDING_PAYMENT` exception chip + attention strip. |
| Negative day/period | Refund-heavy periods legitimately show Collected < 0 or net-negative categories; figures render signed with tooltip provenance — never clamped to zero, never hidden. |
| Dimension row removed (aircraft sold, instructor departed) | SetNull FKs → "Unattributed (removed …)" bucket; totals still foot. |
| Mixed permissions | Partial tile sets render on a grid that reflows — no gaps, no "you can't see this" teasers. |
| Timezone edges | "Today" from `Organization.timeZone`; a review approved 23:59 local lands in the local day regardless of UTC. DST boundaries covered by the pure period-math contract tests. |
| Concurrent queue workers | Two operators approving the same card: second claim 409s (per-review guarded claim), card refreshes with "Already approved by J. Alvarez, 14:31" — reconciliation-toned, not error-toned; the outcome they wanted occurred. |
| Currency | Part 2 is single-org-currency; all tiles render the org currency explicitly (`$1,240.50 USD` in exports, symbol in UI). A mixed-currency journal is structurally impossible (one currency per journal); if encountered, the footing strip errors to reconciliation rather than summing across currencies. |
| Review with no student (rental/manual) | Self-views simply never include it; ops/executive surfaces show payer label per the bill-to chip. |
| Student who is also staff | Holds both `revenue.self_view` and staff keys → sees both My Payments and staff surfaces; identities never blend (five-identity separation, ADR-031). |

---

## 13. UX notes

- **Design system only** ([docs/design/DESIGN_SYSTEM.md](../../design/DESIGN_SYSTEM.md)): `Card`/`CardTitle` tiles, `PageHeader` (eyebrow "Revenue Engine"), `Badge` via `<StatusBadge>`/`statusToneOf()`, `EmptyState`, `Skeleton`, tokens only (`bg-primary`, `text-muted-foreground`, `text-destructive`, `text-success`) — never raw hex; charts per the design-system Recharts spec (§4.3). Density per the operations-console rhythm (compact rows, `space-y-4/5`, stat grids `gap-3/4`).
- **`STATUS_TONE` additions** (single-source rule; existing keys `DRAFT` gray, `APPROVED` green, `PAID` green reused — meanings compatible and never changed): `AWAITING_INSTRUCTOR_REVIEW: amber`, `AWAITING_OPERATIONS_REVIEW: blue`, `CHANGES_REQUESTED: orange`, `PAYMENT_SCHEDULED: blue`, `PAYMENT_PROCESSING: purple`, `CARD_PAID: green`, `ACH_PENDING: cyan`, `PAYMENT_FAILED: red`, `PARTIALLY_REFUNDED: amber`, `REFUNDED: gray`, `VOIDED: gray`, `DISPUTED: darkred`, `WRITTEN_OFF: black` (reserved). Doc 34/implementation slice lands them once for all Part 2 surfaces.
- **Light/dark parity** decided together, never retrofitted (do-not-break rule 7); chart series use theme-aware pairs; status hexes via `statusHex(status, mode)`.
- **Responsive/mobile**: tiles collapse to single column below `md`; the queue is designed one-handed — an instructor confirms time from the ramp, a CFI approves a routine review from the run-up area; bulk approve is desktop-oriented but not desktop-only. Bottom nav below `lg` as everywhere.
- **Loading**: route-level `loading.tsx` skeletons mirroring the tile grid and queue cards (`aria-busy`, matching responsive grid so nothing jumps). **Errors**: actionable inline states per section ("Couldn't load collected totals — Retry"); a failed tile never blanks the page. **Success**: quiet toasts ("Revenue Review RR-1042 approved — charging saved card"), no celebration.
- **Vocabulary**: customer-facing canon exactly (Revenue Dashboard, Revenue Review, Revenue Item, Payment Method, Payment Attempt, Instructor Compensation, Amount Due); dispatch/release/return/closeout — "check-in", "ticket", "account balance" are banned (AVIATION_STANDARDS.md, UX-gate). Plain-language allocation phrasing per doc 12 §7 ("Your school keeps $445.40"); operational people never see debits and credits — the ledger view lives behind the accountant-facing drill-down only.
- **Accessibility**: color never the sole carrier (chips carry text), figures carry `aria-label`s with full precision, keyboard path through queue cards and actions, focus-managed drawers per the `ui/drawer.tsx` contract.

---

## 14. Out of scope for Part 2 / deferred to Part 3

- **Payer portal rendering** of the §6 view contract (`/payer`, `authorizePayer` routes, invitation acceptance) — Part 3 per doc 11 §10. Part 2 ships the student in-app view and the view contract.
- **Financial Export / AccountingMapping UI** — Part 3 (doc 12 §2.7); the dashboard links to reports only.
- **Live tiles** (SSE/polling), saved dashboard preferences/custom report builder, spending alerts, statement PDFs, email receipts (no email adapter exists — seams audit), OVERDUE automation and dunning surfaces (doc 25/Part 3 scheduler), multi-airport landing-fee attribution (§4.3), consolidation of `/executive` revenue panels into `/billing` (§15 Q2), multi-currency display.
- **Platform Console cross-org revenue views** — doc 19/27 territory (`authorizePlatform`), never this org-facing surface.

---

## 15. Open questions

1. **Platform-fee tile visibility posture (Part W vs doc 12).** Doc 12 shipped the platform-fee tile as org-visible transparency under `billing.view`; spec Part W says the fee is "hidden from students unless legally or commercially required" (students never see it under either reading) but also implies commercial discretion toward org staff. Recommendation: keep doc 12's org-transparent tile for all `billing.view` holders — schools discovering the fee only on a payout statement is a trust failure. Needs owner confirmation because it touches AeroOps' commercial posture, not just UX.
2. **`/executive` consolidation.** Re-pointing keeps two executive surfaces (org-wide `/executive`, revenue-deep `/billing`). Fold `/executive`'s revenue panels into `/billing` in Part 3 and leave `/executive` operational-only? Recommendation: yes, after Part 2 telemetry shows which surface owners actually open.
3. **Student self-service method updates at GA.** §6.1 renders "Update payment method" only when the org enables self-service (doc 20's hosted setup); otherwise contact-your-school copy. Should GA default be self-service ON (payer convenience) or OFF (schools control the money conversation)? Recommendation: OFF by default, one org toggle owned by doc 20's consent design — but this is a customer-experience call the owner should make.

---

## Compliance note

Design only. Nothing here deploys, no live charges, no production email, Stripe test mode is the only environment referenced, and no Part 1 doc (00–16) is modified or weakened by this document.
