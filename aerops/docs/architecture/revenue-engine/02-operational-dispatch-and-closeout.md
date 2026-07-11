# Operational Dispatch & Closeout — the Revenue Engine intake workflow

> **Status:** Proposed — Phase 8 Part 1 · **Date:** 2026-07-10 · **Lead roles:** Dispatcher; Director of Operations; Maintenance Manager; Principal Software Architect at Stripe · **Part of:** Revenue Engine design set ([README](./README.md))

This document owns spec **Part A (Operational Aircraft Dispatch and Return)** and **"Operational Checkout Versus Financial Checkout"**. It designs how an aircraft is dispatched and returned, every field captured at each moment, the full validation matrix, duplicate prevention, and the strict split between operational closeout (immediate) and financial closeout (post-approval). The final data-model shapes are bound by [13-database-model.md](./13-database-model.md); the Revenue Review lifecycle after `DRAFT` is owned by [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md).

---

## 1. Purpose & scope

**In scope**

- Aircraft checkout capture (dispatch creation + release) and aircraft return capture (closeout) — every Part A field, mapped to existing `Dispatch` columns or proposed new ones.
- The validation matrix: hard blocks vs org-configurable warnings, exactly per Part A.
- Duplicate check-in prevention, duplicate Revenue Review prevention, and the duplicate-charge prevention chain.
- Evolution of today's one-transaction close (do-not-break rule 5 / ADR-011): the transaction now produces a **Draft Revenue Review wrapping a `DRAFT` `Invoice`** instead of a finalized `OPEN` invoice (ADR-025).
- Org-level configuration surface for capture options and warning behavior, with strong defaults.

**Out of scope (sibling docs)**: Revenue Review approval/locking/payment states ([03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md)); rate resolution internals ([05-aircraft-pricing-profiles.md](./05-aircraft-pricing-profiles.md)); instructor time entry and compensation ([04-instructor-time-and-rates.md](./04-instructor-time-and-rates.md)); the Revenue Item catalog ([06-revenue-items.md](./06-revenue-items.md)); the Responsible Payer model ([11-responsible-payers.md](./11-responsible-payers.md)); pre-flight financial restrictions ([10-checkout-restrictions.md](./10-checkout-restrictions.md)); binding schema and migration sequencing ([13-database-model.md](./13-database-model.md), [14-migration-plan.md](./14-migration-plan.md)).

### 1.1 Terminology decision (binding for every screen this design touches)

The Phase 8 spec says "aircraft check-in". `docs/aviation/AVIATION_STANDARDS.md` bans the word **check-in** in the product ("Never 'check-in', 'ticket', 'vehicle'…"), and the UX review gate auto-checks it. We resolve this without amending AVIATION_STANDARDS:

| Spec term | AeroOps term (UI, code, docs) | Backing concept |
|---|---|---|
| Aircraft checkout | **Dispatch** — prepare (`PENDING`) then **release** (`RELEASED`) | `Dispatch`, `dispatch.release` |
| Aircraft check-in | **Aircraft return / flight closeout** (`CLOSED`) | `Dispatch`, `dispatch.close` |
| Check-in actor | **Closeout actor** | `Dispatch.closedBy` + `AuditLog` |
| Check-in transaction | **Closeout transaction** | the ADR-011 `db.$transaction` |

Everywhere below, "closeout" is the spec's "check-in". Requirements transfer one-to-one. Customer-facing module vocabulary is unchanged: **Revenue Engine**, **Revenue Review**, **Revenue Item**.

### 1.2 Position: reuse `Dispatch`, do not invent `DispatchRecord`

The spec's Part L lists `DispatchRecord` / `AircraftCheckOut` / `AircraftCheckIn` as *candidate* concepts. AeroOps already has the real thing: `Dispatch` (prisma/schema.prisma ~L905), 1:1 with `ScheduleEvent`, with a live `PENDING → RELEASED → CLOSED | CANCELLED` machine, seeded fixtures in all states, and a regression-locked closeout transaction. We **extend `Dispatch`** with the missing capture fields and tenant scoping. A parallel model would duplicate an existing engine's job (an AI-CTO-gate automatic rejection) and orphan the seeded/demo/simulation call sites.

---

## 2. How it works — workflows and state machines

### 2.1 Dispatch lifecycle (unchanged states, richer capture)

```
PENDING ──release──▶ RELEASED ──closeout──▶ CLOSED
   │                                          │
   └──────────────── CANCELLED ◀──────────────┘ (never after CLOSED)

CLOSED (operational, immediate)  ⇒ creates  RevenueReview[DRAFT] + wrapped DRAFT Invoice (financial, reviewed later)
```

Three legal moments, per AVIATION_STANDARDS: a flight is *released*, flies, and is *closed out*. Phase 8 adds a fourth **financial** moment that deliberately happens later and elsewhere: Revenue Review approval and charging ([03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md)).

### 2.2 Checkout workflow (spec "aircraft checkout")

Today no API route creates `Dispatch` rows (seed/demo/simulation only) — checkout needs a real entry point.

**Step 1 — Prepare dispatch** (`POST /api/dispatch`, authorized by `dispatch.release`, `{mutating:true}`):

- Body: `scheduleEventId` (required). The route loads the `ScheduleEvent` **org-scoped from the session**, verifies it has an aircraft, has no existing dispatch (`scheduleEventId @unique` enforces 1:1 at the DB), and is in a dispatchable status (`SCHEDULED`).
- Creates `Dispatch` in `PENDING`, copying `organizationId` from the event, `locationId` from `ScheduleEvent.locationId` (fallback `Aircraft.locationId`), and `aircraftId/studentId/instructorId` from the event. `payerId` defaults from the student's default payer ([11-responsible-payers.md](./11-responsible-payers.md)) and may be changed before release by anyone holding `dispatch.release`.
- Walk-up rentals: the schedule route already creates `RENTAL` events; the dispatch board offers "New rental dispatch" which creates the event + dispatch together (event first, then dispatch — same request, one `$transaction`).
- Discovery-flight walk-ins: the dispatch board offers **"New discovery flight"** beside "New rental dispatch". It inline-creates a minimal customer record — a `Student` row with `status: DISCOVERY_FLIGHT`, name and contact only, self-pay (default-payer resolution lands on the person flying, [11-responsible-payers.md](./11-responsible-payers.md)) — then a `FLIGHT_LESSON` `ScheduleEvent` with the assigned instructor, then the dispatch, all in the same request and `$transaction` as the rental path. Pricing needs no dispatcher action: the `DISCOVERY_FLIGHT` student status derives the `discovery` customer type, so the org's Discovery Flight pricing profile resolves at closeout ([05-aircraft-pricing-profiles.md](./05-aircraft-pricing-profiles.md) §3.2).

**Step 2 — Release** (`POST /api/dispatch/[id]/release`, existing route, extended):

1. `authorize("dispatch.release", { mutating: true })`.
2. Org-scoped load; status must be `PENDING` (400 otherwise).
3. **Safety gates (hard, no override)**: `airworthinessOf()` → 409 with reason, exactly as today. Pre-flight financial restrictions (payment method missing, amount due threshold…) run here too but are a separate, org-configurable category designed in [10-checkout-restrictions.md](./10-checkout-restrictions.md) — financial checks never touch the safety path.
4. Extended zod payload (deltas from today in **bold**):
   - `fuelQty`, `oilQty` (existing; required only when `DispatchPolicy.captureFuelStatus/captureOilStatus` are on — defaults on, matching today),
   - `weatherAcknowledged: z.literal(true)`, `documentsVerified: z.literal(true)`, `instructorApproved`, `studentApproved` (existing),
   - **`squawksAcknowledged`**: must be `true` when the aircraft has open squawks (the response to a release attempt without it lists them),
   - **`hobbsOut` / `tachOut`** (optional): dispatcher-confirmed meter readings, prefilled from `Aircraft.currentHobbs/currentTach`. Today release silently snapshots the aircraft record; Part A wants the observed reading captured. If they differ from the aircraft record beyond tolerance, the `HOBBS_OUT_BELOW_RECORDED` / meter-drift warning fires (§5.2),
   - **`conditionOut`** (optional short text), **`intendedRoute`** (shown only when `DispatchPolicy.captureRoute` is on), **`releaseNotes`** (optional).
5. Single update: status `RELEASED`, `releasedAt`, `releasedBy` label, meters, `ScheduleEvent → DISPATCHED` (as today).
6. `recordAudit("dispatch.release", …)` post-write, as today.

### 2.3 Return & closeout workflow (spec "aircraft check-in")

`POST /api/dispatch/[id]/close` (existing route, extended). The dispatcher experience stays one screen, one primary action, under a minute:

1. `authorize("dispatch.close", { mutating: true })`.
2. Org-scoped load (via `organizationId` once backfilled; via `aircraft.organizationId` until then); status must be `RELEASED`.
3. Extended zod payload (deltas in **bold**): `hobbsIn`, `tachIn`, `landings`, `nightTime`, `instrumentTime`, `fuelAddedGal`, optional `squawk` (all existing) + **`oilAddedQt`**, **`airportsVisited`**, **`conditionIn`**, **`returnNotes`**, **`fees[]`** (`{revenueItemId, quantity?, amount?, note?}` — gated by `DispatchPolicy.captureAirportFees`), **`instructorTimeSuggestionAccepted?`**, **`overrides[]`** (`{code, reason}` — §5.3).
4. **Validation pass** (§5): hard blocks return 400/409 immediately; warnings are computed and either attached (WARN) or returned for acknowledgment (BLOCK mode without a matching override).
5. **The closeout transaction** (§2.4).
6. Post-commit: `recordAudit("dispatch.close", …)` (metadata now includes `revenueReviewId`, warning codes, overrides), `emitDomainEvent("flight.closed", …)` (payload additively gains `revenueReviewId`), and a new `emitDomainEvent("revenue_review.created", …)` — both registered in `WEBHOOK_EVENTS` with these live emit sites (constitution-tested).
7. Response: `{ dispatch, flightTime, revenueReview: { id, number, status: "DRAFT", estimatedTotal } }` — the total is labeled an estimate; nothing has been billed.

### 2.4 The closeout transaction — how do-not-break rule 5 evolves

Today's rule 5 reads "meters + ledger + invoice in one tx". The invariant we actually protect is: **a flight that closes out updates its operational records and produces exactly one financial intake record, atomically — or fails whole.** Phase 8 keeps that invariant and changes what the financial intake record *is*: a **Draft Revenue Review wrapping a `DRAFT` `Invoice`**, created together in the closeout transaction (ADR-025), instead of a finalized `OPEN` invoice. This is a change to an ADR-decided pattern, so it ships behind a **superseding ADR to ADR-011** (proposed in the design set's ADR document) plus a CLAUDE.md rule-5 rewording in the same PR — never a silent edit. ADR-011's own "reconsider when" clause pre-authorizes the direction: slow external calls move post-commit onto the event bus, never into the transaction.

| | Today (`close/route.ts` L65–161) | Phase 8 |
|---|---|---|
| Atomic `RELEASED→CLOSED` claim via guarded `updateMany`, `count===0 → 409` | ✅ | ✅ **unchanged** (the shapes asserted by `tests/dispatch-idempotency.test.ts` are preserved; the test's invoice expectations change with an explicit contract-change note per do-not-break rule 10) |
| `ScheduleEvent → COMPLETED` | ✅ | ✅ unchanged |
| Aircraft meters (`currentHobbs/currentTach` set; `engineTimeSmoh/propTimeSpoh` incremented) | ✅ | ✅ + **monotonic guard** (§5.1 rule H10) |
| `Student.totalHours` / `soloHours` increments | ✅ | ✅ unchanged |
| `Student.accountBalance` decrement | ✅ | ❌ **moves to financial closeout** — Amount Due becomes derived from invoices/payments at approval time; the column stays maintained during transition (owned by [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) + [14-migration-plan.md](./14-migration-plan.md)) |
| `Invoice` + `InvoiceLine` creation at live rates | ✅ | ✅ **changed** — a **`DRAFT` `Invoice` + Draft `RevenueReview` are created together inside the closeout transaction** (ADR-025), with system-suggested `InvoiceLine` rows on the wrapped draft invoice; the invoice moves `DRAFT → OPEN` at approval (financial closeout), which freezes totals |
| Squawk / notification / `GROUNDED` on grounding severity | ✅ | ✅ unchanged |
| **`RevenueReview` create (`DRAFT`)** wrapping the draft `Invoice`, with operational snapshot, system-suggested lines, fee lines, warning annotations | — | ✅ **new, inside the tx** |

**Inside the transaction (all-or-nothing):** dispatch claim + capture fields → schedule event → aircraft meters (guarded) → student hours → squawks/notifications/grounding → **`DRAFT` `Invoice` + `RevenueReview` create (ADR-025)** with:

- an **operational snapshot** on the review (hobbs/tach out/in, elapsed, flight time, landings, aircraft/student/instructor/payer/location references, flight date) — point-in-time facts, not computed caches (the DATABASE_STANDARDS "derive at read time" rule gets an explicit snapshot carve-out in the superseding ADR);
- **system-suggested lines** as `InvoiceLine` rows on the wrapped draft invoice (review lines *are* `InvoiceLine` rows, [13-database-model.md](./13-database-model.md) §3 R1): aircraft rental priced by the pricing resolver ([05-aircraft-pricing-profiles.md](./05-aircraft-pricing-profiles.md)), a Hobbs-*suggested* instructor flight-instruction entry awaiting instructor confirmation ([04-instructor-time-and-rates.md](./04-instructor-time-and-rates.md)), fuel surcharge if configured;
- **fee lines** (`InvoiceLine`, origin `CHECK_IN`) from the `fees[]` payload, each referencing a Revenue Item ([06-revenue-items.md](./06-revenue-items.md));
- **warning annotations** (§5.2) copied from the validation pass so reviewers see them at approval.

The pricing resolver runs **pure and in-memory** on rows loaded before the transaction — no I/O, no network. Resolution can never come up empty ([05-aircraft-pricing-profiles.md](./05-aircraft-pricing-profiles.md) §3.3): a zero-configuration org is priced by the L6 virtual legacy profile (today's `Aircraft.hourlyRateWet` behavior) with a `LEGACY_FALLBACK` annotation, and an ambiguous same-level tie is priced by the deterministic tiebreak with an `AMBIGUOUS_RATE` annotation that **blocks Revenue Review approval, never closeout** ([03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md)). Either way the review is created with priced lines and the resolver's reasons snapshotted. Operational closeout can never fail for financial-configuration reasons.

**Explicitly, and non-negotiably:**

- **Operational closeout never waits on Stripe.** A delayed card or ACH response cannot delay a dispatcher.
- **No payment-provider calls of any kind happen inside the closeout (check-in) DB transaction** — no `PaymentIntent` creation, no customer lookup, nothing on the network. All payment work happens after Revenue Review approval, post-commit, behind the event bus / payment engine (Parts 2–3).
- **Closeout enqueues Revenue Review creation atomically with closeout**: the `RevenueReview` row and its wrapped `DRAFT` `Invoice` are created *inside* the same `db.$transaction` as the `RELEASED→CLOSED` claim. There is no window where a flight is closed but its review is missing, and no path that creates a review without closing the flight.

### 2.5 Operational vs financial closeout — the two-state contract

| | Operational closeout | Financial closeout |
|---|---|---|
| **When** | Immediately at valid aircraft return | Only after Revenue Review approval and payment processing |
| **Trigger** | `dispatch.close` API | `Approve Revenue Review and charge the saved payment method` ([03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md)) |
| **Updates** | Dispatch status · aircraft availability · Hobbs totals · Tach totals · maintenance counters (`engineTimeSmoh/propTimeSpoh`, `AircraftComponent` due tracking) · squawks · student lesson/hours records · instructor lesson records (suggested time entry) · flight completion (`ScheduleEvent → COMPLETED`) · location & utilization reporting (via `[organizationId, closedAt]` index) | Invoice status · payment status · Revenue Allocations · platform fee · Instructor Compensation · tax records (TaxSnapshot) · financial reports · receipt |
| **Blocking dependencies** | Meter validity, tenant scope, dispatch state — nothing financial | Approval chain, payment method, provider responses |
| **May be delayed by a card/ACH response?** | **Never** | By design (`ACH Pending`, `Payment Processing`) |

A flight can therefore be operationally complete for days while its Revenue Review is edited, submitted, and approved — the aircraft flies again immediately; the money follows its own reviewed path.

---

## 3. Configuration surface (org-level, strong defaults)

One optional row per organization. **No row = defaults below** — a fresh org works with zero setup (Product Principle 10). Edited via a zod-validated settings PATCH with before/after `recordAudit` (`org settings` route pattern). Per-location overrides are deferred to Parts 2–3.

`WarningMode`: `OFF` (don't evaluate) · `WARN` (attach to closeout + review, never block) · `BLOCK` (refuse until data is fixed or an authorized override with reason is supplied).

| Setting | Type | Default | Governs |
|---|---|---|---|
| `captureFuelStatus` | Boolean | `true` | Require fuel qty/status at release (existing behavior) |
| `captureOilStatus` | Boolean | `true` | Require oil qty/status at release (existing behavior) |
| `captureRoute` | Boolean | `false` | Show/require intended airport or route at release |
| `captureAirportFees` | Boolean | `true` | Show fee quick-add (airport/landing/ramp/parking) at return |
| `maxHobbsDeltaHours` | Decimal(6,1) | `15.0` | **Hard block** threshold: implausible Hobbs increase |
| `maxTachDeltaHours` | Decimal(6,1) | `15.0` | **Hard block** threshold: implausible Tach increase |
| `warnHobbsDeltaHours` | Decimal(6,1) | `8.0` | Warning threshold: unexpectedly long flight |
| `tachHobbsRatioMin` | Decimal(4,2) | `0.50` | Meter-mismatch band lower bound (tachΔ ÷ hobbsΔ) |
| `tachHobbsRatioMax` | Decimal(4,2) | `1.00` | Meter-mismatch band upper bound — tach accrues at or below clock rate, so tachΔ > hobbsΔ is almost always a mis-read or transposed entry and fires W1 by default |
| `durationOverScheduleHours` | Decimal(4,1) | `2.0` | Warning threshold: flight time over scheduled block |
| `meterMismatchMode` | WarningMode | `WARN` | W1 Large Hobbs/Tach mismatch |
| `unexpectedDurationMode` | WarningMode | `WARN` | W2 Unexpected duration |
| `missingInstructorTimeMode` | WarningMode | `WARN` | W3 Missing instructor time |
| `missingPayerMode` | WarningMode | `WARN` | W4 Missing payer |
| `missingPaymentMethodMode` | WarningMode | `WARN` | W5 Missing Payment Method |
| `unexpectedFeeMode` | WarningMode | `WARN` | W6 Unexpected airport fee |
| `maintenanceThresholdMode` | WarningMode | `WARN` | W7 Maintenance threshold crossing |
| `hobbsOutDriftMode` | WarningMode | `WARN` | W8 Release meter differs from aircraft record |
| `concurrentReleaseMode` | WarningMode | `BLOCK` | W9 Second simultaneous release of the same aircraft |

Defaults are deliberately warn-only for everything financial: the aircraft is physically back — refusing to record that fact is an operational cost an org must opt into (a blocked closeout leaves the dispatch `RELEASED` and the aircraft unavailable on the board, which is exactly the pressure that gets the data fixed).

---

## 4. Data model proposal (Prisma-flavored; binding shapes in [13-database-model.md](./13-database-model.md))

### 4.1 `Dispatch` — extended, not replaced

```prisma
model Dispatch {
  // ── existing fields unchanged (id, scheduleEventId @unique, aircraftId,
  //    studentId?, instructorId?, status, fuelQty, oilQty, checklist booleans,
  //    releasedAt, releasedBy, hobbsOut/In, tachOut/In, flightTime, landings,
  //    nightTime, instrumentTime, dualReceived, dualGiven, picTime,
  //    fuelAddedGal, closedAt) ──

  // Tenancy & context (Part A: Organization, Location, Responsible payer)
  organizationId     String?   // nullable in the DDL migration; backfilled from
                               // ScheduleEvent.organizationId (separate idempotent
                               // data migration); required in app code immediately,
                               // NOT NULL constraint tightened a release later
                               // (additive-only rule, DATABASE_STANDARDS L48-70)
  locationId         String?   // from ScheduleEvent.locationId, fallback Aircraft.locationId
  payerId            String?   // FK name per 13-database-model.md §3 R5; model owned by 11-responsible-payers.md

  // Checkout (release) capture
  conditionOut        String?
  squawksAcknowledged Boolean  @default(false)
  intendedRoute       String?
  releaseNotes        String?

  // Return (closeout) capture
  oilAddedQt       Decimal?  @db.Decimal(4, 1)
  airportsVisited  String?   // comma-separated identifiers, e.g. "KAVL, KGSP"
  conditionIn      String?
  returnNotes      String?
  closedBy         String?   // display label, mirroring releasedBy precedent;
                             // authoritative identity lives in AuditLog
  closeoutWarnings Json?     // point-in-time snapshot: [{ code, mode, message,
                             //   overriddenBy?, overrideReason? }] — a fact of the
                             //   closeout, not a computed cache

  createdAt DateTime @default(now())   // existing rows backfill to migration time,
  updatedAt DateTime @updatedAt        // matching the 20260707200000 precedent

  organization    Organization?    @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  location        Location?        @relation(fields: [locationId], references: [id], onDelete: SetNull)
  payer           ResponsiblePayer? @relation(fields: [payerId], references: [id], onDelete: SetNull)
  revenueReviews  RevenueReview[]   // partial-unique: at most one non-VOIDED (13 §3 R4)

  @@index([organizationId, status])      // dispatch board, review queues
  @@index([organizationId, closedAt])    // utilization & location reporting
  // existing @@index([status]) retained (additive-only)
}
```

Notes: fees captured at return are **not** `Dispatch` columns — they become draft `InvoiceLine` rows (origin `CHECK_IN`) on the review's wrapped draft `Invoice` (financial data lives on the financial record). `landings` already satisfies "landing-count data"; a day/night split is deferred (AVIATION_STANDARDS gap list). `hobbsOut/tachOut` stay the release-time snapshot but become dispatcher-confirmable.

### 4.2 `RevenueReview` — skeleton (full definition: [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) + [13-database-model.md](./13-database-model.md))

Only the fields this workflow creates and the constraints that enforce duplicate prevention are specified here:

```prisma
model RevenueReview {
  id             String              @id @default(cuid())
  organizationId String
  number         String              // per-org sequence, e.g. RR-1042, allocated from OrgSequence
                                     // inside the creating transaction (13 §3 R3 — no Date.now() generators)
  invoiceId      String              @unique  // ← the wrapped backend Invoice: required 1:1, FK on the
                                     //   review, onDelete: Restrict; DRAFT Invoice created in the same
                                     //   closeout transaction (ADR-025, 13 §4.4)
  dispatchId     String?             // ← DB-level duplicate-Revenue-Review prevention (13 §3 R4):
                                     //   at most one *active* review per dispatch via partial unique
                                     //   index (raw SQL): CREATE UNIQUE INDEX
                                     //   "RevenueReview_dispatch_active_key" ON "RevenueReview"("dispatchId")
                                     //   WHERE status <> 'VOIDED'
  status         RevenueReviewStatus @default(DRAFT)   // enum owned by 03-revenue-review-lifecycle.md
  currency       String              @default("USD")   // ISO 4217; per 13-database-model.md

  // Operational snapshot — point-in-time facts copied at creation, refreshed only by
  // the audited pre-approval meter correction (§5.5), so the financial record survives
  // dispatch/schedule deletion and, once approved, later meter corrections
  flightDate   DateTime?
  hobbsOut     Decimal?  @db.Decimal(9, 1)
  hobbsIn      Decimal?  @db.Decimal(9, 1)
  tachOut      Decimal?  @db.Decimal(9, 1)
  tachIn       Decimal?  @db.Decimal(9, 1)
  flightTime   Decimal?  @db.Decimal(6, 1)
  landings     Int?
  aircraftId   String?
  studentId    String?
  instructorId String?
  payerId      String?
  locationId   String?
  warnings     Json?     // reviewer-facing copy of closeout warning annotations

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  invoice      Invoice      @relation(fields: [invoiceId], references: [id], onDelete: Restrict)
  dispatch     Dispatch?    @relation(fields: [dispatchId], references: [id], onDelete: SetNull)
  // no `lines` relation: review lines ARE InvoiceLine rows on the wrapped
  // draft Invoice (13 §3 R1) — there is no separate RevenueReviewLine model

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([organizationId, number])
  @@index([organizationId, status, createdAt])   // review queues
}
```

`dispatchId` is `SetNull`, not `Cascade`: today deleting a `ScheduleEvent` cascades its `Dispatch` away — a financial record must survive that (hence the operational snapshot). App-level guard (Part 2): schedule-event deletion is refused once its dispatch is `CLOSED`.

Review lines are `InvoiceLine` rows on the wrapped draft `Invoice` — there is no separate review-line model (13 §3 R1; field set owned by [06-revenue-items.md](./06-revenue-items.md)/[13-database-model.md](./13-database-model.md)). For this workflow `InvoiceLine` needs: the `origin` discriminator (`RevenueLineOrigin { PRICING, INSTRUCTOR_TIME, RULE, CHECK_IN, MANUAL, ADJUSTMENT }`, 13 §3 R2), an optional `revenueItemId`, and rate-provenance fields from the pricing resolver.

### 4.3 `DispatchPolicy` — org configuration row (§3)

```prisma
enum WarningMode { OFF WARN BLOCK }

model DispatchPolicy {
  id             String  @id @default(cuid())
  organizationId String  @unique          // tenant-scoped one-row config, OrgRole/LessonType pattern
  // capture toggles + thresholds + one WarningMode column per warning, exactly as §3
  // (captureFuelStatus, captureOilStatus, captureRoute, captureAirportFees,
  //  maxHobbsDeltaHours, maxTachDeltaHours, warnHobbsDeltaHours,
  //  tachHobbsRatioMin, tachHobbsRatioMax, durationOverScheduleHours,
  //  meterMismatchMode, unexpectedDurationMode, missingInstructorTimeMode,
  //  missingPayerMode, missingPaymentMethodMode, unexpectedFeeMode,
  //  maintenanceThresholdMode, hobbsOutDriftMode, concurrentReleaseMode)
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### 4.4 `Invoice` — the wrapped draft invoice (binding call in [13-database-model.md](./13-database-model.md))

No new `Invoice` column is needed for the review↔invoice link: the 1:1 lives on **`RevenueReview.invoiceId String @unique`** (required, `onDelete: Restrict` — 13 §4.4), pointing at the `DRAFT` `Invoice` created in the same closeout transaction (ADR-025). At most one invoice per Revenue Review — the second link in the duplicate-charge chain — is enforced by that unique FK plus the invoice being created nowhere else.

Migration sequencing (per [14-migration-plan.md](./14-migration-plan.md)): DDL migration (new enums + nullable columns + new tables) → separate idempotent backfill (`Dispatch.organizationId` from `ScheduleEvent.organizationId`; ambiguous rows go to `scripts/migration-report.ts`, never guessed) → constraint tightening in a later release. New models join `org-snapshot.ts` capture/wipe/restore (reviews delete before invoices; both before students/instructors) and the seed in the same slice.

---

## 5. Validation & business rules

Engine home: a pure `src/lib/dispatch-validation.ts` (framework-free, contract-tested like `lib/billing.ts`), returning `{ blocks: [], warnings: [] }` with every entry carrying `code`, `message` (actionable, aviation-plain), and the values that triggered it — computed answers carry their reasons.

### 5.1 Hard blocks — never configurable, never overridable

| # | Rule (spec Part A "Prevent") | Enforcement point | Response |
|---|---|---|---|
| H1 | Hobbs In ≤ Hobbs Out | `flightTimeFromHobbs()` (existing) + zod | 400, message names both readings |
| H2 | Tach In ≤ Tach Out (when both recorded) | new engine check — **closes AVIATION_STANDARDS Gap #2** | 400 |
| H3 | Negative elapsed time | implied by H1/H2 (also guards `releasedAt > closedAt` clock skew) | 400 |
| H4 | Implausible increase beyond configured thresholds | `hobbsΔ > maxHobbsDeltaHours` or `tachΔ > maxTachDeltaHours` (§3; thresholds org-configurable, the block itself is not) | 400, message states the org's threshold |
| H5 | Duplicate check-in (concurrent double submit) | atomic `RELEASED→CLOSED` claim via guarded `updateMany`, `count === 0` aborts the tx (existing, regression-locked) | 409 "already closed" |
| H6 | Check-in against a dispatch already closed / cancelled / never released | status guard before the tx + the H5 claim inside it | 400 |
| H7 | Duplicate Revenue Review | partial unique index `ON "RevenueReview"(dispatchId) WHERE status <> 'VOIDED'` (13 §3 R4 — at most one *active* review per dispatch; a voided review stays replaceable) + creation happens only inside the H5-guarded transaction | structurally impossible; unique violation → 409 |
| H8 | Charging the same dispatch twice | the chain: one active review per dispatch (H7) → one invoice per review (`RevenueReview.invoiceId @unique`, created together in the closeout transaction) → idempotent Payment Attempt per approval ([03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md), Part 2) | structurally impossible at each hop |
| H9 | Cross-tenant aircraft / student / instructor / payer references | all loads org-scoped from `session.organizationId`; every body-supplied FK verified org-owned before use; cross-tenant ids are 404 (indistinguishable from nonexistent) | 404 |
| H10 | Aircraft meter regression (out-of-order closeouts silently rolling `currentHobbs` backward) | in-tx guarded `aircraft.updateMany({ where: { id, currentHobbs: { lte: hobbsIn } } })`; `count === 0` aborts | 409 with the recorded meter value and the next step: re-check the reading, or — if the *prior* closeout's entry is wrong — the post-close meter correction (§5.5) |
| H11 | Release of a non-airworthy aircraft (checkout side) | `airworthinessOf()` at release (existing) — safety, no override, no financial bypass | 409 |

### 5.2 Org-configurable warnings — exactly the spec's list

Evaluated at closeout (W8/W9 at release), attached to `Dispatch.closeoutWarnings` and mirrored onto the Draft Revenue Review so Operations sees them at approval. `WARN` never blocks; `BLOCK` refuses closeout until the data is corrected or an authorized override with reason is supplied (§5.3). Warnings are never silently dropped.

| Code | Trigger | Default | Category |
|---|---|---|---|
| W1 `METER_MISMATCH` | `tachΔ ÷ hobbsΔ` outside `[tachHobbsRatioMin, tachHobbsRatioMax]` | WARN | Operational |
| W2 `UNEXPECTED_DURATION` | `flightTime > warnHobbsDeltaHours`, or exceeds the scheduled block by `durationOverScheduleHours` | WARN | Operational |
| W3 `MISSING_INSTRUCTOR_TIME` | dual flight (`instructorId` set) closed with no instructor time entry/suggestion accepted | WARN | Financial |
| W4 `MISSING_PAYER` | a billable closeout resolves no payer; **suppressed** when there is no billable party by design (`MAINTENANCE_BLOCK` events, or no student and no payer — an audited non-revenue closeout note is recorded instead, Q4/D16) | WARN | Financial |
| W5 `MISSING_PAYMENT_METHOD` | resolved payer has no usable Payment Method on file ([11-responsible-payers.md](./11-responsible-payers.md)) | WARN | Financial |
| W6 `UNEXPECTED_FEE` | fee amount deviates from the Revenue Item default beyond its configured band, or a fee references an item not available at this location ([06-revenue-items.md](./06-revenue-items.md)) | WARN | Financial |
| W7 `MAINTENANCE_THRESHOLD` | this closeout pushes an `AircraftComponent` past due or within its warning threshold — also notifies maintenance (`Notification`) | WARN | Operational |
| W8 `HOBBS_OUT_DRIFT` | dispatcher-entered `hobbsOut/tachOut` at release differs from `Aircraft.currentHobbs/currentTach` (implies unrecorded time) | WARN | Operational |
| W9 `CONCURRENT_RELEASE` | releasing an aircraft that already has another `RELEASED` dispatch | **BLOCK** | Operational |

Design rules for warnings:

- **The aircraft is physically back.** Financial warnings (W3–W6) default to WARN and annotate the Revenue Review rather than block — the review workflow is where financial problems get resolved. Orgs *may* configure them to BLOCK (the spec requires the option), accepting that a blocked closeout leaves the dispatch `RELEASED` and the aircraft unavailable on the board.
- W7 never prevents accepting the aircraft back; a component going overdue affects the *next* release (airworthiness, H11), not this return. Maintenance is notified in the same transaction.
- Blocking behavior for warnings applies to **operational closeout completion only** — never to emergency or safety actions, and no warning category can weaken H1–H11.

### 5.3 Overrides for BLOCK-mode warnings

When closeout (or release, for W8/W9) is refused by a BLOCK-mode warning, the response is 409 `{ error, warnings: [{code, message}] }`. A user holding the new permission **`dispatch.override_warnings`** may resubmit with `overrides: [{ code, reason }]` (reason required, min length enforced). Each override is:

- snapshotted into `Dispatch.closeoutWarnings` (`overriddenBy` label + reason),
- mirrored onto the Revenue Review annotations,
- audited as `dispatch.warning_override` with old/new values (actor, code, reason) — impersonation attribution handled centrally by `recordAudit`.

Hard blocks (H1–H11) have no override path. A wrong reading committed at an earlier closeout is fixed through the post-close meter correction (§5.5), never a closeout override; genuine meter replacement/rollover remains a maintenance-side procedure (open question Q3).

### 5.4 Duplicate-charge prevention chain (summary)

```
one ScheduleEvent ──1:1 (scheduleEventId @unique)──▶ one Dispatch
one Dispatch ──guarded RELEASED→CLOSED claim──▶ closed exactly once
one Dispatch ──partial unique: dispatchId WHERE status <> 'VOIDED'──▶ at most one active Revenue Review
one RevenueReview ──RevenueReview.invoiceId @unique──▶ exactly one Invoice
one approval ──idempotent Payment Attempt (03 / Part 2)──▶ charged exactly once
```

Every hop is a database constraint or an atomic state-machine claim — not application convention.

### 5.5 Post-close meter correction (entry-error recovery)

H10's monotonic guard makes a fat-fingered `hobbsIn` sticky: once a too-high reading is committed at closeout, the aircraft's next legitimate return would violate the guard and become uncloseable. The recovery path is a first-class, audited action on the dispatch record — not a closeout override, and not a maintenance procedure ([03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) §2.1 already points corrections at the operational record; this is that flow):

- **`POST /api/dispatch/[id]/correct-meters`**, authorized by the new permission **`dispatch.correct_meters`** (`{mutating:true}`; default bundles: ACCOUNT_OWNER/SCHOOL_ADMIN via ALL — **not** in the DISPATCHER default bundle; orgs opt dispatchers or maintenance staff in via custom roles, mirroring `dispatch.override_warnings`).
- Applies to `CLOSED` dispatches. Payload: corrected `hobbsIn`/`tachIn` plus a **required `reason`** (min length enforced). H1/H2/H4 re-validate the corrected readings against the dispatch's `hobbsOut/tachOut`.
- **One `db.$transaction`**: update `Dispatch.hobbsIn/tachIn` and the re-derived `flightTime` → roll `Aircraft.currentHobbs/currentTach` (and the `engineTimeSmoh/propTimeSpoh` increments) by the correction delta, guarded so the aircraft record only moves when this dispatch is the aircraft's most recent closeout → refresh the draft review's operational snapshot and **re-derive its priced `InvoiceLine` rows** through the same pure pricing resolver. `recordAudit("dispatch.correct_meters", …)` with old/new readings and reason.
- **Blocked once the review is approved** (409): approved invoice lines and totals are frozen ([03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md)); from that point the financial correction is an adjustment record ([08-adjustments-discounts-credits.md](./08-adjustments-discounts-credits.md)).
- This action corrects *entries*, not hardware. Genuine meter replacement/rollover — the meter itself changed — remains the maintenance-side procedure of open question Q3.

---

## 6. RBAC, approvals & audit

**Permissions** (data in `src/lib/permissions.ts`; never role-name checks):

| Key | Covers | Default bundles |
|---|---|---|
| `dispatch.release` (existing) | Prepare dispatch (`POST /api/dispatch`), release | DISPATCHER, INSTRUCTOR, admins |
| `dispatch.close` (existing) | Aircraft return & operational closeout | DISPATCHER, INSTRUCTOR, admins |
| `dispatch.override_warnings` (new) | Override BLOCK-mode warnings with reason | ACCOUNT_OWNER/SCHOOL_ADMIN (via ALL); **not** in the DISPATCHER default bundle — orgs opt dispatchers in via custom roles |
| `dispatch.correct_meters` (new) | Post-close meter correction with reason (§5.5) | ACCOUNT_OWNER/SCHOOL_ADMIN (via ALL); **not** in the DISPATCHER default bundle — orgs opt dispatchers/maintenance staff in via custom roles |

`dispatch.*` is not module-gated today; the Revenue Review it creates lives behind the `billing` module. If the org's billing module is disabled, closeout still completes operationally and skips review creation with an audited note — module gating must never strand an aircraft. No approvals happen in this workflow: approval authority, chains, and separation of duties are entirely [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md)'s territory.

**Audit** (every mutation, via `recordAudit`; trail immutable):

| Action | When | Metadata |
|---|---|---|
| `dispatch.create` (new) | Prepare dispatch | scheduleEventId, tailNumber, payer |
| `dispatch.release` (existing) | Release | + conditionOut, squawksAcknowledged, meter confirmations |
| `dispatch.close` (existing) | Closeout | tailNumber, flightTime, landings, squawk, **revenueReviewId, estimatedTotal, warning codes, overrides** (replaces `billed` — nothing is billed at closeout anymore) |
| `dispatch.warning_override` (new) | BLOCK override | code, reason, actor label |
| `dispatch.correct_meters` (new) | Post-close meter correction (§5.5) | old/new readings, reason, revenueReviewId |

**Events** (`WEBHOOK_EVENTS` additions with live emit sites, post-commit only): `flight.closed` (existing; payload additively gains `revenueReviewId`), `revenue_review.created` (new). Payment execution never rides the lossy in-process bus — it uses DB state machines + the BillingEvent-style idempotency pattern (Parts 2–3).

**Session rules**: all routes `{mutating:true}` so read-only impersonation and read-only API keys are refused; AI never mutates — dispatch and closeout always require a human.

---

## 7. UX notes — aviation-native, dispatcher-first

- **Vocabulary**: "Dispatch", "Release flight", "Return aircraft", "Close out flight". Never "check-in", never "ticket" (AVIATION_STANDARDS, UX-gate-enforced). The primary closeout action is **"Close out flight"** — today's "Close & bill flight" label is retired because closeout no longer bills.
- **The dispatcher is not an accountant** (Core Principle 1). The closeout card leads with what a line dispatcher actually does: meters (Hobbs In / Tach In, prefilled from `out + typical deltas` as today), landings, fuel/oil added, squawk. Fees are one tap of quick-add chips (Landing fee · Ramp fee · Airport fee — from the org's Revenue Items), with the item's default amount prefilled when the org has set one; otherwise the amount is entered at return (built-ins ship with empty default amounts, [06-revenue-items.md](./06-revenue-items.md) / D29). Financial fields never gate the flow; a solo return with zero extras is three fields and one button.
- **The estimate becomes a preview.** The live charge estimate on the closeout card is retitled **"Draft Revenue Review preview"** with the fixed caption: *"No one is charged at closeout. Charges are confirmed in the Revenue Review."* — financial consequence stays explicit (Core Principle 2), and the preview calls the same pure pricing resolver as the server so the numbers can't drift.
- **Warnings are inline, calm, and non-blocking by default**: amber annotations under the fields that triggered them, carried onto the Revenue Review. BLOCK-mode refusals show the reason and, for authorized users, an "Override with reason…" affordance. Errors state the next step ("Hobbs In 1,247.3 must exceed Hobbs Out 1,248.1 — check for a mis-read meter").
- After closeout, the success state links to the Draft Revenue Review ("RR-1042 created — awaiting instructor time") for users holding `revenue.review_view` (in the DISPATCHER default bundle, [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) §6.1); users without it simply see "Flight closed."
- Dispatch board keeps its three columns; the Closed Today column shows each flight's Revenue Review status chip. New statuses register in `STATUS_TONE` (`src/lib/status-colors.ts`) — single source, existing meanings untouched. Light + dark, mobile parity, loading/empty/error states as first-class.

---

## 8. Interactions with other Revenue Engine components

| Sibling doc | Contract with this workflow |
|---|---|
| [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) | Consumes the `DRAFT` review this transaction creates; owns `RevenueReviewStatus`, approval chains, locking, Payment Attempts, and the point where `Student.accountBalance`/Amount Due is affected |
| [05-aircraft-pricing-profiles.md](./05-aircraft-pricing-profiles.md) | Provides the pure rate resolver called (in-memory) during draft creation; returns profile, priority, provenance, and ambiguity warnings — snapshotted onto the review |
| [04-instructor-time-and-rates.md](./04-instructor-time-and-rates.md) | Receives the Hobbs-suggested instructor time entry created at closeout; instructor confirmation/edit happens there, never silently here |
| [06-revenue-items.md](./06-revenue-items.md) | Defines the Revenue Item catalog the `fees[]` payload references; per-item defaults drive W6 |
| [11-responsible-payers.md](./11-responsible-payers.md) | Defines `ResponsiblePayer` and default-payer resolution used at dispatch preparation; Payment Method presence feeds W5 |
| [10-checkout-restrictions.md](./10-checkout-restrictions.md) | Owns pre-flight financial restrictions evaluated at release (Part J); this doc only fixes the seam: safety blocks first, financial checks separate and never blocking safety actions |
| [13-database-model.md](./13-database-model.md) | Binding call on all model shapes, money/currency representation, the per-org `number` sequence, and index set |
| [14-migration-plan.md](./14-migration-plan.md) | Sequences the `Dispatch.organizationId` backfill, enum migrations, seed/org-snapshot updates, and the `accountBalance` transition |

---

## 9. Out of scope for Part 1 / deferred to Parts 2–3

- All implementation: routes, migrations, engine code, tests, seed fixtures (Part 2 slices, in the order DDL → backfill → engines → routes → UI).
- Payment execution, Stripe adapter, `PaymentIntent`/`PaymentTransaction`, receipts, Revenue Allocations, Instructor Compensation postings (Parts 2–3; financial closeout).
- Per-location `DispatchPolicy` overrides; location-aware fee defaults.
- Day/night landing split, approach counts, cross-country capture (existing AVIATION_STANDARDS gap, not Revenue Engine work).
- Tach-driven maintenance accrual (AVIATION_STANDARDS Gap #1): this design *captures and validates* Tach correctly (H2) but does not change which meter drives `AircraftComponent` intervals — current Hobbs-based behavior is conservative.
- A meter *replacement/rollover* workflow (maintenance-side; see Q3) — entry-error corrections are designed in §5.5, not deferred.
- Offline/degraded-network closeout capture.
- Simulation, demo-generator, and Import Center updates to produce Revenue Reviews (Part 2, alongside the seed).

## 10. Open questions

1. **Q1 — Threshold defaults.** Are `maxHobbsDeltaHours = 15.0` (hard block) and `warnHobbsDeltaHours = 8.0` right for the customer base? Long cross-countries and ferry flights can legitimately exceed 8.0; multi-day rentals can exceed 15.0. Product owner should confirm defaults and whether multi-day rentals need a distinct dispatch profile.
2. **Q2 — May financial warnings block operational closeout at all?** The spec requires org-configurable blocking; we recommend shipping W4/W5 (missing payer / Payment Method) as WARN-only in v1 and deferring their BLOCK option, because a blocked return keeps an aircraft "flying" in the system. Needs a product-owner call: honor full configurability now, or defer the financial BLOCK modes to Part 3?
3. **Q3 — Meter replacement/rollover.** H1/H2/H10 make backward meters impossible at closeout by design, and §5.5 handles wrongly *entered* readings. This question covers hardware only: when a Hobbs/Tach meter is replaced, who adjusts `Aircraft.currentHobbs/currentTach`, and through what audited maintenance procedure? (Recommend: `aircraft.manage`-gated meter-adjustment action with reason, designed with the Maintenance Manager in Part 2.)
4. **Q4 — Reviews for flights with no billable party** *(resolved per D16, [16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md))*. Maintenance runs, ferry flights, and demo flights have neither student nor payer — by design, not by data error. Closeout skips Revenue Review creation and records an **audited non-revenue closeout note** on the dispatch; **W4 `MISSING_PAYER` is suppressed** for these closeouts (`MAINTENANCE_BLOCK` events, or no student and no payer), mirroring the release-side auto-pass of financial checks in [10-checkout-restrictions.md](./10-checkout-restrictions.md) §3.3 — a recurring expected amber would train dispatchers to ignore warnings. An org opt-in requiring non-revenue reviews (utilization/cost completeness) remains a D16 follow-up.
5. **Q5 — Instructor-less closeout of dual flights.** When W3 fires and the org uses instructor-entered time (Part C), should the system still create the Hobbs-suggested instruction line (marked unconfirmed), or create no instruction line until the instructor acts? Proposed: create the suggestion (reviewers see something rather than nothing); needs Chief Flight Instructor input via the product owner.
6. **Q6 — Billing-module-disabled orgs.** Confirm the proposed behavior (closeout completes, no Revenue Review, audited note) versus refusing to enable dispatch without billing for revenue-bearing profiles.
