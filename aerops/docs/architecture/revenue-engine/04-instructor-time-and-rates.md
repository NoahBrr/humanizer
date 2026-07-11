# Instructor Time, Billing Rates & Compensation Rates

> **Status:** Proposed — Phase 8 Part 1 · **Date:** 2026-07-10 · **Lead roles:** Chief Flight Instructor; Independent Flight Instructor; Aviation Accounting Specialist; Financial Systems Architect · **Part of:** Revenue Engine design set ([README](./README.md))

Covers spec **Part C (Instructor Time)** and **Part E (Instructor Billing Rates and Compensation Rates)** — Part 1 deliverables 6 (instructor billing-rate design) and 7 (instructor compensation-rate design). Written for the engineers implementing Parts 2–3. The binding schema call for every model proposed here is made in [13-database-model.md](./13-database-model.md); this document states the intended shape and the reasons.

---

## 1. Purpose & scope

Today the platform has exactly one instructor money concept: `Instructor.hourlyRate Decimal(8,2) @default(65)` (prisma/schema.prisma ~L594), read live at dispatch closeout and billed to the student as `(flightTime + 0.5h) × hourlyRate` via the hardcoded `BRIEF_DEBRIEF_HOURS` pad in `src/lib/billing.ts`. There is no time-entry model, no time categories, no compensation concept, no effective dating, and no snapshot — changing the rate rewrites the meaning of historical reports.

This document designs three things:

1. **Instructor time entry** — instructors record their own instructional time, per category, on the Revenue Review generated at aircraft return; supervisors may override with a required reason; every post-submission change is audited.
2. **Instructor billing rates** — what the student or responsible payer is charged for instructor services, resolved from effective-dated, versioned, immutable **Instructor Rate Profile** records.
3. **Instructor compensation rates** — what the instructor earns, maintained as a structurally separate rate system (spec principle 6), snapshotted into append-only **InstructorEarning** rows at Revenue Review approval. Customer-facing name: **Instructor Compensation**.

Out of this doc's scope (owned by siblings): the Revenue Review state machine and approval transaction ([03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md)), aircraft pricing resolution ([05-aircraft-pricing-profiles.md](./05-aircraft-pricing-profiles.md)), how earnings feed Revenue Allocation and Financial Export ([12-revenue-allocation.md](./12-revenue-allocation-and-reporting.md)), final column types/precisions ([13-database-model.md](./13-database-model.md)), and migration/backfill sequencing ([14-migration-plan.md](./14-migration-plan.md)).

### Hard separation of billing and compensation (principle 6)

The customer billing rate and the instructor compensation rate are **separate records, separately resolved, separately permissioned, separately snapshotted**. Nothing in the engine ever derives one from the other implicitly. The single sanctioned linkage: an organization may *explicitly* configure a compensation rate line as a percentage of the resolved billing charge (`percentOfBilling`), and only when the org has enabled `allowCompensationLinkedToBilling` (default **off**). Even then, the computed dollar figure is snapshotted at approval — later billing-rate changes never reflow recorded compensation.

---

## 2. How it works — workflows and state machines

### 2.1 Time categories

One Postgres enum, `InstructorTimeCategory`, plus a free-text label for the custom case. Enum values ship in their own migration before any code uses them (DATABASE_STANDARDS.md two-step rule).

| Category (enum value) | Customer-facing label | Bills to customer by default | Compensable by default | Notes |
|---|---|---|---|---|
| `FLIGHT_INSTRUCTION` | Flight instruction | Yes | Yes | Hobbs-suggested (see 2.3) |
| `GROUND_INSTRUCTION` | Ground instruction | Yes | Yes | Subject to org minimum (see §3) |
| `PREFLIGHT_BRIEFING` | Preflight briefing | Yes | Yes | Replaces half of the hardcoded 0.5 h pad |
| `POSTFLIGHT_DEBRIEFING` | Postflight debriefing | Yes | Yes | Replaces the other half |
| `SIMULATOR_INSTRUCTION` | Simulator instruction | Yes | Yes | Maps to existing `LineItemKind.SIMULATOR_TIME` |
| `ORAL_PREPARATION` | Oral preparation | Yes | Yes | |
| `CHECKRIDE_PREPARATION` | Checkride preparation | Yes | Yes | |
| `STAGE_CHECK` | Stage check | Yes | Yes | |
| `GROUND_SCHOOL` | Ground school | Yes | Yes | |
| `ADMINISTRATIVE` | Administrative instruction time | **No** | Yes | Org overhead: compensable, not customer-billed |
| `CUSTOM` | Org-defined label | Yes | Yes | `customLabel` required; priced only if a matching rate line exists (see 2.5) |

Per-entry `billToCustomer` and `compensable` booleans carry these defaults and may be toggled pre-approval by users holding `revenue.time_override` (audited). This is how a school comps a debrief without deleting the record of the time.

### 2.2 Entry lifecycle

Time entries live on a Revenue Review (`revenueReviewId` required). They have no status column of their own — editability derives from the parent review's status plus one confirmation timestamp:

```
[review Draft / Awaiting Instructor Review]
  Suggested (source=HOBBS_SUGGESTED, confirmedByInstructorAt=null)
      │ instructor confirms / edits / deletes
      ▼
  Confirmed (confirmedByInstructorAt set)
      │ instructor submits the Revenue Review (03-revenue-review-lifecycle.md)
      ▼
[review Awaiting Operations Review / Changes Requested]
  Submitted — instructor edits only while review is Changes Requested;
              supervisors may edit/override any time WITH required reason
      │ review approved
      ▼
[review Approved and beyond]
  Locked — rows immutable; corrections only via adjustment records
           (08-adjustments-discounts-credits.md) + offsetting InstructorEarning rows
```

Who may do what, by review status:

| Review status | Instructor (own entries, `revenue.time_entry`) | Supervisor (`revenue.time_override`) |
|---|---|---|
| Draft / Awaiting Instructor Review | Create, edit, delete, confirm, add notes, submit review | Create, edit, delete (reason optional pre-submission, still audited) |
| Awaiting Operations Review | Read only | Edit / override / recategorize — **reason required** |
| Changes Requested | Edit own entries, correct rejected entries, resubmit | Edit / override — reason required |
| Approved → all later statuses | Read only | Read only — corrections via adjustments only |

The matrix applies identically to dispatch-generated and manually created (ground-only) reviews: the review's assigned instructor (`instructorId`) holds the instructor-column rights in every row (§2.3; [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md)).

Enforcement is not UI-only: every mutation runs a guarded `updateMany` keyed on the parent review's status inside the transaction (the dispatch-close claim pattern, `src/app/api/dispatch/[id]/close/route.ts` L71-88), so an edit racing an approval loses cleanly with a 409.

### 2.3 Seeding at aircraft return — Hobbs suggests, never silently sets

When operational closeout creates the draft Revenue Review (dispatch with an instructor), the engine seeds suggestion entries **inside the same operational transaction** (cheap DB writes only; no rate resolution, no Stripe — ADR-011 discipline):

- One `FLIGHT_INSTRUCTION` entry with `suggestedHours = dispatch.flightTime` (the Hobbs delta already computed by `flightTimeFromHobbs`), `source = HOBBS_SUGGESTED`, `confirmedByInstructorAt = null`.
- One `PREFLIGHT_BRIEFING` and one `POSTFLIGHT_DEBRIEFING` entry from org defaults (see §3). Defaults 0.3 + 0.2 h preserve today's 0.5 h `BRIEF_DEBRIEF_HOURS` total for continuity; orgs can zero them.

Behavior of the flight-time suggestion is org-configurable (`flightTimeSuggestionMode`):

| Mode | Behavior |
|---|---|
| `SUGGEST_CONFIRM` (default) | `hours` prefilled from Hobbs; entry cannot ride a review submission until the instructor confirms or edits it |
| `AUTO_FILL` | Org has explicitly opted into Hobbs determining flight-instruction time; entry is created confirmed, still editable and audited |
| `MANUAL_ONLY` | No prefill; `suggestedHours` still recorded for the divergence check |

`suggestedHours` is stored on the row — a point-in-time fact, not a computed cache — so the divergence rule (§5) stays reproducible after aircraft meters move on.

Ground-only sessions (ground school, oral prep) with no dispatch attach to a manually created Revenue Review. Per doc 03's flow, a manual review carrying an `instructorId` routes Draft → Awaiting Instructor Review exactly like a dispatch-generated one, and the assigned instructor holds the full time-entry rights of the §2.2 matrix. Instructors also get a creation path of their own: completing a ground-only `ScheduleEvent` auto-creates a draft review for it, so recording a ground session never requires an admin. Creation and routing are owned by [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md); the time-entry model here applies unchanged apart from seeding — no dispatch means no Hobbs suggestion entries.

### 2.4 Rate-profile lifecycle (both kinds)

`InstructorRateProfile` versions are immutable once approved. **Never overwrite historical rates.**

```
DRAFT ──approve (revenue.rates_approve / revenue.compensation_manage)──▶ APPROVED
  │                                                                        │
  └─ freely editable, never resolves                                       └─▶ ARCHIVED  (end-of-life; history intact, never resolves for new reviews)
```

Status is the shared `ProfileStatus { DRAFT, APPROVED, ARCHIVED }` enum (owned by [13-database-model.md](./13-database-model.md) R7, shared with `AircraftPricingProfile`). "Superseded" is a **derived read-time badge, never a stored status**: a version renders as superseded when a newer APPROVED version exists in the same family — storing it would be a re-synced computed value, which DATABASE_STANDARDS bans.

Permitted mutations on an APPROVED profile, exhaustively: status transitions above, and setting `effectiveTo` to a **future** date (ending a rate early). Retroactive changes are forbidden — the fix for "we charged the wrong rate last week" is a new version plus adjustment records on the affected reviews/earnings, never an edit. Everything else on an approved row is frozen; the engine rejects updates and the route never exposes them.

A "rate change" is therefore: duplicate current version → new `DRAFT` row (same `familyId`, `version + 1`) → edit → approve → the old version begins rendering as superseded once the new version's `effectiveFrom` arrives (derived at read, never stored — 13 R7/R8). Both versions remain queryable forever; historical Revenue Reviews keep resolving-time snapshots regardless.

### 2.5 Rate resolution for instructor charges

Runs when a Revenue Review is generated and re-runs on any edit that changes inputs (entry hours, category, instructor, program, location) **until approval freezes the snapshot**. It executes twice, independently: once for `kind = BILLING`, once for `kind = COMPENSATION`. Parallel in shape to aircraft pricing resolution ([05-aircraft-pricing-profiles.md](./05-aircraft-pricing-profiles.md)); one shared resolver core in the pricing engine.

Effective-dating is evaluated against the dispatch's operational closeout timestamp (the service date) in the org's `timeZone`, using half-open windows `[effectiveFrom, effectiveTo)`. Candidates must be `APPROVED`, effective, and currency-compatible with the review.

Resolution tiers, first tier with any candidate wins:

| Tier | Scope match |
|---|---|
| 1 | Explicit profile selected on the dispatch / Revenue Review by an authorized user |
| 2 | Program-specific + instructor-specific (`syllabusId` and `instructorId` both match) |
| 3 | Program-specific org default (`syllabusId` matches, `instructorId` null) |
| 4 | Location-specific + instructor-specific |
| 5 | Location-specific org default |
| 6 | Instructor-specific default (`instructorId` matches; no program/location scope) |
| 7 | Organization default (`instructorId`, `syllabusId`, `locationId` all null) |
| 8 | **Legacy fallback** (BILLING only): `Instructor.hourlyRate`, applied to every billable category, flagged `LEGACY` in the trace — a candidate only for instructors whose `hourlyRate` was explicitly set or who predate the [14-migration-plan.md](./14-migration-plan.md) backfill. An instructor still on the untouched schema default (the $65 nobody chose) produces no tier-8 candidate and falls through to the blocking "unpriced instructor time" warning. Transition aid only; retired per [14-migration-plan.md](./14-migration-plan.md) |

Within a tier, the shared resolver core applies the same tie-break chain as [05-aircraft-pricing-profiles.md](./05-aircraft-pricing-profiles.md) §3.3: more specific scope first (where scopes vary within a tier), then **lowest `priority` integer wins** (priority 1 outranks priority 100; default 100), then latest `effectiveFrom`, then earliest `createdAt`, then lowest `id` (fully deterministic). Candidates still tied after the priority step resolve deterministically **and** attach an `AMBIGUOUS_RATE` warning to the Revenue Review — never a silent guess. **An unresolved instructor-rate ambiguity — either kind, BILLING or COMPENSATION — blocks Revenue Review approval**: a reviewer clears it only by explicitly selecting a profile (an audited tier-1 selection) or by fixing the profiles' priorities and recalculating — identical semantics to doc 05 §3.3 / ADR-030, not org-configurable in Part 1: an ambiguous rate never becomes an approved financial fact. The same overlap check runs at profile-approval time so admins hear about ambiguity when they create it, not when it bills someone.

Tier-8 resolutions are never silent: every `LEGACY`-flagged resolution attaches a visible warning to the Revenue Review — "billed at legacy default rate — create an Instructor Rate Profile" — so reviewers see exactly which lines still ride the transition fallback instead of a deliberately chosen rate.

Per matched entry, the resolver produces `{ profileId, profileVersion, lineId, tier, rate, currency, ambiguity?, linkage? }`. This trace is snapshotted onto the Revenue Review charge line (column shape owned by [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) / [13-database-model.md](./13-database-model.md)) and onto `InstructorEarning.rateSource` — the explainable-engine rule: a number without a why is a bug.

Resolution outcomes per time entry:

- **Billing:** entry with `billToCustomer = true` and a resolved rate → instructor-service charge line on the review (`InvoiceLine.kind` mapping: `INSTRUCTOR_TIME` for flight, `GROUND_INSTRUCTION` for ground-family categories, `SIMULATOR_TIME` for sim — existing enum values, no new `LineItemKind` needed). Quantity = normalized billable quantity (§5). No resolved rate → **"unpriced instructor time" warning** on the review; approval blocked until priced, waived non-billable, or covered by a manual Revenue Item line ([06-revenue-items.md](./06-revenue-items.md)).
- **Compensation:** entry with `compensable = true` and a resolved rate → pending compensation figure shown to authorized reviewers; materialized as `InstructorEarning` at approval. No resolved rate → **"no compensation rate" warning**; org policy decides whether that blocks approval (default: warn only, since many schools onboard billing before compensation).
- `CUSTOM` entries match rate lines by case-insensitive `customLabel` equality; no match → the billing/compensation warnings above.

`percentOfBilling` compensation lines compute `rate = resolvedBillingRate × percent / 100` (Decimal math, round half-up to cents); the trace records both inputs and the computed figure.

### 2.6 Compensation recording at approval — InstructorEarning

Inside the Revenue Review approval transaction (owned by [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md)), after the financial snapshot locks, the engine writes one `InstructorEarning` row per compensable time entry: hours, rate, amount, currency, category, classification, and the full resolution trace — all as **point-in-time facts**. This is the spec's immutable-snapshot carve-out from the "computed values are derived at read time" rule (DATABASE_STANDARDS.md L24-26): these columns record what was approved, which is not derivable from future state by definition.

`InstructorEarning` follows the `InventoryMovement` append-only idiom: rows are never updated except for export/lifecycle stamps (`status`, `exportedAt`). Corrections create **offsetting reversal rows** (signed `amount`, `reversesEarningId`, required `reversalReason`), driven by the adjustment workflow in [08-adjustments-discounts-credits.md](./08-adjustments-discounts-credits.md). How earnings roll into Revenue Allocation, platform-fee treatment, and Financial Export is owned by [12-revenue-allocation.md](./12-revenue-allocation-and-reporting.md).

Contractor tracking (spec Part E) maps onto this model with no extra tables: classification snapshot per earning; flight/ground/other hours = earnings grouped by category; compensation earned = `SUM(amount)`; adjustments = reversal rows; approval linkage = `revenueReviewId`; export status = `status`/`exportedAt`; payment status = reserved enum headroom (Part 3); associated lesson = `scheduleEventId` on the time entry; associated organization = `organizationId`.

### 2.7 Late compensation onboarding — manual earnings on approved reviews

Earnings are written only at review approval and `InstructorEarning` is append-only, so a school that onboards compensation after billing would otherwise permanently lose instructor pay for reviews approved before its COMPENSATION profiles existed ([08-adjustments-discounts-credits.md](./08-adjustments-discounts-credits.md) creates only negative reversals). Two recovery pieces close that gap:

- **Manual additive earnings.** A user holding `revenue.compensation_manage` may record a **positive** `InstructorEarning` against an already-approved review: same append-only row shape, `revenueReviewId` (and `timeEntryId` linkage where a matching compensable entry exists), `rateSource` trace marked `MANUAL` with the actor and rationale, **reason required**, audited as `revenue.earning_recorded_manual` (`createdAt` = recording time for manual rows). Manual rows are never edited afterward — the same reversal mechanics apply if the manual figure was wrong.
- **Gap visibility.** A standing report — approved reviews carrying compensable time entries but no `InstructorEarning` rows — surfaces onboarding gaps on the reporting surface owned by [12-revenue-allocation.md](./12-revenue-allocation-and-reporting.md), so the backlog is visible and workable rather than silently lost.

---

## 3. Configuration surface (org-level, strong defaults)

Time rules live on the org-scoped Revenue Engine settings record (`RevenueSettings`, one row per org — merged shape owned by [13-database-model.md](./13-database-model.md); this doc contributes the fields below). No settings JSON blob; explicit typed columns per the established Organization/OrgRole/LessonType config pattern. Updated via a zod-validated PATCH route with before/after `recordAudit` (`org.settings_change` template).

| Setting | Type | Default | Meaning |
|---|---|---|---|
| `timeRoundingMode` | enum `TimeRoundingMode` | `TENTH` | `DECIMAL_FREE` (as entered, 2 dp), `TENTH` (Hobbs/logbook granularity), `HUNDREDTH`, `MINUTE` (entered as minutes, converted to hours, stored to 2 dp) |
| `minimumBillableIncrementHours` | Decimal(4,2)? | `null` | When set, billable quantity rounds **up** to the nearest multiple (e.g. 0.25) |
| `minimumGroundInstructionHours` | Decimal(4,2)? | `null` | Floor applied to the billable quantity of `GROUND_INSTRUCTION` entries; entered hours preserved |
| `defaultPreflightBriefingHours` | Decimal(4,2) | `0.3` | Seeded briefing suggestion at aircraft return (0 disables) |
| `defaultPostflightDebriefingHours` | Decimal(4,2) | `0.2` | Seeded debriefing suggestion (0 disables). 0.3 + 0.2 preserves today's 0.5 h pad |
| `flightTimeSuggestionMode` | enum `FlightTimeSuggestionMode` | `SUGGEST_CONFIRM` | See §2.3 — Hobbs suggests; only `AUTO_FILL` lets it determine |
| `maxHobbsDivergenceHours` | Decimal(4,2)? | `0.5` | Max allowed \|flight-instruction hours − Hobbs elapsed\| before triggering (`null` disables) |
| `hobbsDivergenceAction` | enum | `WARN` | `WARN` (flag on review) or `BLOCK` (submission blocked until corrected or supervisor-overridden with reason) |
| `compensationUsesBilledQuantity` | Boolean | `true` | Compensation pays on the normalized billable quantity; `false` pays on entered hours |
| `allowCompensationLinkedToBilling` | Boolean | `false` | Gate for `percentOfBilling` compensation lines (principle 6 — explicit opt-in only) |
| `allowRateSelfApproval` | Boolean | `true` | May a profile's creator approve it? Solo-CFI schools need `true`; every self-approval is audit-flagged and surfaced on the Revenue Dashboard. Multi-approver orgs should set `false` (see Open questions) |

Rounding is applied once, at entry normalization (write time); the stored `hours` is canonical. The raw submitted value is preserved in the `AuditLog` `newValue` payload. "Nearest minute" is an input convenience: minutes → decimal hours, then rounded half-up to hundredths for storage — stated explicitly so the Financial gate's "rounding policy explicit at every division" requirement is met.

Zero-setup default experience: a new org gets tenth-hour rounding, Hobbs suggestion with confirmation, 0.5 h combined brief/debrief suggestions, no minimums, no linkage — behaviorally equivalent to today's system plus review/confirmation. Principle 10 (simplicity, conventions over configuration) satisfied.

---

## 4. Data model proposal (Prisma-flavored)

Binding calls (precision, currency column form, FK finalization) belong to [13-database-model.md](./13-database-model.md). Recommendation here: money amounts `Decimal(12,2)` + explicit ISO 4217 `currency`, hourly rates `Decimal(12,2)` (one rate precision across the Revenue Engine — 13 R11), hours `Decimal(6,2)`. All models follow schema-governance: real Organization FK with explicit `onDelete`, tenant-scoped uniques, `createdAt`, org-leading indexes.

### 4.1 New enums (each in its own migration before use)

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

enum InstructorRateKind {
  BILLING
  COMPENSATION
}

// Profile lifecycle uses the shared ProfileStatus { DRAFT, APPROVED, ARCHIVED }
// enum (owned by 13-database-model.md R7; shared with AircraftPricingProfile).
// SUPERSEDED is derived at read — a newer APPROVED version exists in the
// family — never stored.

enum InstructorClassification {
  EMPLOYEE
  CONTRACTOR
  UNSPECIFIED
}

enum InstructorEarningStatus {
  PENDING   // written when compensationApprovalMode = SEPARATE_APPROVAL (12-revenue-allocation.md)
  APPROVED  // payable fact; AUTO_ON_REVIEW_APPROVAL writes rows here directly
  EXPORTED  // stamped by Financial Export
  REVERSED  // fully offset by reversal rows
  // PAID deliberately absent — added additively if Part 3 ships payouts
}

enum TimeRoundingMode {
  DECIMAL_FREE
  TENTH
  HUNDREDTH
  MINUTE
}

enum FlightTimeSuggestionMode {
  SUGGEST_CONFIRM
  AUTO_FILL
  MANUAL_ONLY
}
```

### 4.2 InstructorTimeEntry

```prisma
model InstructorTimeEntry {
  id              String  @id @default(cuid())
  organizationId  String
  revenueReviewId String                      // RevenueReview: 03-revenue-review-lifecycle.md
  instructorId    String
  scheduleEventId String?                     // associated lesson booking, when one exists

  category    InstructorTimeCategory
  customLabel String?                         // required iff category = CUSTOM (engine-enforced)

  hours          Decimal  @db.Decimal(6, 2)   // canonical, post org-rounding
  suggestedHours Decimal? @db.Decimal(6, 2)   // Hobbs suggestion at creation — point-in-time fact
  source         InstructorTimeSource @default(INSTRUCTOR_ENTERED)

  billToCustomer Boolean @default(true)       // category default applied at creation
  compensable    Boolean @default(true)

  confirmedByInstructorAt DateTime?
  overrideReason          String?             // latest override reason; full history in AuditLog
  notes                   String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  organization  Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  revenueReview RevenueReview @relation(fields: [revenueReviewId], references: [id], onDelete: Cascade)
  instructor    Instructor    @relation(fields: [instructorId], references: [id])   // RESTRICT (default)
  scheduleEvent ScheduleEvent? @relation(fields: [scheduleEventId], references: [id], onDelete: SetNull)

  @@index([organizationId, createdAt])
  @@index([revenueReviewId])
  @@index([instructorId, createdAt])
}
```

Notes: Cascade from RevenueReview is safe because approved reviews are never deletable (lifecycle rule in [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md)); only drafts can vanish, taking their unbilled entries along. Instructor is RESTRICT like `LessonRecord`/`Endorsement` — wipe order in `src/lib/org-snapshot.ts` deletes time entries before instructors. No `billableHours` column: the normalized billable quantity is computed by the engine and snapshotted on the Revenue Review charge line at approval, not stored-and-resynced here.

### 4.3 InstructorRateProfile + lines

```prisma
model InstructorRateProfile {
  id             String @id @default(cuid())
  organizationId String
  kind           InstructorRateKind
  name           String
  description    String?

  instructorId String?                        // null = org-wide default tier
  locationId   String?
  syllabusId   String?                        // "Program" scope — Syllabus is AeroOps' program concept

  currency       String  @db.Char(3)          // ISO 4217; org default per 13-database-model.md
  classification InstructorClassification @default(UNSPECIFIED)  // meaningful on COMPENSATION kind

  effectiveFrom DateTime
  effectiveTo   DateTime?                     // half-open [from, to); only future-dated caps allowed post-approval
  priority      Int     @default(100)         // within-tier tiebreak, lower wins (§2.5; 13 §4.6)
  familyId      String                        // version-family id (= id of version 1; 13 R8)
  version       Int     @default(1)
  status        ProfileStatus @default(DRAFT) // shared enum (13 R7); SUPERSEDED derived at read
  approvedBy    String?                       // display label — MaintenanceOrder.approvedBy precedent; identity in AuditLog
  approvedAt    DateTime?
  notes         String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  instructor   Instructor?  @relation(fields: [instructorId], references: [id])    // RESTRICT
  location     Location?    @relation(fields: [locationId], references: [id], onDelete: SetNull)
  syllabus     Syllabus?    @relation(fields: [syllabusId], references: [id], onDelete: SetNull)
  lines        InstructorRateProfileLine[]

  @@unique([organizationId, kind, familyId, version])
  @@index([organizationId, kind, status])
  @@index([organizationId, instructorId, kind])
  @@index([organizationId, effectiveFrom])
}

model InstructorRateProfileLine {
  id        String @id @default(cuid())
  profileId String

  category    InstructorTimeCategory
  customLabel String @default("")             // non-null sentinel so the unique constraint holds
  rate             Decimal? @db.Decimal(12, 2) // flat hourly, in profile currency (13 R11)
  percentOfBilling Decimal? @db.Decimal(5, 2) // COMPENSATION only; explicit linkage; exactly one of rate | percentOfBilling
  minBillableHours Decimal? @db.Decimal(4, 2) // per-line override of org minimum

  profile InstructorRateProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  @@unique([profileId, category, customLabel])
}
```

One model, `kind` discriminator, rather than two parallel models (repo rule: no parallel abstractions) and rather than one profile carrying both rates in the same row — separate rows keep versioning independent (a billing change doesn't version compensation history), make RBAC a row filter instead of column gymnastics, and make principle 6 structural.

### 4.4 InstructorEarning (append-only)

```prisma
model InstructorEarning {
  id              String @id @default(cuid())
  organizationId  String
  instructorId    String
  revenueReviewId String
  timeEntryId     String? @unique              // 1:1 for primary earnings; null on reversal rows

  category    InstructorTimeCategory
  customLabel String?

  hours    Decimal @db.Decimal(6, 2)           // approved quantity snapshot
  rate     Decimal @db.Decimal(12, 2)          // resolved compensation rate snapshot (13 R11)
  amount   Decimal @db.Decimal(12, 2)          // signed; reversal rows negative; round-half-up(hours × rate)
  currency String  @db.Char(3)

  classification InstructorClassification      // instructor's classification at approval — snapshot
  rateProfileId      String?                   // provenance; SetNull so history survives config cleanup
  rateProfileVersion Int?
  rateSource         Json                      // resolution trace: tier, candidates, linkage math, ambiguity

  status     InstructorEarningStatus @default(PENDING) // AUTO_ON_REVIEW_APPROVAL writes APPROVED directly (13 R6)
  exportedAt DateTime?                         // stamped by Financial Export (12-revenue-allocation.md)

  reversesEarningId String?                    // set on reversal rows
  reversalReason    String?                    // required on reversal rows

  createdAt DateTime @default(now())           // = approval time for primary rows

  organization  Organization          @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  instructor    Instructor            @relation(fields: [instructorId], references: [id])   // RESTRICT
  revenueReview RevenueReview         @relation(fields: [revenueReviewId], references: [id]) // RESTRICT
  timeEntry       InstructorTimeEntry?  @relation(fields: [timeEntryId], references: [id], onDelete: SetNull)
  rateProfile     InstructorRateProfile? @relation(fields: [rateProfileId], references: [id], onDelete: SetNull)
  reversesEarning InstructorEarning?    @relation("EarningReversal", fields: [reversesEarningId], references: [id], onDelete: Restrict)
  reversals       InstructorEarning[]   @relation("EarningReversal")

  @@index([organizationId, instructorId, createdAt])
  @@index([organizationId, status])
  @@index([organizationId, createdAt])
  @@index([revenueReviewId])
}
```

### 4.5 Modified existing models

| Model | Change | Rationale |
|---|---|---|
| `Instructor` | **No structural change in Part 1.** `hourlyRate` is demoted to legacy resolution fallback (tier 8, BILLING only); new relations (`timeEntries`, `rateProfiles`, `earnings`) added | Additive-only; column retired via the two-release deprecation rule after backfill ([14-migration-plan.md](./14-migration-plan.md)). Note: `Instructor.userId @unique` means one profile shared across orgs — per-org rate separation is achieved by scoping *profiles* to organizations, not by touching Instructor |
| `RevenueSettings` (shared, owned by 13) | Contributes the §3 fields + enums `TimeRoundingMode`, `FlightTimeSuggestionMode` | Org config pattern; no JSON blob |
| `RevenueReview` (owned by 03/13) | Gains `timeEntries InstructorTimeEntry[]` and `earnings InstructorEarning[]` relations; its charge-line snapshot must carry the instructor rate-resolution trace | Snapshot columns are point-in-time facts (ADR carve-out stated in the set's ADR, per [13-database-model.md](./13-database-model.md)) |

Every new model joins `src/lib/org-snapshot.ts` capture/`TableKey`/wipe/restore in the same slice — wipe order: `InstructorEarning` → `InstructorTimeEntry` → (review children per doc 03) → `InstructorRateProfileLine` → `InstructorRateProfile`, all before `Instructor`/`User` (RESTRICT FKs). Seed fixtures (both demo orgs, per spec Part L validation matrix): approved billing + compensation profiles at different rates, one older version in a rate-profile family (renders as superseded at read), one contractor-classified instructor, earnings in `APPROVED` and `EXPORTED` states, and one org left on the legacy fallback to prove the transition path.

---

## 5. Validation & business rules

**Time entries**

1. `hours > 0` and `hours ≤ 24` (hard sanity cap); entries above 8 h draw a review warning.
2. `customLabel` required and non-blank iff `category = CUSTOM`.
3. Rounding/minimums applied as in §3; normalization happens in the engine at write time; the raw submitted value lands in the audit payload.
4. **Hobbs divergence:** for `FLIGHT_INSTRUCTION` entries on a dispatch-backed review, if `|hours − suggestedHours| > maxHobbsDivergenceHours` → warning on entry and review (`WARN`), or submission blocked pending correction or supervisor override-with-reason (`BLOCK`). Never blocks *operational* closeout — this is a review-stage rule (spec Part A: warnings don't block operations unless configured, and even then only the financial path).
5. Suggested (`HOBBS_SUGGESTED`, unconfirmed) entries cannot ride a review submission under `SUGGEST_CONFIRM`; the instructor confirms, edits, or deletes each one.
6. Tenant isolation: `revenueReviewId`, `scheduleEventId` verified org-owned from the session; `instructorId` must resolve to a user holding an ACTIVE `Membership` in the session org (Instructor is user-scoped, so the membership check is the tenant boundary). Cross-tenant ids → 404.
7. Post-approval: entries immutable (guarded update keyed on review status). Deletion allowed only while the review is Draft/Awaiting Instructor Review/Changes Requested, and is audited.
8. Duplicate-category entries on one review are legal (split sessions) but flagged with a soft warning.

**Rate profiles**

9. Line must set exactly one of `rate` / `percentOfBilling`; `percentOfBilling` legal only on `COMPENSATION` profiles in orgs with `allowCompensationLinkedToBilling = true`, range (0, 100].
10. `rate ≥ 0`; `effectiveTo` (when set) `> effectiveFrom`; approval requires ≥ 1 line.
11. Approval-time overlap check: another APPROVED profile of the same `kind` and same scope tuple (`instructorId`, `locationId`, `syllabusId`) with an overlapping effective window and equal `priority` → explicit warning ("resolution will tie-break deterministically; set priorities to disambiguate"). Profile approval proceeds — but if the tie survives to resolution time, the review carries `AMBIGUOUS_RATE` and **the Revenue Review cannot be approved while `AMBIGUOUS_RATE` is unresolved** (both BILLING and COMPENSATION kinds): a reviewer clears it by explicit audited profile selection or by fixing priorities and recalculating (§2.5; doc 05 §3.3 / ADR-030 semantics, not org-configurable in Part 1).
12. Currency must match the review currency at resolution; mismatch excludes the candidate and (if nothing else matches) surfaces as an unpriced/no-rate warning. Part 1 assumes one currency per org (binding call in [13-database-model.md](./13-database-model.md)).
13. Approved profiles: immutability rules of §2.4, enforced in the engine, not just the UI.

**Money math**

14. All amount computation in Decimal (`Prisma.Decimal`/decimal-safe helpers), never JS float — the new engine paths supersede `billing.ts` float arithmetic rather than extending it. Line amount = round-half-up(hours × rate) to cents; the rounding site is exactly one function, contract-tested (Financial gate: explicit rounding policy).
15. `InstructorEarning` rows: never UPDATE `hours`/`rate`/`amount`; corrections are offsetting reversal rows with `reversesEarningId` + `reversalReason`. Lifecycle stamps (`status`, `exportedAt`) are the only permitted mutations.
16. Compensation is computed only from `COMPENSATION`-kind profiles (or their explicit `percentOfBilling` linkage). There is no code path that reads a BILLING rate to price an earning — hard separation is enforced by the resolver's kind parameter, and a contract test asserts an org with billing-only profiles produces zero earnings plus a warning, not inferred compensation.

---

## 6. RBAC, approvals & audit

### Permission keys (data-driven; added to `PERMISSIONS` in `src/lib/permissions.ts`)

The `revenue.` prefix must be registered in `MODULE_BY_PREFIX` (`src/lib/session.ts` ~L263) mapped to the existing `billing` module, so plan/profile module gating applies automatically. Never role-name checks; approval authority is permissions + org config (ADR-006).

| Key | Grants | Default role bundles |
|---|---|---|
| `revenue.time_entry` | Enter/edit/confirm **own** time on reviews for lessons the instructor performed; submit the review | INSTRUCTOR, SCHOOL_ADMIN, ACCOUNT_OWNER |
| `revenue.time_override` | Enter/edit/override/recategorize **any** instructor's time; reason required post-submission | SCHOOL_ADMIN, ACCOUNT_OWNER; via OrgRole templates: Chief Flight Instructor, Assistant Chief Instructor, Operations Director |
| `revenue.rates_view` | View billing-rate profiles | ACCOUNTANT, DISPATCHER, SCHOOL_ADMIN, ACCOUNT_OWNER |
| `revenue.rates_manage` | Create/edit DRAFT billing-rate profiles | ACCOUNTANT, SCHOOL_ADMIN, ACCOUNT_OWNER |
| `revenue.rates_approve` | Approve/supersede/archive billing-rate profiles | SCHOOL_ADMIN, ACCOUNT_OWNER (+ Finance-flavored OrgRole templates) |
| `revenue.compensation_view` | View **org-wide** compensation rates and Instructor Compensation records | ACCOUNTANT, SCHOOL_ADMIN, ACCOUNT_OWNER |
| `revenue.compensation_view_own` | View **own** compensation rates and own Instructor Compensation history ("My Compensation"); route scopes to the session user's instructor profile | INSTRUCTOR (+ the `revenue.compensation_view` roles above) |
| `revenue.compensation_manage` | Create/edit/approve COMPENSATION profiles; set classification; record earning adjustments and manual additive earnings on approved reviews (§2.7) | SCHOOL_ADMIN, ACCOUNT_OWNER (Finance templates) |

Self-scope access is a permission, not a hardcoded rule: `revenue.compensation_view_own` (shared key with [12-revenue-allocation.md](./12-revenue-allocation-and-reporting.md) §6; in the INSTRUCTOR default bundle) lets an instructor see their **own** compensation rates and their own Instructor Compensation history — the route scopes to the session user's instructor profile. Compensation data for *other* instructors requires `revenue.compensation_view` — this is the sensitive boundary; billing rates are not secret, compensation is. Separately, the `RevenueWorkflowPolicy.instructorSeesOwnCompensation` flag (doc 03, default `false`) gates **only** whether compensation figures render inside a Revenue Review's Allocation section; it does not gate the My Compensation surface, which stays available via the key.

"Operations Director", "Chief Flight Instructor", "Chief Pilot" are **not** Role enum values and must not become ones — they ship as `ROLE_TEMPLATES` OrgRole bundles carrying the keys above. Review submit/approve keys (`revenue.review_submit`, `revenue.approve`, …) are owned by [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) — SECOND approval is a **different** user holding `revenue.approve`, per 03 §2.7, not a separate key; this doc only requires that time-entry lock/unlock follows those review transitions.

Separation of duties: profile approval by its own creator is refused when `allowRateSelfApproval = false`; when `true` (default, for solo-CFI schools), the self-approval is recorded with a `selfApproved: true` audit flag and surfaced on the Revenue Dashboard. Instructors holding only `revenue.time_entry` can never approve the review that pays them — approval requires the doc-03 approve key, and doc-03's policy engine owns "instructor may approve routine reviews" opt-ins.

All mutating routes pass `{ mutating: true }` to `authorize()` so read-only impersonation and read-only API keys are refused. No AI pathway mutates any of this (constitution rule 8).

### Audit actions (`recordAudit`, dot-namespaced; impersonation attribution centralized)

| Action | When | Payload highlights |
|---|---|---|
| `revenue.time_entered` | Entry created (any source) | category, hours, source, suggestedHours, raw submitted value |
| `revenue.time_updated` | Pre-submission edit | oldValue/newValue |
| `revenue.time_overridden` | Any post-submission change | oldValue/newValue, **reason (required)**, target instructor |
| `revenue.time_deleted` | Draft-stage deletion | full row snapshot in oldValue |
| `revenue.rate_profile_created` / `_updated` | Draft lifecycle | kind, scope, lines |
| `revenue.rate_profile_approved` | DRAFT → APPROVED | version, effective window, selfApproved flag |
| `revenue.rate_profile_superseded` / `_archived` / `_ended` | Status transitions / future-dated `effectiveTo` cap | old/new |
| `revenue.earning_recorded` | Earnings written at approval | reviewId, per-earning {category, hours, rate, amount}, trace summary |
| `revenue.earning_adjusted` | Offsetting reversal row | reversesEarningId, **reason (required)**, before/after net |
| `revenue.earning_recorded_manual` | Manual additive earning on an approved review (§2.7) | reviewId, {category, hours, rate, amount}, **reason (required)** |
| `revenue.earnings_exported` | Export stamp | export job reference |

Every post-submission change to instructor time is therefore audited with actor, before/after, and reason — the spec Part C requirement verbatim. Audit rows carry ids/labels only; never rates dumps beyond the mutated values, never secrets.

No new domain events are introduced by this document. Earnings recording rides the review-approval event emitted per [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) (constitution: registered events must have live emit sites — this doc adds none rather than registering vocabulary it doesn't emit).

---

## 7. UX notes (aviation-native, operational workflow first)

- **Closeout stays fast.** Aircraft return asks nothing about instructor time; suggestions are seeded silently and the instructor deals with them on the Revenue Review, on their phone, after the debrief. A CFI with four flights a day confirms time in seconds per flight: prefilled Hobbs number, two suggestion chips (brief/debrief), one Confirm control.
- **Confirmation wording** makes the Hobbs relationship explicit: "Flight instruction: **1.4 h** — suggested from Hobbs (9.9 → 11.3). Confirm or adjust." Divergence beyond the org threshold shows amber: "Entered 2.5 h vs Hobbs 1.4 h — explain in notes or adjust."
- **Terminology:** dispatch, release, aircraft return, closeout — per AVIATION_STANDARDS.md. The Part A/operational doc owns the return-vs-"check-in" vocabulary ruling; nothing in these screens says "ticket" or "clock in".
- **Time entry sheet** mirrors a paper instruction record: category rows with hour fields, not an accounting grid. Categories appear in the §2.1 order; `CUSTOM` sits last with a label field.
- **Rates never shown to the wrong eyes.** The time sheet shows hours only. **Instructor default:** the submitting instructor sees line descriptions, hours, and quantities; billing amounts appear in the review's Charges section (doc 03) only for holders of `billing.view` — an instructor without that key submits a review that shows what was done, not what it costs, and that is the designed default, not an accident of permissions. Whenever billing amounts *are* visible to the submitting instructor, the submit screen carries required copy: *"Rates shown are what the customer is charged. Your compensation is tracked separately under My Compensation."* Compensation figures appear only for `revenue.compensation_view` holders; the instructor's own "My Compensation" panel (own earnings, own rates, running period totals: flight/ground/other hours and amount earned — the contractor's month-end view) requires `revenue.compensation_view_own` (INSTRUCTOR default bundle). Whether compensation figures render inside a Revenue Review's Allocation section is separately gated by `instructorSeesOwnCompensation` (doc 03, default off).
- **Classification disclaimer** (required copy, shown wherever classification is set or displayed and on compensation exports): *"AeroOps records the worker classification your organization assigns for rate and reporting purposes. AeroOps does not determine or advise on legal worker classification. Consult qualified legal or tax counsel."*
- **Status colors** for any new badge states (e.g. rate profile DRAFT/APPROVED/ARCHIVED plus the derived read-time "superseded" badge, earning PENDING/APPROVED/EXPORTED/REVERSED) are registered once in `src/lib/status-colors.ts` `STATUS_TONE`; existing meanings untouched.
- Light + dark, desktop + mobile parity; loading/empty/error states included; errors are actionable ("No compensation rate covers Ground instruction for J. Rivera on 2026-07-09 — add a line to an Instructor Rate Profile or mark the entry non-compensable.").

---

## 8. Interactions with other Revenue Engine components

| Sibling doc | Dependency |
|---|---|
| [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) | Owns RevenueReview model/status machine, submission/approval permissions, the approval transaction that (a) freezes review charge-line snapshots incl. instructor rate traces and (b) writes InstructorEarning rows; owns manual (non-dispatch) review creation for ground-only sessions, including the auto-created draft from a completed ground `ScheduleEvent` and Draft → Awaiting Instructor Review routing when `instructorId` is set (§2.3); owns "Changes Requested" round-trip surfaced to instructors |
| [05-aircraft-pricing-profiles.md](./05-aircraft-pricing-profiles.md) | Shared resolver core: tiers, deterministic tie-break, ambiguity warnings, trace shape. Instructor resolution mirrors it with instructor-specific tiers (§2.5); divergence in resolver semantics between the two docs is a design bug |
| [06-revenue-items.md](./06-revenue-items.md) | Manual Revenue Item lines cover unpriced/custom instructor time when no rate line matches; checkride/stage-check fee items are distinct from instructional *time* (an examiner fee is a Revenue Item, the CFI's prep hours are time entries) |
| [08-adjustments-discounts-credits.md](./08-adjustments-discounts-credits.md) | Post-approval corrections: adjustment records on the review side pair with offsetting InstructorEarning rows (actor, reason, before/after, approval status) |
| [12-revenue-allocation.md](./12-revenue-allocation-and-reporting.md) | Consumes InstructorEarning as the Instructor Compensation input to Revenue Allocation; owns platform-fee treatment of instructor-service revenue, reconciliation, Financial Export of earnings (stamping `status`/`exportedAt`), and any accounting-category mapping |
| [13-database-model.md](./13-database-model.md) | Binding schema: merges `RevenueSettings` fields from all docs; finalizes currency representation, Decimal precisions, FK actions, indexes; states the ADR carve-out distinguishing immutable approved snapshots from forbidden computed caches |
| [14-migration-plan.md](./14-migration-plan.md) | Sequencing: enum DDL migrations → model DDL → deterministic backfill generating per-instructor BILLING profiles v1 from `Instructor.hourlyRate` (flight + ground lines at the legacy rate, `effectiveFrom` = migration date, notes = "migrated from Instructor.hourlyRate") → legacy tier-8 fallback retirement. **No compensation backfill — no source data exists; a backfill never guesses.** Also owns seed-fixture additions for both demo orgs and the historical-rate fixtures |

Engine placement: instructor time normalization + instructor rate resolution are pure, framework-free `src/lib` modules in the Revenue Engine family (final module layout in the set's architecture doc), each with contract tests; `src/lib/billing.ts`'s exported helpers (`roundHours`, `flightTimeFromHobbs`) remain valid for operational math while `BRIEF_DEBRIEF_HOURS` and `computeFlightCharges`'s flat instructor math are superseded on the review path.

---

## 9. Out of scope for Part 1 / deferred to Parts 2–3

- **Paying instructors** (payout execution, Stripe Connect transfers to instructors, payroll integration, 1099/tax-document generation). Part 1 records earnings; `InstructorEarningStatus.PAID` is reserved headroom.
- **Standalone earnings without a Revenue Review** (e.g. monthly admin stipends). Every Part 1 earning traces to an approved review.
- **Managed custom-category catalog.** `CUSTOM` + free-text label with exact-match rate lines ships first; an org-defined reusable time-category table is a Part 2 candidate if labels prove fragile.
- **Per-membership instructor org profiles.** `Instructor.userId @unique` (one profile across orgs) stands; org-scoped rate profiles deliver per-org rates without restructuring identity. The recorded deferred follow-on in DATABASE_STANDARDS.md stays deferred.
- **Multi-currency within one org/review**; Part 1 is single-currency per org.
- **Duty-time / flight-time regulatory limit tracking** (e.g. 14 CFR 61.195 daily instruction limits) — a warning surface worth designing later; not a billing concern.
- **Rate cards visible to students pre-booking** (pricing transparency surface) — belongs to scheduling/marketing phases.
- Retiring `Instructor.hourlyRate` — begins only after backfill + a full release of tier-8 fallback telemetry ([14-migration-plan.md](./14-migration-plan.md)).

---

## 10. Open questions

1. **Self-approval default for rate profiles.** Proposed `allowRateSelfApproval = true` (solo-CFI schools) with audit flag + dashboard surfacing; a stricter default (`false` whenever ≥ 2 users hold the approve key) is defensible. Needs product-owner call.
2. **Blocking vs warning when compensation is unresolved at approval.** Default here is warn-only (schools onboard billing first); a school running contractor payroll off AeroOps may want approval blocked until every compensable entry prices. Confirm the default and whether it's org-configurable in Part 2 (`RevenueSettings` headroom exists). Either way, the §2.7 manual-earning path recovers compensation for reviews approved before profiles existed.
3. **"Program" scope.** This design maps Program onto the existing `Syllabus` model. If the product intends a distinct Program/enrollment-package concept in this phase (also affects [05-aircraft-pricing-profiles.md](./05-aircraft-pricing-profiles.md) eligibility), rate-profile scoping should target it instead — decide before 13 locks FKs.
4. **Platform-fee treatment of instructor-service revenue for contractor instructors** (does the platform fee apply to pass-through instructor charges?). Owned by [12-revenue-allocation.md](./12-revenue-allocation-and-reporting.md) but requires an owner pricing decision; flagged here because it determines whether contractor earnings need gross/net columns later.
5. **Suggestion basis when an aircraft bills on Tach** (Part D billing basis). Flight-instruction time is a clock-hours concept, so this design always suggests from Hobbs elapsed even when aircraft rental bills Tach — confirm with the Chief Flight Instructor council that no operator expects Tach-based instruction suggestions.
6. **Brief/debrief suggestion defaults** (0.3/0.2 h preserving today's 0.5 total). Sensible continuity, but validate against real school practice before seeding it as the shipped default.
