# Tax Model

> **Status:** Proposed — Phase 8 Part 1 · **Date:** 2026-07-10 · **Lead roles:** Aviation Accounting Specialist; Principal Payments Architect at Stripe · **Part of:** Revenue Engine design set ([README](./README.md))

Design for spec **Part G — Taxes** (Part 1 deliverable 9). Design only: no schema, code, or migration changes ship with this document. Final field types, precisions, and the binding cross-model shapes are ratified in [13-database-model.md](./13-database-model.md).

---

## 1. Purpose & scope

Give every organization a configurable, versioned, auditable way to apply taxes to Revenue Review charges — without AeroOps ever encoding tax law.

In scope for Part 1 (design) and Part 2 (implementation):

- **No-tax default.** A fresh organization computes zero tax everywhere with zero setup. Today's schema has no tax fields at all (schema audit: zero tax models, columns, or flags), so this is also the migration-safe posture: existing seeded and imported invoices are never reinterpreted as taxed or untaxed — they simply predate the tax system.
- **Organization-level and location-level tax rules** (flat percentage rates with an org-entered jurisdiction label).
- **Per-charge-category taxability** — aircraft rental and instructor services separately configurable, plus every other line classification.
- **Per-Revenue-Item taxability** (`isTaxable` on the Revenue Item catalog, [06-revenue-items.md](./06-revenue-items.md)).
- **Multi-rate stacking** (e.g. state + county) with explicit rounding rules.
- **Versioned, effective-dated rules** — editing a rule creates a new version; changing a rule never alters an approved Revenue Review.
- **TaxSnapshot at approval** — rate, jurisdiction, taxable base, tax amount, rule version, and applied items are copied into immutable rows inside the approval transaction.
- **A clean calculator seam** so VAT/GST semantics and a Stripe Tax adapter can land in Part 3 without touching consumers.

### Explicit non-goals (permanent posture, not deferrals)

- **AeroOps does not compute, determine, or guarantee legal tax treatment.** The engine applies exactly the rules the organization configures. Whether aircraft rental is taxable in Georgia, whether dual instruction is an exempt educational service, whether the org has nexus anywhere — those are the organization's decisions, made with its own tax professional.
- **No hardcoded tax law.** No jurisdiction database, no rate tables, no address-based rate lookup, no nexus logic, no filing or remittance. Rates and jurisdictions are org-entered strings and numbers.
- **Required product disclaimer**, shown on the tax settings page and in customer-facing documentation:

> *AeroOps calculates tax using only the rules your organization configures. AeroOps does not determine, advise on, or guarantee the legal tax treatment of any charge. Your organization is responsible for confirming its tax obligations with a qualified tax professional.*

---

## 2. How it works

### 2.1 Where tax fits in the Revenue Review lifecycle

Tax touches exactly three moments, none of them operational:

```
Aircraft returned (01-operational-checkout.md)
  └─ operational closeout tx — NO tax logic, NO tax writes
Draft Revenue Review (02-revenue-review.md)
  └─ tax PREVIEW: pure engine computes estimated tax on every line change,
     with reasons ("Georgia Sales Tax 4.00% applied to Aircraft rental —
     charge class AIRCRAFT_RENTAL matches rule; base $264.60")
Approval ("Approve Revenue Review and charge the saved payment method")
  └─ inside the approval $transaction: recompute from the same resolved
     inputs, write TaxSnapshot (+ items) rows, persist Invoice.taxTotal
     in the invoice's locked totals block (13 R13). Append-only from
     this point forever.
```

Dispatchers and instructors never see a tax decision during checkout or return. Operational closeout (do-not-break rule 5) is untouched: no tax reads, no tax writes, and — as everywhere in this design set — no external calls inside any DB transaction.

### 2.2 Tax rule lifecycle (state machine)

A rule family is identified by a stable `ruleKey`; each row is one immutable version.

```
            create
              │
              ▼
   ┌──────────────────────┐   edit ⇒ new version row     ┌─────────────┐
   │ ACTIVE (v N)         │ ───────────────────────────► │ ACTIVE (vN+1)│
   │ effectiveStart..End  │   vN gets effectiveEnd =     └─────────────┘
   └──────────┬───────────┘   vN+1.effectiveStart
              │ deactivate (isActive=false, deactivatedAt)
              ▼
   ┌──────────────────────┐
   │ DEACTIVATED          │  never deleted; still referenced by snapshots
   └──────────────────────┘
```

There is no mutable "edit" of a rule's rate, jurisdiction, applicability, or effective window once the version has been used by any TaxSnapshot. Editing always means: close the current version's window and insert the next version. Deactivation stops future application; it never touches history. Rule versions are never hard-deleted (tenant wipe via `org-snapshot.ts` is the sole exception, and it deletes snapshots first).

Display status is **derived** (per DATABASE_STANDARDS "computed at read time"): *Scheduled* (effectiveStart in future), *Active* (window contains now, isActive), *Expired* (window passed), *Deactivated*.

### 2.3 Rule resolution at computation time

Inputs: organization, the review's location, and the **tax point date**.

1. Collect rule versions where `isActive`, the tax point date falls inside `[effectiveStart, effectiveEnd)`, and scope matches: `locationId IS NULL` (org-wide) **or** `locationId = review.locationId`.
2. Org-wide and location rules are **additive** (union), because stacking is the normal case (org-wide state rate + location county rate). Location rules do not replace org rules.
   - *Multi-state guidance (documented in the settings UI):* an organization with locations in different taxing jurisdictions should scope **every** rule to a location and keep zero org-wide rules. Single-jurisdiction orgs use org-wide rules and never think about scope.
3. Each resolved rule computes independently against its own taxable base (§2.4–2.5). No tax-on-tax.

**Tax point date = the service date**: the dispatch return (check-in) timestamp captured by [01-operational-checkout.md](./02-operational-dispatch-and-closeout.md), evaluated in the location's (falling back to the org's) time zone. For reviews with no dispatch (manual invoice, membership fee), the review's creation date. Rationale: US sales tax attaches to the date of sale/service; an org scheduling a rate change for July 1 expects a June 30 flight approved on July 2 to use the June rule. The date actually used is snapshotted (`serviceDate` on TaxSnapshot). See Open Question 1.

### 2.4 Line taxability resolution (deterministic, explainable)

Every Revenue Review line carries a charge classification derived from its provenance — the **frozen** legacy `LineItemKind` plus `RevenueItem` category/origin, per [06-revenue-items.md](./06-revenue-items.md) §3.3 and [13-database-model.md](./13-database-model.md) §5. `LineItemKind` never gains values; `TaxRule.appliesToKinds` holds engine-validated **charge-class keys** from the `src/lib` catalog (13 §4.9) — keys may be spelled `AIRCRAFT_RENTAL`, `INSTRUCTOR_TIME`, `GROUND_INSTRUCTION`, `SIMULATOR_TIME`, `FUEL_SURCHARGE`, …, but they are catalog strings, never `LineItemKind` enum values, and never enum additions. The engine derives each line's charge-class key from its classification snapshot: the frozen `kind` for legacy lines, and the `RevenueItem` category/origin snapshot for catalog lines (this is the value mirrored into `TaxSnapshotItem.lineKind` at approval — so per-category taxability like "tax headset rental, not landing fees" works even though both project to legacy kind `OTHER`). "Aircraft rental vs instructor services separately configurable" falls out naturally: they are distinct charge classes, and every rule declares exactly which classes it applies to.

A line enters rule R's taxable base **iff both** hold:

- **Scope:** the line's charge-class key ∈ `R.appliesToKinds`, and
- **Treatment:** the line's resolved treatment is not `NON_TAXABLE`.

Treatment resolves top-down, first match wins:

| Priority | Source | Notes |
|---|---|---|
| 1 | Manual per-line override on the draft review (`taxTreatmentOverride`) | Requires the adjustment permission ([08-adjustments-and-credits.md](./08-adjustments-discounts-credits.md)), a required reason, and `recordAudit` |
| 2 | Pricing/rate profile `taxTreatment` | The "Tax treatment" field on Aircraft Pricing Profile ([04-aircraft-pricing-profiles.md](./05-aircraft-pricing-profiles.md)) and Instructor Rate Profile ([05-instructor-rates.md](./04-instructor-time-and-rates.md)); `null` = inherit |
| 3 | Revenue Item `isTaxable` flag | Item-based lines only; defaults to `false` (no-tax default) |
| 4 | Default | Taxable *within rule scope* — enabling a rule that covers a charge class is the org's statement that the class is taxed |

A `TAXABLE` resolution never expands a rule's scope: if no active rule covers `SUPPLY`, a supply line accrues no tax, and the engine says so ("no active tax rule applies to charge class SUPPLY"). Every inclusion/exclusion decision is returned as a reason string — the explainable-engine rule ("a number without a why is a bug") applied to tax.

**Negative lines (discounts, credits):** a discount attributed to a specific line or classification (the normal case per 08) reduces the matching rule bases. An unattributed review-level discount reduces each rule's base pro-rata to that rule's share of the review's taxable subtotal (intermediate math at 4 decimal places; each base floored at zero with a warning). Discount semantics themselves are owned by 08; this is the tax-side contract.

### 2.5 Multi-rate stacking and rounding

- **Stacking:** every resolved rule computes on the pre-tax taxable base. State 4.00% + county 3.00% on the same base behaves as 7.00% combined, but produces **two** snapshot rows — one per rule — because remittance, receipts, and reconciliation are per jurisdiction. No compounding (tax-on-tax, Quebec-style) in Part 1; the per-rule snapshot structure leaves room for a `compoundsOn` version field later without reshaping anything.
- **Arithmetic:** Prisma `Decimal` end-to-end. The tax engine never does JS float math (unlike the legacy `src/lib/billing.ts` float helpers, which this design set supersedes — see 13-database-model.md).
- **Rounding mode:** `HALF_UP` to currency minor units (2 decimals). Org-configurable enum with only `HALF_UP` implemented in Part 2; `HALF_EVEN` reserved.
- **Rounding level** (org-configurable, snapshotted):
  - `PER_RULE_TOTAL` (**default**): `taxAmount = round2(Σ taxable line amounts × rate)`. One rounding per rule per review — matches how US sales tax is filed (on totals) and keeps receipts stable.
  - `PER_LINE`: round each line's tax, sum per rule. For orgs needing line-level tax display parity with an external system. Snapshot items then carry per-line `taxAmount`.

**Worked example** (default mode): 1.4 hr rental @ $189.00 = $264.60 (taxable); 1.9 hr dual instruction @ $85.00 = $161.50 (org configured instructor services non-taxable). Rules: "Georgia Sales Tax" 4.0000% (org-wide) + "Cobb County SPLOST" 3.0000% (location KRYY).

| Rule | Base | Raw | Rounded |
|---|---|---|---|
| Georgia Sales Tax 4.00% | 264.60 | 10.5840 | **10.58** |
| Cobb County SPLOST 3.00% | 264.60 | 7.9380 | **7.94** |
| **taxTotal** | | | **18.52** |

Mode divergence example: two $10.05 lines at 7.5% → `PER_RULE_TOTAL` gives round2(20.10 × 0.075) = **1.51**; `PER_LINE` gives 0.75 + 0.75 = **1.50**. Both are legitimate; that is why the level is snapshotted.

### 2.6 Approval: writing the TaxSnapshot

Inside the Revenue Review approval `$transaction` ([02-revenue-review.md](./03-revenue-review-lifecycle.md)):

1. Recompute tax with the **internal** engine from the freshly resolved inputs (pure function — no I/O inside the tx), or, for a future external provider, verify the pre-fetched quote's `inputHash` still matches the review's lines and abort with an actionable 400 ("Charges changed after the tax quote — reopen and re-review taxes") if not.
2. Insert one `TaxSnapshot` row per applied rule and one `TaxSnapshotItem` row per applied line, copying every value (rate, jurisdiction, base, amount, rule version, rounding config, service date, currency).
3. Persist `Invoice.taxTotal` in the invoice's locked totals block (`Invoice.subtotal/taxTotal/total`, 13 R13). The review itself keeps only `totalAtApproval` + `approvalSnapshot`.

Snapshots are **append-only point-in-time financial facts**, not caches: they are the explicit ADR carve-out from DATABASE_STANDARDS' "computed values are never stored" rule (the design set's ADR proposal records this distinction). Deactivating a rule tomorrow, versioning it, or deleting a location alters nothing already approved. Corrections flow through adjustment/refund records ([08-adjustments-and-credits.md](./08-adjustments-discounts-credits.md) §2.2), which produce their own signed reversal TaxSnapshot delta rows referencing the original — never edits. Reversal snapshot writes ship in **Part 2, in the same release as refund/adjustment execution**, under the invariant: **no refund or post-approval adjustment applies to a taxed review unless its reversal TaxSnapshot rows are written in the same `$transaction`**. Otherwise any month containing a refund would overstate Tax Collected.

If `taxEnabled` is false or no rule applies: no snapshot rows, `taxTotal = 0`, and the engine's reasons record why. Zero rows on a fresh org is the correct, silent default.

### 2.7 The calculator seam (future VAT/GST and Stripe Tax)

One interface, one factory, following the `src/lib/storage.ts` adapter blueprint (interface + default implementation + factory that selects on config and **fails loudly on partial configuration**):

```ts
// src/lib/tax.ts — pure internal engine + the seam (Part 2)
export type TaxProviderKind = 'INTERNAL' | 'STRIPE_TAX';

export interface TaxCalculator {
  readonly provider: TaxProviderKind;
  /** Pure/synchronous for INTERNAL; network-backed for STRIPE_TAX. */
  quote(input: TaxQuoteInput): Promise<TaxQuoteResult>;
}

export type TaxQuoteInput = {
  organizationId: string;
  locationId: string | null;
  serviceDate: Date;
  currency: string;                    // ISO 4217
  settings: OrgTaxSettings;            // enabled, rounding mode/level
  rules: TaxRuleRecord[];              // pre-fetched by the caller; engine stays pure
  lines: TaxLineInput[];               // { lineId, chargeClass (catalog key),
                                       //   amount(Decimal, signed),
                                       //   revenueItemTaxable?, profileTaxTreatment?,
                                       //   overrideTreatment? }
};

export type TaxQuoteResult = {
  provider: TaxProviderKind;
  taxes: AppliedTax[];                 // per rule: identifiers, version, rate,
                                       //   base, amount, appliedLines[], reasons[]
  taxTotal: Prisma.Decimal;
  warnings: string[];                  // duplicate-jurisdiction, floored base, …
  inputHash: string;                   // sha256 of canonicalized input — staleness
                                       //   guard for async providers
};

export function getTaxCalculator(settings: OrgTaxSettings): TaxCalculator;
```

Seam rules, fixed now so Part 3 cannot drift:

- `INTERNAL` is the only provider implemented in Part 2. It is a pure, framework-free, contract-tested function (`computeTaxes`) in the `src/lib/billing.ts` tradition, wrapped by the interface.
- **External quotes happen strictly before the approval transaction** (ADR-011 pattern: no external calls inside any DB transaction). The quote's `inputHash` is checked inside the tx; registering the final transaction with the provider (e.g. Stripe Tax `createTaxTransaction`) happens post-commit on the event bus.
- `STRIPE_TAX` selection requires env config (rides `STRIPE_SECRET_KEY`; flagged per PRODUCTION.md §13.2); selecting it while unconfigured **fails closed** with an actionable error at quote time — approval never silently falls back to a different tax computation.
- The snapshot schema already accommodates providers: `provider`, `providerRef` (calculation id), nullable `ratePercent` (provider-computed jurisdictions may not expose a single flat rate), free-text `jurisdictionLabel`. VAT/GST needs (tax-inclusive pricing, reverse charge, registration numbers on receipts) are reserved: `taxRegistrationLabel` exists now; inclusive pricing is explicitly Part 3+ (Open Question 3).

---

## 3. Configuration surface

Org-level settings join the org-scoped Revenue Engine configuration record proposed alongside [09-payment-timing.md](./09-payment-timing-and-collection.md); [13-database-model.md](./13-database-model.md) binds its final home (dedicated settings model vs explicit `Organization` columns — both match the repo's explicit-typed-column pattern; no settings JSON blob).

| Setting | Type / values | Default | Notes |
|---|---|---|---|
| `taxEnabled` | Boolean | **false** | Master switch. Off ⇒ zero tax, zero snapshots, zero UI noise. Strong default per Product Principle 10. |
| `taxProvider` | `INTERNAL` \| `STRIPE_TAX` | `INTERNAL` | `STRIPE_TAX` reserved; selectable only when the Part 3 adapter + env exist. |
| `taxRoundingMode` | `HALF_UP` \| `HALF_EVEN` | `HALF_UP` | `HALF_EVEN` reserved. |
| `taxRoundingLevel` | `PER_RULE_TOTAL` \| `PER_LINE` | `PER_RULE_TOTAL` | §2.5. |
| `taxRegistrationLabel` | String? | null | Org's tax registration/permit number printed on receipts. Safe metadata, never a secret. |
| Tax rules | `TaxRule` rows | none | Unlimited; org-wide or per-location; versioned. |
| Item taxability | `RevenueItem.isTaxable` | false | Owned by 06; consumed here. |
| Category taxability | `TaxRule.appliesToKinds` | — | Aircraft rental vs instructor services (vs simulator, fuel surcharge, …) toggled independently per rule. |
| Profile treatment | `taxTreatment` on pricing/rate profiles | inherit | Owned by 04/05; consumed here (§2.4). |

Everything above is per-organization; nothing is global. Tax config rides the existing **billing module** for plan/profile feature gating.

---

## 4. Data model proposal (Prisma-flavored)

Money columns follow the design set's default of `Decimal(12,2)` plus an explicit ISO 4217 `currency` column; rates use `Decimal(7,4)` (supports 6.2250%-style rates). All models satisfy schema-governance: real `Organization` FK with explicit `onDelete`, tenant-scoped uniques, `createdAt`, org-leading indexes. **13-database-model.md makes the binding call on all types and precisions.**

```prisma
enum TaxTreatment {
  TAXABLE
  NON_TAXABLE
}

enum TaxProvider {
  INTERNAL
  STRIPE_TAX // reserved — Part 3 adapter
}

enum TaxRoundingMode {
  HALF_UP
  HALF_EVEN // reserved
}

enum TaxRoundingLevel {
  PER_RULE_TOTAL
  PER_LINE
}

/// One immutable version of an org- or location-scoped tax rule.
/// Family identified by ruleKey; editing inserts version N+1.
model TaxRule {
  id                String   @id @default(cuid())
  organizationId    String
  locationId        String?  // null = org-wide; set = applies only to reviews at this location
  ruleKey           String   // stable family id (cuid minted at family creation)
  version           Int      @default(1)
  name              String   // "Georgia Sales Tax"
  jurisdictionLabel String   // org-entered, e.g. "State of Georgia" — never derived by AeroOps
  ratePercent       Decimal  @db.Decimal(7, 4) // 6.0000 = 6%
  appliesToKinds    String[] @default([]) // charge-class keys, engine-validated against the
                                          // src/lib catalog (13 §4.9) — never LineItemKind
                                          // enum values; the modules String[] precedent
  effectiveStart    DateTime
  effectiveEnd      DateTime? // exclusive; null = open-ended
  isActive          Boolean  @default(true)
  notes             String?
  createdAt         DateTime @default(now())
  deactivatedAt     DateTime?

  organization Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  location     Location?     @relation(fields: [locationId], references: [id], onDelete: Cascade)
  snapshots    TaxSnapshot[]

  @@unique([organizationId, ruleKey, version])
  @@index([organizationId, isActive])
  @@index([organizationId, locationId, isActive])
}

/// Immutable point-in-time tax fact, one row per rule applied to an approved
/// Revenue Review. Written inside the approval transaction. Never updated.
/// Copied values are authoritative; taxRuleId is a reporting convenience only.
model TaxSnapshot {
  id                String           @id @default(cuid())
  organizationId    String
  revenueReviewId   String           // FK to the Revenue Review model (02 / 13)
  taxRuleId         String?
  ruleKey           String
  ruleVersion       Int?
  ruleName          String
  jurisdictionLabel String
  provider          TaxProvider      @default(INTERNAL)
  providerRef       String?          // e.g. Stripe Tax calculation id (Part 3)
  ratePercent       Decimal?         @db.Decimal(7, 4) // null when provider-computed
  taxableBase       Decimal          @db.Decimal(12, 2)
  taxAmount         Decimal          @db.Decimal(12, 2)
  currency          String           @db.Char(3) // ISO 4217; equals the review currency
  roundingMode      TaxRoundingMode
  roundingLevel     TaxRoundingLevel
  serviceDate       DateTime         // tax point actually used for rule resolution
  createdAt         DateTime         @default(now())

  organization  Organization      @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  revenueReview RevenueReview     @relation(fields: [revenueReviewId], references: [id], onDelete: Cascade)
  taxRule       TaxRule?          @relation(fields: [taxRuleId], references: [id], onDelete: SetNull)
  items         TaxSnapshotItem[]

  @@index([organizationId, createdAt])   // tax collected by period (reports/exports)
  @@index([organizationId, taxRuleId])   // per-jurisdiction remittance reporting
  @@index([revenueReviewId])
}

/// "Applied items" detail per spec Part G: which lines fed a snapshot's base.
/// Relation-scoped through TaxSnapshot (the InvoiceLine precedent).
model TaxSnapshotItem {
  id              String   @id @default(cuid())
  taxSnapshotId   String
  invoiceLineId   String   // FK → InvoiceLine (13 R1: review lines are InvoiceLine rows)
  lineDescription String   // copied at approval for receipts/forensics
  lineKind        String   // charge-class key at approval (frozen legacy kind or
                           // RevenueItem category/origin projection)
  taxableAmount   Decimal  @db.Decimal(12, 2) // signed contribution to the base
  taxAmount       Decimal? @db.Decimal(12, 2) // populated in PER_LINE mode
  createdAt       DateTime @default(now())

  snapshot TaxSnapshot @relation(fields: [taxSnapshotId], references: [id], onDelete: Cascade)
  line     InvoiceLine @relation(fields: [invoiceLineId], references: [id], onDelete: Restrict)

  @@index([taxSnapshotId])
  @@index([invoiceLineId])
}
```

**Fields this design adds to sibling-owned models** (proposed here, ratified in the owning doc + 13):

| Model (owner) | Field | Purpose |
|---|---|---|
| Org Revenue Engine settings (09/13) | `taxEnabled`, `taxProvider`, `taxRoundingMode`, `taxRoundingLevel`, `taxRegistrationLabel` | §3 |
| Invoice (02/13, R13) | `taxTotal Decimal(12,2)` in the locked totals block (`Invoice.subtotal/taxTotal/total`) | Persisted at approval; sum of snapshot `taxAmount`s. The review keeps only `totalAtApproval` + `approvalSnapshot` |
| InvoiceLine (02/13, R1: review lines are InvoiceLine rows) | `taxTreatmentOverride TaxTreatment?`, `taxOverrideReason String?` | Audited manual override (§2.4 step 1) |
| RevenueItem (06) | `isTaxable Boolean @default(false)` | §2.4 step 3 |
| AircraftPricingProfile (04), InstructorRateProfile (05) | `taxTreatment TaxTreatment?` (null = inherit) | §2.4 step 2 — the spec's "Tax treatment" profile field |

**Deliberate decisions:**

- **Tax is not an InvoiceLine.** No `TAX` value is added to `LineItemKind`. Tax lives in TaxSnapshot rows plus the persisted `Invoice.taxTotal`; document totals = charge lines + taxTotal. This keeps charge lines clean for allocation and compensation math and avoids reinterpreting the existing enum. Accounting exports map snapshots to tax fields/accounts directly (Open Question 4).
- **FK actions:** `TaxSnapshot → RevenueReview` is `Cascade` for tenant-wipe simplicity (the InvoiceLine/Invoice precedent), paired with the app-layer rule that approved reviews are never hard-deleted — they void, per 02. All three models join `org-snapshot.ts` capture/wipe/restore (snapshots before reviews in the wipe order) in the same slice, or founder snapshot/restore silently loses tax data.
- **Migrations:** purely additive — four new enums (each in its own migration before use, per DATABASE_STANDARDS), three new models, nullable/defaulted columns on sibling models. **No backfill exists or is needed**: there is no legacy tax data, and pre-Phase-8 invoices remain permanently untaxed rather than reinterpreted (spec Part L).
- **Seed fixtures** (validation matrix): demo org gets `taxEnabled=true` with a state + county rule pair, a superseded historical version, and at least one approved review with snapshots; Blue Ridge Flying Club stays `taxEnabled=false` to prove the no-tax default and tenant isolation. Demo logins untouched.

---

## 5. Validation & business rules

Hard failures (400 with actionable `{ error }` text unless noted):

1. `0 ≤ ratePercent ≤ 100`; `appliesToKinds` non-empty and every value a charge-class key present in the engine's `src/lib` catalog (13 §4.9). `LineItemKind` is frozen — no key is ever an enum value addition.
2. `effectiveEnd`, when set, must be after `effectiveStart`; effective windows within one `ruleKey` family must not overlap (rule resolution must be deterministic — never two versions of the same rule live for one date).
3. `locationId` must be org-owned; a cross-tenant location id behaves as nonexistent (404 — API_STANDARDS cross-tenant rule).
4. A rule version referenced by any TaxSnapshot is immutable: no field updates, no deletion. Corrections create version N+1; the API rejects mutation attempts with "This version has been used on approved reviews — create a new version instead."
5. Creating version N+1 auto-closes an open-ended version N (`effectiveEnd = vN+1.effectiveStart`) in the same `$transaction`.
6. `taxTreatmentOverride` requires `taxOverrideReason` and is only writable while the review is editable (Draft / Changes Requested per 02); it is frozen by approval like every other line field.
7. Approval writes snapshots and `Invoice.taxTotal` in the same `$transaction` as the review lock — never before, never after, never partially. External provider quotes are verified by `inputHash` inside the tx and re-quoted outside it on mismatch.
8. TaxSnapshot / TaxSnapshotItem rows are append-only. No update or delete path exists in the application. Refunds and corrections (08 §2.2, Part 2) create reversal snapshot rows referencing the original snapshot, **in the same `$transaction` as the refund/adjustment itself** — a refund on a taxed review without its reversal TaxSnapshot is an invariant violation, not a deferrable follow-up. Tax Collected for any period is therefore always Σ snapshot `taxAmount` including reversals, with no execution-order window in which a refunded review still reports its original tax.
9. One currency per review; snapshot `currency` copies it. Multi-currency is out of scope for Part 1.
10. All tax arithmetic uses `Decimal`; a float anywhere in the tax path is a Financial-gate automatic rejection.

Warnings (surfaced in the engine's `warnings[]` and the review UI; never block unless the org configures blocking via the warning framework in [01-operational-checkout.md](./02-operational-dispatch-and-closeout.md)):

- `ratePercent > 20` ("unusually high rate — confirm this is a percentage").
- Two active rules with identical `jurisdictionLabel` matching the same review (probable double-configuration; stacking distinct jurisdictions is normal and not warned).
- A rule's taxable base floored at zero by discounts.
- `taxEnabled=true` with zero active rules ("tax is enabled but no rules apply").

---

## 6. RBAC, approvals & audit

RBAC is data (`src/lib/permissions.ts`); no role-name checks anywhere. Proposed keys (final namespace consolidated across the design set in 13 and the ADR; if a `revenue.` prefix is adopted, it must be registered in `MODULE_BY_PREFIX` in `src/lib/session.ts` so billing-module plan gating applies):

| Action | Permission | Default roles |
|---|---|---|
| View tax settings, rules, snapshots | `billing.view` | ACCOUNT_OWNER, SCHOOL_ADMIN, ACCOUNTANT (+ per existing bundles) |
| Create rule / new version / deactivate; change org tax settings | `revenue.taxes_manage` (new) | ACCOUNT_OWNER, SCHOOL_ADMIN, ACCOUNTANT |
| Per-line tax treatment override on an editable review | the manual-adjustment permission (08) + required reason | per 08 |
| Approve review (writes snapshots) | the approval permission (02) | per 02 |

- Every mutation goes through `authorize(…, { mutating: true })` — read-only impersonation and read-only API keys are refused; impersonation attribution is handled centrally by `recordAudit`.
- Audit actions (dot-namespaced, `oldValue`/`newValue` populated so the ledger is reconstructable without current DB state — Financial-gate E3): `revenue.tax_settings_changed`, `revenue.tax_rule_created`, `revenue.tax_rule_versioned`, `revenue.tax_rule_deactivated`, `revenue.tax_override_applied`. Snapshot creation is attributed through the review-approval audit record (02) — one approval, one audit entry, snapshots enumerated in its metadata.
- **No new domain events** in Part 1: nothing subscribes to tax-rule changes, and the constitution requires every registered event to have a live emit site. Tax data rides the review lifecycle events defined in 02. Part 3's Stripe Tax transaction registration will ride the post-commit payment events.
- No AI pathway touches tax configuration or snapshots (constitution rule 8).
- Second approval for tax rule changes is deliberately **not** required by default; orgs wanting it use the approval-policy configuration in 02 (Open Question 5).

---

## 7. UX notes (aviation-native, operational workflow first)

- **Tax never appears in the checkout or return flow.** A CFI closing out N4521B sees Hobbs, Tach, fuel, squawks — not jurisdictions. Tax first appears on the draft Revenue Review, already computed.
- **Settings → Revenue Engine → Taxes:** disclaimer banner (§1, verbatim, always visible — not dismissible); master toggle; rules table with Name · Jurisdiction · Rate · Scope (Org-wide / location name) · Applies to (charge-class chips: "Aircraft rental", "Flight instruction", "Ground instruction", …) · Effective window · Version · derived status chip. Editing opens a "New version" flow that states plainly: *"Past approved reviews keep the old version. The new version applies from its effective date."*
- **Revenue Review tax block** (below charges, above total): one row per rule — `Georgia Sales Tax (4.00%) · $10.58` — with an info popover showing the taxable base and the exact lines included/excluded and why (the engine's reasons, verbatim). Draft state labels it *Estimated tax*; approved state shows the locked snapshot values.
- **Receipts** show per-jurisdiction tax lines and the org's `taxRegistrationLabel` when set. Label is "Tax", never "VAT", until VAT semantics actually exist.
- Status chips for derived rule states (Active / Scheduled / Expired / Deactivated) come from `STATUS_TONE` in `src/lib/status-colors.ts` — new entries added there, existing meanings untouched (constitution rule).
- Design-system components only; light + dark + mobile parity; empty state on the tax settings page is the no-tax default explained in one sentence plus the disclaimer.

---

## 8. Interactions with other Revenue Engine components

| Sibling doc | Interaction |
|---|---|
| [01-operational-checkout.md](./02-operational-dispatch-and-closeout.md) | Supplies the service date (return timestamp) and location used for rule resolution; hosts the configurable warning framework tax warnings plug into. Operational closeout has zero tax logic. |
| [02-revenue-review.md](./03-revenue-review-lifecycle.md) | Owns the review lifecycle, editable-state rules, approval transaction, and approval permission. Tax preview recomputes on line change; approval writes snapshots + `Invoice.taxTotal` inside the lock transaction. |
| [04-aircraft-pricing-profiles.md](./05-aircraft-pricing-profiles.md) | Profile "Tax treatment" field feeds line-treatment resolution step 2 for aircraft-rental lines. |
| [05-instructor-rates.md](./04-instructor-time-and-rates.md) | Same for instructor-service lines; instructor-service taxability is independent of aircraft-rental taxability by construction (distinct charge classes). Compensation math always uses pre-tax amounts. |
| [06-revenue-items.md](./06-revenue-items.md) | Owns `RevenueItem.isTaxable` and the category/origin classification from which charge-class keys derive (`LineItemKind` frozen per its §3.3); `appliesToKinds` validates against the engine's `src/lib` catalog. |
| [08-adjustments-and-credits.md](./08-adjustments-discounts-credits.md) | Discounts/credits reduce taxable bases per §2.4; line tax overrides use its permission + reason machinery; refunds and post-approval adjustments write reversal TaxSnapshot delta rows referencing the original snapshots in the same `$transaction` (its §2.2 — Part 2, same release as refund execution). |
| [09-payment-timing.md](./09-payment-timing-and-collection.md) | Charged amount = locked total including `taxTotal`; timing policy never alters snapshots. Org tax settings share the settings home proposed there. |
| [11-responsible-payers.md](./11-responsible-payers.md) | Payers see tax on invoices/receipts read-only. Payer-level exemptions are deferred (Open Question 2). |
| [13-database-model.md](./13-database-model.md) | Binding authority on types, precisions, currency column shape, the review/line model names these FKs point at, org-snapshot wipe order, and index set. |

---

## 9. Out of scope for Part 1 / deferred to Parts 2–3

- **Part 2 (implementation):** internal engine + contract tests, TaxRule CRUD/versioning APIs and settings UI, snapshot writes in the approval transaction, **refund/adjustment tax-reversal snapshot writes — shipped in the same release as refund execution, per 08 §2.2** (invariant: no refund on a taxed review without its reversal TaxSnapshot in the same `$transaction`; see §2.6, §5 rule 8), seed fixtures, org-snapshot wiring, receipts display.
- **Part 3 / later:** Stripe Tax adapter (test mode, behind env flags, quote-before-tx + post-commit transaction registration); VAT/GST semantics (tax-inclusive pricing, reverse charge); tax-remittance report surfaces beyond the basic per-jurisdiction export mapping.
- **Not planned:** jurisdiction/rate databases, address-based rate lookup, nexus determination, filing or remittance, exemption-certificate document management, compounding (tax-on-tax) rates, per-payer exemption profiles (unless Open Question 2 promotes them).

---

## 10. Open questions

1. **Tax point date** — this design fixes it to the service date (dispatch return). Confirm with early customers that no target org requires approval-date or payment-date tax points; if any does, it becomes an org setting (snapshotted either way).
2. **Payer-level tax exemption** (universities, government sponsors) — Part 1 handles this only via per-line manual overrides with reasons. Is a structured `ResponsiblePayer.taxExempt` flag (11) needed at launch, or is the audited override sufficient for the first cohort?
3. **Tax-inclusive pricing** — deferred with VAT/GST. Any US launch org advertising tax-inclusive rental rates would pull the `pricesIncludeTax` design forward; product owner to confirm none does.
4. **Accounting-export shape for tax** — snapshots map to QuickBooks-style tax fields rather than tax line items (§4). The Financial Export design must confirm target systems accept header-level tax, or a derived tax-line representation gets added at export time only (never in InvoiceLine).
5. **Separation of duties for tax config** — should orgs be able to require second approval for tax-rule changes themselves (not just for review approval)? Default here is audited-but-single-actor; needs a product call before Part 2 settles the approval-policy config surface in 02.
