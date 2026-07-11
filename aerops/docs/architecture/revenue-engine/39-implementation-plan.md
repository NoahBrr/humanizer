# Revenue Engine Implementation Plan

> **Status:** Proposed — Phase 8 Part 3 · **Date:** 2026-07-11 · **Lead roles:** Head of Software Engineering at Meta; Principal Software Architect at Stripe; QA/Test Engineer; Reliability/SRE Engineer · **Part of:** Revenue Engine design set ([README](./README.md))

This is the build playbook. Parts 1–2 (docs 00–35) decided *what* to build and *why*; docs 36–38 spec the permission matrix, screens, and reports. This document decides *the order it lands in* and *what "done" means at each commit*, for engineers who start implementation immediately after owner sign-off. It sequences the 43 models and 18+1 migrations that [14-migration-plan.md](./14-migration-plan.md) ordered, the engines [01-revenue-engine-architecture.md](./01-revenue-engine-architecture.md) §2 named, the routes and permission keys doc 36 catalogs, the screens doc 37 draws, and the tests [33-payment-test-plan.md](./33-payment-test-plan.md) §8 enumerated — into the **eight fixed phases** the owner committed to.

**Binding-doc precedence.** Where this plan and a Part 1/2 doc could be read to disagree on a shape, name, or status, the Part 1/2 doc wins and [13-database-model.md](./13-database-model.md) / [34-part2-database-additions.md](./34-part2-database-additions.md) win on any model/enum/status name. This plan owns **phase boundaries, dependency ordering, per-phase test gates, and rollback posture** — nothing else. It reinterprets no binding doc; where a build-order question is genuinely open it goes to §14, never to a silent choice.

**The eight phases are fixed (owner directive) and are not the same partition as doc 14's six migration groups.** Doc 14 orders migrations by FK topology; the build phases order *user-visible capability*. A migration lands in the earliest phase whose engine first **writes** its table, provided every FK target it references is already migrated in that or an earlier phase. Where one doc-14 migration is split across phases (a table is an FK target of an early writer but its own workflow lands later), the split is called out explicitly; doc 13/14 remain canonical for the shapes.

---

## 1. How to read this plan

Each phase section carries the same seven headings so the build can be driven straight down them:

1. **Scope — schema** (doc-13/34 models + doc-14 migrations landing here).
2. **Scope — engines** (`src/lib` files, using the names doc 01 §2 bound).
3. **Scope — routes** (API groups + the `authorize()` permission key each enforces, from doc 36).
4. **Scope — UI** (screens from doc 37 / doc 30).
5. **Dependency ordering within the phase** (what must merge before what).
6. **Test gate** (the named files from doc 33 §4 that must be green; "done" is defined against them).
7. **Risk hot-spots + rollback posture.**

Three rules hold across every phase and are not restated per-phase:

- **Every commit keeps `npm test` and `npm run build` green** (CLAUDE.md §8/§10). A phase is a sequence of deployable slices, never a long-lived branch. Schema, engine, routes, seed fixtures, `org-snapshot.ts` wipe-order updates, and the slice's contract tests land in the **same commit** (doc 14 §9).
- **No half-wired state survives a commit.** The constitution suite auto-fails a route without `authorize()` and a nav item without a `SECTION_PERMISSIONS` entry; schema-governance auto-fails an org model without an `Organization` FK / tenant-unique. These machine gates make a half-wired slice *unmergeable*, so "green tests" is a real proxy for "the app still runs."
- **Additive-and-dormant is safe** (doc 14 §1 rule 2, §2.3). A table may be migrated a phase or more before its writer lights up; a cutover is gated by *code* (an env flag or a release boundary), never by holding back DDL.

---

## 2. Provider abstraction plan (spans all phases; adapter activates in Phase 5)

The single most important structural decision for testability and for CLAUDE.md §9 graceful degradation: **no engine ever imports the Stripe SDK.** Charging flows through one interface, injected as a parameter, per ADR-032 (finalized by ADR-037, [18-stripe-connect-decision.md](./18-stripe-connect-decision.md) §9.2).

### 2.1 The interface — `src/lib/payment-provider.ts` (Phase 1)

The `PaymentProvider` TypeScript interface is authored in **Phase 1**, before any implementation exists, so every engine that will later call a provider is typed against it from birth. Signatures are ratified in doc 18 §9.2 (ADR-032 base + Part-2 additive extensions); every call except the two marked ⊙ executes in **connected-account context** (`accountRef` resolved server-side from the session org, never client-supplied):

| Method | Context | First real caller |
|---|---|---|
| `createCustomer` / `createSetupSession` / `detachPaymentMethod` | connected account | Phase 4 (method + consent foundation) |
| `createCharge({amount, currency, customerRef, methodRef, applicationFeeAmount, idempotencyKey, metadata})` | connected account | Phase 5 |
| `createRefund({paymentIntentRef, amount?, refundApplicationFee, idempotencyKey, metadata})` | connected account | Phase 6 |
| `createConnectedAccount` / `createAccountOnboardingLink` / `retrieveConnectedAccount` | platform → account | Phase 5 |
| `submitDisputeEvidence({disputeRef, evidence})` | connected account | Phase 6 (minimal) |
| ⊙ `refundApplicationFee({applicationFeeRef, amount, idempotencyKey})` | platform account | Phase 6 (lost-dispute fee reversal) |
| ⊙ `parseWebhookEvent(signature, raw, endpoint)` | n/a | Phase 5 |

`Decimal → integer-minor-units` conversion happens **only at this boundary** via the single ADR-027 converter (`toMinorUnits`), unit-tested exponent-aware even while USD-only (doc 33 §3.1). No engine handles minor units.

### 2.2 `FakePaymentProvider` — `tests/fixtures/fake-provider.ts` (Phase 1, grows per phase)

The deterministic in-memory fake (doc 33 §3.3) is the repo's first and only test double. It is **plain dependency injection against the interface — not `vi.mock`, not a Prisma mock, not a network stub** — preserving the repo's zero-mocking-framework posture. It ships in Phase 1 with the interface (initially exercising only `createSetupSession`/`createCharge` stubs), and each later phase adds the scripted outcomes its engines need (`succeed`, `declineSync`, `requiresAction`, `timeout`, `reject400KeyMismatch`; a full call journal; real HMAC in `parseWebhookEvent`). Because it is contract-tested against the `PaymentProvider` interface, it cannot drift from the real adapter.

### 2.3 `StripeProvider` — `src/lib/stripe.ts` (Phase 5 only)

The real adapter implementing `PaymentProvider` is authored in **Phase 5**, activated only when `REVENUE_CHARGING=test` **and** the Connect secrets are present; absent, `getPaymentProvider()` returns a null-adapter and every charging surface degrades to manual invoice + offline recording (ADR-017/032; CLAUDE.md §9). It is server-side and dynamic-imported (`(await import("stripe")).default`) exactly like `exceljs` in `src/lib/import/parse.ts` — no top-level import, no client bundle exposure.

**The `stripe` npm package is a new dependency added in Phase 5, with a superseding ADR note** (CLAUDE.md §2 "no new dependencies without a strong reason"): the strong reason is ADR-037's Connect execution, which cannot be met by an existing dependency. It is pinned, added in the Phase 5 opening commit alongside `src/lib/stripe.ts`, and used nowhere but that adapter. Until Phase 5, no `stripe` import exists anywhere in `src/` — a scan asserts this (doc 33 §5.4 idiom).

---

## 3. Environment-variable matrix (test-mode only; fail-closed)

Finalized in doc 17 §7 / doc 18 §9.1; the Revenue Engine reads **only** these and never System-1's `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` (doc 17 separation). Guards extend `src/lib/env.ts` `assertProductionEnv()` in the exact fail-closed idiom already there for `AUTH_SECRET` (throw at boot on misconfiguration; dev/test tolerant).

| Variable | Values (this phase) | Default | Guard (extends `assertProductionEnv`) | Added |
|---|---|---|---|---|
| `REVENUE_CHARGING` | `off \| test` | `off` | Master flag. **No `live` value exists in any phase.** `test` with any of the three secrets missing → throw. `off` with secrets absent → no throw (silent, degraded). | Phase 1 (flag read); enforced Phase 5 |
| `STRIPE_CONNECT_SECRET_KEY` | `rk_test_…` (restricted, preferred) / `sk_test_…` | unset | Boot asserts prefix ∈ {`rk_test_`, `sk_test_`}; a **live-prefixed** key (`rk_live_`/`sk_live_`) with `REVENUE_CHARGING=test` throws. | Phase 5 |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | `whsec_…` | unset | `/api/webhooks/stripe-connect` is inert (returns 200 no-op) without it; never processes an unverified event. | Phase 5 |
| `STRIPE_PLATFORM_WEBHOOK_SECRET` | `whsec_…` | unset | `/api/webhooks/stripe-platform` (application-fee events only) inert without it. | Phase 5 |
| `STRIPE_TEST_INTEGRATION` | `1` / unset | unset | Gates the opt-in integration suite only; suite `beforeAll` additionally asserts `sk_test_`/`rk_test_` and aborts hard on a live key (doc 33 §10.1). Never read by app code. | Phase 5 |

Two contract tests pin this (doc 33 §5.4): `src/lib/env.ts` throws when `REVENUE_CHARGING=test` and a secret is missing, and stays silent when `off`; and no file under `tests/` references `process.env.STRIPE*` (the unit suite structurally cannot depend on credentials, doc 24 I9). `.env.example` gains the four names with committed placeholder values that the guard rejects in production.

---

## 4. Phase 1 — Revenue Engine architecture and schema

**Goal:** every structural seam exists and is enforced, the Revenue Dashboard replaces the `/billing` landing page reading one engine, and the org can configure Revenue Engine policy — with zero money-moving code anywhere. After this phase the app looks meaningfully different (Revenue Dashboard, settings) but behaves identically on the money path.

**Scope — schema.** M1 (`InvoiceStatus` +3 values `PARTIALLY_REFUNDED`/`REFUNDED`/`DISPUTED`, DDL-only, unwritten); M2 (`OrgSequence`, `DispatchPolicy`, `RevenueWorkflowPolicy`, `OrgPaymentPolicy`, `RevenueSettings`, `CheckoutRestrictionPolicy`, `AccountingMapping` + their 18 config enums). All FK `Organization` only. `org-snapshot.ts` capture/wipe order extended for the seven config models in the same commit (doc 14 §7 P2 precondition).

**Scope — engines.** `src/lib/payment-provider.ts` (interface, §2.1); `src/lib/revenue-dashboard.ts` (the one read engine — pure period-boundary/urgency/footing functions + thin `db.groupBy/aggregate` wrappers, doc 30 §4/§7, zero new models); `src/lib/revenue-self.ts` (self-view engine skeleton, must never import `revenue-dashboard.ts` — doc 30 §6). No money engine yet.

**Scope — RBAC/nav wiring (the data-additive core, doc 01 §96, doc 30 §12).**
- `src/lib/permissions.ts`: add the full `revenue.*` key set to `PERMISSIONS` + `DEFAULT_ROLE_PERMISSIONS` bundles + `ROLE_TEMPLATES` (Operations Director, Chief Flight Instructor, Chief Pilot templates — **no new `Role` enum values**), per doc 36's matrix. Add keys as data now even though most routes light up later; doc 36 owns the exact bundle assignment.
- `src/lib/session.ts`: `MODULE_BY_PREFIX` gains `revenue → billing` (one line, so every `revenue.*` key module-gates); `authorizePayer()` added beside `authorize()`/`authorizePlatform()` as the catalogued self-service boundary for `/api/payer/*` (no payer route uses it until Phase 4, but the gate + its constitution-suite regex extension land now in one PR, doc 33 §5.1).
- `src/lib/rbac.ts` `SECTION_PERMISSIONS` + `src/lib/features.ts` `SECTION_MODULES`: no new nav hrefs yet (queue → Phase 3, my → Phase 4), so only the `/billing` label change; keeping section entries with their pages avoids dead nav.
- `src/lib/status-colors.ts`: add the 13 review/payment `STATUS_TONE` entries (doc 30 §13) — single-source, additive, existing meanings frozen.

**Scope — UI.** Revenue Dashboard at `/billing` (replaces the invoice-list landing; legacy list moves to `/billing/invoices` unchanged, doc 30 §3); nav **Billing → Revenue** label-only rename; `/executive` revenue figures re-pointed at `revenue-dashboard.ts` (killing the `flightTime × current-rate` defect, doc 00 §7.4). Settings editors for the config singletons (`DispatchPolicy`, `RevenueWorkflowPolicy`, `OrgPaymentPolicy`, `RevenueSettings`, `CheckoutRestrictionPolicy`) — doc 37 settings section. `error.tsx`/`loading.tsx` scaffolding introduced as the reusable pattern (doc 30 §13).

**Scope — routes.** `/api/organization/*` config-singleton settings routes: `authorize("revenue.payment_policy_manage" | "revenue.reconciliation_manage" | "revenue.items_manage" …, {mutating:true})` per doc 36. No `/api/revenue/*` money routes, no webhooks.

**Dependency ordering.** (1) permissions/module/status-tone/`authorizePayer` data wiring → (2) M1+M2 schema + config engines → (3) `revenue-dashboard.ts` + Dashboard/executive UI → (4) settings editors. Step 1 is pure data and unblocks everything; the dashboard can ship before settings.

**Test gate (done = all green).**
- `tests/constitution.test.ts` — extended in place: `authorizePayer` added to the gate regex; every new config route auto-walked for `authorize({mutating:true})`; `STATUS_TONE` still single-source.
- `tests/schema-governance.test.ts` — the seven M2 models auto-scanned for `Organization` FK + `createdAt` + tenant-unique; `OrgSequence [organizationId, key]` unique pinned.
- `tests/payment-security.test.ts` (**new file, seeded here**) — permission-matrix contracts over `permissions.ts` data: STUDENT bundle lacks `billing.view`/`reports.view`/`revenue.review_view`; the new keys sit in the intended bundles (doc 33 SEC idiom).
- New contract test for `revenue-dashboard.ts` pure functions (period edges in org tz, footing check) + the static scan that `revenue-self.ts` never imports `revenue-dashboard.ts` (doc 30 §6).
- `npm run seed` green with the config + sequence fixtures; `demo1234` logins unchanged.

**Risk hot-spots.** The **D3 namespace decision** (§14) must be resolved *before* this phase's `MODULE_BY_PREFIX`/permissions commit, so the prefix→module map is unambiguous and no key is renamed later. The `revenue-dashboard.ts` re-point of `/executive` must produce identical numbers to a hand-check on seeded data (the golden-fixture discipline) or it will look like a regression. **Rollback:** M1 is irreversible-but-benign (values unwritten); M2 is additive DDL → redeploying the previous app version is DB-safe and hides every new surface. No money touched → nothing to unwind.

---

## 5. Phase 2 — Aircraft return and calculation engine

**Goal:** dispatch captures Hobbs/Tach Out at release and Hobbs/Tach In at return, and the closeout computes charges from **Aircraft Pricing Profiles + Instructor Rate Profiles + Revenue Items + Tax** instead of `Aircraft.hourlyRateWet/Dry`. The operational closeout still finalizes an invoice as it does today (the ADR-025 flip to a Revenue Review is Phase 3) — so this phase is the calculator, wired but not yet re-routed.

**Scope — schema.** M3 (`ResponsiblePayer`, `StudentPayerRelationship` + `PayerType`/`PayerStatus`/`PayerRelationshipStatus`; the default-payer partial unique — tables land **dormant**, payer *workflow* is Phase 4, but M7 needs the `payerId` FK target); M4 (`AircraftPricingProfile`, `InstructorRateProfile`(+`Line`) + profile/rate enums); M5 (`RevenueItem`(+ location/program/aircraft scoping) + item enums); M6 (`TaxRule`); M7 (extend `Dispatch` with release/return capture columns + `DispatchRestrictionDecision`); M16 backfill (`Dispatch.organizationId`/`locationId`, after M7). M7's `updatedAt`/`createdAt` need the `--create-only` `DEFAULT CURRENT_TIMESTAMP` hand-edit (doc 14 §2.1).

**Scope — engines.** `pricing.ts` (L1–L6 resolver + trace, ADR-030); `instructor-rates.ts` (8-tier billing/compensation resolver); `revenue-items.ts` (catalog, scoping, manual-item controls); `tax.ts` (per-line taxability + stacked computation; `TaxCalculator` INTERNAL seam); `dispatch-validation.ts` (11 blocks / 9 warnings); `checkout-restrictions.ts`; `payers.ts` (resolution only: explicit → default → self-pay with basis — dormant tables, minimal reads); extend `billing.ts` to consume the resolver on the close path.

**Scope — routes.** `/api/dispatch` create, `[id]/release`, `[id]/close`, `[id]/restrictions` — extended, still finalizing an invoice at close (**dispatch closeout atomicity preserved**, do-not-break rule 5). `authorize` keys: `dispatch.release`, `revenue.time_entry`/`revenue.time_override` (instructor time), `revenue.time_override` for Hobbs-divergence overrides. `/api/revenue/pricing-profiles`, `/instructor-rates`, `/items`, `/taxes` settings routes: `revenue.pricing_approve`, `revenue.items_manage`, `revenue.pricing_approve`, `revenue.items_manage` respectively (per doc 36).

**Scope — UI.** Aircraft **checkout with Hobbs Out / Tach Out** at release and **return with Hobbs In / Tach In** at closeout, on the dispatch board (doc 37; the "check-in" term is banned — this maps to release + return/closeout). Fast aviation-native validation/warning presentation. Instructor time-entry (ramp-friendly). Settings editors: Aircraft Pricing Profiles, Instructor Billing + Compensation Rates, Revenue Items, Taxes (doc 37).

**Dependency ordering.** M2 (Phase 1) → M3/M4/M5/M6 (independent of each other, any order) → M7 (needs M3 `payerId`, M4 `pricingProfileId`) → M16 backfill → engines (`pricing`/`instructor-rates`/`revenue-items`/`tax` before `dispatch-validation` consumes them) → close-route wiring → capture UI → settings UI.

**Test gate.** New `tests/engines.test.ts` cases: `pricing.ts` L1–L6 with the historical-rate fixture (v1 superseded / v2 current — an approved snapshot must not move when a rate changes, doc 33 FX-RATE-HIST); `instructor-rates.ts` 8-tier resolution; `tax.ts` stacked rules; `dispatch-validation.ts` block/warning matrix. `tests/dispatch-idempotency.test.ts` — the guarded `updateMany` claim on the close route stays intact. `schema-governance` auto-covers M3–M7 models; the two partial uniques (default-payer, and R4 review-per-dispatch when it lands Phase 3) get allowlist entries (doc 14 §9). Migration validation matrix (doc 14 §6) fresh + seeded + legacy-invoice fixtures. **Done** = a seeded closeout produces the same total via the profile resolver as the legacy `hourlyRateWet` path for a zero-config org (the legacy virtual profile, doc 05), and a profiled org bills its profile.

**Risk hot-spots.** Rate **ambiguity resolved silently** is an auto-reject (scope §116) — the resolver must surface a warning and never guess; contract-tested. The M7 hand-edited `DEFAULT CURRENT_TIMESTAMP` on a non-empty `Dispatch` table is the classic migration trap (doc 14 §2.1) — review the generated SQL. **Rollback:** all additive DDL + one deterministic backfill (idempotent, only fills `NULL`s); redeploy-previous is DB-safe. The closeout still writes an invoice, so there is no new money-state to strand.

---

## 6. Phase 3 — Revenue Review and approval workflow

**Goal:** the ADR-025 flip. Closeout now creates a **draft Revenue Review** instead of finalizing an invoice; a Chief Flight Instructor reviews, an Operations Director approves, and approval writes the **immutable financial snapshot** plus the balanced REVENUE allocation, ledger journal, accrued platform fee, and born instructor earnings. Collection is **offline-only** this phase (record payment) — provider charging is Phase 5, so the approval control reads *"Approve Revenue Review and record offline payment"* until charging lights up (doc 22 §3.3 truthful-label rule).

**Scope — schema.** M9 (`RevenueReview`, `RevenueReviewApproval`, `InstructorTimeEntry` + status/approval enums; extend `Invoice` with `payerId`/totals/`approvedAt`/`currency`; the R4 review-per-dispatch partial unique); M10 (`RevenueAdjustment`, `CustomerCredit`, `CreditApplication`, `PromoCode`, `PromoCodeRedemption`); M11 (extend `InvoiceLine` with `origin` + full provenance/snapshot columns); M12 (`TaxSnapshot`, `TaxSnapshotItem`); **M14** (`RevenueAllocation`, `InstructorEarning`, `PlatformFeePolicy`, `PlatformFee`, `FinancialExportJob` — the approval transaction posts allocations, accrues the fee, and births earnings, so this whole migration lands here even though refund/comp/export *workflows* are later; `FinancialExportJob`/`PlatformFeePolicy` tables sit dormant until Phases 7/6); **M15-a** (`LedgerEntry` only — the approval journal writer; `ProviderPayout`/`ReconciliationException` split to Phase 5 where their writers live); M18 backfill + `OrgSequence` `INV-<seq>` numbering going live.

> **Migration-split note (binding-safe):** doc 14 groups `LedgerEntry` with `ProviderPayout`/`ReconciliationException` as M15. This plan lands `LedgerEntry` in Phase 3 (its first writer is the approval journal) and the payout/reconciliation tables in Phase 5 (webhook/reconcile writers). Both sub-slices are additive DDL against `Organization`; FK order is preserved; doc 13/14 remain canonical for the shapes. Same pattern for M13/M14 dormancy.

**Scope — engines.** `revenue-review.ts` (transitions, approval preconditions, the write-once snapshot); `revenue-adjustments.ts` (the eight operations, approval/application claims, credit/promo consumption); `revenue-allocation.ts` (REVENUE set balancing + `PlatformFee` ACCRUED); `ledger.ts` (the only append-only journal writer); `tax.ts` snapshot write at approval; `instructor-compensation.ts` birth (`InstructorEarning` born per doc 29 matrix — release/clawback is Phase 6); `revenue-dashboard.ts` extended with queue counts.

**Scope — routes.** `/api/revenue/reviews/[id]/submit` (`revenue.review_submit`), `/request-changes` (`revenue.review_edit`), `/approve` (`revenue.approve` / `revenue.approve_routine` / `revenue.approve_finance` per amount + manual-item second-approval policy), review edits (`revenue.review_edit`); `/api/revenue/adjustments`, `/credits`, `/promo-codes` (`revenue.charge`/`revenue.items_manage` per doc 36). Review creation is implicit in the extended `/api/dispatch/[id]/close`. Every route: `authorize(..,{mutating:true})` → zod → engine → `recordAudit` → `emitDomainEvent`.

**Scope — UI.** Revenue Review screen `/billing/reviews/[id]` (doc 03 §2.1) with the exact approval control and the changes-requested workflow; **Operations revenue queue `/billing/queue`** (three-column card board, the dispatch-board precedent — RR-#### number, `StatusBadge`, age chip at ≥7d, approve-from-card) + its **Revenue Reviews** nav item and `SECTION_PERMISSIONS`/`SECTION_MODULES` entries (`revenue.review_view` → billing); redirect of review-wrapped `/billing/[id]` invoices to `/billing/reviews/[id]`.

**Dependency ordering.** M9→M11→M12 (provenance/tax reference reviews) and M10 (adjustments reference reviews); M14 + M15-a before the approval engine (doc 14 Group E gate — approval writes allocation/ledger/fee/earning). Engine order: `revenue-review.ts` + `ledger.ts` + `revenue-allocation.ts` + `tax.ts`-snapshot + `instructor-compensation.ts`-birth compose the single approval transaction, so they merge together. Then the close-route flip, then queue/screen UI. **The flip, the approval engine, the queue UI, and the offline-payment fallback ship in one release or behind one feature flag flipped together** (doc 14 §2.3) — deploying the flip alone would strand every closeout in an invisible DRAFT review.

**Test gate.** `tests/payment-engines.test.ts` — approval readiness/precondition core, snapshot immutability (re-read a snapshot after creating a v2 rate — it must not move). `tests/revenue-allocation.test.ts` — the doc 28 §6 golden postings digit-exact; every dimension balances; residue only in `SCHOOL_RETAINED_REVENUE`; `ledger.post()` throws on imbalance. `tests/instructor-compensation.test.ts` — the birth matrix. `S1` scan (IDM) — the approval route is an interactive `$transaction` with a guarded `updateMany` claim carrying `updatedAt` + `expectedTotal` and `.count === 0` abort. `S6` scan — no `ledgerEntry.update/delete` / `revenueAllocation.update/delete` anywhere. `payment-security` — approval needs the right key; second approver ≠ first (`RevenueReviewApproval`); read-only impersonation refused. **Done** = a seeded closeout lands in the queue as DRAFT, submits, approves with a balanced snapshot + ledger, and is collectible offline; the constitution walker covers the new routes; the **Revenue allocations do not balance** and **historical financial records silently mutate** auto-rejects are both mechanically unreachable.

**Risk hot-spots.** This is the highest-blast-radius phase: it re-routes the money path for every new closeout. The single approval transaction is large and must stay atomic (allocation + ledger + fee + earning + snapshot in one `$transaction`); the guarded-claim shape is pinned by S1. **Rollback:** flip the release flag off (or redeploy previous) → new closeouts resume the old invoice-at-close route; **in-flight DRAFT/CHANGES_REQUESTED reviews are never orphaned** — the queue + approval engine stay live independent of the flag so the backlog drains (doc 14 §7). **Point of no return P2** is crossed the first time an approval writes a financial row in a shared environment — from here, correction is by adjustment/reversal only, never a delete; `org-snapshot` capture/restore for all M9–M15-a models must be live *before* this phase's engine code (doc 14 §7).

---

## 7. Phase 4 — Responsible payer and payment-method foundation

**Goal:** payers, parents/guardians, and payment-method + consent records exist and are managed; students/payers get their own financial home at `/billing/my`. Still **no charging** — `REVENUE_CHARGING=off`, so attaching a card (which needs a provider SetupIntent) is the one surface that degrades: the payer/consent data model and management UI are fully live, card attach activates in Phase 5.

**Scope — schema.** M8 (`PaymentCustomer`, `PaymentMethodReference` + `PaymentProvider`/`StoredPaymentMethodType`/`StoredPaymentMethodStatus`); the M3 payer tables (migrated dormant in Phase 2) now get their engine + UI; `PaymentConsent` per doc 34 (canonical) lands here as the consent record. No charging tables (M13) yet.

**Scope — engines.** `payers.ts` full (relationship capabilities, parent/guardian, post-approval transfer as an adjustment); `revenue-self.ts` full (identity-scoped reads — reviews, invoices, receipts, amount due, history — never school revenue/fees/allocations/comp/other customers, doc 30 §6/§9); payment-method management + `chargeable()` consent derivation (bound + unrevoked + unsuperseded + version-current, doc 20).

**Scope — routes.** `/api/payer/*` (payer self-service, `authorizePayer()`, catalogued in `SELF_SERVICE_ROUTES` — the gate was added Phase 1, the routes land now); `/api/revenue/payment-methods` (`revenue.payment_methods_manage`); payer/relationship management (`revenue.payment_methods_manage` / payer-admin key per doc 36). Method attach route calls `createSetupSession` — returns a graceful "charging not enabled" state when the provider is absent.

**Scope — UI.** Responsible-payer + parent/guardian management; payment-method management + consent capture (the hosted SetupIntent CTA is present but inert until Phase 5); **student/payer view `/billing/my`** + its **My Payments** nav item + `SECTION_PERMISSIONS` (`revenue.self_view` → billing) — visible only to key-holders (STUDENT bundle), reads reviews/invoices/receipts/amount-due only.

**Dependency ordering.** M8 (needs M3) → `payers.ts` + `revenue-self.ts` → `/billing/my` + payer/method management UI. `authorizePayer` + `SELF_SERVICE_ROUTES` catalog entry already exist from Phase 1, so the payer routes are constitution-green on first commit.

**Test gate.** `payment-security` — payer/student visibility isolation: payer A sees only reviews/receipts/methods where A is responsible payer or self-pay student; `S5` scan — payer/self-view route files never select `platformFee`/`ledgerEntry`/`revenueAllocation`/`instructorEarning`; the static scan that `revenue-self.ts` never imports `revenue-dashboard.ts` (from Phase 1) still holds. `tests/payment-engines.test.ts` — `chargeable()` across the FX-CONSENT variants; method-ownership (a method whose `PaymentCustomer` ≠ payer never surfaces). `constitution` — every `/api/payer/*` route walked for `authorizePayer`. **Done** = a STUDENT session sees only its own money at `/billing/my` and is denied at `/billing`, `/billing/queue`, `/reports`, `/executive`; a payer manages relationships and (inert) method slots; token-security suite confirms no raw `*token` column on `ResponsiblePayer` (hash-only, ADR-020).

**Risk hot-spots.** **Cross-tenant payer access** and **student views org-wide revenue** are auto-rejects — every `/api/payer/*` query starts from the payer's *relationships*, never a client `organizationId`, failing closed to nothing. **Rollback:** additive DDL + new gated routes; redeploy-previous hides the payer surfaces; no money state exists to unwind (charging still off).

---

## 8. Phase 5 — Stripe Connect test-mode payment execution

**Goal:** with owner sign-off on ADR-037 (doc 18) and the threat model (doc 32) in hand, approved reviews charge the saved payment method against the org's Stripe **Express** connected account (test mode), the platform fee splits atomically via `application_fee_amount`, and settlement truth arrives **by webhook only**. This is the phase every automatic-rejection condition in the scope (§114–135) targets.

**Scope — schema.** M13 (`ScheduledCharge`, `PaymentAttempt`, `PaymentProviderEvent`, `Refund`, `Dispute` + extend `Payment` with `organizationId`/`currency`/`paymentAttemptId @unique`; the `Payment.invoice` FK **Cascade → Restrict** flip — one-way by policy, never reverted, doc 14 §7); M15-b (`ProviderPayout`, `ReconciliationException`); M17 backfill (`Payment.organizationId`/`currency`, after M13); the M13 R-P9 `ScheduledCharge` partial uniques + `FinancialHold_active_key` (hand-edited SQL). Per doc 34 (canonical): `ConnectedAccount` + `ConnectedAccountStatus`, and `FinancialHold` — first written here. `Refund`/`Dispute` tables land now but their **workflows** are Phase 6 (dormant).

**Scope — engines.** `src/lib/stripe.ts` (`StripeProvider`, §2.3 — the `stripe` dependency added here); connected-account onboarding engine (doc 19); `payment-readiness.ts` (the ten checks, doc 22 §3.2); `payment-runner.ts` (claim due `ScheduledCharge` → `PaymentAttempt` with `sc_<id>_a<n>` key → provider call **outside any transaction**); `payment-idempotency.ts` (K1/K2/K3 formats, TTL branch); `provider-events.ts` (webhook reducers — pure decision + guarded write, doc 23 §5). The Phase 3 approval engine is **extended** to also create a `ScheduledCharge` outbox row when charging is enabled (the offline path stays for `REVENUE_CHARGING=off`).

**Scope — routes.** `/api/revenue/payment-runs` (`revenue.charge`; the "Run due payments now" trigger); `/api/webhooks/stripe-connect` + `/api/webhooks/stripe-platform` (**PUBLIC-catalogued** with written reason, signature-verified before any side effect, rate-limited, inert unless `REVENUE_CHARGING=test`); `/api/platform/connect/*` onboarding + status sync (`authorizePlatform` / `revenue.connect_manage`). `PaymentAttempt` insert precedes any adapter call, inside a `$transaction` the provider call sits **outside**.

**Scope — UI.** Connect onboarding page (doc 19 — Stripe-hosted Account Links, status surfaced); the Revenue Review approval control now reads its true form **"Approve Revenue Review and charge the saved payment method"**; card success / decline and ACH pending/success/return/failure status on the review + `/billing/my`; the retry surface (doc 25). Card-attach SetupIntent (from Phase 4) now functional.

**Dependency ordering.** `stripe` dep + `env.ts` guards + `src/lib/stripe.ts` first (nothing else compiles against the provider otherwise) → M13/M15-b/M17 + `ConnectedAccount`/`FinancialHold` schema → onboarding engine (a charge cannot initiate without `connectedAccountReady()`) → `payment-readiness` → `payment-runner` + `payment-idempotency` → `provider-events` + webhook routes → UI. Onboarding must precede the runner.

**Test gate.** `tests/payment-idempotency.test.ts` — K1/K2/K3 pins, same-key/same-body replay, same-key/different-body reject, new-attempt-new-key, TTL branch (I1–I6); scans `S2` (no `createCharge`/`createRefund` token inside any `$transaction` callback), `S9` (runner claim shape). `tests/webhook-reducers.test.ts` — every doc 23 §5 handler through the pure reducer with signed HMAC fixtures; replay/out-of-order/tenancy-quarantine; `S3` (verify-before-`db.`/`req.json()`), `S8` (redirect route never marks paid). `tests/payment-engines.test.ts` — readiness ten checks, amount `min(snapshot, Amount Due)`, retry-slot arithmetic. `schema-governance` pins: `PaymentAttempt.idempotencyKey @unique`, `@@unique([provider, providerPaymentIntentId])`, `@@unique([scheduledChargeId, attemptNumber])`, `Payment.paymentAttemptId @unique`, `PaymentProviderEvent @@unique([provider, providerEventId])`, `ConnectedAccount.organizationId @unique`. `constitution` — the two webhook `PUBLIC_ROUTES` entries with reasons; new domain events (`payment.succeeded`/`payment.failed`) have live emit sites; `src/lib/env.ts` fail-closed contract. **Opt-in** `tests-integration/stripe/*` (`npm run test:stripe`, `sk_test_` only, never in `npm test`) run before merge. **Done** = every doc 33 §8 charging row (1–13, 20) passes offline; a test-mode approve → charge → webhook → `CARD_PAID`/`PAID` round-trips against Stripe with exactly one PaymentIntent and one `ApplicationFee`; **operational closeout never waits on Stripe** (the Phase 2/3 close path is untouched); every §114 auto-reject (charge-before-approval, duplicate-charge, missing idempotency/signature, browser-trusted success, ACH-as-settled, cross-tenant) is mechanically blocked.

**Risk hot-spots.** The busiest phase for auto-reject conditions. **A Stripe call inside a DB transaction** and **payment success trusted from the browser** are the two that most easily creep in — pinned by S2/S8. The `Payment.invoice` Cascade→Restrict flip briefly `ACCESS EXCLUSIVE`-locks (trivial at current volume) and is **never reverted** (reverting re-arms the doc 00 cascade-delete landmine). **Rollback:** `REVENUE_CHARGING=off` degrades every charging surface to manual invoice + offline recording; **in-flight `PaymentAttempt`s are never cancelled locally** — webhooks ride to their true outcome, never a synthesized failure (doc 18 ADR-037 item 14). **Point of no return P3** (first `INV-<seq>` from `OrgSequence`) is already crossed in Phase 3; the first real `PaymentAttempt` re-affirms P2.

---

## 9. Phase 6 — Refunds, allocations, and instructor compensation

**Goal:** the post-settlement money workflows. Refunds and partial refunds (approved, audited, remainder-capped), the DISPUTE lifecycle, revenue-allocation viewing, platform-fee policy administration (platform staff only), and instructor-compensation release/clawback/viewing. All schema for this exists (M14 in Phase 3, M13 Refund/Dispute in Phase 5) — this phase is engines + workflows + UI on already-migrated tables.

**Scope — schema.** None new beyond doc 34's `PlatformFeeTier` (platform-owned child, no `organizationId` — schema-governance allowlist entry) if not already landed with M14. The refund/dispute/comp tables are all migrated; this phase adds no `Organization`-owned table.

**Scope — engines.** `platform-fee.ts` (resolution precedence, rail/tier/intro/waiver, clamps, proportional reversal + residue, doc 27); refund engine (in `revenue-adjustments.ts` — `refundableRemainder`, hybrid line-targeted vs proportional, provider-window/dispute block, `refund_application_fee` reversal); `provider-events.ts` extended with dispute + refund + `application_fee.refunded` reducers; `instructor-compensation.ts` release (`HELD → APPROVED` only at Amount Due = 0) + clawback (proportional, capped at family net) + self-approval refusal; `reconciliation.ts` (R1–R7 detectors, `ProviderPayout` ingestion, `FEE_MISMATCH`, staleness).

**Scope — routes.** Refund request `/api/revenue/refunds` (`revenue.refund`) + approve (`revenue.refund_approve`, approver ≠ requester, second approver ∉ {requester, approver}); `/api/platform/fee-agreements` (`authorizePlatform` only — **no org route may write `platformFeePolicy`/`platformFeeTier`**, scan S4); compensation `/api/revenue/compensation/*` (`revenue.compensation_view`/`_view_own`/`_approve`/`_manage`); `/api/revenue/reconciliation-runs` (`revenue.reconciliation_manage`); allocation views (`revenue.allocation_view`); financial-hold management (`revenue.financial_hold_manage`).

**Scope — UI.** Refund + partial-refund flows with the two-approver control; dispute record view (webhook-driven, evidence via API minimal); revenue-allocation view; instructor-compensation view (an instructor sees only own earnings via `revenue.compensation_view_own`, 404 on another's); platform-fee console (platform staff, doc 27); reconciliation-exception queue.

**Dependency ordering.** `platform-fee.ts` before the refund fee-reversal math; refund/dispute reducers before their UI; `instructor-compensation.ts` release keys off settlement (Phase 5) so it merges after. Platform-fee console (platform surface) is independent and can land in parallel.

**Test gate.** `tests/platform-fee.test.ts` — the full doc 27 §8.4 case list (percentage/flat/combined/per-rail/tier/intro/negotiated/waiver, clamps, `min/max`, proportional reversal residue → effective fee exactly 0). `tests/revenue-allocation.test.ts` — DISPUTE/REFUND reversal sets balance; lost-dispute net-capped (never negative books). `tests/instructor-compensation.test.ts` — release requires Amount Due = 0, clawback capped, self-approval refused, voids auto-reverse. `payment-security` — refund needs `revenue.refund`, approve needs `revenue.refund_approve`, separated humans, read-only impersonation refused. Scans `S4` (fee-write isolation), `S6` (append-only ledger/allocation), `S7` (no `payment.update` in refund/dispute/void engines). **Done** = doc 33 §8 rows 9, 15–19, 21, 23–25 pass; a seeded settled review refunds with a balanced reversal + fee reversal; a lost dispute drives the chargeback contract with no `Refund` row; **instructor compensation is never conflated with customer billing** and **platform fee is not editable by org staff** are both mechanically enforced.

**Risk hot-spots.** **Refunds lacking authorization or audit** and **allocations not balancing** are auto-rejects — the two-approver separation and `ledger.post()` balance assertion carry them. Instructor-comp release timing (only at full collection) is subtle and contract-tested against partial-collection fixtures. **Rollback:** no new schema → pure code rollback; refund/dispute engines gated by the same `REVENUE_CHARGING` posture; in-flight disputes are webhook-driven and unaffected by an app redeploy.

---

## 10. Phase 7 — Revenue reporting and accounting exports

**Goal:** financial and instructor-compensation reports (definitions, filters, columns, RBAC per doc 38), **Excel exports using the existing `exceljs` dependency** (used only for *reading* imports today — this is the first write path), and the accounting-export adapter foundation (`AccountingMapping` + `FinancialExportJob`, generic CSV journal + QuickBooks-shaped CSV). Reports read the same `revenue-dashboard.ts` / allocation engines — no figure computed twice (one-engine rule).

**Scope — schema.** None new — `FinancialExportJob` (M14, Phase 3) and `AccountingMapping` (M2, Phase 1) are already migrated; this phase is engine + UI. `ExportJobKind` (`REVENUE_CSV`/`LEDGER_CSV`/`QUICKBOOKS_CSV`/`INSTRUCTOR_COMPENSATION_CSV`/`TAX_CSV`) and `ExportJobStatus` shipped with M14.

**Scope — engines.** A reports engine over `revenue-dashboard.ts` + `revenue-allocation.ts` (bounded `db.groupBy/aggregate`, server-component + serialized-props pattern from `/reports`); the export engine — modeled as **"the ImportJob idiom in reverse"**: a `FinancialExportJob` with per-row `rowErrors`, `COMPLETED_WITH_ERRORS` status, and a **pre-export unmapped-keys preview** (unmapped `AccountingMapping` keys surfaced, never silently dropped); server-side `exceljs` **write** (dynamic-imported, mirroring `import/parse.ts`) + generic-CSV + QuickBooks-CSV generators.

**Scope — routes.** `/api/revenue/exports` (`revenue.exports_run`, defaults ACCOUNT_OWNER/SCHOOL_ADMIN/ACCOUNTANT per doc 36); reports read routes gated `reports.view`/`revenue.allocation_view`. Exports are tenant-scoped, audited (`recordAudit`), and honestly labeled ("not an official tax document").

**Scope — UI.** Financial reports + instructor-compensation reports (Recharts + tables, the `/reports` precedent; the inline `COLORS`/`useMode`/`tooltipStyle` extracted to a shared chart-palette module on this second consumer, per the DESIGN_SYSTEM second-copy rule); export center with the unmapped-keys preview and per-row outcome reporting; the `AccountingMapping` editor (`revenue.reconciliation_manage` or an exports-admin key per doc 36).

**Dependency ordering.** Reports engine → report UI; export engine (`exceljs` write + CSV) → export routes → export UI + mapping editor. Reports can ship before exports.

**Test gate.** Reports contract tests over the shared engine (a report figure equals the dashboard figure — one-engine proof). Export engine tests: deterministic CSV/xlsx bytes for a fixed fixture; unmapped-key preview lists exactly the unmapped keys; `COMPLETED_WITH_ERRORS` when a row fails; tenant scoping (org B rows never appear in an org A export). `payment-security` — `revenue.exports_run` required; STUDENT/payer surfaces never reach export routes (S5 still holds). **Done** = an ACCOUNTANT exports a balanced ledger CSV + a QuickBooks CSV + an Excel financial report scoped to their org, with honest labeling and an audit row; a dispatcher (no `revenue.exports_run`) sees no export control (hidden, not disabled).

**Risk hot-spots.** The first `exceljs` **write** path — memory/streaming on large orgs is a scale seam (bounded query + documented row cap, revisit at pilot volume). **Test-mode and live-mode resources can be confused** is an auto-reject the export labeling and tenant scoping guard against. QuickBooks Online **API sync is explicitly post-Part-3** — this phase produces CSV only. **Rollback:** no schema, read-mostly + additive job rows; pure code rollback.

---

## 11. Phase 8 — Final bug fixes and hardening

**Goal:** close the verification checklist (scope §137–144), resolve deferred consistency items, and prove the end-to-end Revenue Engine workflow on fresh + seeded databases. No new capability — this phase is quality, not scope.

**Scope.** The D3 namespace consistency pass if any `billing.*` adjust/refund/promo keys still shadow `revenue.*` (§14); route-level `error.tsx` per section with actionable retry states + `loading.tsx` skeletons across all Revenue Engine surfaces (doc 30 §13); the shared toast primitive if a second consumer materialized; accessibility + responsive (light/dark, desktop/tablet/mobile) audit of every new screen; secret scan; documentation-link check; ADR-025–037 merged into `DECISIONS.md` verbatim on approval; `ROADMAP.md`/`ARCHITECTURE.md` updated. Full-matrix verification: `git diff --check`, `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, Prisma validate, migration deploy on fresh + seeded DBs, seed/reseed, the browser e2e Revenue Engine workflow on an identified fresh server (commit hash, build ID, PID, mode, port, start time recorded).

**Explicitly NOT in this phase.** **M19 tightening** (`SET NOT NULL` on `Dispatch`/`Payment` tenancy + currency) is a **separate later release**, not Phase 8 (doc 14 §2 Group G): its gate is "one full release in which every writer populates the fields + zero-`NULL` migration report," which by definition post-dates Phase 8. It is listed here only so no one mistakes it for hardening work.

**Test gate.** Every doc 33 §8 row green offline; the opt-in integration suite green in test mode; all eight review-board gates recorded (CLAUDE.md §13). **Done** = the full verification matrix passes on a fresh checkout and the seeded demo, `demo1234` logins work, and a Director-of-Operations-legible walkthrough (checkout → return → review → approve → charge → settle → refund → report → export) completes without a demo-time explanation of any confusing step.

**Rollback:** hardening only; each fix is an independent revertible slice.

---

## 12. Seed-data plan (extends `prisma/seed.ts` additively, never breaking demo logins)

Each phase adds only its slice's fixtures, in the same commit as its schema. The seed's `TRUNCATE … CASCADE` root set already reaches every new table (all FK an existing root), so no new truncate roots are needed (doc 14 §6). `demo1234` logins are untouched (do-not-break rule 4). Sources: doc 14 §6 matrix + doc 33 §6.2 + doc 34 §11.3.

| Phase | Seed additions (both orgs `golden-gate` + `blue-ridge` unless noted) |
|---|---|
| 1 | Config singletons per org (`DispatchPolicy`, `RevenueWorkflowPolicy`, `OrgPaymentPolicy`, `RevenueSettings`, `CheckoutRestrictionPolicy`); one `OrgSequence(key='invoice')` per org; one `AccountingMapping`. |
| 2 | Demo Aircraft Pricing Profiles including a **v1 (APPROVED, `effectiveEnd` past) + v2 (current, different rate)** family so a snapshot bug shows on the demo dashboard; Instructor Rate Profile families (BILLING + COMPENSATION); the 26 built-in Revenue Items × 2 orgs; Tax Rules; `blue-ridge` gets ≥1 closed dispatch + invoice + payment (it has none today) so org-scoped backfills prove out with two data-bearing tenants; one `PARTIALLY_PAID` + one `VOID` legacy invoice (exercises every pre-existing `InvoiceStatus`). |
| 3 | At least one Revenue Review per `RevenueReviewStatus` across the two orgs (including a multi-instructor, a taxed one with `TaxSnapshot`, above/below the second-approval threshold); adjustments/credits/promo samples; balanced allocation + ledger + accrued-fee + born-earning rows for approved reviews. |
| 4 | Responsible payers (self-pay student, parent/guardian); default + non-default relationships; `PaymentCustomer` + methods per rail (active card, expired card, verified ACH, unverified ACH, detached — one payer holds two); `PaymentConsent` valid/revoked/superseded/micro-deposit. |
| 5 | `ConnectedAccount` per status (`golden-gate` ENABLED+charges-enabled; `blue-ridge` REQUIREMENTS_DUE with a RESTRICTED variant); `ScheduledCharge`/`PaymentAttempt` fixtures incl. `PAYMENT_FAILED` (retries exhausted + escalation `FinancialHold`) and `ACH_PENDING`; settled card + ACH `Payment`s. |
| 6 | Partial-refund with full reversal chain; `PROVIDER_RETURN`; open dispute (evidence + near deadline); lost dispute (fee true-up + `KEPT` compensation decision); `PlatformFeePolicy` variants; `InstructorEarning` born/HELD/released/reversed/EXPORTED. |
| 7 | A `FinancialExportJob` `COMPLETED` + one `COMPLETED_WITH_ERRORS` sample; an `AccountingMapping` with one unmapped key (exercises the preview). |

The historical-rate and failed-payment fixtures are the load-bearing ones: they make "recomputed from current rates" and "ACH treated as settled" bugs visible on the demo itself, not just in tests.

---

## 13. Keeping the tree green and rollback posture (cross-phase summary)

| Concern | Mechanism |
|---|---|
| **No half-wired commit** | Constitution + schema-governance suites auto-fail a route without `authorize()`, a nav item without `SECTION_PERMISSIONS`, an org model without tenant-unique. A slice that isn't fully wired can't merge. |
| **Cutover is code, not DDL** | All M1–M15 schema is additive and may land dormant ahead of its writer (doc 14 §2.3). Two runtime gates carry every cutover: `REVENUE_CHARGING` (charging) and the Phase-3 close-route flip flag/release-boundary. |
| **App rollback = redeploy previous** | Prisma has no down-migrations; additive-only makes redeploy-previous DB-safe at every phase (doc 14 §7). Schema stays; the previous app version never touches the new tables. |
| **Irreversible-by-policy** | M1 enum values (Postgres can't drop values — benign); M13 `Payment.invoice` Cascade→Restrict (reverting re-arms the cascade-delete landmine). Never reverted. |
| **In-flight money is never synthesized** | On a charging rollback, `PaymentAttempt`s ride to their true webhook outcome; queued `ScheduledCharge`s hold visibly; in-flight reviews drain through the queue that stays live independent of the flip flag. |
| **Points of no return** | P1 (M1), P2 (first financial row — `org-snapshot` capture/restore must precede it), P3 (`OrgSequence` numbering), P4 (M19 tightening, post-Phase-8). Called out in the release notes of the crossing slice. |

---

## 14. Open questions (product-owner decisions)

1. **D2 — commercial platform-fee terms (bps/flat).** CEO/owner decision (doc 16 D2, doc 18 §16 Q1). Blocks *fee revenue* (defaults to 0 bps), **not** the build — every fee shape is expressible once the number is set. Must be decided before real fee revenue is expected, not before Phase 5.
2. **D3 — namespace collapse.** Do the `billing.adjust`/`billing.refund`/`billing.refund_approve`/`billing.adjust_approve`/`billing.promo_manage` keys (introduced by docs 08/11) fold under `revenue.*`? Recommended: **yes**, in the Phase 1 consistency pass, so `MODULE_BY_PREFIX` is unambiguous and nothing is renamed post-hoc (doc 01 §96, doc 16 D3). Needs a ruling before Phase 1's permissions commit.
3. **Owner sign-off sequencing.** ADR-037 (doc 18) + the threat model (doc 32) must be approved before Phase 5 charging begins (README §"What happens next"); Phases 1–4 build no charging and could proceed in parallel with that review — confirm the owner wants Phases 1–4 to start ahead of the charging sign-off, or to gate the whole program.
4. **ACH default.** Card-first with **ACH behind per-org opt-in** is the designed default (doc 16 D4, doc 18 §5.3). Confirm ACH ships opt-in (not on-by-default) for the pilot.
5. **Payout-schedule control.** Doc 18 §16 Q2 reserves optional platform control of connected-account payout schedules as a negative-balance-tail mitigation. Owner elects whether to exercise it; default is Stripe's standard schedule.
6. **Close-route cutover mechanism.** Doc 14 §2.3 permits either a runtime feature flag or a single-release boundary for the Phase-3 flip. A runtime flag is safer for rollback but adds a permanent branch; a release boundary is simpler. Recommended: **runtime flag** for the pilot, retired once stable — owner/eng lead confirms.

---

## 15. Related documents

[01-revenue-engine-architecture.md](./01-revenue-engine-architecture.md) (engine + route + RBAC seams) · [13-database-model.md](./13-database-model.md) / [34-part2-database-additions.md](./34-part2-database-additions.md) (canonical shapes) · [14-migration-plan.md](./14-migration-plan.md) (migration ordering M1–M19, rollback, seed matrix) · [18-stripe-connect-decision.md](./18-stripe-connect-decision.md) (ADR-037, adapter surface, env, funds flow) · [30-revenue-dashboard.md](./30-revenue-dashboard.md) (dashboard/queue/self-view, one-engine rule) · [33-payment-test-plan.md](./33-payment-test-plan.md) (the §8 test matrix this plan gates on) · 36-permissions-and-visibility.md · 37-ui-workflows.md · 38-reports-and-exports.md (sibling Part 3 deliverables, in progress) · [CLAUDE.md](../../../CLAUDE.md) §§8–11 (quality gates, do-not-break rules) · `prisma/seed.ts`, `src/lib/env.ts`, `src/lib/session.ts`, `src/lib/permissions.ts` (the seams this plan extends).
