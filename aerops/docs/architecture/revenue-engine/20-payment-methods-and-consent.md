# Payment Methods & Off-Session Consent

> **Status:** Proposed — Phase 8 Part 2 · **Date:** 2026-07-10 · **Lead roles:** Principal Payments Architect at Stripe; Financial UX Designer; Security Engineer at Cloudflare · **Part of:** Revenue Engine design set ([README](./README.md))

Part 2 deliverable 4 (spec Part Q — Customer and Payment Method Model, including Off-session consent). Design only: no schema, code, migration, Stripe object, or live charge ships with this document. Stripe **test mode** is the only sanctioned environment, and even test mode is not exercised in this phase.

---

## 1. Purpose & scope

This document finalizes how a paying party becomes a Stripe Customer, how saved Payment Methods are captured and stored, and how **off-session charging consent** is recorded as a first-class, auditable, revocable record — so that when the Revenue Review approval flow ([03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md)) later charges a saved method with no human at the keyboard, the school can prove the payer said yes, to this school, under this text, for this method.

### In scope

- `PaymentCustomer` semantics under the Connect model selected in doc 18 (Stripe Connect ADR): which human/entity maps to a Stripe Customer, **in which Stripe account context**, for every payer shape the spec names (student self-pay, parent/guardian, sponsor, organization-as-payer).
- `PaymentMethodReference` — the safe-display-metadata record — and the verbatim never-store list as hard constraints.
- Method capture via provider-hosted surfaces (SetupIntent / hosted setup session), including both ACH verification paths (instant verification and micro-deposits).
- Multiple methods per customer, default selection, per-review override.
- Method lifecycle: added → verified → active; expired-card handling; suspension; detachment; org-side visibility.
- **`PaymentConsent`** (new model): capture at method save, text versioning, revocation, and the hard rule — *no off-session charge without a valid, unrevoked consent* — enforced at approval readiness and re-checked at charge initiation.
- Tenancy: global payer `User`, org-scoped everything else.

### Out of scope (see §10)

Charging itself (Part 2 card/ACH workflow docs, spec Parts R/S), webhook pipeline mechanics beyond the setup events this doc owns (Part T doc), connected-account onboarding states (Part P doc), refunds/disputes, pay-now on manual invoices, spending alerts.

---

## 2. Relationship to Part 1 docs

Part 1 is binding; this document extends without reinterpreting.

| Part 1 doc | What it fixed | What this doc adds / finalizes |
|---|---|---|
| [13-database-model.md](./13-database-model.md) §4.12 | **Canonical shapes** for `PaymentCustomer` (XOR `payerId`/`studentId`, triple unique R20) and `PaymentMethodReference` (safe-metadata allowlist, `StoredPaymentMethodStatus`, never-delete/detach rule) | Account-context semantics (`providerCustomerId` lives on the **org's connected account**); two additive columns on `PaymentMethodReference` (`verifiedAt`, `verificationPath`); the new `PaymentConsent` + `BillingAuthorizationText` models. Final shapes ratified in 34-part2-database-additions.md. |
| [11-responsible-payers.md](./11-responsible-payers.md) | Five-way identity separation; `ResponsiblePayer` / `StudentPayerRelationship`; payer-level billing authorization (`billingAuthorizationVersion`/`AcceptedAt`, captured at invitation acceptance, §3.5); `canManagePaymentMethods` capability; "methods only for ACTIVE payers" | Method-linked consent as a second, structural layer **on top of** (never replacing) the payer-level authorization; consent for self-pay students, who have no `ResponsiblePayer` row; the reconciliation rules in §3.6.1. |
| [09-payment-timing-and-collection.md](./09-payment-timing-and-collection.md) | SAQ-A PCI stance (§4.4 note); payment-readiness engine (§5.2); hard-decline → method `SUSPENDED`; adapter interface (`createCustomer`, `createSetupSession`, `detachPaymentMethod`, `createCharge`, `parseWebhookEvent`) behind `REVENUE_CHARGING` | New readiness rows for consent validity; the capture sequences the adapter's `createSetupSession` must support (off-session usage, ACH mandate collection); the pre-attempt consent gate in the payment runner. |
| [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) | Approval transaction, `paymentMethodRefId` frozen at approval, consequence-truthful approve wording | The consent condition that must hold before the "Approve … and charge the saved payment method" control is enabled. |
| [01-revenue-engine-architecture.md](./01-revenue-engine-architecture.md) §11 | Provider-agnostic adapter; per-org connected-account assumption ("payer customers and Payment Methods live on the org's connected account") | Confirms that assumption under doc 18's decided topology and derives its consequences (§3.1). |
| [16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md) | D1 (direct charges + application fee, Express recommended), D4 (card-first, ACH org opt-in), D7 (payer charge approval → Phase 9) | This doc assumes doc 18 resolves D1 as recommended; nothing here depends on Standard vs Express (both keep customers on the connected account). ACH capture paths ship behind the D4 opt-in. |
| [14-migration-plan.md](./14-migration-plan.md) | M8 = `PaymentCustomer`/`PaymentMethodReference` migration slot | `PaymentConsent`, `BillingAuthorizationText`, and the additive columns land **with M8** (new models may ride the same slot; additive-only). |

Sibling Part 2 docs referenced: doc 18 (Stripe Connect ADR, spec Part O), the connected-account onboarding doc (spec Part P), the card/ACH workflow docs (spec Part R), the webhook design doc (spec Part T), and 34-part2-database-additions.md (final call on all NEW Part 2 shapes).

---

## 3. How it works

### 3.1 Which party maps to a Stripe Customer — and in which account context

Doc 18 selects **direct charges on per-organization connected accounts with `application_fee_amount`** (D1 recommendation; the school is merchant of record). Consequence, binding on every flow in this doc:

> **Every Revenue Engine Stripe Customer and PaymentMethod object is created on the organization's connected account** (`Stripe-Account: acct_…` header on every adapter call). The AeroOps **platform** Stripe account holds *only* SaaS-billing customers (Part N separation; `Organization.stripeCustomerId` per PRODUCTION.md §13.2). No Revenue Engine customer, method, SetupIntent, or mandate ever exists on the platform account, and no SaaS-billing object ever appears on a connected account.

This makes tenant isolation **structural**: a `pm_…` saved with School A physically cannot be attached to a charge on School B's account. The app-layer tenancy rules below are defense in depth, not the only wall.

Mapping of paying parties (extends [11-responsible-payers.md](./11-responsible-payers.md) §2 — one `PaymentCustomer` per (organization, paying party), created lazily on first method save):

| Spec Part Q party | Local identity | `PaymentCustomer` linkage | Stripe context |
|---|---|---|---|
| **Student as payer** (adult renter, self-pay) | `Student` (`payerId` null on the review) | `studentId` set, `payerId` null | Customer on the org's connected account |
| **Parent/guardian as payer** | `ResponsiblePayer` (`PARENT` / `GUARDIAN`) | `payerId` set | Same |
| **Sponsor as payer** | `ResponsiblePayer` (`SCHOLARSHIP_SPONSOR`, `CLUB_SPONSOR`) | `payerId` set | Same |
| **Organization as payer** — an external entity (employer, university, sponsoring company) pays | `ResponsiblePayer` (`EMPLOYER`, `UNIVERSITY`, `OTHER` with `companyName`) | `payerId` set; the linked `User` is the entity's billing contact, who performs consent acceptance on the entity's behalf (recorded via `acceptedByLabel`) | Same — one corporate card can cover many students (doc 11 §2 consequences) |
| **The tenant org itself** (internal/comped/ferry flights) | — | **Never a `PaymentCustomer`.** A school does not charge its own connected account with its own saved card — a provider anti-pattern and a fee leak. Internal flights are handled by a 100% discount adjustment ([08-adjustments-discounts-credits.md](./08-adjustments-discounts-credits.md)) or `MANUAL_INVOICE` + offline recording. | n/a |

Simpler-workflow choice: "organization as payer" is modeled as the existing entity-type `ResponsiblePayer` rather than a new payer species — one payer model, one portal, one consent flow, and doc 11's routing/visibility rules apply unchanged.

Restated Part 1 consequences that Part 3 implementers must not "optimize away": a parent with two children at one school has **one** `PaymentCustomer`; the same parent at two schools has **two**, on two different connected accounts, and saves their card twice. Payment Methods never cross tenants. `PaymentCustomer` rows are created lazily — no method saved, no Stripe object.

**Customer-creation idempotency.** `adapter.createCustomer` is called outside any DB transaction and carries a deterministic provider Idempotency-Key: `cust_<organizationId>_<payer|student>_<partyId>` (ADR-033 idiom). A concurrent double-tap creates one `cus_…`; the local `@@unique([organizationId, payerId])` / `([organizationId, studentId])` insert race resolves by re-reading the winner. An orphaned provider customer (created, local insert lost to a crash) is harmless — the next attempt re-sends the same idempotency key and receives the same `cus_…`.

### 3.2 Hard constraints — what is never stored

Verbatim from spec Part Q, binding on every model, log line, export, audit record, and error message in the Revenue Engine. These are automatic-rejection conditions in the Part 2 security audit (spec Part AB: "Raw card/bank data stored"):

**Never store:**

- **Full card number**
- **CVV**
- **Full bank number**
- **Stripe client secret after use**
- **Raw SetupIntent secrets**
- **Raw account tokens**

Plus the Part 1 additions already binding (doc 09 §4.4, principle 8): no PAN, no bank routing numbers, no raw payment tokens, no provider secret keys, and **no column named `*token` / `*secret`** in any payment model (`tests/token-security.test.ts` patterns). Enforcement:

| Rule | Mechanism |
|---|---|
| The safe-metadata allowlist on `PaymentMethodReference` is **closed**: `brand`, `last4`, `expMonth`, `expYear`, `bankName`, `fingerprint` (doc 13 §4.12) plus this doc's `verifiedAt`/`verificationPath`. Nothing else, ever. | Doc 13 binding shape; 34-part2-database-additions.md ratifies the two additive columns; schema review rejects any further column |
| Card/bank entry happens **only on provider-hosted surfaces** (SAQ-A). AeroOps never renders a card field, an account-number field, or a micro-deposit-amount field — verification is Stripe-hosted too. | No such component exists in the design; UI review + Part AB audit |
| The hosted setup URL / client secret transits AeroOps **once**, in the response that launches the hosted surface, and is never persisted, logged, or echoed. `providerSetupIntentId` (`seti_…`), `providerCustomerId` (`cus_…`), `providerPaymentMethodId` (`pm_…`), `providerMandateRef` (`mandate_…`) are **opaque references, not credentials** — safe to store. | Structured logger (`src/lib/logger.ts`) field discipline; static source-scan test asserting the setup route never writes the secret to any model; code review |
| Webhook payloads for our event set carry no PAN/bank numbers (Stripe never includes them); `PaymentProviderEvent.payload` retention is therefore safe. | Doc 13 §4.12 note; Part T doc |
| Consent evidence stores IP/user-agent — personal data, but never financial credentials. | §3.6; retention question in §11 |

### 3.3 Method capture flow — provider-hosted SetupIntent

Preconditions for every capture path (server-enforced, explainable failures):

1. `REVENUE_CHARGING=test` and the adapter configured — otherwise capture surfaces are hidden with an explicit message; manual invoice + offline recording continue to work (ADR-032 graceful degradation).
2. The org's connected account is in a status that permits method setup: **allowed in `PENDING`, `REQUIREMENTS_DUE`, `RESTRICTED`** (customers and methods live *on* the connected account, so payers can save methods while the school finishes Stripe paperwork), **refused only in `SUSPENDED`, `DISABLED`, `NOT_STARTED`** — otherwise "Payment setup unavailable" and the setup route refuses (422). Capturing a method does not require a chargeable account; only off-session charging requires the charge-readiness gate ([19-connected-account-onboarding.md](./19-connected-account-onboarding.md) §3.8 owns account-state gating).
3. The paying party is capture-eligible: a `ResponsiblePayer` in **ACTIVE** status (linked `User` — doc 11 §3.2: INVITED payers cannot save methods), or the student's own authenticated session for self-pay. **Org staff never enter card data and there is no surface on which they could** — staff *initiate* sessions; the paying party completes them on their own device (front-desk pattern: staff shows a QR code, payer scans, signs in, completes on their phone).
4. Method types offered: `card` always; `us_bank_account` only when `OrgPaymentPolicy.achDebitEnabled` (D4 org opt-in, §4).

**Sequence A — save a card or bank account (happy path).** Async hops marked `⇢`; DB transaction boundaries marked `[tx]`.

1. Paying party (payer portal via `authorizePayer()`, or student session; staff-assisted = same flow reached from a staff-generated deep link) opens **Add payment method**. AeroOps renders the **consent screen**: the org's current billing-authorization text (resolved per §3.6.2), version label, exact plain-language consequences ("{Org} may charge this payment method for approved charges after each flight. You can revoke this at any time."), and a single explicit acceptance control.
2. `POST /api/...payment-methods/setup-session` — thin route: `authorizePayer()` / session gate → zod (`acceptConsent: true` literal required) → engine.
3. Engine validates preconditions 1–4 and resolves/creates the `PaymentCustomer`:
   - *(provider call — never inside a DB tx)* `adapter.createCustomer` with the deterministic idempotency key (§3.1), only if no row exists;
   - `[tx 1]` upsert `PaymentCustomer` (unique-guarded; loser of a race re-reads).
4. `[tx 2]` insert **`PaymentConsent`** row: `consentVersion` = org's current version, `consentTextHash`, `acceptedAt = now()`, `acceptedByUserId`/`acceptedByLabel`, `ipAddress`, `userAgent`, `channel = METHOD_SETUP`, `paymentMethodReferenceId = null` (bound later by webhook). `recordAudit('payment_consent.granted')`.
5. *(provider call — outside tx)* `adapter.createSetupSession({ customerRef, methodTypes, usage: 'off_session', returnUrl, metadata: { organizationId, paymentConsentId } })` → `{ hostedUrl, providerSetupIntentId }`. Metadata is **server-set** and used later only as a must-match cross-check, never for attribution (Part 1 webhook-tenancy rule).
6. `[tx 3]` stamp `providerSetupIntentId` onto the `PaymentConsent` row. `recordAudit('payment_method.setup_started')`. Return `hostedUrl` to the browser — the URL/client secret is **used once and never stored** (§3.2).
7. `⇢ async` Paying party completes entry on the **Stripe-hosted** surface. Card: confirms immediately. ACH: chooses instant verification (Stripe Financial Connections bank login) or micro-deposits. Stripe collects the ACH debit **mandate** here — mandate text and records live at Stripe; we store only the opaque `providerMandateRef`.
8. `⇢ async` Webhook (`setup_intent.succeeded`, or `setup_intent.requires_action` for the micro-deposit path) arrives at the inbound Connect webhook route (Part T doc): **verify signature first** → `PaymentProviderEvent` unique-insert `[own tx]` → reduce `[own tx]`:
   a. Resolve tenancy: connected-account id on the event → org (Part P mapping), then `PaymentConsent` by `@@unique([provider, providerSetupIntentId])`. Event `metadata.paymentConsentId` must match — mismatch = processing error, event parked, `ReconciliationException` opened. Never resolved from metadata alone.
   b. Upsert `PaymentMethodReference` (`@@unique([organizationId, provider, providerPaymentMethodId])` makes replays no-ops): copy the safe metadata from the event object (`brand`, `last4`, `expMonth`, `expYear`, `bankName`, `fingerprint`); status = `ACTIVE` (card / instant-verified ACH; `verifiedAt = now()`, `verificationPath = 'instant'`) or `REQUIRES_VERIFICATION` (micro-deposits pending).
   c. Bind consent: set `paymentConsent.paymentMethodReferenceId`, copy the denormalized method snapshot (`methodType`/`methodBrand`/`methodLast4` — the R28 idiom, evidence survives anything), stamp `providerMandateRef` (ACH), and stamp `supersededAt` on any older consent rows for the same method.
   d. Default election: if this is the customer's only `ACTIVE` method, set `isDefault = true` (clear-then-set in this same tx).
   e. Post-commit only: `recordAudit('payment_method.saved', actor 'system:webhook')`, `emitDomainEvent('payment_method.saved')`, in-app notification (Part AA doc).
9. `⇢ async` Browser lands on `returnUrl`: a status page that **polls and displays** — "Confirming with your bank…" until the reduce lands. The redirect **never** writes anything (Part AB: client redirect is never trusted; webhook-confirmed state only).

**Sequence B — ACH micro-deposit verification (1–2 business days).**

1. Day 0: Sequence A ends with the method row in `REQUIRES_VERIFICATION`. The consent row exists and is bound, but the method is not chargeable (chargeability requires `ACTIVE`, §3.6.4). Payer notification: "Verify your bank account — two small deposits arrive within 1–2 business days."
2. `⇢ async, days later` Payer opens **Verify** from their method list. AeroOps fetches the Stripe-hosted verification URL on demand via the adapter (ephemeral, never stored) and redirects. The payer enters the deposit amounts / descriptor code **on the Stripe-hosted page** — never on an AeroOps form.
3. `⇢ async` Webhook `setup_intent.succeeded` → reduce flips the method `REQUIRES_VERIFICATION → ACTIVE`, sets `verifiedAt`, `verificationPath = 'microdeposits'`; default election as in A-8d; post-commit audit + `payment_method.verified` notification.
4. Failure path: verification attempts exhausted or `setup_intent.setup_failed` → reduce sets `DETACHED` + `detachedAt` (actor `system:webhook`), payer + org notified, readiness reverts to "no payment method".

**Sequence C — consent re-acceptance (no provider involvement).** Used when the org bumps its authorization text version (§3.6.2) or after revocation, for an already-saved method: authenticated paying party → consent screen (same rendering, method context shown) → `[one tx]` insert new `PaymentConsent` row (`channel = RE_ACCEPTANCE`, method bound immediately, snapshot copied, prior row for the method stamped `supersededAt`) → audit. No Stripe call — the provider mandate is unchanged; only the org-level authorization evidence is refreshed.

### 3.4 Multiple methods, default selection, per-review override

| Rule | Detail |
|---|---|
| Any number of saved methods per `PaymentCustomer` | Card + ACH may coexist; org UI and payer portal list all with status chips |
| Exactly one default per customer | `isDefault` on `PaymentMethodReference` (doc 13). Enforced by engine **clear-then-set inside one `$transaction`** (the doc 11 default-payer idiom without the partial index). We deliberately do not add a third raw-SQL partial unique — doc 13 §12 flags the schema-governance allowlist for the existing two; 34-part2-database-additions.md may add one if the DB architect prefers structural enforcement. |
| Default selection | First `ACTIVE` method auto-elected (A-8d). Changing default: payer (own methods, `canManagePaymentMethods`) or staff (`revenue.payment_methods_manage`); audited with before/after. |
| Per-review override, pre-approval | A reviewer may select any **eligible** method for a specific Revenue Review — `RevenueReview.paymentMethodRefId` (doc 13 §4.4). Eligible = `ACTIVE`, belongs to the review's resolved paying party's customer, same org, valid consent. Frozen at approval. |
| Post-approval re-point | Only `ScheduledCharge.paymentMethodReferenceId`, only in `FAILED` / `AWAITING_MANUAL`, audited (doc 13 §4.12 — unchanged). Re-pointing re-runs the eligibility check including consent. |
| Detaching the default | If exactly one other `ACTIVE` method exists it is auto-promoted (audited, `payment_method.default_changed`, actor system with cause). Otherwise no default remains and readiness reports "no default payment method". Simpler-workflow choice: auto-promote the sole survivor — a front desk should not have to re-pick the only card on file. |

### 3.5 Method lifecycle

State machine over `StoredPaymentMethodStatus` (doc 13 enum — no new values; **expired is deliberately not a status**, see below). All transitions are guarded `updateMany` claims with `recordAudit`.

| From | To | Trigger | Actor |
|---|---|---|---|
| *(none)* | `ACTIVE` | Card / instant-verified ACH saved (Sequence A-8) | `system:webhook` |
| *(none)* | `REQUIRES_VERIFICATION` | ACH micro-deposit path initiated (Sequence A-8) | `system:webhook` |
| `REQUIRES_VERIFICATION` | `ACTIVE` | Micro-deposits verified (Sequence B-3); sets `verifiedAt` | `system:webhook` |
| `REQUIRES_VERIFICATION` | `DETACHED` | Verification failed/exhausted, or abandoned past org cleanup window; also manual removal | `system:webhook` / payer / staff |
| `ACTIVE` | `SUSPENDED` | Hard decline on an attempt (`stolen_card`, ACH `R02`/`R03`/`R04` — doc 09, binding). Never auto-retried. | `system:payment-runner` |
| `ACTIVE` | `DETACHED` | Payer removes; staff removes (reason required); provider-side `payment_method.detached` event; connected-account replacement (§8) | payer / staff / `system:webhook` |
| `SUSPENDED` | `DETACHED` | Cleanup — the **only** exit from `SUSPENDED`. There is no reactivation path: a suspected-compromised instrument is replaced by saving a fresh method, never un-suspended. | payer / staff |

Notes:

- **Rows are never deleted** (doc 13, binding). Detach = status + `detachedAt` + provider-side detach (`adapter.detachPaymentMethod`, called outside the tx; if the provider call fails the local row still detaches and a `ReconciliationException` records the drift — local state governs charging).
- **Expired cards are derived at read**, from `expMonth`/`expYear` — never a stored status (single source of truth; a status would go stale the moment the network updater refreshes the card). Readiness already warns "card expires before the scheduled charge date" (doc 09 §5.2); the Revenue Dashboard ops queue adds a "methods expiring within 60 days" list.
- **Network card updater**: `payment_method.automatically_updated` events refresh `brand`/`last4`/`expMonth`/`expYear` in place — display metadata is not a financial snapshot, so in-place update is correct; audited as `payment_method.metadata_refreshed`, actor `system:webhook`. `PaymentAttempt` rows keep the denormalized snapshot they were created with (R28) — history is unaffected.
- **Org-side visibility**: staff with any revenue-review permission see the method summary chip (brand + last4 + expiry + status) on reviews and readiness panels; managing (add-link/detach/default) requires `revenue.payment_methods_manage`. Payers see only their own methods; students only their own; **no one** sees more than the allowlist because nothing more exists to see. `fingerprint` is never rendered on any surface — it is a dedupe hint, not display data.

### 3.6 Off-session consent — `PaymentConsent`

The heart of this document. Because charging happens after approval with no payer present (spec Part Q: "charges occur after invoice approval"), consent must be **explicit, versioned, per-method, revocable, and provable**.

#### 3.6.1 Two consent layers — reconciling with Part 1

Part 1 already binds a **payer-level** billing authorization: `ResponsiblePayer.billingAuthorizationVersion` / `billingAuthorizationAcceptedAt`, captured at invitation acceptance and re-prompted on version change (doc 11 §3.5), with the binding rule "the payment-readiness evaluator treats a missing authorization exactly like a missing Payment Method". This doc does not weaken or replace it. The layers:

| Layer | Record | Captured | Covers | Applies to |
|---|---|---|---|---|
| 1. Payer relationship authorization (Part 1, unchanged) | `ResponsiblePayer.billingAuthorizationVersion`/`AcceptedAt` | Invitation acceptance | "I am this school's paying party; bill me for my linked students" | `ResponsiblePayer` rows only |
| 2. Off-session charge consent (this doc, new) | `PaymentConsent` row | **At method save** (Sequence A step 4), and on re-acceptance (Sequence C) | "This school may charge *this saved method* off-session for approved charges" | Every paying party — including self-pay students, who have no layer-1 record |
| (Provider layer) | Stripe mandate (ACH) / off-session usage (card) | On the hosted surface | The bank/network-level authorization | Lives at Stripe; we store only `providerMandateRef` |

Automatic (off-session) charging requires **layer 1 where a `ResponsiblePayer` is the bill-to party, and layer 2 always**. Manual timing (`MANUAL_INVOICE`) and offline recording require neither (doc 11 §3.5, unchanged). Layer 2 closes the Part 1 gap for self-pay students and gives every charge a method-specific evidence trail — which layer 1, being payer-wide and method-blind, cannot.

#### 3.6.2 Consent text and versioning

- The org's current version pointer is `RevenueSettings.billingAuthorizationVersion` (doc 13 §4.14, default `"v1"` = platform default text — unchanged).
- The **text bodies** get a home: new `BillingAuthorizationText` model, one immutable row per (organization, version). Absent rows fall back to the platform default text catalog in `src/lib` keyed by version (zero-setup: an org that never touches this uses `v1` platform text and has no rows).
- **Text rows are immutable once any `PaymentConsent` references their version** (engine-enforced): changing wording requires inserting the next version's row and bumping the pointer via the standard zod-validated settings PATCH with before/after `recordAudit`. Evidence never changes under a payer's feet; `PaymentConsent.consentTextHash` (sha256 of the rendered text) pins what was actually shown.
- **Version bump effect**: every existing consent row becomes *stale* — validity is **derived at read** by comparing `consentVersion` to the current pointer (no mass-update, no stored staleness flag). Readiness flips to `NOT_READY (consent stale)` for automatic charging; the settings screen states this consequence before the org confirms the bump ("All payers must re-accept before their next automatic charge"); affected parties get a re-accept notification and Sequence C refreshes each method in two clicks.

#### 3.6.3 Revocation

- **Who**: the paying party (payer portal / student surface — their own consent, always, no permission can remove this right); or org staff with `revenue.payment_methods_manage` recording a revocation on the party's behalf (phone/front-desk request; reason required).
- **How**: guarded update stamping `revokedAt`, `revokedByUserId`/`revokedByLabel`, `revokedReason` on the targeted consent row(s) — per method, or "revoke all" across the customer. Rows are never deleted; revocation is itself evidence.
- **Effect**: immediate. No new `PaymentAttempt` may be created against a method without a valid consent (§3.6.4) — including for **already-approved, already-scheduled** charges. An attempt already `PROCESSING` at the provider runs to completion (the provider-level mandate governed it at initiation; we never synthesize failures). The method row itself stays `ACTIVE` — revoking consent is not detaching the instrument; the payer may still use it on-session (pay-now, Part 3) and may re-consent later (Sequence C).
- **Side effects (post-commit)**: `recordAudit('payment_consent.revoked')`, `emitDomainEvent('payment_consent.revoked')`, notification to configured org roles ("Automatic charging lost for {party} — {n} scheduled charges affected"), and the affected `ScheduledCharge` rows surface in the due-charges queue as **Blocked — consent revoked** with the actionable next steps (request re-consent / convert to manual invoice / record offline payment).

#### 3.6.4 The hard rule and where it is enforced

> **No off-session charge without a valid, unrevoked consent.**

Validity is a pure predicate (`src/lib/payment-consent.ts`, framework-free, contract-tested like `billing.ts`):

```
validConsent(row, currentVersion) :=
      row.paymentMethodReferenceId != null   // bound to the method
  AND row.revokedAt   == null
  AND row.supersededAt == null
  AND row.consentVersion == currentVersion

chargeable(method) :=
      method.status == ACTIVE
  AND ∃ PaymentConsent row for method with validConsent(row)
  AND (bill-to is a ResponsiblePayer → layer-1 authorization current)   // doc 11 §3.5, unchanged
```

Enforcement points (defense in depth — each independently sufficient to stop money moving):

| # | Point | Behavior on failure |
|---|---|---|
| E1 | **Payment readiness** (doc 09 §5.2 — this doc adds the rows) — evaluated at review generation, re-evaluated at approval | New reasons: "No off-session consent for the selected method" / "Consent is stale (org authorization text updated)" / "Consent revoked". `NOT_READY` for charging policies → under `approveWithoutMethod = WARN` the effective policy converts to `MANUAL_INVOICE` at approval with truthful control wording; under `BLOCK`, approval disabled with the reason. Spec Part S's approval pre-verification list ("Saved payment method exists") is satisfied only by a **chargeable** method. |
| E2 | **Payment runner, pre-claim gate** (`src/lib/payment-runner.ts`) | Due `ScheduledCharge` rows failing `chargeable()` are **skipped before the `PROCESSING` claim** (no phantom attempt, no provider call) and surfaced in the due-charges queue as Blocked with the reason. Never silent: every pass reports skipped rows in its per-row outcomes. |
| E3 | **Attempt creation invariant** (engine, contract-tested) | `createPaymentAttempt()` re-asserts `chargeable()` inside the claiming transaction and refuses (`409`, audited) if it no longer holds — closes the race between E2's check and the claim. |
| E4 | **Manual charge & retry routes** (`revenue.charge`) | Same engine path as E3; a human clicking "Charge now" cannot bypass consent. |

Simpler-workflow choice: **one validity rule everywhere** — stale or revoked consent blocks new attempts even for reviews approved while consent was valid. Two regimes ("approved-before-bump charges still run") would be cheaper operationally but unexplainable at the front desk and indefensible in a consent dispute; the due-charges queue makes the blocked rows visible and one-click resolvable instead. (Owner confirmation requested — §11 Q1.)

Interaction with Part 1's suspension rule (doc 11 §3.2: a SUSPENDED payer's already-approved scheduled charges still execute): unchanged — suspension is an org workflow state. Consent revocation is the payer's own legal instruction and is strictly stronger; E2/E3 apply regardless of payer status.

---

## 4. Configuration surface

Org level (typed columns on existing singletons — never a settings blob; absent row = defaults):

| Setting | Home | Type / default | Effect |
|---|---|---|---|
| `billingAuthorizationVersion` | `RevenueSettings` (exists, doc 13 §4.14) | String, `"v1"` | Current consent text version; bumping forces re-acceptance before the next automatic charge (§3.6.2) |
| Authorization text bodies | `BillingAuthorizationText` rows (new, §5) | — | Org-customized text per version; absent = platform default catalog. **Part 2 ships version bumps of platform text only; org-authored custom text is deferred** (§10, §11 Q2) |
| `achDebitEnabled` | `OrgPaymentPolicy` (additive column, proposed — final home ratified by the Part 2 ACH doc + 34-part2-database-additions.md) | Boolean, `false` | D4 org opt-in: gates `us_bank_account` in setup sessions and ACH-capable timing policies |
| `approveWithoutMethod` | `OrgPaymentPolicy` (exists) | `WARN` | Unchanged (D13); now also governs the consent-missing readiness outcomes (E1) |
| `payerNotificationsEnabled`, per-relationship `receivesNotifications`, `canManagePaymentMethods` | `RevenueSettings` / `StudentPayerRelationship` (exist) | doc 11 defaults | Unchanged; gate the §3 notifications and payer-side method management |

Platform level:

| Item | Control |
|---|---|
| Platform default consent text catalog (versioned, in `src/lib`) | Code-reviewed constant; legal-reviewed before any live launch (doc 18 requirement) |
| Connected-account readiness gate on capture (§3.3 precondition 2) | Part P doc; Platform Console shows connection status without secrets |
| `REVENUE_CHARGING` env flag (`off` default / `test`) | ADR-032 — no `live` value exists in this phase |

Zero-setup posture (principle 10): a fresh org with charging enabled needs to configure **nothing** here — `v1` platform text, card-only, WARN fallback all work untouched.

---

## 5. Data model additions (Prisma-flavored)

Final shapes ratified in 34-part2-database-additions.md; doc 13 conventions apply (cuid ids, `organizationId` + real relation + explicit `onDelete`, `createdAt`, org-leading indexes, tenant-scoped uniques — auto-enforced by `tests/schema-governance.test.ts`). Migration slot: **M8** (with `PaymentCustomer`/`PaymentMethodReference`). New enum ships in its own DDL migration before first use (doc 14 two-step rule).

### 5.1 `PaymentConsent` (new)

```prisma
enum PaymentConsentChannel {
  METHOD_SETUP  // accepted on the AeroOps consent screen immediately before hosted setup (Sequence A)
  RE_ACCEPTANCE // accepted for an already-saved method after a version bump or revocation (Sequence C)
}

/// Off-session charging consent — one append-only row per acceptance
/// (spec Part Q). Evidence-grade: rows are never edited except to stamp
/// revocation/supersession timestamps; validity is DERIVED at read
/// (bound + unrevoked + unsuperseded + version-current). The denormalized
/// method snapshot follows the R28 idiom so evidence survives everything.
model PaymentConsent {
  id                String                @id @default(cuid())
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

  consentVersion  String   // org's billingAuthorizationVersion at acceptance
  consentTextHash String   // sha256 of the rendered text shown (integrity pin)
  channel         PaymentConsentChannel
  acceptedAt      DateTime
  acceptedByUserId String?
  acceptedByLabel  String  // the paying party's human (entity payers: the billing contact acting for the entity)
  ipAddress        String? // evidence "where appropriate" (spec Part Q); null off-web
  userAgent        String?

  provider              PaymentProvider @default(STRIPE)
  /// Opaque seti_... / cs_... correlation id — not a secret (§3.2).
  providerSetupIntentId String?
  /// Opaque provider mandate reference for ACH (mandate_...) — not a secret.
  providerMandateRef    String?

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

  @@unique([provider, providerSetupIntentId])       // webhook correlation; replay-safe (nullable — RE_ACCEPTANCE rows exempt)
  @@index([organizationId, paymentCustomerId])
  @@index([paymentMethodReferenceId, revokedAt])    // chargeable() lookup
  @@index([organizationId, createdAt])
}
```

FK rationale (doc 13 §8 policy): consent is a financial-fact evidence record → `Restrict` toward what it evidences (customer, method); `Organization` Cascade is the wipe backstop. **Org-snapshot wipe order**: `PaymentConsent` → `PaymentMethodReference` → `PaymentCustomer`; capture/restore in the same slice (restore consents after methods). Not excluded from wipe (unlike `PaymentProviderEvent` — consent is tenant data).

### 5.2 `BillingAuthorizationText` (new)

```prisma
/// One immutable row per (org, version) of the billing-authorization text.
/// Absent rows = platform default catalog in src/lib keyed by version.
/// Immutable once any PaymentConsent row cites the version (engine-enforced);
/// wording changes insert the next version and bump
/// RevenueSettings.billingAuthorizationVersion.
model BillingAuthorizationText {
  id             String   @id @default(cuid())
  organizationId String
  version        String
  body           String   // rendered to the payer verbatim; hash of this = consentTextHash
  createdAt      DateTime @default(now())
  createdByLabel String

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, version])
}
```

### 5.3 Extensions to doc-13 models (additive only; ratified in 34-part2-database-additions.md)

| Model | Change | Why |
|---|---|---|
| `PaymentMethodReference` | + `verifiedAt DateTime?` · + `verificationPath String?` (engine catalog: `instant` \| `microdeposits`) · + `consents PaymentConsent[]` back-relation | ACH verification evidence (spec Part Q "verification/status metadata"); safe metadata, not credentials. Status enum untouched — expiry stays derived (§3.5). |
| `PaymentCustomer` | + `consents PaymentConsent[]` back-relation (relation only, no columns) | Consent lookup |
| `OrgPaymentPolicy` | + `achDebitEnabled Boolean @default(false)` (proposed — ACH doc + 34 finalize the home) | D4 org opt-in gate for capture (§3.3) and charging |
| `RevenueSettings` | none | `billingAuthorizationVersion` already exists (R29) — this doc gives it its text store and consent semantics |

No change to `PaymentCustomer`/`PaymentMethodReference` core shapes, `ScheduledCharge`, `PaymentAttempt`, or `RevenueReview` — doc 13 stands as written.

---

## 6. Validation & business rules

| # | Rule | Enforcement |
|---|---|---|
| V1 | Any `paymentMethodRefId` written to a review (pre-approval selection) or `ScheduledCharge` (FAILED/AWAITING_MANUAL re-point) must be org-owned, `ACTIVE`, belong to the record's resolved paying party's `PaymentCustomer`, and be chargeable (§3.6.4). Cross-tenant / other-party ids → 404, indistinguishable from nonexistent | Engine check on every write (doc 11 V1 pattern); Part AB "cross-tenant payment lookup" auto-reject |
| V2 | `PaymentCustomer` and `PaymentConsent` party XOR: exactly one of `payerId` \| `studentId`; consent's copy must match its customer's | App-enforced in the engine (doc 13 R20 precedent); contract test |
| V3 | Method capture requires: `REVENUE_CHARGING=test`, connected account in a setup-permitted status (`PENDING`/`REQUIREMENTS_DUE`/`RESTRICTED`/`ENABLED` — refused only in `SUSPENDED`/`DISABLED`/`NOT_STARTED`, per [19-connected-account-onboarding.md](./19-connected-account-onboarding.md) §3.8), ACTIVE payer (linked `User`) or student's own session, method type allowed by `achDebitEnabled` | Setup-session route precondition block (§3.3), each failure with actionable reason |
| V4 | Consent acceptance is performed only by the paying party in their own authenticated session; org staff initiate but never accept. `acceptConsent` is an explicit literal in the request body — no implied consent, no pre-checked boxes | Route zod schema + `authorizePayer()`/session gate; audit records the acceptor |
| V5 | Exactly one `isDefault` per customer among `ACTIVE` methods; `DETACHED`/`SUSPENDED`/`REQUIRES_VERIFICATION` rows can never be default | Clear-then-set in one `$transaction`; detach/suspend transitions clear the flag in the same tx (§3.4) |
| V6 | The chargeable() predicate (§3.6.4) gates approval readiness (E1), runner selection (E2), attempt creation (E3), and manual charge/retry (E4) | Pure engine + contract tests; static source-scan test asserts no attempt-creation call site bypasses the gate (dispatch-idempotency test style) |
| V7 | Never-store list (§3.2): no column beyond the allowlist; setup URL/client secret never persisted or logged; no `*token`/`*secret` column names in payment models | Schema review; `tests/token-security.test.ts` patterns; logger field discipline; Part AB audit |
| V8 | Provider calls (`createCustomer`, `createSetupSession`, `detachPaymentMethod`, on-demand verification-URL fetch) never execute inside a DB transaction; every call carries a timeout and, where creating provider state, a deterministic idempotency key | ADR-011/-025/-033; Part AB auto-reject "Stripe API call inside long database transaction" |
| V9 | Webhook reduces are replay-safe: `PaymentProviderEvent` unique-insert first; method upsert keyed on `[organizationId, provider, providerPaymentMethodId]`; consent bind idempotent (already-bound row = no-op); tenancy resolved from the connected-account mapping + local `providerSetupIntentId` row with metadata as must-match cross-check only | Part T pipeline (Part 1 §2.10 pattern); duplicate-event tests (spec Part AC) |
| V10 | Version-bump PATCH refuses reusing an existing version string, refuses editing a cited `BillingAuthorizationText` row, and requires a confirmation flag acknowledging the re-acceptance consequence | Settings route zod + engine; before/after `recordAudit` |
| V11 | Unbound `METHOD_SETUP` consent rows (setup abandoned) are never valid and never listed as consents; they are retained as evidence of the attempt. No sweep deletes them | Derived validity (§3.6.4); append-only table |
| V12 | Detach clears review/charge references safely: `ScheduledCharge.paymentMethodReferenceId` is `SetNull` (doc 13) and re-selection is forced by readiness/queue; approved snapshots keep their denormalized method display (approvalSnapshot JSON + R28 attempt snapshots) | Doc 13 FK actions; no dangling display data |

---

## 7. RBAC, approvals & audit

Permissions (data in `src/lib/permissions.ts` — no new Role enum values; `revenue.*` module gating per doc 01):

| Key | Grants (this doc's surfaces) | Default roles |
|---|---|---|
| `revenue.payment_methods_manage` (exists, doc 09) | Initiate setup sessions on a party's behalf (link/QR), detach methods, change default, record payer-requested consent revocation (reason required), trigger re-accept requests | ACCOUNT_OWNER, SCHOOL_ADMIN, ACCOUNTANT |
| `revenue.review_view` etc. (exist) | See method summary chip + consent status on reviews/readiness | per doc 03 |
| Payer self-service | Own methods + own consents: add (with `canManagePaymentMethods`), verify, detach, set default, revoke consent, re-accept | `authorizePayer()` (doc 11 §7.2); routes catalogued under SELF_SERVICE with `getSession()` + 401 per constitution test |
| Student self-pay self-service | Same, own records only | Student session; surface sequencing per §10 |

Approval interactions: none of these actions is itself approval-gated (saving a card must be effortless), but every one of them feeds the review approval gate through readiness (E1). Consent **acceptance can never be performed by staff, an AI pathway, or impersonation**: constitution rule 8 (AI never mutates financial records) plus read-only-impersonation mutation blocking apply to every route here; the denial paths are part of the Part AC test plan (payment-method ownership, responsible-payer access, tenant isolation).

Audit actions (`recordAudit` on every mutation, reconstruct-without-DB-state metadata):

| Action | Actor | Key metadata |
|---|---|---|
| `payment_method.setup_started` | staff or paying party | party, customer, method types offered, consent row id |
| `payment_consent.granted` | paying party | version, textHash, channel, ip/ua, method (once bound) |
| `payment_method.saved` / `payment_method.verified` | `system:webhook` | pm ref (opaque), type/brand/last4, verificationPath |
| `payment_method.default_changed` | staff / payer / system (auto-promote) | before/after method ids |
| `payment_method.detached` | staff / payer / `system:webhook` | reason, provider-side vs local origin |
| `payment_method.suspended` | `system:payment-runner` | failure code (safe), attempt id |
| `payment_method.metadata_refreshed` | `system:webhook` | changed fields (before/after safe metadata) |
| `payment_consent.revoked` | paying party / staff-on-behalf | reason, scope (method/all), affected scheduled charges count |
| `payment_consent.reaccepted` | paying party | old/new version |
| `org.settings_change` (version bump) | staff | before/after version, text hash |

Domain events (registered in `WEBHOOK_EVENTS` with live emit sites, post-commit only): `payment_method.saved`, `payment_method.detached`, `payment_consent.revoked`. Notification kinds (additive `NotificationKind` values, final list owned by the Part AA doc): method saved/verification needed/verified/expiring/suspended, consent re-acceptance requested, consent revoked (org roles).

`STATUS_TONE` entries ship for all four `StoredPaymentMethodStatus` values (ACTIVE positive, REQUIRES_VERIFICATION attention, SUSPENDED critical, DETACHED neutral); consent chips (Current / Stale / Revoked / Pending setup) are derived labels mapped onto existing tones — no stored status exists to enroll.

---

## 8. Failure modes & edge cases

| Failure / edge | Behavior |
|---|---|
| Webhook arrives before the browser redirect (common) | Fine — the reduce is the writer; the return page finds the method already saved |
| Redirect never happens (payer closes tab after Stripe success) | Method still saved via webhook; consent bound; payer sees it on next visit. The redirect writes nothing (Part AB) |
| Webhook delayed/lost | Return page keeps polling with honest copy ("Confirming…"); Stripe retries webhooks; the Part T reconciliation sweep re-drives stored-but-unprocessed events and lists unbound consents older than the setup-session TTL |
| Duplicate `setup_intent.succeeded` delivery | `PaymentProviderEvent` unique-insert → 200 no-op; method upsert + consent bind are idempotent (V9) |
| Setup abandoned on the hosted page | Consent row stays unbound (never valid, V11); Stripe expires the session (~24h); no local cleanup needed |
| Same card saved twice | Distinct `pm_…`, matching `fingerprint` → save proceeds, UI shows "This looks like a card already on file" and offers detaching the older one; never auto-detached |
| Micro-deposit verification failed/exhausted | Method → `DETACHED` (Sequence B-4); payer + org notified; readiness reverts |
| Card expires before `runAfter` | Readiness warning (doc 09, unchanged); dashboard "expiring soon" queue; network updater may refresh it silently (`metadata_refreshed`) |
| Hard decline mid-life | Method `SUSPENDED` (doc 09, binding); consent row untouched (consent is to the party's instrument choice, but chargeable() fails on status) — replacement method requires a fresh Sequence A, which captures fresh consent |
| Consent revoked between approval and charge | E2/E3 block new attempts; `ScheduledCharge` surfaces as Blocked in the due-charges queue with next steps; never silently skipped |
| Consent revoked while an attempt is `PROCESSING` | Attempt completes (provider mandate governed at initiation); no new attempts. If it fails, retry paths hit E3 and stop |
| Org bumps authorization version | All consents stale (derived); banner + queue + bulk re-accept notifications; blocked charges resolve via Sequence C or manual invoice |
| Payer archived / relationship revoked | Part 1 rules unchanged (approved snapshots survive; routing stops). Methods/consents remain rows; nothing new routes to them. Consent validity is not tied to relationship status — E1–E4 plus routing rules already prevent misuse |
| Connected account restricted or disabled after methods saved | `RESTRICTED`: the charge gate pauses new charges, but method capture stays allowed (§3.3 precondition 2) so payers can still add/replace methods; `SUSPENDED`/`DISABLED`: both capture and charging refuse ([19-connected-account-onboarding.md](./19-connected-account-onboarding.md) §3.8). Saved methods stay intact awaiting account recovery |
| Connected account **replaced** (org re-onboards under a new `acct_…`) | All `cus_`/`pm_`/mandates are unreachable under the new account: mass transition — methods → `DETACHED` (reason `account_replaced`), consents → revoked (actor `system`, reason `account_replaced`), org + payers notified, re-capture campaign. Cross-ref Part P doc; `ReconciliationException` if any charge was in flight |
| Provider detach call fails after local detach | Local `DETACHED` governs (nothing will charge it); `ReconciliationException(kind: MISSING_PROVIDER_TRANSACTION-family)` records the drift for the sweep |
| `REVENUE_CHARGING` off / adapter unset | All capture/consent surfaces hidden with explicit copy; manual invoice + offline recording unaffected (ADR-032) |
| Impersonation (read-only) | Every route here mutates → blocked; verified by the standard denial tests |

---

## 9. UX notes

- **Front-desk flow is the design target** (north-star: a dispatcher onboarding a renter in under a minute): staff hits "Add payment method" on the student/payer record → QR code + short link → payer completes consent + Stripe form on their phone → the staff screen live-updates to the method chip when the webhook lands. No card numbers spoken aloud, no staff keyboard entry — and the UI says why ("For your security, card details go directly to Stripe").
- **Consent screen** is deliberately plain: org name, the exact versioned text, the amount context ("charged after each approved flight review"), a single un-prechecked checkbox, and "You can revoke this at any time in your payment settings." No dark patterns; the Financial UX bar is that a parent reads it in fifteen seconds and understands it.
- **Method chips** everywhere (review Payment section, payer portal, org lists): brand glyph + `•••• 4242` + `exp 04/28` + status tone. Consent state rides the chip as a secondary line: "Consent: current (v2)" / "Re-acceptance needed" / "Revoked". Expired cards show the derived state with the fix ("Expired — ask the payer to update").
- **ACH pending-verification** rows show the expected window ("Deposits arrive in 1–2 business days") and a Verify button that goes straight to the Stripe-hosted page. Never an amount-entry field in AeroOps.
- **Approve control truthfulness** (doc 03, binding): when consent is missing/stale under `WARN`, the control reads the manual-invoice wording, and the readiness panel names the exact reason with the one-click fix ("Request re-acceptance").
- The due-charges queue's **Blocked — consent revoked** rows carry the three resolutions inline (request re-consent / convert to manual invoice / record offline payment) — a Director of Operations should resolve each in one screen.
- Light/dark + mobile parity; loading/empty/error states specified with the surfaces (empty methods list explains what saving a method enables).

---

## 10. Out of scope for Part 2 / deferred to Part 3

- **Payer portal & student billing surfaces** carrying these flows end-user-side: doc 11 §10 sequences the payer surface in Part 3 while doc 16 §4.1 lists payer surfaces under Part 2 — this doc defines the flows either way and treats the surface-sequencing call as a scheduling note for the Part 2 implementation plan, not a design fork (the org-side staff-assisted path in §3.3 is unambiguously Part 2).
- Org-authored custom consent text (Part 2 = platform default text + version bumps only; custom bodies need legal review — §11 Q2).
- Pay-now on manual invoices (on-session payments), payer statements, spending alerts (doc 11 §10).
- Payer charge approval flow — Phase 9 per D7 (columns dormant, unchanged).
- Importing card-on-file arrangements from legacy systems — **impossible by design and permanently out of scope**: PANs/bank numbers are never imported; existing customers re-save methods through the hosted flow, which captures consent as a side effect (this is the migration story, not a gap).
- Wallets / prepaid balances — permanently rejected (Part 1); nothing here creates a stored-value instrument.
- Multi-currency method/customer handling (single org currency per Part 1).
- Automated consent-expiry policies (e.g., annual re-acceptance) — no requirement yet; the version mechanism can express it later without schema change.

---

## 11. Open questions

| # | Question | Recommendation | Decider |
|---|---|---|---|
| Q1 | Confirm the single-validity rule (§3.6.4): a consent-version bump or revocation blocks **already-approved** scheduled charges until re-acceptance, surfacing them in the due-charges queue — vs honoring approval-time consent for in-flight reviews. | Block (as designed). Consent is the payer's standing instruction, not an approval-time snapshot; the queue makes the operational cost one click. | Product owner (+ legal counsel note before live launch) |
| Q2 | May organizations author custom billing-authorization text in Part 3, and does custom text require platform/legal review before it can be activated? | Part 2: platform default text only. Part 3: allow custom bodies gated behind a platform-reviewed flag — a school's home-written consent text is a liability surface for both parties. | Product owner + legal |
| Q3 | Retention period for `PaymentConsent` evidence (including IP/UA personal data) after method detachment, payer archival, or org offboarding — indefinite as financial evidence, or a fixed retention window? | Retain with the financial records they evidence (same lifetime as `PaymentAttempt` history); revisit with the data-retention policy before live launch. | Product owner + legal |
| Q4 | Should staff-recorded consent revocation (on a payer's phone request) require a second approver, given it can strand scheduled revenue? | No — revocation must never be delayed; the notification to finance roles plus audit is the control. Confirm. | Product owner |

---

## Related documents

Part 1: [09-payment-timing-and-collection.md](./09-payment-timing-and-collection.md) · [11-responsible-payers.md](./11-responsible-payers.md) · [13-database-model.md](./13-database-model.md) · [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) · [16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md) · [14-migration-plan.md](./14-migration-plan.md)
Part 2 siblings: doc 18 (Stripe Connect ADR) · connected-account onboarding (Part P) · card/ACH workflows (Part R) · webhook design (Part T) · 34-part2-database-additions.md (final schema call)
