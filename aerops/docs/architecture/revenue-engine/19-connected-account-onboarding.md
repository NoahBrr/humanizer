# Connected Account Onboarding

> **Status:** Proposed — Phase 8 Part 2 · **Date:** 2026-07-10 · **Lead roles:** Principal Payments Architect at Stripe; Head of Product; Security Engineer at Cloudflare · **Part of:** Revenue Engine design set ([README](./README.md))

This document designs **spec Part P — Connected Organization Onboarding**: how an organization becomes able to collect Revenue Engine payments. It defines the `ConnectedAccount` model (org 1:1 mapping to the provider's connected account), the seven-status lifecycle driven by `account.updated` webhooks and manual platform actions, the Stripe-hosted onboarding flow the org admin walks through, the **hard gate** that blocks charge initiation until the account is ready, suspension/deauthorization behavior, and the Platform Console view for authorized AeroOps staff.

**Hard boundary:** design only. Stripe **test mode** is the only sanctioned environment, and even test mode is not exercised in this phase — no Stripe objects are created, nothing is deployed, no live charges ever (`REVENUE_CHARGING` has no `live` value). Onboarding data capture (KYC, bank details, tax IDs) happens **exclusively on Stripe-hosted surfaces**; AeroOps stores status and requirement *keys*, never submitted values.

---

## 1. Purpose & scope

### In scope

- The `ConnectedAccount` model: one row per organization, tracking every Part P field — provider account ID, onboarding status, `chargesEnabled`, `payoutsEnabled`, requirements due, disabled reason, country, default currency, business type, statement descriptor, capabilities, last status sync, terms acceptance.
- `ConnectedAccountStatus` — exactly the seven spec statuses — with a deterministic derivation function and a transition table.
- Onboarding UX: org admin initiates from Settings → hosted Stripe onboarding link → return/refresh URLs → status sync.
- Status sync strategy: `account.updated` webhook reduce (primary) + retrieve-and-reduce reconciliation fallback (backstop) + manual refresh.
- The charge-readiness hard gate and every place it is enforced (readiness engine, approval verification, payment runner, method setup).
- Suspension and deauthorization: what happens to in-flight Payment Attempts, pending ACH, and queued Scheduled Charges.
- Platform Console surface: which platform roles see what; no financial account details, no secrets.
- Audit of every status change; RBAC keys (org + platform); seed fixtures; org-snapshot wiring.

### Out of scope (see §10)

Account **type** and charge topology (owned by [18-stripe-connect-decision.md](./18-stripe-connect-decision.md)); the webhook transport pipeline itself (Part T owner doc; contract per [09-payment-timing-and-collection.md](./09-payment-timing-and-collection.md) §2.10); payout ingestion (`ProviderPayout`, [13-database-model.md](./13-database-model.md)); platform fee (Part W owner doc); AeroOps SaaS subscription billing (a **separate money system** — spec Part N, ARCHITECTURE.md §13; this doc never touches `Organization.billingMode`, `subscriptionStatus`, or `/api/webhooks/stripe`).

---

## 2. Relationship to Part 1 docs and Part 2 siblings

| Doc | What this document does with it |
|---|---|
| [01-revenue-engine-architecture.md](./01-revenue-engine-architecture.md) §11 | Extends the Part 1 position (per-org connected accounts assumed; topology finalized in Part 2). The provider-agnostic adapter gains three **additive** account-management methods (§3.4) — the Part 1 charging interface (`createCustomer`, `createSetupSession`, `detachPaymentMethod`, `createCharge`, `parseWebhookEvent`) is unchanged. |
| [09-payment-timing-and-collection.md](./09-payment-timing-and-collection.md) | Extends §5.2 payment readiness with a **Connected account ready** check (§3.8); extends §5.1 charge initiation with the account gate as check 0; reuses the §2.10 webhook pipeline for `account.updated` (tenancy resolution extended for account-level events, §3.5); reuses the §2.9 queue-less runner for the reconciliation sweep. |
| [13-database-model.md](./13-database-model.md) | Canonical for all Part 1 shapes — **nothing bound there changes**. `ConnectedAccount` is a NEW Part 2 model following doc 13's conventions (org FK + explicit `onDelete`, tenant-scoped uniques, `Decimal`/`Char(3)` money rules, label conventions). Final shape call: [34-part2-database-additions.md](./34-part2-database-additions.md). |
| [16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md) D1 | The account type (Express vs Standard) and direct-charge recommendation are **decided in [18-stripe-connect-decision.md](./18-stripe-connect-decision.md)**; this doc is written to work under either account type (hosted Account Links exist for both) and references the decision by filename rather than duplicating it. |
| [22-approval-to-payment.md](./22-approval-to-payment.md) | Consumes the readiness gate: "Connected account is ready" is one of the Part S pre-approval verifications; the approval-time behavior when the account is not ready (degrade to `MANUAL_INVOICE`) is specified here (§3.8) and enforced there. |
| Part 2 webhook design doc (spec Part T deliverable) | Owns signature verification, `PaymentProviderEvent` unique-insert, replay, and the reconciliation job runtime. This doc defines the `account.updated` **reduce contract** (§3.5) and the account-event tenancy rule that the webhook doc implements. |
| Part 2 notification design doc (spec Part AA deliverable) | Owns `NotificationKind` additions and delivery. This doc defines the four account-lifecycle notification triggers (§7). |

---

## 3. How it works

### 3.1 The `ConnectedAccount` record

One row per organization (`organizationId @unique`), created when an org admin first initiates payments setup. **Absent row = `NOT_STARTED`** — the zero-setup default, consistent with the org-config singleton pattern (absent row = code defaults). *Simpler-workflow choice: no pre-provisioned rows; five schools onboarded tomorrow see "Set up payments" and nothing else until an owner clicks it.*

The row is a **mirror of provider-side facts plus AeroOps-side control fields**, never a financial record: it holds no balances, no payout amounts, no KYC values, no bank details. Everything Stripe collects during onboarding stays on Stripe (SAQ-A posture extended to KYC: capture only on provider-hosted surfaces).

Two classes of fields:

- **Provider-mirrored** (written only by the sync reducer): `providerAccountId`, `chargesEnabled`, `payoutsEnabled`, `detailsSubmitted`, `requirementsDue`, `disabledReason`, `country`, `defaultCurrency`, `businessType`, `statementDescriptor`, `capabilities`, `providerStateAsOf`.
- **AeroOps-controlled** (written only by org/platform actions): terms acceptance, onboarding initiator, `suspendedAt`/reason/actor, `deauthorizedAt` (webhook-set but AeroOps-semantic), `lastStatusSyncAt`.

### 3.2 Status derivation — a pure projection

`status` is stored (it drives queues, tones, and the platform view) but is **always computed** by a pure function in `src/lib/connect-account.ts` — never hand-set except through the two platform actions (suspend/reinstate) that set the fields the function reads. Evaluated in order, first match wins:

| # | Condition | Status |
|---|---|---|
| 0 | No `ConnectedAccount` row | `NOT_STARTED` |
| 1 | `suspendedAt` set (AeroOps platform hold — sticky) | `SUSPENDED` |
| 2 | `deauthorizedAt` set, **or** `disabledReason` in the rejection catalog (`rejected.*`, `listed`) | `DISABLED` |
| 3 | `chargesEnabled = false` **and** (`disabledReason` set **or** `requirementsDue.pastDue` non-empty) | `RESTRICTED` |
| 4 | `chargesEnabled = false` (includes `providerAccountId = null` provisioning window and Stripe's verification-in-progress) | `PENDING` |
| 5 | `chargesEnabled = true` **and** (`requirementsDue.currentlyDue` or `.pastDue` non-empty) | `REQUIREMENTS_DUE` |
| 6 | `chargesEnabled = true`, nothing currently/past due | `ENABLED` |

Notes:

- `eventually_due` requirements never trigger `REQUIREMENTS_DUE` — they are future-cycle information, surfaced as info text only. Charging is not warned about paperwork Stripe doesn't yet need.
- `REQUIREMENTS_DUE` means **charges still work** but Stripe has set a clock; it is a warning state, not a blocked state (§3.8).
- The disabled-reason rejection catalog is an engine-validated string catalog in `src/lib/connect-account.ts` (R25 pattern) — `disabledReason` mirrors an external vocabulary and does not drive a Prisma enum.
- Because Stripe is the source of truth for provider-side facts, the reducer **mirrors, never gates**: any derived status is legal after a sync. AeroOps' own state machines (Revenue Review, ScheduledCharge, PaymentAttempt) are unaffected — this record only gates *new* charge initiation.

### 3.3 Transition table

Expected transitions (the derivation in §3.2 is authoritative; this table documents the paths, their triggers, and side effects):

| From | Event / actor | To | Side effects (post-commit unless noted) |
|---|---|---|---|
| `NOT_STARTED` | Org admin initiates setup (`revenue.connect_manage`) | `PENDING` | Row created in TX-1 with terms acceptance + initiator (§3.4); `recordAudit revenue.connect_onboarding_started` |
| `PENDING` | `account.updated`: `charges_enabled → true`, nothing due | `ENABLED` | `firstEnabledAt` stamped (first time only); audit `revenue.connect_status_changed`; notify org: "Payments are ready"; `emitDomainEvent connected_account.status_changed` |
| `PENDING` | `account.updated`: `charges_enabled → true`, items currently due | `REQUIREMENTS_DUE` | Audit; notify org with due list + deadline |
| `ENABLED` | `account.updated`: new `currently_due`/`past_due` requirements | `REQUIREMENTS_DUE` | Audit; notify org admins: "Stripe needs more information by \<deadline\> — payments continue meanwhile" |
| `REQUIREMENTS_DUE` | `account.updated`: requirements cleared | `ENABLED` | Audit; notification resolves |
| `REQUIREMENTS_DUE` | `account.updated`: deadline passed, `charges_enabled → false` | `RESTRICTED` | Audit; notify org (action required — payments paused); charge gate closes; queued charges visibly blocked (§3.9) |
| `RESTRICTED` | `account.updated`: info provided, `charges_enabled → true` | `ENABLED` / `REQUIREMENTS_DUE` | Audit; notify org (payments resumed); gate reopens — queued `SCHEDULED` charges become runnable again at the next runner pass |
| any | `account.updated` with `disabledReason` in rejection catalog, or `account.application.deauthorized` | `DISABLED` | Audit; notify org + platform staff; gate closes; terminal in Part 2 (§10) |
| any non-`DISABLED` | Platform staff suspend (`platform.connect.suspend`, reason required) | `SUSPENDED` | `suspendedAt/Reason/ByLabel` set in the action TX; audit `platform.connect_suspended`; notify org owner; gate closes |
| `SUSPENDED` | Platform staff reinstate (`platform.connect.suspend`, reason required) | *re-derived* (§3.2 on last-synced fields) | `suspendedAt` cleared; audit `platform.connect_reinstated`; immediate follow-up sync (§3.7) so the derived status is fresh |
| any with a provider account | Manual sync / reconciliation sweep | *re-derived* | Audit **only when the derived status or a mirrored field changed** (no audit noise from no-op syncs); `lastStatusSyncAt` always stamped |

`SUSPENDED` is **sticky**: webhook reduces keep updating the mirrored fields underneath, but rule 1 wins until a platform actor clears it — reinstatement lands on accurate, current facts.

### 3.4 Onboarding sequence (org admin)

Adapter additions (additive extension of the ADR-032 interface; Stripe implementation in `src/lib/stripe.ts`, final signatures ratified in [18-stripe-connect-decision.md](./18-stripe-connect-decision.md)):

- `createConnectedAccount({ country, email, metadata: { organizationId } })` → `{ providerAccountId }` — account type per doc 18.
- `createAccountOnboardingLink({ providerAccountId, returnUrl, refreshUrl })` → `{ url, expiresAt }` — Stripe-hosted Account Link, **single-use, short-lived, never persisted, never logged**.
- `retrieveConnectedAccount({ providerAccountId })` → normalized `ConnectedAccountSnapshot` — the same normalized shape the webhook reducer consumes, produced by one shared `normalizeAccountSnapshot()` function so webhook-driven and retrieve-driven syncs cannot diverge.

Sequence for `POST /api/revenue/connect/account` (`authorize("revenue.connect_manage", { mutating: true })`):

1. Precondition checks (no writes): `REVENUE_CHARGING = test` and Stripe env present — otherwise 409 "Payment provider not configured" and the settings surface never showed the button (graceful degradation per ADR-017/032). Request body carries `termsVersion` + explicit acceptance boolean (§6.3).
2. **TX-1** (`db.$transaction`): create the `ConnectedAccount` row — `status PENDING`, `providerAccountId null`, `termsVersion/termsAcceptedAt/termsAcceptedByUserId/termsAcceptedByLabel`, `onboardingInitiatedAt/ByUserId/ByLabel`, `country "US"`, `defaultCurrency "USD"` (Part 2 fixed values, §6.4). `organizationId @unique` makes double-initiation structurally impossible: on unique violation, load and reuse the existing row (idempotent re-entry — the admin who double-clicks or the second admin racing the first both land on the same row).
3. Post-commit: `recordAudit revenue.connect_onboarding_started` (+ terms metadata: version, acceptance timestamp).
4. **⟂ async hop — provider call, never inside a transaction:** if `providerAccountId` is null, call `createConnectedAccount` with deterministic idempotency key **`ca_<organizationId>`** (once-per-org operation ⇒ once-per-org key; concurrent or retried calls get the same provider account back — ADR-033 style).
5. **TX-2** (short follow-up): guarded claim `updateMany WHERE id AND providerAccountId IS NULL SET providerAccountId` — `count === 0` means another request already recorded it; discard and re-read. Audit `revenue.connect_account_created` with the opaque `acct_…` reference.
6. **⟂ async hop:** call `createAccountOnboardingLink` with `returnUrl = /settings/payments/connect/return`, `refreshUrl = /settings/payments/connect/refresh`.
7. Respond `{ url }`; the client redirects the admin to Stripe-hosted onboarding. The URL is returned once, marked no-store, and never written to logs, audit metadata, or the database.

The org admin completes identity/business/bank collection **on Stripe**. AeroOps sees none of it.

### 3.5 Status sync — the `account.updated` reduce

Account lifecycle events (`account.updated`, `account.application.deauthorized`) arrive on the Connect webhook endpoint and flow through the Part 1 pipeline ([09](./09-payment-timing-and-collection.md) §2.10): signature verified first, `PaymentProviderEvent` unique-insert on `[provider, providerEventId]`, idempotency keyed on `processedAt`.

**Tenancy resolution for account-level events** — an extension of doc 09's local-references-only rule, consistent with its principle: account events carry no PaymentIntent, so resolution is via the **local `ConnectedAccount` row** looked up by the event **envelope's** connected-account id (`@@unique([provider, providerAccountId])`). The envelope `account` field is written by Stripe into the signed payload — unlike object `metadata`, it is not controllable by any connected-account holder — so it is safe for lookup. The account object's `metadata.organizationId` (set by AeroOps at creation, step 4 above) is then used as a **must-match cross-check**: on mismatch the event is stored unprocessed with a `processingError`, exactly the doc 09 idiom. Unknown account ids (no local row) are stored and marked ignored with a note, never errored.

Reduce, in its own transaction (**TX-W**):

1. `normalizeAccountSnapshot(event.payload.object)` → snapshot with `asOf = event.created` (provider clock).
2. Pure reduce `reduceConnectedAccount(currentRow, snapshot)` → `{ mirroredFields, derivedStatus, changedFields }` (framework-free, fixture-tested per the repo's DB-free testing standards — spec Part AC).
3. **Out-of-order guard:** guarded `updateMany WHERE id AND providerStateAsOf < snapshot.asOf` (null passes). Stripe does not guarantee event ordering; an older event arriving late loses the claim (`count === 0`) and is marked processed as a stale no-op. `providerStateAsOf` is the provider-clock watermark; `lastStatusSyncAt` (our clock) is stamped on every successful reduce.
4. `firstEnabledAt` stamped the first time `chargesEnabled` flips true. `deauthorizedAt` stamped on `account.application.deauthorized`.
5. `PaymentProviderEvent.processedAt` set in the same transaction.
6. Post-commit only: `recordAudit revenue.connect_status_changed` (actor label `system:webhook`; metadata: before/after status + changed mirrored fields), `emitDomainEvent connected_account.status_changed` (registered in `WEBHOOK_EVENTS` with this live emit site), Notification rows per §7. The in-process bus is fan-out only — the DB row is the truth (ADR-009).

**Payload redaction (Security lead requirement):** for account-level events, the stored `PaymentProviderEvent.payload` is reduced through an **allowlist** before insert — `id`, `charges_enabled`, `payouts_enabled`, `details_submitted`, `requirements` (keys + deadlines only), `capabilities`, `country`, `default_currency`, `business_type`, `settings.payments.statement_descriptor`, `metadata`, `created`. Person/legal-entity sub-objects (`individual`, `company`, owner/representative hashes) are **never persisted** — they can carry KYC-adjacent PII (names, DOB, addresses) that AeroOps has no reason to hold. This tightens, and does not conflict with, doc 13's forensic-payload rule: everything needed to replay the reduce is retained.

### 3.6 Return and refresh URLs — never trusted

- `returnUrl` → `/settings/payments/connect/return`: reaching this page means only "the admin came back," **not** "onboarding completed" (Part T: no trust in client redirect — the same rule that forbids marking a payment paid on redirect). The page's server component triggers a retrieve-and-reduce sync (§3.7) and renders whatever the derived status actually is: Pending verification, Requirements due, or Enabled.
- `refreshUrl` → `/settings/payments/connect/refresh`: the Account Link expired or was reused. The server mints a fresh link (adapter call, no DB write) and 303-redirects straight back to Stripe. If the admin's session lacks `revenue.connect_manage`, render the status page instead of minting a link.

### 3.7 Re-sync strategy: webhook-driven + reconciliation fallback

Three sync paths, one reducer:

1. **Webhook (primary):** `account.updated` reduce, §3.5. Near-real-time.
2. **Manual refresh:** "Refresh status" on the org settings page (`POST /api/revenue/connect/sync`, `revenue.connect_manage`) and "Sync now" in the Platform Console (`platform.connect.suspend` holders; `authorizePlatform({ mutating: true, orgId })`). **⟂ async hop:** `retrieveConnectedAccount` with a timeout, then the same TX-W reduce with `asOf = retrieval time`. Also fired automatically by the return page (§3.6) and after platform reinstatement (§3.3).
3. **Reconciliation sweep (backstop):** the Part T reconciliation job (which already re-drives stored-but-unprocessed `PaymentProviderEvent` rows per doc 09 §2.10) gains a bounded pass — `ConnectedAccount WHERE providerAccountId IS NOT NULL AND status NOT IN (DISABLED) AND lastStatusSyncAt < now − staleness` (default 7 days, matching the `RevenueSettings` reconciliation staleness window), limit 25 per pass, retrieve-and-reduce each, per-row outcomes in the Import Center style. A drifted account (Stripe restricted it; we missed the webhook) is a `ReconciliationException` candidate only if retrieve also fails; a successful late sync is just a status change with audit. This satisfies spec Part T's "connected-account restrictions" detection.

Until the scheduler seam lands (D14/Inngest), the sweep runs inside the existing runner/reconciliation pass triggers (post-commit, manual, platform sweep) — same honest limitation, surfaced the same way, as doc 09 §2.9.

### 3.8 The hard gate: no charge initiation unless the account is ready

Pure predicate in `src/lib/connect-account.ts`:

```
connectedAccountReady(account): boolean
  = account exists
  && account.chargesEnabled === true
  && derivedStatus(account) ∈ { ENABLED, REQUIREMENTS_DUE }
  // by construction this excludes NOT_STARTED, PENDING, RESTRICTED, DISABLED, SUSPENDED
```

`REQUIREMENTS_DUE` is ready-with-warnings: Stripe is still processing charges; blocking them would punish the school for paperwork Stripe hasn't yet made blocking. The warning ("Stripe needs information by \<date\> — payments will be interrupted if not provided") rides the readiness reason list.

Enforcement points — the gate is checked at **every** initiation seam, and the payer-facing consequence is always graceful degradation, never a stuck workflow:

| Seam | Owner | Behavior when not ready |
|---|---|---|
| Payment readiness engine (`src/lib/payment-readiness.ts`, doc 09 §5.2) | This doc adds the row | New check: **Connected account ready** → `NOT_READY` for charging policies with the human reason ("Payments account not set up" / "…restricted" / "…suspended"); `MANUAL_INVOICE` and offline recording remain fully available — identical degradation shape to `REVENUE_CHARGING=off`. |
| Approval verification (spec Part S list: "Connected account is ready") | [22-approval-to-payment.md](./22-approval-to-payment.md) | Re-evaluated at approval time. Not ready + charging policy → effective policy converts to `MANUAL_INVOICE` and the approve control says so verbatim (consequence-truthful wording per doc 03); the org's `approveWithoutMethod = BLOCK` posture applies to this conversion too (BLOCK ⇒ approval disabled with the actionable reason). *Simpler-workflow choice: approval never stalls on payments paperwork — the review approves, the invoice goes out manually, and the school keeps flying.* |
| Charge initiation, every path (payment runner, manual charge, auto-retry — doc 09 §5.1) | Payment runner | Check **0**, before the `SCHEDULED → PROCESSING` claim: account not ready ⇒ no claim, no attempt row, no provider call. The `ScheduledCharge` stays `SCHEDULED` with a per-row outcome ("Connected account not ready: \<reason\>") visible in the due-charges queue. Nothing is silently skipped or cancelled. |
| Hosted method-setup sessions (`createSetupSession`) and `PaymentCustomer` creation | Payment-methods doc (Part Q owner) | Refused while the account is `SUSPENDED`/`DISABLED`/`NOT_STARTED` (customers and methods live **on** the connected account); allowed in `PENDING`/`REQUIREMENTS_DUE`/`RESTRICTED` so payers can save methods while the school finishes paperwork. |
| Provider refunds | Refund/dispute doc (Part V owner) | A provider refund on a non-ready account may fail at the provider; the doc 08 fallback (`CUSTOMER_CREDIT` / `MANUAL` destination) applies. This doc only guarantees the gate never blocks *recording* truth. |

Never gated on account readiness: webhook processing (truth-tracking of already-moving money must continue — §3.9), offline payment recording, zero-total review completion, voids, adjustments, exports, and all operational (dispatch/return) flows.

### 3.9 Suspension and deauthorization

Two distinct halts:

- **`SUSPENDED`** — an AeroOps platform hold (fraud signal, commercial dispute, offboarding). Provider account may be fully functional; AeroOps refuses to initiate new movement.
- **`DISABLED`** — the provider side is gone or rejected (`rejected.*`, `listed`, or `account.application.deauthorized`). AeroOps couldn't charge even if it wanted to.

Rules, in both cases:

1. **New charge initiation stops immediately** (§3.8 check 0). No new `PaymentAttempt` rows.
2. **In-flight attempts are never cancelled locally.** Attempts in `CREATED`/`PROCESSING` — including ACH sitting in its ~4-business-day window — represent money that may already be moving. Webhooks keep reducing them to terminal states exactly as before (webhook processing is not gated). Reviews in `PAYMENT_PROCESSING`/`ACH_PENDING` ride to their true outcome. **Never synthesize a failure** (Part 1 binding). If Stripe itself froze the in-flight payment, Stripe's terminal event says so and the normal failure workflow (Part U owner doc) takes over.
3. **Queued `ScheduledCharge` rows (`SCHEDULED`/`AWAITING_MANUAL`) are held, not cancelled.** They surface in the due-charges queue with the blocking reason. If the account is reinstated, they become runnable at the next runner pass with zero re-configuration; if the org is permanently offboarded, cancelling them is an explicit, audited operator action (`revenue.charge`), never automatic.
4. **Queued/approvable reviews keep flowing** under the §3.8 degradation: approval converts charging policies to `MANUAL_INVOICE`; offline recording still settles invoices; the fee/allocation machinery is unaffected (offline collections still mark `PlatformFee` EARNED, per doc 12).
5. **Saved methods and customers are not mass-mutated.** `PaymentMethodReference`/`PaymentCustomer` rows keep their statuses (their state machines are bound in doc 13); unusability is enforced at the account gate, one level up. Deauthorization severs provider access, not local history.
6. **Notifications:** org Account Owner + `revenue.connect_manage` holders notified on suspend/disable/reinstate; platform staff with `platform.connect.view` see it in the console (§9).
7. **Reinstatement** (from `SUSPENDED` only): clears `suspendedAt` in the action transaction, re-derives status from last-synced facts, fires an immediate sync, audits with reason. `DISABLED` is terminal in Part 2 — re-provisioning a replacement provider account is deferred (§10, Q4).

---

## 4. Configuration surface

Deliberately minimal. Onboarding has **no org-tunable knobs** — the flow is identical for every school (strong-defaults principle 10).

**Org-level:** none. No new singleton, no new `RevenueSettings` fields. The only org inputs are the initiate action and the in-app terms acceptance it records.

**Platform-level (actions, not config):** suspend / reinstate / sync-now, §3.3 and §7. Platform-fee terms are elsewhere (Part W owner doc; `PlatformFeePolicy` per doc 13 — never org-editable).

**Environment (extends the doc 09 §3 table; validated together in `assertProductionEnv`, partial configuration fails loudly at boot):**

| Var | Values | Default | Effect |
|---|---|---|---|
| `REVENUE_CHARGING` | `off \| test` | `off` | `off`: no adapter — the settings card reads "Online payments are not yet available," no initiate button, everything else (manual invoice, offline recording) fully functional. `test`: Stripe test-mode adapter active; onboarding creates **test-mode** connected accounts only. A `live` value does not exist in this phase. |
| `STRIPE_CONNECT_SECRET_KEY` | env only | unset | Revenue Engine (System 2) connected-account key, used by `src/lib/stripe-connect.ts` — restricted key (`rk_test_…`) recommended, or `sk_test_…`; test-mode only in this phase. **Distinct from System 1's `STRIPE_SECRET_KEY`** (SaaS billing), which Revenue Engine code never reads — the System-2 key names are finalized in [17-two-financial-systems.md](./17-two-financial-systems.md) §7 and restated in [18-stripe-connect-decision.md](./18-stripe-connect-decision.md) §9.1. Never in application data or logs (principle 8). |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | env only | unset | Signing secret for `/api/webhooks/stripe-connect` — a **separate secret from the SaaS-billing endpoint's** (`/api/webhooks/stripe`, spec Part N: two money systems, two endpoints, two secrets). Route inert without it. Exact env naming ratified in the Part T webhook doc. |

Defaults fixed in code for Part 2 (not configuration): `country = "US"`, `defaultCurrency = "USD"` (§6.4).

---

## 5. Data model additions (Prisma-flavored; final call in [34-part2-database-additions.md](./34-part2-database-additions.md))

Doc 13 conventions applied: `id cuid`, `organizationId` + real `Organization` relation with explicit `onDelete`, tenant-scoped uniques, org-leading indexes, actor display-labels (R18), `CANCELLED`-style spellings n/a. No monetary columns exist on this model — nothing to snapshot, no `Decimal` needed.

```prisma
/// Spec Part P statuses, exactly. Values never renamed once shipped.
enum ConnectedAccountStatus {
  NOT_STARTED       // reserved for completeness; an absent row represents it — no writer stores this value
  PENDING
  REQUIREMENTS_DUE
  RESTRICTED
  ENABLED
  DISABLED
  SUSPENDED
}

/// Org 1:1 mapping to the payment provider's connected account (spec Part P).
/// A mirror of provider facts + AeroOps control fields — never a financial
/// record: no balances, no payout amounts, no KYC values, no secrets.
/// Absent row = NOT_STARTED. Row is never deleted while payment history
/// exists (org-wipe handles teardown).
model ConnectedAccount {
  id                String                 @id @default(cuid())
  organizationId    String                 @unique // structural 1:1 — an org cannot acquire two accounts
  provider          PaymentProvider        @default(STRIPE)
  providerAccountId String?                // opaque acct_… reference — not a secret; null during the provisioning window
  status            ConnectedAccountStatus @default(PENDING) // stored projection of §3.2; recomputed on every sync

  // ---- Provider-mirrored facts (written only by the sync reducer) ----
  chargesEnabled   Boolean  @default(false)
  payoutsEnabled   Boolean  @default(false)
  detailsSubmitted Boolean  @default(false)
  /// Requirement KEYS + deadline only — never submitted values:
  /// { currentlyDue: string[], eventuallyDue: string[], pastDue: string[], currentDeadline: string | null }
  requirementsDue  Json?
  disabledReason   String?  // provider vocabulary (e.g. "requirements.past_due", "rejected.fraud"); catalog-validated in src/lib
  country          String?  @db.Char(2) // ISO 3166-1 alpha-2; "US" in Part 2
  defaultCurrency  String?  @db.Char(3) // ISO 4217 uppercase (normalized from provider lowercase); "USD" in Part 2
  businessType     String?  // "individual" | "company" | "non_profit" — engine-validated catalog (R25)
  statementDescriptor String? // what payers see on statements — mirrored for display, edited on Stripe (Part 2)
  /// Requested-capability statuses, e.g. { card_payments: "active", us_bank_account_ach_payments: "pending" }
  capabilities     Json?
  providerStateAsOf DateTime? // provider-clock watermark — out-of-order webhook guard (§3.5 step 3)
  lastStatusSyncAt  DateTime? // our clock; staleness signal for the reconciliation sweep

  // ---- AeroOps control fields ----
  termsVersion            String?   // AeroOps connected-payments terms version accepted in-app (§6.3)
  termsAcceptedAt         DateTime?
  termsAcceptedByUserId   String?
  termsAcceptedByLabel    String?
  onboardingInitiatedAt   DateTime?
  onboardingInitiatedByUserId String?
  onboardingInitiatedByLabel  String?
  firstEnabledAt   DateTime? // write-once: first time chargesEnabled flipped true
  suspendedAt      DateTime? // sticky platform hold (§3.3); status derives SUSPENDED while set
  suspendedReason  String?
  suspendedByLabel String?   // platform-staff display label (R18)
  deauthorizedAt   DateTime? // account.application.deauthorized

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId]) // webhook tenancy: signed envelope account id → exactly one org (nulls exempt)
  @@index([status, lastStatusSyncAt])     // platform console queue + reconciliation staleness sweep (authorizePlatform-only cross-org read)
}
```

Shape notes for doc 34:

- **`NOT_STARTED` has no writer** — same reservation idiom as `WRITTEN_OFF` (doc 03) and `RevenueLineOrigin.RULE`. The enum carries the spec's full status vocabulary; the absent row *is* the state. UI/status-tone layers render it from the null row.
- **No FK from `PaymentAttempt` to `ConnectedAccount`** — doc 13's `PaymentAttempt` shape is bound and gains no columns here. The account for any historical attempt resolves through `organizationId` → the 1:1 row, which is stable because the row is never deleted or re-pointed in Part 2 (re-provisioning is deferred, §10; if Part 3 allows replacement accounts, it must revisit this resolution — flagged there).
- **Org-snapshot:** `ConnectedAccount` joins capture/wipe/restore (it is org configuration), deleted in the singletons/config step (doc 13 §10.2 step 28 — nothing Restricts onto it). Caution documented for operators: wiping/restoring changes the local linkage row only; the provider-side account is external and untouched.
- **Schema-governance:** org FK with explicit `onDelete` + tenant-scoped unique — auto-covered by `tests/schema-governance.test.ts`.
- **STATUS_TONE:** all seven values registered once in `src/lib/status-colors.ts` (`ENABLED` green, `REQUIREMENTS_DUE` amber, `PENDING`/`NOT_STARTED` gray, `RESTRICTED`/`SUSPENDED` red, `DISABLED` red/gray) — single-source rule; keys that already exist in the map keep their tone.

No other model changes. `PaymentProviderEvent`, `PaymentCustomer`, `PaymentMethodReference`, `ScheduledCharge`, `PaymentAttempt` are used exactly as bound in doc 13.

---

## 6. Validation & business rules

1. **One account per org, structurally.** `organizationId @unique` + idempotent initiate (§3.4 step 2). No API accepts a client-supplied `providerAccountId` — ever; the only writer of that column is the TX-2 claim fed by the adapter's response.
2. **Provider calls never inside a DB transaction** (Part S / Part AB auto-reject; ADR-011/025 lineage). Both onboarding hops and every sync retrieve are post-commit/async with timeouts; the account-creation call carries the deterministic idempotency key `ca_<organizationId>`.
3. **Terms before provider contact.** The initiate request must carry an explicit acceptance of the AeroOps connected-payments terms (`termsVersion` from a `src/lib` catalog); recorded in TX-1 (payer-consent idiom from doc 11's `billingAuthorizationVersion`, applied org-side) and audited. This is AeroOps' own terms record — Stripe collects its ToS acceptance on the hosted surface (the "where appropriate" reading of spec Part P: for hosted onboarding, provider ToS acceptance lives with the provider; AeroOps records what AeroOps asked the org to accept). The terms text itself requires legal review before any live launch (Part O).
4. **Country/currency clamp (Part 2):** `country` is fixed `"US"`, `defaultCurrency` must normalize to `"USD"` and must equal the org currency (`RevenueSettings.currency` recommendation, doc 13 §12 Q4). A sync that reports a different provider currency flips readiness's **Currency is supported** check (Part S) to `NOT_READY` and flags the account in the Platform Console — account-level drift is a readiness reason plus a console flag, not a `ReconciliationException` row (that model stays payment-scoped per doc 13). Multi-country/multi-currency is out of scope (Parts 1–2 binding).
5. **Requirement keys only.** `requirementsDue` stores Stripe requirement field names (e.g. `company.tax_id`) and deadlines — never submitted values, never documents. The §3.5 payload allowlist enforces the same rule on the forensic store. No column in this design may hold PAN, bank numbers, tax IDs, SSN fragments, tokens, or secrets (principle 8; Part AB).
6. **Account Links are secrets in transit:** returned once to the initiating client, `Cache-Control: no-store`, absent from logs/audit/DB. A leaked link is time-boxed and single-use by the provider, but AeroOps still treats it as sensitive.
7. **Envelope-based tenancy with must-match cross-check** (§3.5). Attribution never comes from object metadata; metadata mismatch stores the event unprocessed with `processingError`.
8. **Mirror, don't gate:** the reducer accepts any provider-derived state (out-of-order-guarded); AeroOps-side gates act only on *new* initiation (§3.8). No code path synthesizes a provider fact.
9. **Statement descriptor is display-only in Part 2** — mirrored for the payer-trust surfaces ("this is what your students see on their card statement"); editing routes to the Stripe dashboard/hosted surface. In-app descriptor editing is deferred (§10).
10. **Suspension requires a reason** (400 without one) and is platform-only; org staff can neither suspend nor reinstate their own account (Part AB: platform controls are never org-editable).

---

## 7. RBAC, approvals & audit

### Org-side permissions (data in `src/lib/permissions.ts`; `revenue.` prefix already maps to the `billing` module via `MODULE_BY_PREFIX`, doc 09 §6)

| Key | Grants | Default roles |
|---|---|---|
| `revenue.connect_manage` (new) | Initiate onboarding, accept terms, continue/refresh onboarding links, manual status sync | ACCOUNT_OWNER (see Open question 1 for SCHOOL_ADMIN) |
| `revenue.payment_policy_manage` (existing, doc 09) | View the payments-status card in Settings (read) | ACCOUNT_OWNER, SCHOOL_ADMIN |

No AI pathway may initiate onboarding, accept terms, suspend, or sync (constitution rule 8 posture: account lifecycle is human-initiated; syncs are human- or system-triggered, never model-triggered). Read-only impersonation blocks all of the above (`{ mutating: true }` everywhere).

### Platform-side permissions (data in `src/lib/platform-permissions.ts`; `.view` = non-mutating by convention)

| Key (new) | Grants | Roles |
|---|---|---|
| `platform.connect.view` | See the Connected payments panel: status, requirements keys + deadline, capabilities, flags, sync recency, opaque `acct_…` id. **No balances, payouts, customer data, or secrets — the model cannot store them (§5).** | FOUNDER_SUPER_ADMIN, FOUNDER, PLATFORM_ADMIN, BILLING_ADMIN, SUPPORT_ENGINEER, SOFTWARE_ENGINEER, CUSTOMER_SUCCESS (+ AUDITOR via the view-only rule) |
| `platform.connect.suspend` | Suspend / reinstate an org's connected account (reason required); "Sync now" | FOUNDER_SUPER_ADMIN, FOUNDER, PLATFORM_ADMIN, BILLING_ADMIN |

Routes derive role lists via `platformRolesWith()`; org-targeting platform routes enforce `restrictedOrgIds` (`authorizePlatform({ orgId })`) — both constitution-tested automatically.

### Routes (thin: authorize → zod → engine → audit → emit)

| Route | Gate |
|---|---|
| `GET /api/revenue/connect/account` | `authorize("revenue.payment_policy_manage")` — status for the settings card |
| `POST /api/revenue/connect/account` | `authorize("revenue.connect_manage", { mutating: true })` — initiate (§3.4) |
| `POST /api/revenue/connect/onboarding-link` | same — continue/fix: mints a fresh Account Link for the existing account |
| `POST /api/revenue/connect/sync` | same — manual retrieve-and-reduce |
| `POST /api/platform/organizations/[id]/connect/suspend` · `/reinstate` · `/sync` | `authorizePlatform(platformRolesWith("platform.connect.suspend"), { mutating: true, orgId })` |
| `/api/webhooks/stripe-connect` | PUBLIC — catalogued in `tests/constitution.test.ts` `PUBLIC_ROUTES` with written reason + `rateLimit()`; owned by the Part T webhook doc |

### Audit actions (`recordAudit`, reconstruct-without-DB-state metadata)

| Action | When | Metadata |
|---|---|---|
| `revenue.connect_onboarding_started` | Initiate TX-1 post-commit | termsVersion, acceptance timestamp, initiator |
| `revenue.connect_account_created` | TX-2 post-commit | opaque `acct_…`, idempotency key id |
| `revenue.connect_status_changed` | Any sync that changed status or mirrored fields | before/after status, changed fields, source (`system:webhook` \| `system:reconciliation` \| actor label), providerEventId when webhook-driven |
| `platform.connect_suspended` / `platform.connect_reinstated` | Platform action TX post-commit | reason, before/after status, platform actor (ADR-023 attribution) |

Every status change is therefore audited regardless of trigger; no-op syncs stamp `lastStatusSyncAt` without audit noise.

### Domain events & notifications

`connected_account.status_changed` registered in `WEBHOOK_EVENTS` with the §3.5 emit site (constitution requires a live emitter). Notification triggers handed to the Part AA doc (kinds are additive `NotificationKind` values, delivery in-app only until the email adapter exists — never claim email was sent): **payments ready** (first `ENABLED`), **requirements due** (with deadline), **payments paused** (`RESTRICTED`/`DISABLED`/`SUSPENDED`), **payments resumed**. Recipients: Account Owner + `revenue.connect_manage` holders.

---

## 8. Failure modes & edge cases

| Failure / edge | Behavior |
|---|---|
| Crash between TX-1 and the provider call | Row exists with null `providerAccountId` → derived `PENDING` (provisioning); settings card shows "Finish setup"; retry re-runs §3.4 steps 4–7 with the same `ca_<organizationId>` key — the provider dedupes. |
| Provider idempotency key expired (>24h) before a retry | A duplicate provider account could be created; the TX-2 guarded claim keeps exactly one linked locally, and the orphan is inert (no charges ever reference it — every charge resolves the account through the linked row). Platform staff deactivate orphans in the provider dashboard; noted honestly rather than engineered around. |
| Two admins initiate concurrently | Same row (unique + reuse), same idempotency key ⇒ same provider account; TX-2 claim (`count === 0`) makes the second writer a no-op. |
| Admin abandons Stripe onboarding mid-way | Status stays `PENDING`; "Continue setup" mints a fresh link any time; nothing expires locally. |
| Account Link expired / reused | Stripe redirects to `refreshUrl` → new link → back to Stripe (§3.6). |
| `account.updated` events arrive out of order | `providerStateAsOf` guarded claim (§3.5 step 3): stale events are recorded no-ops. |
| Webhook missed entirely | Reconciliation staleness sweep retrieves and reduces (§3.7); manual refresh available meanwhile. |
| Requirements deadline passes | Stripe flips `charges_enabled` false → `RESTRICTED`: gate closes, queued charges held with visible reason, org notified, approvals degrade to manual invoice. Recovery is fully webhook-driven — no operator action needed once the school submits the info. |
| Deauthorized (`account.application.deauthorized`) | `deauthorizedAt` set → `DISABLED`; §3.9 rules; platform staff notified (this usually means the school acted directly in Stripe). |
| Suspension while ACH in flight | In-flight attempts ride to terminal via webhooks; review stays `ACH_PENDING`; no synthesized outcome; new initiation blocked (§3.9). |
| Provider retrieve times out during sync | No local change, `lastStatusSyncAt` untouched (staleness keeps it in the sweep); per-row outcome recorded; every provider call carries a timeout. |
| `REVENUE_CHARGING=off` with an existing row | Charging surfaces degrade exactly as doc 09 §3; the status card renders read-only ("Payments are configured but charging is disabled in this environment"). |
| Org suspended at the SaaS level (`Organization.status`) | `authorize()` already blocks org staff; the connected account is untouched (two money systems — SaaS status never mutates Connect state, and vice versa). |
| Demo/seed orgs | Fixtures with fake `acct_…` references and no adapter calls: demo org `ENABLED` (so payment flows are demonstrable), Blue Ridge `REQUIREMENTS_DUE` with a near deadline (so the warning UX is demonstrable). Demo logins untouched. |
| Restore of an org snapshot | Restores the linkage row only; the provider account is external. Operator-facing note in the snapshots panel. |

Contract tests (DB-free, per repo standards / spec Part AC): derivation matrix for all seven statuses (fixture per row of §3.2), out-of-order event no-op, `connectedAccountReady` truth table, payload-allowlist redaction (person hashes stripped), reducer idempotence (same snapshot twice = no change), plus the static constitution/schema-governance scans that cover the new routes and model automatically.

---

## 9. UX notes

### Org settings — the "Payments" card (replaces the settings page's "Stripe payments: Planned" badge)

One card, one primary action, plain language — a Director of Operations or owner should never need Stripe vocabulary:

| State | Card copy | Primary action |
|---|---|---|
| `NOT_STARTED` | "Accept online payments from your students. Setup takes about 10 minutes and is handled securely by Stripe." | **Set up payments** (terms checkbox + version shown inline) |
| `PENDING` | "Setup in progress — Stripe is verifying your information." | **Continue setup** / Refresh status |
| `REQUIREMENTS_DUE` | "Payments are on. Stripe needs more information by **Jul 22** or payments will pause." | **Provide information** (fresh onboarding link) |
| `RESTRICTED` | "Payments are paused — Stripe needs information from you. Your invoices can still be sent and paid by cash or check." | **Fix issues** |
| `ENABLED` | "Payments are on. Statement descriptor: *BLUE RIDGE AVIATION*. Cards ✓ · Bank debits (ACH) ✓/pending" | Refresh status |
| `DISABLED` / `SUSPENDED` | "Payments are unavailable. Contact AeroOps support." (+ reason category, never raw provider codes) | Contact support |

Requirement keys are translated to human labels via a `src/lib` catalog ("company.tax_id" → "Business tax ID"), with an honest fallback to the raw key for unmapped entries. *Simpler-workflow choice: one status card with one next action, instead of exposing Stripe's requirements taxonomy — the accountant sees what's needed and by when, nothing else.* Light/dark + mobile parity; loading/empty/error states; every status chip tones from `STATUS_TONE`.

### Platform Console

- **Org detail panel** (`src/app/platform/organizations/[id]/page.tsx` — new `ConnectPanel` beside `NotesPanel`/`SnapshotsPanel`, rendered only for `platform.connect.view`): status chip, opaque `acct_…` id (support staff need it to find the account in the provider dashboard — it is an identifier, not a credential), charges/payouts flags, capabilities, requirement keys + deadline, disabled reason, country/currency/business type, statement descriptor, terms version + acceptance, last sync, suspension block with reason. Buttons (only for `platform.connect.suspend`): **Sync now**, **Suspend…** (reason dialog), **Reinstate…**. Explicitly absent, by model construction: balances, payout amounts, charge volumes, customer identities, KYC data, keys.
- **Orgs list**: a "Payments" status column + filter for `platform.connect.view` holders — the cross-org "who needs attention" scan (accounts in `REQUIREMENTS_DUE` sorted by deadline, `RESTRICTED`/`DISABLED`/`SUSPENDED` flagged). A dedicated cross-org queue page is deferred (§10).
- Restricted staff see only orgs in their `restrictedOrgIds` scope (existing constitution rule).

---

## 10. Out of scope for Part 2 / deferred to Part 3+

- **Live mode.** No `REVENUE_CHARGING=live`, no live keys, no live accounts. Live launch additionally requires the Part O legal/accounting review and the approved threat model.
- **Replacement accounts after `DISABLED`** — re-provisioning a second provider account for an org (tension with the structural 1:1; needs a deliberate design for historical attempt→account resolution). Terminal-state orgs are platform-support cases in Part 2.
- **In-app statement-descriptor editing**, payout schedule display, balance/payout visibility (payout *webhook ingestion* into `ProviderPayout` is the Part T/reconciliation docs' territory).
- **Dedicated cross-org platform queue page** for account attention states (list column + org panel suffice for pilot scale).
- **Scheduler-driven reconciliation cadence** — the staleness sweep rides existing triggers until the queue/cron adapter lands (D14).
- **Email notifications** — in-app Notification rows only until the email adapter exists; the requirements-deadline risk this leaves is Open question 2.
- **Non-US countries, non-USD currencies, multiple locations with separate accounts** (one account per org is the Part 2 shape).

---

## 11. Open questions

1. **Default grant for `revenue.connect_manage`:** ACCOUNT_OWNER only (recommended — terms acceptance and bank linkage are owner-level acts at a flight school), or also SCHOOL_ADMIN? Orgs can always grant it via role config either way. *Product owner call.*
2. **Requirements-deadline risk without email:** until the email adapter lands, "Stripe needs your tax ID by Jul 22" reaches the org via in-app notification + settings banner only. Acceptable for the pilot cohort, or does this pull a minimal email adapter into Part 2's successor slice? *Product owner call (operational-risk acceptance).*
3. **AeroOps connected-payments terms:** the `termsVersion` catalog needs an actual reviewed terms document (Part O requires legal/accounting review before live). Who commissions it, and does test-mode piloting proceed on a draft version? *Product owner call.*
4. **Platform-side vs provider-side suspension:** Part 2 suspension is an AeroOps-side hold only (provider account untouched). Whether AeroOps should also pause/reject the account at the provider (capability depends on the account type chosen in [18-stripe-connect-decision.md](./18-stripe-connect-decision.md)) is a policy call with offboarding implications. *Product owner + doc 18 owner.*

---

## Related documents

[18-stripe-connect-decision.md](./18-stripe-connect-decision.md) (account type, charge topology, funds flow) · [22-approval-to-payment.md](./22-approval-to-payment.md) (approval-time readiness enforcement) · [34-part2-database-additions.md](./34-part2-database-additions.md) (final model shapes) · [09-payment-timing-and-collection.md](./09-payment-timing-and-collection.md) (readiness engine, runner, webhook pipeline) · [13-database-model.md](./13-database-model.md) (canonical Part 1 schema) · [16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md) (D1) · [01-revenue-engine-architecture.md](./01-revenue-engine-architecture.md) §11 (Part 1 Connect position)
