# Checkout Restrictions — Dispatch Gate Design (Part J)

> **Status:** Proposed — Phase 8 Part 1 · **Date:** 2026-07-10 · **Lead roles:** Director of Operations; Chief Flight Instructor; Flight School Owner; Security Engineer at Cloudflare · **Part of:** Revenue Engine design set ([README](./README.md))

This document is Deliverable 12 of the Phase 8 Part 1 design set: the definitive checkout-restriction matrix and the design for how organizations configure and enforce dispatch restrictions. It is design only — no schema, code, or migration changes ship with it.

---

## 1. Purpose & scope

Organizations need to control **who can be dispatched an aircraft and under what conditions** — for safety reasons (grounded aircraft, expired medicals) and for financial reasons (no Payment Method on file, prior Payment Attempt failed, Amount Due over a threshold). Today the dispatch release gate enforces exactly one restriction category: airworthiness (`airworthinessOf()` in `src/lib/airworthiness.ts`, called from `src/app/api/dispatch/[id]/release/route.ts`). Scheduling separately *warns* about expired medicals and CFI credentials at booking time (`src/lib/scheduling.ts`), and the operations page *warns* when a flying student owes more than $500. Nothing financial gates release.

This design:

- Defines every restriction from spec Part J, its category, its data source in the current schema, its available enforcement modes, its default, its override authority, and its audit requirements (§4, the matrix).
- Extends the **existing dispatch release flow** — one gate, not a second parallel gate system. The airworthiness check stays exactly where it is and becomes the safety floor of a broader evaluator.
- Keeps three rules absolute:
  1. **Safety/operational blocks are never overridable through checkout-restriction configuration.** Grounded aircraft, overdue maintenance, open critical squawks, and expired medicals/certificates clear only through the appropriate safety authority path (maintenance sign-off, squawk resolution/deferral, credential record update, return-to-line).
  2. **Financial restrictions never block emergency or safety actions.** Aircraft return and operational closeout are never gated by any restriction; maintenance/positioning dispatches skip financial evaluation entirely; grounding an aircraft or filing a squawk is never conditioned on financial state.
  3. **Every override is recorded with actor + reason**, as an immutable row plus `recordAudit`.

Out of scope here: the checkout/return workflow itself (03-operational-checkout.md), the Revenue Review lifecycle (04-revenue-review.md), payer and Payment Method modeling (09-responsible-payers.md), and the binding schema call (13-database-model.md).

**Terminology.** Per `docs/aviation/AVIATION_STANDARDS.md`, this document and all UI copy use *dispatch / release / return / closeout* — never "check-in". "Checkout restrictions" (the spec's Part J title) means restrictions evaluated at **dispatch release**.

---

## 2. Restriction categories

The spec names two buckets — safety/operational blocking and financial blocking. This design refines them into three tiers so that "maintenance due soon"-style items have a home that is neither a pinned block nor freely disableable. The tier of each restriction is **a code-level catalog constant** (like the `PERMISSIONS` catalog), never org data — organizations cannot recategorize a restriction.

| Tier | Spec bucket | Config latitude | Examples |
|---|---|---|---|
| **SAFETY** | Safety/operational blocking | None. Pinned to `BLOCK`. Policy rows for these keys are rejected by the settings API, and the engine ignores any such row that exists anyway (defense in depth against import/restore of bad config). | Aircraft grounded, maintenance overdue, open critical squawk, expired medical where required, expired required certificate |
| **OPERATIONAL** | Safety/operational blocking (warning sub-tier) | Floor is `WARN` — may be escalated to `REQUIRE_REVIEW`, `BLOCK_OVERRIDABLE`, or `BLOCK`; may never be set to `OFF` (one documented exception, §4 row 10). Thresholds configurable. | Maintenance due within threshold, student not current, required endorsement missing, program requirements incomplete |
| **FINANCIAL** | Financial blocking | Fully configurable across all five spec modes, including `OFF` and role exemptions. | Payment Method missing, prior Payment Attempt failed, Amount Due over threshold, membership inactive, insurance documentation missing |

**Enforcement modes** (mapping the spec's five options):

| Spec option | Mode value | Meaning at release |
|---|---|---|
| Ignore | `OFF` | Not evaluated. FINANCIAL tier only. |
| Warn only | `WARN` | Finding shown; release proceeds without interaction. |
| Require Operations review | `REQUIRE_REVIEW` | Release completes only when the acting user holds `dispatch.review_restrictions` and explicitly acknowledges the finding, or a standing `REVIEW_CLEARED` decision already covers it. A front-desk dispatcher without that permission gets a 403 with the findings and escalates to Operations through the designed hand-off (§3.5): request review → remote `REVIEW_CLEARED` → the dispatcher completes the release. |
| Block checkout | `BLOCK` | Release refused (409). No control in this system clears it — only fixing the underlying condition. |
| Allow one-time override with reason | `BLOCK_OVERRIDABLE` | Release refused unless the acting user holds `dispatch.override_restrictions` and supplies a required reason. The override applies to **this dispatch only** (enforced by a unique constraint, §5). |

"Ignore for selected roles" is modeled as an orthogonal `exemptOrgRoleIds` list on FINANCIAL policy rows: the restriction auto-passes when the **dispatch subject** (the student/renter receiving the aircraft, resolved through their Membership/OrgRole in this org) holds an exempt role. Exemptions are subject-based, not actor-based — a dispatcher's own role never exempts a customer.

---

## 3. How it works

### 3.1 Evaluation point and flow

Restrictions are evaluated **inside the existing release route** (`POST /api/dispatch/[id]/release`), which keeps today's pipeline (authorize → org-scoped load → status check → airworthiness → zod checklist → update → audit) and inserts one step:

```
authorize("dispatch.release", { mutating: true })
  → load dispatch org-scoped (session.organizationId, never client input)
  → refuse unless status PENDING
  → evaluateCheckoutRestrictions(...)          ← NEW (src/lib/checkout-restrictions.ts)
      composes: airworthinessOf() result       (safety floor — reused, not duplicated)
              + crew credential checks         (medical / certificate / currency)
              + financial checks               (payer, Payment Method, Amount Due, failed Payment Attempts)
              + org policy resolution          (CheckoutRestrictionPolicy rows over engine defaults)
  → if any BLOCKED finding                     → 409 { error, findings }
  → if REVIEW_REQUIRED findings not already covered by a standing
    REVIEW_CLEARED decision (§3.5) and actor lacks
    dispatch.review_restrictions               → 403 { error, findings }
  → validate release checklist (zod — fuelQty, oilQty, weatherAcknowledged, documentsVerified …)
  → ONE db.$transaction:
      guarded updateMany claim PENDING → RELEASED   (count === 0 → 409; hardens today's
                                                     check-then-update race to match the
                                                     close route's idempotency pattern)
      + DispatchRestrictionDecision rows for every override / review acknowledgment
      + restrictionSnapshot written onto the Dispatch
  → recordAudit("dispatch.release", { …, findings })   (full findings snapshot in newValue)
```

The client submits `overrides: [{ key, reason }]` and `acknowledgments: [{ key, note? }]` alongside the existing checklist body. **The server never trusts client findings** — it re-evaluates in the same request; the client only names which findings it is overriding/acknowledging and why. Stale or unnecessary overrides (finding no longer present) are rejected with an actionable 400.

A read-only preview endpoint (`GET /api/dispatch/[id]/restrictions`, `authorize("dispatch.release")`, non-mutating) returns the same findings so the dispatch board can render the readiness panel before the release attempt.

### 3.2 The evaluator (Part 2 implementation contract)

`src/lib/checkout-restrictions.ts` follows the explainable-engine pattern (`lib/readiness.ts`, `lib/airworthiness.ts`): a pure evaluation core plus a thin org-scoped data loader, contract-tested. Every finding carries its *why*:

```ts
type RestrictionFinding = {
  key: CheckoutRestrictionKey;
  category: "SAFETY" | "OPERATIONAL" | "FINANCIAL";
  disposition: "PASS" | "WARN" | "REVIEW_REQUIRED" | "BLOCKED_OVERRIDABLE" | "BLOCKED";
  enforcement: RestrictionEnforcement;          // what policy resolved to
  policySource: "PINNED" | "ORG_POLICY" | "DEFAULT";
  message: string;                              // "N54321 is grounded by maintenance."
  resolution: string;                           // "Maintenance must return it to line (Aircraft → Ground/Return)."
  basis: Record<string, unknown>;               // rows/values that produced it (squawk id, expiry date, amount…)
};

type CheckoutRestrictionResult = {
  findings: RestrictionFinding[];
  canRelease: boolean;         // no BLOCKED; every BLOCKED_OVERRIDABLE has a valid override;
                               // every REVIEW_REQUIRED acknowledged by a permitted actor
  blockers: RestrictionFinding[];
  reviewRequired: RestrictionFinding[];
  warnings: RestrictionFinding[];
};
```

### 3.3 Applicability rules (what gets evaluated when)

These are engine rules, not configuration:

1. **Return/closeout is never gated.** Restrictions apply to release only. An aircraft can always be returned, a flight always operationally closed, a squawk always filed, an aircraft always grounded — regardless of any financial state.
2. **Maintenance/positioning dispatches skip FINANCIAL keys.** Dispatches whose `ScheduleEvent.type = MAINTENANCE_BLOCK` (ferry, reposition, maintenance run) evaluate SAFETY and OPERATIONAL keys only. Whether Dispatch needs an explicit purpose flag beyond the event type is owned by 03-operational-checkout.md (open question §11.6).
3. **No billable customer → FINANCIAL keys auto-pass.** Financial restrictions evaluate against the dispatch's customer and responsible payer (resolution per 09-responsible-payers.md). A staff-only flight has no payer to restrict.
4. **Billing module gate.** FINANCIAL keys evaluate only when the org's resolved module set includes `billing` (`session.modules` — same mechanism that gates `billing.*` permissions in `src/lib/session.ts`). SAFETY and OPERATIONAL keys always evaluate; dispatch is a core module.
5. **Medical/certificate applicability follows the operation, not configuration.** A student's expired medical is a pinned `BLOCK` for `SOLO_FLIGHT` events (solo privileges require a valid medical) and an OPERATIONAL `WARN` on dual instruction (the student is not required crew). This is *applicability* logic in the engine, not an override — no one is overriding a safety rule; the rule genuinely differs by operation. Instructor credentials are evaluated whenever an instructor is assigned to the dispatch.

### 3.4 Booking-time advisory

The same evaluator runs in advisory mode from the scheduling conflict surface (`detectConflicts` consumers) so financial surprises don't first appear at the release counter. Booking advisories never block (existing conflict behavior unchanged); implementation deferred to Part 3 (§10).

### 3.5 Operations review hand-off (`REQUIRE_REVIEW` at the counter)

The common `REQUIRE_REVIEW` case is a front-desk dispatcher without `dispatch.review_restrictions` facing a renter at the counter. A bare 403 with "escalate to Operations" is not a workflow, so the hand-off is designed:

1. **Request.** The 403 readiness panel offers a **Request Operations review** action (`POST /api/dispatch/[id]/restrictions/request-review`, `authorize("dispatch.release", { mutating: true })`, dispatch must be `PENDING`). The server re-evaluates and creates in-app `Notification` rows for every active org member holding `dispatch.review_restrictions`, carrying a summary of the outstanding `REVIEW_REQUIRED` findings and a deep link to this dispatch's restrictions view on the dispatch board. Repeat requests for the same dispatch refresh rather than multiply the notification (idempotent while `PENDING`). Audited as `dispatch.restriction_review_requested`.
2. **Remote clearance.** A permitted reviewer follows the deep link (desktop or mobile), sees the same server-computed findings the preview endpoint returns (§3.1), and records `REVIEW_CLEARED` per finding key with a note (`POST /api/dispatch/[id]/restrictions/review`, `authorize("dispatch.review_restrictions", { mutating: true })`, dispatch must still be `PENDING`). The server re-evaluates in the same request and rejects clearance of findings no longer present — the same staleness rule as overrides (§3.1). Each clearance writes the immutable `DispatchRestrictionDecision` row (§5) plus `dispatch.restriction_review_cleared` audit. The reviewer never takes over the release and does not need to be at the counter.
3. **Release completion.** The original dispatcher re-attempts release. The evaluator treats a standing `REVIEW_CLEARED` decision on this dispatch for the same key as satisfying that `REVIEW_REQUIRED` finding; no duplicate decision row is written (the `@@unique([dispatchId, key])` constraint stands). Any finding that fires anew after clearance gates normally.

Scope guards: this is not an approval queue or a second state machine — the `Notification` rows and the immutable decision rows are the entire mechanism, preserving "one gate, one workflow" (§8). A remotely recorded `REVIEW_CLEARED` is dispatch-scoped exactly like an inline acknowledgment — never a standing waiver for the subject. Decisions cascade with the dispatch (a cancelled dispatch takes its clearances with it; AuditLog survives, per §5).

---

## 4. The checkout-restriction matrix (Deliverable 12)

Legend for modes: **O** = `OFF` · **W** = `WARN` · **R** = `REQUIRE_REVIEW` · **V** = `BLOCK_OVERRIDABLE` (one-time override with reason) · **B** = `BLOCK` · **X** = role exemptions available. Pinned = organizations cannot change it.

| # | Restriction (spec Part J) | Key | Tier | Data source today (`prisma/schema.prisma` / engines) | Dependency (data that does not exist yet) | Available modes | Default | Who may override / clear | Audit requirements |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Aircraft grounded | `AIRCRAFT_GROUNDED` | SAFETY | `Aircraft.status = GROUNDED` (~L680); enforced via `airworthinessOf()` | — | **B** (pinned) | `BLOCK` | No one via this gate. Safety authority path: `aircraft.ground` permission returns the aircraft to line (audited status change). | Finding in release-audit snapshot; the status change itself is separately audited. |
| 2 | Maintenance overdue | `MAINTENANCE_OVERDUE` | SAFETY | `AircraftComponent.dueAtHours/dueAtDate` vs `Aircraft.currentHobbs`/today (`airworthinessOf()`); open `MaintenanceOrder` | — | **B** (pinned) | `BLOCK` | No one via this gate. Path: maintenance completes work and signs return-to-service (`MaintenanceOrder.approvedBy/approvedAt`, `maintenance.manage`), updating component due points. | Release-audit snapshot; RTS signature is the authoritative record. |
| 3 | Open critical squawk | `OPEN_CRITICAL_SQUAWK` | SAFETY | `Squawk.severity = GROUNDING` with `status ∉ {RESOLVED, CLOSED, DEFERRED}` (~L744–761). Defensive: catches GROUNDING squawks filed outside closeout where `Aircraft.status` wasn't flipped. | — | **B** (pinned) | `BLOCK` | No one via this gate. Path: maintenance resolves the squawk, or defers it with authority (`SquawkStatus.DEFERRED` — the MEL-style deferral is the safety authority path). | Release-audit snapshot; squawk resolution/deferral audited on its own mutation path. |
| 4 | Medical expired | `MEDICAL_EXPIRED` | SAFETY | `Student.medicalExpiration` (~L560), `Instructor.medicalExpiration` (~L593). Scheduling already warns at booking (`scheduling.ts` MEDICAL_EXPIRED). | — | **B** (pinned where medical is required crew privilege: student solo; assigned instructor). Dual-student case surfaces as OPERATIONAL **W** by applicability (§3.3.5), not by config. | `BLOCK` | No one via this gate. Path: update the credential record with a current medical (`students.manage` / instructor record management) — with the document on file. | Release-audit snapshot; credential record changes audited. |
| 5 | Required certificate expired | `CERTIFICATE_EXPIRED` | SAFETY | `Instructor.cfiExpiration` (~L592) for instructional flights; scheduling warns at booking today. | Student-side certificate expirations are not modeled (`Student.studentCertNumber` has no expiry field) — flagged; evaluates instructor CFI only until then. | **B** (pinned) | `BLOCK` | No one via this gate. Path: update instructor credential records after renewal. | Release-audit snapshot. |
| 6 | Instructor not current | `INSTRUCTOR_NOT_CURRENT` | OPERATIONAL | Expired CFI/medical are rows 4–5. This key = currency beyond document expiry (flight review recency, night currency for the operation). | **Yes** — no currency computation engine exists; Part 3 builds it. Key evaluates nothing it cannot prove; findings carry `basis`. | **W · R · V · B** (floor W, no OFF) | `WARN` | `REQUIRE_REVIEW` cleared by `dispatch.review_restrictions`; `BLOCK_OVERRIDABLE` by `dispatch.override_restrictions` — Chief Flight Instructor–tier roles in practice. | Decision row + `recordAudit` per §7; release-audit snapshot. |
| 7 | Student not current | `STUDENT_NOT_CURRENT` | OPERATIONAL | Partial: solo-endorsement expiry via `Endorsement.expiresAt` (~L1043). | **Yes** — 90-day solo / flight-review currency computation is Part 3. | **W · R · V · B** (floor W) | `WARN` | Same as row 6. Recommendation: promote the *solo* case to SAFETY once the currency engine exists (open question §11.4). | Same as row 6. |
| 8 | Required endorsement missing | `ENDORSEMENT_MISSING` | OPERATIONAL | `Endorsement` rows exist per student with `expiresAt`; evaluated for `SOLO_FLIGHT` events only. | **Yes** — no mapping of *which* endorsement an operation requires; needs an endorsement-requirement catalog (Part 3). | **W · R · V · B** (floor W) | `WARN` | Same as row 6. | Same as row 6. |
| 9 | Maintenance due within configured threshold | `MAINTENANCE_DUE_SOON` | OPERATIONAL | `airworthinessOf()` DUE_SOON state; today's constants `HOURS_WARNING = 10`, `DAYS_WARNING = 14` become the policy defaults (`thresholdHours` / `thresholdDays`). | — | **W · R · V · B** (floor W) | `WARN` (10.0 hrs / 14 days) | Escalated modes cleared/overridden per row 6; overrides here are in practice a maintenance-authority action. | Same as row 6. |
| 10 | Program requirements incomplete | `PROGRAM_REQUIREMENTS_INCOMPLETE` | OPERATIONAL | `SyllabusEnrollment` + lesson records exist. | **Yes** — no per-program prerequisite definitions exist. **Documented exception:** ships `OFF` until its data source exists. | **O (until dependency lands) · W · R · V · B** | `OFF` | Same as row 6 once enabled. | Same as row 6. |
| 11 | Insurance documentation missing | `INSURANCE_DOCUMENT_MISSING` | FINANCIAL (administrative) | Renter/student: `Document.kind = INSURANCE` owned by the subject user, unexpired (`expiresAt`, ~L1212–1229). Aircraft: `Aircraft.insuranceExpiration` (~L685). | — | **O · W · R · V · B · X** | `WARN` | `REQUIRE_REVIEW` → `dispatch.review_restrictions`; `BLOCK_OVERRIDABLE` → `dispatch.override_restrictions`; subject-role exemptions via `exemptOrgRoleIds`. | Decision row + `recordAudit`; release-audit snapshot. |
| 12 | Payment Method missing | `PAYMENT_METHOD_MISSING` | FINANCIAL | None today (`Payment.reference` is free text). | **Yes** — `PaymentMethodReference` for the responsible payer (09-responsible-payers.md, Part 2). Auto-passes when the org's payment timing policy is manual invoice/manual charge (11-payment-timing.md). | **O · W · R · V · B · X** | `WARN` | Same as row 11. | Same as row 11. |
| 13 | Prior payment failed | `PRIOR_PAYMENT_FAILED` | FINANCIAL | None today (no payment status machine). | **Yes** — `PaymentAttempt` history / Revenue Review in *Payment Failed* status for this payer (04-revenue-review.md, Part 2). | **O · W · R · V · B · X** | `WARN` (recommended school hardening: `REQUIRE_REVIEW` — see §11.1) | Same as row 11. | Same as row 11. |
| 14 | Amount Due above configured threshold | `AMOUNT_DUE_OVER_THRESHOLD` | FINANCIAL | Interim: `Student.accountBalance` negative = owed (~L566; the ops page already warns at $500). Target: derived Amount Due = unpaid approved Invoices for the responsible payer (Revenue Engine). | Partial — derived Amount Due lands with the Revenue Review/Invoice work; evaluator switches source without config change. | **O · W · R · V · B · X** | `WARN` at `thresholdAmount = 500.00 USD` (parity with today's operations-page alert) | Same as row 11. | Same as row 11; finding `basis` records amount, threshold, currency, and source (interim vs derived). |
| 15 | Membership inactive | `MEMBERSHIP_INACTIVE` | FINANCIAL | `Membership.status = DEACTIVATED` for the subject user in this org (~L393). | — (club *dues standing* is distinct and folds under row 14 once membership invoices flow through the Revenue Engine). | **O · W · R · V · B · X** | `BLOCK_OVERRIDABLE` | `dispatch.override_restrictions` with required reason (one-time). | Same as row 11. |

Notes:

- Rows 1–5 are exactly the spec's never-overridable set. Their policy keys accept **no** `CheckoutRestrictionPolicy` rows: the settings API rejects writes (400 with the reason), and the engine pins enforcement even if a row exists (defense in depth against imported/restored config).
- Rows 6–10 satisfy "Warnings should not automatically block operational closeout unless the organization configures them as blocking" (spec Part A): floor `WARN`, org-escalatable.
- Rows 11–15 are the spec's financial-blocking bucket with all five modes plus role exemptions.
- A future `OPEN_MAJOR_SQUAWK` warning key (MAJOR severity) is deliberately deferred (§10) — the spec names only critical squawks.

---

## 5. Data model proposal (Prisma-flavored)

Binding schema decisions (precision, currency representation, Dispatch tenancy columns) belong to 13-database-model.md; this section states what this component needs. All models follow house rules: real `Organization` FK with explicit `onDelete`, tenant-scoped uniques, `createdAt`, org-leading indexes (enforced by `tests/schema-governance.test.ts`).

```prisma
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
  OFF                // FINANCIAL tier only (plus the row-10 documented exception)
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
  OVERRIDE          // one-time override of a BLOCK_OVERRIDABLE finding
  REVIEW_CLEARED    // Operations acknowledgment of a REQUIRE_REVIEW finding
}

/// Org configuration for ONE restriction key. Absence of a row = engine
/// default (strong defaults, zero required setup). Rows store deviations only.
/// SAFETY keys never have rows (rejected at the API; ignored by the engine).
model CheckoutRestrictionPolicy {
  id              String                 @id @default(cuid())
  organizationId  String
  key             CheckoutRestrictionKey
  enforcement     RestrictionEnforcement
  /// Money threshold (AMOUNT_DUE_OVER_THRESHOLD only). Decimal money + explicit
  /// ISO 4217 currency per Revenue Engine money rules; 13-database-model.md
  /// makes the binding precision call (recommendation: Decimal(12, 2)).
  thresholdAmount Decimal?               @db.Decimal(12, 2)
  /// ISO 4217. Required whenever thresholdAmount is set; defaults to the org
  /// currency ("USD" until an org currency field lands — see 13-database-model.md).
  currency        String?
  thresholdHours  Decimal?               @db.Decimal(6, 1) // MAINTENANCE_DUE_SOON hours margin
  thresholdDays   Int?                                     // MAINTENANCE_DUE_SOON / document-expiry days margin
  /// "Ignore for selected roles": same-org OrgRole ids whose members auto-pass
  /// this restriction AS THE DISPATCH SUBJECT. FINANCIAL keys only.
  exemptOrgRoleIds String[]              @default([])
  notes           String?
  createdAt       DateTime               @default(now())
  updatedAt       DateTime               @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, key])
  @@index([organizationId])
}

/// One human decision that let a restricted release proceed: a one-time
/// override or an Operations review acknowledgment. Immutable — no update or
/// delete API; @@unique enforces "one-time, this dispatch only". Snapshots the
/// finding and the enforcement in force at decision time (point-in-time facts,
/// not computed caches). Forensic attribution also lands in AuditLog; this row
/// is the operational record that travels with the dispatch and its Revenue
/// Review. Cascade with the dispatch is deliberate: AuditLog (SetNull) is the
/// trail that survives deletion, matching house convention.
model DispatchRestrictionDecision {
  id                String                  @id @default(cuid())
  organizationId    String
  dispatchId        String
  key               CheckoutRestrictionKey
  kind              RestrictionDecisionKind
  category          RestrictionCategory     // snapshot; SAFETY can never appear (engine-enforced)
  enforcementAtTime RestrictionEnforcement  // snapshot of the mode that was in force
  findingDetail     String                  // human-readable finding at decision time
  reason            String                  // required, non-empty
  /// Actor follows the AuditLog convention: bare id + denormalized label so the
  /// record outlives user changes; impersonation attribution corrected in AuditLog.
  actorUserId       String
  actorLabel        String
  createdAt         DateTime                @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  dispatch     Dispatch     @relation(fields: [dispatchId], references: [id], onDelete: Cascade)

  @@unique([dispatchId, key])
  @@index([organizationId, createdAt])
  @@index([organizationId, key, createdAt])
}

model Dispatch {
  // ... existing fields unchanged (schema.prisma ~L905–944); organizationId,
  // check-in capture fields, and actor FKs are owned by 03-operational-checkout.md
  // and 13-database-model.md.

  /// Point-in-time snapshot of ALL restriction findings (passes, warnings,
  /// review clearances, overrides) as evaluated at release. A historical fact
  /// of what the gate saw — the deliberate carve-out from the "computed values
  /// are derived at read time" rule (DATABASE_STANDARDS.md), same as approved
  /// Revenue Review snapshots. Also duplicated into the dispatch.release audit.
  restrictionSnapshot Json?

  restrictionDecisions DispatchRestrictionDecision[]
}
```

Additional integration obligations (Part 2):

- Both new tables join `src/lib/org-snapshot.ts` capture / `TableKey` / wipe / restore lists (decisions cascade with `ScheduleEvent → Dispatch`; policy rows need their own wipe entry before `Organization`).
- Migrations: one additive DDL migration for the enums + models + `Dispatch.restrictionSnapshot`; no backfill needed (absence of rows = defaults; existing dispatches simply have no snapshot). Enum values land in their own migration before any code uses them (DATABASE_STANDARDS.md two-step rule).
- Seed (`prisma/seed.ts`): fixtures in **both** demo orgs — one org keeps pure defaults (proves zero-config), the other gets an escalated `AMOUNT_DUE_OVER_THRESHOLD` (`REQUIRE_REVIEW`, $250) and a `MEMBERSHIP_INACTIVE` override decision on a released dispatch, mapping to the spec Part L validation matrix (fresh / seeded / multi-org fixtures). Demo logins untouched.

---

## 6. Configuration surface

Org-level configuration follows the established pattern: a dedicated tenant-scoped config table (like `OrgRole`/`LessonType`), managed through a zod-validated settings route with before/after audit — **no settings JSON blob**.

- **Route:** `GET/PUT /api/organization/checkout-restrictions` — `authorize("settings.manage", { mutating: true })` for writes. (Whether restriction config later moves under a Revenue Rule management permission is open question §11.3.)
- **Defaults are engine constants**, versioned in code next to the key catalog (tier, default mode, default thresholds per §4). The settings UI renders the full matrix with each key's current effective value and its source (`Default` vs `Org policy` vs `Pinned`).
- **What an org can set, per tier:**

| Setting | SAFETY | OPERATIONAL | FINANCIAL |
|---|---|---|---|
| Enforcement mode | — (pinned `BLOCK`) | `WARN` → `BLOCK` (floor `WARN`) | All five modes |
| Thresholds (`thresholdHours/Days/Amount` + `currency`) | — | Yes (row 9) | Yes (row 14) |
| Role exemptions (`exemptOrgRoleIds`) | — | — | Yes |
| Notes | — | Yes | Yes |

- **Validation at write time:** SAFETY keys rejected outright; OPERATIONAL rows below floor rejected; `thresholdAmount` requires `currency` and must be positive Decimal; `exemptOrgRoleIds` verified to reference same-org `OrgRole` rows before write (body-supplied-FK rule); unknown keys rejected.
- **Policy changes affect future evaluations only.** Released dispatches keep their `restrictionSnapshot`; approved Revenue Reviews are untouched (immutability principle 5). Every change is audited with before/after values (`recordAudit("dispatch.restriction_policy_updated")`, the `org.settings_change` pattern).

---

## 7. Validation & business rules

1. **Category is code, not data.** Tier per key lives in the engine catalog; orgs cannot move a key between tiers.
2. **Safety floor is clamped in the engine**, not just the API: a `CheckoutRestrictionPolicy` row for a SAFETY key (however it got there — import, snapshot restore, direct SQL) is ignored and logged loudly. An OPERATIONAL row below `WARN` is clamped to `WARN`.
3. **Findings are server-computed, always.** Client-supplied prices, findings, or dispositions are never trusted (Financial-gate auto-reject). Overrides/acknowledgments reference keys + reasons only; the server re-evaluates within the release request.
4. **One decision per `[dispatchId, key]`**, enforced by the unique constraint — the DB-level guarantee of "one-time override". Decisions are immutable: no update/delete route exists. A wrongly released dispatch is corrected through the dispatch lifecycle (cancel/rebook), never by editing the decision record.
5. **Override requires a non-empty reason**; `REVIEW_CLEARED` requires the acting session to hold `dispatch.review_restrictions` at decision time; `OVERRIDE` requires `dispatch.override_restrictions`. Both are recorded with `enforcementAtTime` so a later policy change can't obscure what was enforced.
6. **Release atomicity:** the PENDING → RELEASED claim (guarded `updateMany`, mirroring the close route's regression-locked pattern), the decision rows, and the `restrictionSnapshot` write happen in one `db.$transaction`. No external calls inside the transaction (ADR-011 discipline — this gate makes no provider calls at all; payment readiness reads local `PaymentMethodReference` state only, never Stripe).
7. **Tenancy:** every load is scoped by `session.organizationId`; cross-tenant dispatch/aircraft/student/instructor references are 404s (existing rule); the evaluator receives only org-scoped rows.
8. **Financial keys self-disable** when the org lacks the billing module, when the dispatch has no billable customer, or when `ScheduleEvent.type = MAINTENANCE_BLOCK` (§3.3).
9. **Currency:** `thresholdAmount` comparisons happen in the payer's Amount Due currency; mismatched currency (multi-currency org, future) degrades the finding to `WARN` with an explicit "currency mismatch — review manually" basis rather than guessing a conversion.
10. **Warnings never require interaction** — a `WARN` finding must not add a click to release (Product principle: every click saves time; operational workflow first).
11. **No AI mutation:** the evaluator computes; only humans override, acknowledge, or release, through permissioned APIs (constitution rule 8).

---

## 8. RBAC, approvals & audit

### New permission keys (`src/lib/permissions.ts` — data, never hardcoded role checks)

| Key | Label | Grants | Default bundles |
|---|---|---|---|
| `dispatch.review_restrictions` | Clear checkout restrictions requiring Operations review | Acknowledge `REQUIRE_REVIEW` findings during release | ACCOUNT_OWNER / SCHOOL_ADMIN (via all-permissions). Recommend adding to the Operations Director and Chief Flight Instructor role templates (`src/lib/role-templates.ts`) in Part 2. Not in DISPATCHER's default bundle — the escalation *is* the feature. |
| `dispatch.override_restrictions` | One-time override of blocking checkout restrictions (with reason) | Record an `OVERRIDE` decision for `BLOCK_OVERRIDABLE` findings | ACCOUNT_OWNER / SCHOOL_ADMIN only by default; orgs delegate via custom OrgRoles. |

Neither key can clear a SAFETY finding — the engine never produces an overridable disposition for SAFETY keys, so no permission combination reaches one (structural, not procedural). The `dispatch.` prefix keeps these outside module gating (dispatch is core; the financial keys already self-gate per §3.3.4). Configuration writes ride the existing `settings.manage`.

### Approval flow summary

- `REQUIRE_REVIEW`: not an async queue — the release action itself escalates. An actor without the permission receives 403 + findings and hands off through the designed mechanism in §3.5 (Request Operations review → notification with deep link → remote `REVIEW_CLEARED` on the still-`PENDING` dispatch → the original dispatcher completes the release); an actor with the permission acknowledges each finding inline (recorded as `REVIEW_CLEARED`). This keeps one gate and one workflow, per the spec's "Require Operations review" without inventing a second approval system alongside the Revenue Review's own approval chain (04-revenue-review.md).
- Separation of duties for *financial approval* lives in the Revenue Review approval chain, not here; this gate governs dispatch only.
- Read-only impersonation cannot release, acknowledge, or override (`mutating: true` on every path); full-access impersonation is re-attributed to the platform staffer centrally by `recordAudit` (ADR-023).

### Audit actions (all via `recordAudit`, never skipped)

| Action | When | Payload highlights |
|---|---|---|
| `dispatch.release` (existing, extended) | Every release | Full `findings` snapshot (all dispositions incl. passes), decisions applied |
| `dispatch.restriction_overridden` | Each `OVERRIDE` decision | key, category, `enforcementAtTime`, `findingDetail`, reason, decision row id |
| `dispatch.restriction_review_cleared` | Each `REVIEW_CLEARED` decision (inline or remote, §3.5) | Same shape |
| `dispatch.restriction_review_requested` | Dispatcher requests Operations review from the 403 panel (§3.5) | Outstanding `REVIEW_REQUIRED` findings, count of permission holders notified |
| `dispatch.restriction_policy_updated` | Policy create/update/delete | Before/after values (org-settings pattern) |
| `dispatch.release_refused` | A release attempt refused by blockers *(recommended — gives owners visibility into friction; cheap because it's audit-only)* | Blocking findings |

No new domain events in Part 1. If Part 3 wants automations on overrides, `WEBHOOK_EVENTS` gains an entry with a live emit site in the same change (constitution vocabulary rule).

---

## 9. UX notes (aviation-native, operational workflow first)

- **Release readiness panel** on the dispatch board release card (extends `dispatch-board.tsx`, not a new page): findings listed in severity order — red blockers, amber "Operations review required", amber warnings, green passes collapsed. Every finding shows its `resolution` text: *"N54321 is grounded — Maintenance must return it to line"*, *"Jordan Torres owes $612.40 (threshold $500) — collect payment or override below"*. Errors always say what to do next.
- **Safety blockers never render an override control.** The panel shows the safety authority path and deep-links to it (squawk, work order, credential record). There is no "force release" anywhere in the UI, matching the airworthiness gate today.
- **Override control** (financial/escalated-operational only, permission-gated): inline reason field (required), the actor's name shown, copy states scope plainly — *"Override applies to this dispatch only and is recorded with your name."* The confirm reads **"Override and release"** — financial consequence explicit (Product principle 2).
- **Operations review hand-off** (§3.5): when the acting dispatcher lacks `dispatch.review_restrictions`, the amber "Operations review required" section renders a **Request Operations review** action instead of inline acknowledgment controls, with a status line once requested (*"Requested — Operations notified"*). Reviewers land on this same readiness panel via the notification deep link and clear findings from there; the dispatcher's panel reflects standing clearances on refresh so the release completes without re-entering anything.
- **Warnings cost zero clicks.** They render, they're captured in the snapshot, release proceeds. A dispatcher on the ramp with a student waiting is the design persona.
- **Terminology:** *Release*, *Return*, *Dispatch*, tail numbers, Hobbs — never "check-in" or "ticket" (AVIATION_STANDARDS.md; UX-gate auto-check).
- **Status tones** for finding chips (`Blocked`, `Review required`, `Warning`, `Cleared`, `Overridden`) register in `src/lib/status-colors.ts` — the single `STATUS_TONE` map; existing meanings unchanged.
- **Settings → Checkout Restrictions**: the full matrix as a table — key, tier badge, effective mode, source (Pinned / Default / Org policy), thresholds, exemptions. Pinned rows render locked with an explanatory tooltip rather than disappearing — owners should *see* that safety is non-negotiable.
- **Revenue Review context:** the review's flight-information section (04-revenue-review.md) surfaces the release `restrictionSnapshot` — an approver seeing "released with Amount Due override: reason…" has the context that explains the charge decision.
- Light + dark, mobile parity, loading/empty/error states — standard bar.

---

## 10. Interactions with other Revenue Engine components

| Sibling doc | Interaction |
|---|---|
| [03-operational-checkout.md](./02-operational-dispatch-and-closeout.md) | Owns the checkout/return workflow and the Dispatch model extension (organizationId, actor FKs, capture fields). This gate is a step inside its release flow; restrictions never gate return/operational closeout. The maintenance/positioning carve-out marker (§3.3.2) is finalized there. |
| [04-revenue-review.md](./03-revenue-review-lifecycle.md) | *Payment Failed* review status is the eventual source for `PRIOR_PAYMENT_FAILED`; the Revenue Review surfaces the release `restrictionSnapshot`; the review's approval chain — not this gate — owns financial separation of duties. |
| [09-responsible-payers.md](./11-responsible-payers.md) | Responsible-payer resolution defines the *subject* of every FINANCIAL key; `PaymentMethodReference` is the source for `PAYMENT_METHOD_MISSING`. |
| [11-payment-timing.md](./09-payment-timing-and-collection.md) | Org payment timing policy determines `PAYMENT_METHOD_MISSING` applicability (manual-invoice orgs auto-pass it). |
| [13-database-model.md](./13-database-model.md) | Binding call on money precision/currency representation, Dispatch tenancy/actor columns, and final placement of the models in §5. |
| [README.md](./README.md) | Design-set index and cross-document vocabulary. |

---

## 11. Out of scope for Part 1 / deferred to Parts 2–3

**Part 2 (implementation):** engine + contract tests, release-route integration (including the guarded-claim hardening), preview endpoint, Operations review hand-off (request-review + remote clearance endpoints and their in-app `Notification` rows, §3.5), settings route + UI, permission keys + role-template updates, migrations, seed fixtures, org-snapshot wiring, status-tone entries, `PaymentMethodReference`/`PaymentAttempt`-backed financial sources as those models land.

**Part 3 (or later):**

- Currency/recency computation engine (flight review, 90-day solo, IPC) powering rows 6–7 fully; endorsement-requirement catalog for row 8; program prerequisite definitions for row 10 (which then loses its `OFF` exception).
- Booking-time advisory surfacing in the scheduling conflict panel (§3.4).
- Promotion of solo-endorsement-missing / solo-currency to SAFETY tier once computable (pending §11.4).
- `OPEN_MAJOR_SQUAWK` warning key; per-location and per-program policy variants; standing (multi-dispatch) waivers — Part 1 supports one-time overrides only.
- Payer notifications on financial blocks (no email substrate exists; in-app `Notification` rows only if Part 2 wants them).
- Domain events / automations on overrides.

**Never in scope:** any override path for SAFETY-tier restrictions; gating aircraft return, squawk filing, grounding, or any safety action on financial state; Stripe or other external calls inside the release transaction.

---

## 12. Open questions

1. **`PRIOR_PAYMENT_FAILED` default — `WARN` or `REQUIRE_REVIEW`?** This design defaults `WARN` (parity with today's advisory-only posture and the every-click-saves-time principle) and documents `REQUIRE_REVIEW` as the recommended hardening. A Flight School Owner call on default credit-risk appetite.
2. **Renter insurance applicability:** should `INSURANCE_DOCUMENT_MISSING` evaluate all flights by default, or only `RENTAL` event types (many schools require renter's insurance for rentals but not enrolled students)? Design currently evaluates all; scoping to `RENTAL` by default may be the better zero-config behavior.
3. **Config permission placement:** policy CRUD under `settings.manage` (chosen) vs a dedicated key shared with Revenue Rule management if the pricing/rules docs introduce one — needs one consistent answer across the design set.
4. **Solo-currency promotion:** once the currency engine can *prove* a missing/expired solo endorsement, does `STUDENT_NOT_CURRENT`/`ENDORSEMENT_MISSING` (solo case) become SAFETY-pinned, or stay org-configurable with a `BLOCK` default? Recommendation: promote (a solo without a valid endorsement is a regulatory violation, not a preference). Chief Flight Instructor decision.
5. **Role-exemption semantics:** subject-based only (chosen), or should orgs also be able to exempt *actors* (e.g., the Chief Pilot releasing anyone bypasses financial checks)? Actor exemptions weaken auditability of the override trail and are deliberately excluded pending a real customer need.
6. **Emergency carve-out marker:** is `ScheduleEvent.type = MAINTENANCE_BLOCK` a sufficient signal for maintenance/ferry/positioning dispatches, or does Dispatch need an explicit purpose flag (owned by 03-operational-checkout.md)?
