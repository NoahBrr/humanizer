# ADR Proposals

> **Status:** Proposed — Phase 8 Part 1 · **Date:** 2026-07-10 · **Lead roles:** Principal Software Architect at Stripe; Financial Systems Architect; Database Architect · **Part of:** Revenue Engine design set ([README](./README.md))

This is deliverable 15 of Phase 8 Part 1: the Architecture Decision Records the Revenue Engine design set requires. **Every ADR below is PROPOSED** — status "Proposed — Phase 8 Part 1". Upon approval they are merged into [docs/architecture/DECISIONS.md](../DECISIONS.md) **verbatim** (same format, same numbers), with statuses flipped to Accepted. They intentionally do **not** touch DECISIONS.md yet: Part 1 is design only, and DECISIONS.md records decided patterns, not pending ones.

Numbering continues the existing sequence — the highest accepted ADR is ADR-024, so this set proposes **ADR-025 through ADR-036**. The format is DECISIONS.md's exactly: Decision · Date · Context · Alternatives considered · Why selected · Risks · Reconsider when.

**Obligations that travel with the merge:**

- **ADR-011** gains a "partially superseded (→ ADR-025)" annotation: its invoice clause is superseded, its atomicity core stands. The matching CLAUDE.md do-not-break rule 5 rewording ships in the same PR as the Part 2 implementation that changes the behavior — never before, never silently.
- [ARCHITECTURE.md](../ARCHITECTURE.md) is updated in the same PR (per the DECISIONS.md footer rule).
- Sibling docs in this set sometimes cite "ADR-025" loosely as "the Revenue Engine ADR" (docs 08 and 12 do so for the snapshot carve-out). Binding assignment: the closeout supersession is **ADR-025**; the snapshot carve-out is **ADR-028**; the consistency pass aligns the loose citations.

## Index

| ADR | Title | Decides | Primary sources |
|---|---|---|---|
| [ADR-025](#adr-025) | Operational/financial closeout separation | Closeout tx creates a Draft Revenue Review, not an `OPEN` Invoice; no provider calls in any DB transaction | [00](./00-current-billing-audit.md) §2.2/§9, [02](./02-operational-dispatch-and-closeout.md), [03](./03-revenue-review-lifecycle.md) §1 |
| [ADR-026](#adr-026) | Revenue Review as a layer over Invoice | 1:1 workflow wrapper; Invoice/InvoiceLine stay the accounting record; status projection; no `RevenueReviewLine` model | [03](./03-revenue-review-lifecycle.md), [13](./13-database-model.md) §3 R1 |
| [ADR-027](#adr-027) | Money representation | `Decimal(12,2)` + explicit ISO 4217 currency; integer minor units rejected | [13](./13-database-model.md) §2 |
| [ADR-028](#adr-028) | Immutable approved snapshots | Point-in-time-fact carve-out from the derive-at-read rule; corrections only via adjustment records | [03](./03-revenue-review-lifecycle.md) §2.6, [08](./08-adjustments-discounts-credits.md), [13](./13-database-model.md) §6 |
| [ADR-029](#adr-029) | Effective-dated versioned rate profiles | Aircraft Pricing Profile + Instructor Rate Profile idiom; billing vs Instructor Compensation structurally separate | [04](./04-instructor-time-and-rates.md), [05](./05-aircraft-pricing-profiles.md) |
| [ADR-030](#adr-030) | Deterministic rate resolution | L1–L6 order, explicit priority, ambiguity warns + blocks approval, never blocks closeout | [05](./05-aircraft-pricing-profiles.md) §3, [04](./04-instructor-time-and-rates.md) |
| [ADR-031](#adr-031) | Responsible payer model | Org-scoped payer records over one global `User`; new `authorizePayer()` self-service boundary | [11](./11-responsible-payers.md) |
| [ADR-032](#adr-032) | Provider-agnostic payment abstraction | Adapter behind `REVENUE_CHARGING`; Stripe test mode only; Connect finalized in Part 2 | [09](./09-payment-timing-and-collection.md), [00](./00-current-billing-audit.md) §10 |
| [ADR-033](#adr-033) | End-to-end idempotency | Structural uniqueness on every hop; guarded claims; deterministic idempotency keys; unique provider event IDs | [09](./09-payment-timing-and-collection.md), [13](./13-database-model.md) §7 |
| [ADR-034](#adr-034) | Allocation, ledger, and platform fee spine | Balanced Revenue Allocation sets; append-only double-entry LedgerEntry; fee accrued at approval, earned at collection | [12](./12-revenue-allocation-and-reporting.md) |
| [ADR-035](#adr-035) | Derived Amount Due | No stored running balances; `Student.accountBalance` demoted on the two-release schedule | [09](./09-payment-timing-and-collection.md) §2.8, [00](./00-current-billing-audit.md) §4.6 |
| [ADR-036](#adr-036) | Checkout restrictions | One release gate; pinned SAFETY floor; configurable FINANCIAL tiers; never gates return/closeout | [10](./10-checkout-restrictions.md) |

---

<a id="adr-025"></a>
## ADR-025 — Operational and financial closeout are separate states; the closeout transaction creates a Draft Revenue Review

**Date:** 2026-07 (Phase 8 Part 1) · **Status:** Proposed · **Supersedes** ADR-011's invoice clause (ADR-011's atomicity core stands) · **Extends** ADR-009

- **Context:** Today "Close & bill flight" is one conflated action: the ADR-011
  closeout transaction rolls aircraft meters, increments student hours,
  decrements `Student.accountBalance`, and creates a **final `OPEN` Invoice
  from live rates** ([00-current-billing-audit.md](./00-current-billing-audit.md) §2.2).
  The spec requires two states: **operational closeout** (immediate at aircraft
  return — meters, maintenance counters, squawks, lesson records) and
  **financial closeout** (only after Revenue Review approval and payment).
  Operational closeout must never wait on a card or ACH response, and no
  provider API call may run inside the return-closeout database transaction.
- **Alternatives:** (a) Keep creating the final `OPEN` invoice and bolt a
  review workflow on top of it — rejected: the invoice would become a
  financial fact *before* anyone reviewed it, approval would be retroactive
  theater, and principle 2 (explicit financial consequence) would be
  unsatisfiable. (b) Create the Revenue Review **outside** the closeout
  transaction, post-commit via the event bus — rejected: a crash between
  commit and review creation leaves a closed flight with no financial intake
  record, a gap state with no owner; ADR-009 records that in-process bus
  delivery is lost on crash and is unacceptable for billing-critical work.
  (c) Saga/compensation pattern across two transactions — needless
  distributed-systems machinery for writes that live in one database.
  (d) Block operational closeout on payment readiness — rejected outright:
  violates principles 1 and 3; the aircraft is physically back.
- **Why:** The invariant do-not-break rule 5 actually protects is: *a flight
  that closes out updates its operational records and produces exactly one
  financial intake record, atomically — or fails whole.* This ADR keeps that
  invariant and changes only what the intake record **is**: a Draft
  `RevenueReview` wrapping a `DRAFT` Invoice (with system-suggested
  `InvoiceLine` rows), instead of an `OPEN` Invoice. The guarded
  `RELEASED→CLOSED` `updateMany` claim, meter updates, and student-hours
  updates are untouched; the `accountBalance` decrement moves to financial
  closeout (ADR-035). Pricing resolution runs **pure and in-memory** over
  rows loaded before the transaction — no I/O added to the tx — and a
  pricing ambiguity never blocks closeout (resolution always yields a
  priced line — `LEGACY_FALLBACK` for zero-config orgs, `AMBIGUOUS_RATE`
  priced by deterministic tiebreak and blocked at approval,
  [02-operational-dispatch-and-closeout.md](./02-operational-dispatch-and-closeout.md)).
  ADR-011's own reconsider-when clause pre-authorized the direction: slow
  external calls go post-commit onto the event bus, never into the
  transaction. All provider calls (Payment Attempts, webhooks) are
  post-commit by construction (doc 09).
- **Risks:** Transaction breadth grows with the review + draft-invoice
  writes — bounded because they are fast DB-only inserts and the resolver
  does no I/O. Legacy consumers that assume closeout yields an `OPEN`
  invoice (billing pages, health-score, insights — inventory in doc 00
  §4.1) must tolerate `DRAFT`; the `Invoice.status` projection (ADR-026)
  and Part 2 verification against that consumer list cover it. Dispatches
  without a `studentId` are metered but produce no billing today — whether
  they generate Revenue Reviews is an open product question (doc 00 §14),
  not resolved by this ADR.
- **Reconsider when:** review creation ever needs external I/O (it must move
  post-commit — with a durable queue and an explicit answer to the gap
  state, never by putting network calls in the transaction), or split-payer
  billing requires one closeout to open multiple financial intake records.

<a id="adr-026"></a>
## ADR-026 — Revenue Review is a customer-facing workflow layer wrapping the backend Invoice; Invoice/InvoiceLine remain the accounting records

**Date:** 2026-07 (Phase 8 Part 1) · **Status:** Proposed · **Extends** ADR-021

- **Context:** The spec mandates customer-facing "Revenue Review" vocabulary
  while explicitly forbidding renaming database concepts for marketing
  language. `Invoice`, `InvoiceLine`, and `Payment` are consumed by a dozen+
  live surfaces (billing pages, executive dashboard, health-score, insights,
  Mission Control, search, AI ask, Import Center, org-snapshot, simulation,
  seed — doc 00 §4.1). The review needs a 16-state workflow machine,
  approvals, risk flags, payer routing, and an operational snapshot that do
  not belong on an accounting document.
- **Alternatives:** (a) Rename `Invoice` → `RevenueReview` — banned by the
  spec and would break every consumer plus the Import Center's
  QuickBooks/Stripe CSV vocabulary. (b) A fully separate review document
  with its own line table, copied onto `InvoiceLine` at approval — rejected
  (binding resolution R1, [13-database-model.md](./13-database-model.md) §3):
  a copy step at approval, doubled code paths for every line feature, empty
  draft invoices in every legacy billing surface, and permanent drift risk
  between two line tables. (c) No new model — add status/approval columns to
  `Invoice` — rejected: the workflow machinery would bloat the accounting
  record, force reinterpretation of legacy rows (spec Part L forbids), and
  couple FK lifecycles that must differ (a review survives dispatch deletion
  via `SetNull`; an Invoice under a review is delete-`Restrict`ed).
- **Why:** Reuse-and-extend over parallel abstractions (CLAUDE.md §3).
  `RevenueReview` is a thin org-scoped record 1:1 with exactly one backend
  Invoice (`invoiceId @unique`, `Restrict`); review lines **are** the
  `InvoiceLine` rows of the wrapped `DRAFT` Invoice. `Invoice.status`
  becomes a coarse **projection** of `RevenueReviewStatus`, written in the
  same transaction as every review transition, so all legacy readers keep
  working; invoices without a review (all pre-Phase-8 rows, manual/import
  invoices) behave exactly as today — `null` `currency`/`payerId`/review
  linkage marks them, nothing is reinterpreted. The terminology split is
  clean: UI says Revenue Review / aircraft return; the backend keeps
  Invoice, InvoiceLine, PaymentIntent, PaymentTransaction, Refund,
  TaxSnapshot, LedgerEntry, Dispute.
- **Risks:** 1:1 join discipline — review screens need invoice money and
  invoice screens need review state (mitigated: frozen totals live on
  `Invoice`, `totalAtApproval` on the review; both are write-once at
  approval). Projection drift if any transition forgets the invoice write —
  mitigated by a single review engine owning both writes in one
  `db.$transaction`, plus a contract test asserting the projection mapping
  (doc 03 §2.2). Two vocabularies demand editorial discipline — the README's
  canonical-vocabulary table is the source; the consistency reviewer
  enforces it.
- **Reconsider when:** one review must wrap multiple invoices (split payer
  responsibility — a recorded Part H deferral), or an external accounting
  API needs richer status than the coarse projection carries (extend the
  projection additively; never move workflow state onto `Invoice`).

<a id="adr-027"></a>
## ADR-027 — Money is Prisma `Decimal(12,2)` with an explicit ISO 4217 currency column, not integer minor units

**Date:** 2026-07 (Phase 8 Part 1) · **Status:** Proposed · **Extends** ADR-015

- **Context:** Spec Part L allows "integer minor units or a safe
  decimal-money representation" and requires explicit currency. The house
  standard is already "Money = `Decimal`, never float" (CLAUDE.md §5,
  DATABASE_STANDARDS); every existing monetary column is `Decimal`
  (`InvoiceLine.unitPrice (10,2)`, `Payment.amount (10,2)`, …); **no
  currency column exists anywhere in the schema today**. The binding
  field-class table lives in [13-database-model.md](./13-database-model.md) §2.
- **Alternatives:** (a) Integer minor units — genuinely attractive (no
  fractional-cent ambiguity; matches Stripe's wire format) but rejected: it
  puts **two money representations in one database** since existing columns
  are never re-typed, turning every join, import, export, and report into a
  conversion hazard (the off-by-100 bug class); it bakes one provider's wire
  format into the domain model (ISO 4217 exponents vary — JPY 0, KWD 3);
  and it forces exactly the monetary conversion spec Part L forbids without
  an explicit plan. (b) Postgres `money` type — locale-dependent, carries no
  currency dimension, poorly supported by Prisma. (c) `Decimal` without a
  currency column (the status quo) — fails Part L's "currency must be
  explicit". (d) Currency as a Postgres enum — rejected; currency catalogs
  grow, and enum extension requires migrations (`String @db.Char(3)`
  validated against a `src/lib` catalog instead).
- **Why:** Postgres `numeric` is exact — the float hazard integer-cents
  guards against does not exist at rest; staying `Decimal` means **zero
  conversion for existing rows**. Binding shape: all new monetary columns
  `Decimal @db.Decimal(12,2)`; existing columns untouched; adjustment
  fields that write back into an existing column match its precision;
  percentages `Decimal(5,2)`; tax rates `Decimal(7,4)`; platform fee percent
  integer basis points; `currency String @db.Char(3)` uppercase ISO 4217,
  required `@default("USD")` on new models, nullable-then-backfilled on
  `Invoice`/`Payment`; **one currency per document** — `InvoiceLine` carries
  no currency. Provider minor-unit conversion `(Decimal, currency) → minor
  units` happens in exactly one tested function at the Part 2 adapter
  boundary.
- **Risks:** JS float leakage in flight — today's read paths use `Number()`
  math; Part 2 must keep all financial arithmetic in `Prisma.Decimal` with
  one explicit rounding policy (half-up to cents), converting to `Number`
  only at the display boundary. `Decimal(12,2)` cannot hold sub-cent unit
  prices (not needed for any flight-school charge; a future need is a new
  field-class decision, not a silent widen). Part 1 enforces
  org-currency-only at the engine — the columns are multi-currency-ready
  but the engines are not.
- **Reconsider when:** multi-currency organizations land (engine work, not
  schema work), or an accounting/export integration genuinely requires
  minor-unit storage — convert at that boundary, never in the domain model.

<a id="adr-028"></a>
## ADR-028 — Approved financial snapshots are immutable point-in-time facts; corrections happen only through adjustment records

**Date:** 2026-07 (Phase 8 Part 1) · **Status:** Proposed · **Extends** ADR-010 · **Carve-out from** DATABASE_STANDARDS' derive-at-read rule

- **Context:** Spec principle 5: rates, taxes, discounts, fees, and
  allocations are snapshotted at approval; changing a rate tomorrow must not
  alter yesterday's invoice. Today the opposite happens — reports recompute
  "revenue" as `flightTime × current rate` (doc 00 §7.3). Meanwhile
  DATABASE_STANDARDS forbids stored computed values ("derived at read time,
  never stored") — a governance tension every reviewer gate will hit unless
  it is resolved in writing here.
- **Alternatives:** (a) Recompute historical totals at read from versioned
  inputs (rates *are* versioned per ADR-029, so yesterday's total is
  theoretically reconstructible) — rejected: correctness would depend on
  every input being perfectly versioned forever (tax rules, Revenue Items,
  discounts, payer routing, timing policy) **and** on resolver behavior
  never changing; any bug fix or rule change would silently rewrite
  history — the precise failure principle 5 exists to prevent — and
  reporting queries become computationally absurd. (b) DB triggers rejecting
  post-approval `UPDATE`s — rejected (also in doc 12): raw-SQL triggers in a
  Prisma-managed schema are invisible to the schema file, outside house
  style, and would fight org-snapshot restore, which legitimately
  re-inserts rows. (c) Audited edit-in-place of approved records — rejected:
  the audit trail records *who changed history*; immutability guarantees
  *history did not change*. Financial defensibility requires the latter.
  (d) Event-sourcing the financial domain — a wholesale architecture
  departure buying no additional guarantee over append-only snapshots.
- **Why:** Approval executes one `db.$transaction` that freezes a **hybrid
  snapshot** ([13-database-model.md](./13-database-model.md) §6): rows for
  everything queried or aggregated (`TaxSnapshot` + `TaxSnapshotItem`,
  `InstructorEarning`, Revenue Allocation APPROVAL set, `PlatformFee`
  accrual, `ScheduledCharge` policy snapshot, the approval LedgerEntry
  journal); one `approvalSnapshot` Json on the review for the full
  human-readable breakdown; frozen columns (`Invoice.subtotal/taxTotal/
  total/approvedAt`, `RevenueReview.totalAtApproval`) for the numbers other
  systems key on. These are **facts, not caches** — written once, never
  recomputed — which is the explicit, documented carve-out from the
  derive-at-read rule (pre-approval, nothing is stored; totals derive from
  lines). All post-approval change flows through `RevenueAdjustment`
  (`PENDING_APPROVAL → APPROVED → APPLIED` via guarded claims) materializing
  **appended** records only: signed offset `InvoiceLine` rows, `Refund`,
  reversal `InstructorEarning`/Revenue Allocation rows, reversing ledger
  journals. Un-approve does not exist. Enforcement is application-layer in
  the engines; append-only tables expose no update/delete API; every
  Revenue Dashboard / Revenue Report / Financial Export reads snapshots,
  never live rates.
- **Risks:** Enforcement is code, not the database — a future route mutating
  an approved invoice's lines would corrupt silently; contract tests must
  assert no such code path exists (doc 03 §5) and the Financial review gate
  owns every new write path. Snapshots must be complete at approval — a
  field not snapshotted cannot be recovered later. Import Center,
  simulation, and org-snapshot restore write invoices outside the review
  engine; Part 2 must fence them off review-wrapped invoices.
- **Reconsider when:** a compliance regime requires database-level
  immutability — add DB-layer append-only enforcement as defense in depth
  then, without retiring the engine rule.

<a id="adr-029"></a>
## ADR-029 — Rates are effective-dated, versioned, approval-gated profiles; instructor billing and Instructor Compensation are structurally separate

**Date:** 2026-07 (Phase 8 Part 1) · **Status:** Proposed

- **Context:** Today each rate is one flat live column
  (`Aircraft.hourlyRateWet`, `Instructor.hourlyRate @default(65)`) read at
  closeout; no effective dating, no versioning, no approval, no compensation
  concept at all — the instructor's billing rate silently doubles as the
  implied compensation rate. Spec Parts D–E require versioned,
  effective-dated rates ("Do not overwrite historical rates") and principle
  6 requires that compensation is never inferred from the customer-facing
  charge unless an org explicitly configures that relationship.
- **Alternatives:** (a) Mutable rate rows + audit history — rejected:
  history in `AuditLog` is best-effort and unqueryable; "which version
  priced this flight" must have a structural answer. (b) Two parallel
  instructor models (`InstructorBillingRate` / `InstructorCompensationRate`)
  — rejected: duplicate versioning, approval, and resolution machinery —
  the parallel-abstraction anti-pattern (CLAUDE.md §3). (c) One profile row
  carrying both a billing and a compensation rate — rejected: couples
  versioning (a compensation change would re-version billing), couples RBAC
  (compensation visibility is far more restricted), and structurally invites
  the implicit inference principle 6 bans. (d) A stored `SUPERSEDED` status
  — rejected (R7): it is a computed value re-synced on every new version,
  exactly what DATABASE_STANDARDS forbids storing.
- **Why:** Two models, one idiom. `AircraftPricingProfile` (Aircraft Pricing
  Profile) and `InstructorRateProfile` + `InstructorRateProfileLine`
  (Instructor Rate Profile, one line per time category) both use
  `familyId + version`, the shared `ProfileStatus {DRAFT, APPROVED,
  ARCHIVED}`, and read-time-derived Scheduled/Active/Ended/Superseded
  display states. APPROVED rows are immutable — the only permitted
  mutations are a future-dated effective-end cap and archival; every change
  is a new DRAFT version, and approving v(n+1) end-dates v(n) in one
  `db.$transaction`, so approved windows in a family never overlap and
  every instant has exactly one answer. `InstructorRateProfile.kind =
  BILLING | COMPENSATION` keeps principle 6 structural: the resolver takes
  `kind` as a parameter and **no code path reads a BILLING rate to price an
  earning** (contract-tested — a billing-only org produces zero earnings
  plus a warning, never inferred compensation). The single sanctioned
  linkage is an explicit `percentOfBilling` line on a COMPENSATION profile,
  legal only when the org enables `allowCompensationLinkedToBilling`
  (default **off**), with the computed dollar figure snapshotted at
  approval. Legacy columns remain as resolution fallbacks (the virtual
  legacy aircraft profile; tier-8 `Instructor.hourlyRate`, BILLING only)
  until the two-release deprecation completes — zero-config orgs bill
  exactly as today.
- **Risks:** Version families accrete rows (acceptable — configuration-scale
  data). Two rate systems double the resolution surface — mitigated by one
  shared resolver core (doc 04 §resolution). Schools may conflate billing
  and compensation screens — the UX separates them and gates
  `revenue.compensation_*` keys independently. `Instructor.userId @unique`
  means the Instructor row is cross-org; per-org rate separation lives
  entirely in org-scoped profiles (recorded deferral, unchanged here).
- **Reconsider when:** per-membership Instructor profiles land (the ADR-023
  deferral), or instructor payouts ship (adds `PAID` to
  `InstructorEarningStatus` additively — reserved, not present).

<a id="adr-030"></a>
## ADR-030 — Rate resolution is deterministic with an explicit priority order; ambiguity warns and blocks approval — it never guesses silently and never blocks closeout

**Date:** 2026-07 (Phase 8 Part 1) · **Status:** Proposed · **Depends on** ADR-029

- **Context:** Spec Part D mandates a six-level resolution priority and is
  explicit: "If multiple profiles match at the same priority, do not guess
  silently." The repo's explainable-engine rule ("a number without a why is
  a bug") applies to every resolved rate. Principle 1 forbids blocking
  operational closeout on financial configuration.
- **Alternatives:** (a) Most-specific-wins scoring (weight each selector,
  highest score wins) — rejected: clever scoring is unexplainable to a
  school owner and flips surprisingly when a selector is added; explicit
  levels plus an integer priority is explainable in one sentence. (b) Hard
  failure on ambiguity at review generation — rejected: it would fail
  operational closeout for a financial-configuration error. (c) Resolve
  silently via the deterministic tiebreak with no warning — rejected
  verbatim by the spec. (d) Resolve at checkout and store the final rate on
  the `Dispatch` — rejected: draft reviews must re-derive when operational
  facts are corrected pre-approval; checkout's sanctioned input is the
  explicit L1 selection, and `effectiveAt` anchors to release regardless.
- **Why:** Aircraft resolution walks exactly **L1 → L6**: explicit dispatch
  selection → program (bound to `Syllabus`) → membership/customer-type →
  location → organization default → aircraft default — where L6 always
  yields at least a **virtual legacy profile** synthesized from
  `Aircraft.hourlyRateWet` (wet, Hobbs, tenth rounding — today's exact
  behavior), so resolution never comes up empty and zero-config orgs bill
  bit-for-bit as today with a `LEGACY_FALLBACK` notice. Instructor rates
  resolve through the parallel 8-tier resolver, run twice (BILLING,
  COMPENSATION). Selectors are conjunctive. Within a level: aircraft-
  specific beats fleet-wide, then lowest `priority` integer, then a
  deterministic total order (latest `effectiveStart`, earliest `createdAt`,
  lowest `id`) — and any tie surviving to the total order attaches an
  **`AMBIGUOUS_RATE` warning that blocks Revenue Review approval** until a
  reviewer makes an explicit audited selection (an L1) or fixes priorities
  and recalculates. This blocking behavior is deliberately not
  org-configurable in Part 1: an ambiguous rate never becomes an approved
  financial fact — but closeout always succeeds (`AMBIGUOUS_RATE`
  annotation, ADR-025). `effectiveAt = Dispatch.releasedAt`: the rate
  posted when the customer took the aircraft governs; a scheduled midnight
  change never reprices an aircraft already flying. Resolvers are pure
  functions in `src/lib/pricing.ts` over preloaded org-scoped candidates,
  returning a full `RateResolution` trace (ordered reasons plus every
  candidate and its outcome) that is snapshotted onto the review (ADR-028)
  — the spec's required audit trail of selection, satisfied structurally.
- **Risks:** The spec-mandated L5-above-L6 ordering (org default outranks
  aircraft default) is a foot-gun for mixed fleets — mitigated by
  creation-time UX warnings; flagged to the product owner (doc 05 open
  question 1) before Part 2; changing the order later requires a
  superseding ADR. Blocking `AMBIGUOUS_RATE` can stall approvals in a
  misconfigured org — deliberate, and the same overlap check runs at
  profile-approval time so admins hear about ambiguity when they create it.
  Draft reviews never silently re-resolve — rate changes surface as a
  notice with an explicit audited **Recalculate** action.
- **Reconsider when:** custom org-defined customer types or payer-negotiated
  contract pricing arrive — both add resolution inputs additively; existing
  level order never changes without a superseding ADR.

<a id="adr-031"></a>
## ADR-031 — Responsible payers are org-scoped records over one global `User` identity, gated by a new `authorizePayer()` self-service boundary

**Date:** 2026-07 (Phase 8 Part 1) · **Status:** Proposed · **Extends** ADR-021, ADR-023 · **Uses** ADR-020

- **Context:** Spec Part K: parents, guardians, employers, scholarship
  sponsors, universities, and clubs pay for students, need a personal
  AeroOps account, links to students at possibly several schools, invoice/
  receipt/Payment Method visibility — but must never see training records
  or enter the org app. Today `Invoice.studentId` is the only payer concept.
  Stripe Connect (Part 2) puts each org's customer objects on that org's
  connected account, so payer financial records must be tenant-scoped.
- **Alternatives:** (a) Payer as a `Membership` with a "payer" role —
  rejected: memberships confer org roles and org-app navigation; a parent
  is not staff, and carving a "sees nothing but billing" role out of the
  RBAC catalog fights the whole permission model. (b) One global cross-org
  payer table keyed by `User` — rejected: violates the ADR-021 org-FK rule,
  invites cross-tenant queries, and is structurally wrong under Connect
  (one provider customer per org per payer is mandatory). (c) Synthetic
  self-payer rows for every student — rejected: thousands of no-op rows
  where `payerId = NULL` already means "the student is their own customer";
  all existing invoices backfill `payerId = NULL` with unchanged meaning.
  (d) Separate per-org payer accounts (a parent signs up per school) —
  rejected: one human, one login — the exact multi-org split ADR-023
  already built for memberships.
- **Why:** Identity is global; authorization and money are tenant-scoped.
  A payer's login is one global `User` (email-unique, may hold no
  membership). `ResponsiblePayer` (7 payer types, `INVITED → ACTIVE →
  SUSPENDED/ARCHIVED`, invitation tokens stored sha256-only per ADR-020,
  billing-authorization consent) and `StudentPayerRelationship` (at most one
  ACTIVE default per student via a raw-SQL partial unique index; capability
  flags `canViewInvoices`/`canManagePaymentMethods`/`receivesNotifications`/
  `chargeApprovalRequired`; guardian-consent facts with an explicit
  no-legal-adjudication disclaimer) are org-scoped rows — a parent at two
  schools is two payer rows and two `PaymentCustomer`s on two connected
  accounts. Payers get **no** Membership and no org nav; `/api/payer/*`
  routes gate through a new **`authorizePayer()`** helper beside
  `authorize()` in `src/lib/session.ts` (single-gate rule preserved: one
  file, one session-resolution path), catalogued in `SELF_SERVICE_ROUTES`
  with written reasons and rate limiting. Payer queries start from the
  caller's own ACTIVE payer relationships — never from an `organizationId`
  — so a missing filter fails closed to nothing. Charge routing (explicit
  dispatch payer → student default → self-pay) is an explainable resolver
  whose basis is stored on the draft and frozen into the approval snapshot
  (ADR-028); post-approval payer transfer is an adjustment (doc 08). The
  privacy boundary is financial-only: post-approval reviews, receipts,
  payment status, own Payment Method references — never training records,
  drafts, schedules, or medical/TSA data.
- **Risks:** `authorizePayer()` is a genuinely new security boundary — the
  constitution authorization scan must recognize it, every payer route
  needs denial and cross-payer tests, and route cataloging is mandatory
  (this ADR is the governance record the audit requires for a new session
  boundary). Payer charge approval, when armed, makes the payer the human
  who triggers the charge ("Approve and charge my saved payment method —
  $X") — the flow must stay replay-safe via the guarded claim. Dormant
  INVITED rows need the archive path, and `ResponsiblePayer` is never
  hard-deleted (Restrict FKs from relationships and invoices).
- **Reconsider when:** per-program or per-charge-category payer routing
  lands (a future `PayerRoutingRule` table — no columns reserved now), or
  payer traffic justifies a distinct payer session kind rather than a
  helper over the existing session.

<a id="adr-032"></a>
## ADR-032 — Customer payments run through a provider-agnostic adapter behind an env flag; Stripe test mode only in this phase; the Connect model is finalized in Part 2

**Date:** 2026-07 (Phase 8 Part 1) · **Status:** Proposed · **Extends** ADR-017, ADR-018

- **Context:** No payment provider exists in the codebase — verified: no
  SDK, no webhook route, no provider references, no card/bank data ever
  stored (doc 00 §10). ADR-018 decided hosted-surface SAQ-A posture for the
  **platform subscription** money system; ARCHITECTURE.md §13 requires the
  two money systems (org pays AeroOps vs customer pays org) stay distinct.
  The spec's hard constraints: Stripe test mode only, nothing deployed, no
  live charges; the Stripe Connect model is explicitly finalized in Part 2.
- **Alternatives:** (a) Call the Stripe SDK directly from routes/engines —
  rejected: makes test/live discipline a code-review problem instead of an
  environment property, bakes Stripe types into domain logic, and breaks
  the adapter-behind-flag posture every other integration follows
  (ADR-017; `storage.ts` is the blueprint). (b) Merchant of record
  (Paddle/Lemon Squeezy) — rejected for the same reason ADR-018 rejected
  it: forecloses Connect-style customer-facing payments on per-org
  connected accounts. (c) Reuse the platform-subscription Stripe path and
  its planned `BillingEvent` table — rejected: conflating the two money
  systems in tables, webhooks, or status vocabulary is the exact failure
  §13 guards against; tenant payments get their own `PaymentProviderEvent`.
  (d) Stripe Elements embedded in-app — rejected: raises PCI scope beyond
  SAQ-A for zero launch benefit.
- **Why:** Part 2 implements one adapter interface — `createCustomer`,
  `createSetupSession` (hosted), `detachPaymentMethod`,
  `createCharge({ amount, currency, customerRef, methodRef, idempotencyKey,
  metadata })`, `parseWebhookEvent(signature, raw)` — behind
  **`REVENUE_CHARGING = off | test`** (default `off`: the adapter is
  absent, charge surfaces disable gracefully with an explicit message, and
  manual invoicing plus offline payment recording keep working; **a `live`
  value does not exist in this phase**). Card/bank capture happens only on
  provider-hosted surfaces; `PaymentCustomer` and `PaymentMethodReference`
  store opaque provider references plus a **closed safe-metadata allowlist**
  (brand, last4, expMonth/expYear, bankName, fingerprint) — never PAN, CVV,
  bank account/routing numbers, raw payment tokens, or provider secret keys
  (spec principle 8). Secrets live only in env (`STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`); partial configuration fails loudly at boot;
  the webhook route is inert without its secret. Connect account topology,
  application-fee splits, and payout money movement are deferred to Part 2's
  threat-modeled design — this ADR fixes only the interface and constraints
  Part 2 must satisfy.
- **Risks:** Provider-agnostic interfaces rot with a single implementation
  — mitigated by running the collection engine's contract tests against a
  fake adapter. ACH verification and Dispute ingestion have Stripe-specific
  shapes that will pressure the interface; extensions are additive. The
  Connect deferral means platform-fee money *movement* is designed
  (ADR-034) but not executable until Part 2 lands. Stripe business
  verification lead time remains a launch dependency (ADR-018 risk,
  unchanged).
- **Reconsider when:** the Part 2 Connect threat model is approved
  (finalizes account model and fee splits — the gate before any live-path
  implementation), or a second provider/regional requirement makes the
  interface earn its abstraction.

<a id="adr-033"></a>
## ADR-033 — Exactly-once money movement via structural uniqueness, guarded claims, and deterministic idempotency keys at every hop

**Date:** 2026-07 (Phase 8 Part 1) · **Status:** Proposed · **Extends** ADR-011 (the claim pattern), ADR-021

- **Context:** Spec Part L: charging the same dispatch twice must be
  impossible; provider event IDs must be unique; webhook processing must be
  idempotent. Today the only money-path guard is the dispatch-close guarded
  `updateMany` claim; there is no Dispatch↔Invoice link, no payment
  idempotency of any kind, and the invoice-number generator is
  `Date.now()`-derived and collision-prone.
- **Alternatives:** (a) Application-level existence checks ("query, then
  insert") — rejected: TOCTOU races under concurrency; every incident class
  here (double-submit, replayed webhook, two runners claiming one charge)
  is precisely the race a check-then-act cannot stop. (b) Advisory locks or
  serializable isolation as the primary mechanism — rejected: locks do not
  extend across the provider boundary, serializable retry loops complicate
  every write path, and unique constraints give the same guarantee
  declaratively (advisory locks stay sanctioned for niche serialization
  like ADR-024's last-founder guard). (c) Random UUID idempotency keys —
  rejected: a crash between key generation and persistence orphans the
  provider-side operation with no way to find it; deterministic keys are
  reconstructible from the attempt's identity, which is what makes
  reconcile-then-proceed possible. (d) Queue-based exactly-once — no queue
  exists, queue delivery is at-least-once anyway, and dedupe would land
  back on these same constraints.
- **Why:** The chain **Dispatch → RevenueReview → Invoice → ScheduledCharge
  → PaymentAttempt → Payment** is enforced at every hop by the database
  ([13-database-model.md](./13-database-model.md) §7): `ScheduleEvent` 1:1
  `Dispatch`; partial unique **one non-`VOIDED` Revenue Review per
  dispatch** (raw SQL — a voided review stays for history, regeneration
  stays possible, two live reviews never); `RevenueReview.invoiceId
  @unique`; `ScheduledCharge.revenueReviewId` and `.invoiceId` both
  `@unique` (one collection anchor per approval, even for manual-invoice
  policies); `PaymentAttempt @@unique([scheduledChargeId, attemptNumber])`
  plus a **deterministic `idempotencyKey @unique`** (`sc_<id>_a<n>`) sent
  verbatim as the provider Idempotency-Key, plus `@@unique([provider,
  providerPaymentIntentId])`; `Payment.paymentAttemptId @unique`; and
  `PaymentProviderEvent @@unique([provider, providerEventId])` —
  unique-insert **before** processing, so duplicate webhook delivery is a
  structural no-op. Every state transition that gates a side effect uses
  the ADR-011 guarded `updateMany` claim (`count === 0` → 409), so
  concurrent runners cannot double-execute; a stuck attempt resolves by
  **reconcile-then-proceed** against the provider using the stored key —
  never by creating a parallel attempt. Replay guards extend to
  adjustments: `Refund.adjustmentId @unique`, `@@unique([creditId,
  revenueReviewId])`, `@@unique([promoCodeId, revenueReviewId])`.
  Human-readable numbers (`RR-`/`ADJ-`/new `INV-`) come from the
  `OrgSequence` allocator (`UPDATE … RETURNING` inside the creating
  transaction), replacing the collision-prone generator **for new invoices
  only** — existing numbers stay valid.
- **Risks:** The two partial unique indexes are raw SQL invisible to the
  Prisma schema — `tests/schema-governance.test.ts` needs a documented
  allowlist entry (doc 13 open question 5). Deterministic keys must map 1:1
  to money identity: the attempt's amount is fixed by the write-once
  `ScheduledCharge` snapshot, so a re-pointed Payment Method reuses the
  same charge identity correctly, and any amount change is a new
  adjustment-driven pipeline, never a mutated charge. Migration sequencing
  matters — constraints must ship before their writers (14-migration-plan.md).
- **Reconsider when:** deployment leaves the single-Postgres assumption
  (multi-region active-active), or a durable queue lands — the constraints
  remain the backstop either way; they are the floor, not the scaffolding.

<a id="adr-034"></a>
## ADR-034 — Financial truth is a balanced Revenue Allocation + append-only double-entry LedgerEntry spine; the platform fee accrues at approval and is earned at collection

**Date:** 2026-07 (Phase 8 Part 1) · **Status:** Proposed · **Extends** ADR-010 (append-only idiom) · **Bounded by** ARCHITECTURE.md §13 (two money systems)

- **Context:** The spec's defining workflow ends with revenue allocated,
  AeroOps' platform fee earned, Instructor Compensation recorded, and
  records reconciled. Nothing of the kind exists: the "ledger" is a signed
  `Student.accountBalance` column, and reports recompute revenue from live
  rates. The one house precedent is `InventoryMovement` — signed,
  append-only, "every change, forever."
- **Alternatives:** (a) Single-dimension allocation — rejected: "what was
  the customer charged for" (aircraft, instructor service, fees, fuel, tax)
  and "where does the money go" (platform fee, tax, school retained) are
  different category sets with different behavior under partial collection;
  one dimension either loses the proceeds view or double-counts tax.
  (b) An org-configurable internal chart of accounts — rejected: a
  tenant-defined CoA makes the posting matrix untestable and the
  reconciliation invariants unstatable; org flexibility lives **only** in
  `AccountingMapping` at Financial Export time. (c) DB triggers enforcing
  journal balance — considered and rejected (doc 12): Postgres cannot
  express "this set balances" as a CHECK, and raw-SQL triggers in a
  Prisma-managed schema are outside house style. (d) Fee earned at approval
  — rejected: AeroOps must never earn on uncollected revenue. (e) Fee
  computed only at collection with no accrual — rejected: the school must
  see its net proceeds at approval, and reconciliation needs the accrual
  anchor. (f) Instructor Compensation as an allocation category — rejected:
  it would break the invariant that the PROCEEDS dimension sums to money
  actually received, and would imply compensation is carved from the
  customer's charge — the principle-6 violation in structural form.
- **Why:** Every financial event (`APPROVAL`, `ADJUSTMENT`, `REFUND`,
  `VOID`, `WRITE_OFF`) writes one **balanced Revenue Allocation set** in two
  dimensions — REVENUE and PROCEEDS — each summing to the event amount, so
  `Σ allocations = invoice net total` holds at all times; refunds and voids
  append **signed reversal sets**, never edits. Rounding residue from
  proportional splits lands in `SCHOOL_RETAINED_REVENUE` via
  largest-remainder — never in tax, never in the platform fee, never in the
  customer's charge. `LedgerEntry` is an append-only double-entry journal:
  `journalId` groups a balanced set (Σ debits = Σ credits, one currency),
  accounts come from a **fixed internal 16-value `LedgerAccount` enum**,
  and the sole writer is `src/lib/ledger.ts`, always inside the same
  `db.$transaction` as the state change it describes; corrections are
  reversing journals. `PlatformFee` **accrues at approval** (visible in the
  PROCEEDS split with its basis snapshotted) and is **earned only when
  payment collects** — "per paid review"; a voided review voids its fee.
  Fee pricing is platform-owned `PlatformFeePolicy` (per-org override →
  plan → global default; integer basis points; `COLLECTED_PRETAX` base;
  effective-dated versions), managed only via `authorizePlatform()` — it is
  AeroOps' pricing, never tenant data, keeping the §13 two-money-systems
  boundary explicit. Integrity is layered: posting-engine assertions
  in-transaction → contract tests per posting-matrix row → continuous
  verification of invariants R1–R6 feeding a `ReconciliationException`
  queue. All Revenue Dashboard / Revenue Report surfaces read snapshotted
  allocation/ledger records only — retiring the recompute-from-live-rates
  behavior that violates principle 5 today.
- **Risks:** Posting-matrix completeness — a financial event without a
  journal mapping under-posts silently; mitigated by the exhaustive matrix
  in doc 12 plus a contract test per event type and the R1–R6 sweep. The
  verification job has no scheduler until the queue lands — interim: a
  bounded platform-authorized tick plus an on-demand Revenue Dashboard
  trigger (nothing silently skipped). Ledger volume grows unboundedly by
  design; org-leading indexes carry it and archival is a deliberate later
  decision, never a delete.
- **Reconsider when:** Connect money movement goes live in Part 2 (payout
  matching and `ProviderPayout` reconciliation activate), or customers
  demand internal CoA customization beyond export mapping — resist; the
  export mapping is the seam.

<a id="adr-035"></a>
## ADR-035 — Amount Due is derived per invoice at read time; `Student.accountBalance` is demoted and retired on the two-release schedule

**Date:** 2026-07 (Phase 8 Part 1) · **Status:** Proposed · **Extends** ADR-015 · **Depends on** ADR-025, ADR-028

- **Context:** Spec principle 4: students do not normally carry an open
  running balance; an Amount Due exists only when payment fails, ACH is
  pending or returned, manual billing is selected, or the org explicitly
  permits deferral. Today `Student.accountBalance` is a signed column
  (negative = owes) with **two live writers** (closeout decrements,
  payments increment), no ledger to reconcile against, and consumers across
  the dashboard, ops warnings, billing UI, seed, and Import Center.
- **Alternatives:** (a) Keep the balance column as the source of truth and
  reconcile it against the new ledger — rejected: a hand-maintained signed
  column with multiple writers is the corruption class the ledger
  (ADR-034) exists to end, and two sources of truth will disagree the first
  time a writer is missed. (b) Drop the column now — rejected: violates the
  additive-only rule (ADR-015) and breaks live consumers plus the Import
  Center's documented sign convention. (c) A stored payer-level balance
  maintained by payment events — the same computed-value-cache problem one
  level up.
- **Why:** **`amountDue(invoice) = locked Invoice total − Σ settled
  Payments + Σ Refunds`**, computed at read, per invoice / per Revenue
  Review. Any student- or payer-level figure ("$412.50 across 2 invoices")
  is a read-time aggregation over that party's open invoices — a query,
  never a column. Derivation from the write-once approval snapshot
  (ADR-028) and append-only `Payment`/`Refund` rows is consistent by
  construction, and the charge-immediately default keeps it at zero in the
  normal case. This is DATABASE_STANDARDS' derive-at-read rule applied,
  not carved out. `Student.accountBalance` is **demoted, not dropped**: the
  closeout decrement moves out with ADR-025 (financial closeout), no new
  reader or writer is added, legacy flows keep it dual-written, and
  retirement follows the two-release deprecation sequenced in
  [14-migration-plan.md](./14-migration-plan.md). Student- and payer-facing
  copy says **Amount Due**, itemized by the reviews behind it — never
  "student account balance" (spec principle 4 wording rule).
- **Risks:** Read-time aggregation needs the new indexes (`Payment
  [organizationId, paidAt]`, `Invoice [payerId]`) to stay cheap at org
  scale. During the transition the legacy balance and derived Amount Due
  can differ (the balance includes pre-Phase-8 history; Amount Due starts
  from locked invoices) — no surface may show both figures. The financial
  checkout-restriction threshold (ADR-036) reads `accountBalance` as its
  interim source until derivation lands; the swap is an explicit Part 2
  task, not a drift.
- **Reconsider when:** measured read-time aggregation cost at large-org
  scale justifies a materialized rollup with explicit refresh semantics —
  never a return to a hand-maintained signed column.

<a id="adr-036"></a>
## ADR-036 — Checkout restrictions are one evaluator inside the existing release gate: a pinned safety floor, configurable financial tiers, and no reach into aircraft return

**Date:** 2026-07 (Phase 8 Part 1) · **Status:** Proposed · **Extends** ADR-005 (machine-enforced floors), ADR-006

- **Context:** Spec Part J: orgs configure dispatch restrictions across
  safety (aircraft grounded, maintenance overdue, open critical squawk,
  expired medical/certificate) and financial (Payment Method missing, prior
  payment failed, Amount Due over threshold, membership inactive) — with
  the absolute rule that financial restrictions never block emergency or
  safety actions. Today the only release restriction is the hard
  airworthiness gate in `POST /api/dispatch/[id]/release`; the ops page's
  "owes > $500" warning is the embryo of the financial tier.
- **Alternatives:** (a) A separate financial-clearance gate or route ahead
  of release — rejected: two gates create ordering bugs and a bypass
  surface; the release claim is the one choke point and must stay so.
  (b) Org-configurable tier assignment — rejected: an org could demote
  "aircraft grounded" to a warning; the safety floor is platform law, not
  tenant policy. (c) An async Operations-review queue for
  `REQUIRE_REVIEW` — rejected: a dispatcher at the counter cannot park a
  release in a queue; inline acknowledgment by an authorized human matches
  the workflow and still produces an immutable decision record. (d) Folding
  financial checks into `airworthinessOf()` — rejected by the whole design
  set: the safety gate stays non-overridable and financially blind, full
  stop.
- **Why:** One gate: the restriction evaluator slots into the existing
  release pipeline **after** `airworthinessOf()` (reused as the safety
  floor, never duplicated), and restrictions never gate aircraft return,
  operational closeout, squawk filing, or grounding — money can stop an
  aircraft from *going out*, never from *coming back* or being reported
  unsafe. The 15 spec restrictions live in a code-constant catalog (the
  `PERMISSIONS`-catalog idiom) in three tiers: **SAFETY** — pinned `BLOCK`,
  cleared only through safety-authority paths (maintenance sign-off, squawk
  deferral), no org row can exist for these keys; **OPERATIONAL** — `WARN`
  floor, org-escalatable to `BLOCK`; **FINANCIAL** — all five spec modes
  (`OFF | WARN | REQUIRE_REVIEW | BLOCK_OVERRIDABLE | BLOCK`) plus
  role-exemption lists. Defense in depth on the floor: the settings API
  rejects policy rows for SAFETY keys **and** the engine clamps any such
  row arriving via import or snapshot restore. `CheckoutRestrictionPolicy`
  stores deviations only (no rows = strong defaults; zero-setup orgs work);
  `DispatchRestrictionDecision` rows are immutable one-time decisions
  (`@@unique([dispatchId, key])`, actor id + label, required reason, and a
  snapshot of the enforcement in force — no update/delete API). Financial
  keys self-disable for maintenance/ferry dispatches, dispatches with no
  billable customer, and orgs without the billing module. The release claim
  hardens to the guarded `updateMany` `PENDING→RELEASED` pattern (ADR-033),
  with decision rows and the `Dispatch.restrictionSnapshot` written in the
  same `db.$transaction`.
- **Risks:** The pinned tier list encodes aviation/product judgment in
  code — recategorization requires a deliberate release (that friction is
  the point, but it slows genuine corrections). Applicability nuance must
  be exactly right: medical expiry is a pinned BLOCK for solo flight and
  assigned instructors but an OPERATIONAL WARN for dual students — an
  engine rule difference, never an override, and it needs the Aviation
  Standards review. The `AMOUNT_DUE_OVER_THRESHOLD` default (WARN at 500.00
  USD, parity with today's ops-page alert) reads `Student.accountBalance`
  until ADR-035's derivation lands.
- **Reconsider when:** attribute/relationship-based RBAC arrives (per-fleet
  or per-location restriction scoping — the ADR-006 reconsider trigger), or
  a regulator/insurer requires org-specific safety gating stricter than the
  platform floor — orgs may always add stricter, never weaker.

---

## Merge checklist (Part 2, upon approval)

1. Copy ADR-025…036 into [DECISIONS.md](../DECISIONS.md) verbatim; flip statuses to Accepted with the acceptance date.
2. Annotate ADR-011: "Partially superseded (→ ADR-025): the invoice clause. The atomic-transaction core and guarded-claim pattern stand and are extended by ADR-033."
3. Reword CLAUDE.md do-not-break rule 5 ("meters + hours + Draft Revenue Review in one tx") **in the same PR as the Part 2 code change**, per doc 00 §13.
4. Update [ARCHITECTURE.md](../ARCHITECTURE.md) (§13 money-systems note, §16 reference write path) in the same PR.
5. Align the sibling docs' loose "ADR-025" citations for the snapshot carve-out to ADR-028 (docs 08 §immutability, 12 §interactions), and doc references to this file's name (`15-adr-proposals.md`).

*Confirmations (spec deliverables 17–18): this document changes no code, schema, or migrations; nothing was deployed; no live payments were enabled.*
