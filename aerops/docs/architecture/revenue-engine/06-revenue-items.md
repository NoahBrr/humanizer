# Revenue Items

> **Status:** Proposed — Phase 8 Part 1 · **Date:** 2026-07-10 · **Lead roles:** Director of Operations; Head of Product; Aviation Accounting Specialist · **Part of:** Revenue Engine design set ([README](./README.md))

Deliverable 8 of the Phase 8 Part 1 design set. Covers spec **Part F — Revenue Items**: the org-editable catalog of chargeable items, its built-in seed set, how catalog items become Revenue Review line items, manual-item controls, high-risk (damage-fee) handling, the relationship to the existing `LineItemKind` enum, and the accounting-category seam for Part 3 exports.

---

## 1. Purpose & scope

Today the only charge typology in AeroOps is the closed 10-value `LineItemKind` enum (`prisma/schema.prisma` L1119–1130). Airport fees, landing fees, cleaning fees, damage fees, headset rentals — everything a real flight school charges beyond aircraft and instructor time — has no model, no defaults, no controls, and no accounting mapping. Even `Aircraft.fuelSurchargePerHr` (schema L674) is display-only and never billed.

A **Revenue Item** is an organization-owned catalog entry describing one kind of charge: what it is called, what category it belongs to, how it is priced (fixed or variable, and on what unit basis), whether it is taxable by default, what evidence and approval it requires, where it may be used (locations, programs, aircraft), and which accounting category it exports to.

In scope for this document:

- The `RevenueItem` model and its availability-scoping tables.
- The built-in catalog (26 items) seeded per organization, editable, plus unlimited org-defined custom items.
- The full configuration surface with defaults.
- How items become Revenue Review line items (pricing engine vs Revenue Rule vs aircraft-return capture vs manual add) and the fields a line snapshots.
- Manual-item controls: item, amount, quantity, reason, actor, tax treatment, note, attachment, approval requirement, timestamp.
- Enhanced approval for high-risk items (damage fees).
- The extend-vs-supersede decision for `LineItemKind`.
- The `defaultAccountingCategoryCode` seam consumed by Financial Export in Part 3.

Not in scope (owned by siblings): aircraft/instructor pricing resolution ([05-pricing-and-rates.md](./05-aircraft-pricing-profiles.md)), the Revenue Review state machine and approval mechanics ([04-revenue-review.md](./03-revenue-review-lifecycle.md)), tax rules and `TaxSnapshot` ([07-taxes.md](./07-tax-model.md)), discounts/credits/corrections ([08-adjustments.md](./08-adjustments-discounts-credits.md)), and the binding schema call ([13-database-model.md](./13-database-model.md)).

**Terminology note.** The Phase 8 spec says "aircraft check-in"; AVIATION_STANDARDS.md bans "check-in" in customer-facing surfaces. This document uses **aircraft return / dispatch closeout** throughout, matching the terminology resolution recorded in [02-architecture.md](./01-revenue-engine-architecture.md).

---

## 2. How it works

### 2.1 Catalog lifecycle

A Revenue Item has a deliberately simple lifecycle — it is configuration, not a financial record:

```
(seeded or created) → active ⇄ inactive → deleted (only if never referenced)
```

- **Created** — at org provisioning (built-ins, `isSystem = true`) or by an authorized user (`revenue.items_manage`). Custom items are unlimited.
- **Active/inactive** — `isActive` plus optional `effectiveFrom`/`effectiveTo` control whether the item can be *added* to new Revenue Reviews. Deactivation never touches existing lines.
- **Deleted** — hard delete is allowed only when no `InvoiceLine` references the item (FK `onDelete: Restrict`; review lines *are* `InvoiceLine` rows per [13-database-model.md](./13-database-model.md) §3 R1). The UI offers **Deactivate** as the normal path; delete exists for typo-created items only.

**No version column.** Unlike Aircraft Pricing Profiles and Instructor Rate Profiles (which are resolved automatically and therefore must be effective-dated versions), a Revenue Item is always applied by an explicit action — a rule firing, a return-fee capture, or a human adding it. Historical immutability comes from **snapshotting** the item's name, code, amount, unit basis, taxability, and accounting category onto the line at the moment it is added, and freezing the line at approval (spec principle 5). Editing the catalog tomorrow never changes yesterday's review. This is a point-in-time financial fact, not a stored computed value, per the snapshot carve-out ADR argued in [13-database-model.md](./13-database-model.md).

### 2.2 How items become Revenue Review line items

Every line on a Revenue Review that is not aircraft rental or instructor/simulator instruction time originates from a Revenue Item. Lines carry an `origin` discriminator — the 6-value `RevenueLineOrigin` (§4.2):

| Origin | Trigger | Quantity source | Amount source | Example |
|---|---|---|---|---|
| `PRICING` | Pricing engine at draft generation | Hobbs/Tach elapsed | Aircraft Pricing Profile snapshot | Aircraft rental. **Not Revenue Items** — see [05-pricing-and-rates.md](./05-aircraft-pricing-profiles.md) |
| `INSTRUCTOR_TIME` | Instructor time entries priced at draft generation | Instructor time entries (BILLING rate) | Instructor Rate Profile snapshot | Flight/ground instruction time. **Not Revenue Items** — see [05-pricing-and-rates.md](./05-aircraft-pricing-profiles.md) |
| `RULE` | A **Revenue Rule** fires when the draft Revenue Review is generated *(reserved seam — Part 2, see note below)* | Derived from unit basis (see §2.3) | Rule-configured amount, else item `defaultAmount` | "Add Fuel Surcharge per Hobbs hour on N54321" |
| `CHECK_IN` | Fees captured on the aircraft-return form (spec Part A: airport, landing, ramp, parking fees) | Entered at return (e.g. landing count prefilled from `Dispatch.landings`) | Entered at return, validated against item config | Dispatcher records a $15 ramp fee at KTTA |
| `MANUAL` | Authorized user adds an item to a Draft / Changes Requested review | Entered manually | Entered manually (locked to `defaultAmount` when `amountMode = FIXED`) | Ops adds a Cleaning Fee with a note |
| `ADJUSTMENT` | An applied adjustment materializes a line | Per adjustment | Adjustment amount (signed) | Discounts, credits, waivers, corrections. **Not Revenue Items** — see [08-adjustments.md](./08-adjustments-discounts-credits.md) |

**No Revenue Rule model ships in Part 1** — `RevenueLineOrigin.RULE` is a reserved seam, and the model is added additively in Part 2 only if go/no-go decision D43 confirms it (Part 1 position: [01-revenue-engine-architecture.md](./01-revenue-engine-architecture.md) §7.1; [13-database-model.md](./13-database-model.md) §12 Q3; [16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md) §2.2 D43 and §4.1). This document defines only the item-side contract a future rule engine must honor: a Revenue Rule references exactly one active Revenue Item, and the line it produces snapshots the item exactly as a manual add would, with `origin = RULE` and the rule id recorded in the line's audit metadata.

Fees captured at aircraft return (`CHECK_IN`) are deliberately *capture-only*: the dispatcher records "landing fee, KGSO, $12" in seconds and moves on. The fee materializes as a draft line on the Revenue Review created by operational closeout ([03-operational-checkout.md](./02-operational-dispatch-and-closeout.md)); all review, tax, and approval consequences happen later in the Revenue Review workflow. Operational closeout never waits on any of this.

### 2.3 Quantity semantics by unit basis

| Unit basis | Quantity means | Auto-suggested from | Validation |
|---|---|---|---|
| `PER_HOUR` | Hours | Hobbs elapsed (or Tach where the review's billing basis is Tach) | Warn if quantity exceeds elapsed time + org tolerance |
| `PER_LANDING` | Landings | `Dispatch.landings` from the return record | Warn if quantity ≠ recorded landings |
| `PER_FLIGHT` | Flights (normally 1) | Fixed at 1 per dispatch | Warn if > 1 |
| `PER_DAY` | Days | Dispatch out→return calendar days in the org time zone | Warn on mismatch |
| `PER_UNIT` | Item's `unitLabel` (e.g. "quart", "each") | None — always entered | Must be > 0 |
| `FIXED` | Always 1 | Locked at 1 | Quantity not editable |

`PER_UNIT` is an addition beyond the spec's five bases (per-hour / per-landing / per-flight / per-day / fixed). It exists because two built-ins genuinely need it — Oil Charge (per quart) and retail items (per each) — and mirrors the "custom unit" concept the spec already allows for pricing profiles (Part D). Suggested quantities are **suggestions with a stated basis**, never silent determinations, consistent with the explainable-engine rule.

### 2.4 Manual item flow (spec "Manual item controls")

When an authorized user adds a manual item to a review in `Draft` or `Changes Requested` status:

1. Picker shows only items that are active, within effective dates, and available for the review's location, program, and aircraft (§5 rule V4). Requirement chips (note / attachment / second approval) are visible *before* selection.
2. User enters quantity and amount. `amountMode = FIXED` locks the amount to `defaultAmount`; changing a fixed amount is not a manual add — it is an adjustment ([08-adjustments.md](./08-adjustments-discounts-credits.md)).
3. **Reason is mandatory for every manual line** (not just when `requiresNote` is set) — a manual charge with no stated reason is unauditable. `requiresNote` additionally demands a free-text supporting note; `requiresAttachment` demands a linked `Document`.
4. The line is written with a full snapshot (§4.2) plus: `reason`, `note`, `attachmentDocumentId`, `addedByUserId`, `addedByLabel`, `requiresSecondApproval` (copied from item config at add time), `createdAt`. `recordAudit("revenue_review.line_added", …)` captures the same data with before/after review totals.
5. If the item carries `requiresSecondApproval`, the review is flagged: it cannot reach `Approved` on a single approval ([04-revenue-review.md](./03-revenue-review-lifecycle.md) owns the mechanics).

This records every field the spec requires: item, amount, quantity, reason, actor, tax treatment (the `isTaxable` snapshot, overridable only per [07-taxes.md](./07-tax-model.md)), supporting note, attachment, approval requirement, timestamp.

### 2.5 High-risk items (damage fees)

Items with `riskLevel = HIGH` (Damage Fee in the seed; orgs may create more, e.g. "Prop Strike Assessment") get enhanced treatment:

- `requiresNote`, `requiresAttachment`, and `requiresSecondApproval` are seeded **on**.
- **Two-person floor:** a HIGH-risk line always requires a reason and a note, and — whenever the org has a second human capable of approving — the user who added the line can never be its sole approver, even if the org relaxes `requiresSecondApproval`. This implements the spec's separation-of-duties requirement as a default-on policy rather than opt-in (Product Principle 7: security by default).
- **Sole-user exception (D18 resolution):** an org with exactly one active human user (a single-CFI school) can still bill a damage fee — routing through platform support is not acceptable behavior. When the approval engine finds no second capable approver in the org, the adder may self-approve the HIGH-risk line, but only with a **mandatory attachment and reason**, and the approval is audit-flagged **`SELF_APPROVED_SOLE_USER`** so the exception is visible in every audit trail and report. The moment a second capable human exists in the org, the two-person floor applies again automatically. This is designed behavior, not a workaround: the approval mechanics live in [04-revenue-review.md](./03-revenue-review-lifecycle.md) §2.8, and [16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md) D18 records the decision — both are aligned to this resolution.
- Relaxing `requiresSecondApproval` or `requiresAttachment` on a HIGH-risk item requires `revenue.items_manage` *and* `settings.manage`, shows an explicit confirmation, and is audited with before/after values.
- HIGH-risk lines render with a distinct warning treatment (new `STATUS_TONE` entries — never a second color map).

---

## 3. Configuration surface

### 3.1 Per-item fields (org-level, all editable)

| Field | Type / options | Default | Notes |
|---|---|---|---|
| Name | text | — (required) | Display name; editable freely (lines snapshot it) |
| Code | slug | auto from name | Stable machine key; immutable after creation; seed uses known codes |
| Description | text | empty | Shown in picker and on Revenue Review detail |
| Category | `RevenueItemCategory` | `CUSTOM` | Drives grouping, defaults, and legacy `LineItemKind` projection (§3.3) |
| Default amount | money or empty | empty | Empty = user must enter (variable) or item unusable until set (fixed) |
| Fixed or variable | `FIXED` / `VARIABLE` | `VARIABLE` | Fixed locks line amount to default amount |
| Unit basis | per-hour / per-landing / per-flight / per-day / per-unit / fixed | `FIXED` | §2.3 |
| Unit label | text | empty | Only for `PER_UNIT` (e.g. "quart") |
| Min / max amount | money, optional | empty | Guardrails for variable amounts (typo and abuse protection) |
| Currency | ISO 4217 | org currency (`USD`) | Must match org currency in Part 1 (single-currency reviews) |
| Taxable (`isTaxable`) | boolean | `false` (`true` for RETAIL seeds) | Default tax treatment only; rules and snapshots live in [07-taxes.md](./07-tax-model.md). AeroOps never asserts tax law — orgs confirm their own treatment |
| Requires note | boolean | `false` | Supporting note mandatory at add |
| Requires attachment | boolean | `false` | Linked `Document` mandatory before review submission (§5 V7) |
| Requires second approval | boolean | `false` | Line forces the review into the second-approval path |
| Risk level | `NORMAL` / `HIGH` | `NORMAL` | HIGH applies the non-configurable floor (§2.5) |
| Available locations | multi-select of org `Location`s | all (empty set = everywhere) | Join table, FK-safe |
| Available programs | multi-select of org `Syllabus`es | all | "Program" = existing `Syllabus` model |
| Available aircraft | multi-select of org `Aircraft` | all | e.g. Cleaning Fee only on rental fleet |
| Default accounting category | code from the org's accounting-category list | empty | Snapshotted onto lines; consumed by Part 3 Financial Export (§8) |
| Active | boolean | `true` | Gates new adds only |
| Effective dates | from / to, optional | empty | Evaluated in the org time zone |
| Display order | integer | 0 | Picker ordering within category |

### 3.2 Built-in catalog (seeded per organization, `isSystem = true`, fully editable)

All 26 items from spec Part F. Default amounts ship **empty** — pricing differs too much between a Part 61 club and a university program to guess, and a wrong seeded price is worse than a prompt (open question O1). Taxability defaults to `false` except retail goods; orgs must confirm their jurisdiction's treatment.

| Item | Code | Category | Unit basis | Amount mode | Taxable | Note / Attach / 2nd appr. | Legacy `LineItemKind` |
|---|---|---|---|---|---|---|---|
| Airport Fee | `airport_fee` | AIRPORT_FEE | FIXED | VARIABLE | no | – / – / – | OTHER |
| Airport Landing Fee | `airport_landing_fee` | AIRPORT_FEE | PER_LANDING | VARIABLE | no | – / – / – | OTHER |
| Landing Fee | `landing_fee` | AIRPORT_FEE | PER_LANDING | VARIABLE | no | – / – / – | OTHER |
| Ramp Fee | `ramp_fee` | AIRPORT_FEE | FIXED | VARIABLE | no | – / – / – | OTHER |
| Parking Fee | `parking_fee` | AIRPORT_FEE | PER_DAY | VARIABLE | no | – / – / – | OTHER |
| Overnight Fee | `overnight_fee` | AIRPORT_FEE | PER_DAY | VARIABLE | no | – / – / – | OTHER |
| Fuel Surcharge | `fuel_surcharge` | FUEL_OIL | PER_HOUR | VARIABLE | no | – / – / – | FUEL_SURCHARGE |
| Oil Charge | `oil_charge` | FUEL_OIL | PER_UNIT ("quart") | FIXED | no | – / – / – | OTHER |
| Cleaning Fee | `cleaning_fee` | AIRCRAFT_FEE | FIXED | VARIABLE | no | ✓ / – / – | OTHER |
| **Damage Fee** | `damage_fee` | AIRCRAFT_FEE | FIXED | VARIABLE | no | ✓ / ✓ / ✓ · **HIGH risk** | OTHER |
| Late Return Fee | `late_return_fee` | AIRCRAFT_FEE | PER_HOUR | VARIABLE | no | ✓ / – / – | OTHER |
| Cancellation Fee | `cancellation_fee` | SCHEDULING_FEE | FIXED | FIXED | no | ✓ / – / – | OTHER |
| No-Show Fee | `no_show_fee` | SCHEDULING_FEE | FIXED | FIXED | no | ✓ / – / – | OTHER |
| Checkride Preparation | `checkride_prep` | INSTRUCTION | PER_HOUR | VARIABLE | no | – / – / – | GROUND_INSTRUCTION |
| Examiner Fee | `examiner_fee` | ADMINISTRATIVE | FIXED | VARIABLE | no | ✓ / – / – | OTHER |
| Training Materials | `training_materials` | RETAIL | PER_UNIT ("each") | VARIABLE | **yes** | – / – / – | SUPPLY |
| Books | `books` | RETAIL | PER_UNIT ("each") | VARIABLE | **yes** | – / – / – | SUPPLY |
| Headset Rental | `headset_rental` | RETAIL | PER_FLIGHT | FIXED | **yes** | – / – / – | SUPPLY |
| Discovery Flight Upgrade | `discovery_flight_upgrade` | INSTRUCTION | FIXED | FIXED | no | – / – / – | OTHER |
| Ground School | `ground_school` | INSTRUCTION | FIXED | VARIABLE | no | – / – / – | GROUND_INSTRUCTION |
| Simulator Time | `simulator_time` | INSTRUCTION | PER_HOUR | VARIABLE | no | – / – / – | SIMULATOR_TIME |
| Membership Fee | `membership_fee` | MEMBERSHIP | FIXED | FIXED | no | – / – / – | MEMBERSHIP_FEE |
| Club Dues | `club_dues` | MEMBERSHIP | FIXED | FIXED | no | – / – / – | MEMBERSHIP_FEE |
| Administrative Fee | `administrative_fee` | ADMINISTRATIVE | FIXED | VARIABLE | no | ✓ / – / – | OTHER |
| Merchandise | `merchandise` | RETAIL | PER_UNIT ("each") | VARIABLE | **yes** | – / – / – | SUPPLY |
| Custom Line Item | `custom_line_item` | CUSTOM | FIXED | VARIABLE | no | ✓ / – / – | OTHER |

Seed notes:

- **Empty amounts leave deviation warnings inert.** The review-lifecycle amount-deviation warning W6 ([04-revenue-review.md](./03-revenue-review-lifecycle.md)) compares a line's amount against the item's `defaultAmount` — so with all built-ins seeded amount-empty, W6 cannot fire for an item until the org sets a default amount on it. The catalog UI must say so (a hint on items without amounts), so orgs understand this guardrail activates through configuration rather than assuming it is already protecting them.
- **Examiner Fee** is a pass-through collection for the DPE; the description says so, and its accounting category should map to a liability/pass-through account — the Aviation Accounting Specialist recommendation surfaced in the catalog UI, not enforced.
- **Simulator Time / Checkride Prep / Ground School** overlap instructor time entry. The catalog items exist for flat-fee billing; instruction billed by the hour should flow through Instructor Rate Profiles ([05-pricing-and-rates.md](./05-aircraft-pricing-profiles.md)). The picker shows a hint when both paths could apply.
- **Fuel Surcharge** supersedes the display-only `Aircraft.fuelSurchargePerHr` column: Part 2 seeds a per-aircraft Revenue Rule from any non-null value (coordinate with [05-pricing-and-rates.md](./05-aircraft-pricing-profiles.md) and the migration plan in [13-database-model.md](./13-database-model.md)). The column is retained (additive-only) and demoted to informational.
- There is deliberately **no "Late Payment Fee" built-in** — the existing `LATE_FEE` line kind covers legacy invoices; payment-lifecycle fees are a payment-timing concern deferred to Part 2.
- Seeding runs at org provisioning for new orgs and as a separate idempotent data-only backfill (upsert on `[organizationId, code]`) for existing orgs, after the DDL migration — the standard two-step pattern. Both demo seed orgs (demo org and Blue Ridge Flying Club) receive the catalog so multi-tenant fixtures exercise it.

### 3.3 Relationship to `LineItemKind` — freeze, don't extend

**Recommendation: freeze the enum; Revenue Items supersede it as the charge typology.** (Binding call: [13-database-model.md](./13-database-model.md).)

- `LineItemKind` keeps its current 10 values forever (enum values are never dropped — SUPER_ADMIN precedent). No new values are added: extending it would create two parallel typologies, and every addition costs a dedicated enum migration.
- New lines carry `revenueItemId` (provenance) and a snapshot of category/code. Where an `InvoiceLine` is materialized from an approved Revenue Review, `InvoiceLine.kind` is populated via the **legacy projection** in the table above (a pure function `legacyKindFor(category, code)` in the pricing engine, contract-tested) so every existing consumer — billing pages, health-score, insights, mission-control, customer-success, search, AI ask, Import Center — keeps working unchanged.
- `InvoiceLine` gains a nullable `revenueItemId` column (additive) so exports and reconciliation can trace legacy-shaped lines back to the catalog. Existing seeded/imported invoice rows keep `revenueItemId = null` and are never reinterpreted.

---

## 4. Data model proposal

Prisma-flavored; field-level detail is authoritative for intent, but **[13-database-model.md](./13-database-model.md) makes the binding schema call** (including the repo-wide `Decimal(12,2)` + ISO 4217 currency decision, which this design follows). All models obey house rules: real `Organization` FK with explicit `onDelete`, tenant-scoped uniques, `createdAt`, org-leading indexes.

### 4.1 `RevenueItem` and enums

```prisma
enum RevenueItemCategory {
  AIRPORT_FEE      // airport, landing, ramp, parking, overnight
  FUEL_OIL         // fuel surcharge, oil
  AIRCRAFT_FEE     // cleaning, damage, late return
  SCHEDULING_FEE   // cancellation, no-show
  INSTRUCTION      // checkride prep, ground school, simulator, discovery upgrade
  RETAIL           // materials, books, headsets, merchandise
  MEMBERSHIP       // membership fees, club dues
  ADMINISTRATIVE   // admin fees, examiner (pass-through) fees
  CUSTOM
}

enum RevenueItemUnitBasis {
  PER_HOUR
  PER_LANDING
  PER_FLIGHT
  PER_DAY
  PER_UNIT   // quantity in unitLabel units (quart, each)
  FIXED      // quantity locked at 1
}

enum RevenueItemAmountMode {
  FIXED      // line amount locked to defaultAmount
  VARIABLE   // amount entered per line, within min/max
}

enum RevenueItemRisk {
  NORMAL
  HIGH       // enhanced approval floor (damage fees)
}

model RevenueItem {
  id             String                @id @default(cuid())
  organizationId String
  code           String                // stable machine key, immutable; seed uses known codes
  name           String
  description    String?
  category       RevenueItemCategory   @default(CUSTOM)
  unitBasis      RevenueItemUnitBasis  @default(FIXED)
  unitLabel      String?               // PER_UNIT only, e.g. "quart"
  amountMode     RevenueItemAmountMode @default(VARIABLE)
  defaultAmount  Decimal?              @db.Decimal(12, 2)
  minAmount      Decimal?              @db.Decimal(12, 2)
  maxAmount      Decimal?              @db.Decimal(12, 2)
  currency       String                @default("USD") @db.Char(3) // ISO 4217
  isTaxable      Boolean               @default(false) // default treatment (R10 house boolean prefix); rules in 07-taxes.md
  riskLevel      RevenueItemRisk       @default(NORMAL)
  requiresNote           Boolean       @default(false)
  requiresAttachment     Boolean       @default(false)
  requiresSecondApproval Boolean       @default(false)
  defaultAccountingCategoryCode String? // Part 3 export seam (§8)
  isActive       Boolean               @default(true)
  isSystem       Boolean               @default(false) // seeded built-in
  effectiveFrom  DateTime?
  effectiveTo    DateTime?
  displayOrder   Int                   @default(0)

  organization Organization          @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  locations    RevenueItemLocation[]
  programs     RevenueItemProgram[]
  aircraft     RevenueItemAircraft[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([organizationId, code])
  @@index([organizationId, isActive, category])
}
```

Availability scoping uses three small join tables rather than id arrays, keeping FK integrity (empty set = available everywhere). They are relation-scoped through `RevenueItem` (the documented `Dispatch`/`AircraftComponent` precedent); write paths must verify the referenced `Location`/`Syllabus`/`Aircraft` belongs to the same organization (rule V3).

```prisma
model RevenueItemLocation {
  id            String @id @default(cuid())
  revenueItemId String
  locationId    String
  revenueItem RevenueItem @relation(fields: [revenueItemId], references: [id], onDelete: Cascade)
  location    Location    @relation(fields: [locationId], references: [id], onDelete: Cascade)
  createdAt   DateTime    @default(now())
  @@unique([revenueItemId, locationId])
  @@index([locationId])
}

model RevenueItemProgram {   // "program" = existing Syllabus model
  id            String @id @default(cuid())
  revenueItemId String
  syllabusId    String
  revenueItem RevenueItem @relation(fields: [revenueItemId], references: [id], onDelete: Cascade)
  syllabus    Syllabus    @relation(fields: [syllabusId], references: [id], onDelete: Cascade)
  createdAt   DateTime    @default(now())
  @@unique([revenueItemId, syllabusId])
  @@index([syllabusId])
}

model RevenueItemAircraft {
  id            String @id @default(cuid())
  revenueItemId String
  aircraftId    String
  revenueItem RevenueItem @relation(fields: [revenueItemId], references: [id], onDelete: Cascade)
  aircraft    Aircraft    @relation(fields: [aircraftId], references: [id], onDelete: Cascade)
  createdAt   DateTime    @default(now())
  @@unique([revenueItemId, aircraftId])
  @@index([aircraftId])
}
```

### 4.2 Fields this design contributes to `InvoiceLine`

There is no separate review-line model: Revenue Review lines *are* `InvoiceLine` rows on the review's wrapped draft Invoice, and this design's line fields land on `InvoiceLine` as **additive nullable columns** ([13-database-model.md](./13-database-model.md) §3 R1; final shape §4.2.3 there). Review mechanics stay with [04-revenue-review.md](./03-revenue-review-lifecycle.md). Revenue Items contribute this field set:

```prisma
enum RevenueLineOrigin {
  PRICING         // aircraft pricing engine (05-pricing-and-rates.md)
  INSTRUCTOR_TIME // generated from an instructor time entry (BILLING rate)
  RULE            // Revenue Rule fired at draft generation (reserved seam — 13 §12 Q3; model lands in Part 2)
  CHECK_IN        // fee captured on the aircraft-return form
  MANUAL          // added by an authorized user on the review
  ADJUSTMENT      // materialized by an applied adjustment (08-adjustments.md)
}

// Existing InvoiceLine columns REUSED, never re-typed (R21):
//   description String                      — doubles as the item-name snapshot at add time
//   quantity    Decimal @db.Decimal(8, 2)   — meaning defined by unitBasis; FIXED forces 1
//   unitPrice   Decimal @db.Decimal(10, 2)  — signed; FIXED amountMode locks it to defaultAmount

// Contributed to model InvoiceLine (all additive, nullable or defaulted) —
// snapshot + manual-control fields; pre-Phase-8 rows keep them null/default:
  origin        RevenueLineOrigin?   // null = legacy row created before the Revenue Engine (R2)
  revenueItemId String?              // FK → RevenueItem, onDelete: Restrict (provenance survives; items deactivate, not delete)
  itemCode      String?              // immutable item-code snapshot at add
  unitBasis     RevenueItemUnitBasis?
  unitLabel     String?              // PER_UNIT display unit, e.g. "quart"
  isTaxable     Boolean?             // snapshot of default treatment (R10); authoritative tax = TaxSnapshot at approval per 07-taxes.md
  accountingCategoryCode String?               // snapshot at add — Part 3 export seam
  reason        String?                        // mandatory for origin = MANUAL
  note          String?
  attachmentDocumentId String?                 // org-verified Document
  addedByUserId String?                        // bare id (AuditLog.actorUserId convention) — needed on-row for separation-of-duties
  addedByLabel  String?                        // display name, ImportJob.createdByLabel precedent
  requiresSecondApproval Boolean @default(false) // snapshot of item config at add time
  createdAt     DateTime @default(now())         // legacy rows backfill to migration time
```

There is **no `lineTotal` column and no per-line `currency`** (R21): line totals are derived at read (`quantity × unitPrice`, server-side Decimal — client-supplied totals are never trusted) and freeze on `Invoice.subtotal/taxTotal/total` at approval; currency inherits from the document.

### 4.3 `InvoiceLine` legacy compatibility

`InvoiceLine.kind` remains and is populated from the legacy projection (§3.3). No column is renamed or re-typed, no enum value is added or removed, and existing rows are never reinterpreted — every new column in §4.2 is nullable or defaulted, and pre-Phase-8 rows keep `origin = null` / `revenueItemId = null`.

### 4.4 Migration & fixtures

- One additive DDL migration (four enums, four models, and the additive `InvoiceLine` columns from §4.2, sequenced per [13-database-model.md](./13-database-model.md)), followed by a separate idempotent data-only backfill seeding the built-in catalog per existing org (upsert on `[organizationId, code]`) — the two-step pattern from `DATABASE_STANDARDS.md`.
- New tables join `org-snapshot.ts` capture/wipe/restore: `RevenueItem` wipes after all referencing lines/invoices (Restrict), join tables cascade with it.
- Seed (`prisma/seed.ts`) adds: catalog for both orgs, one review fixture with a `CHECK_IN` landing fee, one `MANUAL` cleaning fee with note, and one HIGH-risk damage-fee line awaiting second approval — feeding the spec's fresh/seeded/multi-org validation matrix. Demo logins untouched.

---

## 5. Validation & business rules

Engine-enforced in `src/lib` (routes stay thin); every rule returns an actionable error. **Block** = 400/403/404; **Warn** = surfaced on the review, non-blocking (spec: warnings never block operational closeout unless configured blocking).

| # | Rule | Severity |
|---|---|---|
| V1 | Item's `organizationId` must equal the review's org (from session). Cross-tenant item id → 404. | Block |
| V2 | Item must be `isActive` and within `effectiveFrom`/`effectiveTo` (org time zone) **at add time**. Deactivation never affects existing lines. | Block |
| V3 | Availability join-table writes verify the `Location`/`Syllabus`/`Aircraft` belongs to the same org. | Block |
| V4 | Item must be available for the review's location, program, and aircraft (empty scope = everywhere). | Block (picker hides; API rejects) |
| V5 | `amountMode = FIXED`: line `unitPrice` must equal `defaultAmount`; an item with `FIXED` mode and null `defaultAmount` cannot be added. `VARIABLE`: amount required, `> 0`, within `minAmount`/`maxAmount` when set. Negative amounts are never Revenue Items — discounts/credits/waivers are adjustments ([08-adjustments.md](./08-adjustments-discounts-credits.md)). | Block |
| V6 | `quantity > 0`; `FIXED` basis forces quantity 1; line totals derived server-side in Decimal (`quantity × unitPrice` — no stored `lineTotal` column, R21); client-supplied totals are never trusted. | Block |
| V7 | `reason` mandatory for every `MANUAL` line. `requiresNote` → note mandatory at add. `requiresAttachment` → line may be saved on a Draft, but the review cannot be **submitted** until the attachment (org-verified `Document`) is linked — a dispatcher can add the fee at return and attach the airport receipt later the same day. | Block at add / at submit |
| V8 | Item `currency` must equal the review currency (single-currency reviews in Part 1; lines carry no currency column — currency inherits from the document, R21). | Block |
| V9 | Lines are immutable once the review is approved and locked; corrections are adjustment records only. Before approval, `MANUAL` lines may be edited/removed only in `Draft`/`Changes Requested`, and every post-submission change is audited. | Block |
| V10 | Quantity plausibility per unit basis (§2.3): PER_HOUR vs elapsed time, PER_LANDING vs recorded landings, PER_DAY vs dispatch window. | Warn (org may configure blocking) |
| V11 | Same item added more than once manually on one review (two airport fees at two fields is legitimate). | Warn |
| V12 | HIGH-risk floor: reason + note always required; adder ≠ sole approver whenever a second capable approver exists in the org (§2.5). Orgs with exactly one active human take the audited sole-user exception path — mandatory attachment + reason, `SELF_APPROVED_SOLE_USER` audit flag — instead of being blocked (D18 resolution). | Block |
| V13 | Missing expected fee *(reserved — Part 2)*: no Revenue Rule model is defined in Part 1 — `RULE` is a reserved line origin ([13-database-model.md](./13-database-model.md) §12 Q3) and the model lands additively in Part 2 per [16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md) §4.1. Once it lands, a rule targeting the dispatch's aircraft/location that could not fire (e.g. inactive item) surfaces an "expected fee missing" warning on the review. | Warn |

---

## 6. RBAC, approvals & audit

**Permissions** (data in `src/lib/permissions.ts`; never role checks — approval chains are permission keys + org config per ADR-006):

| Key | Grants | Default roles |
|---|---|---|
| `revenue.items_manage` | Create/edit/deactivate catalog items; edit availability and accounting categories | ACCOUNT_OWNER, SCHOOL_ADMIN, ACCOUNTANT |
| `revenue.review_edit` *(owned by [04-revenue-review.md](./03-revenue-review-lifecycle.md))* | Add/edit/remove manual lines on Draft / Changes Requested reviews | Ops roles per 04 |
| `revenue.approve_second` *(owned by 04)* | Provide the second approval demanded by `requiresSecondApproval` lines | Per 04 |

The permission-prefix→module mapping (`MODULE_BY_PREFIX` in `src/lib/session.ts` gates only `billing.*` today) must gate `revenue.*` under the billing module (or a new `revenue` module) — decided once for the whole design set in [02-architecture.md](./01-revenue-engine-architecture.md). Nav/section entries join `SECTION_PERMISSIONS`. Read-only impersonation and read-only API keys are refused by `{mutating: true}` on every route automatically.

**Approvals:** items only *declare* requirements (`requiresSecondApproval`, HIGH-risk floor); the approval state machine, thresholds, and separation-of-duties policy evaluation live in [04-revenue-review.md](./03-revenue-review-lifecycle.md). The line's snapshot of `requiresSecondApproval` at add time is what binds — reconfiguring the item later never changes an in-flight review.

**Audit** (every mutation via `recordAudit`, old/new values, impersonation attribution automatic):

| Action | When | Metadata |
|---|---|---|
| `revenue_item.created` / `revenue_item.updated` / `revenue_item.deactivated` / `revenue_item.reactivated` | Catalog mutations | Full before/after; HIGH-risk relaxations flagged in metadata |
| `revenue_review.line_added` | Any line lands on a review (all origins) | Origin, item code, snapshot, quantity, amount, reason, actor, rule id when `origin = RULE` |
| `revenue_review.line_updated` / `revenue_review.line_removed` | Pre-approval edits (V9) | Before/after amounts — the spec's actor/reason/before-after triple |

No new domain events are needed for the catalog itself; line-level events belong to the review lifecycle (04). No AI pathway may create or mutate items or lines.

---

## 7. UX notes (aviation-native, operational workflow first)

- **Aircraft return is not accounting.** The return form shows a compact **"Fees at return"** strip — Landing, Ramp, Parking, Overnight, Fuel — filtered by availability for that aircraft/location, each a two-tap add (amount + optional airport identifier in the note). Landing-fee quantity prefills from the recorded landing count. Everything else waits for the Revenue Review. A dispatcher never sees the words "taxable" or "accounting category" at the aircraft.
- **Catalog management** lives at Settings → Revenue Engine → Revenue Items: grouped by category, active/inactive filter, `System` badge on seeded items, inline effective-date and availability editing. Empty state explains the built-in catalog is already live and pricing just needs amounts.
- **Picker on the Revenue Review:** searchable, grouped by category, most-used-first within `displayOrder`; requirement chips (Note · Attachment · 2nd approval) visible before selection; FIXED-mode amounts render locked with the catalog price.
- **Damage-fee flow:** selecting a HIGH-risk item switches the add dialog to a warning tone (new `STATUS_TONE` entries only), demands note + photo/document, and banners "Requires second approval before this review can be charged."
- **Suggested quantities show their basis** ("3 landings recorded at return") and are editable — suggestions, never silent determinations.
- Terminology: "fees" and "charges", never "accruals" or "debits"; dispatch/release/return/closeout vocabulary throughout; design-system components, light + dark + mobile parity, loading/empty/error states included.

---

## 8. Interactions with other Revenue Engine components

| Sibling | Interaction |
|---|---|
| [01-revenue-engine-architecture.md](./01-revenue-engine-architecture.md) | `revenue.*` permission-prefix module gating; check-in→return terminology resolution. Revenue Rules: owns the Part 1 position (§7.1) — no Revenue Rule model or evaluation order in Part 1; `RevenueLineOrigin.RULE` is reserved, items are the rule *target* (§2.2 here binds the item-side contract), and the model is added additively in Part 2 only if D43 confirms ([13-database-model.md](./13-database-model.md) §12 Q3; [16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md) §2.2 D43, §4.1) |
| [03-operational-checkout.md](./02-operational-dispatch-and-closeout.md) | Return-form fee capture produces `CHECK_IN` lines on the draft review created at operational closeout; fee capture never blocks or delays closeout |
| [04-revenue-review.md](./03-revenue-review-lifecycle.md) | Owns review statuses, submission/approval mechanics, second-approval path triggered by line snapshots, separation-of-duties policy evaluation. Review lines are `InvoiceLine` rows on the wrapped draft Invoice ([13-database-model.md](./13-database-model.md) §3 R1) |
| [05-pricing-and-rates.md](./05-aircraft-pricing-profiles.md) | Aircraft rental and instructor/simulator instruction time come from pricing/rate profiles (`origin = PRICING`), **not** Revenue Items; fuel-surcharge migration from `Aircraft.fuelSurchargePerHr`; hourly-instruction vs flat-fee-item overlap hints |
| [07-taxes.md](./07-tax-model.md) | Item `isTaxable` is the default treatment only; jurisdiction rules, per-line tax override permission, and the approval-time `TaxSnapshot` live there |
| [08-adjustments.md](./08-adjustments-discounts-credits.md) | All negative money (discounts, credits, waivers) and all post-approval corrections; editing a FIXED-mode amount is an adjustment, not a manual add |
| [13-database-model.md](./13-database-model.md) | Binding schema call: model/enum names, `Decimal(12,2)` + currency standard, final `InvoiceLine` shape (review lines are `InvoiceLine` rows, §3 R1/R21), migration sequencing, org-snapshot wiring |
| Part 3 — Financial Export | `defaultAccountingCategoryCode` (snapshotted per line) is the export seam: Part 3's `AccountingMapping` maps org category codes → QuickBooks/Xero accounts. Part 1 keeps categories as org-defined codes so the mapping model can land later without reshaping items or lines |

---

## 9. Out of scope for Part 1 / deferred to Parts 2–3

- **Revenue Rule model, builder, and evaluation engine** — Part 2, added additively if confirmed (`RevenueLineOrigin.RULE` reserved; [13-database-model.md](./13-database-model.md) §12 Q3, [16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md) §4.1); Part 1 defines only the item-side contract and line snapshot.
- **`AccountingMapping` model and Financial Export jobs** — Part 3; Part 1 ships the category-code seam only.
- **Stripe metadata on lines** (product/price references) — Part 2 payments work.
- Promotional codes, waivers, credits, negative lines — [08-adjustments.md](./08-adjustments-discounts-credits.md).
- Prepaid packages, wallet balances, invoice merging — explicitly excluded by spec Part H.
- Multi-currency catalogs (item currency ≠ org currency), per-payer item pricing, per-item revenue-allocation overrides.
- Inventory/stock integration for RETAIL items (the `Part`/`InventoryMovement` system stays maintenance-only).
- Automatic OVERDUE/late-payment fees — payment-timing territory, Part 2.

---

## 10. Open questions

1. **O1 — Seeded default amounts.** Ship all built-ins with empty amounts (recommended: forces a deliberate pricing decision) or opinionated placeholder prices? Product-owner call; affects onboarding friction.
2. **O2 — HIGH-risk floor configurability.** *Resolved (D18, [16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md)):* the "adder ≠ sole approver" floor stands whenever a second capable human exists in the org, with no org-configurable off switch; orgs with exactly one active human get the audited sole-user exception (mandatory attachment + reason, `SELF_APPROVED_SOLE_USER` audit flag) rather than being unable to bill — see §2.5. [04-revenue-review.md](./03-revenue-review-lifecycle.md) §2.8 carries the matching approval mechanics.
3. **O3 — Accounting categories: codes vs model.** Part 1 proposes free org-defined codes on items (`defaultAccountingCategoryCode`) with the `AccountingMapping` model deferred to Part 3. If the org wants export-ready chart-of-accounts structure sooner, a minimal `AccountingCategory` model could land in Part 1 — binding call belongs to [13-database-model.md](./13-database-model.md) with product-owner input on Part 3 timing.
4. **O4 — "Custom Line Item" built-in.** Keep it (fast escape hatch, `requiresNote` on) or drop it to force named catalog items (better reporting hygiene)? Recommended: keep, monitor usage, nudge heavy users toward named items.
5. **O5 — PER_DAY day counting.** Calendar days in org time zone (recommended, matches how FBOs bill overnight parking) vs 24-hour blocks vs nights-away count — Director of Operations input needed before Part 2 implements the suggestion logic.
