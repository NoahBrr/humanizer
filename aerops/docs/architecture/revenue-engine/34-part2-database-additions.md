# Part 2 Database Additions

> **Status:** Proposed — Phase 8 Part 2 · **Date:** 2026-07-10 · **Lead roles:** Database Architect; Principal Software Architect at Stripe; Financial Systems Architect · **Part of:** Revenue Engine design set ([README](./README.md))

This document is **canonical and binding for every NEW Part 2 model, enum, column, constraint, and index**. Where a Part 2 design doc (17–31) and this document disagree on a name, type, constraint, or FK action, **this document wins**; every such override is listed in §2 so the consistency pass can align the set. [13-database-model.md](./13-database-model.md) remains canonical for everything Part 1 bound — this document only *extends* it (additive columns, additive enum values, back-relations) and never reinterprets it. The one place a Part 1-bound constraint must be amended before it ships is called out explicitly (§2 R-P9) and flagged in Open questions (§13).

Scope: design only. Nothing here touches `prisma/schema.prisma` in Part 2's design phase; no migration is generated or run; Stripe test mode is the only sanctioned provider environment and is not exercised.

All doc 13 §4.1 conventions apply unchanged to every model below (cuid ids, tenant scoping with a real `Organization` relation and explicit `onDelete`, `createdAt`, org-leading indexes, tenant-aware uniques, `…ById`/`…ByLabel` actor attribution, explicit FK actions on every financial relation, additive-enum discipline). Money follows doc 13 §2 exactly: `Decimal(12,2)` + explicit ISO 4217 `@db.Char(3)` currency on financial rows — never floats, never integer minor units.

---

## 1. Part 2 expected concepts → dispositions

The spec's Part 2 concept list, audited against doc 13 (which pre-bound most of the payment slice) and docs 17–31.

| Spec / Part L concept | Disposition | Canonical model | Notes |
|---|---|---|---|
| Connected account record (Part P) | **New model** | `ConnectedAccount` | §4.1; name arbitrated in §2 R-P1 |
| PaymentCustomer | **Bound in Part 1 — unchanged** | `PaymentCustomer` (13 §4.12) | Part 2 fixes semantics only: `providerCustomerId` lives on the org's connected account; lazy creation with deterministic provider idempotency key `cust_<orgId>_<party>_<partyId>` (doc 20). Gains `consents` back-relation |
| PaymentMethodReference | **Bound — extended** | `PaymentMethodReference` (13 §4.12) | +`verifiedAt`, `verificationPath` (ACH verification evidence, doc 20); §5.6 |
| Off-session consent record (Part Q) | **New model** | `PaymentConsent` + `BillingAuthorizationText` | §4.2–4.3; validity is derived at read — no stored consent-status enum (§2 R-P12) |
| PaymentRequest / outbox (Part S) | **Covered — no new model** | `ScheduledCharge` (13 §4.12) | The payment-request/outbox record *is* the ScheduledCharge (doc 22 formalizes the outbox semantics). Extended: `adjustmentId` + partial uniques (§5.2), `failureEscalatedAt` (doc 25) |
| PaymentAttempt | **Bound — extended** | `PaymentAttempt` (13 §4.12) | +`REQUIRES_ACTION` status, `providerStatus`, `requiresActionAt`, `actionExpiresAt` (doc 21); `applicationFeeAmount`, `providerAccountId` (doc 22); §5.1 |
| PaymentTransaction | **Bound in Part 1 (R17) — extended** | `Payment` | +settlement-time provider-fee actuals: `providerBalanceTransactionId`, `providerFeeAmount`, `providerFeeRecordedAt` (doc 28); §5.3 |
| Refund | **Bound — extended** | `Refund` (13 §4.10) | +`origin` (doc 21), `providerRefundId @unique`, compensation-decision fields (doc 26); §5.4 |
| Dispute | **Bound — extended** | `Dispute` (13 §4.10) | +liability, funds-impact, evidence, dispute-fee, compensation-decision fields (docs 26/28); §5.5. New child `DisputeEvidence` (§4.4) |
| WebhookEvent (Part T) | **Bound as `PaymentProviderEvent` (R16) — extended** | `PaymentProviderEvent` | +processing state machine, endpoint/account context, quarantine metadata (doc 23); §5.7. The existing `Webhook`/`WebhookDelivery` models remain *outbound* org webhooks and are never conflated. System 1's future `BillingEvent` (doc 17) is **not** Part 2 work |
| PlatformFee snapshot (Part W) | **Bound — extended** | `PlatformFee` (13 §4.13) | +rail/tier/volume accrual snapshot + `termsSnapshot` (doc 27); §5.8 |
| Platform Fee Agreement (Part W) | **Bound as `PlatformFeePolicy` — extended** | `PlatformFeePolicy` + new child `PlatformFeeTier` | "Platform Fee Agreement" is the product-facing name; the model name stays `PlatformFeePolicy` (§2 R-P5). +kind/label/ACH-rail terms; tiers in §4.5 |
| Revenue allocation / ledger (Part X) | **Bound — enum extensions only** | `RevenueAllocation`, `LedgerEntry` | `AllocationCategory` +7, `AllocationEvent` +2, `LedgerAccount` +1 (doc 28); §7. Zero new columns |
| Instructor Compensation (Part Y) | **Bound — extended** | `InstructorEarning` (13 §4.7) | +`HELD` status, `earnedAt`, `adjustmentId` (doc 29); §5.9. New model `CompensationReversalDecision` (§4.7) |
| Financial hold (Part U) | **New model** | `FinancialHold` | §4.6; feeds new `CheckoutRestrictionKey.MEMBERSHIP_FINANCIAL_HOLD` |
| Reconciliation job report (Part T) | **New model** | `ReconciliationRun` | §4.8; `ReconciliationExceptionKind` gains 4 values |
| Notifications (Part AA) | **Existing model extended** | `Notification` + new `NotificationPreference` | §5.10 / §4.9; `NotificationKind` +10 (§2 R-P8 arbitrates names) |
| Revenue Dashboard (Part Z) | **Zero schema** | — | Doc 30 deliberately reads existing models/indexes only. The optional GIN index on `RevenueReview.riskFlags` is **deferred** pending real-volume telemetry (§13 Q5) |
| Organization (System 1 / System 2 boundary, Part N) | **Zero columns** | — | Binding: Part 2 adds **no Connect or payment columns to `Organization`** (doc 17). Connect state lives on `ConnectedAccount`; System 1 SaaS-billing columns are Phase C (PRODUCTION.md §13.2), not Part 2. Back-relations only (§6) |

**Verdict:** 9 new models, 13 extended Part 1-bound models (plus back-relation-only touches on `PaymentCustomer` and `RevenueAdjustment`), 1 extended pre-Phase-8 model (`Notification`), 15 new enums, 8 extended enums, 0 renamed, 0 dropped, 0 reinterpreted, 0 columns on `Organization`.

---

## 2. Naming & shape resolutions (canonical overrides)

Every decision below arbitrates a conflict or ambiguity across docs 17–31. The consistency pass aligns those docs to this table. Numbered R-P* to avoid collision with doc 13's R1–R30.

| # | Binding decision | Overrides / arbitrates | Why |
|---|---|---|---|
| R-P1 | The connected-account model is **`ConnectedAccount`** with enum **`ConnectedAccountStatus`**, shaped per doc 19 §5: `organizationId String @unique` (strict structural 1:1 — one account per org, not per (org, provider)), `status @default(PENDING)` with **absent row = NOT_STARTED** (the value exists for completeness; no writer stores it), `providerStateAsOf` + `lastStatusSyncAt` watermarks, full terms/onboarding/suspension provenance, `@@index([status, lastStatusSyncAt])`. | 17 (`PaymentProviderAccount` + `PaymentProviderAccountStatus`, `@@unique([organizationId, provider])`, `lastSyncedAt`, `@default(NOT_STARTED)`, `@@index([status])`), 22 (`OrgPaymentAccount` placeholder); adopts 19, ratified by 18/23 | Doc 19 owns Part P onboarding and three docs already use its name; the spec's own vocabulary is "connected account". The strict org unique wins because doc 18's decision (ADR-037) fixes a single Stripe Express account per org — a per-provider unique would silently license a second money pipe. Doc 17's real requirement — zero Connect columns on `Organization` — is fully preserved |
| R-P2 | The connected-account **charge gate** is doc 19's: `chargesEnabled && status ∈ {ENABLED, REQUIREMENTS_DUE}`, enforced at readiness, approval, worker pre-flight, and method setup; webhook truth-tracking is never gated. | 17 (BR-10: `ENABLED` + `chargesEnabled` only), 22 ("must be ENABLED to charge") | Doc 19 owns the status machine. `REQUIREMENTS_DUE` with charges still enabled is Stripe's normal "eventually-due paperwork" state — blocking charges there would halt a working school's collections for a form Stripe hasn't even deadlined. Simpler-workflow choice: the school keeps collecting while the console nags about paperwork |
| R-P3 | The spec's **WebhookEvent** remains **`PaymentProviderEvent`** (doc 13 R16 reaffirmed), extended per doc 23. System 1's inbound store (`BillingEvent`) is deferred to Phase C and never appears in Part 2 DDL. | spec Part T naming; 17 §BillingEvent | One inbound provider-event table for the Revenue Engine; the outbound `Webhook`/`WebhookDelivery` models are untouched |
| R-P4 | The spec's **PaymentRequest/outbox** is **`ScheduledCharge`**; the spec's **PaymentTransaction** is **`Payment`**. No new model under either name. | spec Part S naming; reaffirms 13 R17 and doc 22 | Reuse-and-extend; both were bound in Part 1 |
| R-P5 | **"Platform Fee Agreement" is product vocabulary, not a model name.** The model stays `PlatformFeePolicy` (versioned agreement rows) + new child `PlatformFeeTier`; UI and docs may say "Agreement". | 27 (uses both), task vocabulary ("PlatformFeeAgreement") | Renaming a doc 13-bound model is forbidden; a synonym model would fork the version chain |
| R-P6 | The ACH org opt-in flag is **`OrgPaymentPolicy.achDebitEnabled Boolean @default(false)`**. | 20 (`achEnabled`), 21 (`achDebitEnabled`) | Doc 21 owns the ACH rail design and its name is precise: the flag gates ACH *debits* (charging bank accounts); payouts are provider-side and never org-optional |
| R-P7 | Dispute provider-fee columns are **`disputeFeeAmount Decimal(12,2)?` + `disputeFeeRecordedAt DateTime?`** — one pair. | 26 (`disputeFeeAmount`, no recorded-at), 28 (`feeAmount`, `feeRecordedAt`) | Doc 26's name is unambiguous next to `Dispute.amount`; doc 28's guarded-claim recorded-at token is required for its exactly-once dispute-fee journal. Merge takes the best of both |
| R-P8 | The **`NotificationKind`** additions are doc 31's ten values, verbatim (`REVENUE_REVIEW_ACTION`, `PAYMENT_SCHEDULED`, `PAYMENT_RECEIPT`, `PAYMENT_FAILED`, `PAYMENT_METHOD_REQUIRED`, `REFUND_ISSUED`, `DISPUTE_OPENED`, `COMPENSATION_APPROVED`, `EXPORT_READY`, `RECONCILIATION_EXCEPTION`). Doc 25's `PAYMENT_METHOD_ACTION_REQUIRED` ≡ `PAYMENT_METHOD_REQUIRED`; doc 25's `PAYMENT_FAILURE_ESCALATED` is **not** a kind — escalation rides the `PAYMENT_FAILED` billing-status thread (dedupe refresh + role-targeted rows), per doc 31's anti-spam design. Doc 29's `COMPENSATION_APPROVED` confirmed. | 25, 29, 31 | Doc 31 owns notifications; ten kinds with topic/dedupe threading beat twelve overlapping kinds |
| R-P9 | **`ScheduledCharge` uniques become partial** (doc 24): new nullable `adjustmentId` column (Restrict FK to `RevenueAdjustment`); raw-SQL partial uniques replace the plain `revenueReviewId`/`invoiceId` uniques — `ON (revenueReviewId) WHERE adjustmentId IS NULL`, `ON (invoiceId) WHERE adjustmentId IS NULL`, `ON (adjustmentId) WHERE adjustmentId IS NOT NULL`. One original anchor per review, at most one supplementary delta charge per upward `RevenueAdjustment` (doc 08 §3.4). | **Amends doc 13 §4.12/§7** (plain `@unique`); adopts 24 | Doc 13's plain unique structurally forbids the doc 08 supplementary delta charge — a genuine Part 1 conflict, resolvable now only because no DDL has shipped. Recorded in Open questions Q1 for the doc 13 refresh agent; the doc 13 §7 invariant "one collection anchor per approved review" stays true for the original anchor |
| R-P10 | **`Refund.providerRefundId` gains a nullable `@unique`** (Postgres permits multiple NULLs) as the provider-initiated replay guard for `PROVIDER_RETURN` rows. No `provider` column is added — Refund reaches its provider through `Payment → PaymentAttempt`. | 21 (proposed), 26 (silent) | Defense in depth beyond `PaymentProviderEvent` idempotency; a compound `[provider, providerRefundId]` would add a column with exactly one possible value |
| R-P11 | **`ConnectedAccountStatus` uses doc 19's default `PENDING`**, with `NOT_STARTED` reserved (absent row). Doc 17's `@default(NOT_STARTED)` is rejected: a stored row that says "not started" duplicates what absence already says (the doc 13 R9 null-over-sentinel rationale). | 17 vs 19 | One representation per fact |
| R-P12 | **No stored consent-status enum.** `PaymentConsent` validity (bound + unrevoked + unsuperseded + version-current) is **derived at read** from `paymentMethodReferenceId`, `revokedAt`, `supersededAt`, `consentVersion`; the only stored enum is `PaymentConsentChannel`. | task's "consent status" expectation; adopts 20 | A stored validity flag is a computed value re-synced on every version bump/revocation — exactly what DATABASE_STANDARDS bans |
| R-P13 | `PaymentMethodReference.verificationPath` is a **String** with engine-validated catalog `instant \| microdeposits` (R25 idiom: config/selector strings, enums only where snapshotted onto financial state machines). | 20 | House style split per doc 13 R25 |
| R-P14 | **`RevenueSettings.currency String @default("USD") @db.Char(3)`** is added now, resolving doc 13 §12 Q4 per its own recommendation. Part 2 is the first consumer: `ConnectedAccount.defaultCurrency` must equal it (doc 19), and the approval readiness "currency is supported" check (doc 22, check 7) compares against it. | 13 Q4 (deferred to "the Part 2 slice that first needs it") | The org currency needs exactly one home before currency-equality checks ship |
| R-P15 | Part 2 columns on models **created but not yet shipped** by the Part 1 migration plan fold into those models' creating migrations (doc 14 M2–M15 shape amendments); separate additive migrations exist **only** for genuinely deployed tables/enums (`Notification`, `NotificationKind`). | 21 ("deltas ride M13"), 25/29/31 (assumed separate migrations) | The two-step enum/column rule protects deployed databases; there is nothing to protect in an unshipped table, and fewer migrations = simpler release |
| R-P16 | `FinancialHold` is anchored to **`studentId`** (the dispatchable, billable subject), never to a payer; a payer-wide hold is a bulk action creating one row per affected student. One ACTIVE hold per student via raw-SQL partial unique. | 25 (adopted); arbitration for any payer-anchored reading of the spec | Checkout restrictions resolve per student (doc 10); a payer-anchored hold would need a join fan-out at every dispatch gate |
| R-P17 | Compensation clawback state is stored **twice, complementarily, never redundantly**: `CompensationImpactDecision` on `Refund`/`Dispute` is the *aggregate queue state* of the financial event; `CompensationReversalDecision` rows are the *per-earning outcomes* that drive it (a Refund touching two instructors' earnings yields two decision rows, and the Refund's enum goes `PENDING_DECISION → REVERSED/KEPT` when the last row lands). | 26 vs 29 (overlapping proposals) | The queue needs one indexable status per refund/dispute; the audit needs one immutable row per earning decided. Neither can derive the other cheaply |
| R-P18 | Money precision: every new monetary column is `Decimal(12,2)` per doc 13 §2.2, **except** volume aggregates `PlatformFeeTier.monthlyVolumeUpTo` and `PlatformFee.volumeAtAccrual`, which are `Decimal(14,2)` (a month of org-wide collected volume can exceed a single charge's bound). `PlatformFeeTier` carries **no currency column** — tiers are denominated by their policy version's `currency` (the §2.3 one-currency-per-document rule applied to the version family). | 27 (adopted, made explicit) | Field-class precision discipline; a per-tier currency could contradict its own version |

---

## 3. Two-financial-systems guardrail (binding restatement)

Doc 17's boundary, restated as schema law for Parts 2–3:

- **System 2 (Revenue Engine)** models — everything in this document and doc 13 §4.12–4.13 — never reference System 1 state (`Organization.subscriptionStatus/billingMode/planId`, future Stripe Billing columns) and vice versa. `PlatformFeePolicy.planId` is the single sanctioned bridge (fee terms may key off the SaaS plan) and is read-only to System 2.
- All System 2 provider objects (`cus_`, `pm_`, `pi_`, `re_`, `seti_`) live on the **org's connected account**; application-fee objects live on the platform account (doc 18). `PaymentAttempt.providerAccountId` and `PaymentProviderEvent.connectedAccountId` pin that context per row.
- The inbound event stores stay separate: `PaymentProviderEvent` (System 2, this doc) vs the Phase C `BillingEvent` (System 1, not Part 2).

---

## 4. New models (complete Prisma 6)

### 4.1 `ConnectedAccount` (spec Part P; docs 18/19; R-P1/R-P2/R-P11)

```prisma
/// Spec Part P statuses, exactly. Values never renamed once shipped.
enum ConnectedAccountStatus {
  NOT_STARTED // reserved for completeness; an absent row represents it — no writer stores this value
  PENDING
  REQUIREMENTS_DUE
  RESTRICTED
  ENABLED
  DISABLED
  SUSPENDED
}

/// Org 1:1 mirror of the payment provider's connected account (spec Part P).
/// Provider facts + AeroOps control fields — never a financial record: no
/// balances, no payout amounts, no KYC values, no secrets. Absent row =
/// NOT_STARTED. Charge gate (R-P2): chargesEnabled && status ∈ {ENABLED,
/// REQUIREMENTS_DUE}. Written only by the doc 19 sync reducer + platform
/// suspend/reinstate; every status change audited.
model ConnectedAccount {
  id                String                 @id @default(cuid())
  organizationId    String                 @unique // structural 1:1 — an org cannot acquire two accounts (ADR-037)
  provider          PaymentProvider        @default(STRIPE)
  providerAccountId String?                // opaque acct_… — not a secret; null during the provisioning window
  status            ConnectedAccountStatus @default(PENDING) // stored projection of the doc 19 derivation; recomputed on every sync

  // ---- Provider-mirrored facts (sync reducer only) ----
  chargesEnabled   Boolean @default(false)
  payoutsEnabled   Boolean @default(false)
  detailsSubmitted Boolean @default(false)
  /// Requirement KEYS + deadline only — never submitted values:
  /// { currentlyDue: string[], eventuallyDue: string[], pastDue: string[], currentDeadline: string | null }
  requirementsDue     Json?
  disabledReason      String? // provider vocabulary (e.g. "requirements.past_due"); catalog-validated in src/lib
  country             String? @db.Char(2) // ISO 3166-1 alpha-2; "US" in Part 2
  defaultCurrency     String? @db.Char(3) // ISO 4217 uppercase; must equal RevenueSettings.currency (R-P14)
  businessType        String? // "individual" | "company" | "non_profit" — engine-validated catalog (R25)
  statementDescriptor String? // what payers see on statements — mirrored display only; edited on Stripe-hosted surfaces
  capabilities        Json?   // requested capability → status map, e.g. { card_payments: "active" }
  providerStateAsOf   DateTime? // provider-clock watermark — out-of-order webhook guard
  lastStatusSyncAt    DateTime? // our clock; staleness signal for the reconciliation sweep

  // ---- AeroOps control fields ----
  termsVersion                String?   // in-app AeroOps connected-payments terms version
  termsAcceptedAt             DateTime?
  termsAcceptedByUserId       String?
  termsAcceptedByLabel        String?
  onboardingInitiatedAt       DateTime?
  onboardingInitiatedByUserId String?
  onboardingInitiatedByLabel  String?
  firstEnabledAt              DateTime? // write-once: first time chargesEnabled flipped true
  suspendedAt                 DateTime? // sticky platform hold; status derives SUSPENDED while set
  suspendedReason             String?
  suspendedByLabel            String?   // platform-staff display label (doc 13 R18)
  deauthorizedAt              DateTime? // account.application.deauthorized

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId]) // webhook tenancy: signed envelope account id → exactly one org (nulls exempt)
  @@index([status, lastStatusSyncAt])     // platform console queue + staleness sweep (authorizePlatform-only cross-org read)
}
```

### 4.2 `PaymentConsent` (spec Part Q; doc 20; R-P12)

```prisma
enum PaymentConsentChannel {
  METHOD_SETUP  // accepted on the AeroOps consent screen immediately before hosted setup
  RE_ACCEPTANCE // accepted for an already-saved method after a version bump or revocation
}

/// Off-session charging consent — one append-only row per acceptance (spec
/// Part Q). Evidence-grade: rows are never edited except to stamp revocation/
/// supersession timestamps; validity is DERIVED at read (bound + unrevoked +
/// unsuperseded + version-current) — no stored status (R-P12). Denormalized
/// method snapshot per the doc 13 R28 idiom so evidence survives detachment.
model PaymentConsent {
  id                String @id @default(cuid())
  organizationId    String
  paymentCustomerId String
  /// Denormalized XOR copy of the paying party (matches PaymentCustomer;
  /// app-enforced) — spec Part Q requires "payer" on the record itself.
  payerId           String?
  studentId         String?

  /// Null until the setup webhook binds the saved method (METHOD_SETUP);
  /// set immediately for RE_ACCEPTANCE. Unbound rows are never valid.
  paymentMethodReferenceId String?
  // Denormalized method snapshot copied at bind time (R28 idiom)
  methodType  StoredPaymentMethodType?
  methodBrand String?
  methodLast4 String?

  consentVersion   String   // org billingAuthorizationVersion at acceptance
  consentTextHash  String   // sha256 of the rendered text shown (integrity pin)
  channel          PaymentConsentChannel
  acceptedAt       DateTime
  acceptedByUserId String?
  acceptedByLabel  String   // the paying party's human (entity payers: the billing contact)
  ipAddress        String?  // evidence "where appropriate" (spec Part Q); null off-web
  userAgent        String?

  provider              PaymentProvider @default(STRIPE)
  providerSetupIntentId String?         // opaque seti_… correlation id — not a secret
  providerMandateRef    String?         // opaque ACH mandate reference — not a secret

  // Revocation & supersession (rows never deleted)
  revokedAt       DateTime?
  revokedByUserId String?
  revokedByLabel  String?
  revokedReason   String?
  supersededAt    DateTime? // stamped when a newer row for the same method is accepted

  createdAt DateTime @default(now())

  organization Organization            @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  customer     PaymentCustomer         @relation(fields: [paymentCustomerId], references: [id], onDelete: Restrict)
  method       PaymentMethodReference? @relation(fields: [paymentMethodReferenceId], references: [id], onDelete: Restrict)

  @@unique([provider, providerSetupIntentId])    // webhook correlation; replay-safe (nullable — RE_ACCEPTANCE rows exempt)
  @@index([paymentMethodReferenceId, revokedAt]) // chargeable() lookup at approval / runner pre-flight / attempt creation
  @@index([organizationId, paymentCustomerId])
  @@index([organizationId, createdAt])
}
```

### 4.3 `BillingAuthorizationText` (doc 20)

```prisma
/// One immutable row per (org, version) of the billing-authorization consent
/// text. Absent rows fall back to the platform default catalog in src/lib.
/// Immutable once any PaymentConsent cites the version (engine-enforced);
/// wording changes insert the next version and bump
/// RevenueSettings.billingAuthorizationVersion, forcing re-acceptance.
model BillingAuthorizationText {
  id             String   @id @default(cuid())
  organizationId String
  version        String
  body           String   // rendered to the payer verbatim; sha256(body) = PaymentConsent.consentTextHash
  createdAt      DateTime @default(now())
  createdByLabel String

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, version])
}
```

### 4.4 `DisputeEvidence` (spec Part V "future-ready evidence workflow, do not overbuild"; doc 26)

```prisma
/// Append-only join linking a Dispute to evidence files stored as existing
/// org-scoped Document rows — the Part 3 seam for programmatic evidence
/// submission without building a storage abstraction now. No update/delete API.
model DisputeEvidence {
  id             String   @id @default(cuid())
  organizationId String
  disputeId      String
  documentId     String
  label          String   // "Signed rental agreement", "Lesson record 2026-06-14"
  addedById      String?
  addedByLabel   String
  createdAt      DateTime @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  dispute      Dispute      @relation(fields: [disputeId], references: [id], onDelete: Cascade)  // workflow child of its dispute
  document     Document     @relation(fields: [documentId], references: [id], onDelete: Restrict) // evidence must not silently vanish

  @@unique([disputeId, documentId]) // no duplicate attachment
  @@index([organizationId, createdAt])
}
```

### 4.5 `PlatformFeeTier` (spec Part W volume tiers; doc 27; R-P18)

```prisma
/// Volume-tier rows of one PlatformFeePolicy version. Selection: first row by
/// sortOrder whose monthlyVolumeUpTo is null (top tier) or exceeds the org's
/// month-to-date accrued fee base (UTC calendar month). Percent-only
/// overrides; flat amounts and clamps stay on the version. Immutable once the
/// version is effective (versions are append-only). Platform-owned data with
/// no organizationId — like SubscriptionPlan; needs a schema-governance
/// allowlist entry (§13 Q3). Denominated by the policy version's currency.
model PlatformFeeTier {
  id                String   @id @default(cuid())
  policyId          String
  sortOrder         Int      // contiguous from 0
  monthlyVolumeUpTo Decimal? @db.Decimal(14, 2) // strictly increasing; null = top (unbounded) tier
  feePercentBps     Int      // card/base percent for this tier
  achFeePercentBps  Int?     // null = card bps applies to ACH in this tier
  createdAt         DateTime @default(now())

  policy PlatformFeePolicy @relation(fields: [policyId], references: [id], onDelete: Cascade)

  @@unique([policyId, sortOrder])
}
```

### 4.6 `FinancialHold` (spec Part U "place membership on financial hold"; doc 25; R-P16)

```prisma
enum FinancialHoldStatus {
  ACTIVE
  LIFTED
}

enum FinancialHoldSource {
  MANUAL            // staff-placed
  POLICY_ESCALATION // auto-placed by the escalation pass (OrgPaymentPolicy.autoHoldAfterEscalation)
}

/// "Membership financial hold" (customer-facing name). Anchored to the
/// Student — the dispatchable, billable subject (R-P16). Feeds the
/// MEMBERSHIP_FINANCIAL_HOLD checkout-restriction key. Rows are never
/// deleted — lifting stamps status/liftedAt (audit-shaped history).
/// POLICY_ESCALATION holds auto-lift when the subject's Amount Due reaches
/// zero; MANUAL holds lift only by a human with a reason.
model FinancialHold {
  id               String              @id @default(cuid())
  organizationId   String
  studentId        String
  status           FinancialHoldStatus @default(ACTIVE)
  source           FinancialHoldSource
  reason           String              // required, non-empty
  contextReviewIds String[]            @default([]) // advisory links to the failed reviews behind the hold
  placedByUserId   String?             // null for POLICY_ESCALATION
  placedByLabel    String              // "Sarah Chen" | "system:payment-runner"
  liftedAt         DateTime?
  liftedByUserId   String?
  liftedByLabel    String?
  liftedReason     String?             // required on manual lift (engine-enforced)
  createdAt        DateTime            @default(now())
  updatedAt        DateTime            @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  student      Student      @relation(fields: [studentId], references: [id], onDelete: Cascade)

  // Raw-SQL partial unique (doc 13 R4 idiom; schema-governance allowlist, §13 Q3):
  //   CREATE UNIQUE INDEX "FinancialHold_active_key"
  //   ON "FinancialHold"("studentId") WHERE status = 'ACTIVE';
  @@index([organizationId, status])
  @@index([organizationId, studentId, createdAt])
}
```

### 4.7 `CompensationReversalDecision` (spec Part Y adjustment/reversal decisions; doc 29; R-P17)

```prisma
enum CompensationReversalOutcome {
  REVERSED // clawback approved — reversal earning row(s) created in the same tx
  DECLINED // school absorbs — earning stands
}

/// Append-only durable outcome of a REQUIRE_APPROVAL clawback proposal
/// (DispatchRestrictionDecision idiom). One row per (adjustment × earning);
/// removes the item from the derived proposal queue. No update/delete API.
model CompensationReversalDecision {
  id             String @id @default(cuid())
  organizationId String

  earningId    String // the implicated primary earning
  adjustmentId String // the driving REFUND/VOID/dispute RevenueAdjustment

  outcome           CompensationReversalOutcome
  reversalEarningId String?  @unique // set iff outcome = REVERSED — the reversal row created in the same tx
  reason            String   // required for both outcomes (engine-enforced)
  decidedByUserId   String?
  decidedByLabel    String

  createdAt DateTime @default(now())

  organization    Organization       @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  earning         InstructorEarning  @relation(fields: [earningId], references: [id], onDelete: Restrict)
  adjustment      RevenueAdjustment  @relation(fields: [adjustmentId], references: [id], onDelete: Restrict)
  reversalEarning InstructorEarning? @relation("DecisionReversalRow", fields: [reversalEarningId], references: [id], onDelete: Restrict)

  @@unique([adjustmentId, earningId]) // one decision per (adjustment × earning) — replay guard
  @@index([organizationId, createdAt])
}
```

### 4.8 `ReconciliationRun` (spec Part T reconciliation job; doc 23)

```prisma
enum ReconciliationRunTrigger {
  PIGGYBACK      // tail of a payment-runner pass (bounded micro-pass)
  MANUAL         // org-initiated run
  PLATFORM_SWEEP // platform-initiated cross-org pass (one row per org touched)
  SCHEDULER      // future Inngest adapter (D14 seam)
}

/// One row per bounded reconciliation pass per org — powers the "Last
/// reconciled" freshness badge, run summaries, and the platform health view.
/// Keeps runs auditable without a queue. Findings live on
/// ReconciliationException; this is the pass record.
model ReconciliationRun {
  id               String                   @id @default(cuid())
  organizationId   String
  trigger          ReconciliationRunTrigger
  startedAt        DateTime                 @default(now())
  finishedAt       DateTime?
  itemsScanned     Int                      @default(0)
  exceptionsOpened Int                      @default(0)
  eventsReplayed   Int                      @default(0)
  autoHealed       Int                      @default(0)
  summary          Json?                    // per-detector counters; no PII, no payloads
  createdAt        DateTime                 @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId, startedAt]) // freshness lookup
}
```

### 4.9 `NotificationPreference` (spec Part AA; doc 31)

```prisma
/// Per-user, per-org, per-topic opt-out rows; absent row = enabled
/// (zero-setup). Mandatory topics are refused at write (422) and ignored at
/// send (engine-enforced against the src/lib topic catalog, R25).
model NotificationPreference {
  id             String   @id @default(cuid())
  organizationId String
  userId         String
  topic          String   // engine-validated catalog key
  inAppEnabled   Boolean  @default(true)
  emailEnabled   Boolean  @default(true) // dormant until the Part 3 email adapter
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([organizationId, userId, topic]) // tenant-scoped unique
  @@index([organizationId, userId])
}
```

---

## 5. Additive extensions to Part 1-bound and existing models

Every column below is nullable or defaulted; no Part 1 column is renamed, re-typed, or dropped; no existing row is reinterpreted. Fields shown are the **complete** Part 2 delta per model.

### 5.1 `PaymentAttempt` (docs 21/22)

```prisma
enum PaymentAttemptStatus {
  CREATED
  PROCESSING      // holds the ACH pending window (13 §4.12)
  REQUIRES_ACTION // NEW — off-session card charge awaiting customer authentication (spec Part R)
  SUCCEEDED
  FAILED
  CANCELLED
}

model PaymentAttempt {
  // ... exactly as 13 §4.12, plus:
  /// Last observed provider intent status — advisory/forensic only, never an
  /// input to financial transitions (webhook-confirmed status is the only
  /// paid truth, doc 21).
  providerStatus       String?
  requiresActionAt     DateTime? // set on the CREATED → REQUIRES_ACTION claim
  actionExpiresAt      DateTime? // requiresActionAt + 72h platform constant; expiry-sweep selector
  /// Platform fee sent on THIS intent (min(effectiveFee, attemptAmount));
  /// the local expectation for FEE_MISMATCH reconciliation (docs 22/27).
  /// Null = fee-free or pre-fee attempt.
  applicationFeeAmount Decimal?  @db.Decimal(12, 2)
  /// Connected account (acct_…) the intent was created on — denormalized so
  /// attempt provenance survives account re-onboarding; webhook tenancy
  /// cross-check input (doc 23).
  providerAccountId    String?

  @@index([status, actionExpiresAt]) // NEW — bounded requires-action expiry sweep (cross-org, platform runner)
}
```

`REQUIRES_ACTION` joins the in-flight set (blocks voids, offline recording, and parallel attempts). It is born with the enum in the creating migration (R-P15) — no two-step needed.

### 5.2 `ScheduledCharge` (docs 24/25; R-P9)

```prisma
model ScheduledCharge {
  // ... exactly as 13 §4.12, plus:
  /// Null = the original per-review collection anchor. Set = supplementary
  /// delta charge for one upward RevenueAdjustment (doc 08 §3.4).
  adjustmentId       String?
  /// Escalation claim marker (guarded-claim, fires exactly once); cleared
  /// whenever the charge leaves FAILED so a relapse re-arms the clock.
  /// Extends doc 09 §2.3's mutable execution-state set.
  failureEscalatedAt DateTime?

  adjustment RevenueAdjustment? @relation(fields: [adjustmentId], references: [id], onDelete: Restrict)

  // The plain revenueReviewId/invoiceId uniques become raw-SQL partial uniques (R-P9):
  //   CREATE UNIQUE INDEX "ScheduledCharge_review_anchor_key"
  //     ON "ScheduledCharge"("revenueReviewId") WHERE "adjustmentId" IS NULL;
  //   CREATE UNIQUE INDEX "ScheduledCharge_invoice_anchor_key"
  //     ON "ScheduledCharge"("invoiceId") WHERE "adjustmentId" IS NULL;
  //   CREATE UNIQUE INDEX "ScheduledCharge_adjustment_key"
  //     ON "ScheduledCharge"("adjustmentId") WHERE "adjustmentId" IS NOT NULL;
}
```

### 5.3 `Payment` (doc 28)

```prisma
model Payment {
  // ... 13 §4.2.4 shape unchanged, plus:
  providerBalanceTransactionId String?   // opaque txn_… — safe reference only
  providerFeeAmount            Decimal?  @db.Decimal(12, 2) // ACTUAL processor fee, in Payment.currency
  /// Guarded-claim token: exactly one processor-fee ledger journal +
  /// SETTLEMENT allocation set per Payment (doc 28 exactly-once true-up).
  providerFeeRecordedAt        DateTime?
}
```

### 5.4 `Refund` (docs 21/26; R-P10/R-P17)

```prisma
enum RefundOrigin {
  ORG_INITIATED   // the doc 08 adjustment-driven path
  PROVIDER_RETURN // provider-initiated reversal (ACH late return / final ACH dispute), written by the doc 21 webhook reducer
}

model Refund {
  // ... exactly as 13 §4.10; providerRefundId gains a nullable @unique (R-P10).
  // No idempotency-key column — the provider key rf_<refundId> is derived (doc 24).
  origin RefundOrigin @default(ORG_INITIATED)

  // Instructor-compensation clawback queue state (aggregate; per-earning
  // outcomes live on CompensationReversalDecision — R-P17)
  compensationImpact         CompensationImpactDecision @default(NOT_APPLICABLE)
  compensationDecidedById    String?
  compensationDecidedByLabel String?
  compensationDecidedAt      DateTime?
}
```

### 5.5 `Dispute` (docs 26/28; R-P7/R-P17)

```prisma
enum DisputeLiability {
  ORGANIZATION // default — school is merchant of record under doc 18 direct charges
  PLATFORM     // AeroOps-absorbed per doc 18 carve-outs; authorizePlatform-only to set
}

enum CompensationImpactDecision {
  NOT_APPLICABLE   // policy NEVER, or no instruction lines in scope
  PENDING_DECISION // awaiting a revenue.compensation_approve holder
  REVERSED         // negative InstructorEarning rows written
  KEPT             // human decided the instructor keeps the compensation
}

model Dispute {
  // ... doc 13 §4.10 fields unchanged, plus:
  liability           DisputeLiability @default(ORGANIZATION)
  disputeFeeAmount    Decimal?         @db.Decimal(12, 2) // provider dispute fee actual (same currency as Dispute)
  /// Guarded-claim token: exactly one dispute-fee journal + SETTLEMENT
  /// allocation set per lost Dispute (R-P7; doc 28).
  disputeFeeRecordedAt DateTime?
  fundsWithdrawnAt    DateTime? // stamped by charge.dispute.funds_withdrawn reduce
  fundsReinstatedAt   DateTime? // stamped on won-dispute reinstatement
  evidenceSubmittedAt DateTime? // stamped by the "Mark evidence submitted" action
  outcomeNote         String?   // staff context on WON/LOST/WARNING_CLOSED

  compensationImpact         CompensationImpactDecision @default(NOT_APPLICABLE)
  compensationDecidedById    String?
  compensationDecidedByLabel String?
  compensationDecidedAt      DateTime?

  evidence DisputeEvidence[]

  @@index([organizationId, evidenceDueBy]) // NEW — deadline queue + reminder sweep
}
```

### 5.6 `PaymentMethodReference` + `PaymentCustomer` (doc 20; R-P13)

```prisma
model PaymentMethodReference {
  // ... exactly as 13 §4.12, plus:
  verifiedAt       DateTime? // when ACH verification completed
  verificationPath String?   // engine catalog: instant | microdeposits (R-P13)

  consents PaymentConsent[]  // back-relation only
}

model PaymentCustomer {
  // ... exactly as 13 §4.12 (triple unique R20, XOR payerId|studentId), plus:
  consents PaymentConsent[]  // back-relation only — no columns
}
```

### 5.7 `PaymentProviderEvent` (doc 23)

```prisma
enum ProviderEventEndpoint {
  CONNECT  // /api/webhooks/stripe-connect
  PLATFORM // /api/webhooks/stripe-platform
}

enum ProviderEventStatus {
  RECEIVED
  PROCESSED
  IGNORED
  RETRYING
  QUARANTINED
  DEAD_LETTER
}

model PaymentProviderEvent {
  // ... exactly as 13 §4.12 (unique [provider, providerEventId], SetNull org,
  //     excluded from org-snapshot wipe/restore — all unchanged), plus:
  endpoint             ProviderEventEndpoint @default(CONNECT)
  connectedAccountId   String?               // top-level event.account (acct_…); opaque — drives tenancy resolution + backfill watermarks
  livemode             Boolean               @default(false) // live events quarantined in this phase
  apiVersion           String?
  /// Invariant (engine-enforced): processedAt IS NOT NULL ⟺ processingStatus ∈ {PROCESSED, IGNORED}.
  processingStatus     ProviderEventStatus   @default(RECEIVED)
  processAttempts      Int                   @default(0)     // sweep retry counter (DEAD_LETTER at 8)
  lastProcessAttemptAt DateTime?                             // drives exponential backoff
  quarantineReason     String?               // catalog: LIVEMODE_IN_TEST_PHASE | UNKNOWN_CONNECTED_ACCOUNT | TENANT_MISMATCH

  @@index([processingStatus, receivedAt])   // NEW — the sweep queue
  @@index([connectedAccountId, receivedAt]) // NEW — quarantine triage / per-account backfill watermark
}
```

### 5.8 `PlatformFeePolicy` + `PlatformFee` (doc 27; R-P5/R-P18)

```prisma
enum PlatformFeeRail {
  CARD
  ACH
  OFFLINE
}

enum PlatformFeePolicyKind {
  STANDARD
  INTRODUCTORY
  NEGOTIATED
  WAIVER // validation forces all-zero terms
}

model PlatformFeePolicy {
  // ... all doc 13 §4.13 fields unchanged, plus:
  kind             PlatformFeePolicyKind @default(STANDARD)
  label            String?               // console display, e.g. "Founding-school intro — 6 months"
  achFeePercentBps Int?                  // null = card terms apply to ACH
  achFeeFlatAmount Decimal?              @db.Decimal(12, 2) // null = card flat applies to ACH

  tiers PlatformFeeTier[]
}

model PlatformFee {
  // ... all doc 13 §4.13 fields unchanged (revenueReviewId @unique, status
  //     machine, basis snapshot, reversedAmount, earnedAt, providerRef), plus:
  railApplied      PlatformFeeRail? // accrual-time expected rail; corrected at collection
  volumeAtAccrual  Decimal?         @db.Decimal(14, 2) // MTD volume used for tier selection — the fee's "reasons"
  appliedTierIndex Int?             // sortOrder of the applied tier; null = untiered
  /// Write-once copy of the resolved agreement version's complete terms
  /// (both rails + tier table + refundReversesFee + kind). Every post-approval
  /// recompute runs against THIS, never against current policy — self-
  /// contained even if policyId goes null.
  termsSnapshot    Json?
}
```

### 5.9 `InstructorEarning` (doc 29)

```prisma
enum InstructorEarningStatus {
  PENDING
  APPROVED
  HELD     // NEW — recognized-at-payment policies; releases on settlement (doc 29 §6.3)
  EXPORTED
  REVERSED
  // PAID still deliberately absent — D44 / Part 3 (additive when decided)
}

model InstructorEarning {
  // ... all doc 13 §4.7 fields unchanged, plus:
  /// Recognition date — the reporting bucket. Null while PENDING/HELD;
  /// = service date under LESSON_COMPLETION, else stamped at APPROVED-entry.
  earnedAt     DateTime?
  /// On reversal rows: structural provenance to the driving refund/void/
  /// dispute RevenueAdjustment.
  adjustmentId String?

  adjustment        RevenueAdjustment?             @relation(fields: [adjustmentId], references: [id], onDelete: Restrict)
  reversalDecisions CompensationReversalDecision[]

  @@index([organizationId, instructorId, earnedAt]) // NEW — period reports bucket on earnedAt
}
```

### 5.10 `Notification` (existing pre-Phase-8 model; doc 31; R-P8)

```prisma
enum NotificationEmailStatus {
  NOT_CONFIGURED // email-eligible, no transport exists (Part 2 steady state)
  PREVIEWED      // rendered via dev-only console transport (refused in production)
  SENT           // reserved — the Part 3 adapter is the first writer
  FAILED         // reserved — Part 3
}

model Notification {
  // ... existing fields, indexes, FK actions unchanged, plus (all nullable/defaulted — no backfill):
  topic       String?   // engine-catalog key (R25); null = legacy/non-revenue row
  dedupeKey   String?   // thread/counter key scoped per (organizationId, userId); refresh-or-create engine-enforced, no DB unique
  linkPath    String?   // app-relative deep link, validated ^/ ; never token-bearing
  count       Int       @default(1)     // events aggregated into a counter row
  lastEventAt DateTime  @default(now()) // refresh timestamp + sort key; createdAt stays honest
  emailStatus NotificationEmailStatus?  // null = not email-eligible / suppressed

  @@index([organizationId, userId, dedupeKey]) // NEW — refresh-or-create lookup
}
```

`NotificationKind` gains the ten R-P8 values in **their own additive migration before first use** (this enum is deployed — the two-step rule applies, doc 14 §3).

### 5.11 Config singletons (docs 20/21/25/29; R-P6/R-P14)

```prisma
model OrgPaymentPolicy {
  // ... exactly as 13 §4.12, plus:
  achDebitEnabled         Boolean  @default(false) // D4: ACH debits behind explicit org opt-in (R-P6)
  escalationDays          Int      @default(7)     // days a charge rests in FAILED (retries exhausted) before escalation
  failureNotifyRoleIds    String[] @default([])    // OrgRole ids notified on every failure (beyond revenue.charge holders)
  escalationNotifyRoleIds String[] @default([])    // OrgRole ids notified at escalation (payment-policy managers always included)
  autoHoldAfterEscalation Boolean  @default(false) // auto-place a POLICY_ESCALATION FinancialHold in the escalation tx
}

enum CompensationRecognitionEvent {
  LESSON_COMPLETION   // recognition-DATING policy: earnedAt = service date; rows still created at approval
  REVIEW_APPROVAL     // default
  PAYMENT_SETTLED
  ACH_SETTLEMENT_HOLD // rows born HELD; released by the settlement webhook
}

model RevenueSettings {
  // ... exactly as 13 §4.14, plus:
  currency                     String                       @default("USD") @db.Char(3) // the org currency (R-P14; resolves 13 Q4)
  compensationRecognitionEvent CompensationRecognitionEvent @default(REVIEW_APPROVAL)
}

model CheckoutRestrictionPolicy {
  // ... exactly as 13 §4.5, plus:
  /// FINANCIAL keys only (engine-clamped like the safety floor): when true and
  /// enforcement is BLOCK/BLOCK_OVERRIDABLE, billable-booking creation for the
  /// subject is also refused. Default false = Part 1 behavior exactly.
  applyAtBooking Boolean @default(false)
}
```

`CheckoutRestrictionKey` gains **`MEMBERSHIP_FINANCIAL_HOLD`** (folds into M2's `CREATE TYPE` per R-P15 — the enum has not shipped).

### 5.12 `RevenueAdjustment` (back-relations only — no columns)

`scheduledCharges ScheduledCharge[]` (supplementary delta charges, §5.2) · `reversalEarnings InstructorEarning[]` (§5.9) · `compensationReversalDecisions CompensationReversalDecision[]` (§4.7).

---

## 6. Back-relations on other existing models (relations only — no columns)

| Model | New back-relations |
|---|---|
| `Organization` | `connectedAccount ConnectedAccount?`, `paymentConsents PaymentConsent[]`, `billingAuthorizationTexts BillingAuthorizationText[]`, `disputeEvidence DisputeEvidence[]`, `financialHolds FinancialHold[]`, `compensationReversalDecisions CompensationReversalDecision[]`, `reconciliationRuns ReconciliationRun[]`, `notificationPreferences NotificationPreference[]` — **and nothing else**: no Connect columns, no System 1 columns (§3) |
| `Student` | `financialHolds FinancialHold[]`, `paymentConsents PaymentConsent[]` |
| `ResponsiblePayer` | `paymentConsents PaymentConsent[]` |
| `User` | `notificationPreferences NotificationPreference[]` |
| `Document` | `disputeEvidence DisputeEvidence[]` |

(`PaymentConsent.payerId`/`studentId` are denormalized snapshot copies with relations for portal queries; SetNull is **not** used — they are plain scalar copies with no FK, matching the R28 snapshot idiom. Only `paymentCustomerId`/`paymentMethodReferenceId` are real FKs.)

---

## 7. Enum inventory (complete)

### 7.1 New enums (ship with their first-using table, R-P15)

`ConnectedAccountStatus` (7) · `PaymentConsentChannel` (2) · `RefundOrigin` (2) · `DisputeLiability` (2) · `CompensationImpactDecision` (4) · `CompensationReversalOutcome` (2) · `CompensationRecognitionEvent` (4) · `PlatformFeeRail` (3) · `PlatformFeePolicyKind` (4) · `ProviderEventEndpoint` (2) · `ProviderEventStatus` (6) · `ReconciliationRunTrigger` (4) · `FinancialHoldStatus` (2) · `FinancialHoldSource` (2) · `NotificationEmailStatus` (4) — 15 new types. (`PaymentConsentChannel` + derived validity replace any stored consent-status enum, R-P12.)

### 7.2 Extended enums

| Enum | New values | Migration posture (doc 14 §3) |
|---|---|---|
| `PaymentAttemptStatus` | `REQUIRES_ACTION` | Folds into the creating migration (M13 amendment) — unshipped type |
| `InstructorEarningStatus` | `HELD` | Folds into M14 — unshipped type. `PAID` stays absent (D44) |
| `ScheduledChargeStatus` | *(none — the SCHEDULED→AWAITING_MANUAL pre-flight hold edge in doc 22 reuses existing values)* | — |
| `CheckoutRestrictionKey` | `MEMBERSHIP_FINANCIAL_HOLD` | Folds into M2 — unshipped type |
| `ReconciliationExceptionKind` | `STATE_MISMATCH`, `FAILED_EVENT_PROCESSING`, `QUARANTINED_EVENT`, `CONNECTED_ACCOUNT_RESTRICTED` | Folds into M15 — unshipped type |
| `AllocationCategory` | `GROUND_INSTRUCTION_REVENUE`, `SIMULATOR_REVENUE`, `MEMBERSHIP_REVENUE`, `TRAINING_MATERIAL_REVENUE`, `MERCHANDISE_REVENUE` (REVENUE dim), `PROCESSOR_FEE`, `REFUND_RESERVE` (PROCEEDS dim only; `REFUND_RESERVE` reserved — no Part 2 writer) | Folds into M14 — unshipped type |
| `AllocationEvent` | `SETTLEMENT` (zero-amount provider-fee true-up sets), `DISPUTE` (lost-dispute clawback sets, reported separately from REFUND) | Folds into M14 |
| `LedgerAccount` | `SETTLED_TO_BANK` (asset, debit-normal; payout destination — makes PAYMENT_CLEARING an exact settled-not-yet-paid-out invariant) | Folds into M15 |
| `NotificationKind` | the ten R-P8 values | **Deployed enum — own additive `ALTER TYPE … ADD VALUE` migration before any writer** (N6a, §11) |
| `InvoiceStatus`, `LineItemKind`, `PaymentMethod`, `RevenueReviewStatus`, `RefundStatus`, `DisputeStatus`, `PlatformFeeStatus` | **unchanged** | Part 2 workflows map onto the Part 1 values exactly (docs 21/25/26/27) |

---

## 8. Idempotency & uniqueness additions (extends doc 13 §7)

The Part 1 chain table stands unchanged; Part 2 adds:

| Invariant | Constraint |
|---|---|
| One original collection anchor per review / invoice; at most one supplementary charge per upward adjustment | `ScheduledCharge` partial uniques (R-P9, raw SQL): `(revenueReviewId) WHERE adjustmentId IS NULL`, `(invoiceId) WHERE adjustmentId IS NULL`, `(adjustmentId) WHERE adjustmentId IS NOT NULL`. Together with `PaymentAttempt @@unique([scheduledChargeId, attemptNumber])` this is the spec's "one payment request per review + attempt" |
| One connected account per org; webhook envelope account → exactly one org | `ConnectedAccount.organizationId @unique`; `@@unique([provider, providerAccountId])` |
| Consent ↔ setup-session correlation replay-safe | `PaymentConsent @@unique([provider, providerSetupIntentId])` (nullable) |
| One consent-text body per (org, version) | `BillingAuthorizationText @@unique([organizationId, version])` |
| Provider-initiated refund replay guard | `Refund.providerRefundId @unique` (nullable, R-P10) — beyond `PaymentProviderEvent` unique-insert idempotency |
| No duplicate dispute-evidence attachment | `DisputeEvidence @@unique([disputeId, documentId])` |
| One clawback decision per (adjustment × earning); one reversal row per decision | `CompensationReversalDecision @@unique([adjustmentId, earningId])`; `reversalEarningId @unique` |
| Tier tables well-ordered per version | `PlatformFeeTier @@unique([policyId, sortOrder])` |
| One active financial hold per student | raw-SQL partial unique `FinancialHold(studentId) WHERE status = 'ACTIVE'` |
| One preference row per (org, user, topic) | `NotificationPreference @@unique([organizationId, userId, topic])` |
| Exactly-once settlement true-ups (fees) | guarded-claim tokens `Payment.providerFeeRecordedAt`, `Dispute.disputeFeeRecordedAt` (single-winner `updateMany` claims, doc 13 §7 idiom) |
| Provider idempotency keys (doc 24, unchanged) | charge `sc_<scheduledChargeId>_a<n>` (stored, `PaymentAttempt.idempotencyKey @unique`); refund `rf_<refundId>` and customer `cust_<orgId>_<party>_<partyId>` derived from durable row ids — **no new key columns** |

---

## 9. FK-action additions (extends doc 13 §8 — financial records never cascade-delete)

| Relation | Action | Rationale |
|---|---|---|
| `PaymentConsent → PaymentCustomer`, `→ PaymentMethodReference` | **Restrict** | Consent evidences the instrument and party; must outlive casual deletion. Org cascade is the backstop via the ordered wipe |
| `DisputeEvidence → Document` | **Restrict** | Evidence must not silently vanish while a dispute references it |
| `DisputeEvidence → Dispute` | Cascade | Workflow child; Dispute itself is Restrict-protected from below (doc 13) |
| `CompensationReversalDecision → InstructorEarning` (both links), `→ RevenueAdjustment` | **Restrict** | Financial decision rows pin their subjects |
| `ScheduledCharge.adjustment`, `InstructorEarning.adjustment` | **Restrict** | Money-bearing provenance to the driving adjustment |
| `PlatformFeeTier → PlatformFeePolicy` | Cascade | Immutable child of an append-only version row (never deleted in practice) |
| `ConnectedAccount`, `ReconciliationRun`, `BillingAuthorizationText`, `FinancialHold`, `NotificationPreference → Organization` | Cascade | Org-owned config/operational records; the ordered wipe is the mechanism |
| `FinancialHold → Student`, `NotificationPreference → User` | Cascade | Hold/preference has no meaning without its subject; financial history lives elsewhere (reviews, attempts) |
| `PaymentProviderEvent.organizationId` | SetNull (unchanged) | Audit-grade; new columns do not change its wipe exclusion |

---

## 10. Index coverage additions (extends doc 13 §9)

| Query family | New indexes |
|---|---|
| **Queues** | `PaymentAttempt [status, actionExpiresAt]` (requires-action expiry sweep — cross-org, platform runner, like `ScheduledCharge [status, runAfter]`); `PaymentProviderEvent [processingStatus, receivedAt]` (event sweep); `Dispute [organizationId, evidenceDueBy]` (evidence deadline queue); `FinancialHold [organizationId, status]`; `PaymentConsent [paymentMethodReferenceId, revokedAt]` (`chargeable()` gate at approval/pre-flight/attempt) |
| **Reconciliation** | `ConnectedAccount [status, lastStatusSyncAt]` (staleness sweep, authorizePlatform-only); `PaymentProviderEvent [connectedAccountId, receivedAt]` (tenancy triage + backfill watermark); `ReconciliationRun [organizationId, startedAt]` (freshness badge) |
| **Reporting dimensions** | `InstructorEarning [organizationId, instructorId, earnedAt]` (compensation periods bucket on `earnedAt`); `FinancialHold [organizationId, studentId, createdAt]`; `PaymentConsent [organizationId, paymentCustomerId]` + `[organizationId, createdAt]`; `DisputeEvidence [organizationId, createdAt]`. Platform-fee earned-by-period reporting continues to bucket on `PlatformFee.earnedAt` via the existing `[organizationId, status]`/`[organizationId, createdAt]` indexes — no new index until telemetry says otherwise |
| **Notifications** | `Notification [organizationId, userId, dedupeKey]` (refresh-or-create); `NotificationPreference [organizationId, userId]` |
| **Deferred** | GIN index on `RevenueReview.riskFlags` (doc 30) — **not created**; revisit with real-volume telemetry (§13 Q5) |

Cross-org indexes (`PaymentAttempt [status, actionExpiresAt]`, `PaymentProviderEvent [processingStatus, receivedAt]`, `ConnectedAccount [status, lastStatusSyncAt]`) serve only platform runners/console behind `authorizePlatform()` — same posture as doc 13's single cross-org index.

---

## 11. Migration-plan delta (extends [14-migration-plan.md](./14-migration-plan.md))

All doc 14 ground rules apply unchanged. Two kinds of change:

### 11.1 Shape amendments to unshipped Part 1 migrations (R-P15 — no new migration files)

Doc 14's M2–M15 have not been authored; the Part 2 columns on models those migrations create are folded in at authoring time. Doc 14's per-migration content lists are amended as follows:

| Doc 14 migration | Amendment |
|---|---|
| M2 `revenue_engine_org_config` | `CheckoutRestrictionKey` includes `MEMBERSHIP_FINANCIAL_HOLD`; `CheckoutRestrictionPolicy.applyAtBooking`; `OrgPaymentPolicy` §5.11 columns; `RevenueSettings.currency` + `compensationRecognitionEvent` (+ enum `CompensationRecognitionEvent`) |
| M8 `revenue_engine_payment_rails` | `PaymentMethodReference.verifiedAt`/`verificationPath` |
| M13 `revenue_engine_payment_collection` | `PaymentAttemptStatus` includes `REQUIRES_ACTION`; `PaymentAttempt` §5.1 columns + `[status, actionExpiresAt]` index; `ScheduledCharge.adjustmentId`/`failureEscalatedAt` + **raw-SQL hand-edit**: the three R-P9 partial uniques replace the plain `revenueReviewId`/`invoiceId` uniques; `Refund` §5.4 columns + `providerRefundId` unique (+ enums `RefundOrigin`, `CompensationImpactDecision`, `DisputeLiability`); `Dispute` §5.5 columns + `[organizationId, evidenceDueBy]` index; `PaymentProviderEvent` §5.7 columns + 2 indexes (+ enums `ProviderEventEndpoint`, `ProviderEventStatus`); `Payment` §5.3 columns |
| M14 `revenue_engine_allocation_earnings_fees` | `AllocationCategory` +7 / `AllocationEvent` +2 values at type birth; `InstructorEarningStatus` includes `HELD`; `InstructorEarning.earnedAt`/`adjustmentId` + `[organizationId, instructorId, earnedAt]` index; `PlatformFeePolicy` §5.8 columns (+ enums `PlatformFeeRail`, `PlatformFeePolicyKind`); `PlatformFee` §5.8 columns |
| M15 `revenue_engine_ledger_reconciliation` | `LedgerAccount` includes `SETTLED_TO_BANK`; `ReconciliationExceptionKind` includes the 4 new values |

If any of M2–M15 has already been applied in a shared environment when Part 2 implementation starts, the fold-in for that migration reverts to a separate additive migration under the doc 14 §3 two-step rule — the amendment is a convenience, never a license to edit applied history.

### 11.2 New ordered migrations (inserted into the doc 14 sequence)

| # | Name | Contents | Position / depends on | Raw SQL hand-edit |
|---|---|---|---|---|
| N1 | `revenue_engine_connected_accounts` | `ConnectedAccount` + `ConnectedAccountStatus` | After M2 (needs only `Organization`; before M13 so runner code can gate on it) | — |
| N2 | `revenue_engine_payment_consent` | `PaymentConsent`, `BillingAuthorizationText` + `PaymentConsentChannel` | After M8 (`PaymentCustomer`, `PaymentMethodReference` FK targets) | — |
| N3 | `revenue_engine_failure_holds` | `FinancialHold` + `FinancialHoldStatus`, `FinancialHoldSource` | After M2; before the failure-workflow engine | Partial unique: `CREATE UNIQUE INDEX "FinancialHold_active_key" ON "FinancialHold"("studentId") WHERE status = 'ACTIVE';` |
| N4 | `revenue_engine_dispute_evidence_compensation` | `DisputeEvidence`, `CompensationReversalDecision` + `CompensationReversalOutcome` | After M13 (`Dispute`) and M14 (`InstructorEarning`) | — |
| N5 | `revenue_engine_platform_fee_tiers_recon_runs` | `PlatformFeeTier`, `ReconciliationRun` + `ReconciliationRunTrigger` | After M14 (`PlatformFeePolicy`) | — |
| N6a | `revenue_engine_notification_kinds` | `ALTER TYPE "NotificationKind" ADD VALUE` × 10 (R-P8) | Any time before N6b; **deployed enum — DDL only, zero data writes** (doc 14 §3) | Generated SQL must contain only `ADD VALUE` lines |
| N6b | `revenue_engine_notifications` | `Notification` §5.10 columns + `[organizationId, userId, dedupeKey]` index + `NotificationEmailStatus`; `NotificationPreference` | After N6a; `Notification` is a **populated table** — all columns nullable/defaulted, no backfill needed | — |

No new data-only backfills: every Part 2 column is nullable or defaulted and legacy rows keep null/default meanings (e.g. `Notification.topic IS NULL` = pre-revenue row). Doc 14's M16–M18 backfills and M19 tightening are unaffected. **No Part 2 migration touches `Organization`.**

### 11.3 New fixtures (extends doc 14 §6 validation matrix)

Each ships in the slice that creates its models, in both seeded demo orgs, exercised by the §6 assertion suite:

| Fixture | Contents |
|---|---|
| **Connected-account** | `golden-gate`: `ENABLED` + `chargesEnabled` (happy path); `blue-ridge`: `REQUIREMENTS_DUE` with `requirementsDue` keys + a past-due variant flipping to `RESTRICTED` — proves the charge gate and the console queue index |
| **Consent** | One valid bound consent (card, METHOD_SETUP), one micro-deposit ACH consent with `verificationPath: "microdeposits"` + mandate ref, one revoked and one version-superseded row — proves `chargeable()` derivation and the approval/pre-flight gate |
| **Failed-payment** (extends doc 14's) | Add: a review whose charge rests in `FAILED` past `escalationDays` with `failureEscalatedAt` set, plus the resulting `POLICY_ESCALATION` `FinancialHold` and a `MANUAL` lifted hold — proves partial unique + escalation exactly-once |
| **Refund** | One `SUCCEEDED` org-initiated partial refund with its adjustment, reversal allocation set, ledger journal, fee reversal, and a `PENDING_DECISION → REVERSED` `CompensationReversalDecision` chain; one `PROVIDER_RETURN` refund (ACH late return) |
| **Dispute** | One `OPEN` dispute with `evidenceDueBy` + two `DisputeEvidence` rows; one `LOST` dispute with `disputeFeeAmount`/`disputeFeeRecordedAt`, DISPUTE allocation set, and a `KEPT` compensation decision |
| **Earning** | One `HELD` earning released to `APPROVED` with `earnedAt` stamped (PAYMENT_SETTLED policy); one `LESSON_COMPLETION`-dated earning (`earnedAt` = service date ≠ `createdAt`); one reversal row with `adjustmentId` |
| **Provider-event** | One `PROCESSED`, one `QUARANTINED` (`UNKNOWN_CONNECTED_ACCOUNT`), one `DEAD_LETTER` row with a matching `FAILED_EVENT_PROCESSING` exception; one `ReconciliationRun` per org — proves sweep/triage indexes and the freshness badge |

Seed root check: all new models FK `Organization` (or `PlatformFeePolicy`/`Student`/`User`, which do), so the existing TRUNCATE-CASCADE root set reaches them — no new truncate roots.

---

## 12. Org-snapshot wipe-order placement (extends doc 13 §10.2)

Restrict chains dictate insertions into the doc 13 §10.2 order (children first). New steps in **bold**, numbered against the Part 1 sequence:

- **6a. `DisputeEvidence`** — before step 7 (`Dispute`); also ahead of every `Document` deletion (Restrict).
- **12a. `CompensationReversalDecision`** — before step 13 (`InstructorEarning`, Restrict ×2) and step 14 (`RevenueAdjustment`, Restrict).
- **23a. `PaymentConsent`** — before step 24 (`PaymentMethodReference`) and step 25 (`PaymentCustomer`) — both Restrict.
- **Step 28 bundle additions** (config & operational tail): `ConnectedAccount`, `BillingAuthorizationText`, `FinancialHold`, `ReconciliationRun`, `NotificationPreference`. `PlatformFeeTier` needs no step — org-scoped `PlatformFeePolicy` rows cascade their tiers; platform-global/plan-scoped policy versions are **not org data and are never wiped**.
- Step 10 (`ScheduledCharge`) already precedes step 14 (`RevenueAdjustment`), so the new `adjustmentId` Restrict FK holds; step 13 (`InstructorEarning`) likewise precedes step 14.
- `PaymentProviderEvent` remains **excluded** from wipe/restore (audit-grade); its new columns change nothing. `Notification` wipe behavior is unchanged (existing model).

All included new models join `OrgSnapshot` capture/restore in the slice that creates them (doc 14 §7 P2 precondition), and capture order mirrors wipe order.

---

## 13. Open questions

1. **R-P9 amends a Part 1-bound constraint** (`ScheduledCharge.revenueReviewId`/`invoiceId` plain uniques → partial uniques + `adjustmentId`). Doc 13 §4.12/§7 should be annotated by the designated Part 1 refresh agent to point here; safe only because no DDL has shipped. If the refresh agent rejects the amendment, doc 08 §3.4 supplementary delta charges need a different anchor model — decide before M13 is authored.
2. **Escalation notification shape** — R-P8 folds doc 25's `PAYMENT_FAILURE_ESCALATED` into the `PAYMENT_FAILED` thread. If pilot feedback shows owners miss escalations inside a refreshed thread, an eleventh kind is a two-step additive migration away; doc 31 owns the call.
3. **Schema-governance allowlist entries** (extends doc 13 §12 Q5): the two new raw-SQL partial-unique sets (R-P9 ×3, `FinancialHold_active_key`), `PlatformFeeTier` having no `organizationId` (platform-owned, like `SubscriptionPlan`), and the three new cross-org indexes (§10) — entry format settles when the test is touched in Part 2.
4. **`ACH_SETTLEMENT_HOLD` vs composition** — modeled as a distinct `CompensationRecognitionEvent` value per doc 29. If a fifth policy appears (e.g. hold-for-cards too), revisit as an orthogonal hold flag; today four values are simpler than two axes.
5. **`RevenueReview.riskFlags` GIN index** — deferred (doc 30). Create only if the operations-queue "manual items requiring approval" filter shows measurable seq-scan cost at real volume.
6. **`ConnectedAccount` platform-console permissions** (`platform.connect.view/.suspend`, doc 19) and `platform.fees.view/manage` (doc 27) are data changes in `src/lib/permissions.ts`, not schema — listed here so the Part 3 implementers don't look for tables.
7. **`PaymentConsent` retention** — consent evidence is retained indefinitely with the org (wipe-only deletion). If legal review (ADR-037 gate) mandates a retention window, deletion would need its own approved destructive plan; nothing in Part 2 assumes one.

---

## 14. Related documents

[13-database-model.md](./13-database-model.md) (canonical Part 1 shapes this document extends) · [14-migration-plan.md](./14-migration-plan.md) (sequence this §11 delta plugs into) · [17](./17-two-financial-systems.md)–[31](./31-notifications.md) (the Part 2 designs consolidated here) · [18-stripe-connect-decision.md](./18-stripe-connect-decision.md) (ADR-037, direct charges on per-org Express accounts) · [24-idempotency.md](./24-idempotency.md) (key catalog & exactly-once proofs) · [DATABASE_STANDARDS.md](../DATABASE_STANDARDS.md) · [DECISIONS.md](../DECISIONS.md)
