# Payment Test Plan

> **Status:** Proposed — Phase 8 Part 2 · **Date:** 2026-07-10 · **Lead roles:** QA/Test Engineer; Principal Payments Architect at Stripe; Reliability/SRE Engineer · **Part of:** Revenue Engine design set ([README](./README.md))

This document is Part 2 deliverable 18 (spec **Part AC — Payment Testing**): the complete test plan for the Revenue Engine payment slice, written for the Part 3 implementers. Every Part AC bullet becomes at least one planned test (§8). Design only: no test here is implemented in Part 2, no Stripe object is created, nothing deploys, and **the unit suite requires no live Stripe credentials — ever** (spec Part AC, binding).

House rule this plan is built on (seams audit, [CLAUDE.md](../../../CLAUDE.md) §8): the existing suite is **DB-free, mock-framework-free, and sub-second** — pure-engine contract tests with literal fixtures (`tests/engines.test.ts` idiom), plus static source-scan tests for route/engine shape (`tests/dispatch-idempotency.test.ts` idiom), plus catalog-driven architecture tests (`tests/constitution.test.ts`, `tests/schema-governance.test.ts`). This plan extends those three patterns and adds exactly one new instrument (a deterministic in-memory `PaymentProvider` fake, §3.3) and one new opt-in suite (Stripe test mode, §10) that is excluded from `npm test`.

---

## 1. Purpose & scope

### In scope

- The test-pyramid strategy for payments: which layer proves which property, and what each layer is forbidden to touch (§3).
- Suite and file layout, including the separate env-gated integration suite (§4, §10).
- Constitution and security suite additions: `PUBLIC_ROUTES` entries, new static scans, schema-governance allowlist entries (§5).
- The fixture catalog — in-memory builders for the DB-free suites plus `prisma/seed.ts` extensions for integration and manual verification (§6).
- The webhook-event fixture strategy: canned signed payloads, signature-failure cases, replay and out-of-order cases (§7).
- The complete Part AC test matrix — every spec bullet as rows: test name → suite → fixtures → setup → assertion → design doc verified (§8).
- The engine-invariant contract coverage map (§9).
- What **cannot** be unit-tested and is deferred to the integration suite, listed honestly (§11).
- CI expectations (§12).

### Out of scope

- The designs under test — owned by [22-approval-to-payment.md](./22-approval-to-payment.md), [23-webhooks-and-reconciliation.md](./23-webhooks-and-reconciliation.md), [24-idempotency.md](./24-idempotency.md), [25-payment-failure-workflow.md](./25-payment-failure-workflow.md), [26-refunds-voids-disputes.md](./26-refunds-voids-disputes.md), [27-platform-fee.md](./27-platform-fee.md), [28-revenue-allocation-ledger.md](./28-revenue-allocation-ledger.md), [29-instructor-compensation.md](./29-instructor-compensation.md), [20-payment-methods-and-consent.md](./20-payment-methods-and-consent.md), [21-card-and-ach-workflows.md](./21-card-and-ach-workflows.md), [19-connected-account-onboarding.md](./19-connected-account-onboarding.md). This plan verifies them; it never redefines them.
- Final schema shapes — [34-part2-database-additions.md](./34-part2-database-additions.md) is binding; fixture shapes here follow it.
- Security-specific test additions mandated by the threat assessment (deliverable 17, doc 32) — folded into `tests/payment-security.test.ts` when that document lands (§14 Q1).
- Playwright/running-app verification of Part 3 slices — the CLAUDE.md §8 running-app rules apply at implementation time; this plan covers the automated suite.

North-star check: a failing payment test must read like an incident report a Director of Operations would recognize — "duplicate approval created a second charge" — not like a mocking-framework stack trace. Pure engines with literal fixtures keep test failures in the domain's language.

---

## 2. Relationship to repo standards and the design set

| Source | What this plan takes from it |
|---|---|
| `vitest.config.ts` | `include: ["tests/**/*.test.ts"]`, node environment, `@ → src` alias. The integration suite lives **outside** `tests/` (in `tests-integration/`) precisely so `npm test` never picks it up (§10.1) |
| `tests/engines.test.ts` | The pure-engine idiom: framework-free `src/lib` functions, literal fixtures cast `as never`, no DB, no `vi.mock` (zero mocking-framework usage exists in the repo — kept that way) |
| `tests/dispatch-idempotency.test.ts` | The static source-scan idiom: `readFileSync` the route/engine source, regex-assert the transaction shape (guarded `updateMany` claim, `count === 0` abort, forbidden legacy form). Doc 22 §7.8 and doc 24 I2 explicitly commission payment scans in this style |
| `tests/constitution.test.ts` | `PUBLIC_ROUTES`/`SELF_SERVICE_ROUTES` catalogs with written reasons; the route walker auto-covers every new payment route; mutating-platform and restricted-org scans; DOMAIN_EVENTS live-emit-site check |
| `tests/schema-governance.test.ts` | Auto-scans every new Prisma model for org FK + explicit `onDelete` + tenant-scoped uniques — all doc 34 models are automatically in scope once the schema ships; allowlist entries in §5.3 |
| [24-idempotency.md](./24-idempotency.md) I1–I10 | The binding idempotency test contract (key formats pinned, no-provider-call-in-tx scans, fixed-clock TTL branch, no-DB/no-credentials rule I9) — §8 rows 2, 3, 26 and §9 implement it |
| [23-webhooks-and-reconciliation.md](./23-webhooks-and-reconciliation.md) §5, §14.9 | Reducers are **pure-decision + guarded-write**: the pure half is unit-testable with fixture JSON; the applier half is covered by static scans + integration. This split is what makes Part AC's webhook bullets testable without a DB |
| [27-platform-fee.md](./27-platform-fee.md) §8.4, [28-revenue-allocation-ledger.md](./28-revenue-allocation-ledger.md) §12, [26-refunds-voids-disputes.md](./26-refunds-voids-disputes.md) §6, [29-instructor-compensation.md](./29-instructor-compensation.md) §10 | Each names its contract-test obligations; §9 maps every one to a suite so none is silently dropped |
| [34-part2-database-additions.md](./34-part2-database-additions.md) §11.3 | The seed-fixture set per demo org — §6.2 adopts it verbatim and adds the test-only variants |

Nothing in Part 1 is reinterpreted. Where a Part 1 doc bound a test (e.g. doc 13 §7's uniqueness inventory), this plan assigns it a suite and a name.

---

## 3. Test-pyramid strategy

Four layers. Each layer has a hard boundary on what it may touch. Layers 1–3 run in `npm test`; layer 4 never does.

```
            ┌────────────────────────────────────────────┐
  Layer 4   │ Stripe TEST-MODE integration (opt-in, env- │  never in npm test;
            │ gated, tests-integration/) — real provider │  sk_test_ only (§10)
            ├────────────────────────────────────────────┤
  Layer 3   │ Architecture/security scans: constitution, │  npm test
            │ schema governance, source-shape scans      │
            ├────────────────────────────────────────────┤
  Layer 2   │ Contract tests: engine invariants, golden  │  npm test
            │ scenarios, state-machine tables, RBAC data │
            ├────────────────────────────────────────────┤
  Layer 1   │ Pure-engine unit tests: fee math, key      │  npm test
            │ derivation, reducers, allocation balance   │
            └────────────────────────────────────────────┘
```

### 3.1 Layer 1 — pure-engine unit tests (no DB, no network, no credentials, no mocks of Prisma)

Every payment engine is a framework-free pure function in `src/lib` by design (Part 1 principle; docs 22/23/26/27/28/29 each state it). The unit layer feeds literal fixtures in and asserts outputs — including *plans* of writes, not writes themselves. Engines under test and their pure cores:

| Engine (`src/lib`) | Pure core under unit test |
|---|---|
| `payment-readiness.ts` | The ten-check readiness evaluator: `(review, invoice, policy, method, consent, connectedAccount, feePreview, allocPreview) → { verdict, failingChecks[] with reason + fix link kind }` (doc 22 §3.2) |
| `payment-runner.ts` | Decision core: pre-flight verdicts (W0 hold reasons), amount resolution `min(snapshot, Amount Due)`, retry-slot arithmetic over `OrgPaymentPolicy` with a fixed clock, per-row outcome classification (doc 22 §3.6, doc 09 §2.9) |
| `payment-idempotency.ts` | Key derivation (K1/K2/K3 formats, doc 24 §4), the §6 unknown-outcome branch function `(attempt, now, ttl) → branch a/b/c`, body-reconstruction-from-row rule |
| `provider-events.ts` | Webhook reducers: `(event, localState) → { transitions[], rowsToWrite[], sideEffects[], eventDisposition }` for every row of doc 23 §5; ordering/precondition resolution (doc 23 §7); tenancy cross-check verdicts (doc 23 §4.3) |
| `reconciliation.ts` | Detectors D1–D7: `(rows, now, thresholds) → findings[]` with auto-heal vs flag-for-human classification (doc 23 §11) |
| `platform-fee.ts` | Resolution precedence, rail/tier selection, the §6.2 formula, clamps, waiver, re-base under `termsSnapshot`, proportional reversal + residue rule (doc 27) |
| `revenue-allocation.ts` + `ledger.ts` | Set balancing per dimension, largest-remainder splits, residue-to-`SCHOOL_RETAINED_REVENUE`, zero-amount SETTLEMENT sets, journal balance assertions, category resolution catalog (doc 28) |
| `instructor-compensation.ts` | Birth-status matrix `(recognitionEvent, approvalMode, methodType, timingPolicy) → { birthStatus, earnedAtBasis }` (doc 29 §10.2), clawback proportional math capped at family net |
| Refund engine (doc 26) | `refundableRemainder` formula, hybrid allocation math (line-targeted vs proportional), provider-window and dispute-block verdicts, fee-reversal expectation math |
| Minor-units converter | `toMinorUnits(Decimal, currency)` — the single tested converter (doc 13 §2.1); exponent-aware contract even while USD-only |

All money fixtures are Decimal strings with explicit ISO 4217 currency, per [13-database-model.md](./13-database-model.md) §2 — a float anywhere in a payment fixture is itself a review-rejection condition. All time-dependent logic takes `now: Date` as a parameter; tests pass fixed clocks (FX-CLOCK).

### 3.2 Layer 2 — contract tests for engine invariants

Same tooling as Layer 1, but organized around **named invariants** from the design docs rather than around functions: doc 24 I1–I10, doc 26 V1–V17, doc 27 §8.4's enumerated cases, doc 28 L1–L11 + R8/R9, doc 29 §10, doc 22 §7. §9 maps each to its file. The golden scenarios of doc 28 §6 (six worked, balanced postings) ship as fixture files and are asserted digit-for-digit — a change to rounding or residue rules must break a test whose expected values a human already verified by hand.

### 3.3 The deterministic provider fake — `tests/fixtures/fake-provider.ts`

Provider calls sit behind the `PaymentProvider` adapter interface (ADR-032; `src/lib/stripe.ts` implements it in Part 3). The unit and contract layers never construct the real adapter; engines receive the interface as a parameter, so the fake is **plain dependency injection — not `vi.mock`, not a network stub, not a Prisma mock**. The repo's zero-mocking-framework posture is preserved.

`FakePaymentProvider` behavior (deterministic, scripted per test):

1. **Scripted outcomes** keyed by operation + idempotency key: `succeed(pi_fake_0001)`, `declineSync("card_declined", "insufficient_funds")`, `requiresAction()`, `timeout()` (throws after recording the call — the unknown-outcome path), `reject400KeyMismatch()`.
2. **Stripe idempotency semantics enforced**: replaying a key with an identical body returns the recorded original response; replaying a key with a different body throws (mirrors Stripe's key/parameter-mismatch 400) — this is what makes Part AC's "idempotency-key reuse" bullet executable offline.
3. **Full call journal**: every call records `(operation, idempotencyKey, connectedAccountId, minorUnitsAmount, applicationFeeAmount, metadata)` so tests assert *exactly one* charge call, on the right account, with the right fee — not just the final state.
4. **Deterministic ids and clock**: `pi_fake_NNNN`, `re_fake_NNNN`; no `Date.now()` inside the fake.
5. `parseWebhookEvent(signature, raw, endpoint)` verifies against a fixture secret using the same HMAC scheme as Stripe signatures (§7.2), so signature-failure tests are real cryptographic checks, not flag checks.

Simpler-workflow choice: one hand-written fake implementing the real adapter interface, instead of a mocking framework — a failing test prints a call journal a payments engineer can read, and the fake itself is contract-tested against the adapter's TypeScript interface so it cannot drift.

**Honest boundary:** the DB-free layers cannot execute `db.$transaction`, `P2002` unique-violation paths, or true multi-instance races. Those properties are proven by (a) Layer 3 scans that pin the transaction/claim *shape* in source, (b) `tests/schema-governance.test.ts` + schema scans that pin the *constraints* in `prisma/schema.prisma`, and (c) the integration suite executing the real paths against Postgres + Stripe test mode. This plan does **not** introduce a mocked-Prisma or test-database pattern into `npm test` — flagged as a deliberate standards decision in §14 Q2.

### 3.4 Layer 3 — architecture/security scans

Extensions to the existing constitution/schema-governance/security suites plus new payment-specific source scans — enumerated in §5. These are the tests that make Part AB's auto-reject conditions (Stripe call inside a transaction, org-editable platform fee, redirect-marks-paid) *mechanically* unreachable rather than review-dependent.

### 3.5 Layer 4 — the opt-in Stripe test-mode integration suite

Separate directory, separate vitest config, env-gated, excluded from `npm test`, refuses to run against anything but `sk_test_` keys. Full design in §10. It exists because a short honest list of behaviors (§11) cannot be verified offline.

---

## 4. Suites and file layout

Suite IDs used throughout §8.

| ID | File | Layer | Contents |
|---|---|---|---|
| ENG | `tests/payment-engines.test.ts` | 1–2 | Readiness checklist, runner decision core, amount resolution, retry policy, failure classification, unknown-outcome branch function |
| IDM | `tests/payment-idempotency.test.ts` | 1–3 | Key-format pins (I1), TTL branch (I6), body-reconstruction (I3), new-attempt-new-key (I4), **and** the static scans of the approval route / runner / refund engine / webhook routes (I2, §5.2) |
| RED | `tests/webhook-reducers.test.ts` | 1–2 | Every doc 23 §5 handler row through the pure reducer with FX-EVT fixtures; ordering hazards; tenancy quarantine; reconciliation detectors D1–D7 |
| FEE | `tests/platform-fee.test.ts` | 1–2 | The full doc 27 §8.4 case list |
| ALC | `tests/revenue-allocation.test.ts` | 1–2 | Allocation/ledger engines; doc 28 §6 golden scenarios; L1–L11 invariants |
| CMP | `tests/instructor-compensation.test.ts` | 1–2 | Birth matrix, release/clawback math, category-group catalog (doc 29 §12) |
| SEC | `tests/payment-security.test.ts` | 2–3 | RBAC permission-matrix tests over `src/lib/permissions.ts` data (platform-console.test.ts idiom); visibility scoping contracts; fee-write-isolation and payer-surface scans (§5.2); doc 32 additions when it lands |
| CON | `tests/constitution.test.ts` (extended in place) | 3 | `PUBLIC_ROUTES` additions, `authorizePayer` gate extension, auto-coverage of all new routes/events (§5.1) |
| SGV | `tests/schema-governance.test.ts` (extended in place) | 3 | Auto-scan of all doc 34 models; allowlist entries (§5.3); payment-constraint pins (§5.3) |
| INT | `tests-integration/stripe/*.test.ts` | 4 | §10 — excluded from `npm test` by location; own config `vitest.integration.config.ts`; `npm run test:stripe` |

Shared fixture modules: `tests/fixtures/payments.ts` (builders, §6.1), `tests/fixtures/fake-provider.ts` (§3.3), `tests/fixtures/stripe-events/*.json` (§7).

Simpler-workflow choice: seven domain-named files rather than one giant `payments.test.ts` — a Part 3 engineer touching the fee engine runs one file and reads failures scoped to their change; total runtime still targets the existing sub-second budget (all layers 1–3 are in-memory).

---

## 5. Constitution & security suite additions

### 5.1 `tests/constitution.test.ts` — catalog and gate changes

1. **`PUBLIC_ROUTES` additions** (written reasons required by the suite; wording from doc 23 §3.3):
   - `app/api/webhooks/stripe-connect/route.ts` — Stripe Connect events: unauthenticated by nature; signature-verified with `STRIPE_CONNECT_WEBHOOK_SECRET` before any side effect; rate-limited; inert unless `REVENUE_CHARGING=test`.
   - `app/api/webhooks/stripe-platform/route.ts` — Stripe platform-account events (application fees): same posture, `STRIPE_PLATFORM_WEBHOOK_SECRET`.
2. **Gate regex extension**: the walker's authorization regex gains `authorizePayer` (the doc 01 §11 payer-portal gate for `/api/payer/*`): `/\b(authorize|authorizePlatform|authorizeFounder|authorizePayer)\(/`. Without this, every payer route would false-fail the walker or require miscataloguing as self-service. This is a deliberate, reviewed edit to the constitution suite, made in the same PR that introduces `authorizePayer`.
3. **Auto-coverage that needs no edit** (verified, not assumed): every new org route (`/api/revenue/payment-runs`, `/api/revenue/reconciliation-runs`, refund/dispute/compensation routes) is walked and must call `authorize()`; every new mutating platform route (`/api/platform/fee-agreements`, `/api/platform/payments/*`) must pass `{ mutating: true }`; org-targeting platform fee-agreement routes join the `ORG_TARGETING` restricted-scope list; new domain events (`payment.succeeded`, `payment.failed`, `payment.refunded`, `dispute.opened`, `dispute.closed`) must have live emit sites once registered.

### 5.2 New static source scans (dispatch-idempotency idiom; hosted in IDM and SEC)

| # | Scan | Asserts (regex over source) | Verifies |
|---|---|---|---|
| S1 | Approval route/engine | Interactive `$transaction(async (tx)`; guarded `updateMany` claiming the review status **with** `updatedAt` token and `expectedTotal`; `.count === 0` abort; **no** bare `revenueReview.update({ where: { id } })` inside the tx | doc 22 §3.4, doc 24 L2 |
| S2 | Payment runner | `PaymentAttempt` insert (with `idempotencyKey`) occurs inside a `$transaction` that **precedes** any adapter call; no `createCharge(`/`createRefund(` token inside any `$transaction` callback in `src/lib/payment-runner.ts`, the refund engine, or `src/lib/provider-events.ts` | doc 24 I2, spec Parts S/AB |
| S3 | Webhook routes | First statements: `rateLimit(` with `clientIp(`; raw body via `req.text()`; `parseWebhookEvent(` appears **before** any `db.` or `req.json()` token | doc 23 §3.3, §14.1 |
| S4 | Fee-write isolation | No file under `src/app/api/` outside `api/platform/**` contains `platformFeePolicy.` or `platformFeeTier.` write calls (`create`/`update`/`delete`/`upsert`) | doc 27 §8.4; Part AB "platform fee editable by org staff" |
| S5 | Payer/student surface blindness | Route files under the payer/student self-service surfaces never reference `platformFee`, `platformFeePolicy`, `ledgerEntry`, `revenueAllocation`, or `instructorEarning` selects | doc 27 §6.6, doc 29 §11, doc 30 |
| S6 | Ledger/allocation append-only | No `ledgerEntry.update`/`.delete`/`.deleteMany` and no `revenueAllocation.update`/`.delete` call sites anywhere in `src/` | doc 28 L1 |
| S7 | Settled money never edited | No `payment.update(` in the refund/dispute/void engines | doc 26 V5 |
| S8 | Redirect never marks paid | The doc 21 return-route source contains no attempt/payment success-transition tokens (`SUCCEEDED`, `payment.create`, review paid statuses) | doc 23 §8, Part AB |
| S9 | Runner claim shape | `ScheduledCharge` claim is a guarded `updateMany` from `SCHEDULED\|AWAITING_MANUAL\|FAILED` with `.count === 0` skip; no status-less `scheduledCharge.update({ where: { id } })` | doc 22 §3.6 W1, doc 24 L3 |

Scans are deliberately coarse (regex, not AST): they pin the *shape* that code review agreed on, exactly like the dispatch-close precedent, and fail loudly on regression to the racy form.

### 5.3 `tests/schema-governance.test.ts` — auto-coverage and pins

- **Automatic** (no edit needed): every doc 34 model with `organizationId` is scanned for the real `Organization` relation, explicit `onDelete`, and tenant-scoped uniques.
- **Allowlist entries** (with written reasons, per doc 34 §13 Q3): the raw-SQL partial uniques (`ScheduledCharge` ×3 per R-P9, `FinancialHold_active_key`); `PlatformFeeTier` carrying no `organizationId` (platform-owned child, like `SubscriptionPlan`); the three cross-org indexes (`PaymentAttempt [status, actionExpiresAt]`, `PaymentProviderEvent [processingStatus, receivedAt]`, `ConnectedAccount [status, lastStatusSyncAt]`) — platform-runner surfaces behind `authorizePlatform`.
- **Payment-constraint pins** (new assertions over `prisma/schema.prisma` text, same technique as the existing scan): `PaymentAttempt.idempotencyKey @unique`; `@@unique([provider, providerPaymentIntentId])`; `@@unique([scheduledChargeId, attemptNumber])`; `Payment.paymentAttemptId @unique`; `PaymentProviderEvent @@unique([provider, providerEventId])`; `Refund.adjustmentId @unique`; `PlatformFee.revenueReviewId @unique`; `Dispute @@unique([provider, providerDisputeId])`; `ConnectedAccount.organizationId @unique` + `@@unique([provider, providerAccountId])`; the migration SQL for the R-P9/FinancialHold partial uniques exists. These pins are the DB-free suite's proxy for constraints it cannot execute — deleting a duplicate-prevention constraint fails CI even before the integration suite runs.

### 5.4 Env and secrets hygiene

- A SEC assertion that no file under `tests/` references `process.env.STRIPE` — the unit suite structurally cannot depend on credentials (doc 24 I9; spec Part AC).
- `src/lib/env.ts` contract test: `REVENUE_CHARGING=test` with any of the three Stripe secrets missing → `assertProductionEnv()` throws (doc 23 §3.2); `off` with secrets absent → no throw.

---

## 6. Fixture catalog

### 6.1 In-memory builders — `tests/fixtures/payments.ts` (layers 1–2)

Typed builder functions returning plain objects shaped per [34-part2-database-additions.md](./34-part2-database-additions.md) and [13-database-model.md](./13-database-model.md), cast `as never` at call sites per the `tests/engines.test.ts` idiom. Deterministic ids (`org_a`, `rev_0001`), Decimal strings, fixed dates. Catalog (IDs referenced in §8):

| ID | Fixture family | Variants |
|---|---|---|
| FX-ORG | Organizations | `org_a` (golden-gate-shaped), `org_b` (blue-ridge-shaped) — every cross-tenant test uses both |
| FX-ACC | `ConnectedAccount` | One per status: absent-row (NOT_STARTED), `PENDING`, `REQUIREMENTS_DUE` (chargesEnabled true — the R-P2 gate must pass), `RESTRICTED`, `ENABLED`, `DISABLED`, `SUSPENDED`; plus `ENABLED` with `chargesEnabled=false` (gate must fail) |
| FX-CONSENT | `PaymentConsent` | Valid bound card consent; valid ACH consent with mandate ref; revoked; version-superseded; unbound METHOD_SETUP row (never valid) |
| FX-METH | `PaymentMethodReference` | Active card; expired card; ACH verified (`instant`); ACH verified (`microdeposits`); ACH unverified; `DETACHED`; method owned by the *wrong* `PaymentCustomer` (ownership tests) |
| FX-REV | `RevenueReview` + wrapped `Invoice` | One per doc 03 status (all 16), including: approvable with all ten checks green; each single-check-failing variant; above/below `secondApprovalAmountThreshold`; containing manual items; zero-total; multi-instructor; taxed (with `TaxSnapshot`) |
| FX-CHG | `ScheduledCharge` | `SCHEDULED` due / not due; `AWAITING_MANUAL` with each W0 hold reason; `PROCESSING`; `FAILED` (retries remaining / exhausted / resting past `escalationDays`); `COMPLETED`; `CANCELLED`; supplementary (`adjustmentId` set) |
| FX-ATT | `PaymentAttempt` | `CREATED` fresh / stale 30 min / stale past 24 h TTL; `PROCESSING` card / ACH (day 2, day 6); `REQUIRES_ACTION` fresh / past `actionExpiresAt`; `FAILED` soft / hard decline; `SUCCEEDED` with `Payment` |
| FX-PAY | Settled money | Settled card `Payment` (+fee true-up recorded / unrecorded); settled ACH; partially refunded; fully refunded; disputed (`OPEN`), dispute `LOST`; `PROVIDER_RETURN` refund |
| FX-FEEPOL | `PlatformFeePolicy` (+tiers) | Percentage; flat; combined; ACH-rail override; volume tiers (with MTD volumes at/below/above each boundary); `INTRODUCTORY` expiring window; `NEGOTIATED` org scope; `WAIVER`; no-policy-resolves (F1); min/max clamp cases |
| FX-RATE-HIST | Historical versions | Rate profiles and fee-policy versions superseded *after* the review's approval — every snapshot test asserts the engine read the snapshot, not the current version |
| FX-EARN | `InstructorEarning` | Born `APPROVED`/`PENDING`/`HELD` per policy matrix; released with `earnedAt`; reversal family (partial and net-zero); `EXPORTED` |
| FX-EVT | Provider events | §7 — canned Stripe event JSON |
| FX-CLOCK | Fixed clocks | `T0` (approval), `T0+30min`, `T0+25h` (past key TTL), `T0+4bd` (ACH window), `T0+72h` (action expiry), `T0+escalationDays` |

### 6.2 Seed extensions — `prisma/seed.ts` (integration suite + manual verification)

Doc 34 §11.3 already binds the seed fixture set; this plan adopts it and confirms the conventions: both demo orgs (`golden-gate`, `blue-ridge`) get every fixture family; `demo1234` logins untouched; deterministic helper style (`day(offset)`); TRUNCATE-CASCADE reachability preserved (all new models FK an existing root). Test-relevant emphases on top of doc 34's table:

- **Multi-org duplication**: every payment fixture exists in *both* orgs so cross-tenant probes (§8 row 20) always have a same-shaped foreign target.
- **Connected accounts in each status**: `golden-gate` `ENABLED`+charges-enabled; `blue-ridge` `REQUIREMENTS_DUE` with a past-due variant flipping `RESTRICTED` (doc 34).
- **Consent records**: valid, revoked, superseded, micro-deposit ACH — proving the `chargeable()` derivation renders correctly in-app.
- **Methods per rail**: active card, expired card, verified ACH, unverified ACH, detached — one payer holds two methods (default-selection tests).
- **Reviews in each status**: at least one review per doc 03 status across the two orgs, including `PAYMENT_FAILED` with retries exhausted and an escalation `FinancialHold`.
- **Failed/refunded/disputed payments**: per doc 34 §11.3 (partial refund with full reversal chain; `PROVIDER_RETURN`; open dispute with evidence + near deadline; lost dispute with fee true-up and a `KEPT` compensation decision).
- **Historical rates**: superseded `AircraftPricingProfile`/Instructor Rate Profile/fee-policy versions dated before seeded approvals — the seeded snapshots must visibly differ from current versions so any "recomputed from current rates" bug shows up on the demo dashboard itself.

Seed data is **never** read by layers 1–3 (they are DB-free); it exists for the integration suite, running-app verification, and honest demos.

---

## 7. Webhook-event fixture strategy

### 7.1 Canned payloads — `tests/fixtures/stripe-events/*.json`

One JSON file per event shape used in doc 23 §5, captured once from Stripe **test mode** during Part 3 bring-up (or transcribed from Stripe's documented schemas until then), then frozen: deterministic ids (`evt_fix_0001`, `pi_fix_0001`, `acct_fix_org_a`), fixed `created` timestamps, `livemode: false`, `api_version` pinned. Minimum set:

`payment_intent.processing` (card, ACH) · `payment_intent.succeeded` (card, ACH) · `payment_intent.payment_failed` (soft decline, hard decline, `authentication_required`, ACH `R01`) · `payment_intent.requires_action` · `payment_intent.canceled` · `charge.refunded` / `charge.refund.updated` (succeeded, failed) · `charge.dispute.created` / `.updated` / `.closed` (won, lost, warning_closed) / `.funds_withdrawn` · `payment_method.detached` / `.automatically_updated` · `setup_intent.succeeded` / `.setup_failed` · `account.updated` (enabled → restricted, restricted → enabled) · `capability.updated` · `account.application.deauthorized` · `payout.paid` / `.failed` · `application_fee.refunded` · an unhandled type (`product.created`) for the IGNORED path · a `livemode: true` variant for the quarantine guard.

Amounts in event fixtures deliberately **disagree** with local snapshots in the mismatch variants (`*-amount-mismatch.json`) — proving the "amounts from snapshots, never from events" rule (doc 23 §5) opens `AMOUNT_MISMATCH` instead of writing.

### 7.2 Signatures — real HMAC, no network, no Stripe CLI dependency

Signed-payload cases compute genuine `Stripe-Signature` headers (`t=<ts>,v1=<hmac-sha256>`) over the exact raw fixture bytes with a fixture secret (`whsec_test_fixture_...`), via a tiny helper in `tests/fixtures/`. `parseWebhookEvent` (fake in layers 1–2; real `stripe.webhooks.constructEvent` in the integration suite, where the CLI secret is used) verifies them cryptographically. Simpler-workflow choice: precomputed HMAC with a fixture secret instead of requiring the Stripe CLI in unit CI — the unit suite stays dependency-free and offline; the CLI is exercised only in the integration suite.

**Signature-failure cases** (each → 400, nothing stored, structured log without body content):

| Case | Fixture |
|---|---|
| Wrong secret | Valid header signed with a different secret |
| Tampered body | Valid header, one byte of the payload changed after signing |
| Stale timestamp | Valid signature with `t` older than the 300 s tolerance (fixed clock) |
| Missing header | No `Stripe-Signature` at all |
| Malformed header | `v1` missing / garbage |

### 7.3 Replay cases

- Same `evt_` delivered twice, second after successful reduce → recorded no-op, 200 (unique-insert + `processedAt`).
- Same `evt_` delivered twice, first reduce **failed** (`RETRYING`) → redelivery re-runs the reduce against the stored row.
- Same underlying change as two event types (`charge.refunded` + `charge.refund.updated`) → one guarded claim wins, second is a no-op.
- Same event replayed through the **sweep** and a redelivery concurrently (pure-reducer level: both compute the same transition; applier-level single-winner is a schema/claim property pinned by §5.2-S9/§5.3 and executed in INT).

### 7.4 Out-of-order cases

- `payment_intent.succeeded` before `payment_intent.processing` → stale `.processing` is a convergent no-op.
- `charge.refund.updated` while the attempt is still `PROCESSING` → precondition unmet → provider re-fetch (fake scripted: intent says succeeded) → settlement reduce runs first, then refund reduce — one code path, asserted via the reducers' plan output ordering.
- `charge.dispute.updated` before `.created` → upsert-by-provider-id from the re-fetched object; later `.created` no-ops.
- `account.updated` v2 then v1 (reversed `created` timestamps) → payload never applied; both trigger re-fetch; `providerStateAsOf`/`lastStatusSyncAt` monotonic guard makes the stale sync a no-op.
- Event for an unknown `acct_` → `QUARANTINED (UNKNOWN_CONNECTED_ACCOUNT)`; event whose `acct_` resolves to org A but whose anchor row belongs to org B → `QUARANTINED (TENANT_MISMATCH)`, nothing partially applied.

---

## 8. The Part AC test matrix (complete — every spec bullet)

Suites per §4. Fixtures per §6/§7. "Verifies" names the binding design section. Where a bullet needs both an offline proof and a real-provider proof, both rows' suites are listed; the INT entry never substitutes for the offline one.

| # | Part AC bullet | Test name | Suite | Fixtures | Setup | Assertion | Verifies |
|---|---|---|---|---|---|---|---|
| 1 | Approval creates one payment request | `approval plan contains exactly one ScheduledCharge (outbox) with frozen amount/policy/runAfter` | ENG; S1 (IDM); INT | FX-REV approvable, FX-FEEPOL, FX-CLOCK | Run the approval engine's plan builder on an all-checks-green review | Plan has exactly one `ScheduledCharge` insert, `amount` = frozen invoice total, `runAfter` from policy in org timeZone, created for **every** timing policy incl. `MANUAL_INVOICE`; zero-total → born `COMPLETED`. INT: POST approve → one row |
| 2 | Duplicate approval does not duplicate payment | `second approval claim loses: guarded claim + structural uniques` | S1 (IDM); SGV pins; INT | FX-REV, `prisma/schema.prisma` | Scan approval route for the claim shape; pin `ScheduledCharge` partial uniques; INT: two concurrent/serial POSTs | Route: guarded `updateMany` + `updatedAt` token + `expectedTotal`, `.count === 0` → 409; schema: one original anchor per review/invoice; INT: one 200, one 409, exactly one `ScheduledCharge`, one PaymentIntent | 22 §3.4/§3.7; 24 L2 |
| 3 | Idempotency-key reuse | `key formats pinned; same-key+same-body replays original; same-key+different-body rejected; retry mints new key` | IDM | FX-ATT, FakeProvider, FX-CLOCK | Derive keys from fixture rows; replay `createCharge` against the fake with identical and altered bodies | `sc_<id>_a<n>` / `rf_<id>` / `cust_<org>_<party>_<id>` exact (I1); identical replay returns the original `pi_` (one charge in the journal); altered body throws key-mismatch; attempt N+1 gets `_a<n+1>` (I4); TTL branch: <24 h → replay, ≥24 h → metadata search, never blind re-send (I6) | 24 §4, §6, I1–I6 |
| 4 | Card success | `payment_intent.succeeded reduces to the full settlement plan` | RED; ALC; INT | FX-EVT succeeded(card), FX-ATT PROCESSING, FX-PAY, FX-FEEPOL | Feed event + local state to the reducer | Transitions: attempt→`SUCCEEDED`, `Payment` create (1:1), charge→`COMPLETED`, `PlatformFee ACCRUED→EARNED` (+`earnedAt`), review→`CARD_PAID`, invoice→`PAID`; balanced settlement journal (28 §6.1 golden digits); receipt notification + `payment.succeeded` in post-commit side-effect list only | 23 §5; 22 W4; 28 §6.1 |
| 5 | Card decline | `synchronous decline → FAILED with safe code; hard declines never auto-retried` | ENG; RED | FX-ATT, FakeProvider `declineSync`, FX-EVT payment_failed | Runner W3 outcome classification + reducer on the failure event | Attempt `FAILED` with mapped safe `failureCode` (raw provider message never in the payer-facing output); charge `FAILED`, review `PAYMENT_FAILED`; hard-decline family (`stolen_card`, `invalid_account`, ACH R02/R03/R04) → no auto-retry slot, method `SUSPENDED`; soft decline → retry slots per policy | 22 W3; 24 L10; 25 |
| 6 | Requires-action path | `requires_action holds the attempt; expiry sweeps; off-session SCA never auto-retried` | RED; ENG | FX-EVT requires_action, FX-ATT REQUIRES_ACTION fresh/expired, FX-CLOCK | Reduce the event; run the expiry-sweep selector at `T0+72h` | Attempt →`REQUIRES_ACTION` with `requiresActionAt`/`actionExpiresAt = +72h`; blocks void/offline/parallel attempts (in-flight set); expiry selector picks only past-`actionExpiresAt` rows; `authentication_required` sync failure → `FAILED`, payer routed on-session, no auto-retry | 21; 34 §5.1; 22 §9 |
| 7 | ACH pending | `processing(us_bank_account) → ACH_PENDING; nothing is paid; offline recording refused` | RED; S-interlock (ENG) | FX-EVT processing(ACH), FX-ATT | Reduce; then evaluate the offline-recording guard with an in-flight attempt | Review →`ACH_PENDING` (never any paid status from `.processing`); expected-window surfaced; offline-payment verdict = 409 while attempt `CREATED`/`PROCESSING` | 23 §5/§14.7; 24 L11; 09 §2.5 |
| 8 | ACH success | `ACH settlement pays exactly once, earns the fee, true-up posts actuals` | RED; ALC | FX-EVT succeeded(ACH), FX-PAY | Reduce settlement, then the fee true-up claim plan | Review →`PAID` (no `CARD_PAID` for ACH); `Payment` created; fee `EARNED`; 28 §6.2 golden journal (J2′/J3′/S2′) digit-exact; true-up guarded by `providerFeeRecordedAt IS NULL` — second pass is a no-op | 21; 28 §6.2, L9–L10 |
| 9 | ACH return | `pre-settlement return fails the attempt; post-settlement return arrives dispute-shaped and reverses net-capped` | RED; CMP; FEE | FX-EVT payment_failed(R-code), dispute-shaped return, FX-PAY refunded-then-returned | Reduce both variants; include a prior partial refund in the second | Pre-settlement: attempt `FAILED` + return code, review `PAYMENT_FAILED`, `HELD` earnings stay `HELD`; post-settlement: unchallengeable dispute (`evidenceDueBy` null), reversal computed against **net** remaining, overshoot opens `AMOUNT_MISMATCH` (never negative books); `PlatformFee EARNED→ACCRUED` revert | 26 §3.3.6; 27 §4.7; 29 §6.5 |
| 10 | Webhook replay | `duplicate delivery is a recorded no-op; failed reduce is retried; stale transitions converge` | RED; SGV pin; INT | FX-EVT replay set (§7.3) | Reduce the same event twice; once after a scripted reduce failure | Second reduce yields zero transitions (guarded claims), disposition `PROCESSED` no-op; `RETRYING` row re-runs to completion; schema pin: `@@unique([provider, providerEventId])`; INT: Stripe CLI re-delivery → one settlement | 23 §4, §7; 24 L5–L6 |
| 11 | Invalid webhook signature | `bad signatures die before any side effect` | RED (signature helper); S3 (IDM); INT | §7.2 failure set | Run `parseWebhookEvent` on all five failure cases; scan route source | Every case throws; route contract: 400, nothing stored, log carries no body content; scan: verification precedes `req.json()`/`db.`; INT: CLI with wrong secret → 400 | 23 §3.3, §14.1 |
| 12 | Connected-account mismatch | `tenant mismatch quarantines the whole event` | RED | FX-EVT tenant-mismatch, unknown-account (§7.4) | Reduce events whose `account` and local anchor disagree | Disposition `QUARANTINED` (`TENANT_MISMATCH` / `UNKNOWN_CONNECTED_ACCOUNT`); zero transitions, zero rows written; `ReconciliationException(QUARANTINED_EVENT)` + platform alert in the plan; `organizationId` taken only from the local row | 23 §4.3; 24 metadata contract |
| 13 | Payment-method ownership | `a method not owned by the paying party never charges` | ENG; SEC | FX-METH wrong-customer, FX-REV, FX-CONSENT | Readiness check 5 and runner W0 with a method whose `PaymentCustomer` ≠ the review's payer | Readiness fails with the ownership reason; W0 → `AWAITING_MANUAL (method_detached/ownership)` and **no attempt row**; method-list scoping contract: payer surface returns only own customer's methods; consent must reference the same method + party | 20; 22 §3.2 check 5, W0 |
| 14 | Responsible payer access | `payer portal sees own money only — and never internals` | SEC; S5; CON | FX-ORG, FX-REV per payer | Payer-scope contract over the doc 11 resolution + route catalog checks | Payer A's queries return only reviews/receipts/methods where A is the responsible payer (or self-pay student); payer surfaces never select platform fee/allocations/compensation (S5 scan); `/api/payer/*` gates via `authorizePayer` (CON) | 11; 27 §6.6; 30 |
| 15 | Platform fee calculation | `every commercial model computes exactly` | FEE | FX-FEEPOL all variants, FX-CLOCK | The doc 27 §8.4 case list through `src/lib/platform-fee.ts` | Percentage/flat/combined/per-rail/tier/introductory/negotiated/waiver each exact; clamps, cap-over-min (`fee ≤ invoice.total`), zero-total, no-policy → $0 + `policyId null` (F1); tier boundary exactly-at-threshold; rail fallback (ACH null → card terms); re-base under `termsSnapshot` never re-resolves; rounding half-up; proportional reversal + final-refund residue → effective fee exactly 0 | 27 §3, §6.2, §8.4 |
| 16 | Revenue allocation balancing | `every set balances per dimension; residue lands in school-retained; journals balance` | ALC | 28 §6 golden fixtures | All six worked scenarios + property-style odd-cent cases through the allocation/ledger engines | Each dimension sums to the set amount; zero-amount SETTLEMENT sets valid with empty REVENUE dimension; largest-remainder splits sum exactly; rounding residue only in `SCHOOL_RETAINED_REVENUE`; Σ debits = Σ credits, one currency, amounts > 0; engine `post()` asserts balance pre-insert (imbalance throws) | 28 §4–§6, L2/V12 |
| 17 | Refund reversal | `remainder-capped, snapshot-based, fully reversed in one plan` | ENG (remainder); RED; ALC; FEE | FX-PAY refunded set, FX-EVT charge.refunded, 26 §3.2.4 worked example | Remainder formula over prior refunds/disputes; reduce the refund settlement | Remainder counts `PENDING/PROCESSING/SUCCEEDED` refunds + `LOST` disputes; over-cap → 422 with computed remainder; hybrid math: line-targeted mirrors selected lines + snapshotted tax, proportional matches the −200.00 worked example digit-exact; settlement plan contains reversal `TaxSnapshot` + signed REFUND set + reversing journal + fee reversal + review status in **one** transaction plan; `rf_<refundId>` key; `adjustmentId @unique` pinned (SGV) | 26 §3.2; 24 L8; 07 §2.6 |
| 18 | Dispute record | `webhook-only dispute lifecycle with lost-dispute settlement contract` | RED; ALC | FX-EVT dispute set (§7.1) | Reduce created/updated/closed(won/lost) in order and out of order | `.created` upserts `Dispute OPEN` with amount/reason/`evidenceDueBy`, review →`DISPUTED`; won → reinstatement journal, review →`PAID`; lost → chargeback contract: **no Refund row**, DISPUTE allocation set (`sourceType: "Dispute"`), tax reversal, fee reversal per snapshot, review terminal; dispute-fee true-up exactly-once via `disputeFeeRecordedAt` claim (second pass no-op); refunds blocked while `OPEN`/`UNDER_REVIEW` | 26 §3.3; 28 §6.5 |
| 19 | Instructor compensation creation | `birth matrix exact; held releases on full settlement; clawback capped` | CMP; RED | FX-EARN, FX-REV, FX-EVT succeeded | Full (recognitionEvent × approvalMode × methodType × timingPolicy) matrix; settlement reduce with `HELD` rows; clawback proposals | Birth status/`earnedAt` basis per doc 29 §4.2 table, all combinations; `LESSON_COMPLETION` dates `earnedAt` = service date; settlement releases `HELD→APPROVED/PENDING` only at Amount Due = 0 (partial collection never releases); clawback proportional, largest-remainder, capped at family net; voids always auto-reverse; self-approval refused | 29 §4.2, §5, §6 |
| 20 | Tenant isolation | `no payment row crosses an org boundary` | SEC; SGV; RED; CON; INT | FX-ORG both orgs, full FX families ×2 | Cross-tenant contract probes on every payment engine lookup; schema auto-scan; reducer tenancy tests (row 12) | Org B ids through org A-scoped engine calls → not-found verdicts (404 at routes); every doc 34 model passes org FK/onDelete/tenant-unique auto-scan; webhook tenancy from local references only; platform cross-org routes enforce `restrictedOrgIds` (CON); INT: authenticated org B session GETs org A review/refund → 404 | 13; 23 §4.3; 34 |
| 21 | Student visibility restrictions | `students and payers never see fees, allocations, ledger, compensation, or other people` | SEC; S5 | FX-ORG, FX-EARN, FX-PAY | Role-scoped serializer/query contracts (role-visibility idiom) + surface scans | Student/payer payloads contain no `PlatformFee`, allocation, ledger, compensation, or dispute-internal fields; instructor with `revenue.compensation_view_own` requesting another instructor's earnings → 404, list returns own rows only; receipts show school lines only | 27 §6.6; 29 §11; 30 |
| 22 | Operations approval | `the readiness checklist gates the control truthfully` | ENG | FX-REV single-check-failing variants, FX-ACC, FX-CONSENT | Evaluate readiness on each variant | Each of the ten checks fails alone with its actionable reason (all failing reasons returned at once, not first-only); all-green → enabled with the exact consequence label variant; `approveWithoutMethod WARN` swaps to the truthful manual-invoice label, `BLOCK` disables; verdict without reasons is a test failure | 22 §3.2–§3.3; 03 §2.6 |
| 23 | Unauthorized refund | `refund mutations demand the right keys, separated humans` | SEC | Permission-matrix data, FX-REV collected | Permission-matrix contracts over `src/lib/permissions.ts` + engine separation-of-duties checks | Request needs `revenue.refund`; approve needs `revenue.refund_approve`; approver ≠ requester; second approver ∉ {requester, approver} (`secondApprovalForRefunds` default true); dispatcher/instructor bundles hold neither key; read-only impersonation refused (`{mutating:true}`); sole-approver relaxation is audit-flagged, never silent | 26 §7; 03 D17/D18 |
| 24 | High-value second approval | `totals above the threshold require an active SECOND approval by a different human` | ENG | FX-REV above/below threshold, `RevenueWorkflowPolicy` | Readiness check 3 with `secondApprovalAmountThreshold` set | Above threshold without an active (`supersededAt IS NULL`) SECOND approval row → not approvable, reason names the threshold; SECOND approver must differ from OPERATIONS approver; below threshold → no SECOND required; superseded approvals don't count | 03 §2.7; 22 check 3 |
| 25 | Manual item second approval | `manual reviews / manual line items trigger the second-approval requirement` | ENG | FX-REV containing manual items | Readiness check 3 on a review with manual (non-dispatch-derived) items per `RevenueWorkflowPolicy` | Manual-item review requires the SECOND approval kind regardless of amount (per doc 03's manual-review rules); the failing reason names the manual items; satisfied by an active SECOND row from a distinct approver | 03 §2.7–2.8; 22 check 3 |
| 26 | Failed-payment retry | `retry is a new attempt with a new key; in-flight blocks; policy governs timing; escalation fires once` | ENG; IDM; RED | FX-CHG FAILED variants, FX-ATT, `OrgPaymentPolicy`, FX-CLOCK | Retry-slot computation across `retryMode`/`maxAutoRetries`/`autoRetryDelaysDays`; retry against in-flight and terminal attempts; discount applied between attempts | Retry requires a terminal previous attempt (in-flight → 409 verdict, stuck-attempt rule); new attempt = `attemptNumber+1` + fresh key, amount re-resolved (lower after APPLIED discount — I4); `MANUAL_ONLY` produces no auto slots; slots at 1/3/7 days with the fixed clock; hard declines excluded; after retries exhaust + `escalationDays`, escalation claim fires exactly once (`failureEscalatedAt` guard) and `autoHoldAfterEscalation` plans one `POLICY_ESCALATION` `FinancialHold` (partial unique pinned in SGV) | 24 L10, I4; 25; 22 §3.6; 34 §5.2 |

Row 1's Verifies column: doc 22 §3.4 step 9, §3.5; 24 L2. (Stated here because the table cell was elided.)

---

## 9. Engine-invariant contract coverage map

Every invariant a sibling doc declared "contract-tested" — with its suite, so none is orphaned:

| Owning doc | Invariants | Suite |
|---|---|---|
| [22-approval-to-payment.md](./22-approval-to-payment.md) §7 | Server-resolved amounts (never client-supplied); currency equality across the document chain; consent checked at readiness **and** W0; offline-payment interlocks; write-once snapshot fields; every gating transition is a guarded claim | ENG + S1/S2/S9 |
| [24-idempotency.md](./24-idempotency.md) I1–I10 | Key formats frozen (I1); row-before-call scan (I2); body-from-row replay (I3); new-attempt-new-key incl. changed-amount case (I4); no synthesized failure (I5 — protocol tests); TTL branch with fixed clock (I6); reduce+stamp one tx / forward-only (I7 — reducer plans put the stamp in the same plan); actionable 409 messages (I8 — message catalog test); no-DB/no-credentials (I9 — this plan's structure); resolution notes required (I10) | IDM + RED |
| [26-refunds-voids-disputes.md](./26-refunds-voids-disputes.md) V1–V17 | Void matrix incl. in-tx verification; snapshot survives void; remainder math (V4); `payment.update` ban (V5 — S7 scan); one-transaction reversal contract (V6 — plan completeness assertion); provider-window hard block with credit fallback (V11); balanced reversal sets (V12); net-capped lost-dispute reversal (V13); fee-reversal parity expectation (V14); reversal-row requirements (V15); `REVENUE_CHARGING=off` degradation (V17) | ENG/RED/ALC/FEE + S7 |
| [27-platform-fee.md](./27-platform-fee.md) §8.4 | Full case list (§8 row 15) + fee-write isolation scan (S4) + payer blindness scan (S5) + `PlatformFeeTier` governance entry | FEE + SEC/SGV |
| [28-revenue-allocation-ledger.md](./28-revenue-allocation-ledger.md) L1–L11, R8–R9 | Append-only scans (S6); balance rules; explicit currency; fee actuals never estimated (engine has no estimate input — type-level + test); exactly-once true-up claims; zero-amount-row filter | ALC + S6 |
| [29-instructor-compensation.md](./29-instructor-compensation.md) §10 | Birth matrix (10.2); `earnedAt` written once; reversal family rules incl. net ≥ 0; release requires Amount Due = 0; self-approval refusal; category-group catalog exhaustive over the enum | CMP |
| [23-webhooks-and-reconciliation.md](./23-webhooks-and-reconciliation.md) §14 | Verify-before-everything (S3); store-then-process (reducer precondition: no reduce without a stored-event input); local-references-only tenancy; one-code-path-per-truth-transition (fast-forward path calls the same handler — asserted by identity in the detector tests); `processedAt ⟺ PROCESSED/IGNORED` invariant | RED + S3 |
| [19-connected-account-onboarding.md](./19-connected-account-onboarding.md) / [34](./34-part2-database-additions.md) R-P2 | Charge gate truth table: `chargesEnabled && status ∈ {ENABLED, REQUIREMENTS_DUE}` — all status × flag combinations | ENG |
| [20-payment-methods-and-consent.md](./20-payment-methods-and-consent.md) | `chargeable()` derivation (bound + unrevoked + unsuperseded + version-current) across the FX-CONSENT variants; consent-text hash integrity | ENG |
| [31-notifications.md](./31-notifications.md) | Payment notification planning is covered by the reducers' side-effect plans (receipt, failure, action-required, dispute, held-release rows with correct kind/topic/dedupe key); delivery mechanics are doc 31's own test territory | RED |

---

## 10. The opt-in Stripe test-mode integration suite

### 10.1 Gating and isolation (binding)

- **Location**: `tests-integration/stripe/*.test.ts` — outside `vitest.config.ts`'s `tests/**` include, so `npm test` structurally cannot run it. Own config `vitest.integration.config.ts` (node env, serial execution, 60 s timeouts).
- **Invocation**: `npm run test:stripe` → `vitest run -c vitest.integration.config.ts`.
- **Env gate**: runs only when `STRIPE_TEST_INTEGRATION=1` **and** `REVENUE_CHARGING=test` **and** the three secrets are set; otherwise every suite `describe.skipIf`s with an explanatory skip message (exit 0 — safe to invoke blindly).
- **Live-key refusal**: a `beforeAll` asserts `STRIPE_SECRET_KEY.startsWith("sk_test_")` and aborts hard otherwise; the webhook fixtures assert `livemode === false`. There is no configuration under which this suite touches live mode — consistent with `REVENUE_CHARGING` having no `live` value in this phase (doc 22 §11).
- **Dependencies**: a local Postgres seeded via `npm run seed`, the app on :3100 (`npm start -- -p 3100`), the Stripe CLI forwarding to both webhook routes (`stripe listen --forward-to localhost:3100/api/webhooks/stripe-connect ...`), and a test-mode Connect account per demo org (created by a documented setup script, never by the unit suite).
- **Never in CI's required path** (§12); run manually before payments-slice merges and on the pre-launch checklist.

### 10.2 Planned specs

| Spec | Exercises | Real-provider assertion |
|---|---|---|
| `charge-card.test.ts` | Approve → runner → `pm_card_visa` → CLI-forwarded webhook | Exactly one PaymentIntent on the connected account with `application_fee_amount`; review reaches `CARD_PAID`; `Payment` + fee `EARNED`; settlement journal balances against the real balance transaction |
| `charge-idempotency.test.ts` | Double approval POST; runner re-entry with the stored key; concurrent "Charge now" | One intent per attempt key at Stripe (list by metadata); second approval 409s; replayed key returns the original intent |
| `charge-decline.test.ts` | `pm_card_chargeDeclined`-family test methods | Attempt `FAILED` with Stripe's real decline code mapped to the safe catalog; no retry for hard-decline test cards |
| `charge-3ds.test.ts` | `pm_card_authenticationRequired` off-session | Real `authentication_required` sync failure path; on-session confirm with the 3DS test card completes via webhook only (the return URL never writes state — verified by polling local state) |
| `ach.test.ts` | Stripe test bank accounts (instant-verify success, failure/return numbers) | `processing` → local `ACH_PENDING`; test-mode settlement event → `PAID`; return-coded account → failure with R-code; micro-deposit flow recorded as far as test mode allows |
| `webhook-security.test.ts` | CLI-signed deliveries; wrong-secret replays; duplicate deliveries | 400 on bad signature with nothing stored; duplicate `evt_` → single reduce; `PaymentProviderEvent` unique-insert observed against real Postgres `P2002` |
| `refund-dispute.test.ts` | Refund via the full request→approve→apply→execute pipeline; dispute via Stripe's dispute-trigger test card (`4000000000000259`) | Real `re_` created with `rf_<refundId>` key and `refund_application_fee: true`; reversal contract rows written by the real webhook; dispute lifecycle created→lost drives the chargeback contract; evidence-due data captured |
| `tenant-webhook.test.ts` | Events for org A's account while org B's data is loaded | Tenancy resolution + quarantine behavior against real event envelopes and real DB constraints |
| `reconciliation.test.ts` | Kill the runner between TX A and the provider call (fault injection flag); stop the CLI to drop webhooks | Reconcile-then-proceed resolves the stuck `CREATED` attempt via key replay; the stale-`PROCESSING` detector fetches the intent and fast-forwards through the normal reducer |

Each spec is also the honest rehearsal of §11's undeferrable items. The suite writes to the seeded demo orgs only and ends by asserting `demo1234` logins still work (seed invariant).

---

## 11. What CANNOT be unit-tested — deferred to the integration suite, honestly

The DB-free suite proves logic, plans, shapes, and constraints-as-text. It cannot prove the following; each is assigned to §10.2 (or explicitly out of scope for Part 2 entirely):

1. **Real 3DS/SCA challenges** — the `requires_action` → customer-completes-authentication round trip only exists against Stripe test cards (`charge-3ds.test.ts`). Unit tests cover the state machine around it, never the challenge itself.
2. **Real ACH micro-deposits** — deposit timing, verification success/failure against Stripe's test bank accounts (`ach.test.ts`). Test mode itself compresses timing; true multi-day NACHA behavior is only observable in a live pilot and is explicitly not exercised in this phase.
3. **Stripe's idempotency-key retention semantics** (~24 h TTL, key/parameter-mismatch 400s) — the fake mirrors the documented contract; only `charge-idempotency.test.ts` observes the real one. The TTL *expiry* branch is effectively untestable even there (nobody waits 24 h in a test run) — it is covered by the fixed-clock branch-function unit test plus the metadata-search fallback exercised with a fresh key.
4. **Webhook delivery mechanics** — Stripe's retry/backoff cadence, endpoint disablement on sustained failure, and event-list backfill against a real gap (`webhook-security.test.ts`, `reconciliation.test.ts` partially; endpoint-disable behavior is observed, not induced, and the runbook documents it).
5. **Signature verification against Stripe-generated signatures** — unit tests verify our HMAC math against fixture secrets; the CLI-forwarded suite verifies interop with Stripe's actual signer.
6. **Database-enforced exactly-once** — `P2002` on the uniques, partial-unique behavior, guarded `updateMany` under real concurrency (two processes racing a claim). Unit layers pin the shapes (§5.2/§5.3); only Postgres executes them (`charge-idempotency.test.ts`, `webhook-security.test.ts`).
7. **Actual processor-fee amounts** — balance-transaction fees are Stripe facts; L9 forbids estimating them, so no unit fixture can claim to verify the numbers, only the posting math around a given fee (`charge-card.test.ts` asserts against the real fee).
8. **Connect Express onboarding** — the hosted onboarding flow and real `account.updated` requirement transitions (doc 19). The integration suite observes status sync on a pre-provisioned test account; creating accounts is a documented manual setup step, not a test.
9. **Dispute lifecycle timing** — real dispute state progression via the dispute test card; evidence submission remains a Stripe-dashboard action in Part 2 (doc 26 §3.3.3) and is not automated in any suite.
10. **Multi-instance behavior of the in-memory rate limiter and event bus** — documented single-node posture (doc 23 §17); correctness does not depend on them (constraints do), so no suite simulates multi-instance; revisit with the Part 3 Redis swap.
11. **Live mode, real money, real email** — not tested anywhere, in any phase of Part 2, by design. `REVENUE_CHARGING` has no `live` value; the livemode-quarantine unit test (FX-EVT `livemode: true`) is the guard's only rehearsal.

---

## 12. CI expectations

| Suite | When it runs | Requirement |
|---|---|---|
| Layers 1–3 (ENG, IDM, RED, FEE, ALC, CMP, SEC, CON, SGV — everything under `tests/`) | Every `npm test`; before every commit; CI-required | Green, no credentials, no DB, no network; total suite stays within the repo's sub-second-order budget (CLAUDE.md §8). A payment PR that adds an engine without its contract test fails review by policy; a PR that adds a route without a catalog entry fails CON mechanically |
| `npm run build` | Every commit | Green (lint + types) — unchanged house rule |
| INT (`tests-integration/stripe`) | Manual/opt-in: before merging each Part 3 payments slice, on the pre-launch checklist, and optionally as a non-blocking scheduled job once secrets management for CI is decided | **Never** in the required CI path; never a substitute for the offline rows in §8; skip-clean when unconfigured; `sk_test_` only |
| Running-app verification | Per CLAUDE.md §8 at implementation time (real requests incl. denial and cross-tenant paths, Playwright for UI) | Part 3 slice obligation; this plan's SEC/CON rows define which denial paths must be exercised |

Rules of engagement (house standards restated for payments): existing tests are fixed by fixing code, not tests, unless a contract truly changed — and payment contracts changing means the owning design doc changed first. New engine → new contract test in the same PR. The §8 matrix is the acceptance checklist for spec Part AC: Part 3 is not done until every row exists and passes.

---

## 13. Out of scope for Part 2 / deferred

- **Implementing any test in this plan** — Part 2 is design only. No Stripe object is created, no charge (test or live) occurs, nothing deploys, no email sends.
- **Load/performance testing** of webhook bursts and runner passes — bounded-pass design (docs 22/23) is the mitigation; measure at pilot volume.
- **Chaos/multi-instance test rigs** — single-node posture documented; Postgres constraints carry correctness.
- **Email-channel tests** — no email adapter exists (Part AA); notification tests assert in-app rows and the "never claim email was sent" rule only.
- **`/api/v1` public-API idempotency-key header tests** — aspirational per API_STANDARDS.md, unrelated to provider-side keys.
- **Live-mode launch verification** — owned by the Part 3 launch review with the approved threat model (doc 32) and legal/accounting sign-off.

---

## 14. Open questions

1. **(Coordination — doc 32)** The security threat assessment (deliverable 17) was not yet in the doc set when this plan was written. Its mandated test additions (abuse cases, forged-webhook variants beyond §7.2, permission-escalation probes) fold into `tests/payment-security.test.ts` and §7's failure fixtures; the doc 32 author should cross-reference this section so neither doc silently owns a gap.
2. **(Testing standards — engineering owner)** `FakePaymentProvider` (§3.3) is the repo's first test double. It is dependency injection against the ADR-032 interface — no mocking framework, no Prisma mock — but it is still a new pattern; confirm acceptance (recommendation: accept, and record the "fakes for provider adapters only; never mock Prisma; never `vi.mock`" rule in the testing standards when Part 3 opens).
3. **(Repo layout — engineering owner)** `tests-integration/` as the home for the gated suite (chosen because `vitest.config.ts` includes `tests/**` — location-based exclusion cannot rot). Alternative: env-conditioned skips inside `tests/`, rejected because a misconfigured env var could silently pull provider tests into `npm test`. Confirm the directory name.
4. **(Constitution — same PR as `authorizePayer`)** §5.1's gate-regex extension is an edit to a machine-enforced constitution test; per house rules it ships in the same PR as the `authorizePayer` gate with the rationale in the test comment. If the payer portal slips beyond the first Part 3 slice, the regex change waits with it.
5. **(CI secrets — ops)** Whether the integration suite ever runs scheduled in CI (needs `sk_test_` secret storage + a dedicated test Connect account) or stays engineer-invoked through the pilot. Recommendation: engineer-invoked until the pilot starts; a scheduled nightly run is a cheap add later.
6. **(Fixture provenance)** Event fixtures are transcribed from Stripe's documented schemas until Part 3 bring-up captures real test-mode payloads; a one-time capture task should replace transcriptions and pin `api_version` — tracked as a Part 3 bring-up checklist item so fixtures never drift from the pinned API version silently.
