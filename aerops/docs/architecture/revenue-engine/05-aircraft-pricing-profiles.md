# Aircraft Pricing Profiles

> **Status:** Proposed — Phase 8 Part 1 · **Date:** 2026-07-10 · **Lead roles:** Flight School Owner; Financial Systems Architect; Database Architect · **Part of:** Revenue Engine design set ([README](./README.md))

Deliverable 5 of the Phase 8 Part 1 design set: how an organization defines, approves, schedules, and versions aircraft rental pricing, and how the Revenue Engine deterministically resolves the correct rate for a flight. This is a **design-only** document — no schema, code, or migration ships with it. Final data-model bindings (column precision, currency, selector storage) are made in [13-database-model.md](./13-database-model.md).

---

## 1. Purpose & scope

### The problem today

Aircraft pricing is two columns: `Aircraft.hourlyRateWet` (required) and `Aircraft.hourlyRateDry` (optional, display-only). The dispatch close route reads `hourlyRateWet` **live** at closeout and bills Hobbs time against it (`src/lib/billing.ts`, `src/app/api/dispatch/[id]/close/route.ts`). Consequences:

- One price per aircraft. Member/non-member, student/renter, discovery-flight, university, and program pricing are impossible.
- No effective dating. Changing a rate changes what *future closeouts* bill — and, because revenue reports recompute `flightTime × current rate` (`reports/page.tsx`, `executive/page.tsx`), it silently rewrites *historical* revenue too, violating Revenue Engine principle 5.
- Billing basis is hardcoded (Hobbs, wet). Tach billing, fixed-price flights, and per-unit custom billing do not exist.
- No minimum billable duration, no configurable rounding, no approval or audit trail on rate changes.

### What this document defines

- **Aircraft Pricing Profile** — the org-owned, versioned, effective-dated, approval-gated record of *one way to price one aircraft (or the fleet)* for *one audience*.
- The **deterministic rate-resolution algorithm** that picks exactly one profile when a Revenue Review is generated, never guesses silently, and records why it chose what it chose.
- The **snapshot-on-review** rule: the resolved rate is copied onto the Revenue Review; approving the review freezes it. Rate changes never touch past reviews.

### What this document does not define

- Instructor pricing — [04-instructor-time-and-rates.md](./04-instructor-time-and-rates.md) (Instructor Rate Profile and Instructor Compensation).
- Fees, surcharges, and org-defined charges — [06-revenue-items.md](./06-revenue-items.md) (Revenue Item).
- Tax rules and TaxSnapshot — [07-tax-model.md](./07-tax-model.md). Profiles carry only a tax-treatment pointer.
- The Revenue Review lifecycle, lock, and approval chain — [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md). This document defines what gets snapshotted; that one defines when the snapshot becomes immutable.
- Binding schema decisions — [13-database-model.md](./13-database-model.md).

---

## 2. Profile taxonomy

Every Part D example maps onto one model with selectors — there are no per-taxonomy subtypes. A profile's *kind* is a consequence of which selectors it sets, not a stored discriminator.

| Taxonomy example | How it is expressed | Resolution level (§3.3) |
|---|---|---|
| Owner Cost | Explicit selection at dispatch (no reliable owner↔user link exists today — see §11 open question 4) | L1 |
| Member Cost | `eligibleCustomerTypes: ["member"]` | L3 |
| Non-Member Cost | `eligibleCustomerTypes: ["non_member"]` | L3 |
| Student Cost | `eligibleCustomerTypes: ["student"]` | L3 |
| Flight Instructor Cost | `eligibleMembershipRoles: ["INSTRUCTOR"]` (staff proficiency flying) | L3 |
| Discovery Flight Cost | `eligibleCustomerTypes: ["discovery"]`, typically `billingBasis: FIXED` | L3 |
| University Cost | `eligibleProgramIds: [<university Syllabus id>]` (see §3.2 on derivation limits) | L2 |
| Corporate Cost | Program-based or explicit selection until the responsible-payer model lands ([11-responsible-payers.md](./11-responsible-payers.md)) | L2 / L1 |
| Wet Rate | `wetDry: WET` on any profile | any |
| Dry Rate | `wetDry: DRY` on any profile | any |
| Program-Specific Rate | `eligibleProgramIds: [...]` | L2 |
| Location-Specific Rate | `locationId` set | L4 |
| Custom Rate | Any combination; `billingBasis: CUSTOM_UNIT` for per-unit billing | per selectors |
| Organization default | `isDefault: true`, `aircraftId: null` | L5 |
| Aircraft default | `isDefault: true`, `aircraftId` set — or, when none exists, the legacy `Aircraft.hourlyRateWet/Dry` columns synthesized as a virtual fallback profile | L6 |

**AeroOps has no `Program` model.** The closest existing concept is `Syllabus` (org-scoped, `prisma/schema.prisma` ~L950) reached via `SyllabusEnrollment` and `ScheduleEvent.syllabusLessonId`. Part 1 binds "program" to Syllabus. If a richer partner/program model lands later, `eligibleProgramIds` migrates additively.

---

## 3. How it works

### 3.1 Profile lifecycle (state machine)

Stored status is deliberately minimal; temporal display states are **derived at read time** from effective dates, per DATABASE_STANDARDS.md ("computed values are derived at read time"). This keeps the stored machine to three states and makes "Scheduled → Active → Ended" impossible to get out of sync.

```
                 approve (revenue.pricing_approve)
   ┌────────┐  ──────────────────────────────────►  ┌──────────┐   archive   ┌──────────┐
   │ DRAFT  │                                       │ APPROVED │ ──────────► │ ARCHIVED │
   └────────┘  ◄── (edit freely; deletable)         └──────────┘  (audited)  └──────────┘
                                                         │
                              derived display state:     │
                              Scheduled  now <  effectiveStart
                              Active     effectiveStart ≤ now < effectiveEnd (or no end)
                              Ended      now ≥ effectiveEnd
```

- **DRAFT** — fully editable, deletable, never participates in resolution.
- **APPROVED** — rate-bearing fields are immutable (§6). Participates in resolution while its effective window covers the flight. A future `effectiveStart` **is** the "scheduled future profile" requirement: approve now, take effect later, no job or flag-flip needed — the resolver's time-window predicate does the work.
- **ARCHIVED** — manual deactivation ("Active/inactive" per spec). Excluded from all new resolution regardless of window. Never deleted: dispatches and Revenue Review snapshots may reference it, and pricing history is part of the financial audit trail.

**Versioning ("edit an approved rate"):** approved rows are never edited in place. "Change this rate" creates a new DRAFT row in the same *family* (`familyId` = the id of version 1, `version` = n+1). Approving version n+1 end-dates version n at the new version's `effectiveStart` — both writes in one `db.$transaction`, both audited. Within a family, approved effective windows never overlap, so "which version priced this flight" always has exactly one answer. This is the effective-dated versioning the spec requires ("Do not overwrite historical rates").

### 3.2 Resolution context — the facts the resolver sees

Resolution runs when the aircraft is returned and the draft Revenue Review is generated ([02-operational-dispatch-and-closeout.md](./02-operational-dispatch-and-closeout.md), [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md)). All inputs are assembled **server-side from session-scoped data** — never from the client (do-not-break rule 1; client-supplied prices are a Financial-gate automatic rejection).

| Fact | Source |
|---|---|
| `organizationId` | Session (never the request body) |
| Aircraft | `Dispatch.aircraftId` (org-owned, validated) |
| Location | `ScheduleEvent.locationId`, falling back to `Aircraft.locationId` |
| `effectiveAt` — the instant that selects which rate window applies | `Dispatch.releasedAt` (checkout), falling back to return time for legacy/imported dispatches. **Rule: the rate in force when the customer took the aircraft governs.** A scheduled midnight rate change does not reprice an aircraft already flying. |
| Explicit selection | `Dispatch.pricingProfileId` (new field, §5.2) |
| Program | Active `SyllabusEnrollment` of the student intersected with the event's syllabus lesson (`ScheduleEvent.syllabusLessonId → SyllabusLesson → Stage → Syllabus`) |
| Membership role | The **service recipient's** `Membership.role` / `customRoleId` in this org (ACTIVE memberships only). The responsible payer's identity never changes the rate — who pays is [11-responsible-payers.md](./11-responsible-payers.md)'s concern; what it costs is decided here. |
| Customer types | Derived set, table below |

**Customer-type derivation** (deterministic, computed by the engine, returned with reasons):

| Customer type | Derivation from existing data |
|---|---|
| `member` | Service recipient holds an ACTIVE `Membership` in the org |
| `non_member` | No ACTIVE `Membership` (walk-in renter, external customer) |
| `student` | `Student` record with `StudentStatus` ENROLLED |
| `discovery` | `EventType` DISCOVERY-class or `StudentStatus` DISCOVERY_FLIGHT |
| `renter` | `EventType` RENTAL |
| `staff` | ACTIVE membership with role INSTRUCTOR, DISPATCHER, or MAINTENANCE |
| `owner` | **Not reliably derivable today** — `Aircraft.ownerName` is a free-text label. Owner pricing uses explicit dispatch selection (L1) until an owner↔user link exists. Recorded as open question 4. |
| `university`, `corporate` | Not derivable until Part K responsible payers land; expressed as program rates (L2) or explicit selection (L1) in Part 1. |

A dispatch context can carry several customer types at once (an enrolled student is also a `member`). Profiles match on set intersection.

### 3.3 The deterministic rate-resolution algorithm

**Candidate set.** All profiles of the org where:

1. `status = APPROVED` (DRAFT and ARCHIVED never resolve),
2. `aircraftId` is null (fleet-wide) **or** equals the dispatch aircraft,
3. `effectiveStart ≤ effectiveAt` and (`effectiveEnd` is null or `effectiveEnd > effectiveAt`),
4. **every** configured selector matches the context — selectors are conjunctive:
   - `eligibleProgramIds` non-empty → dispatch program ∈ set
   - `eligibleMembershipRoles` non-empty → recipient's role ∈ set
   - `eligibleCustomerTypes` non-empty → derived types ∩ set ≠ ∅
   - `locationId` set → dispatch location = it

**Level classification.** Each eligible candidate is classified at exactly one level — the highest-precedence selector kind it carries:

| Level | Definition | Spec priority |
|---|---|---|
| **L1** | Profile explicitly selected on the dispatch (`Dispatch.pricingProfileId`), re-validated at resolution time (org-owned, APPROVED, aircraft-applicable, effective at `effectiveAt`) | 1 — Explicit rate selected for the dispatch |
| **L2** | Carries `eligibleProgramIds` | 2 — Program-specific rate |
| **L3** | Carries `eligibleMembershipRoles` and/or `eligibleCustomerTypes` (no program selector) | 3 — Membership-specific rate |
| **L4** | Carries `locationId` only (no program/membership selector) | 4 — Location-specific rate |
| **L5** | `isDefault` and `aircraftId` null — the org's standard rate card | 5 — Organization default rate |
| **L6** | `isDefault` and `aircraftId` set; when no such profile exists, a **virtual legacy profile** synthesized from `Aircraft.hourlyRateWet` (wet, Hobbs, tenth-rounding — today's exact behavior) | 6 — Aircraft default rate |

A profile combining selectors (e.g., program **and** location) must match on all of them to be eligible, and competes at its highest level (program → L2). Deterministic, and explainable in one sentence.

**Selection.** Walk L1 → L6; the first non-empty level wins. Within the winning level:

1. **Specificity:** aircraft-specific candidates (`aircraftId` set) beat fleet-wide candidates (`aircraftId` null).
2. **Explicit priority:** lowest `priority` integer wins (priority 1 outranks priority 100 — same direction as the spec's own 1-through-6 numbering). Default 100.
3. **Still tied → ambiguity.** The resolver **never guesses silently**:
   - It still returns a deterministic result — total-order tiebreak: latest `effectiveStart`, then earliest `createdAt`, then lowest `id` — so the draft Revenue Review always has numbers and operational closeout is never blocked (principle 1).
   - It attaches an `AMBIGUOUS_RATE` warning naming every tied profile.
   - **The Revenue Review cannot be approved while `AMBIGUOUS_RATE` is unresolved.** A reviewer clears it only by explicitly selecting a profile (which becomes an audited L1 selection) — or by fixing the profiles' priorities and recalculating. This is not org-configurable in Part 1: an ambiguous rate never becomes an approved financial fact.

Because L6 always yields at least the virtual legacy profile (every `Aircraft` row has a required `hourlyRateWet`), **resolution can never come up empty** — a zero-configuration org bills exactly as it does today, with a `LEGACY_FALLBACK` notice in the reasons.

Note on L5 vs L6 ordering (spec-mandated): a fleet-wide org default, once approved, outranks per-aircraft defaults. This is deliberate — an org default is a *configured pricing decision*, the aircraft default/legacy column is the *fallback* — but it surprises schools that price per aircraft (a Seminole does not rent at a 152's rate). Mitigations: most schools should simply never create an L5 profile (the UX says so at creation time, §8), and approving one warns with the list of aircraft whose defaults it will begin outranking. Flagged for product-owner confirmation as open question 1.

### 3.4 Charge computation from the resolved profile

Once a profile is selected, the aircraft-rental charge on the Revenue Review is computed as:

1. **Raw quantity** by billing basis:
   - `HOBBS`: `hobbsIn − hobbsOut`
   - `TACH`: `tachIn − tachOut`
   - `FIXED`: quantity 1; `rateAmount` is the flat price for the dispatch
   - `CUSTOM_UNIT`: quantity entered at return / on the review (e.g., per-landing, per-day), labeled by `customUnitLabel`
2. **Round the quantity** per `roundingRule` (meters are `Decimal(9,1)`, so Hobbs/Tach deltas are already tenths; finer rules only bite for custom units).
3. **Apply the minimum:** `quantity = max(roundedQuantity, minBillableQuantity)` when a minimum is set. Rounding first, then minimum — so a 0.9 h flight with a 1.0 h minimum bills exactly 1.0, never 1.0-then-re-rounded.
4. **Amount** = `quantity × rateAmount`, rounded **half-up to cents**. Money-rounding policy is fixed, not configurable — the Financial gate requires the rounding policy to be explicit at every multiplication/division, and this is it.

All engine arithmetic uses `Prisma.Decimal` — never JS floats (Money = Decimal, CLAUDE.md §5). The existing float math in `src/lib/billing.ts` is superseded for this path; the engine keeps `billing.ts`'s pure, framework-free, contract-tested discipline and its `flightTimeFromHobbs` validation, per the Part 1 audit ([00-current-billing-audit.md](./00-current-billing-audit.md)).

### 3.5 Snapshot-on-review — principle 5

When the draft Revenue Review is generated, the resolver's full output is **copied onto the review's aircraft-rental line** (exact storage shape owned by [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) and [13-database-model.md](./13-database-model.md)):

- `pricingProfileId` + `version` + profile `name` (denormalized — the label must survive archival),
- `rateAmount`, `currency`, `billingBasis`, `wetDry`, `roundingRule`, `minBillableQuantity`,
- computed quantity and amount, with the meter deltas they came from,
- the **resolution record** (§3.6).

Rules:

- **Approved reviews never re-resolve.** Approval locks the snapshot; a rate change tomorrow cannot alter yesterday's review. This is a point-in-time financial fact, not a cached computation — the explicit carve-out from DATABASE_STANDARDS.md's "never store computed values" rule that the ADR ([15-adr-proposals.md](./15-adr-proposals.md)) must record.
- **Draft reviews do not silently re-resolve either.** If a relevant profile changes or a new version becomes effective between generation and approval, the review shows a "rates changed since this review was generated" notice with an explicit, audited **Recalculate rates** action. Numbers a reviewer is looking at never move under their feet.
- **Corrections after approval are adjustment records** ([08-adjustments-discounts-credits.md](./08-adjustments-discounts-credits.md)), never edits to the snapshot.
- Revenue reporting reads snapshots, never `flightTime × current rate`. Retiring or redirecting the recompute-from-live-rates pages (`reports/page.tsx`, `executive/page.tsx`) is an **exit criterion of the same Part 2 slice that ships the Revenue Dashboard** — never a later phase. The two must not coexist as unqualified answers: during any overlap the owner would see two different month-revenue figures, and the legacy one silently rewrites itself after every rate change. If the legacy pages survive that slice at all, they carry an "estimates — see Revenue Dashboard" banner from the moment review snapshots exist. Tracked in [01-revenue-engine-architecture.md](./01-revenue-engine-architecture.md).

### 3.6 Resolution record — computed answers carry their reasons

Per the repo's explainable-engine convention (CONSTITUTION.md rule 6: "a number without a why is a bug"), the resolver returns and the review stores:

```ts
type RateResolution = {
  selectedProfileId: string | null;   // null only for the virtual legacy profile
  selectedVersion: number | null;
  level: 'EXPLICIT' | 'PROGRAM' | 'MEMBERSHIP' | 'LOCATION' | 'ORG_DEFAULT' | 'AIRCRAFT_DEFAULT' | 'LEGACY_FALLBACK';
  effectiveAt: string;                // ISO — the instant that selected the rate window
  reasons: string[];                  // human-readable, ordered
  warnings: RateWarning[];            // AMBIGUOUS_RATE | LEGACY_FALLBACK | RATES_CHANGED_SINCE_GENERATION
  candidates: Array<{                 // every profile considered, kept for audit
    profileId: string; version: number; name: string;
    level: string; priority: number;
    outcome: 'SELECTED' | 'OUTRANKED_BY_LEVEL' | 'OUTRANKED_BY_SPECIFICITY' | 'OUTRANKED_BY_PRIORITY' | 'TIED_AMBIGUOUS' | 'INELIGIBLE';
    reason: string;                   // e.g. "customer types [renter] do not intersect [member]"
  }>;
};
```

Example `reasons` output:

> 1. Explicit selection: none on dispatch.
> 2. Program: no active syllabus enrollment matched a program profile.
> 3. Membership: matched **Member Wet v2** — customer holds an ACTIVE membership (customer types: member, student).
> 4. 2 candidates at Membership level; **Member Wet v2** (priority 10) outranked **Club Rate v1** (priority 50).

This record is part of the review snapshot (§3.5), so "which profile was selected and why" is answerable forever — the spec's required audit trail of selection, satisfied structurally rather than by log-diving.

---

## 4. Configuration surface (org-level options and defaults)

Follows the repo's per-org config pattern (typed columns / dedicated tenant-scoped tables — no settings JSON blob). These fields belong to the org-level Revenue Engine settings record whose final shape is consolidated in [13-database-model.md](./13-database-model.md); this document contributes:

| Setting | Default | Notes |
|---|---|---|
| Default billing basis for new profiles | `HOBBS` | Today's behavior. Per-profile override always available. |
| Default rounding rule for new profiles | `NEAREST_TENTH` | Matches `roundHours` in `src/lib/billing.ts` and Hobbs meter granularity. |
| Currency | Org currency, default `USD` | New profiles inherit it; Part 1 is single-currency per org (§9). Binding call in 13-database-model.md. |
| Pricing approval required | Always on (not configurable) | A profile never resolves until APPROVED. In small schools the same person holds `revenue.pricing_manage` and `revenue.pricing_approve` and self-approves in one step — the gate is a permission, not a second human. |
| Separation of duties (org-wide, shared) | `false` | When `true`, `approvedById` must differ from `createdById`. Not a pricing-local knob — one org-wide setting, see the unification note below. |
| Ambiguity handling | Fixed: warn + block review approval until explicit selection | Deliberately **not** configurable in Part 1 (Product principle 10 — strong defaults over configuration; and "do not guess silently" should not be soft-off-able). |
| Legacy fallback (L6 virtual profile) | Always on | The safety net that keeps zero-config orgs billing exactly as today; always surfaces `LEGACY_FALLBACK` in reasons to encourage profile adoption. |

**Separation-of-duties unification.** Earlier drafts named this control three ways with mixed polarity — `separationOfDutiesRequired` (review approvals, [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md)), `allowRateSelfApproval` (instructor rates, [04-instructor-time-and-rates.md](./04-instructor-time-and-rates.md)), and `pricingSeparationOfDuties` (this document) — a set that drifts the moment a school gains a second approver and flips one knob but not the others. There is exactly **one** org-wide separation-of-duties setting, `separationOfDutiesRequired`, on the shared org-level Revenue Engine settings record, consumed by all three approval engines (pricing profiles, instructor rates, revenue reviews). `pricingSeparationOfDuties` is retired as a stored field and survives only as this document's name for the pricing engine's *consumption* of the shared setting; V12 reads the shared setting. [16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md)'s consistency pass and the D17 auto-flip are being extended to cover this setting so the three engines can never disagree.

**Strong-defaults posture:** an org that configures nothing gets today's billing unchanged (wet Hobbs rate from the aircraft record, tenth rounding, no minimum). Every layer of Part D is opt-in on top of that.

---

## 5. Data model proposal (Prisma-flavored)

> Binding authority: [13-database-model.md](./13-database-model.md). Shapes below follow the design-set defaults — money as `Decimal(12,2)` plus an explicit ISO 4217 `currency` column; org FK with explicit `onDelete`; tenant-scoped uniques; `createdAt`; org-leading indexes (all machine-enforced by `tests/schema-governance.test.ts`). Migrations are additive; every new enum value lands in its own migration before use.

### 5.1 New model: `AircraftPricingProfile`

```prisma
enum PricingBillingBasis {
  HOBBS
  TACH
  FIXED
  CUSTOM_UNIT
}

enum WetDryDesignation {
  WET
  DRY
  NOT_APPLICABLE   // FIXED / CUSTOM_UNIT profiles where wet/dry is meaningless
}

enum PricingRoundingRule {
  NEAREST_TENTH      // default — matches Hobbs meter granularity and today's roundHours
  NEAREST_HUNDREDTH
  UP_TENTH
  UP_HUNDREDTH
  NONE               // bill the exact meter delta / entered quantity
}

/// Shared with InstructorRateProfile (13 §4.6, R7). SUPERSEDED is derived
/// at read time (a newer APPROVED version exists in the family), never stored.
enum ProfileStatus {
  DRAFT
  APPROVED
  ARCHIVED
}

/// Shared tax-treatment enum (13 §4.6, R9). Carried nullable on profiles:
/// null = inherit the org/location tax rules (07-tax-model.md) — no stored
/// ORG_DEFAULT sentinel.
enum TaxTreatment {
  TAXABLE
  NON_TAXABLE
}

model AircraftPricingProfile {
  id             String               @id @default(cuid())
  organizationId String
  /// null = fleet-wide profile (applies to any aircraft in the org)
  aircraftId     String?
  locationId     String?

  /// Version family: familyId = id of version 1. Approved windows within a
  /// family never overlap; "which version priced this flight" is unique.
  familyId       String
  version        Int                  @default(1)

  name           String
  description    String?
  status         ProfileStatus        @default(DRAFT)
  /// Marks the org default (aircraftId null → resolution L5) or the
  /// aircraft default (aircraftId set → resolution L6).
  isDefault      Boolean              @default(false)
  /// Tiebreak within a resolution level. Lower wins (1 outranks 100).
  priority       Int                  @default(100)

  billingBasis        PricingBillingBasis  @default(HOBBS)
  /// Required when billingBasis = CUSTOM_UNIT (e.g. "landing", "day")
  customUnitLabel     String?
  wetDry              WetDryDesignation    @default(WET)
  rateAmount          Decimal              @db.Decimal(12, 2)
  currency            String               @default("USD") @db.Char(3)
  /// In billing-basis units (hours for HOBBS/TACH, units for CUSTOM_UNIT).
  /// Null = no minimum. Not applicable to FIXED.
  minBillableQuantity Decimal?             @db.Decimal(6, 2)
  roundingRule        PricingRoundingRule  @default(NEAREST_TENTH)
  /// Null = inherit the org/location tax rules (07-tax-model.md, R9)
  taxTreatment        TaxTreatment?
  /// RevenueItem ids the rate already covers (e.g. fuel surcharge inside a
  /// wet rate) — the Revenue Item engine must not auto-apply them (06-).
  includedFeeItemIds  String[]

  // Eligibility selectors — conjunctive; empty array = "no constraint".
  /// Role enum names ("STUDENT", "INSTRUCTOR", ...) or "custom:<orgRoleId>"
  eligibleMembershipRoles String[]
  /// Pricing vocabulary (§3.2): member, non_member, student, discovery,
  /// renter, staff, owner, ...
  eligibleCustomerTypes   String[]
  /// Syllabus ids ("programs" — no Program model exists today)
  eligibleProgramIds      String[]

  effectiveStart DateTime
  effectiveEnd   DateTime?

  // Financial-control signatures. Bare ids + denormalized labels, no FK —
  // matches the AuditLog.actorUserId / MaintenanceOrder.approvedBy
  // convention (survives user deletion; supports "apikey:<id>" actors).
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

  @@unique([organizationId, familyId, version])
  @@index([organizationId, status])
  @@index([organizationId, aircraftId, effectiveStart])
  @@index([organizationId, effectiveStart])
}
```

Design notes for the 13-database-model.md binding pass:

- **Selector storage.** `String[]` follows the established org-config idiom (`Organization.disabledModules`, `SubscriptionPlan.modules`) and keeps this to one table. The alternative — three join tables with real FKs — satisfies Part L's "use foreign keys" more literally at the cost of three models and heavier writes. Recommendation: `String[]` with write-time validation that every referenced id is org-owned (zod + engine check, exactly like body-supplied FKs elsewhere); 13-database-model.md makes the binding call.
- **`onDelete` choices.** Org → Cascade (operational config, standard pattern). Aircraft → Cascade (aircraft children pattern; safe because financial history lives in review snapshots, not in profile rows). Location → SetNull (a deleted location shouldn't destroy pricing; the profile degrades to unscoped and shows a validation nudge). `Dispatch.pricingProfileId` → SetNull (below).
- **No partial-unique in Prisma** for "at most one currently-effective default per org / per aircraft" — enforced in the engine at approval time inside the approval transaction (§6), with a raw partial index as an optional hardening step for 13-database-model.md to decide.
- **Name uniqueness** is per-org per-family (rename allowed across versions via new version). Uniqueness among *live* families is engine-enforced at create/approve time (archived families may share names with new ones).
- **org-snapshot:** `aircraftPricingProfiles` must join `TableKey`, capture, wipe order (before `aircraft`), and restore order in `src/lib/org-snapshot.ts` in the same slice that creates the table — otherwise founder snapshot/restore silently drops pricing config.

### 5.2 Extended model: `Dispatch` (reuse — never a parallel model)

Per the design-set position, `Dispatch` (schema ~L905) is extended, not duplicated:

```prisma
model Dispatch {
  // ... existing fields unchanged ...

  /// Explicit rate selection for this flight (resolution L1). Set at
  /// checkout or during review; validated server-side (org-owned, APPROVED,
  /// aircraft-applicable, effective). Audited on every change.
  pricingProfileId String?
  pricingProfile   AircraftPricingProfile? @relation(fields: [pricingProfileId], references: [id], onDelete: SetNull)
}
```

`SetNull` because the review snapshot — not this pointer — is the financial record; losing the pointer after an archive/delete never corrupts money. Other Dispatch extensions (organizationId + backfill, return-capture fields, the Revenue Review link that structurally prevents charging the same dispatch twice) are owned by [02-operational-dispatch-and-closeout.md](./02-operational-dispatch-and-closeout.md) and [13-database-model.md](./13-database-model.md).

### 5.3 Contribution to org-level Revenue Engine settings

Fields this design adds to the shared org settings record (final shape in [13-database-model.md](./13-database-model.md)): `defaultBillingBasis PricingBillingBasis @default(HOBBS)` and `defaultRoundingRule PricingRoundingRule @default(NEAREST_TENTH)`. Separation of duties is deliberately **not** a pricing-local field: the pricing approval engine consumes the single org-wide `separationOfDutiesRequired Boolean @default(false)` shared with instructor rates and revenue reviews (§4 unification note).

### 5.4 Engine placement

`src/lib/pricing.ts` — a new pure, framework-free engine in the `billing.ts` mold (single source of truth, contract-tested, callable from API routes, UI estimates, and seed):

- `pricingFactsFor(context)` — derives customer types, program, membership facts, with reasons.
- `resolveAircraftRate(context, candidates): RateResolution` — §3.3, pure function over an explicit candidate list (no DB access inside — the route/engine boundary loads candidates org-scoped).
- `computeAircraftCharge(profile, meters | quantity): { quantity, amount, steps[] }` — §3.4, `Prisma.Decimal` arithmetic, every step recorded for the review's explainability panel.

`computeFlightCharges` in `billing.ts` remains the L6 legacy fallback's semantics and the pre-profile behavior; its call sites migrate in Part 2 per [01-revenue-engine-architecture.md](./01-revenue-engine-architecture.md) and the superseding ADR ([15-adr-proposals.md](./15-adr-proposals.md)).

---

## 6. Validation & business rules

| # | Rule | Enforced |
|---|---|---|
| V1 | `rateAmount ≥ 0`; `currency` is a valid ISO 4217 code and (Part 1) must equal the org currency | zod + engine |
| V2 | `effectiveEnd`, when set, must be after `effectiveStart` | zod + engine |
| V3 | Approved windows within a family never overlap; approving version n+1 end-dates version n at n+1's `effectiveStart` in the same `db.$transaction` | engine, in-transaction re-check |
| V4 | Only DRAFT rows are editable or deletable. APPROVED rows accept exactly two mutations: set/advance `effectiveEnd` (end-dating, audited) and `status → ARCHIVED` (audited). Everything else is a new version | engine; route returns 400 with the reason |
| V5 | A profile never participates in resolution unless `status = APPROVED` and its window covers `effectiveAt` | resolver predicate |
| V6 | At most one currently-effective default per org (L5) and per aircraft (L6) at any instant — checked inside the approval transaction; violation is a 409 naming the conflicting profile | engine |
| V7 | `CUSTOM_UNIT` requires `customUnitLabel`; `FIXED` forbids `minBillableQuantity` and ignores `roundingRule`; `wetDry = NOT_APPLICABLE` only for FIXED/CUSTOM_UNIT | zod + engine |
| V8 | Every id in `eligibleProgramIds` (Syllabus), `eligibleMembershipRoles` (`custom:<orgRoleId>` form), `locationId`, and `includedFeeItemIds` must be org-owned — cross-tenant ids are indistinguishable from nonexistent (404/400) | engine at write time |
| V9 | Explicit dispatch selection (`pricingProfileId`) re-validated at both write time and resolution time: org-owned, APPROVED, aircraft-applicable, effective at `effectiveAt`. A selection that has become invalid (archived since checkout) degrades to normal resolution with an `EXPLICIT_SELECTION_INVALID` warning — never a silent substitution | engine |
| V10 | Same-priority, same-level ties produce `AMBIGUOUS_RATE`; the Revenue Review cannot be approved until cleared by explicit selection or priority fix + recalculation (§3.3) | resolver + review approval gate (03-) |
| V11 | Deleting an APPROVED profile is impossible; archive instead. DRAFTs are deletable | engine |
| V12 | Separation of duties, when the org enables it (org-wide `separationOfDutiesRequired`, §4): `approvedById ≠ createdById`, rejected with an actionable 403 | engine |
| V13 | All money math in `Prisma.Decimal`; quantity rounding per profile rule; money rounding fixed half-up to cents (§3.4) | engine contract tests |
| V14 | Resolution inputs come exclusively from session-scoped server data; no client-supplied rate, amount, or organizationId is ever trusted | route layer (authorize + org-scoped loads) |

Duplicate-billing protection ("charging the same dispatch twice") is structural — the unique Dispatch↔Revenue Review link — and owned by [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) / [13-database-model.md](./13-database-model.md); pricing resolution is idempotent by construction (pure function of context + candidates).

---

## 7. RBAC, approvals & audit

### Permissions (data in `src/lib/permissions.ts` — never hardcoded role checks)

| Key | Grants | Default role bundles |
|---|---|---|
| `revenue.pricing_view` | See rate cards, profile history, resolution reasons | ACCOUNT_OWNER, SCHOOL_ADMIN, ACCOUNTANT, DISPATCHER, INSTRUCTOR |
| `revenue.pricing_manage` | Create/edit/delete DRAFT profiles, create new versions, archive | ACCOUNT_OWNER, SCHOOL_ADMIN, ACCOUNTANT |
| `revenue.pricing_approve` | Approve profiles (electronic signature → `approvedById/At`) | ACCOUNT_OWNER, SCHOOL_ADMIN |

- The `revenue.` prefix must be registered in `MODULE_BY_PREFIX` (`src/lib/session.ts` ~L263) mapped to the **billing** module, or none of these keys are module-gated — the audit calls this out explicitly. Nav entries join `SECTION_PERMISSIONS` and `SECTION_MODULES` (constitution-tested).
- **Explicit rate selection at checkout** deliberately requires only `dispatch.release` (plus the selection being among APPROVED, applicable profiles): the dispatcher is choosing from the org's sanctioned rate card, not exercising pricing power. Every selection and change is audited.
- Role templates ("Front Office", "Operations Coordinator" in `src/lib/role-templates.ts`) gain the matching keys as OrgRole seed updates — approval authority is expressed as permission bundles, never role names (ADR-006).
- All mutating routes pass `{ mutating: true }` so read-only impersonation and read-only API keys are refused (session gate, constitution-tested). No AI pathway touches pricing (CONSTITUTION rule 8).

### Approval semantics

Approval is the electronic signature that makes a rate resolvable — the same pattern as `MaintenanceOrder.approvedBy/approvedAt` (return-to-service signature). It is a permission gate, not necessarily a second human; the org-wide `separationOfDutiesRequired` setting (§4 unification note) upgrades it to a two-person control (V12). Approving a version that supersedes another performs both writes atomically (V3).

### Audit actions (every mutation through `recordAudit`, old/new values included)

| Action | When |
|---|---|
| `revenue.pricing_profile_created` | New DRAFT (v1 or new version; new version records `familyId` + superseded version in metadata) |
| `revenue.pricing_profile_updated` | DRAFT edit (before/after) |
| `revenue.pricing_profile_approved` | Approval — includes effective window and, when applicable, the end-dating of the prior version |
| `revenue.pricing_profile_archived` | Archive, with reason |
| `revenue.pricing_profile_deleted` | DRAFT deletion |
| `dispatch.rate_selected` | Explicit selection set/changed/cleared on a dispatch — actor, old/new profile |

Impersonation attribution is centralized in `recordAudit` (ADR-023); routes simply pass `actorUserId: session.userId`. **Which profile priced a given flight** is not an AuditLog concern at all — it lives structurally in the review's resolution record (§3.6), because audit rows are best-effort while financial snapshots are not.

No new domain events are proposed for Part 1: profile changes are configuration, and the constitution forbids registering event names without live emit sites. Revenue-lifecycle events belong to [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md).

---

## 8. UX notes (aviation-native, operational workflow first)

- **Terminology.** AVIATION_STANDARDS.md bans "check-in" in customer-facing UX; surfaces here say **aircraft return / dispatch closeout**. "Aircraft Pricing Profile" is the customer-facing term everywhere (never "rate table" or "price book").
- **Where profiles live:** a **Pricing** tab on the aircraft detail page (rate card grouped by family, derived state chips) plus an org-level **Revenue Engine → Pricing** screen listing fleet-wide profiles, defaults, and everything Scheduled. New derived states (Draft, Scheduled, Active, Ended, Archived) get entries in `STATUS_TONE` (`src/lib/status-colors.ts`) — single source, existing meanings untouched.
- **Checkout (dispatch release):** the dispatcher sees the rate that will apply — "Member Wet — $149.00/hr wet · Hobbs" — with a *Why this rate?* popover rendering the resolution reasons, and an override control that is an explicit selection from the sanctioned list. No accounting vocabulary in the flow; a dispatcher releases an aircraft, they don't "configure pricing".
- **Return:** unchanged operationally — meters in, squawks, done. Pricing resolution happens behind the scenes when the draft Revenue Review is generated. Warnings (ambiguity, legacy fallback) surface on the review queue, not in the return flow (principle 1: closeout stays fast).
- **Revenue Review:** the aircraft-rental line shows profile name + version, rate, basis, wet/dry, quantity derivation ("Hobbs 1,543.2 → 1,544.9 = 1.7 h"), and the reasons panel. `AMBIGUOUS_RATE` renders as a blocking banner with the tied profiles side-by-side and one-click explicit selection; the approve control stays disabled with actionable text ("Two profiles tie at Membership priority 100 — select one or adjust priorities").
- **Scheduling a rate change** is a first-class action ("Schedule rate change") that creates the next version with a future `effectiveStart`; the rate card shows "Active $149.00 → $159.00 from Aug 1" so the whole desk sees it coming. Effective dates are entered and displayed in the org's `timeZone`.
- **Creating an org default (L5)** warns inline: "An organization default outranks each aircraft's own default rate. Most schools price per aircraft — are you sure?" with the list of affected aircraft.
- Design-system components only, light + dark + mobile parity, empty states ("No pricing profiles yet — this aircraft bills its standard rate of $165.00/hr wet") — all standard gates.

### Worked examples

**Setup — N12345, C172S, demo org.** Legacy column `hourlyRateWet = 165.00`. Approved profiles:

| Profile | Selectors | Rate | Basis | Priority |
|---|---|---|---|---|
| Member Wet v2 | customerTypes `[member]` | $149.00 wet | Hobbs, min 1.0 h, tenth | 10 |
| Non-Member Wet v1 | customerTypes `[non_member]` | $179.00 wet | Hobbs, tenth | 10 |
| Discovery Flight v1 | customerTypes `[discovery]` | $199.00 | FIXED | 10 |
| University Dry v1 | programIds `[<State U Syllabus>]` | $118.00 dry | Tach, hundredth | 10 |

1. **Member vs non-member, same aircraft, same day.** Enrolled member student flies Hobbs 1,543.2 → 1,544.9 (1.7 h): L1 none → L2 none → L3 matches **Member Wet v2** (types: member, student) → 1.7 h ≥ 1.0 min → 1.7 × $149.00 = **$253.30**. A walk-in renter flies the same block: types `[non_member, renter]` → **Non-Member Wet v1** → 1.7 × $179.00 = **$304.30**. Same aircraft, same meters, two defensible prices — each review says exactly why.
2. **Minimum billable.** Member flies 0.8 h: rounded 0.8 → max(0.8, 1.0) = 1.0 → **$149.00**. The review shows "minimum billable 1.0 h applied (flew 0.8)".
3. **Program beats membership.** A State U student (also a member) flies under the university program, Tach 1,201.40 → 1,202.85: L2 matches **University Dry v1** before L3 is ever considered → 1.45 h (hundredth) × $118.00 = **$171.10**, dry — the fuel-surcharge Revenue Item auto-applies because the dry rate does not list it in `includedFeeItemIds` ([06-revenue-items.md](./06-revenue-items.md)).
4. **Ambiguity.** Someone approves **Club Rate v1** (customerTypes `[member]`, $155.00, priority 10 — same level, same priority as Member Wet v2). Next member flight: tie at L3 → deterministic tiebreak picks the later-effective profile, review carries `AMBIGUOUS_RATE` naming both, approval is disabled until the reviewer explicitly selects one (audited L1) or fixes priorities and recalculates. Nothing was silently guessed; nothing was blocked operationally.
5. **Scheduled increase.** Member Wet v3 at $159.00 approved with `effectiveStart` Aug 1 (org time). A flight released Jul 31 22:04 and returned Aug 1 00:30 bills **v2 at $149.00** — `effectiveAt` is checkout (`releasedAt`), the price posted when the customer took the aircraft. The Jul 31 review snapshot names v2; nothing about the v3 approval touches it.
6. **Zero-config org (legacy fallback).** Blue Ridge Flying Club has no profiles. N67235 flies 1.2 h → virtual legacy profile from `hourlyRateWet` ($160.00 wet, Hobbs, tenths) → $192.00, review reasons show `LEGACY_FALLBACK`: "No pricing profiles configured — billed the aircraft's standard rate. Create profiles to unlock member and program pricing." Billing behavior is bit-for-bit today's.

---

## 9. Interactions with other Revenue Engine components

| Sibling | Interaction |
|---|---|
| [01-revenue-engine-architecture.md](./01-revenue-engine-architecture.md) | Engine placement (`src/lib/pricing.ts`), operational-vs-financial closeout boundary, retirement plan for live-rate report math |
| [02-operational-dispatch-and-closeout.md](./02-operational-dispatch-and-closeout.md) | Checkout captures explicit selection (L1) and `releasedAt` (= `effectiveAt`); return triggers review generation, which invokes resolution; owns Dispatch org-scoping/backfill and return-capture fields |
| [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) | Owns the review snapshot storage, the approval lock (principle 5 enforcement point), the `AMBIGUOUS_RATE` approval block, and the audited Recalculate-rates action |
| [04-instructor-time-and-rates.md](./04-instructor-time-and-rates.md) | Instructor Rate Profile mirrors this design (versioning, effective dating, approval, `RateResolution` contract shape) so the review shows one consistent explainability model |
| [06-revenue-items.md](./06-revenue-items.md) | `includedFeeItemIds` suppresses auto-applied Revenue Items covered by the rate (wet rate ⊃ fuel surcharge); Revenue Item availability may be scoped per aircraft/location/program independently |
| [07-tax-model.md](./07-tax-model.md) | Nullable `taxTreatment` feeds tax computation (null = inherit the org/location tax rules); the TaxSnapshot on the approved review is that document's concern |
| [08-adjustments-discounts-credits.md](./08-adjustments-discounts-credits.md) | Post-approval price corrections are adjustment records — never snapshot edits, never profile edits |
| [11-responsible-payers.md](./11-responsible-payers.md) | Payer identity never changes rate resolution (§3.2); future payer-negotiated pricing (university/corporate contracts) would add a resolution input — deferred |
| [10-checkout-restrictions.md](./10-checkout-restrictions.md) | "No applicable pricing profile beyond legacy fallback" may join the configurable warn-only checkout checks; never a safety-category block |
| [13-database-model.md](./13-database-model.md) | Binding calls: money precision/currency, selector storage (String[] vs join tables), partial indexes for single-default enforcement, Dispatch↔Review uniqueness, org settings record shape |
| [14-migration-plan.md](./14-migration-plan.md) | Recommendation: **no backfill of profile rows.** The virtual legacy fallback makes synthesized profiles unnecessary — no data invention, no dual source of truth. `Aircraft.hourlyRateWet/Dry` remain authoritative for an aircraft until its first profile is approved, and are retained (additive-only) regardless |
| [15-adr-proposals.md](./15-adr-proposals.md) | ADR must record: the snapshot carve-out from the computed-values rule; supersession of the ADR-011 invoice-inside-closeout shape; the exact L1–L6 resolution order as a decided pattern |

---

## 10. Out of scope for Part 1 / deferred to Parts 2–3

**Part 2–3 (implementation phases of this design):**

- All code: `AircraftPricingProfile` migration, `src/lib/pricing.ts` + contract tests, routes, screens, `STATUS_TONE`/permission/`MODULE_BY_PREFIX`/org-snapshot/seed wiring (seed fixtures must cover both demo orgs, including a scheduled version and an ambiguity fixture, per Part L's validation matrix).
- Migrating `computeFlightCharges` call sites (close route, dispatch-board estimate, seed) onto the resolver, and pointing revenue reports at snapshots.

**Explicitly deferred beyond this design (each needs its own decision when raised):**

- Multi-currency: Part 1 is one currency per org; the column exists from day one so this is additive.
- Prepaid blocks, block-time discounts, packages, and wallet balances (Part H forbids them in the first release).
- Time-of-day / seasonal / demand-based pricing; per-payer negotiated contract rates; promotional codes (Part H owns codes).
- Aircraft-*type*-level profiles (`AircraftType` is a global, non-tenant table — scoping pricing to it would leak tenancy; revisit only with a tenant-scoped type concept).
- Owner↔user linkage for automatic `owner` customer-type derivation (see open question 4).
- Stripe Price/Product object mirroring — pricing stays AeroOps-native; Stripe sees amounts, not catalogs (Part 2 Stripe design).

---

## 11. Open questions

1. **L5 vs L6 ordering.** The spec places the organization default rate (5) above the aircraft default rate (6). We implement exactly that, mitigated by UX guidance (§3.3, §8) — but for a mixed fleet an org-wide default that outranks per-aircraft defaults is a foot-gun. Product owner to confirm the intent, or bless swapping L5/L6 in the ADR before Part 2.
2. **Customer-type vocabulary ownership.** Is the starter set (member, non_member, student, discovery, renter, staff, owner) fixed platform vocabulary, or may orgs define custom customer types in Part 1? Recommendation: fixed set now (deterministic derivation is the hard part), org-defined types deferred; needs owner sign-off since it constrains how schools express pricing audiences.
3. **Rate-effectivity instant.** We bind `effectiveAt` to checkout (`releasedAt`) — the posted price when the customer took the aircraft (§3.2, example 5). Confirm this matches how schools actually post rate changes (the alternative — return time — bills the new rate for a flight straddling the change).
4. **Owner pricing.** Owner Cost profiles currently require explicit dispatch selection because `Aircraft.ownerName` is a free-text label. Is a structural owner↔user link (enabling automatic L3 owner pricing for leaseback owners) wanted in Part 2, or is explicit selection acceptable for launch?
5. **Included-fees semantics.** `includedFeeItemIds` is designed as suppression of auto-applied Revenue Items (§5.1). Confirm orgs don't additionally need "display included fees as $0 lines on the review" for transparency — a rendering decision that changes the review layout, owned jointly with [06-revenue-items.md](./06-revenue-items.md).
