# Current Billing-System Audit

> **Status:** Proposed — Phase 8 Part 1 · **Date:** 2026-07-10 · **Lead roles:** Database Architect; Financial Systems Architect · **Part of:** Revenue Engine design set ([README](./README.md))

This is Deliverable 1 of the Phase 8 Part 1 design set: the definitive record of how billing works in AeroOps **today**, audited before anything is added (spec Part L: "Audit the current Prisma schema before adding anything. Reuse existing models where safe."). Every sibling design document builds on the verdicts here; the binding field-level schema decisions land in [13-database-model.md](./13-database-model.md).

**Confirmations (spec deliverables 17–18):** Nothing was deployed. No live payments were enabled. No Stripe integration or payment provider exists in the codebase today (§10), and Phase 8 Part 1 changed no source code, schema, or migrations — design documents only.

---

## 1. Purpose & scope

### 1.1 What this document covers

- Current data model inventory: billing, dispatch, meters, audit, and webhook models with field-level notes and file/line citations (§4).
- The dispatch-close → invoice flow as it actually executes, including exact transaction boundaries (§2.2).
- Current billing UI surfaces (§7), rate sources (§2.5), configuration surface (§3), RBAC/audit (§6).
- Strengths worth keeping (§8) and a gap analysis mapping every Phase 8 capability to a reuse/extend/replace/new verdict (§9).
- Part L database-rules compliance snapshot and migration-safety facts (§11).

### 1.2 Mission mapping — the defining workflow vs. today

The Revenue Engine's defining workflow (spec Mission) runs from aircraft dispatch to reconciled reports. Here is how far the current system gets:

| Mission step | Current state |
|---|---|
| Aircraft dispatched | Partial. `Dispatch` rows exist only from seed/demo/simulation — **no API route or UI creates a Dispatch** (`src/app/api/dispatch/` has only `[id]/release` and `[id]/close`). |
| Hobbs and Tach Out recorded | Yes — snapshotted from `Aircraft.currentHobbs/currentTach` at release (`release/route.ts:43-44`). |
| Flight occurs | Yes — `ScheduleEvent` status machine (`DISPATCHED` → `COMPLETED`). |
| Aircraft returned; Hobbs/Tach In recorded | Yes — dispatch closeout (`close/route.ts`). Tach In is captured but never validated against Tach Out (§5). |
| Operational records updated | Yes — meters, SMOH/SPOH, student hours, schedule event, squawks, all in one transaction (§2.2). |
| Revenue Review generated | **No.** Closeout creates a final `OPEN` invoice immediately — operational and financial closeout are one conflated action ("Close & bill flight"). |
| Instructor and Operations review | **No.** No review workflow, no instructor time entry, no approval states. |
| Revenue Review approved / Invoice locked | **No.** No approval fields, no lock, no snapshot columns; invoice totals are recomputed from lines at every read. |
| Saved card or ACH charged | **No.** No payment provider, no saved payment methods; payments are manually recorded rows. |
| Payment reconciled | **No.** No payment status machine, no idempotency, no inbound webhook table. |
| Revenue allocated / platform fee | **No.** No allocation, ledger, or platform-fee models. |
| Instructor compensation recorded | **No.** One `Instructor.hourlyRate` serves as the customer billing rate; compensation does not exist. |
| Receipt and reports updated | Partial. Reports exist but recompute "revenue" from **current** rates (§7.3), violating spec principle 5 today. |

Everything from "Revenue Review generated" downward is greenfield. The steps above it are live, seeded, and protected by do-not-break rules — the Revenue Engine extends them; it does not replace them.

---

## 2. How it works today (workflows / state machines)

### 2.1 Dispatch lifecycle

`DispatchStatus`: `PENDING → RELEASED → CLOSED` (or `CANCELLED`) — `prisma/schema.prisma:898-903`. One `Dispatch` per `ScheduleEvent` (`scheduleEventId String @unique`, Cascade, `schema.prisma:907,938`).

**Release** (`src/app/api/dispatch/[id]/release/route.ts`):

1. `authorize("dispatch.release", { mutating: true })` (line 18).
2. Tenant-scoped load **through the aircraft relation** — `where: { id, aircraft: { organizationId: session.organizationId } }` (lines 22-25); Dispatch itself has no `organizationId` column.
3. Requires `status === "PENDING"` (line 27); hard airworthiness gate via `airworthinessOf()` → 409, no override (lines 28-31). This is the only checkout restriction today — zero financial checks.
4. Zod checklist: `fuelQty`, `oilQty` strings; `weatherAcknowledged`/`documentsVerified` must be literal `true` (lines 8-15).
5. Single update: `status: "RELEASED"`, `releasedAt`, `releasedBy` as a **free-text name label** (not a user FK, line 42), `hobbsOut`/`tachOut` snapshotted from `aircraft.currentHobbs/currentTach` (lines 43-44), nested `scheduleEvent` → `DISPATCHED`.
6. `recordAudit("dispatch.release")` (lines 49-57).

### 2.2 The dispatch-close → invoice flow (transaction boundaries)

`src/app/api/dispatch/[id]/close/route.ts` — the canonical money-moving write path (ARCHITECTURE.md §16, ADR-011, **do-not-break rule 5**, statically regression-locked by `tests/dispatch-idempotency.test.ts`).

**Before the transaction** (lines 31-62):

- `authorize("dispatch.close", { mutating: true })`; tenant-scoped load through `aircraft.organizationId`; requires `status === "RELEASED"` else 400.
- Zod body: `hobbsIn`, `tachIn`, `landings`, `nightTime`, `instrumentTime`, `fuelAddedGal`, optional `squawk` (lines 10-18).
- `hobbsOut` falls back to `aircraft.currentHobbs` if release never set it (line 46).
- `flightTimeFromHobbs(hobbsOut, hobbsIn)` throws → 400 if `hobbsIn <= hobbsOut` (lines 47-52). **`tachIn` is never validated against `tachOut`.**
- Charges computed from **live** rates: `Number(dispatch.aircraft.hourlyRateWet)` and `Number(dispatch.instructor.hourlyRate)` via `computeFlightCharges()` (lines 54-60); `isDual = !!dispatch.instructorId`.
- Invoice number generated as `` `INV-${Date.now().toString().slice(-8)}` `` (line 62) — timestamp-derived, non-sequential, same-millisecond collision + ~27.7h wraparound risk (ADR-021 risks; ROADMAP.md:472).

**Inside `db.$transaction(async (tx) => {...})`** (lines 65-161), in order:

1. **Atomic claim**: guarded `tx.dispatch.updateMany({ where: { id, status: "RELEASED" }, data: { status: "CLOSED", closedAt, hobbsIn, tachIn, flightTime, landings, nightTime, instrumentTime, fuelAddedGal, dualReceived/dualGiven/picTime } })`; `claim.count === 0` throws `DispatchAlreadyClosed` → aborts the transaction → 409 (lines 71-88, 182-184). This is the proven double-submit/idempotency pattern.
2. `ScheduleEvent` → `COMPLETED` (lines 90-92).
3. Aircraft meters: `currentHobbs`/`currentTach` **SET** to check-in values; `engineTimeSmoh`/`propTimeSpoh` **incremented** by `flightTime` (lines 94-102). Last-write-wins — no meter history table; out-of-order closeouts could regress meters silently.
4. If `studentId`: `Student.totalHours` (and `soloHours` when solo) incremented; **`Student.accountBalance` decremented by `charges.total`** (lines 104-112) — the "ledger" is this single signed column.
5. `tx.invoice.create`: `status: "OPEN"`, `dueAt = now + 14 days` (hardcoded), lines = `AIRCRAFT_RENTAL` (qty = flightTime, unitPrice = live wet rate) + optional `INSTRUCTOR_TIME` (qty = flightTime + 0.5, unitPrice = live instructor rate) (lines 113-139). **No dispatch is billed when it has no `studentId`** — renter/no-student flights are metered but never invoiced. **The invoice carries no FK back to the Dispatch** — linkage exists only in description strings.
6. Optional squawk + notification + aircraft `GROUNDED` on `GROUNDING` severity (lines 142-157).

**After the transaction** (lines 163-178): `recordAudit("dispatch.close")`, logger, `emitDomainEvent("flight.closed")`. No external/network calls exist inside the transaction — the codebase already satisfies "no Stripe inside the check-in transaction" by construction, and ADR-011's reconsider-when clause explicitly directs slow external calls post-commit onto the event bus.

### 2.3 Payment recording flow

`src/app/api/invoices/[id]/payments/route.ts` — the **only** invoice API route (no create/void/adjust endpoint exists):

1. `authorize("billing.record_payments", { mutating: true })` (line 15); tenant-scoped load; rejects `PAID`/`VOID` invoices (lines 24-26).
2. Total computed **at read time** from lines with `Number()` float math and a `0.005` tolerance (lines 31-34) — no stored total column anywhere.
3. Array-form `db.$transaction`: `payment.create` + `invoice.update` (status → `PAID`/`PARTIALLY_PAID`) + `Student.accountBalance` **incremented** (lines 36-44).
4. `recordAudit("billing.payment_recorded")`; `emitDomainEvent("invoice.paid")` only when fully paid (lines 46-58); 201.

No payment status machine (no pending/failed/refunded), no idempotency key, no server-side overpayment guard (UI `max` attribute only), no actor column on the `Payment` row (attribution lives only in `AuditLog`), no refund path.

### 2.4 Invoice status machine as actually exercised

`InvoiceStatus`: `DRAFT | OPEN | PAID | PARTIALLY_PAID | VOID | OVERDUE` (`schema.prisma:1090-1097`).

| Value | Who sets it |
|---|---|
| `DRAFT` | **Nobody.** No code path uses it; closeout creates `OPEN` directly. |
| `OPEN` | Dispatch closeout (`close/route.ts:118`), Import Center, seed. |
| `PAID` / `PARTIALLY_PAID` | Payments route (line 34/40); founder simulation flips invoices `PAID` (`src/lib/simulation.ts:235`). |
| `VOID` | No route; import/seed only. |
| `OVERDUE` | **Never transitioned by code.** Only created by seed/import. `executive/page.tsx:53`, `health-score.ts:110`, `insights.ts:45` each ad-hoc treat `dueAt < now` as overdue at read time. |

Sites that mutate `Invoice` after creation (relevant to any future lock/freeze design): payments route (status), Import Center update strategy (`src/lib/import/engine.ts:435` — status/dueAt), simulation (`simulation.ts:235`), and org-snapshot restore, which re-inserts invoices/lines/payments wholesale (`src/lib/org-snapshot.ts:182`). Any hard DB-level freeze on approved invoices must keep the status machine mutable and must not break tenant restore, import-update, or simulation.

### 2.5 Where rates come from today

| Rate | Source | Notes |
|---|---|---|
| Aircraft rental | `Aircraft.hourlyRateWet Decimal(8,2)` **required** (`schema.prisma:676`) | Read **live at close time** (`close/route.ts:57`). Always billed wet, always on Hobbs. |
| Aircraft dry rate | `Aircraft.hourlyRateDry Decimal(8,2)?` (`schema.prisma:677`) | Display-only on the aircraft detail page — never billed. |
| Fuel surcharge | `Aircraft.fuelSurchargePerHr Decimal(6,2)?` (`schema.prisma:672`) | Display-only — never billed, despite `FUEL_SURCHARGE` existing in `LineItemKind`. |
| Instructor charge | `Instructor.hourlyRate Decimal(8,2) @default(65)` (`schema.prisma:594`) | One flat rate per instructor, read live at close. Doubles as the implied compensation rate — no separate compensation exists. |
| Instructor hours | `flightTime + BRIEF_DEBRIEF_HOURS (0.5)` hardcoded (`src/lib/billing.ts:9,46`) | Instructors never enter time; ground/sim instruction is never billed (`GROUND_INSTRUCTION`/`SIMULATOR_TIME` kinds exist but nothing creates them). |
| Lesson pricing | — | `LessonType` (`schema.prisma:839-855`) has **no pricing fields**. |

No effective dating, no versioning, no eligibility (membership/program/customer type), no billing-basis choice (Hobbs vs Tach vs fixed), no minimum billable duration, no rounding configuration, no priority/resolution. **Changing a rate today silently changes future invoices and rewrites historical "revenue" in reports (§7.3).** The `Instructor` profile is per-User (`userId @unique`, `schema.prisma:589`) and shared across orgs — per-org instructor rates are structurally impossible today (recorded deferral, DATABASE_STANDARDS.md:223-225).

### 2.6 The pricing engine

`src/lib/billing.ts` (49 lines) — pure, framework-free, "the single source of truth for how a closed flight turns into money." Exports: `BRIEF_DEBRIEF_HOURS = 0.5`, `roundHours` (tenths), `roundMoney` (cents), `flightTimeFromHobbs` (throws on `hobbsIn <= hobbsOut`), `computeFlightCharges` (aircraft = flightTime × wet rate; instructor = `(flightTime + 0.5) × hourlyRate` when dual). Callers: close route (authoritative), dispatch board live estimate (`dispatch-board.tsx:208` duplicates the formula client-side), and seed. Arithmetic is JS floats rounded to cents; the DB stores Decimal.

---

## 3. Configuration surface (org-level options today)

There is **no settings JSON blob**. The established idiom is explicit typed columns on `Organization` plus dedicated tenant-scoped config tables (`OrgRole`, `LessonType`, `Location`), updated via zod-validated PATCH routes with before/after `recordAudit` (`src/app/api/organization/settings/route.ts`).

| Config | Location | Default | Billing relevance |
|---|---|---|---|
| `billingMode` | `Organization` (`schema.prisma:235`; enum `MANUAL \| STRIPE`, lines 205-208) | `MANUAL` | **How the org pays AeroOps** (platform subscription) — NOT customer payments. Must not be overloaded by the Revenue Engine (ARCHITECTURE.md §13 keeps the two money systems distinct). |
| `billingEmail` | `Organization:221` | null | Contact only. |
| `timeZone` | `Organization:231` | `America/New_York` | Affects any future batch/day-boundary policy. |
| `planId` → `SubscriptionPlan.modules` | `schema.prisma:110-124`, `src/lib/features.ts` | seed grants `billing` | The `billing` module is org-disable-able (not in `CORE_MODULES`); `authorize()` module-gates all `billing.*` permissions via `MODULE_BY_PREFIX` (`src/lib/session.ts:263-266`). |
| `disabledModules` / `businessProfiles` / `disabledAutomations` | `Organization:249-253` | `[]` | The feature-gating pattern for shipping the Revenue Engine per plan/org. |

**Values that are hardcoded today but Phase 8 makes configurable:** brief/debrief pad 0.5h (`billing.ts:9`); invoice due `+14 days` (`close/route.ts:119`); billing basis always Hobbs wet; rounding (tenths/cents in `billing.ts`); the ops-page "owes > $500" warning threshold (`operations/page.tsx:81-86`); currency — `formatCurrency` hardcodes `en-US`/USD (`src/lib/utils.ts:8`) and **no currency column exists anywhere in the schema** (grep: 0 hits).

---

## 4. Current data model inventory

All ids are `String @id @default(cuid())`; schema is `prisma/schema.prisma` (1,635 lines, 54 models, Prisma 6 pinned, PostgreSQL 16).

### 4.1 Invoice (`schema.prisma:1099-1117`)

| Field | Type | Notes |
|---|---|---|
| `organizationId` | String, FK Cascade | Tenant-scoped; `@@unique([organizationId, number])` (line 1114, ADR-021 moved it from global). |
| `studentId` | String? , FK | Nullable — the only payer concept in the system. |
| `number` | String | `INV-####` (seed sequential from 1041), `INV-{Date.now() slice}` (closeout), `INV-SIM-{base36}` (simulation). No sequence mechanism. |
| `status` | `InvoiceStatus @default(OPEN)` | See §2.4. |
| `issuedAt` | DateTime `@default(now())` | The documented `createdAt` domain substitute. **No `updatedAt`.** |
| `dueAt` | DateTime? | Set to +14d at closeout. |
| `memo` | String? | — |

Indexes: `[organizationId, status]`, `[studentId]` (lines 1115-1116). **Missing entirely:** subtotal/tax/total/balance columns (totals always derived by float-summing lines at read), currency, approval/lock/snapshot fields, `dispatchId` or any link to the originating Dispatch, `updatedAt`.

Live readers that must not break: `billing/page.tsx`, `billing/[id]/page.tsx`, `executive/page.tsx`, `src/lib/health-score.ts:87`, `insights.ts:44`, `mission-control.ts:378`, `customer-success.ts:33`, `demo-generator.ts:477-493`, `api/search:45`, `api/ai/ask:45`, Import Center (`src/lib/import/engine.ts:424-467`, sources include `quickbooks` and `stripe` CSVs), `org-snapshot.ts`, `simulation.ts`.

### 4.2 InvoiceLine (`schema.prisma:1132-1143`)

Note: the existing model name is **`InvoiceLine`** — the Phase 8 spec's "InvoiceLineItem" refers to this model; do not rename it.

| Field | Type | Notes |
|---|---|---|
| `invoiceId` | FK, **Cascade** | Lines die with the invoice. |
| `kind` | `LineItemKind @default(OTHER)` | 10 closed values (lines 1119-1130): `AIRCRAFT_RENTAL, INSTRUCTOR_TIME, GROUND_INSTRUCTION, SIMULATOR_TIME, FUEL_SURCHARGE, MEMBERSHIP_FEE, LATE_FEE, SUPPLY, DISCOUNT, OTHER`. Only the first two are ever created by code. |
| `description` | String | Carries the only dispatch linkage (tail number, hours) as prose. |
| `quantity` | `Decimal(8,2) @default(1)` | Hours or units. |
| `unitPrice` | `Decimal(10,2)` | Snapshot of the live rate at creation — the only accidental "snapshotting" in the system. |

Missing: tax fields, line total, rate-source/provenance metadata, actor/reason fields.

### 4.3 Payment (`schema.prisma:1154-1165`)

| Field | Type | Notes |
|---|---|---|
| `invoiceId` | FK, **`onDelete: Cascade`** | **A financial record can be cascade-deleted with its invoice** — an immutability landmine flagged for `13-database-model.md`. |
| `amount` | `Decimal(10,2)` | — |
| `method` | `PaymentMethod @default(CARD)` | `CARD, ACH, CASH, CHECK, ACCOUNT_CREDIT, GIFT_CERTIFICATE` (lines 1145-1152). |
| `reference` | String? | Free text — "Stripe payment intent id, check #". Seed writes fake `pi_<random>` values (`seed.ts:412`). No uniqueness. |
| `paidAt` | DateTime `@default(now())` | **Unindexed** despite being the hot reporting aggregate axis (ROADMAP.md:394). |

Missing: status machine (pending/processing/failed/refunded), idempotency key, failure metadata, actor, currency. No `PaymentAttempt`, `PaymentTransaction`, `Refund`, or `Dispute` models exist.

### 4.4 Dispatch (`schema.prisma:905-944`)

| Field group | Fields | Notes |
|---|---|---|
| Identity | `scheduleEventId @unique` (Cascade), `aircraftId`, `studentId?`, `instructorId?`, `status DispatchStatus @default(PENDING)` | **No `organizationId`** — tenant scope reaches through `ScheduleEvent`/`Aircraft` (documented as intentional, DATABASE_STANDARDS.md:198-201). No `createdAt`/`updatedAt`. |
| Pre-flight release | `fuelQty String?`, `oilQty String?`, `weatherAcknowledged/documentsVerified/instructorApproved/studentApproved Boolean @default(false)`, `releasedAt DateTime?`, `releasedBy String?` | `releasedBy` is a display-name label, not a user FK. |
| Post-flight closeout | `hobbsOut/hobbsIn/tachOut/tachIn Decimal(9,1)?`, `flightTime/nightTime/instrumentTime/dualReceived/dualGiven/picTime Decimal(6,1)?`, `landings Int?`, `fuelAddedGal Decimal(6,1)?`, `closedAt DateTime?` | No check-in actor, condition, oil-added, airports-visited, route, or fee-capture fields. |

Index: `@@index([status])` only (line 943) — not org-leading; `Dispatch(status, closedAt)` is a known missing reporting index (ROADMAP.md:394). **No relation to Invoice in either direction** — "charge the same dispatch twice" has no DB-level enforcement point today. Per the design set's canonical position: **reuse and extend `Dispatch`; do not invent a parallel "DispatchRecord" model.**

### 4.5 Aircraft meters & pricing (`schema.prisma:653-705`)

| Field | Type | Notes |
|---|---|---|
| `hourlyRateWet` | `Decimal(8,2)` **required** | The only billed rate. |
| `hourlyRateDry`, `fuelSurchargePerHr`, `estimatedHourlyCost`, `insuranceCostMonthly` | Decimal, optional | Display/analytics only. |
| `currentHobbs`, `currentTach`, `engineTimeSmoh`, `propTimeSpoh` | `Decimal(9,1) @default(0)` (lines 681-684) | SET/incremented by closeout (§2.2). No meter-history table. |
| Tenancy | `@@unique([organizationId, tailNumber])`, `@@index([organizationId, status])`, org Cascade (lines 691, 703-704) | The reference tenancy pattern. |

`AircraftComponent` (`schema.prisma:710-725`) holds maintenance intervals (`dueAtHours/lastDoneHours Decimal(9,1)`, `dueAtDate`, `intervalHours/intervalMonths`), scoped via `aircraftId`. Maintenance intervals currently accrue on **Hobbs**, not Tach (AVIATION_STANDARDS.md Gap #1 — documented deviation). `AircraftType` is global (no organizationId).

### 4.6 Instructor & Student (`schema.prisma:544-607`)

- `Instructor`: `userId @unique` (one profile per user, shared across orgs), `hourlyRate Decimal(8,2) @default(65)` — a single flat customer-billing rate; no compensation rate, no per-category rates, no effective dating, no contractor classification. Seed fixtures: $75/$85/$68/hr (demo org), $60/hr (Blue Ridge).
- `Student`: `accountBalance Decimal(10,2) @default(0)` (line 566) — the signed running balance the spec de-emphasizes. **Semantics: negative = student owes** (seed: −420.50, −1180.25, −95.00 owed; +250, +500 credit — `seed.ts:125-131`). Actively written by closeout (decrement) and payments (increment); read by dashboard (`owed = max(0, −balance)`), ops warnings, billing UI, and the Import Center (which documents the sign convention). No payer/guardian linkage anywhere.

### 4.7 Audit & webhook models

- `AuditLog` (`schema.prisma:137-164`): `actorUserId` bare String (no FK — API keys record `apikey:<id>`), `actorPlatformUserId`/`impersonatedUserId`/`impersonationSessionId` for impersonation attribution (ADR-023), `oldValue/newValue Json`, org relation **SetNull** (the trail outlives the tenant), indexes `[organizationId, createdAt]`, `[action, createdAt]`, `[actorUserId, createdAt]`. Written via `recordAudit` (`src/lib/audit.ts:38`) — never throws, centrally re-attributes impersonated actions. Existing financial actions: `dispatch.release`, `dispatch.close`, `billing.payment_recorded`.
- `Webhook`/`WebhookDelivery` (`schema.prisma:1356-1384`): **outbound only.** `Webhook.secret` is a raw HMAC signing key (allowlisted exception in `tests/token-security.test.ts`); `WebhookDelivery` stores event/statusCode/success/error — no payload, no retry count. **There is no inbound webhook-event model** — nothing stores provider event ids or guarantees idempotent processing. Event catalog (`src/lib/webhooks.ts:5-12`): `lead.created, flight.closed, aircraft.grounded, invoice.paid, schedule.cancelled, maintenance.completed`.

### 4.8 Adjacent precedents the Revenue Engine should copy

| Precedent | Where | Reuse as |
|---|---|---|
| Append-only ledger idiom | `InventoryMovement` (`schema.prisma:1427-1441`) — signed quantity, typed enum, never updated, "every stock change, forever" | LedgerEntry / Revenue Allocation / Instructor Compensation record shape. |
| Electronic-signature approval | `MaintenanceOrder.approvedBy String? / approvedAt DateTime?` ("Return-to-service approval", `schema.prisma:799-801`); 12-state `MaintenanceStatus` | Revenue Review approval fields and rich status machine. |
| Rollback manifest / per-row outcomes | `ImportJob.createdRecords` (`schema.prisma:1627-1629`), Import Center engine | Financial Export jobs and payment batches. |
| Two-step migration (DDL, then idempotent data backfill) | `20260710031814_*` + `20260710032000_*`; DATABASE_STANDARDS.md:55-70 | Every Phase 8 enum addition and the `Dispatch.organizationId` backfill. |
| Tx-composable service primitives | `src/lib/memberships.ts` (`*Tx(tx, args)`) | Payer-student linking and financial state-transition services. |

### 4.9 Part L expected-concepts checklist

Spec Part L lists the models it expects the design to need. Current status of each:

| Spec Part L concept | Exists today? | Nearest existing thing / verdict |
|---|---|---|
| DispatchRecord / AircraftCheckOut / AircraftCheckIn | Partial | `Dispatch` covers all three phases in one model. **Extend `Dispatch`** (canonical position) — do not create parallel models. |
| RevenueReview | No | Nothing. New model. |
| BillingCalculation | Partial | `src/lib/billing.ts` computes but persists nothing. New snapshot storage. |
| AircraftPricingProfile | No | Two flat columns on `Aircraft`. New model. |
| InstructorRateProfile | No | One flat `Instructor.hourlyRate`. New model. |
| InstructorTimeEntry | No | `Dispatch.dualGiven` + hardcoded 0.5h pad. New model. |
| RevenueItem / RevenueReviewLineItem | No / No | `LineItemKind` closed enum of 10. New models. |
| TaxSnapshot | No | Zero tax fields anywhere. New model. |
| DiscountAdjustment | No | `DISCOUNT` line kind only, never created. New model. |
| ResponsiblePayer / StudentPayerRelationship | No | `Invoice.studentId` is the only payer concept. New models. |
| Invoice / InvoiceLine (spec: "InvoiceLineItem") | **Yes** | Extend additively (§9). |
| InvoiceApproval | No | `MaintenanceOrder.approvedBy/At` is the precedent. New. |
| PaymentCustomer / PaymentMethodReference | No | Nothing stores provider customer or instrument references. New. |
| PaymentAttempt / PaymentTransaction | No | Legacy `Payment` is a manual record with no status. New models alongside it. |
| Refund / Dispute | No | Nothing. New. |
| RevenueAllocation / InstructorEarning (Instructor Compensation) / PlatformFee | No | `InventoryMovement` is the append-only idiom. New. |
| WebhookEvent (inbound) | No | Outbound `Webhook`/`WebhookDelivery` only. New — must follow the PRODUCTION.md §13.2 `stripeEventId @unique` unique-insert pattern. |
| FinancialExportJob / AccountingMapping | No | `ImportJob` manifest pattern is the template. New. |

Binding field lists, precisions, and index sets for all of the above: [13-database-model.md](./13-database-model.md).

---

## 5. Validation & business rules (current)

| Rule | Enforced today? | Where / gap |
|---|---|---|
| Hobbs In > Hobbs Out | Yes | `flightTimeFromHobbs` throws (`billing.ts:22-27`) → 400. |
| Tach In > Tach Out | **No** | `tachIn` accepted with zero validation against `tachOut` (AVIATION_STANDARDS.md Gap #2). |
| Implausible meter increases | **No** | No configured thresholds; no warning framework. |
| Duplicate closeout ("charging the same dispatch twice") | Partial | The guarded `updateMany` claim prevents double-close (§2.2), but with no Dispatch↔Invoice FK there is no DB-level uniqueness preventing a second invoice against the same dispatch through any other path. |
| Cross-tenant references | Yes (app-layer) | All loads org-scoped from the session; cross-tenant ids are 404s. No RLS — application isolation is the only isolation. |
| Duplicate payments / idempotency | **No** | No idempotency key, no unique `Payment.reference`, no state machine below the invoice level. |
| Overpayment guard | **No (server)** | UI `max` attribute only. |
| Invoice number uniqueness | Per-org only | `@@unique([organizationId, number])`; generator is collision-prone (§2.2). |
| Money precision | Decimal at rest, floats in flight | DB columns are Decimal; every computation (`billing.ts`, payments route line 31, all report pages) converts to `Number()` floats. |
| Currency | **No** | Implicitly USD everywhere. |
| Meter regression protection | **No** | Meters are last-write-wins SETs (§2.2). |
| Overdue transition | **No** | Read-time ad-hoc checks only (§2.4). |
| Student balance integrity | Convention only | Signed column, two writers, no ledger rows to reconcile against. |

---

## 6. RBAC, approvals & audit (current)

**Permission surface** (`src/lib/permissions.ts:9-35` — 25 keys total): the entire financial set is `billing.view`, `billing.record_payments`, plus `dispatch.release`, `dispatch.close`, `reports.view`, `reports.export`. No approve/refund/rate-management/compensation/export-financial keys exist.

**Role bundles** (data-driven, ADR-006 — routes check permission keys, never role names): `ACCOUNT_OWNER`/`SCHOOL_ADMIN` get everything; `ACCOUNTANT` ("Finance Manager") gets billing.view + record_payments + reports; `DISPATCHER` gets `billing.record_payments` but **not** `billing.view` (recorded wart, ROADMAP.md:146-147); `INSTRUCTOR` gets dispatch.release/close but no billing keys; `STUDENT` has no billing surface at all ("what do I owe?" is a recorded ROADMAP deferral). Long-tail titles (Operations Director, Chief Flight Instructor…) are **not** Role enum values — they are `OrgRole` rows seeded from `ROLE_TEMPLATES` (`src/lib/role-templates.ts`); approval chains must be new permission keys + org config, never role-name checks.

**Module gating:** all `billing.*` permissions are dead when the org's `billing` module is off (`MODULE_BY_PREFIX`, `session.ts:263-266`). A new `revenue.*` prefix would be un-gated unless added there.

**Approvals:** none exist in billing. The only approval-signature precedent is `MaintenanceOrder.approvedBy/approvedAt`. `Dispatch.instructorApproved/studentApproved` are release-checklist booleans, not financial approvals.

**Audit:** every mutation calls `recordAudit` (do-not-break rule 3). Impersonation defaults read-only, which blocks every `{mutating:true}` authorize call (`session.ts:247-255`); full-access impersonation is centrally re-attributed to the platform staffer (`src/lib/audit-attribution.ts:44-63`). The billing detail page additionally hides the payment form under `session.impersonation?.readOnly` (`billing/[id]/page.tsx:31`) — the UI-side pattern for all Revenue Engine mutations. `Payment`/`Invoice` rows carry no actor columns; attribution lives only in `AuditLog` (the house convention — `createdBy` columns are deliberately absent).

---

## 7. UX notes — current billing UI surfaces

Aviation-terminology note that binds every screen in this design set: AVIATION_STANDARDS.md bans "check-in" ("never check-in or ticket"; UX-gate auto-check). The live UI says "Close & bill flight" (`dispatch-board.tsx:275`). The Revenue Engine's customer-facing flow must use dispatch/release/return/closeout vocabulary; the spec's "aircraft check-in" phrasing is resolved in the architecture doc of this set, not silently adopted.

### 7.1 Billing list — `src/app/(app)/billing/page.tsx`

Server component querying `db` directly (no API route). Last-60 invoices (`take: 60`) with student, lines, payments; four stat cards — Outstanding (float-summed `OPEN/PARTIALLY_PAID/OVERDUE` lines minus payments, lines 35-41), Collected-this-month (`Payment.paidAt` aggregate), Overdue count, recent count. Header copy: "Invoices are generated automatically when flights close. Stripe & QuickBooks sync-ready." (line 52 — aspirational copy, no integration behind it).

### 7.2 Invoice detail — `src/app/(app)/billing/[id]/page.tsx` + `payment-form.tsx`

Line-item table with kind chips, subtotal/payments/balance-due block, payment history, and a manual `PaymentForm` (method dropdown + free-text reference) gated by `billing.record_payments` AND `!session.impersonation?.readOnly`. `payment-form.tsx:40` carries the copy "In production this connects to Stripe."

### 7.3 Dispatch board — `src/app/(app)/dispatch/page.tsx` + `dispatch-board.tsx`

Three-column board (Awaiting Release / Released–In Flight / Closed Today). The closeout card duplicates the billing formula client-side for a live estimate (line 208), defaults `hobbsIn = hobbsOut + 1.5` and `tachIn = tachOut + 1.3` (lines 195-196), hardcodes release defaults ("Full tanks (53 gal)" / "7 qt", lines 111-112). Fuel added is captured operationally but never charged.

### 7.4 Reports & executive — the snapshot violation

`reports/page.tsx:60-88` and `executive/page.tsx:56-74` compute per-aircraft/instructor/student "revenue" as `flightTime × CURRENT aircraft.hourlyRateWet` and `(ft + 0.5) × CURRENT instructor.hourlyRate` — historical revenue silently changes when a rate changes, the direct violation of spec principle 5 that snapshotting fixes. Daily collected totals use `Payment.paidAt` sums (unindexed). CSV export exists (`reports.export`); no invoice/receipt PDF, no accounting export.

### 7.5 Other surfaces

- `operations/page.tsx:81-86`: warns when a student flying today owes > $500 (from `accountBalance`) — the embryo of financial checkout restrictions.
- `settings/page.tsx:225`: Stripe shown with a "Planned" badge.
- Students and payers have **no** billing surface whatsoever.
- Status colors come exclusively from `src/lib/status-colors.ts` (`STATUS_TONE`, tested); every new Revenue Review / payment status needs an entry there.

---

## 8. Strengths worth keeping

1. **The atomic closeout transaction** (§2.2) — guarded `updateMany` claim, meters + hours + balance + invoice in one tx, external work strictly post-commit, regression-locked. This is the proven idempotency and integrity pattern for every Phase 8 financial state transition.
2. **A pure, framework-free pricing engine** (`billing.ts`) shared by API, UI estimate, and seed — the right shape for the pricing-resolution engine to grow into.
3. **Tenancy discipline**: per-org invoice numbering, org-leading indexes, session-scoped queries, machine-enforced schema governance (`tests/schema-governance.test.ts`).
4. **Data-driven RBAC + module gating** — `billing.*` is already plan/org-gateable; approval chains slot in as permission keys + config.
5. **Audit infrastructure** — `recordAudit` with impersonation re-attribution and old/new JSON already satisfies the spec's actor/reason/before-after requirement structurally.
6. **The event bus seam** (`emitDomainEvent`) — ADR-011 pre-authorizes exactly the Phase 8 posture: Stripe and notifications post-commit, never in the transaction.
7. **Precedent idioms** ready to copy: append-only `InventoryMovement`, `MaintenanceOrder` approval signature, ImportJob rollback manifests, two-step migrations, adapter-behind-env-flag (`storage.ts`).
8. **Two-tenant seed fixtures** (demo org + Blue Ridge Flying Club) with closed/released/pending dispatches and mixed invoice states — the base for Part L's multi-org validation matrix.

---

## 9. Gap analysis — Phase 8 capability → current state → verdict

Verdicts: **REUSE** (as-is) · **EXTEND** (add columns/values/behavior additively) · **REPLACE** (supersede the mechanism, keep the data) · **NEW** (greenfield).

| Phase 8 capability | Current state | Verdict |
|---|---|---|
| Dispatch / checkout / return record | `Dispatch` model, live release+close routes; no organizationId, no createdAt, no check-in actor/condition/fee fields, no creation API | **EXTEND** `Dispatch` (org FK + backfill; capture fields incl. `closedBy String?` display-label actor per the `releasedBy` precedent, 13 §3 R18); the Revenue Review link is a FK on `RevenueReview.dispatchId` with the one-active-review partial unique (13 §3 R4) — **no review column on Dispatch**; NEW creation path. Never a parallel "DispatchRecord". |
| Operational vs financial closeout split | One conflated "Close & bill" action | **EXTEND** the closeout tx: keep meters/hours atomic, create a draft Revenue Review instead of a final invoice. Requires a superseding ADR for do-not-break rule 5 (ADR-011). |
| Revenue Review workflow & statuses | Nothing; `InvoiceStatus` has 6 values, none review/payment-lifecycle | **NEW** RevenueReview model + status machine; `MaintenanceOrder` approval precedent. |
| Invoice | Exists, heavily consumed (§4.1) | **EXTEND** additively per [13 §4.2.2](./13-database-model.md): `payerId`, `billToLabel`, `currency`, snapshot totals (`subtotal`/`taxTotal`/`total`), `approvedAt` (the lock marker — no `approvedBy`/`lockedAt`; approver identity lives on the Revenue Review and the audit trail, 13 §3 R14), `updatedAt`, new enum values (each in its own migration). The Revenue Review link is a back-relation (FK on `RevenueReview.invoiceId`); **no dispatch FK on Invoice** — dispatch linkage flows through the Revenue Review. Never reinterpret existing rows. |
| InvoiceLine | Exists | **EXTEND**: tax fields, provenance/rate-snapshot metadata, actor/reason. Keep the name `InvoiceLine`. |
| Payment (manual records) | Exists; Cascade delete, no status | **EXTEND/harden**: survival semantics, actor, currency; **NEW** PaymentIntent-referencing PaymentAttempt/PaymentTransaction models alongside legacy rows. |
| Refund / Dispute | Nothing | **NEW**. |
| Aircraft Pricing Profile + rate resolution | Two flat columns; live-rate reads | **NEW** profile model (effective-dated, versioned); **REPLACE** `computeFlightCharges` internals with profile resolution while preserving the pure-engine contract and `flightTimeFromHobbs` validation. |
| Instructor Rate Profile (billing) | Single flat `Instructor.hourlyRate` | **NEW** effective-dated model; keep the column as the migration source/fallback. |
| Instructor Compensation | Does not exist | **NEW** rate + earning models (append-only idiom). |
| Instructor time entry | Hardcoded `flightTime + 0.5h` | **NEW** InstructorTimeEntry with categories + submit/approve lifecycle. |
| Revenue Item catalog | Closed `LineItemKind` enum | **NEW** org-scoped catalog; enum retained for legacy rows. |
| Taxes (TaxSnapshot) | Zero tax anything | **NEW**. |
| Discounts / credits / adjustments | `DISCOUNT` kind only, never created | **NEW** adjustment records (actor/reason/before-after/approval). |
| Responsible payer model | `Invoice.studentId` only; `Student.accountBalance` running balance | **NEW** payer + student-payer models; **REPLACE** balance-as-truth with derived Amount Due (keep the column maintained during transition — two live writers + seed + UI depend on it). |
| Payment provider (Stripe), saved methods, webhooks | **None** (§10) | **NEW**, per PRODUCTION.md §13.2 / ADR-018 contract (adapter behind env flags, test mode only, inbound event table with unique provider event id). Part 2 scope. |
| Payment timing policies | Payment is whenever a human records it | **NEW** org config + snapshot-on-approval; note: no queue/cron runtime exists for batches. |
| Checkout restrictions (financial) | Airworthiness block only; $500 ops warning | **NEW** configurable financial-restriction evaluator beside (never inside) the safety gate. |
| Revenue Allocation / platform fee / LedgerEntry | Nothing; "ledger" = signed `accountBalance` | **NEW** append-only records (`InventoryMovement` idiom). Keep tenant billing distinct from AeroOps subscription billing (ARCHITECTURE.md §13). |
| Financial Export / accounting mapping | Generic CSV report export only | **NEW** job models (ImportJob manifest pattern; exceljs already a dependency). |
| Revenue Dashboard / Revenue Report surfaces | Billing pages + reports that recompute from current rates | **EXTEND** pages; **REPLACE** the math source with snapshotted records. |
| Invoice numbering | `Date.now()`-derived, collision-prone | **REPLACE** generator with a per-org sequence (Financial Reviewer recommendation, ROADMAP.md:472); existing numbers untouched. |
| Currency | None; USD hardcoded | **NEW** explicit ISO 4217 currency column on financial models (recommendation `Decimal(12,2)` + currency; binding call in [13-database-model.md](./13-database-model.md)). |
| Overdue automation | Never transitioned by code | **NEW** derived-or-job decision (owned by the database-model and lifecycle docs). |
| Reporting indexes | `Payment.paidAt`, `Dispatch(status, closedAt)` unindexed | **EXTEND** additively with org-leading indexes. |

---

## 10. Confirmation: no Stripe integration or payment provider exists today

Verified directly against the working tree (2026-07-10):

- `package.json` has **no** `stripe` dependency (grep: no match); dependency list is Next/Prisma/NextAuth/zod/exceljs/fullcalendar/recharts et al.
- Zero Stripe SDK/API code anywhere in `src/`. Every "stripe" hit is inert: UI copy (`payment-form.tsx:40` "In production this connects to Stripe"; `billing/page.tsx:52` "Stripe & QuickBooks sync-ready"; `settings/page.tsx:225` "Planned" badge), the `BillingMode` enum `MANUAL | STRIPE` (`schema.prisma:205-208` — governs how the **org pays AeroOps**, default `MANUAL`, platform routes only), and Import Center CSV presets (`src/lib/import/spec.ts`).
- No `src/lib/stripe.ts`, no `/api/webhooks/stripe` route, no `BillingEvent`/inbound-event table, no `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` handling in `src/lib/env.ts`.
- No stored provider identifiers: no Stripe customer ids, no payment-method references, no PaymentIntent records. `Payment.reference` is free text; seeded `pi_*` values are fabricated fixtures (`prisma/seed.ts:412`).
- Consequently: **no card or bank data has ever touched AeroOps** (SAQ-A posture is preserved by absence), and all Phase 8 payment-provider work is greenfield governed in advance by PRODUCTION.md §13.2 and ADR-018 (test mode only, adapter behind env flags, hosted surfaces, unique-insert webhook idempotency).

---

## 11. Part L database-rules compliance snapshot & migration safety

### 11.1 Rules vs. current schema

| Part L rule | Current status |
|---|---|
| All org-owned records tenant-scoped | Mostly — machine-enforced for models with `organizationId` (ADR-021); **`Dispatch` is relation-scoped only** and needs a direct org FK + backfill. |
| Currency explicit | **Fails** — no currency column exists; implicitly USD. |
| Money in integer minor units or safe decimal | House standard is **Prisma Decimal, never float** (do-not-break; NORTH_STAR item 4) — the spec's integer-minor-units option is rejected in favor of Decimal + explicit currency; existing columns are `Decimal(10,2)`/`(8,2)`. New-model precision recommendation `Decimal(12,2)`; binding call in [13-database-model.md](./13-database-model.md). Read-time arithmetic is currently `Number()` floats — a code-level gap for Part 2. |
| Rates effective-dated or versioned | **Fails** — flat live columns only. |
| Approved snapshots immutable | **Fails** — no snapshot columns exist; totals derived at read. Note the governance tension: DATABASE_STANDARDS.md:24-26 forbids stored computed values; the design-set ADR must carve out approved snapshots as point-in-time financial facts, not caches. |
| Corrections via adjustment records | **Fails** — no adjustment models; invoices are edited in place by import/simulation. |
| Stripe event IDs unique / idempotent webhooks | N/A today (no inbound surface); the mandated pattern is unique-insert on the provider event id (PRODUCTION.md §13.2, API_STANDARDS.md:190-194). |
| No raw card/bank data | **Passes** (by absence); `tests/token-security.test.ts` guards new secret-like columns. |
| All financial actions auditable | Passes at the mutation level (`recordAudit` on all three financial actions); row-level actor columns absent by convention. |
| Appropriate timestamps | Partial — `Invoice.issuedAt` is the documented createdAt substitute, but Invoice lacks `updatedAt` and **Dispatch has no timestamps at all**. |
| Foreign keys | Passes where relations exist; notable bare-string actors (`releasedBy`, `AuditLog.actorUserId`) follow a documented convention; **missing FK: Dispatch↔Invoice**. |
| Tenant-aware unique constraints | Passes (`[organizationId, number]`, `[organizationId, tailNumber]`…). |
| Indexes for review queues / payment statuses / org-date reporting / reconciliation | **Fails** — `Payment.paidAt` and `Dispatch(status, closedAt)` unindexed; `Dispatch` has only `@@index([status])`. |

### 11.2 Migration-safety facts (binding on the migration plan)

Live data that must never be silently reinterpreted (spec Part L; ADR-015 additive-only):

- Seeded/imported invoice numbers (`INV-1041+`, `INV-SIM-*`, timestamp-derived) — keep valid as-is; a new per-org sequence applies to new invoices only.
- `Payment.reference` fake `pi_*` fixtures — never treat as real provider references.
- `Student.accountBalance` sign convention (**negative = owes**) — two live writers, dashboard/ops/import consumers; transition to derived Amount Due must keep the column maintained until a two-release deprecation.
- Seeded `OVERDUE`/`PAID` statuses and the unused `DRAFT` value — enum values are never dropped; new `InvoiceStatus`/review statuses each need their own DDL migration before any code or backfill uses them, with backfills separate, deterministic, and idempotent (ambiguity surfaces via a report script, never guessed).
- `Dispatch.organizationId` backfill source: `ScheduleEvent.organizationId` via the 1:1 relation.
- Every new tenant-owned financial model must be added to `org-snapshot.ts` capture/`TableKey`/wipe-order/restore lists in the same slice, or founder snapshot/restore silently loses financial data.

### 11.3 Validation-fixture inventory (Part L matrix)

| Required fixture class | Exists in seed today? |
|---|---|
| Fresh database | Yes (`prisma migrate reset`). |
| Seeded database | Yes — `prisma/seed.ts` (554 lines), TRUNCATE CASCADE, demo logins `demo1234` (do-not-break rule 4). |
| Existing invoice fixtures | Yes — INV-1041+ ~65% PAID with payments; one standing OVERDUE membership invoice with `MEMBERSHIP_FEE` + `LATE_FEE` lines. |
| Multi-organization fixtures | Yes — demo org + Blue Ridge Flying Club (own aircraft N67235, own $60/hr CFI). |
| Failed-payment fixtures | **Missing** — no failed/pending payment state exists to seed. Part 2 must add them with the payment state machine. |
| Historical-rate fixtures | **Missing** — no rate versioning exists to seed. Part 2 must add effective-dated rate history across both orgs. |

---

## 12. Interactions with other Revenue Engine components

This audit is the shared ground truth for the design set (index: [README.md](./README.md)). Specific hand-offs:

- **Database model ([13-database-model.md](./13-database-model.md))** — owns the binding calls this audit only recommends: money precision (`Decimal(12,2)` + ISO 4217 currency column), `Payment` delete-semantics hardening, `Dispatch.organizationId` + backfill, Dispatch↔RevenueReview↔Invoice linkage and the duplicate-billing unique constraint, snapshot-column carve-out, per-org invoice sequence, and the full index plan from §11.1.
- **Architecture / ADR docs** — inherit the ADR-011 supersession requirement (§9 row 2), the two-money-systems boundary (§3), the "check-in" terminology collision (§7), and the computed-vs-stored carve-out (§11.1).
- **Operational checkout & Revenue Review lifecycle docs** — build on the exact transaction boundaries in §2.2 (what stays inside the operational tx, what moves to the draft Revenue Review) and the status-machine facts in §2.4.
- **Aircraft Pricing Profile / Instructor Rate Profile / Instructor Compensation docs** — start from the rate-source inventory in §2.5 and the structural blocker that `Instructor` is per-User, not per-org.
- **Revenue Item, tax, adjustment, responsible-payer, checkout-restriction, payment-timing docs** — each has its "current state: nothing / nearest precedent" row in §4.9 and §9.
- **Migration plan** — bound by §11.2 and the fixture matrix in §11.3.

---

## 13. Out of scope for Part 1 / deferred to Parts 2–3

Phase 8 Part 1 is design only. This audit changed nothing. Deferred to Parts 2–3 (implementation):

- All schema migrations, backfills, and seed extensions (including failed-payment and historical-rate fixtures).
- Stripe SDK integration, `src/lib/stripe.ts`, the `/api/webhooks/stripe` PUBLIC route + inbound event table, saved Payment Methods, Payment Attempts (test mode only, behind env flags).
- Fixing read-time float arithmetic, the invoice-number generator, tach validation, meter-regression protection, and the missing reporting indexes.
- The Dispatch-creation API/UI (no code path creates Dispatch rows today).
- Batch/scheduled payment execution (no queue/cron runtime exists), email receipts (no email provider), payer-facing surfaces (new session-boundary decision), OVERDUE automation.
- CLAUDE.md do-not-break rule 5 wording update and the superseding ADR — written with, and gating, the Part 2 implementation.

---

## 14. Open questions

1. **`Student.accountBalance` retirement pace** — how long must the column stay dual-written after Amount Due becomes derived (import specs, dashboards, and ops warnings consume it)? Product-owner call on the deprecation window.
2. **No-student dispatches** — flights without a `studentId` are currently metered but never billed. Should the Revenue Engine generate Revenue Reviews for renter/staff/maintenance flights, and who is the payer? (Business decision; affects Revenue Review generation rules.)
3. **Legacy invoice presentation** — pre-Phase-8 invoices have no snapshot, no review, and no dispatch link. Do they render read-only in the new Revenue Dashboard, or stay on the legacy billing surface until aged out?
4. **`DISPATCHER` billing visibility** — Phase 8 touches the recorded wart (record_payments without billing.view). Fix in the new permission bundles, or preserve the current bundle for existing orgs?

---

*Audit verified against the working tree on 2026-07-10: `prisma/schema.prisma` (1,635 lines), `src/lib/billing.ts`, `src/app/api/dispatch/[id]/{release,close}/route.ts`, `src/app/api/invoices/[id]/payments/route.ts`, `src/app/(app)/billing/*`, `package.json`, plus the four Phase 8 audit-agent reports (schema, billing code, governance, platform seams).*
