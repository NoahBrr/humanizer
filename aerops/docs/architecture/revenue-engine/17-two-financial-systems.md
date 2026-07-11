# Two Financial Systems — AeroOps SaaS Billing vs Revenue Engine Payments

> **Status:** Proposed — Phase 8 Part 2 · **Date:** 2026-07-10 · **Lead roles:** SaaS Revenue Operations Architect; Principal Software Architect at Stripe; Financial Systems Architect · **Part of:** Revenue Engine design set ([README](./README.md))

## 1. Purpose & scope

AeroOps runs two financial systems that both touch Stripe and must never touch each other:

- **System 1 — AeroOps SaaS Billing.** Organizations pay AeroOps for the software. Stripe Billing + hosted Checkout + Customer Portal on the AeroOps platform account. Planned in PRODUCTION.md §13.2 (Phase C); today it is `Organization.subscriptionStatus` / `billingMode` / `planId` + `SubscriptionPlan` rows, informational only.
- **System 2 — Revenue Engine payments.** Students, parents, sponsors, members, and customer businesses pay an aviation organization through AeroOps. Stripe Connect on per-organization connected accounts, designed across docs 01–16 and implemented in Part 2 (test mode only).

This document is the **hard boundary specification** (spec Part N). It makes the "do not mix" list concrete, assigns every piece of state, every env var, every route, every code module, and every Stripe object to exactly one system, and defines the structural guardrails that make cross-contamination hard rather than merely discouraged. ARCHITECTURE.md §13 already states the two-system rule in one paragraph; this doc is its enforceable design.

Scope note for implementers: **System 1 implementation is NOT Part 2 work.** The Revenue Engine (Parts 2–3) builds System 2 only. What Part 2 ships of System 1 is the boundary itself: reserved names, one new model on the System 2 side (`ConnectedAccount`), and the guardrail test. See §12.

## 2. Relationship to Part 1 docs

| Part 1 source | What this doc does with it |
|---|---|
| [00-current-billing-audit.md](./00-current-billing-audit.md) §"billingMode" | Extends: confirms `Organization.billingMode`, `subscriptionStatus`, `planId`, `SubscriptionPlan` are System 1 state and gain no Revenue Engine readers or writers. |
| [01-revenue-engine-architecture.md](./01-revenue-engine-architecture.md) §8, §11 | Extends: the provider-adapter interface (ADR-032) and the `/api/webhooks/stripe-connect` route group are System 2. This doc finalizes the adapter **file path** and env-key names (deferred to Part 2 by doc 09's "route naming finalized in Part 2"); the resulting divergence from doc 01's literal `src/lib/stripe.ts` table entry is recorded in §16, not silently applied. |
| [09-payment-timing-and-collection.md](./09-payment-timing-and-collection.md) §4.6, §5.4 | Extends: `PaymentProviderEvent` stays the System 2 event store, deliberately separate from the planned System 1 `BillingEvent`. Finalizes the System 2 env-key names as `STRIPE_CONNECT_SECRET_KEY` / `STRIPE_CONNECT_WEBHOOK_SECRET` (§7; divergence from doc 09's placeholder names recorded in §16). |
| [12-revenue-allocation-and-reporting.md](./12-revenue-allocation-and-reporting.md) §2 | Extends: `PlatformFee` / `PlatformFeePolicy` remain **the one deliberate bridge** between the systems — a record in the tenant's books whose collection belongs to AeroOps. No second bridge is introduced. |
| [13-database-model.md](./13-database-model.md) | Builds on, unchanged: all System 2 models and enums keep doc 13's exact names. The one NEW model introduced here (`ConnectedAccount`, §9) follows doc 13 conventions; its final shape is bound by [34-part2-database-additions.md](./34-part2-database-additions.md). |
| [16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md) D1 | Consumes: the Connect topology decision (direct charges on connected accounts + `application_fee_amount`) is finalized in the Part O ADR doc, not here; this doc assumes only "per-org connected account" which Part 1 already baked in (docs 01/09/11). |
| ARCHITECTURE.md §13, PRODUCTION.md §13.2, ADR-018 (repo-level, pre-existing) | Honors: System 1's blueprint (Checkout/Portal, `BillingEvent`, `BILLING_ENFORCEMENT`, `/api/webhooks/stripe`) stays exactly as planned there and is deferred to Phase C. |

## 3. The two systems, side by side

| Dimension | System 1 — AeroOps SaaS Billing | System 2 — Revenue Engine payments |
|---|---|---|
| Purpose | Organizations pay AeroOps for the software | Customers pay an aviation organization through AeroOps |
| Direction of money | Tenant → AeroOps | Payer → tenant (school), minus AeroOps application fee |
| Stripe products | Stripe Billing, hosted Checkout, Customer Portal, Subscriptions | Stripe Connect (per-org connected accounts), PaymentIntents, SetupIntents, saved Payment Methods (card + ACH), Refunds, Disputes, Payouts, `application_fee_amount` |
| Stripe API account context | Platform account, **no** `Stripe-Account` header, ever | Platform key **always** with `Stripe-Account: acct_…` (direct charges per D1); the bare platform context is never used for tenant money |
| Merchant of record | AeroOps (for the subscription) | The school (per D1 direct charges); school's name on the payer's statement |
| Stripe Customer objects | One Customer per Organization **on the platform account** (`Organization.stripeCustomerId`, Phase C) | One Customer per payer/student **on the org's connected account** (`PaymentCustomer` rows, doc 13 §4.12) |
| Data models | `Organization` (subscriptionStatus, billingMode, planId; Phase C adds stripeCustomerId, stripeSubscriptionId, currentPeriodEnd, trialEndsAt), `SubscriptionPlan` (+ stripeProductId/stripePriceId in Phase C), `BillingEvent` (Phase C) | All doc-13 models: `ConnectedAccount` (new, §9), `PaymentCustomer`, `PaymentMethodReference`, `ScheduledCharge`, `PaymentAttempt`, `Payment`, `Refund`, `Dispute`, `PaymentProviderEvent`, `PlatformFeePolicy`/`PlatformFee`, `ProviderPayout`, `ReconciliationException`, ledger/allocation models |
| Inbound event store | `BillingEvent` (`stripeEventId @unique`) | `PaymentProviderEvent` (`@@unique([provider, providerEventId])`) — deliberately a separate table (doc 09 §4.6) |
| Webhook endpoint | `/api/webhooks/stripe` — Stripe dashboard config "events on **your** account" | `/api/webhooks/stripe-connect` — Stripe dashboard config "events on **connected** accounts" |
| Webhook signing secret | `STRIPE_WEBHOOK_SECRET` | `STRIPE_CONNECT_WEBHOOK_SECRET` (per-endpoint secrets; sharing is impossible — §7) |
| API key env var | `STRIPE_SECRET_KEY` | `STRIPE_CONNECT_SECRET_KEY` (restricted key recommended — §8.2) |
| Enable/rollback lever | `BILLING_ENFORCEMENT` (`off\|warn\|enforce`, default `off`) | `REVENUE_CHARGING` (`off\|test`, default `off`; no `live` value this phase) |
| Code module | `src/lib/stripe.ts` (Phase C; PRODUCTION.md §13.2) | `src/lib/stripe-connect.ts` (the ADR-032 adapter) + `src/lib/payment-runner.ts` and the doc-01 engine map |
| Route groups | `/api/billing/checkout`, `/api/billing/portal` (Phase C, org-admin authorized), `/api/webhooks/stripe` | `/api/revenue/*`, `/api/dispatch/*` financial hops, `/api/payer/*`, `/api/webhooks/stripe-connect` |
| Tenant-facing UI | Settings → Plan & Billing: plan, subscription status, "Manage subscription" → hosted Customer Portal (Phase C) | Revenue Dashboard, Revenue Review queues, Payment Methods, payer surfaces (Parts 2–3) |
| Platform-facing UI | Platform Console org detail: subscription panel (`platform.billing.view` / `platform.pricing.change`) | Platform Console org detail: Connect status panel (`platform.connect.view`, §10) + platform fee administration (Part W doc) |
| Personas | School Account Owner (pays the bill); AeroOps founder/billing staff | Student/payer (pays the school); dispatcher, instructor, Director of Operations, accountant, owner (school side); AeroOps platform staff (fee policy, Connect console) |
| Who may configure | AeroOps platform staff (pricing/plan); org Account Owner (subscribe/cancel via hosted surfaces) | Org staff via `revenue.*` permissions (policies, methods); platform staff for `PlatformFeePolicy` and account suspension only |
| Build phase | PRODUCTION.md Phase C — **not Revenue Engine work** | Phase 8 Parts 2–3 — this design set |

## 4. How it works

### 4.1 One Stripe platform account, two products

Both systems run on a **single AeroOps Stripe platform account**. Stripe supports Billing and Connect side by side; under D1 direct charges, connected-account funds never enter the platform balance — only application fees do — so the platform balance contains exclusively AeroOps' own money (subscription revenue + earned application fees), which Stripe reporting segments natively. Separate Stripe accounts would double the onboarding, key management, and dashboard surface for zero isolation gain, because the isolation that matters (customers, methods, charges) already lives on per-org connected accounts.

**Simpler-workflow choice:** one platform account with restricted keys per system, instead of two Stripe accounts — one owner login, one KYC, one support relationship; revisit only if AeroOps ever splits legal entities (§16 Q2).

### 4.2 System 1 lifecycle (reference — Phase C, shown to fix the boundary)

1. Org Account Owner opens Settings → Plan & Billing → "Subscribe". Server creates a Checkout Session on the **platform account** with `metadata.organizationId` set server-side from the session (never the client). No DB transaction needed beyond `recordAudit`.
2. **⇢ async** — owner completes hosted Checkout on Stripe. Card data never touches AeroOps (SAQ-A, same posture as System 2).
3. **⇢ async** — Stripe delivers `checkout.session.completed` / `customer.subscription.*` / `invoice.payment_failed` to `/api/webhooks/stripe`: verify signature with `STRIPE_WEBHOOK_SECRET` first → unique-insert `BillingEvent` (`stripeEventId @unique`; duplicate → 200 no-op) → **[TX]** one transaction reduces the event onto `Organization` (stripeCustomerId, stripeSubscriptionId, subscriptionStatus, currentPeriodEnd) + `recordAudit`. **[/TX]**
4. Enforcement is a read-side gate behind `BILLING_ENFORCEMENT` (`off` today). Nothing in System 2 reacts to any of these transitions (§6 rule BR-6).

### 4.3 System 2 lifecycle (owned by docs 03/09 and the other Part 2 docs — shown to fix which objects live where)

1. Revenue Review approval commits in one **[TX]** (doc 03 §2.6): frozen Invoice, snapshots, `ScheduledCharge`, `PlatformFee` ACCRUED. **No provider call inside the transaction.** **[/TX]**
2. Post-commit, `src/lib/payment-runner.ts` claims the `ScheduledCharge` (guarded `updateMany`), appends a `PaymentAttempt` with deterministic idempotency key `sc_<scheduledChargeId>_a<n>`, and calls `src/lib/stripe-connect.ts` `createCharge(...)` — platform key + `Stripe-Account: <ConnectedAccount.providerAccountId>` + `application_fee_amount` from the ACCRUED `PlatformFee`.
3. **⇢ async** — Stripe settles (card: seconds; ACH: ~4 business days) and delivers events **from the connected account** to `/api/webhooks/stripe-connect`: verify signature with `STRIPE_CONNECT_WEBHOOK_SECRET` first → unique-insert `PaymentProviderEvent` → **[TX]** guarded reduce: `Payment` row, Invoice → PAID, review status, collection ledger journal, `PlatformFee` → EARNED. **[/TX]** Tenancy is resolved from local references (`PaymentAttempt.providerPaymentIntentId`, `ConnectedAccount.providerAccountId`) — event metadata is a must-match cross-check only.

### 4.4 Inbound event routing — how an event finds its system

| Step | `/api/webhooks/stripe` (System 1) | `/api/webhooks/stripe-connect` (System 2) |
|---|---|---|
| 1. Rate limit | `rateLimit("stripe-webhook:" + clientIp(req), …)` | `rateLimit("stripe-connect-webhook:" + clientIp(req), …)` |
| 2. Signature | `constructEvent` with `STRIPE_WEBHOOK_SECRET`; failure → 400, nothing stored; route inert if secret unset | Same, with `STRIPE_CONNECT_WEBHOOK_SECRET` |
| 3. Shape guard | Event **must not** carry a top-level `account` field. If it does: store in `BillingEvent`, mark processed with a `processingError` note "connected-account event at SaaS endpoint", return 200, open no state change | Event **must** carry `account` (`acct_…`). If missing: store in `PaymentProviderEvent` with `processingError`, return 200, no state change |
| 4. Mode guard | `event.livemode` must match the key mode (test in this phase). Mismatch → store + `processingError`, alert log, no state change | Same |
| 5. Attribution | `metadata.organizationId` (server-set at session creation) cross-checked against `stripeCustomerId` lookup | Local references only: `providerPaymentIntentId` → `PaymentAttempt`; `event.account` → `ConnectedAccount` → org. Both must agree or the event is stored unprocessed and a `ReconciliationException` opens |
| 6. Reduce | Subscription state on `Organization` | Doc-09 state machines (attempt/payment/refund/dispute/account status) |

Because the two endpoints have different signing secrets, a misrouted delivery normally dies at step 2. Steps 3–4 are defense in depth for the day a secret is misconfigured.

## 5. Where each system's state lives

### System 1 (all existing or Phase C-planned; Part 2 adds nothing here)

| State | Home | Status |
|---|---|---|
| Subscription commercial state | `Organization.subscriptionStatus` (`TRIAL\|ACTIVE\|PAST_DUE\|CANCELED\|MANUAL`) | Exists; informational only (no runtime enforcement) |
| How the org is billed | `Organization.billingMode` (`MANUAL\|STRIPE`) | Exists; `STRIPE` provisioned behind env flag, never live this phase |
| Plan catalog | `SubscriptionPlan` (priceMonthly `Decimal(8,2)`, limits, `modules String[]`) | Exists; Phase C adds `stripeProductId`/`stripePriceId` |
| Stripe linkage | `Organization.stripeCustomerId @unique`, `stripeSubscriptionId`, `currentPeriodEnd`, `trialEndsAt` | Phase C (PRODUCTION.md §13.2) — **not Part 2** |
| Inbound event idempotency | `BillingEvent { stripeEventId @unique, type, payload Json, processedAt }` | Phase C — **not Part 2** |

### System 2 (all Part 2, per doc 13 + this design set)

| State | Home |
|---|---|
| Connected-account identity, onboarding status, capabilities | `ConnectedAccount` (new, §9) — **`Organization` gains zero Connect columns** |
| Payer ↔ provider customer mapping | `PaymentCustomer` (customer objects live on the connected account) |
| Saved methods (safe metadata only) | `PaymentMethodReference` |
| Charge execution chain | `ScheduledCharge` → `PaymentAttempt` → `Payment` (exactly-once chain, ADR-033) |
| Refunds / disputes / payouts | `Refund`, `Dispute`, `ProviderPayout` |
| Inbound event idempotency | `PaymentProviderEvent` (`@@unique([provider, providerEventId])`) |
| AeroOps' take (the one bridge) | `PlatformFeePolicy` (platform-owned) → `PlatformFee` per review (ACCRUED → EARNED) |
| Financial truth | `RevenueAllocation`, `LedgerEntry`, `ReconciliationException` |

## 6. The never-mix list, made concrete

Each spec Part N item becomes a testable rule (BR-x referenced from §10/§8):

| Spec item ("do not mix") | Concrete rule | Structural enforcement |
|---|---|---|
| AeroOps subscription invoices | Stripe Billing invoices (platform account) never create tenant `Invoice`/`InvoiceLine`/`Payment` rows, never appear in the Revenue Dashboard, tenant `/billing` surfaces, Revenue Reports, or Financial Exports. No `RevenueReview` is ever created for a SaaS charge. **(BR-2)** | `Invoice` has no Stripe columns; System 1 reducer writes only `Organization`/`BillingEvent`; guardrail test §8.3 forbids `db.invoice`/`db.payment` in `src/lib/stripe.ts` |
| Student lesson invoices | Tenant invoices never sync to Stripe Billing/Invoicing. Stripe sees PaymentIntents with amounts, not AeroOps catalogs or invoices (doc 05 posture). | System 2 adapter interface has no invoice/subscription methods (ADR-032 signature is fixed) |
| School customer payment methods | A `PaymentMethodReference` (pm_ on a connected account) is never charged for an AeroOps subscription; the org's SaaS card (Customer on the platform account) is never charged for lesson payments. Cross-account use is impossible at the provider level: a payment method attached to connected account A does not exist on the platform account or account B. **(BR-4)** | Different Stripe accounts hold the objects; adapter always sends `Stripe-Account`; System 1 module never sends it (§8.3) |
| Connected-account funds | AeroOps never transfers, holds, or nets tenant funds. The only platform-bound money from System 2 is `application_fee_amount` backed by an ACCRUED `PlatformFee` row. Deducting the AeroOps subscription from school payouts is banned (§16 Q4 asks the owner to make the ban permanent). **(BR-5)** | D1 direct charges: settlement goes to the connected account by construction; no transfer/payout-mutation methods exist on the adapter |
| Organization SaaS pricing | `SubscriptionPlan.priceMonthly`, plan limits, and subscription status never appear in tenant revenue reports, payer surfaces, or `PlatformFeePolicy` resolution. Platform fee ≠ subscription price ≠ Stripe processing fee, and UI copy never conflates them (Part W disclosure rule). **(BR-9)** | Fee engine reads `PlatformFeePolicy` only; report engines read doc-12 snapshot rows only |
| Customer objects | No shared Stripe Customers: `Organization.stripeCustomerId` (platform account, Phase C) vs `PaymentCustomer.providerCustomerId` (connected account) are different objects in different account namespaces, linked to different local models. A `PaymentCustomer` row is never created for the org's own SaaS relationship. **(BR-4)** | Triple-unique on `PaymentCustomer` requires payer/student linkage (XOR), which the org-as-tenant does not have |
| Webhooks & secrets | Two endpoints, two dashboard configurations (account events vs connected-account events), two signing secrets, two event stores. One endpoint never processes the other's events. **(BR-7, §4.4)** | Per-endpoint secrets; shape guards; separate tables with separate uniques |
| Subscription state → tenant charging | `subscriptionStatus` / `billingMode` / `BILLING_ENFORCEMENT` are never read by any Revenue Engine engine, route, or readiness check. A school's customers can pay the school while the school is PAST_DUE with AeroOps; stopping tenant charging is only ever an explicit, audited platform action on `ConnectedAccount` (Part P suspension), never an automatic cascade. **(BR-6; owner confirmation §16 Q1)** | Guardrail test §8.3 greps System 2 sources for the System 1 identifiers |
| "Organization as payer" (spec Part Q) | A business paying a school for employee training is a `ResponsiblePayer` (`payerType EMPLOYER/UNIVERSITY/CLUB_SPONSOR`) inside System 2 — never the AeroOps tenant's SaaS billing identity, never `Organization.stripeCustomerId`. **(BR-8)** | Payer models are org-scoped System 2 records (doc 11); no FK path from `ResponsiblePayer` to System 1 state |

## 7. Environment-variable matrix

Per the repo's adapter-seam rule (CLAUDE.md §9, ADR-017): every var unset = graceful degradation to today's behavior; partial configuration of a system fails loudly at boot via `assertProductionEnv` (`src/lib/env.ts`); secrets are env-only, never in application data, logs, or exports.

| Variable | System | Values (this phase) | Default | Behavior |
|---|---|---|---|---|
| `STRIPE_SECRET_KEY` | 1 | `sk_test_…` / `rk_test_…` (Phase C; live keys held until Phase F) | unset | SaaS Billing client key (platform account). Recommend a **restricted key** scoped to Checkout/Subscriptions/Portal. Unset → billing surfaces informational, exactly today. |
| `STRIPE_WEBHOOK_SECRET` | 1 | `whsec_…` | unset | Signing secret for `/api/webhooks/stripe`. Route inert without it. |
| `BILLING_ENFORCEMENT` | 1 | `off \| warn \| enforce` | `off` | System 1 rollback lever. **Never read by System 2.** |
| `REVENUE_CHARGING` | 2 | `off \| test` | `off` | System 2 master flag (doc 09 §5.4). `off`: adapter absent, charge surfaces degrade, manual invoice + offline recording still work. **A `live` value does not exist in this phase.** |
| `STRIPE_CONNECT_SECRET_KEY` | 2 | `rk_test_…` (recommended) or `sk_test_…` | unset | Key used by `src/lib/stripe-connect.ts` for connected-account calls. Restricted key scoped to Connect + PaymentIntents/SetupIntents/Refunds (§8.2). May hold the same underlying account's key as System 1 in local dev, but the **variable is always distinct** so production can hold two differently-scoped keys. |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | 2 | `whsec_…` | unset | Signing secret for `/api/webhooks/stripe-connect`. Stripe issues **one signing secret per endpoint**, so this can never equal `STRIPE_WEBHOOK_SECRET` in a real configuration — sharing one env var across the two endpoints is technically impossible, which is why doc 09's placeholder name is finalized apart (§16 Q3). |

Boot-time validation rules (added to `assertProductionEnv`):

1. `REVENUE_CHARGING=test` requires **both** `STRIPE_CONNECT_SECRET_KEY` and `STRIPE_CONNECT_WEBHOOK_SECRET`; one without the other fails boot.
2. `REVENUE_CHARGING=test` with a live-mode key (`sk_live_`/`rk_live_` prefix) fails boot — provider environment separation (spec Part AB) is asserted, not assumed.
3. `STRIPE_WEBHOOK_SECRET` without `STRIPE_SECRET_KEY` (and vice versa) fails boot once Phase C lands.
4. Each system validates only its own pair — System 2 fully configured with System 1 absent is a valid deployment, and vice versa (independent degradation, §13 F-6).

## 8. Structural guardrails

### 8.1 Symmetric naming — one memorable rule

Bare **"stripe" = System 1**, **"stripe-connect" = System 2**, at every layer:

| Layer | System 1 | System 2 |
|---|---|---|
| Route | `/api/webhooks/stripe` | `/api/webhooks/stripe-connect`, `/api/webhooks/stripe-platform` |
| Module | `src/lib/stripe.ts` | `src/lib/stripe-connect.ts` |
| Webhook secret | `STRIPE_WEBHOOK_SECRET` | `STRIPE_CONNECT_WEBHOOK_SECRET`, `STRIPE_PLATFORM_WEBHOOK_SECRET` |
| API key | `STRIPE_SECRET_KEY` | `STRIPE_CONNECT_SECRET_KEY` |
| Event store | `BillingEvent` | `PaymentProviderEvent` |
| Flag | `BILLING_ENFORCEMENT` | `REVENUE_CHARGING` |

An engineer holding any one name can derive its system and all its siblings. **Simpler-workflow choice:** this symmetry over doc 01's literal `src/lib/stripe.ts` for the Connect adapter — PRODUCTION.md §13.2 already assigns that exact path to System 1, and two systems sharing a file name called "stripe" is precisely the confusion Part N exists to prevent. Divergence recorded in §16 Q3.

The Revenue Engine (System 2) also owns a **third** webhook route, `/api/webhooks/stripe-platform` (secret `STRIPE_PLATFORM_WEBHOOK_SECRET`), for the platform-account `application_fee.refunded` / `application_fee.refund.updated` events that D1 direct charges emit (doc 23 §3.1). It is System 2 — application fees are System 2's one bridge to AeroOps, so despite targeting the platform account it is never SaaS billing — and, like `stripe-connect`, it imports only from `src/lib/stripe-connect.ts`.

### 8.2 Provider-level guardrails

- **Restricted keys per system (production posture).** System 1's key cannot create PaymentIntents on connected accounts; System 2's key cannot mutate Subscriptions or Checkout. A code bug that reaches across systems then fails at Stripe with a permission error instead of moving money. In dev/test both vars may hold the full test secret key; the key-provisioning checklist in the Part P onboarding doc covers scoping.
- **Connected-account context is mandatory in System 2.** `src/lib/stripe-connect.ts` does not export the raw Stripe client; every exported function takes the org's `ConnectedAccount` (or its `providerAccountId`) and sets `Stripe-Account` internally. There is no code path that makes a bare platform-context money call from the Revenue Engine.
- **Object namespaces do the heavy lifting.** Customers/methods/charges on connected accounts are invisible to the platform-account context System 1 uses, and vice versa. Cross-tenant and cross-system object reuse fails at the provider even before AeroOps checks anything.

### 8.3 Constitution / static-test hooks

A new static source-scan test in the repo's established idiom (`tests/dispatch-idempotency.test.ts`, `tests/weather.test.ts`): **`tests/two-financial-systems.test.ts`**, asserting over `src/`:

1. The `stripe` npm package is imported **only** by `src/lib/stripe.ts` and `src/lib/stripe-connect.ts` (`new Stripe(` appears nowhere else). Engines and routes consume the adapters, never the SDK.
2. `src/lib/stripe-connect.ts` contains none of: `billingEvent`, `stripeCustomerId`, `stripeSubscriptionId`, `subscriptionStatus`, `billingMode`, `checkout.session`, `customer.subscription`, `BILLING_ENFORCEMENT`.
3. `src/lib/stripe.ts` (once it exists) contains none of: `stripeAccount`, `Stripe-Account`, `application_fee`, `paymentAttempt`, `paymentProviderEvent`, `scheduledCharge`, `paymentCustomer`, `REVENUE_CHARGING`, `db.invoice`, `db.payment`.
4. Neither module imports the other; `app/api/webhooks/stripe/route.ts` imports only from `lib/stripe`, and both `app/api/webhooks/stripe-connect/route.ts` and `app/api/webhooks/stripe-platform/route.ts` only from `lib/stripe-connect`.
5. No Revenue Engine source under `src/lib` (doc 01 engine map) or `src/app/api/revenue/**` references `subscriptionStatus`, `billingMode`, `planId`, or `BillingEvent`.
6. All three webhook routes — `stripe` (System 1), `stripe-connect` and `stripe-platform` (System 2) — appear in `tests/constitution.test.ts` `PUBLIC_ROUTES` with written reasons, each verifying its own endpoint signature (`STRIPE_WEBHOOK_SECRET` / `STRIPE_CONNECT_WEBHOOK_SECRET` / `STRIPE_PLATFORM_WEBHOOK_SECRET`) and calling `rateLimit(` before any body read.

Rules 3 and parts of 1/4 are written now and activate when Phase C creates the files — the test skips absent files rather than failing, so the guardrail predates System 1's implementation.

### 8.4 Model-namespace guardrail

`Organization` gains **zero System 2 columns** — all Connect state lives on `ConnectedAccount` (§9). Conversely, no doc-13 model carries subscription fields. The existing `tests/schema-governance.test.ts` auto-covers the new model (org FK, explicit onDelete, tenant-scoped uniques); the two-systems test adds the negative assertion (no `stripeAccountId`-like column on `Organization`, no `subscription*` column on any doc-13 model).

## 9. Data model additions

Exactly one new model is introduced by this document, on the System 2 side. It is the Part P (connected-account onboarding) anchor; its **final shape, status machine, and sync semantics are owned by the Part P design doc and bound by [34-part2-database-additions.md](./34-part2-database-additions.md)** — the fields below are the boundary-critical minimum this doc commits to.

```prisma
/// System 2 ONLY: the org's payment-provider connected account (Stripe Connect).
/// Deliberately NOT columns on Organization — Organization carries System 1
/// (SaaS subscription) state; this model carries System 2 (Revenue Engine)
/// provider state. Strict org 1:1 (one account per org, ADR-037); absent row =
/// NOT_STARTED. Doc 17 §8.4.
model ConnectedAccount {
  id                  String                       @id @default(cuid())
  organizationId      String                       @unique
  provider            PaymentProvider              @default(STRIPE)
  /// Opaque provider account id (acct_…). Null until onboarding starts.
  providerAccountId   String?
  status              ConnectedAccountStatus       @default(PENDING)
  chargesEnabled      Boolean                      @default(false)
  payoutsEnabled      Boolean                      @default(false)
  /// Provider requirements snapshot (currently_due / past_due keys). Safe
  /// metadata only — never documents, PII payloads, or secrets.
  requirementsDue     Json?
  disabledReason      String?
  country             String?                      @db.Char(2)
  defaultCurrency     String?                      @db.Char(3)
  businessType        String?
  statementDescriptor String?
  capabilities        Json?
  termsAcceptedAt     DateTime?
  /// providerStateAsOf: provider-clock watermark (out-of-order webhook guard).
  /// lastStatusSyncAt: our clock; staleness signal for the reconciliation sweep.
  providerStateAsOf   DateTime?
  lastStatusSyncAt    DateTime?
  createdAt           DateTime                     @default(now())
  updatedAt           DateTime                     @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
  @@index([status, lastStatusSyncAt])
}

/// Part P statuses (final transition table in the onboarding doc).
enum ConnectedAccountStatus {
  NOT_STARTED // reserved for completeness — an absent row represents it; no writer stores it
  PENDING
  REQUIREMENTS_DUE
  RESTRICTED
  ENABLED
  DISABLED
  SUSPENDED
}
```

Explicitly **not** added in Part 2 (System 1, deferred to Phase C per PRODUCTION.md §13.2 — listed so implementers know they are reserved, not forgotten):

| Model / field | System | Owner |
|---|---|---|
| `Organization.stripeCustomerId @unique`, `stripeSubscriptionId`, `currentPeriodEnd`, `trialEndsAt` | 1 | PRODUCTION.md §13.2 `stripe_billing` migration (Phase C) |
| `SubscriptionPlan.stripeProductId`, `stripePriceId` | 1 | Same |
| `BillingEvent` | 1 | Same |

Migration note: `ConnectedAccount` is additive and slots into doc 14's sequence alongside M8 (payment-provider models, before M13 collection models — a `ScheduledCharge` cannot execute without an ENABLED account to charge against); [34-part2-database-additions.md](./34-part2-database-additions.md) sequences it precisely. It joins org-snapshot capture/wipe/restore and seed fixtures (the primary demo org may seed an `ENABLED` row with a fake `acct_` id for UI states; the second demo org has no row — the absent row *is* `NOT_STARTED` — seed doc decides).

## 10. Validation & business rules

| # | Rule |
|---|---|
| BR-1 | `Organization` carries no System 2 provider state; `ConnectedAccount` and the doc-13 models carry no System 1 state. Enforced by §8.3/§8.4 scans. |
| BR-2 | Tenant `Invoice`/`InvoiceLine`/`Payment`/`RevenueReview` rows never represent AeroOps subscription charges; System 1 events never touch tenant financial tables. |
| BR-3 | System 2 code never reads `subscriptionStatus`, `billingMode`, `planId`, `BILLING_ENFORCEMENT`, or `BillingEvent`; System 1 code never reads any doc-13 model. The single sanctioned bridge is `PlatformFeePolicy`/`PlatformFee` (doc 12 §2), and it bridges as **data in the tenant's books**, not as code coupling. |
| BR-4 | Stripe Customer duality: platform-account Customer ↔ `Organization` (System 1); connected-account Customer ↔ `PaymentCustomer` (System 2). Never a `PaymentCustomer` for the tenant's own SaaS relationship; never a platform-account Customer for a payer. |
| BR-5 | `application_fee_amount` (backed by an ACCRUED `PlatformFee`) is the only mechanism moving tenant-derived money to AeroOps. No transfers, no payout netting, no fund custody. |
| BR-6 | SaaS delinquency never automatically pauses, blocks, or degrades Revenue Engine charging, payer surfaces, or payouts. Platform staff may suspend an org's charging explicitly via the Part P suspension action on `ConnectedAccount` (audited, reasoned) — a deliberate human decision, never a cascade. (Owner confirmation: §16 Q1.) |
| BR-7 | Environment separation: each webhook reducer asserts `event.livemode` matches its configured key mode and each event carries/lacks the `account` field appropriate to its endpoint (§4.4). Violations are stored-but-unprocessed with `processingError`, never applied. |
| BR-8 | "Organization as payer" (Part Q) resolves to a `ResponsiblePayer` of an org-scoped business type inside System 2 — never to the tenant's System 1 identity. |
| BR-9 | Disclosure accuracy (Part W): subscription price (System 1), AeroOps platform fee (System 2 bridge), and Stripe processing cost (provider fact) are three different numbers with three different names; no UI, receipt, or export may label one as another. |
| BR-10 | Charging readiness (doc 09 §5.2) gains one System 2 check: `ConnectedAccount.status = ENABLED AND chargesEnabled = true` for any provider charge path. Manual invoice and offline recording never require it. It never checks anything from System 1. |

## 11. RBAC, approvals & audit

| Surface | Permission | Notes |
|---|---|---|
| Tenant Settings → Plan & Billing (System 1, Phase C) | Org-admin/Account Owner gated (Phase C defines the key) | Shows the org's own subscription only. Never shows Connect state, platform-fee terms, or any System 2 record. |
| Platform Console subscription panel (System 1) | `platform.billing.view` (view), `platform.pricing.change` (change subscriptionStatus/billingMode), `platform.orgs.manage` (planId) | Exists today in the org-detail PATCH field→permission map; unchanged. |
| Platform Console Connect status panel (System 2, Part P) | **New key `platform.connect.view`** — inspect onboarding status, charges/payouts enabled, requirements due, disabled reason. Shows **no secrets and no customer financial data** (spec Part P). Mutating actions (initiate onboarding link, suspend/reinstate) use **new key `platform.connect.manage`** with `{mutating:true}`; final key set and role mapping in the Part P doc. | Added to `PLATFORM_PERMISSIONS` as data; the "mutating iff not `.view`" convention holds. |
| Platform fee administration (System 2 bridge) | Part W doc owns the keys; platform-only per Part 1 (`authorizePlatform`, never org-editable — spec Part AB auto-reject). | |
| Org-side Revenue Engine | `revenue.*` catalog per Part 1 doc 01. No `revenue.*` permission grants any System 1 capability. | |

Audit: every mutation on either side goes through `recordAudit` (existing rule). New audit actions implied here: `platform.connect_account_suspended` / `reinstated` (Part P finalizes naming) with before/after status and required reason. Read-only impersonation blocks mutations in both systems (existing gate). Approvals: none of this doc's surfaces need financial approval chains — the approval machinery belongs to Revenue Reviews (doc 03) and platform-fee changes (Part W doc).

## 12. What is in scope for Part 2 vs deferred

**In scope for Part 2 (the boundary itself):**

- `ConnectedAccount` model + `ConnectedAccountStatus` enum (shape finalized in 34-part2-database-additions.md; migration additive).
- Env-key names reserved and validated (`STRIPE_CONNECT_SECRET_KEY`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `REVENUE_CHARGING`) with the §7 boot rules in `assertProductionEnv`.
- `/api/webhooks/stripe-connect` route (System 2 webhook doc owns the pipeline; this doc owns which endpoint exists for which system and the §4.4 shape/mode guards).
- `tests/two-financial-systems.test.ts` static guardrail (§8.3), written to skip System 1 files until they exist.
- `platform.connect.view` / `platform.connect.manage` permission keys + Platform Console Connect panel (with Part P).
- This document.

**Explicitly deferred — System 1 implementation is NOT Revenue Engine work:**

| Deferred item | Owner / phase |
|---|---|
| Stripe Billing integration: `src/lib/stripe.ts`, Checkout/Portal routes, `/api/webhooks/stripe`, `BillingEvent`, `stripe_billing` migration, plan sync, billing settings page | PRODUCTION.md §13.2, Phase C |
| `BILLING_ENFORCEMENT` runtime gating of PAST_DUE/CANCELED orgs | Phase C build, Phase F flip (owner decision gate F5) |
| Any change to `SubscriptionStatus`/`BillingMode` enums or plan catalog semantics | Phase C |
| Coupling policies between SaaS delinquency and tenant charging (if the owner ever wants one) | Future ADR only — never implicit (§16 Q1) |
| Payout-netting of subscription fees, or any second bridge between the systems | Not planned; §16 Q4 asks the owner to ban it permanently |
| Live keys, live charges, production email — in either system | Out of scope for all of Phase 8 (spec header) |

## 13. Failure modes & edge cases

| # | Scenario | Behavior |
|---|---|---|
| F-1 | Connect event delivered to `/api/webhooks/stripe` (or vice versa) | Signature verification fails (different per-endpoint secrets) → 400, nothing stored; Stripe retries then surfaces the failing endpoint in its dashboard. If secrets were misconfigured identically, the §4.4 shape guard stores the event with `processingError` and applies nothing. |
| F-2 | `livemode` mismatch (live event to test-configured deployment) | Stored with `processingError`, alert-level log, no state change (BR-7). In this phase any `livemode: true` event is by definition a misconfiguration. |
| F-3 | Connected account deauthorized / disabled by Stripe (`account.updated`, `account.application.deauthorized`) | System 2 webhook doc reduces `ConnectedAccount` → DISABLED/RESTRICTED; readiness (BR-10) blocks new provider charges; manual invoice + offline recording continue; in-flight attempts resolve via normal webhook/reconciliation paths. **System 1 is untouched — the org's software subscription does not care.** |
| F-4 | Org cancels SaaS subscription (Phase C) while holding an ENABLED connected account | No automatic System 2 effect (BR-6). Access questions are `OrgStatus`'s job (suspension already blocks everything via `authorize()`); money questions require an explicit platform decision with its own audit trail. |
| F-5 | Org offboarding/deletion | Ordered wipe per org-snapshot §10.2; `ConnectedAccount` joins the wipe order (Cascade backstop). Provider-side account closure is a manual platform runbook step (Part P doc) — AeroOps never auto-deletes a Stripe account holding funds. |
| F-6 | One system configured, the other not | Fully independent degradation (§7 rule 4): Revenue Engine charging can run in test mode while SaaS billing remains manual (the actual Phase 8 state), and Phase C can ship System 1 with `REVENUE_CHARGING=off`. |
| F-7 | Restricted key provisioned with too-broad scope | Not detectable at boot (Stripe doesn't expose key scopes). Mitigations: provisioning checklist in the Part P runbook; the §8.3 code scan guarantees no call site exists that would exploit extra scope; reconciliation (System 2 webhook doc) flags unexpected platform-account objects. |
| F-8 | Same human is a school Account Owner and a payer (owner pays for their own training) | Two distinct records by construction: their org's System 1 subscription vs their `ResponsiblePayer`/`PaymentCustomer` in System 2. Saved methods never bleed across because the Stripe objects live on different accounts (BR-4). |
| F-9 | Stripe event IDs colliding across endpoints | Impossible to corrupt state: separate stores with separate uniques (`BillingEvent.stripeEventId` vs `PaymentProviderEvent [provider, providerEventId]`); an event replayed to both endpoints is idempotent within each and rejected by shape guards in the wrong one. |
| F-10 | Multi-instance deployment (future) | Both event stores are DB-unique-insert idempotent, so duplicate concurrent deliveries are safe; the in-memory rate limiter degrades to per-instance limits (documented single-node assumption; Redis swap noted in `rate-limit.ts`). |

## 14. UX notes

- **Vocabulary.** Tenant-facing: the org's payment relationship with AeroOps is always "**your AeroOps subscription**" / "Plan & Billing" (in Settings); money the org collects is always "**Revenue**" (Revenue Dashboard, Revenue Reviews). The word "billing" alone is never used for System 2 in customer-facing copy. The existing sidebar module key `billing` (internal, `MODULE_BY_PREFIX`) is unaffected — labels are what change per Part Z.
- **No shared screens.** No page mixes the two systems. Settings → Plan & Billing shows only System 1; the Revenue Dashboard and revenue settings show only System 2. The existing settings-page integration row ("Stripe payments — Planned") splits into two rows when built: "AeroOps subscription (Stripe Billing) — Planned" and "Customer payments (Stripe Connect) — status from `REVENUE_CHARGING` + `ConnectedAccount.status`".
- **Platform Console.** The org-detail page gets a Connect panel (System 2: status, charges/payouts enabled, requirements due, last sync — no secrets) rendered separately from the existing subscription panel (System 1: plan, status, billing mode). Different permissions (§11), different panels, no combined "money" panel — a support agent must always know which system they are looking at.
- **Payers and students see neither system's internals.** They see their own Amount Due, receipts, methods, and history (Part Z student/payer view). They never see the school's subscription state, platform-fee terms, or Connect status.
- **Trust language.** Receipts and payer surfaces name the school as the merchant (D1: school is merchant of record, its statement descriptor). AeroOps branding appears as the software, never as the merchant. This is the customer-confidence half of the north-star question: a parent reading a card statement sees the flight school they know.

## 15. Out of scope for Part 2 / deferred to Part 3

- Everything in §12's deferred table (System 1 implementation, enforcement, coupling policies).
- Multi-provider support beyond Stripe: `PaymentProvider` enum and `ConnectedAccount` are provider-shaped for it, but no second adapter is planned.
- Multi-currency in either system (Part 1 binding: single org currency).
- Part 3 items that sit on this boundary: payout ingestion UI (`ProviderPayout` reconciliation surfaces), Financial Export of platform-fee records, dispute evidence workflow.

## 16. Open questions

| # | Question | Recommendation | Who decides |
|---|---|---|---|
| Q1 | Should SaaS delinquency (PAST_DUE/CANCELED) ever automatically affect Revenue Engine charging or payouts? | **No automatic coupling, ever** (BR-6). A school's students should not lose payment service because the school's software bill is late, and receivables should never be leverage. Platform staff retain the explicit, audited suspension action. If the owner wants a coupling policy later, it is its own ADR. | Product owner |
| Q2 | Confirm a **single Stripe platform account** hosts both Stripe Billing (System 1) and Connect (System 2), separated by restricted keys/endpoints (§4.1). | Yes — one account. Revisit only if AeroOps splits legal entities. The owner should confirm when creating the real Stripe account (business verification takes days; PRODUCTION.md flags it as a week-1 owner task). | Product owner (with Stripe account setup) |
| Q3 | **Recorded divergence from Part 1 literals** (per the Part 2 rule: record, don't silently diverge): doc 01 §8/ADR-032 name the System 2 adapter `src/lib/stripe.ts`, and doc 09 §5.4 names its env keys `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` — but PRODUCTION.md §13.2 (pre-existing, repo-level) assigns those exact names to System 1, and Stripe's per-endpoint signing secrets make a shared webhook-secret variable impossible. This doc finalizes `src/lib/stripe-connect.ts` + `STRIPE_CONNECT_SECRET_KEY`/`STRIPE_CONNECT_WEBHOOK_SECRET` for System 2 (§8.1) — the adapter interface, flag, and behavior are unchanged. | Approve the naming here; the designated Part 1 refresh agent syncs docs 01/09/15 file-path and env-name mentions. No PRODUCTION.md change needed (its names stand for System 1). | Design-set owner / refresh agent |
| Q4 | Is "collect the AeroOps subscription by netting it from school payouts" **permanently** rejected (like wallet balances), or merely unplanned? | Permanently rejected. It silently converts AeroOps into a fund custodian, breaks BR-5, muddies the school's books, and violates the transparent-fee posture of spec Part O. Record it as a permanent design rejection alongside the wallet ban. | Product owner |
| Q5 | Should the seeded demo orgs include an `ENABLED` `ConnectedAccount` with a synthetic `acct_` id so Revenue Dashboard / readiness UI states are demonstrable without Stripe config? | Yes for the primary demo org, `NOT_STARTED` for the second — gives sales demos both states. Final call in the Part 2 seed/fixtures doc. | Design-set owner |
