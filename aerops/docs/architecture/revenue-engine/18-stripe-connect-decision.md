# Stripe Connect Architecture Decision

> **Status:** Proposed — Phase 8 Part 2 · **Date:** 2026-07-10 · **Lead roles:** Principal Payments Architect at Stripe; Financial Systems Architect; Flight School Owner; Head of Product · **Part of:** Revenue Engine design set ([README](./README.md))

Part 2 deliverables 1 and 2 (spec Part O — Stripe Connect Architecture Decision, plus the funds-flow diagram). Design only: no schema, code, migration, Stripe object, or live charge ships with this document. Stripe **test mode** is the only sanctioned environment, and even test mode is not exercised in this phase.

**Review requirements (spec Part O, binding):** this decision requires **product-owner review and sign-off** before any payment implementation begins (together with the approved threat model, spec Part M / doc 16 D1), and **review by qualified legal and accounting professionals before any live launch**. AeroOps engineering does not adjudicate merchant-of-record tax posture, money-transmission analysis, or 1099-K obligations — it documents the structure those professionals must review. Nothing in this phase creates live charges or deploys anything.

---

## 1. Decision summary

**Selected: direct charges created on each organization's Stripe Express connected account, with the AeroOps platform fee collected atomically via `application_fee_amount`.**

- The **flight school is the settlement merchant and merchant of record**. Every student/payer charge is a PaymentIntent created *on the school's connected account* (`Stripe-Account` header). Funds settle into the school's Stripe balance and Stripe pays the school's bank directly on its payout schedule. AeroOps never custodies customer funds — manually or transiently.
- **AeroOps' platform fee splits atomically at charge time**: `application_fee_amount` moves the fee to the AeroOps platform balance as a Stripe `ApplicationFee` object in the same charge. No second money movement, no transfers, no invoicing loop for provider-collected payments.
- **Express** (not Standard, not Custom) is the account type: Stripe-hosted onboarding and KYC, minutes-not-days setup for a two-instructor Part 61 school, platform-visible status, and no per-school Stripe dashboard from which refunds could be issued behind AeroOps' back.
- The honest price of Express, accepted with open eyes (§10): AeroOps carries negative-balance/dispute tail liability — the school's balance is drawn first, but uncovered shortfalls roll up to AeroOps. Stripe's processing fee itself is borne by the **school** under direct charges (deducted from the school's connected balance, regardless of account type), so AeroOps discloses it distinctly from its own application fee and never conflates the two. Mitigations are designed in, commercial terms are D2's decision (doc 16), and legal/accounting review is mandatory before live.

This ratifies doc 16's **D1 recommendation (a)** and resolves the one internal tension in Part 1: [01-revenue-engine-architecture.md](./01-revenue-engine-architecture.md) §11 marked *Standard* accounts + direct charges as the leading recommendation, while doc 16 D1 recommended *Express*. Doc 01 explicitly enumerated the options "without commitment" and deferred the call to Part 2 — this document makes it: **Express**, for the reasons in §5.3. No Part 1 doc is reinterpreted; the deferred decision is simply taken.

---

## 2. Purpose & scope

### In scope

- The formal evaluation Part O requires: the three Connect charge types (direct, destination, separate charges and transfers) and the three account types (Standard, Express, Custom) against every Part O criterion.
- The selected model, with full rationale against the preferred business outcome.
- **ADR-037** — the payments ADR, in the repo's DECISIONS.md format, containing every item on Part O's required-contents list (§7).
- **Funds-flow diagrams** for: successful card payment, ACH payment, full refund, partial refund, dispute + reversal, and the platform-fee flow — each annotated with the Stripe object that moves the money (§8).
- Ratification of the provider-adapter surface extensions the sibling docs reference to this document (doc 19 §3.4, doc 22 §W2).
- The "consequences we accept" register (§10) — the costs of the chosen model, honestly.

### Out of scope (owned by siblings; referenced, never redefined)

- Connected-account onboarding workflow, `ConnectedAccount` model, status machine, suspension — [19-connected-account-onboarding.md](./19-connected-account-onboarding.md).
- Payment methods, `PaymentCustomer`/`PaymentMethodReference` semantics, off-session consent — [20-payment-methods-and-consent.md](./20-payment-methods-and-consent.md).
- The approval transaction and payment worker — [22-approval-to-payment.md](./22-approval-to-payment.md).
- Webhook endpoints, event pipeline, reconciliation job — [23-webhooks-and-reconciliation.md](./23-webhooks-and-reconciliation.md).
- Idempotency key catalog — [24-idempotency.md](./24-idempotency.md).
- Failure workflow — [25-payment-failure-workflow.md](./25-payment-failure-workflow.md).
- Platform-fee agreements, computation, disclosure — [27-platform-fee.md](./27-platform-fee.md) (spec Part W owner).
- SaaS-billing separation — [17-two-financial-systems.md](./17-two-financial-systems.md) (spec Part N owner). Nothing in this document touches Stripe Billing, `Organization.subscriptionStatus`, `billingMode`, or `/api/webhooks/stripe`.

---

## 3. Relationship to Part 1 docs

| Part 1 doc | Relationship |
|---|---|
| [01-revenue-engine-architecture.md](./01-revenue-engine-architecture.md) §11 | **Finalized here.** Part 1 bound the provider-agnostic adapter interface and deferred Connect topology to Part 2. The §11 option table is the starting point of §4's matrix; its "Standard — leading recommendation" line is overruled in favor of Express with documented reasons (§5.3). |
| [09-payment-timing-and-collection.md](./09-payment-timing-and-collection.md) | **Consumed.** The ADR-032 adapter (`createCustomer`, `createSetupSession`, `detachPaymentMethod`, `createCharge`, `parseWebhookEvent`) behind `REVENUE_CHARGING` is the interface this decision gives connected-account context to (§9.2). The queue-less runner and readiness engine are unchanged. |
| [11-responsible-payers.md](./11-responsible-payers.md) | **Consumed.** Doc 11's payer model already assumes one Stripe customer per payer **per connected account**. Direct charges are the only charge type under which that assumption holds without rework; §5.2 makes this an explicit selection reason. |
| [12-revenue-allocation-and-reporting.md](./12-revenue-allocation-and-reporting.md) | **Consumed.** `PlatformFee` ACCRUED→EARNED→REVERSED is provider-independent; this doc supplies the money-movement mechanics (`application_fee_amount`, `refund_application_fee`) that doc 12 §9 deferred. |
| [13-database-model.md](./13-database-model.md) | **Canonical and untouched.** `PaymentCustomer`, `PaymentMethodReference`, `ScheduledCharge`, `PaymentAttempt`, `Payment`, `Refund`, `Dispute`, `PaymentProviderEvent`, `PlatformFee(Policy)`, `ProviderPayout` are implemented exactly as bound. This decision pins *which Stripe account context* the opaque IDs (`cus_…`, `pm_…`, `pi_…`, `re_…`) live in: the org's connected account. |
| [15-adr-proposals.md](./15-adr-proposals.md) | **Extended.** ADR numbering continues: Part 1 proposed ADR-025–036; this document proposes **ADR-037** (§7) in the same format, merged into DECISIONS.md verbatim upon approval. |
| [16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md) | **D1 resolved** (this document). D2 (commercial fee terms) remains open and is *not* resolved here — the mechanism is decided, the numbers are the CEO's (§16 Q1). D4 (card-first, ACH opt-in) is honored in the ACH design. |

---

## 4. Evaluation matrix

Three independent expert evaluations of the charge models were commissioned and reviewed; their verdicts (direct 9/10 adopt, destination 4/10 do-not-select, separate-charges-and-transfers 2/10 reject) are adopted with the mechanics below verified against Stripe's documented Connect behavior. The lead did not overrule any evaluator verdict; the one judgment call the evaluators left open — account type — is decided in §5.3.

### 4.1 Charge types × Part O criteria

Every criterion from spec Part O's evaluation list, plus the architecture-fit criteria the north-star question adds.

| Part O criterion | **Direct charges** (on connected account, `application_fee_amount`) — SELECTED | Destination charges (platform account, `transfer_data[destination]`) | Separate charges & transfers (platform account + Transfers API) |
|---|---|---|---|
| **Merchant of record / settlement merchant** | **The school.** Charge belongs to the connected account; settles in the school's balance; school's business attaches to the sale. The only charge type where this is unambiguous. | **AeroOps** (platform settles; `on_behalf_of` variant shifts it, but then direct charges deliver the same outcome more cleanly). | **AeroOps.** Charge lives wholly on the platform account. |
| **Who pays Stripe processing fees** | **The school** — under direct charges the connected account is billed Stripe's processing fee, debited from the school's balance regardless of account type (Standard/Express/Custom). The AeroOps application fee is separate margin, disclosed as its own line (§10 C1). | AeroOps, at platform rates, from the platform balance (the charge lives on the platform account). | AeroOps, recovered only implicitly via reduced transfer amounts. |
| **Who handles disputes** | **The school's charge is disputed**; disputed amount + $15 fee debit the school's balance. On Express AeroOps operates the evidence workflow via API (the Express dashboard has no dispute UI) — spec Part V anticipates exactly this. | AeroOps: dispute + fee debit the *platform* balance; evidence lives with the school; loss pass-back is a manual transfer reversal that can fail. | AeroOps, worst case: platform-account dispute rate concentrates every tenant's chargebacks on AeroOps' own merchant record. |
| **Who issues refunds** | Refund created against the connected account's PaymentIntent; **funds pull from the school's balance** (the economic owner). AeroOps executes via API (doc 26 owner). `refund_application_fee: true` implements `refundReversesFee` natively. | AeroOps refunds from the platform balance, then claws back via `reverse_transfer` — two-legged, can fail against a drained connected balance. | AeroOps refunds from the platform balance; recovery is a separate, never-guaranteed transfer reversal. No application-fee-refund object exists. |
| **Who carries negative balances** | The school first; **on Express, uncovered shortfalls roll up to AeroOps** (§10 C2). Mitigated by the doc 19 status gate, D4's ACH opt-in, refund age hard-block, and contractual recovery terms. | AeroOps structurally — every failure mode lands on the platform balance first. | AeroOps structurally, plus a de facto working-capital/lending posture on every ACH payment. |
| **Who owns tax reporting obligations** | **The school.** Stripe's 1099-K reporting keys off the connected account under direct charges. AeroOps issues no tax documents (legal review before live, §7 item 14 caveat). | Shifts toward AeroOps (payments processed on the platform account; transfers are not "payments" for reporting). | AeroOps — schools receive no Stripe-issued payment reporting at all. |
| **Who controls statement descriptors** | **The school's descriptor by default** — the cardholder sees the school's name, not AEROOPS. Biggest single lever against unrecognized-charge ("friendly fraud") disputes. ACH bank statements likewise. | AeroOps' descriptor by default; per-charge overrides are fragile, and fixing it properly (`on_behalf_of`) converts the model into a worse-placed direct charge. | AeroOps' descriptor; the school's name can never fully replace the platform prefix. |
| **How platform fees are collected** | **`application_fee_amount`** on each PaymentIntent: atomic split at charge time into a Stripe `ApplicationFee` object on the platform balance. Computed app-side per attempt from the snapshotted `PlatformFeePolicy` version, so every Part W fee shape (per-rail, tiers, intro, waiver) is expressible. | `application_fee_amount` or `transfer_data[amount]` — equally clean, the model's one strength; the same mechanism is available under direct charges. | None native. Fee is invisible arithmetic inside a transfer delta: no provider-side fee object, no reporting, no automatic reversal — all rebuilt in app code. |
| **AeroOps does not manually custody funds** | **Holds.** Customer funds never enter the platform balance; only the earned application fee does. | Weakened: gross customer funds settle on the platform balance before transfer. A restricted school strands collected funds on the platform with no compliant destination. | **Violated in spirit**: every student dollar sits in AeroOps' balance pending a discretionary transfer. |
| **Customers understand who provided the service** | **Yes** — descriptor, receipt identity, and payout all carry the school. | No by default. | No. |
| **Fit with Part 1's bound architecture** (docs 01/09/11/13) | **Zero rework.** `PaymentCustomer`/`PaymentMethodReference` on the connected account is already the bound assumption; `sc_<id>_a<n>` keys work unchanged as the per-request `Idempotency-Key` against the connected account. | Contradicts the bound customer topology (customers/methods would live on the platform account) — would force a Part 1 re-decision plus a future customer-cloning migration. | Same contradiction, plus reopening `PlatformFee` reconciliation design. |
| **Reconciliation surface** | Per-connected-account: `ProviderPayout` ingestion and R1–R7 checks iterate accounts (doc 23 owns; bounded, org-scoped — matches the tenancy model anyway). | Single platform ledger (simpler) — but reconciling *netting* of platform-paid fees against retained amounts is new complexity. | Single surface, but a permanent class of two-legged partial-failure exceptions (refund vs reversal). |
| **Multi-currency / expansion posture** | Per-account settlement currency; app fee must match charge currency. Fine for Part 2's USD-only scope; per-country connected accounts scale naturally. | Same-region constraints between platform and connected account; a future Canadian school forces a model change. | Same-country transfer constraints; tightest of the three. |
| **Collection when school account restricted** | **Halts** (charges_enabled=false ⇒ PaymentIntent creation fails). Doc 19 §3.8 gates initiation gracefully; manual invoice + offline recording continue. Accepted (§10 C5). | Charging can continue (platform capability) — but transfers block and funds strand on the platform. | Charging continues; transfers queue. The one genuine advantage, solving a problem the doc 19 degradation already handles acceptably. |
| **Evaluator fit score** | **9/10 — Adopt** | 4/10 — Do not select | 2/10 — Reject |

### 4.2 Account types × criteria (under direct charges)

| Criterion | Standard | **Express — SELECTED** | Custom |
|---|---|---|---|
| Onboarding | School creates/owns a full Stripe account; Stripe-branded, heaviest flow. Real abandonment risk for a two-instructor Part 61 school. | **Stripe-hosted Account Links**: business profile, EIN/SSN, representative identity, bank account — typically minutes. AeroOps stores only `acct_…` + status (doc 19). | AeroOps builds all onboarding/verification UI itself. |
| KYC/KYB responsibility | Stripe, via the school's own account relationship. | **Stripe** — collection and verification on Stripe-hosted surfaces; AeroOps never sees or stores KYC values (SAQ-A posture extended to KYC, doc 19 §3.1). | AeroOps collects, Stripe verifies — AeroOps handles KYC data. Unjustifiable. |
| School-side dashboard | Full Stripe Dashboard — including the ability to **issue refunds outside AeroOps** (reconciliation drift; permanent `ReconciliationException` source) and edit settings AeroOps mirrors. | **Express dashboard**: payout visibility only. All financial actions flow through AeroOps — one source of truth, one audit trail. | None (AeroOps builds everything). |
| Stripe processing fees (direct charges) | **The school pays** — the connected account bears Stripe's fee. | **The school pays** — under direct charges the fee is debited from the connected account's balance; processing-fee incidence is *not* a Standard-vs-Express differentiator (§10 C1). | **The school pays.** |
| Negative-balance / loss liability | The school; Stripe pursues the school directly. | **The platform** (§10 C2). | The platform. |
| Dispute response UI | School's own full dashboard. | None — **AeroOps builds the evidence workflow** (Part V owner doc; webhook ingestion + `evidenceDueBy` + API submission). | AeroOps builds it. |
| Payout schedule & branding control | The school's. | **The platform's** — AeroOps can standardize payout schedules and keep the school's brand on statements. | The platform's. |
| Support burden | Split with Stripe; but school misconfiguration becomes AeroOps' support ticket anyway. | Stripe handles account/KYC support; AeroOps handles workflow. | 100% AeroOps. |
| Fit verdict | Cleanest liability, wrong operationally: out-of-band refunds break the exactly-once/reconciliation spine, and heavy onboarding fails the five-schools-tomorrow test. | **Right fit**: lightest trustworthy onboarding, all money actions inside AeroOps' audited workflow, acceptable and mitigated liability cost. | Maximum liability *and* maximum build cost. Rejected outright. |

---

## 5. Selected model — rationale against the preferred business outcome

### 5.1 The Part O preferred outcome, point by point

| Preferred outcome (spec Part O) | How the selected model satisfies it |
|---|---|
| The aviation organization provides the aviation service | The school is the settlement merchant; the transaction is legally and operationally the school's sale. |
| The organization receives proceeds through its connected Stripe account | Direct charges settle into the school's connected balance; Stripe pays out to the school's bank on schedule. AeroOps is never in the funds-flow title chain. |
| AeroOps collects a transparent application fee | `application_fee_amount` → Stripe `ApplicationFee` object — provider-reported, per-charge, reconciled against the local `PlatformFee` snapshot (doc 27 §7). |
| AeroOps does not manually custody funds | Structurally true: the split happens inside Stripe at charge time; the platform balance holds only AeroOps' own money (earned fees + SaaS revenue, doc 17 §4.1). |
| AeroOps controls the software workflow | Express gives the school no charge/refund surface outside AeroOps; every financial action is an AeroOps route with `authorize()`, `recordAudit`, and the doc 13 state machines. |
| Stripe handles regulated payment infrastructure | Card/bank data, KYC/KYB, settlement, payouts — all Stripe-hosted. AeroOps stores only the doc 13 safe-metadata allowlist and opaque IDs. |
| Customers understand who provided the service | The school's statement descriptor on cards and bank statements by default; receipts branded as the school (§7 item 11). |
| Refund and dispute ownership is explicit | Refunds draw the school's balance and are executed only through AeroOps' audited flow; disputes debit the school's balance with AeroOps operating the evidence workflow. The negative-balance tail is explicitly assigned (AeroOps, §10 C2) rather than discovered later. |

### 5.2 Why direct charges (and not the alternatives)

1. **It is the only charge type where the school is unambiguously merchant of record** — the core of the preferred outcome. Destination charges and separate charges + transfers both settle to the platform first, making AeroOps the merchant for flight training it does not provide, concentrating every tenant's dispute rate on AeroOps' own Stripe account, and pulling 1099-K/money-transmission analysis onto the platform before a single pilot school launches.
2. **The platform fee is atomic and structural.** `application_fee_amount` splits at charge time inside Stripe — no second money movement, no transfer reconciliation, and it rides the attempt's existing deterministic idempotency key (`sc_<scheduledChargeId>_a<attemptNumber>`, ADR-033): a duplicate charge is impossible, therefore a duplicate fee is impossible ([24-idempotency.md](./24-idempotency.md) K1).
3. **Part 1 already assumes it.** Docs 01/09/11/13 bake in per-org connected accounts with payer customers and Payment Methods living *on* the connected account — structural tenant isolation of provider objects. Direct charges require zero rework; either alternative forces a re-decision of bound Part 1 shapes plus a future Stripe customer-cloning migration.
4. **Statement descriptor truthfulness comes free.** A parent seeing "SKYWARD FLT SCH" instead of "AEROOPS" on a $3,000 training charge is the difference between a receipt and a chargeback.
5. **The rejected models' strengths solve problems AeroOps does not have.** Multi-account charge splitting, escrow-style re-timing, charging while a school's account is restricted — AeroOps' topology is one invoice → one school, and the doc 19 degradation (manual invoice + offline recording) already handles restricted accounts without stranding funds on the platform. If platform-managed refund reserves or multi-entity splits ever materialize, separate charges + transfers can be adopted *surgically for those flows* without changing the primary model (§7 reconsider-when).

### 5.3 Why Express (overruling doc 01 §11's Standard leaning)

Doc 01 §11 favored Standard for the "cleanest liability and tax posture." That remains true — and this decision still selects Express, because the liability Standard saves is cheaper than the two costs Standard imposes:

1. **Out-of-band refunds.** A Standard school owns a full Stripe Dashboard and *will* issue refunds from it — outside AeroOps' `RevenueAdjustment` → `Refund` flow, outside the audit trail, outside the tax-reversal snapshot invariant (doc 07), and outside `refundReversesFee`. Every such refund is a `ReconciliationException` and a hole in the append-only financial spine that Part 1 made structural. Under Express, the school has no refund surface except AeroOps: the exactly-once chain stays closed. For a system whose financial truth is "the school's accountant can trust every number," this is decisive.
2. **Onboarding reality for the market.** The north-star customer is a Director of Operations at a small Part 61 school. Express onboarding is a Stripe-hosted flow measured in minutes with AeroOps' name on the return path; Standard is "go create and configure your own Stripe account." Five schools onboarded tomorrow finish Express setup tomorrow.
3. **The Express costs are bounded and priced, not open-ended.** The Express-specific cost is the negative-balance/loss tail, not the processing fee: Stripe's processing fee is the school's own, borne on its balance under direct charges (the same as under Standard), and disclosed distinctly from the AeroOps fee per Part W's rule — never blurred. Negative-balance tail risk is mitigated by the doc 19 status gate, D4's ACH-behind-opt-in posture, the refund age hard-block with `CUSTOMER_CREDIT` fallback (D4), contractual recovery terms in the AeroOps connected-payments terms (doc 19 §6.3, legal-reviewed), and — if the owner elects it — payout-schedule control (§16 Q2).

**Simpler-workflow choice:** Express over Standard trades platform liability AeroOps can price for operational drift AeroOps could never fully reconcile — one financial workflow, inside AeroOps, for every school, instead of N school-owned dashboards with side doors.

---

## 6. How it works — the money path, end to end

The full sequence contracts live in [22-approval-to-payment.md](./22-approval-to-payment.md) (worker) and [23-webhooks-and-reconciliation.md](./23-webhooks-and-reconciliation.md) (events). This section fixes only what the Connect decision adds: *which Stripe account each object lives on, and which object moves each dollar.*

1. **Approval** (one `db.$transaction`, doc 03 §2.6 + doc 22): review approved, snapshots frozen, `ScheduledCharge` created, `PlatformFee` ACCRUED with its policy-version snapshot. **No provider call.**
2. **⟂ async hop — charge creation** (payment runner, post-commit, doc 22 W2): adapter `createCharge()` creates-and-confirms a PaymentIntent **on the org's connected account** (`Stripe-Account: <ConnectedAccount.providerAccountId>`), `off_session: true`, saved `customerRef`/`methodRef` (both live on the connected account, doc 20), `application_fee_amount = toMinorUnits(effectiveFee, currency)` — the single tested Decimal→minor-units function at the adapter boundary (ADR-027), `Idempotency-Key = sc_<scheduledChargeId>_a<attemptNumber>` (ADR-033). Mandatory timeout; timeout leaves the attempt `CREATED` for reconcile-then-proceed — never a synthesized failure, never a parallel attempt.
3. **Settlement truth arrives by webhook only** (`/api/webhooks/stripe-connect`, doc 23): `payment_intent.succeeded` / `payment_intent.payment_failed` / `payment_intent.processing` (ACH). The reduce — own transaction, guarded claims — writes `Payment`, stamps `PlatformFee.EARNED`, posts the settlement ledger journal, and projects review/invoice status. Client redirects never mark anything paid (Part AB auto-reject).
4. **Stripe splits the money at charge time**: the charge's `BalanceTransaction` credits the school's connected balance for the gross; the `ApplicationFee` object credits AeroOps' platform balance for the fee; **Stripe's processing fee is debited from the school's connected balance** (direct-charge fee incidence — the connected account pays Stripe's fee; §10 C1). The processor-fee actual is learned from that balance transaction and booked to `PROCESSOR_FEES_EXPENSE` as the school's cost, reducing `SCHOOL_RETAINED_REVENUE` (doc 28 §5.3–§5.4).
5. **Payout**: Stripe pays the school's bank from the connected balance on the account's payout schedule (`Payout` object on the connected account → `payout.paid` webhook → `ProviderPayout` row, doc 13). AeroOps never initiates payouts.
6. **Refunds/disputes** flow against the connected account's charge (diagrams §8.3–8.5; execution contracts in the Part V owner doc, fee treatment in doc 27 §4.6–4.8).

---

## 7. ADR-037 — Revenue Engine payments run as direct charges on Express connected accounts with `application_fee_amount`

*Proposed for merge into [docs/architecture/DECISIONS.md](../DECISIONS.md) verbatim upon approval, continuing [15-adr-proposals.md](./15-adr-proposals.md)'s sequence (ADR-025–036). Format per DECISIONS.md: Decision · Date · Context · Alternatives considered · Why selected · Risks · Reconsider when.*

**Date:** 2026-07 (Phase 8 Part 2) · **Status:** Proposed · **Extends** ADR-032 (provider-agnostic adapter; Connect finalized here), ADR-033 (idempotency chain), ADR-034 (platform-fee accrual/earning) · **Resolves** doc 16 D1

- **Context:** Part 1 bound a provider-agnostic payment adapter behind `REVENUE_CHARGING` (ADR-032) and deliberately deferred the Stripe Connect topology — account type, charge type, merchant of record, fee mechanics — to Part 2, gated on an approved threat model (spec Part M). Doc 11's payer model already assumes provider customers/methods live on a per-org connected account. Spec Part O requires a formal decision with documented consequences and a preferred business outcome: the school is the service provider and receives proceeds directly; AeroOps collects a transparent fee and never custodies funds.
- **Alternatives considered:** (a) **Destination charges** from the platform account — rejected: AeroOps becomes settlement merchant/MoR (1099-K, dispute rate, descriptor all platform-side), gross customer funds transit the platform balance, restricted schools strand funds on the platform, and the bound Part 1 customer topology would need rework. Fit 4/10 in independent evaluation. (b) **Separate charges and transfers** — rejected: maximum liability, minimum transparency; every student dollar sits in AeroOps' balance pending a discretionary transfer (the no-custody outcome inverted); no `application_fee_amount` (fee becomes invisible transfer-delta arithmetic); refund/dispute recovery is permanently two-legged and non-atomic. Its real strengths (multi-account splits, charging through school restrictions, re-timing) solve problems AeroOps' one-invoice-one-school design does not have. Fit 2/10. (c) **Direct charges on Standard accounts** — the cleanest liability story (the school carries its own negative balances instead of shifting the tail to the platform; the school already bears Stripe's processing fee under Express too, so that is not a Standard-only advantage), rejected on operational grounds: the school's full Stripe Dashboard is a refund side door that breaks the append-only adjustment/refund spine and reconciliation invariants, and full-Standard onboarding fails the small-school time-to-first-charge test. (d) **Custom accounts** — rejected: AeroOps builds all KYC UI and carries full liability; unjustified at this stage.
- **Decision, per spec Part O's required contents:**

| # | Part O item | Decision |
|---|---|---|
| 1 | **Selected Connect model** | Per-organization **Stripe Express connected accounts** under the single AeroOps platform account (doc 17 §4.1). One account per org, structural 1:1 (`ConnectedAccount.organizationId @unique`, doc 19). |
| 2 | **Charge type** | **Direct charges**: every PaymentIntent/SetupIntent/Customer/PaymentMethod is created *on the org's connected account* via the `Stripe-Account` header. `PaymentAttempt.providerAccountId` (doc 22 §data-model) pins each attempt to the account it executed on. |
| 3 | **Settlement merchant** | **The organization (school)**. Charges settle in the connected account's balance; Stripe pays the school's bank on the account's payout schedule. AeroOps is a platform/agent, never in the settlement chain. |
| 4 | **Processing-fee responsibility** | **The school (connected account)** — under direct charges Stripe bills its processing fees (cards 2.9% + 30¢, ACH 0.8% capped $5, at standard rates) to the connected account, debited from the school's balance, regardless of account type. The AeroOps application fee is a **separate** amount and is AeroOps' margin (its level is D2, CEO decision) — not a recovery of Stripe's cost; the school-facing fee agreement shows the AeroOps fee and Stripe's processing fee as **two distinct lines** so neither is confused with or labeled as the other (spec Part W; doc 27 §6.6; doc 28 §3.1). Booked to `PROCESSOR_FEES_EXPENSE` from provider balance-transaction actuals at settlement, reducing `SCHOOL_RETAINED_REVENUE` (doc 28 §5.3–§5.4; ingestion in doc 23). |
| 5 | **Refund responsibility** | Refunds are created against the **connected account's** PaymentIntent and draw the **school's** balance — the school economically owns the refund. AeroOps is the sole operational executor, via the audited `RevenueAdjustment(kind: REFUND)` → `Refund` flow (docs 08/13; execution in the Part V owner doc), idempotency key `rf_<refundId>` (doc 24 K2). `refund_application_fee: true` implements `PlatformFeePolicy.refundReversesFee` (default true), pro-rata on partials. Refunds past the provider window are hard-blocked with `CUSTOMER_CREDIT` fallback (D4). |
| 6 | **Dispute responsibility** | Formally the school's: the disputed amount plus Stripe's dispute fee debit the **connected account's** balance (`Dispute` model, doc 13; webhook writer, doc 23). Operationally AeroOps: Express has no dispute-response UI, so AeroOps ingests `charge.dispute.*`, tracks `evidenceDueBy`, and submits evidence via API on the school's behalf (Part V owner doc; future-ready, not overbuilt — spec Part V). ACH returns/disputes are effectively indefensible and are treated as final. The application fee is **not** auto-returned on a lost dispute; platform policy issues the fee reversal per doc 27 §4.8 (`pf_<platformFeeId>_dsp_<disputeId>`). |
| 7 | **Negative-balance responsibility** | The school's balance first; uncovered shortfalls (refund/dispute/ACH return after payout) roll up to **AeroOps** under Express loss liability. Mitigations: doc 19 §3.8 readiness gate before every charge; card-first launch with ACH behind org opt-in (D4); refund age hard-block; contractual recovery terms in the AeroOps connected-payments terms (doc 19 §6.3 — legal review required); optional payout-schedule control reserved as an owner decision (§16 Q2). Accepted consequence, priced into D2. |
| 8 | **Platform fee mechanism** | **`application_fee_amount`** on each PaymentIntent (integer minor units converted at the adapter boundary — ADR-027), computed per attempt by `src/lib/platform-fee.ts` from the **snapshotted** `PlatformFeePolicy`/agreement version (doc 27), `min(effectiveFee, attemptAmount)`, omitted when zero. Splits atomically into a Stripe `ApplicationFee` object on the platform balance; `PlatformFee` ACCRUED at approval → EARNED at settlement (ADR-034). Rides the attempt's `sc_<id>_a<n>` idempotency key — no separate fee call exists to duplicate. **Offline (cash/check) collections still mark the fee EARNED** (Part 1 binding); their *collection* cannot use `application_fee_amount` and accrues to `PLATFORM_FEE_PAYABLE`, collected by a Part 3 mechanism (platform invoice or Connect account debit — doc 27 §11). |
| 9 | **Connected-account onboarding** | Stripe-hosted **Account Links** flow per [19-connected-account-onboarding.md](./19-connected-account-onboarding.md): org admin initiates in AeroOps (in-app AeroOps terms acceptance recorded first), completes identity/business/bank on Stripe, status synced via `account.updated` webhooks + retrieve fallback into the seven Part P statuses. No live-charge initiation unless `connectedAccountReady()` (doc 19 §3.8). |
| 10 | **KYC responsibility** | **Stripe**, entirely. Collection and verification happen on Stripe-hosted surfaces; AeroOps stores only the opaque `acct_…` id, capability/requirement *keys*, and status — never names/DOB/SSN/bank details (doc 19 §3.5 payload allowlist; SAQ-A posture extended to KYC). |
| 11 | **Statement descriptors** | **The school's** — direct charges inherit the connected account's descriptor on card and ACH statements. Collected during Stripe onboarding, mirrored read-only into `ConnectedAccount.statementDescriptor` (doc 19), shown to the org in settings ("this is what your customers see"). Part 2 sets **no per-charge override**; a `statement_descriptor_suffix` carrying the review number is deferred (§15). *Simpler-workflow choice: the school's own descriptor with zero configuration beats a per-charge suffix scheme nobody has asked for.* |
| 12 | **Receipt branding** | Receipts are **AeroOps-rendered, school-branded** documents (org name/logo per the design system) on the review/payer surfaces — the school is the seller and the receipt says so; AeroOps appears only as processing software. Stripe's own email receipts are **not enabled** (`receipt_email` never set): Part 2 sends no production email (spec header; Part AA), and receipt content must match the immutable `approvalSnapshot`, which AeroOps renders and Stripe cannot. Platform-fee lines never appear on customer receipts (Part W disclosure rule; doc 27 §6.6). |
| 13 | **Reconciliation flow** | Per [23-webhooks-and-reconciliation.md](./23-webhooks-and-reconciliation.md): Connect-endpoint events (`payment_intent.*`, `charge.refund*`, `charge.dispute.*`, `payout.*`, `account.updated`) reduce local state with store-then-process idempotency; the platform endpoint carries the small application-fee event set. The reconciliation job iterates **per connected account** (bounded passes): attempts without terminal webhooks, provider-vs-local state drift, `FEE_MISMATCH` between snapshotted `PlatformFee` expectation and provider `ApplicationFee` actuals, `ProviderPayout` ingestion, connected-account restriction drift. Violations open `ReconciliationException` rows (doc 13); R1–R7 invariants per doc 12. |
| 14 | **Rollback and suspension behavior** | Layered: (i) `REVENUE_CHARGING=off` (default) — adapter absent, all charge surfaces degrade to manual invoice + offline recording, onboarding surfaces hidden (ADR-017/032 rollback lever; no `live` value exists this phase). (ii) Per-org platform suspension (`SUSPENDED`, sticky) and provider-side `RESTRICTED`/`DISABLED` — new charge initiation stops immediately; in-flight attempts are **never cancelled locally** (webhooks ride to true outcomes; never synthesize a failure); queued `ScheduledCharge` rows hold visibly, not silently (doc 19 §3.9). (iii) Decision rollback: until first live charge this ADR is paper-reversible; **after live launch, switching charge topology requires Stripe's customer/payment-method migration process and a superseding ADR** — acknowledged lock-in (§10 C7). |

- **Why selected:** It is the only shape that satisfies the Part O preferred outcome on every line (§5.1): school as merchant with its own descriptor and direct settlement, atomic transparent platform fee, zero fund custody, all money actions inside AeroOps' audited workflow. It matches the connected-account topology Part 1 already bound (docs 01/09/11/13), so the exactly-once chain, idempotency keys, and payer/customer models implement unchanged. Express (over Standard) closes the out-of-band-refund side door and makes onboarding a minutes-long hosted flow — the two properties the north-star personas (DO, accountant, owner) actually feel — at a liability cost that is bounded, mitigated, and priced into the fee (D2).
- **Risks:** the AeroOps application fee defaults to `feePercentBps` 0 until D2 sets terms, so the platform earns no fee revenue on charges until then — but the school, not AeroOps, pays Stripe's processing fee, so there is no per-charge *negative* margin for AeroOps (see §10 C1, §16 Q1); Express negative-balance tail (churned school with late ACH returns) is a real platform liability (§10 C2); AeroOps must build the dispute-evidence workflow (§10 C3); offline fee collection needs a second mechanism (§10 C4); collection halts when a school's account is restricted (§10 C5); reconciliation iterates N connected accounts (§10 C6). All quantified and accepted in §10.
- **Reconsider when:** AeroOps expands to schools outside the platform account's region or needs multi-currency settlement (per-country platform accounts or model review); a future flow genuinely needs platform-held funds (refund reserves, multi-entity splits) — adopt separate charges + transfers *surgically for that flow only*, never as the primary model; Stripe materially changes Express direct-charge fee billing or loss-liability terms; or measured dispute/negative-balance losses exceed the priced assumptions in D2 (then revisit Standard for large schools as a per-org **account-type** upgrade path — the charge type would not change).

**Required approvals before implementation:** product owner sign-off on this ADR + the approved Part M threat model. **Required before live launch:** review by qualified legal and accounting professionals (merchant-of-record posture, 1099-K, money-transmission analysis, recovery terms, fee-disclosure language) and owner review of D2 commercial terms. These gates are restated from spec Part O and are not skippable.

---

## 8. Funds-flow diagrams

Conventions: `[...]` = Stripe object that moves/records the money · `(( ))` = Stripe balance · `→` = money movement · `-->` = webhook/event (async, no money) · amounts illustrative, **fee terms are D2's decision** (illustrative agreement: 200 bps on the pre-tax subtotal, matching the RR-1042 fixture in doc 28 §6; default until D2 decides is **0 bps** — see §10 C1). Stripe's processing fee is borne by the **school** (the connected account) under direct charges, so it debits the school balance in every diagram below. All local writes follow doc 22/23 transaction boundaries; no provider call ever runs inside a DB transaction.

### 8.1 Successful card payment — gross → application fee → Stripe fee → school net

```
 Payer's card                    SCHOOL's connected account (acct_school)          AEROOPS platform account
 ────────────                    ─────────────────────────────────────────         ─────────────────────────
 $500.00 charge
   │  [PaymentIntent pi_… created ON acct_school, off_session,
   │   application_fee_amount=980, Idempotency-Key sc_<id>_a1]
   ▼
 [Charge ch_…] ────────────────► ((school balance))  +$500.00 gross
                                   │                      [BalanceTransaction]
                                   │ application fee split (atomic, at charge time)
                                   ├────────────────────────────────────────────► ((platform balance)) +$9.80
                                   │                                                [ApplicationFee fee_…]
                                   │                       Stripe processing fee $14.80 (2.9%+30¢)
                                   │                       debited from the SCHOOL ► ((school balance)) −$14.80
                                   │                       [Stripe fee BalanceTransaction — direct-charge billing:
                                   │                        the connected account pays Stripe's fee]
                                   ▼
                                 ((school balance)) net +$475.40
                                   │  payout schedule (Stripe-initiated)
                                   ▼
                                 [Payout po_…] ──► school's bank account  $475.40 (with other activity)

 Money math: school $475.40 = $500.00 − $9.80 app fee − $14.80 Stripe fee · AeroOps $9.80 (the full application fee;
             Stripe's processing fee is the school's cost, not AeroOps') · app fee $9.80 = 200 bps on the $490
             pre-tax subtotal (RR-1042 fixture, doc 28 §6.1)
 Webhooks --> /api/webhooks/stripe-connect: payment_intent.succeeded (writes Payment, PlatformFee→EARNED,
              settlement ledger journal, review CARD_PAID→PAID per D4) · payout.paid --> ProviderPayout row
```

### 8.2 ACH payment — asynchronous settlement

```
 Payer's bank                    acct_school                                       Platform account
 ────────────                    ───────────                                       ────────────────
 $500.00 debit initiated
   │  [PaymentIntent pi_… ON acct_school, us_bank_account,
   │   application_fee_amount=980, Idempotency-Key sc_<id>_a1]
   ▼
 [Charge ch_…, status processing] --> payment_intent.processing
   │                                   (review → ACH_PENDING; NOT paid — Part AB: ACH never instant)
   │        ~4 business days
   ├── SUCCESS ──► ((school balance)) +$500.00 · [ApplicationFee] → platform +$9.80
   │               Stripe ACH fee (0.8% = $4.00, cap $5) debited from the SCHOOL balance
   │               --> payment_intent.succeeded  (Payment written, PlatformFee EARNED, review → PAID)
   │               school net $486.20 = $500.00 − $9.80 app fee − $4.00 Stripe fee ──► [Payout] → school's bank
   │
   └── RETURN (R01/R02/R03/R04…, may arrive up to ~60 days for unauthorized-debit) ──►
                   ((school balance)) −$500.00 reversal [BalanceTransaction]
                   --> payment_intent.payment_failed / charge.refunded(return)
                   (attempt FAILED with R-code, review → PAYMENT_FAILED, PlatformFee un-earned per doc 27 §4.7;
                    if the school balance can't cover it → negative balance → §10 C2)

 ACH is org-opt-in (D4); hard declines (R02/R03/R04) suspend the method and are never auto-retried (doc 13).
```

### 8.3 Full refund

```
 AeroOps flow: RevenueAdjustment(REFUND) approved → Refund row (adjustmentId @unique) → post-commit adapter call
   │  [Refund re_… created ON acct_school against pi_…,
   │   refund_application_fee: true, Idempotency-Key rf_<refundId>]
   ▼
 ((school balance)) −$500.00 ─────────────────────────► payer's card/bank  +$500.00
                                                        [Refund re_…]
 ((platform balance)) −$9.80 ─────────────────────────► ((school balance)) +$9.80
   [ApplicationFeeRefund fr_… — refundReversesFee=true returns the fee to the account that funded the refund]

 NOT returned by Stripe: the original $14.80 processing fee — the school bore it and Stripe keeps it (§10 C1; doc 28 §6.4).
 Net positions across the whole lifecycle: payer whole · school −$14.80 (+500 −9.80 −14.80 −500 +9.80 = the unreturned
 processing fee, the school's true cost of a full refund) · AeroOps $0 (application fee returned via ApplicationFeeRefund)
 · Stripe +$14.80
 Webhooks --> charge.refunded / charge.refund.updated (Refund SUCCEEDED, reversal allocation set + tax-reversal
              snapshot per doc 07/08) · application_fee.refunded --> platform endpoint (PlatformFee.reversedAmount
              from provider actuals, doc 27 §4.6). Insufficient school balance → balance goes negative (§10 C2).
```

### 8.4 Partial refund (e.g. $100.00 of $500.00)

```
   │  [Refund re_… amount=10000 ON acct_school, refund_application_fee: true → proportional]
   ▼
 ((school balance)) −$100.00 ─────────────────────────► payer  +$100.00   [Refund re_…]
 ((platform balance)) −$1.96  ────────────────────────► ((school balance)) +$1.96
   [ApplicationFeeRefund — Stripe pro-rates: 100/500 × $9.80 = $1.96; provider-reported actual is written to
    PlatformFee.reversedAmount — provider actuals are money truth, local math is the reconciliation expectation]

 The original processing fee is not pro-rated back (Stripe keeps it) — the school bears it, as on a full refund (8.3).
 Refund cap enforced in-tx: Σ refunds ≤ captured amount (doc 13). Review → PARTIALLY_REFUNDED.
 Webhooks --> charge.refund.updated · application_fee.refunded (platform endpoint)
```

### 8.5 Dispute + reversal

```
 Cardholder disputes $500.00 with their bank
   --> charge.dispute.created (ON acct_school) --> /api/webhooks/stripe-connect
   ▼
 ((school balance)) −$500.00 (held) and −$15.00 dispute fee     [Dispute dp_…, BalanceTransactions]
 Local: Dispute row OPEN (evidenceDueBy), review → DISPUTED, org + platform notified (Part V owner doc)

 Evidence (AeroOps submits via API on the school's behalf — Express has no dispute UI):
 signed dispatch, Hobbs/Tach, instructor confirmation, consent record (doc 20)

   ├── WON ──► ((school balance)) +$500.00 returned [Dispute funds-reinstatement BalanceTransaction]
   │           (dispute fee not returned) --> charge.dispute.closed → Dispute WON, review restored
   │
   └── LOST ─► money stays with the cardholder. Platform policy then reverses the fee (not automatic):
               ((platform balance)) −$9.80 ► ((school balance))   [ApplicationFeeRefund,
                idempotency key pf_<platformFeeId>_dsp_<disputeId> — doc 27 §4.8]
               → Dispute LOST, refund-style reversal allocations + ledger journals
               School balance insufficient → negative balance → rolls up to AEROOPS (§10 C2)

 ACH "disputes" are returns (8.2): final, no evidence flow, treated as lost immediately.
```

### 8.6 Platform-fee flow — accrual to AeroOps' bank

```
 APPROVAL (db.$transaction)          CHARGE (async hop)               SETTLEMENT (webhook tx)        PLATFORM PAYOUT
 ──────────────────────────          ──────────────────               ───────────────────────        ───────────────
 PlatformFee ACCRUED                 application_fee_amount           payment_intent.succeeded
 (amount from SNAPSHOTTED            on the PaymentIntent             --> PlatformFee → EARNED
  agreement version: bps/flat/       (rides sc_<id>_a<n> key;         [ApplicationFee fee_…] sits
  clamps/base — doc 27)              omitted when fee = $0)           in ((platform balance))
        │                                   │                                │
        └── DB only, no provider object ────┴── atomic split at charge ──────┴──► [Payout on the PLATFORM
                                                                                   account] → AeroOps' bank
 OFFLINE collections (cash/check): PlatformFee still → EARNED at recording (Part 1 binding), accrues to
 PLATFORM_FEE_PAYABLE in the ledger — no ApplicationFee object exists; collection mechanism (platform
 invoice or Connect account debit) is Part 3 (doc 27 §11).
 Reversals: 8.3/8.4/8.5 — [ApplicationFeeRefund] decrements via PlatformFee.reversedAmount.
 Reconciliation: local EARNED expectation vs provider ApplicationFee actuals → FEE_MISMATCH exception on drift.
```

---

## 9. Configuration surface

### 9.1 Environment (finalized in doc 17 §7; restated, not redefined)

| Variable | Values (this phase) | Default | Role under this decision |
|---|---|---|---|
| `REVENUE_CHARGING` | `off \| test` | `off` | Master flag. `off` = adapter absent, every surface this ADR enables degrades gracefully. **No `live` value exists this phase.** |
| `STRIPE_CONNECT_SECRET_KEY` | `rk_test_…` (restricted, recommended) / `sk_test_…` | unset | All connected-account calls (`src/lib/stripe-connect.ts` per doc 17 §8.1 naming). Live-prefixed key with `REVENUE_CHARGING=test` fails boot. |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | `whsec_…` | unset | `/api/webhooks/stripe-connect` (connected-account events). Route inert without it. |
| `STRIPE_PLATFORM_WEBHOOK_SECRET` | `whsec_…` | unset | `/api/webhooks/stripe-platform` (application-fee events — the only Revenue Engine objects on the platform account). Doc 23 §3.1. |

Partial configuration fails loudly at boot (`assertProductionEnv`, doc 17 §7 rules). System 1's `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` are never read by Revenue Engine code.

### 9.2 Adapter surface ratified (ADR-032 interface + Part 2 additive extensions)

Every Revenue Engine provider call executes **in connected-account context** (`accountRef` = the org's `ConnectedAccount.providerAccountId`, resolved server-side from the session org — never client-supplied), except the two platform-account operations marked ⊙.

| Adapter call | Context | Notes |
|---|---|---|
| `createCustomer` / `createSetupSession` / `detachPaymentMethod` | connected account | Doc 20 owns semantics; customers/methods live on the school's account (structural tenancy). |
| `createCharge({amount, currency, customerRef, methodRef, applicationFeeAmount, idempotencyKey, metadata})` | connected account | `applicationFeeAmount` is the one signature addition to the Part 1 shape — additive, per doc 22 W2. |
| `createRefund({paymentIntentRef, amount?, refundApplicationFee, idempotencyKey, metadata})` | connected account | Part V owner doc holds the workflow; key `rf_<refundId>` (doc 24 K2). |
| `createConnectedAccount` / `createAccountOnboardingLink` / `retrieveConnectedAccount` | platform → creates/reads accounts | Signatures as proposed in doc 19 §3.4 — **ratified unchanged**. |
| `submitDisputeEvidence({disputeRef, evidence})` | connected account | Part V owner doc; minimal in Part 2 (spec: future-ready, don't overbuild). |
| ⊙ `refundApplicationFee({applicationFeeRef, amount, idempotencyKey})` | platform account | Lost-dispute fee reversal only (doc 27 §4.8). |
| ⊙ `parseWebhookEvent(signature, raw)` | n/a | Per-endpoint secret (doc 23). |

**Org-level config:** none added by this decision. **Platform-level:** fee agreements (doc 27, `authorizePlatform` only), suspend/reinstate/sync (doc 19). *Simpler-workflow choice: the Connect topology has zero org-tunable knobs — every school gets the same trustworthy shape; the only thing a school configures is its own Stripe onboarding data, on Stripe.*

### 9.3 Data model additions

**This document owns no new Prisma models or columns.** The decision is implemented entirely through shapes owned elsewhere, which it ratifies or constrains (final shapes in `34-part2-database-additions.md`):

| Model / change | Owner | What this decision pins |
|---|---|---|
| `ConnectedAccount` + `ConnectedAccountStatus` (new) | [19-connected-account-onboarding.md](./19-connected-account-onboarding.md) §5 | Ratified as proposed. One Express account per org (`organizationId @unique`); `providerAccountId` is the `Stripe-Account` context for every Revenue Engine provider call; `statementDescriptor` mirror satisfies ADR-037 item 11. |
| `PaymentAttempt` + `applicationFeeAmount Decimal(12,2)?` + `providerAccountId String?` (extension) | [22-approval-to-payment.md](./22-approval-to-payment.md) data-model section | Ratified: `providerAccountId` pins each attempt to the account it executed on (webhook tenancy cross-check, re-onboarding safety); `applicationFeeAmount` is the per-attempt fee expectation for `FEE_MISMATCH` reconciliation. Additive, nullable, no backfill. |
| `PlatformFeeAgreement` / `PlatformFee` fields | [27-platform-fee.md](./27-platform-fee.md) §13, [13-database-model.md](./13-database-model.md) §4.13 | Consumed: `application_fee_amount` is computed from the snapshotted version; `reversedAmount` written from provider `ApplicationFeeRefund` actuals. |
| `PaymentCustomer`, `PaymentMethodReference`, `ScheduledCharge`, `Payment`, `Refund`, `Dispute`, `PaymentProviderEvent`, `ProviderPayout`, `ReconciliationException` | [13-database-model.md](./13-database-model.md) (canonical) | Used exactly as bound. This decision fixes only the account context their opaque provider IDs (`cus_`, `pm_`, `pi_`, `re_`, `dp_`, `po_`) live in: the org's connected account (application-fee objects excepted — platform account). |

---

## 10. Consequences we accept (the honest cost register)

| # | Consequence | Why accepted / mitigation |
|---|---|---|
| C1 | **The school bears Stripe's processing fee** on every direct charge (cards 2.9%+30¢, ACH 0.8% cap $5 at standard rates), debited from the school's connected balance — the standard direct-charge fee incidence, independent of account type. Stripe does **not** return this fee on a refund, so a fully refunded card charge leaves the school net-negative by exactly the processing fee (doc 28 §6.4). AeroOps' application fee is a separate line and is pure margin (no Stripe cost offsets it); **until D2 sets fee terms the default `feePercentBps` is 0, so AeroOps earns zero fee revenue on charges until then** — zero, not negative, because the school (not AeroOps) pays Stripe. | Direct-charge economics put the processing cost on the merchant (the school), matching every worked example in doc 28. AeroOps' obligation is **disclosure, not absorption**: the fee agreement and school-facing surfaces show Stripe's processing fee and the AeroOps fee as two distinct lines, never conflated (Part W; doc 28 §15). D2 sets the AeroOps fee for margin **before any real-school launch**; test mode this phase = no real dollars at risk while D2 is decided. |
| C2 | **Negative-balance tail liability is AeroOps'.** A school whose balance can't cover a refund, lost dispute, or late ACH return (returns can arrive weeks after payout) leaves the platform holding the shortfall; a churned school with open ACH exposure is a real, unbounded-in-theory tail. | Bounded in practice by: doc 19 readiness gate; card-first launch, ACH behind explicit org opt-in (D4); refund age hard-block + `CUSTOMER_CREDIT` fallback; contractual recovery terms in the AeroOps connected-payments terms (legal-reviewed); owner option on payout-schedule control (§16 Q2). Monitored via `ProviderPayout`/balance reconciliation (doc 23). |
| C3 | **AeroOps builds the dispute-evidence workflow** (Express has no dispute UI): webhook ingestion, `evidenceDueBy` tracking, API evidence submission. | Part V owner doc scopes it minimal-but-future-ready (spec's own instruction). The evidence AeroOps holds (signed dispatch, meters, instructor confirmation, consent records) is exactly what wins card disputes — a product strength, not just a cost. |
| C4 | **`application_fee_amount` does not unify fee collection**: offline cash/check collections (which still mark `PlatformFee` EARNED per Part 1) need a second collection mechanism. | Accrue to `PLATFORM_FEE_PAYABLE`; collection mechanism (monthly platform invoice vs Connect account debit) is a Part 3 decision (doc 27 §11). No customer money is involved — purely AeroOps↔school. |
| C5 | **Collection halts when a school's account is restricted** (`charges_enabled=false` ⇒ PaymentIntent creation fails); `payouts_enabled=false` strands funds in the school's connected balance until requirements clear. | Doc 19 §3.8/3.9: graceful degradation to manual invoice + offline recording, queued charges held visibly, org notified with the exact requirement list and deadline. The school keeps flying and billing; only card/ACH initiation pauses. Never worked around by charging on the platform account. |
| C6 | **Reconciliation is per-connected-account** — payouts, balance transactions, and fee actuals live on N accounts, not one platform ledger. | Matches the tenancy model (org-scoped everything); doc 23's job runs bounded per-account passes; `ProviderPayout` uniques make ingestion idempotent. |
| C7 | **Topology lock-in after live launch**: moving charge types later requires Stripe's customer/payment-method migration process. | Acknowledged in ADR-037 rollback item 14(iii). Until first live charge the decision is paper-reversible; the reconsider-when clause names the triggers. |
| C8 | **Multi-currency/multi-country constraints**: each school settles in its account's currency; app fee must match charge currency; separate legal entities need separate connected accounts. | Part 2 scope is single-org-currency USD (doc 13 §2.3). Expansion triggers the ADR's reconsider-when, not a silent workaround. |

---

## 11. Validation & business rules

1. **No provider call inside any DB transaction** (Part S / Part AB auto-reject; ADR-025 lineage). Charge creation, refunds, fee reversals, account calls — all post-commit async hops with mandatory timeouts and deterministic idempotency keys (doc 24 catalog).
2. **Connected-account context is server-resolved, always.** `accountRef` comes from the session org's `ConnectedAccount` row; no route accepts a client-supplied `acct_…`, `cus_…`, `pm_…`, or `pi_…` as an instruction — client-supplied provider IDs are looked up locally and verified org-owned (cross-tenant = 404).
3. **Webhook tenancy from local references only** (doc 09 §2.10, doc 23): PaymentIntent events resolve via local `PaymentAttempt.providerPaymentIntentId`; account events via the signed envelope's `account` field → `ConnectedAccount @@unique([provider, providerAccountId])`; object `metadata` is a must-match cross-check, never attribution — under direct charges the connected-account holder can technically edit metadata, which is exactly why it is never the lookup key.
4. **`application_fee_amount ≤ charge amount`, enforced app-side** before the call (`min(effectiveFee, attemptAmount)`, doc 27 §4.4); zero fee ⇒ parameter omitted.
5. **Provider actuals are money truth for fees**: `ApplicationFee`/`ApplicationFeeRefund` amounts from webhooks write `PlatformFee` earned/reversed values; local computation is the reconciliation *expectation* (`FEE_MISMATCH` on drift). Never the other way around.
6. **Money at the boundary**: Decimal(12,2) + ISO 4217 everywhere internally (ADR-027); the single tested `toMinorUnits(Decimal, currency)` function is the only place Decimal meets provider integer units, at the adapter, both directions.
7. **ACH is never instant** (Part AB auto-reject): `payment_intent.processing` ⇒ `ACH_PENDING`; `PAID` only on webhook-confirmed settlement (D4). Client redirects never change financial state.
8. **The school is the merchant on every customer-facing surface**: receipts, descriptors, payer portal copy name the school as seller. AeroOps' fee never appears on customer documents (Part W disclosure; doc 27 §6.6), and no AeroOps surface ever labels the platform fee as a Stripe fee.

---

## 12. RBAC, approvals & audit

This decision adds **no new permission keys** — it consumes the catalogs its owner docs define:

- **Org-side** (`src/lib/permissions.ts`, `revenue.*` per D3): `revenue.connect_manage` (doc 19 — onboarding/sync), `revenue.charge` (doc 09/22 — runner, holds, retries), `revenue.refund` (doc 08/Part V), `revenue.payment_methods_manage` (doc 20).
- **Platform-side** (`src/lib/platform-permissions.ts`): `platform.connect.view` / `platform.connect.suspend` (doc 19), fee-agreement keys (doc 27 §8.1 — never org-editable, Part AB auto-reject enforced by the constitution-test pattern).
- **Audit**: every mutation the diagrams imply is audited by its owner doc's action catalog (`revenue.connect_*`, charge/refund/fee actions). Webhook-driven state changes audit with actor label `system:webhook`; runner actions with `system:payment-runner` (R18 labels).
- **Approvals**: ADR-037 itself requires product-owner sign-off + approved threat model before implementation, and legal/accounting review before live launch (§7 footer) — restated because it is a workflow gate, not just a document footnote.

---

## 13. Failure modes & edge cases

| # | Failure | Behavior under this topology |
|---|---|---|
| F1 | Charge attempted while account restricted mid-flight | PaymentIntent creation fails at the provider → attempt FAILED with a safe code; but doc 19 §3.8 check 0 normally prevents the call entirely (no claim, no attempt row). Review follows the doc 25 failure workflow. |
| F2 | Refund against a drained school balance | Provider allows it; the connected balance goes negative — Stripe recovers from future charges, else §10 C2. Reconciliation surfaces the negative balance; platform staff notified (doc 23). |
| F3 | Lost dispute drives the account negative and the school churns | AeroOps' loss (Express liability). Contractual recovery terms + the doc 19 suspension lever; write-off path is Part 3 (`WRITTEN_OFF` reserved, no writer in Parts 2–3). |
| F4 | ACH return after school payout completed | Return debits the (possibly empty) school balance weeks later → F2 mechanics. This is why ACH is org-opt-in (D4) and why `PlatformFee` un-earns per doc 27 §4.7. |
| F5 | Application fee webhook missing after a succeeded charge | `PlatformFee` stays EARNED from the settlement reduce (charge-level truth); fee *actuals* reconciliation flags `FEE_MISMATCH` if provider fee data never arrives — flag-for-human, never auto-heal money. |
| F6 | Stripe processing-fee billing lands on the school's connected balance (debited from the charge's balance transaction) | Learned from the charge's balance-transaction actual and booked to `PROCESSOR_FEES_EXPENSE` at settlement, reducing `SCHOOL_RETAINED_REVENUE` (doc 28 §5.3–§5.4/§9; ingestion doc 23) — the school's own cost; expected shape, not an exception. |
| F7 | Adapter timeout on `createCharge` | Attempt stays `CREATED`; reconcile-then-proceed via the stored idempotency key within Stripe's ~24h key TTL, fetch/search after (doc 24 §6). Never a parallel attempt, never a synthesized failure. |
| F8 | Same payer at two AeroOps schools | Two independent Stripe Customers (one per connected account) — by design; methods are saved per school with per-school consent (docs 11/20). No cross-school method sharing exists to leak. |
| F9 | Org deletes/re-creates its Stripe relationship | `DISABLED` is terminal in Part 2; re-provisioning a replacement account is deferred (doc 19 §10 Q4) — historical attempts resolve their account through the immutable 1:1 row. |

---

## 14. UX notes

- **Owner/DO settings ("Payments" card, doc 19 §9):** shows the school-facing truth of this decision — "Payments settle directly to your bank via Stripe", the school's statement descriptor ("this is what your customers' statements show"), payout destination last-4, and status. No Stripe jargon: "Express", "direct charges", "application fee" never appear on org surfaces; the fee appears under its agreement name per doc 27 §10.2.
- **Accountant:** the Revenue Dashboard's settlement view reconciles to the school's *own* Stripe payouts (gross − AeroOps fee − Stripe processing fee = payout components), because the school is the merchant — no "AeroOps paid us" middleman line to explain to their CPA.
- **Payer surfaces:** receipts and statements carry the school's name; payment status language follows doc 03 tones (`ACH Pending` with the expected window). The platform fee is never shown to students/payers (Part W).
- **Platform Console:** connection status + fee agreements per docs 19/27; no secret financial information (Part P), no KYC values ever displayed.

---

## 15. Out of scope for Part 2 / deferred to Part 3+

- Any `live` mode, live keys, real charges, deployment, or production email — this entire design set is paper + (later in Part 2 implementation) Stripe **test mode** behind `REVENUE_CHARGING=test`.
- Offline platform-fee **collection** mechanism (invoice vs account debit) — doc 27 §11 (Part 3).
- `statement_descriptor_suffix` per charge (review number on statements) — Part 3 polish.
- Payout-schedule control / rolling reserves — owner decision first (§16 Q2), implementation Part 3.
- Replacement connected accounts after `DISABLED` — doc 19 §10.
- Instructor payouts via Connect transfers — explicitly out (doc 04 §9; Financial Export is the boundary).
- Multi-currency, non-US schools, per-org account-type upgrades (Standard for enterprise schools) — ADR-037 reconsider-when.
- Stripe fee-billing netting optimizations (e.g., Stripe's fee-recoupment behaviors on connected accounts) — revisit with real volume data.

---

## 16. Open questions (product owner)

| # | Question | Why it matters | Who |
|---|---|---|---|
| Q1 | **D2 commercial fee terms** (doc 16): the mechanism is decided here, the numbers are not. The AeroOps application fee is pure margin — the school bears Stripe's processing fee directly under direct charges, so the fee does **not** need to "recover" Stripe's cost; the current default of `feePercentBps 0` simply means AeroOps earns **zero** fee revenue on charges until D2 prices it (the school pays Stripe either way). D2 sets the margin AeroOps wants and how it is disclosed alongside Stripe's fee (two distinct lines, never conflated — Part W). Per-rail fee differentiation (card vs ACH) is supported and recommended. | Gates real-school economics; blocks nothing in test mode. | CEO, with this ADR in hand |
| Q2 | **Payout-schedule posture**: leave Stripe's default rolling schedule (schools get money fastest — best trust story), or set a platform-controlled delay/reserve on Express accounts to buffer the §10 C2 negative-balance tail? Recommendation: default schedule at launch; revisit with dispute data. | Trust vs tail-risk trade; contractual language depends on it. | Product owner + legal |
| Q3 | **Recovery terms** for school-owed shortfalls (negative balances AeroOps covers) in the AeroOps connected-payments terms (doc 19 §6.3) — right of set-off against future collections? Direct invoicing? | Legal drafting input; must exist before live launch. | Legal counsel |
| Q4 | **Consistency pass item**: [27-platform-fee.md](./27-platform-fee.md) links to this decision as `18-stripe-connect-adr.md`; the file lives at `18-stripe-connect-decision.md` (the name docs 19/22 use). One link fix in doc 27 by the designated consistency/refresh agent — not edited here. | Broken relative link in the design set. | Design-set editor |
| Q5 | **1099-K communication to schools**: under direct charges Stripe reports on the school's account. Do onboarding materials state this explicitly ("you will receive tax reporting from Stripe, not AeroOps")? Recommendation: yes, with legal-reviewed wording. | Owner-facing trust + support-ticket prevention. | Legal + Head of Product |

---

## Related documents

[19-connected-account-onboarding.md](./19-connected-account-onboarding.md) (Part P — onboarding, statuses, gate) · [20-payment-methods-and-consent.md](./20-payment-methods-and-consent.md) (Part Q) · [22-approval-to-payment.md](./22-approval-to-payment.md) (Part S) · [23-webhooks-and-reconciliation.md](./23-webhooks-and-reconciliation.md) (Part T) · [24-idempotency.md](./24-idempotency.md) · [25-payment-failure-workflow.md](./25-payment-failure-workflow.md) (Part U) · [27-platform-fee.md](./27-platform-fee.md) (Part W) · [17-two-financial-systems.md](./17-two-financial-systems.md) (Part N) · [13-database-model.md](./13-database-model.md) (canonical schema) · [15-adr-proposals.md](./15-adr-proposals.md) (ADR sequence) · [16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md) (D1/D2/D4)
