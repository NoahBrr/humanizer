# Financial Security Threat Assessment

> **Status:** Proposed — Phase 8 Part 2 · **Date:** 2026-07-10 · **Lead roles:** Security Engineer at Cloudflare; Principal Payments Architect at Stripe; Reliability/SRE Engineer · **Part of:** Revenue Engine design set ([README](./README.md))

This document is Part 2 deliverable 17 (spec **Part AB — Financial Security**): the threat model whose approval — together with the Part 1 architecture — **gates any payment implementation** (spec Part M lineage; restated in [18-stripe-connect-decision.md](./18-stripe-connect-decision.md) §7 footer). It audits every Part AB area against the Part 1 + Part 2 design set, walks the named abuse cases end to end, and renders the automatic-rejection checklist as a verifiable table.

**Coverage statement, stated once and binding:** this assessment covers the **design** (docs 00–31, 34) — not an implementation, which does not exist yet. Every "PREVENTED" verdict below means *structurally prevented by the approved design, with a named Part 3 verification method*; each verification must actually pass before the corresponding surface ships. Stripe **test mode** is the only sanctioned environment and even it is not exercised in this phase; `REVENUE_CHARGING` has no `live` value ([17-two-financial-systems.md](./17-two-financial-systems.md) §7). **Live launch additionally requires review by qualified legal and accounting professionals** (merchant-of-record posture, 1099-K, money-transmission analysis, recovery terms, consent/fee-disclosure language) and product-owner sign-off on ADR-037 — echoing [18-stripe-connect-decision.md](./18-stripe-connect-decision.md) §7; none of these gates is skippable and none is satisfied by this document.

---

## 1. Scope, assets, and trust boundaries

### 1.1 In scope

Every Part 2 money surface: connected-account onboarding (doc 19), payment methods + off-session consent (doc 20), card/ACH rails (doc 21), approval-to-payment (doc 22), webhooks + reconciliation (doc 23), idempotency (doc 24), failure workflow (doc 25), refunds/voids/disputes (doc 26), platform fee (doc 27), allocation/ledger (doc 28), instructor compensation (doc 29), dashboard surfaces (doc 30), notifications (doc 31), and the Part 1 financial spine they extend (docs 03/08/09/11/12/13). The System 1 SaaS-billing boundary (doc 17) is in scope as a boundary; System 1's implementation (Phase C) is not.

### 1.2 Assets

| # | Asset | Home | Why an attacker wants it |
|---|---|---|---|
| A1 | Money state machines: `ScheduledCharge` → `PaymentAttempt` → `Payment` → `Refund` | 13 §4.12/§4.10, 22, 26 | Forging a transition = free money, double charges, or fake settlements |
| A2 | Saved-method references + off-session consent evidence (`PaymentCustomer`, `PaymentMethodReference`, `PaymentConsent`) | 13 §4.12, 20, 34 §4.2 | Charging instruments without authorization; consent-dispute leverage |
| A3 | Immutable financial snapshots: `approvalSnapshot`, `TaxSnapshot`, `RevenueAllocation`, `LedgerEntry`, `PlatformFee.termsSnapshot` | 03 §2.6, 12, 27 §13 | Rewriting history hides theft and corrupts the school's books |
| A4 | Platform fee agreements (`PlatformFeePolicy` + `PlatformFeeTier`) | 27, 34 §4.5 | An org zeroing its own fee is direct revenue loss to AeroOps |
| A5 | Connected-account state (`ConnectedAccount`) and the charge-readiness gate | 19, 34 §4.1 | Redirecting settlement or charging through a non-ready/foreign account |
| A6 | Secrets: `STRIPE_CONNECT_SECRET_KEY`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `STRIPE_PLATFORM_WEBHOOK_SECRET`, `AUTH_SECRET`, Account-Link URLs, hosted-setup client secrets | env only; 17 §7, 19 §6.6, 20 §3.2 | Key theft = arbitrary provider calls; webhook secret theft = forged financial truth |
| A7 | Audit trail (`AuditLog`) and inbound event forensics (`PaymentProviderEvent.payload`) | SECURITY_STANDARDS §Audit, 23 §6/§10 | Repudiation; PII in stored payloads |
| A8 | Reports/exports: Revenue Dashboard, Revenue Reports, Financial Export (`FinancialExportJob`), Instructor Compensation | 12 §2.7, 29, 30 | Whole-org financial disclosure in one file |
| A9 | Cardholder/bank data | **Nowhere, by design** — Stripe-hosted surfaces only (20 §3.2) | The asset whose absence is the control |

### 1.3 Trust boundaries

Six boundaries; every arrow crossing one is named with its control. Sequences elsewhere mark provider calls ⚡ (async, never inside a transaction) and webhooks ⇠.

| Boundary | What crosses it | Trust decision | Controls |
|---|---|---|---|
| B1 **Payer browser → tenant app** | Method-setup initiation, consent acceptance, payer/student views | **Untrusted.** No client-supplied amount, org id, provider id, or "it succeeded" claim is ever believed | `authorize()`/`authorizePayer()`/session gate + zod on every route; org scope from session (SECURITY_STANDARDS §Authorization); amounts server-resolved (22 §7 rule 2); redirects never write (23 §8) |
| B2 **Tenant app (org staff) → engines** | Approvals, charges, retries, refund requests, voids, method management | Authenticated but permission-scoped; staff of org A are **untrusted for org B and for platform state** | Permission catalog (`src/lib/permissions.ts`); `{mutating:true}` refusals under read-only impersonation (`src/lib/session.ts` `authorize()`); engine-level ownership checks (20 §6 V1) |
| B3 **Platform console → tenant + platform state** | Fee agreements, suspend/reinstate, sweeps, quarantine requeue, impersonation | Platform staff are trusted for their matrix capabilities only; **never implicit org members** (ADR-023) | `authorizePlatform(platformRolesWith(...))` + `restrictedOrgIds` scoping; mutations refused mid-impersonation (`src/lib/session.ts`); AUDITOR provably read-only (ADR-022) |
| B4 **Worker (payment runner / reconciliation) → Stripe** ⚡ | `createCharge`, `createRefund`, account calls, re-fetches | Outbound calls are at-least-once with unknown outcomes possible | Deterministic idempotency keys persisted-before-call (24 §4); timeouts mandatory; never inside `$transaction` (22 §3.4); unknown outcome ⇒ reconcile-never-assume (24 §6) |
| B5 **Stripe → webhook ingress** ⇠ | `payment_intent.*`, `charge.*`, `account.*`, `setup_intent.*`, `application_fee.*` | **The public internet.** Anyone can POST; only signature-verified events are Stripe | Per-endpoint signing secrets verified before any side effect (23 §3.3); store-then-process with unique insert (23 §4); local-references-only tenancy + quarantine (23 §4.3); livemode quarantine (23 §3.2) |
| B6 **System 2 ↔ System 1** (Revenue Engine ↔ SaaS billing) | Nothing except the read-only `PlatformFeePolicy.planId` key | The two money systems must never share routes, secrets, tables, or code paths | Doc 17 §4.4 shape/mode guards, §7 env matrix, §8.3 static guardrail test |

Connected-account object namespaces add a seventh, provider-side wall: customers/methods/intents on School A's `acct_…` do not exist on School B's or on the platform account (18 §7 item 2, 20 §3.1) — tenant isolation of provider objects holds even if every app-layer check failed.

---

## 2. Threat analysis by Part AB audit area

Format per area: **Threats → Design mitigation (citation) → Residual risk → Part 3 verification.** Verification names the concrete test or constitution rule; "static scan" means the `tests/dispatch-idempotency.test.ts`-style source test the owning doc specifies.

### 2.1 Authorization

- **Threats:** unauthenticated access to money routes; a permitted-but-wrong role approving/charging/refunding; AI pathways mutating financial records; route added without a gate.
- **Mitigation:** every route passes `authorize(permission, {mutating})` or `authorizePlatform()` (`src/lib/session.ts`) — machine-enforced by `tests/constitution.test.ts` with only catalogued PUBLIC/SELF_SERVICE exceptions (SECURITY_STANDARDS §Authorization). Money actions have dedicated keys: `revenue.approve`/`revenue.charge` (22 §8), `revenue.refund` + `revenue.refund_approve` with always-on second approval (26 §3.2.1/§7), `revenue.void` (26 §3.1), `revenue.connect_manage` (19 §7), `revenue.payment_methods_manage` (20 §7), `revenue.reconciliation_manage` (23 §13). Approval carries optimistic-concurrency tokens (`updatedAt` + `expectedTotal`, 22 §3.4 step 1) so authorization is over the numbers the approver actually saw. No AI pathway may approve, charge, refund, or accept consent (constitution rule 8; 20 §7, 22 §8).
- **Residual risk:** permission *breadth* within an org is org-configurable (custom roles); a school that grants `revenue.refund_approve` widely weakens its own separation of duties — a governance risk, not a platform defect. Separation-of-duties on refunds relies on engine identity comparison, which Part 3 must implement exactly.
- **Verification:** constitution authorization scan (new routes enrolled); Part AC denial tests — "Unauthorized refund", "Operations approval", "Responsible payer access"; contract test that requester ≠ approver on refunds (26 §7); running-app denial paths per CLAUDE.md §8.

### 2.2 Tenant isolation

- **Threats:** org A staff reading/mutating org B's reviews, payments, methods; webhook events applied to the wrong tenant; cross-org aggregation leaks via platform surfaces.
- **Mitigation:** three independent walls. (1) App layer: org scope always from the session, never the client (CLAUDE.md do-not-break rule 1); every Part 2 model is org-FK'd with tenant-scoped uniques (34 §4, auto-covered by `tests/schema-governance.test.ts`); cross-tenant ids return 404 indistinguishable from nonexistent (20 §6 V1). (2) Provider layer: all customers/methods/charges live **on the org's connected account** — cross-account reuse fails at Stripe before AeroOps checks anything (20 §3.1; 18 §7 item 2). (3) Webhook layer: tenancy resolved from local references only (`PaymentAttempt.providerPaymentIntentId`, `ConnectedAccount @@unique([provider, providerAccountId])`); `event.account` and server-set metadata are must-match cross-checks; any mismatch quarantines the whole event — never partial application, never "closest org" (23 §4.3 rule 3). Cross-org reads exist only behind `authorizePlatform` with `restrictedOrgIds` scoping (19 §7, 23 §13).
- **Residual risk:** under direct charges the connected-account holder can edit object `metadata` — which is exactly why metadata is never an attribution source (24 §4 rule 4); the design is correct, but Part 3 must not "simplify" resolution to metadata. Quarantined events need humans (see §2.10 residual on alerting).
- **Verification:** Part AC tests "Tenant isolation", "Connected-account mismatch", "Payment-method ownership"; webhook fixture test: event with `account` of org A but intent anchored to org B → `QUARANTINED(TENANT_MISMATCH)`, zero state change; schema-governance scan on all new models.

### 2.3 Payment-method access

- **Threats:** raw card/bank data landing in AeroOps; staff or other payers reading a payer's instrument; charging a method the paying party never consented to charge; method reuse across payers or tenants.
- **Mitigation:** the never-store list is closed and verbatim (20 §3.2): entry happens only on Stripe-hosted surfaces (SAQ-A posture); stored metadata is the closed allowlist (`brand`, `last4`, `expMonth/expYear`, `bankName`, `fingerprint`, + `verifiedAt`/`verificationPath`); setup URLs/client secrets transit once, never persisted or logged; `fingerprint` never renders (20 §3.5). Method eligibility for any charge is engine-checked: org-owned, `ACTIVE`, belongs to the review's resolved paying party's customer, valid unrevoked consent (20 §3.4, §3.6.4 `chargeable()`), enforced at four independent points E1–E4 (readiness, runner pre-claim, attempt-creation invariant in-tx, manual routes). Consent is accepted only by the paying party in their own session — staff initiate, never accept (20 §6 V4). Payers see only their own methods (30 §6).
- **Residual risk:** consent evidence stores IP/UA — personal data with an open retention question (20 §11 Q3); front-desk staff-assisted capture depends on the QR/deep-link flow keeping the payer's device as the entry surface — UI review must hold that line.
- **Verification:** `tests/token-security.test.ts` patterns (no `*token`/`*secret` columns); static scan that the setup route never persists the client secret (20 §3.2); Part AC "Payment-method ownership" + consent-gate tests (chargeable() truth table, revoked-consent block at E2/E3); schema review rejecting any column beyond the allowlist.

### 2.4 Refund permissions

- **Threats:** unilateral or self-approved refunds; over-refunding a payment; refunding into a dispute; silent mutation of the original payment; refund executed twice.
- **Mitigation:** refunds run request (`revenue.refund`) → approve (`revenue.refund_approve`, second approval default **on**, separation of duties engine-enforced) → apply → execute → webhook-settle (26 §3.2.5 Tx R1–R4), each step audited with required reason. The amount cap is computed inside the apply transaction under lock: Σ refunds ≤ captured, disputes excluded/blocking (26 §3.2.3, §3.2.9). The original `Payment` is never edited; every reversal is a new signed record (26 §1). Execution is exactly-once: `Refund.adjustmentId @unique` + key `rf_<refundId>` (24 K2/L8). Voids are permission-gated (`revenue.void`), reason-required, refused once anything is collected or in flight (26 §3.1).
- **Residual risk:** the doc 24 §15 Q3 auto-refund of an orphaned charge (metadata-search false negative) is the one path where AeroOps could refund without an operator adjustment — recommendation "human click" must be confirmed by the owner. `CUSTOMER_CREDIT`/`MANUAL` destinations settle synchronously and depend on the same approval chain; no weaker path exists, keep it that way.
- **Verification:** Part AC "Unauthorized refund", "Refund reversal", "High-value second approval"; contract tests for the remainder formula (over-cap → 422), dispute-block 409, and duplicate-submit 409; audit-presence assertion on every refund transition.

### 2.5 Platform-fee permissions

- **Threats:** org staff editing their own fee terms; fee mislabeled as a Stripe fee; retroactive fee edits; fee leaking to students.
- **Mitigation:** fee agreements are platform-owned data mutated only via `authorizePlatform({mutating:true})` with `platform.fees.manage` (27 §8.1); **no org-scoped mutation route for fee data exists anywhere** — the org surface is one read-only GET of resolved terms (27 §4/§8.2), and doc 27 §8.4 specifies the static test asserting the absence. Fees are versioned, effective-dated, append-only; each `PlatformFee` snapshots its full terms (`termsSnapshot`) so later policy edits cannot touch accrued fees (27 §13, 34 §5.8). Labeling rules forbid conflating the AeroOps fee with processing cost (27 §6.6/BR-9 in 17 §6); payer surfaces never show the fee (26 §3.2.8, 30 §6.2).
- **Residual risk:** `PLATFORM_ADMIN`/`BILLING_ADMIN` holders can change any org's terms — mitigated by full before/after audit (`platform.fee_policy_changed`) and version history in the console; insider misuse detection is an audit-review process, not a technical control.
- **Verification:** static test: no route under `/api/revenue/**` writes `PlatformFeePolicy`/`PlatformFeeTier`/`PlatformFee` terms (27 §8.4); Part AC "Platform fee calculation"; constitution scan on the new platform keys; UI review of labeling per 27 §6.6.

### 2.6 Webhook signature verification

- **Threats:** forged events writing financial truth; misrouted System 1/System 2 events; processing bodies before verification; secret-less endpoints silently accepting junk.
- **Mitigation:** order of operations is fixed and testable: rate limit → raw body → `constructEvent` with the endpoint's own secret → only then any storage or side effect; failure → 400, nothing stored, no content logged (23 §3.3). Three endpoints, three secrets (`stripe-connect`/`stripe-platform`/future `stripe`), so a compromised or misconfigured SaaS secret grants no validity against payment state (23 §3.1; 17 §4.4). Routes are inert (503) when the flag is off or the secret unset (23 §3.2). Both routes are catalogued PUBLIC with written reasons and rate limiting (constitution test).
- **Residual risk:** signature verification is the **only** authentication on B5 — a leaked signing secret lets an attacker fabricate provider truth until rotation; mitigations are env-only storage, per-endpoint blast radius, the local-anchor requirement (a forged event still needs a matching local row and passes only guarded claims), amounts-from-snapshots rule (23 §5), and D2/D3 reconciliation catching drift against real provider state. Rotation runbook (dual-secret window) is named in 23 §15 and must exist in ops docs.
- **Verification:** static scan "no `req.json()`/insert precedes `parseWebhookEvent`" (23 §3.3/§14 rule 1); Part AC "Invalid webhook signature" fixture test (400, nothing stored); constitution PUBLIC_ROUTES entries with `rateLimit(` assertion (17 §8.3 rule 6).

### 2.7 Idempotency

- **Threats:** double-click/double-approve creating two charges; worker crash mid-call charging twice; retry duplicating money; fee or refund duplicated.
- **Mitigation:** three mechanisms, exhaustively catalogued — DB uniques (M1), guarded `updateMany` claims (M2), deterministic provider keys (M3) with the binding ordering M2 → M1 insert carrying the key → commit → ⚡ M3-keyed call → M2 outcome (24 §3). Keys derive from durable committed columns (`sc_<scheduledChargeId>_a<n>`, `rf_<refundId>`, `pc_<org>_<party>`, `ca_<organizationId>`), never timestamps or memory (24 §4). The database, not the provider key, is the durable guarantee (Stripe keys live ~24 h — 24 §4 rule 3). The platform fee rides the charge's key — no separate fee call exists to duplicate (24 L9). Idempotency is **not configurable** by any org or platform setting (24 §8).
- **Residual risk:** the >24 h stale-key window requires the metadata-search branch before re-issue (24 §6 branch c); a metadata-stripped intent could evade the search — bounded by the M1 adoption guard and the Q3 human-click remedy. Provider `Idempotency-Key` semantics are Stripe-specific; a second provider would need its own M3 analysis (24 is explicit that M1/M2 carry the guarantee regardless).
- **Verification:** Part AC "Approval creates one payment request", "Duplicate approval does not duplicate payment", "Idempotency-key reuse", "Failed-payment retry"; contract tests pinning every key format (24 I1); static scan I2 (attempt insert precedes adapter call; no adapter call inside `$transaction`).

### 2.8 Replay handling

- **Threats:** Stripe redelivery or attacker replay applying a settlement twice; out-of-order events rewinding state; the same event racing two app instances.
- **Mitigation:** store-then-process with `PaymentProviderEvent @@unique([provider, providerEventId])`; duplicate with `processedAt` set → 200 no-op; without → safe re-run (23 §4.2). Every reduce is a guarded forward-only claim; stale/out-of-order events are convergent no-ops; unmet preconditions trigger provider re-fetch + fast-forward through the same handlers, never guesses (23 §7). The reduce and its `processedAt` stamp share one transaction, so "reduced but unstamped" cannot exist (24 L6). The 300 s signature timestamp tolerance damps transport-level replay of captured deliveries (23 §3.3). Setup-intent replays are no-ops via the method upsert unique + consent-bind idempotence (20 §6 V9).
- **Residual risk:** none identified beyond §2.6's leaked-secret scenario; replay of a *legitimately signed* event is by construction a no-op.
- **Verification:** Part AC "Webhook replay" fixture (same `evt_…` twice → one applied transition, one no-op); out-of-order fixture (`processing` after `succeeded` → no-op); multi-instance race is covered by the M2 conditional-write property (contract test on the pure reducer + claim shape).

### 2.9 Export security

- **Threats:** a low-privilege member or student pulling org-wide financials; exports leaking secrets/PAN; export jobs mutating financial history; compensation exports exposing peers' pay.
- **Mitigation:** report queries are permission-gated (`reports.export` today; `revenue.exports_run` and `revenue.allocation_view` per 12 §6, 29 §11) and org-scoped from the session like every read. `FinancialExportJob` is org-scoped, manifest-tracked, checksummed, with per-row errors — nothing silent (12 §2.7). Exports are read-only over financial records except the atomic `EXPORTED` stamp on included earnings (12 §2.7); files store via the existing `Document` seam. Nothing exportable contains secrets or card data because none is stored (A9); platform-fee and processing-cost lines export as distinct mapped keys, never conflated (27 §6.6). Students/payers have no export surface — `/billing/my` renders own records only (30 §6). Event payloads (`PaymentProviderEvent.payload`, possible PII) are excluded from org exports and org-snapshot restore, platform-gated, with inspection audited (23 §10/§13).
- **Residual risk:** the export **runner** is Part 3; this assessment covers its contract only. `Document.fileUrl` is a string with no binary storage today; when R2 presigned storage lands (aspirational — SECURITY_STANDARDS §File upload), export files must inherit private-bucket + org-prefix rules — flagged as a Part 3 pre-ship check. Compensation CSV necessarily contains all instructors' pay for holders of the export permission; the control is who holds `revenue.exports_run`, and orgs should grant it accountant-tier only (default mapping per 12 §6).
- **Verification:** constitution scan on export routes; Part AC "Student visibility restrictions"; contract test: export job marks rows `EXPORTED` in the manifest transaction and re-runs exclude them (12 §2.7); Part 3 checklist item: export file storage uses the private storage adapter before any real-org enablement.

### 2.10 Audit logging

- **Threats:** financial mutation without a trail; audit rows edited or lost; system-driven changes unattributable; audit metadata leaking payloads/secrets.
- **Mitigation:** `recordAudit` on every mutation is a do-not-break rule (CLAUDE.md rule 3); `AuditLog` is append-only and survives org-snapshot restore (SECURITY_STANDARDS §Audit). Every Part 2 doc binds its action catalog: approval/charge/hold (22 §8), connect lifecycle (19 §7), consent/method (20 §7), refund/void/dispute (26 §7), fee lifecycle (27 §8.3), webhook/reconciliation with `providerEventId`/`reconciliationRunId` in metadata (23 §13), compensation (29 §11). System actors carry fixed labels (`system:stripe-webhook`, `system:payment-runner`, `system:reconciliation`) so no financial transition is anonymous. Audit metadata carries safe references only — never provider payloads, secrets, or data beyond the display allowlist (22 §8). Impersonated actions are re-attributed to the staff actor via `computeAttribution`, preserving both identities (ADR-023; SECURITY_STANDARDS §Audit).
- **Residual risk:** audit failure never blocks the operation it describes (deliberate availability trade — loudly logged); retention/archival is aspirational (PRODUCTION.md §3.16). Quarantine/dead-letter **alerting** is in-console only until an ops channel exists (23 §18 Q2) — an unwatched audit trail detects nothing by itself.
- **Verification:** contract tests asserting audit rows per transition (Part AC suite); grep-style scan that every new mutating route calls `recordAudit`; fixture test that webhook-driven audits carry `providerEventId`.

### 2.11 Impersonation restrictions

- **Threats:** support staff moving money as a customer; impersonation hiding the true actor; nested or expired sessions retaining power.
- **Mitigation:** impersonation is a signed, expiring (1 h), audited cookie anchored to an `ImpersonationSession` row; read-only by default; read-only blocks **all** mutations at `authorize()` (`src/lib/session.ts` — `opts.mutating && session.impersonation?.readOnly → 403`); platform mutations are refused during **any** impersonation (`authorizePlatform` — `opts.mutating && session.impersonation → 403`); start/stop audited and customer-notified (SECURITY_STANDARDS §Session). Every Part 2 money route is `{mutating:true}`, so approvals, charges, retries, refunds, voids, consent acceptance, fee edits, reconciliation actions, and connect actions are all refused under read-only impersonation (20 §7/§8, 22 §8, 23 §13, 26 §7). Consent can additionally never be accepted by staff at all, impersonating or not (20 §6 V4).
- **Residual risk:** a *writable* impersonation session (readOnly=false) could in principle mutate as the customer with corrected attribution; policy keeps financial impersonation read-only — Part 3 should assert no money route is reachable under writable impersonation without an explicit, owner-approved exception (currently none is designed; treat any as a design change requiring this document's revision).
- **Verification:** Part AC denial tests under impersonation for approve/charge/refund/consent routes; existing `tests/auth-security.test.ts` pins; audit-attribution fixture test (impersonated write → staff actor, customer preserved).

### 2.12 Secret management

- **Threats:** provider keys or signing secrets in the repo, DB, logs, exports, or client responses; Account-Link/setup-secret leakage; key scope creep.
- **Mitigation:** all Stripe material is env-only, validated together at boot (`assertProductionEnv`: partial config fails loudly; `REVENUE_CHARGING=test` requires both Connect key and webhook secrets — 17 §7). No payment model may carry a `*token`/`*secret` column (`tests/token-security.test.ts`; 20 §3.2). Opaque provider ids (`acct_`, `cus_`, `pm_`, `pi_`, `seti_`, `re_`) are references, not credentials, and are the only provider strings stored. Account Links and hosted-setup URLs are single-use, short-lived, `no-store`, never logged/persisted/audited (19 §3.4/§6.6, 20 §3.2). Structured logging has a fixed field set with an explicit never-log list — no bodies, no signature headers, no secrets, no Stripe error message text (23 §10). Restricted keys per system are the production posture so a cross-system bug fails at Stripe with a permission error (17 §8.2). `AUTH_SECRET` fails closed at boot (SECURITY_STANDARDS §Secrets).
- **Residual risk:** Stripe does not expose key scopes, so an over-broad restricted key is not boot-detectable (17 §13 F-7) — mitigated by the provisioning checklist and the §8.3 code scan proving no call site could exploit extra scope. Webhook signing secrets are inherently symmetric — rotation discipline is the control.
- **Verification:** token-security scan extended to all Part 2 models; logger field-discipline review + static scan on webhook routes (no payload logging); boot-rule contract tests on `assertProductionEnv` (17 §7 rules 1–4); grep that `new Stripe(` appears only in the two adapter files (17 §8.3 rule 1).

### 2.13 Provider environment separation

- **Threats:** live keys used in the test phase; live events mutating test-phase state; test/live object ids cross-contaminating; System 1 and System 2 sharing credentials or endpoints.
- **Mitigation:** `REVENUE_CHARGING` has **no `live` value in this phase** — live charging is unrepresentable in configuration (17 §7). Boot rule: `REVENUE_CHARGING=test` with a `sk_live_`/`rk_live_` key fails boot (17 §7 rule 2). Ingress rule: any signature-verified `livemode: true` event is stored, `QUARANTINED(LIVEMODE_IN_TEST_PHASE)`, platform-alerted, never reduced (23 §3.2); each reducer asserts livemode matches the configured key mode (17 §6 BR-7). System separation: distinct env vars, endpoints, event stores, and adapters with shape guards for misrouted deliveries (17 §4.4, §7, §8) and a static guardrail test (17 §8.3). Removing the livemode quarantine is explicitly reserved to the Part 3 launch review with legal/accounting sign-off (23 §17).
- **Residual risk:** environment separation inside Stripe (test vs live object namespaces) is provider-guaranteed; the local risk is operator error at future live-launch time — the boot rules must be *inverted deliberately* by the launch review, never loosened piecemeal. Doc-set inconsistency: docs 19 §4 and 23 §12 still name `STRIPE_SECRET_KEY` for Revenue Engine boot validation while 17/18 finalize `STRIPE_CONNECT_SECRET_KEY` (see Open questions Q2).
- **Verification:** contract tests on the boot rules (live-prefix key + test flag → boot failure); livemode fixture test (event stored, quarantined, no state change); `tests/two-financial-systems.test.ts` (17 §8.3 rules 1–6).

---

## 3. Automatic-rejection checklist (spec Part AB, complete)

Every Part AB rejection condition, the structural prevention, where it is specified, and the verdict. Status **PREVENTED** = the design makes the condition structurally impossible or machine-detected, with a named Part 3 verification. No row is AT-RISK; if any verification below fails in Part 3, the corresponding surface must not ship.

| # | Rejection condition | How the design structurally prevents it | Specified in | Status |
|---|---|---|---|---|
| 1 | Raw card/bank data stored | Entry only on Stripe-hosted surfaces (SAQ-A); closed safe-metadata allowlist; no column beyond it may exist; setup secrets transit once, never persisted; no `*token`/`*secret` columns | 20 §3.2, §6 V7; 13 §4.12; `tests/token-security.test.ts` patterns | PREVENTED |
| 2 | Client redirect marks payment paid | Redirects/return pages render-and-poll only; paid-markers written solely by webhook reducers and the reconciliation fast-forward (same handler code); static test that return routes cannot reference success transitions | 23 §8; 22 §3.6 W4; 20 §3.3 A-9 | PREVENTED |
| 3 | Missing idempotency | Complete key catalog with deterministic derivation from committed columns; M1/M2 constraints ahead of and behind every provider key; ordering rule binding; idempotency non-configurable | 24 §3–§4, §8; 22 §5; 13 §7 | PREVENTED |
| 4 | Missing webhook verification | Signature verification precedes every side effect including storage; per-endpoint secrets; routes inert without a secret; verify-before-everything static scan | 23 §3.3, §14 rule 1; 17 §4.4 | PREVENTED |
| 5 | Platform fee editable by organization staff | No org-scoped fee mutation route exists (asserted by static test); fee writes require `authorizePlatform` + `platform.fees.manage`; org surface is one read-only GET; accrued fees snapshot their terms so even platform edits never touch existing fees | 27 §8.1–§8.4, §13; 22 §4; 17 §11 | PREVENTED |
| 6 | Student can view organization revenue | Student/payer surface is own-records-only with server-side identity resolution from the session; the never-show list (school revenue, compensation, fee terms, other customers, org reports) is an enforceable RBAC statement; org dashboards gated by org permissions students lack | 30 §6; 11 (payer visibility); 27 §6 (fee hidden) | PREVENTED |
| 7 | Instructor can view another instructor's compensation without permission | `revenue.compensation_view_own` is engine-enforced self-scope (session user's instructor profile filter, not UI); cross-instructor reads require `revenue.compensation_view`; A-requests-B → 404 contract test named | 29 §11 (privacy rule); 30 §6.2 | PREVENTED |
| 8 | Cross-tenant payment lookup | Org scope from session on every query; cross-tenant ids → 404; provider objects namespaced per connected account (cannot exist cross-tenant); webhook tenancy from local references with quarantine on mismatch | 20 §3.1, §6 V1; 23 §4.3; 18 §11 rule 2; CLAUDE.md rule 1 | PREVENTED |
| 9 | Silent financial mutation | Snapshots and settled rows immutable; every reversal is a new signed record (Refund, reversal TaxSnapshot, signed allocation sets, reversing journals, negative earnings, signed `reversedAmount`); every mutation audited; guarded claims make transitions explicit; auto-heal never edits snapshots or rewinds machines | 26 §1; 12 §2; 23 §11.4; 27 §13; 29 §5 | PREVENTED |
| 10 | Stripe API call inside long database transaction | Binding ordering: claim+insert tx → commit → ⚡ provider call → outcome tx; every doc's sequences mark the boundary; static scan asserts no adapter call inside `$transaction` | 22 §3.4/§3.6; 24 §3 ordering rule, §10 I2; 23 §14 rule 5; 19 §6 rule 2 | PREVENTED |
| 11 | ACH treated as instant settlement | `payment_intent.processing` maps only to `ACH_PENDING`; `Payment` row and PAID status exist only on webhook-confirmed settlement; no refund possible pre-settlement (no Payment row exists); dashboard counts ACH-pending separately from collected | 23 §14 rule 7; 22 §3.6 W4; 26 §3.2.9; 30 §4 | PREVENTED |
| 12 | Refund without audit | Refund requires a reasoned `RevenueAdjustment`, dual approval, and audits at request/approve/apply/settle/fail; involuntary (dispute/return) reversals audit via the dispute lifecycle actions; no code path creates a `Refund` without its adjustment (`adjustmentId @unique`) except the webhook-written `PROVIDER_RETURN`, which audits with `system:stripe-webhook` | 26 §3.2.1, §3.2.5, §7; 34 §5.4; 23 §13 | PREVENTED |
| 13 | Payment retry can duplicate charge | Retry requires the prior attempt terminal; in-flight attempts structurally block new ones (stuck-attempt rule); retry = new attempt row + new key; auto/manual overlap collapses to one M2 claim winner; unknown outcomes reconcile before any re-send | 24 L4/L10, §6; 22 §3.7; 25 §3 (retry table) | PREVENTED |

---

## 4. Abuse cases, end to end

Each case: attacker action → where it dies → what the record shows. All are Part AC test candidates; the walk is over designed behavior, cited.

### 4.1 Double-charge race

Dispatcher double-clicks "Approve … and charge"; simultaneously a platform sweep runs. **Walk:** both approval requests hit the guarded claim + `updatedAt`/`expectedTotal` token — one wins, one 409s with "already approved — refresh" (22 §3.4 step 1). The winner's tx creates the single `ScheduledCharge` (`revenueReviewId` partial unique, 34 R-P9). Post-commit, Trigger 1 and the sweep both call the runner; the `SCHEDULED → PROCESSING` claim admits exactly one (24 L3). The attempt row carries `sc_<id>_a1`; even if the process crashes mid-call and retries, Stripe dedupes on the key (24 L4). A duplicated webhook settles once (`Payment.paymentAttemptId @unique`, attempt claim). **Record:** one attempt, one Payment, one fee EARNED; the loser's 409 and the skipped sweep row in per-row outcomes. Money moved once at every layer an engineer could break.

### 4.2 Forged webhook

Attacker POSTs a fabricated `payment_intent.succeeded` for a real review to `/api/webhooks/stripe-connect`. **Walk:** rate limit → raw body → signature verification with `STRIPE_CONNECT_WEBHOOK_SECRET` fails → 400, nothing stored, nothing logged beyond `webhook.signature_failed` (23 §3.3). If the attacker somehow held a valid signature (leaked secret), the event still needs a local anchor: an intent id matching `PaymentAttempt @@unique([provider, providerPaymentIntentId])` in `PROCESSING`, a matching `event.account` → org, matching metadata — and amounts are taken from the local snapshot, never the event (23 §5). Fabricating settlement for an attempt that Stripe never settled is then exposed by D2 reconciliation re-fetch (local ahead of provider → `STATE_MISMATCH`, flag-for-human, never rewound silently — 23 §11.2/§11.4). **Record:** 400s in logs; or a quarantine/exception row. Defense in depth means the leaked-secret case is detected, not silent.

### 4.3 Replayed webhook

Attacker (or Stripe retry) redelivers a captured, legitimately signed `payment_intent.succeeded`. **Walk:** signature verifies (it is real); the 300 s timestamp tolerance rejects stale captures at the transport layer (23 §3.3). Within tolerance: unique insert hits `[provider, providerEventId]`; `processedAt` set → 200 no-op, duplicate counter incremented (23 §4.2 step 2). Even a hypothetical second reduce is a `count === 0` no-op on the attempt claim (24 L6). **Record:** duplicate counters in the reconciliation run summary; zero state change.

### 4.4 Cross-tenant payer method reuse

Staff at School B (or a payer) submits School A's `paymentMethodReferenceId` on a review, or a raw `pm_…` id. **Walk:** raw provider ids are never accepted as instructions (18 §11 rule 2); local ids are looked up org-scoped from the session — School A's row is invisible to School B's query → 404, indistinguishable from nonexistent (20 §6 V1). If any engine bug slipped a foreign reference through to `createCharge`, the call executes on School B's `Stripe-Account`, where School A's `pm_` does not exist → provider error, attempt FAILED with a safe code, no money (20 §3.1). The same payer at two schools has two independent customers/methods by construction (18 §13 F-8). **Record:** 404 audit-free (a read), or a failed attempt with `failureCode`; nothing charged.

### 4.5 Org staff editing the platform fee

An org Account Owner crafts `POST /api/platform/fee-agreements` or hunts for an org-side fee route. **Walk:** `authorizePlatform()` resolves the session — an org session has no `platformRole` → 403 before any body parsing (`src/lib/session.ts`); there is no org-scoped fee mutation route to find (27 §8.2, asserted by the §8.4 static test); the org's only fee surface is the read-only resolved-terms GET. Even a platform BILLING_ADMIN edit creates a *new version* — accrued fees keep their `termsSnapshot` (27 §13). **Record:** 403; any real change is a `platform.fee_policy_changed` audit with full before/after terms.

### 4.6 Student scraping org revenue

A student session iterates dashboard/report/export APIs. **Walk:** `/billing` and `/billing/queue` require org staff permissions the student role lacks (30 §11); report and export routes gate on `reports.export`/`revenue.allocation_view`/`revenue.exports_run` (12 §6); `/billing/my` resolves identity server-side (`session.userId → Student`) and returns own reviews, invoices, payments, receipts, methods, Amount Due — nothing org-wide, no fee terms, no compensation, no other customers (30 §6). URL parameter tampering does nothing: no client parameter selects the subject. **Record:** 403s on org surfaces; own-data 200s; module gating applies throughout.

### 4.7 Instructor reading peers' compensation

Instructor A (holding `revenue.compensation_view_own`) requests instructor B's earnings by id or list filter. **Walk:** the self-scope key filters every authorized query to the session user's instructor profile **in the engine**; B's row ids → 404; list routes never return other instructors' rows under `_view_own` (29 §11). Cross-instructor visibility requires `revenue.compensation_view` (owner/admin/accountant tier). A also cannot approve or claw back their own earnings even with approve rights (engine identity comparison, 29 §11). Students/payers see no compensation surface at all (30 §6.2). **Record:** 404; the named contract test pins this exact scenario.

### 4.8 Impersonating staff issuing refunds

Support engineer impersonates a school admin (read-only, the default) and attempts refund request/approval, or any charge action. **Walk:** every refund route is `{mutating:true}`; `authorize()` sees `impersonation.readOnly` → 403 at the gate, before zod, before the engine (`src/lib/session.ts`; 26 §7). Platform-side mutations (fee edits, suspensions, sweeps) are refused during *any* impersonation via `authorizePlatform` (SECURITY_STANDARDS §Authorization). If a writable impersonation were ever granted (not designed in Part 2), `computeAttribution` re-attributes the audit row to the staff actor with the customer preserved — the action cannot masquerade as the customer's (ADR-023). **Record:** 403; impersonation start/stop audited and customer-notified regardless.

### 4.9 Secret leakage via logs

A bug or curious operator tries to get the webhook secret, an Account Link, or a setup client secret into logs, audit rows, or the DB. **Walk:** the logger's webhook field set is fixed and payload-free; signature headers and bodies are on the never-log list (23 §10). Account Links/setup URLs are returned once, `no-store`, with no persistence path — no column exists to hold them, and `tests/token-security.test.ts` patterns reject any `*secret`/`*token` column in payment models (19 §6.6, 20 §3.2). Audit metadata is restricted to safe references (22 §8). Env secrets never enter application data by construction; `PaymentProviderEvent.payload` (the one stored provider blob) contains no secrets by provider design and is platform-gated with audited inspection (23 §13). **Record:** nothing to find; payload views are themselves audit events.

### 4.10 Test/live key cross-contamination

An operator pastes a live key into the test-phase deployment, or a live-mode event arrives. **Walk:** boot fails on `REVENUE_CHARGING=test` + `sk_live_`/`rk_live_` prefix (17 §7 rule 2) — the app never serves. A live event reaching a running test deployment is signature-checked, stored, `QUARANTINED(LIVEMODE_IN_TEST_PHASE)`, platform-alerted, and never reduced (23 §3.2). System 1 keys can never validate System 2 deliveries (per-endpoint secrets; shape guards for the misconfigured case — 17 §4.4). There is no `REVENUE_CHARGING=live` to typo into existence. **Record:** a boot error, or a quarantine row + alert; zero financial writes.

---

## 5. STRIDE-lite summary

| STRIDE class | Representative threats in this system | Primary controls | Residual (accepted / tracked) |
|---|---|---|---|
| **S**poofing | Forged webhooks (4.2); payer impersonating another payer; org session posing as platform | Per-endpoint signature verification before side effects; `getSession()`-only identity; separate `PlatformUser` identity table; `authorizePayer()`/session-scoped subject resolution | Leaked signing secret window until rotation — detected by local-anchor + D2 reconciliation (§2.6) |
| **T**ampering | Editing settled payments/snapshots; client-supplied amounts; metadata-based tenancy steering; fee self-editing | Append-only financial records with signed reversals; server-resolved Decimal amounts; local-references-only tenancy with quarantine; platform-only fee writes with `termsSnapshot` | None accepted; auto-heal is forward-only by rule (23 §11.4) |
| **R**epudiation | "I never approved/charged/refunded that"; anonymous system writes; staff hiding behind impersonation | `recordAudit` on every mutation with actor labels incl. `system:*`; consent evidence rows (version, hash, IP/UA); impersonation re-attribution; provider ids in audit metadata | Audit failure doesn't block operations (availability trade, loudly logged); retention policy aspirational |
| **I**nformation disclosure | Cross-tenant reads; students scraping revenue; instructors reading peers' pay; PII in event payloads/logs; export exfiltration | Session-scoped queries + 404 semantics; own-records-only payer surface with never-show list; self-scope compensation key; payload allowlists (19 §3.5) + platform-gated audited inspection; permission-gated exports | Payload retention open (23 Q1); consent IP/UA retention open (20 Q3); export file storage is a Part 3 pre-ship check (§2.9) |
| **D**enial of service | Webhook floods; event-processing poison pills; endpoint disablement by sustained failure; runner starvation | Rate limiting (damping); store-then-process with time-budgeted inline reduce + bounded sweeps; 200-once-stored response contract; bounded passes with per-row outcomes; dead-letter isolation per event type | In-memory rate limiter is per-instance (compute protection only — correctness is M1/M2); no scheduler until D14, so quiet-org reconciliation depends on manual/platform sweeps (23 §11.3, honest limitation) |
| **E**levation of privilege | Org staff → platform capabilities; read-only impersonation → mutations; AI pathways moving money; `revenue.*` keys granting System 1 powers | `authorizePlatform` + `platformRolesWith()` derivation; mutation refusal at the gate; constitution rule 8 (no AI financial mutation); two-systems permission separation (17 §11) | Org-internal permission breadth is org-governed (§2.1 residual) |

---

## 6. Verification map for Part 3 (consolidated)

The single list an implementer/QA works through; each item traces to §2's per-area verification and the Part AC test plan (doc 33).

| # | Verification | Kind | Covers |
|---|---|---|---|
| V1 | Constitution scan: every new route authorizes; webhook routes catalogued PUBLIC with reasons + `rateLimit(` | static (exists, extended) | §2.1, §2.6 |
| V2 | `tests/two-financial-systems.test.ts` rules 1–6 | static (new, 17 §8.3) | §2.13, B6 |
| V3 | Token/secret column scan over all Part 2 models; setup-route no-persist scan; logger field discipline | static | §2.3, §2.12, case 4.9 |
| V4 | Verify-before-store scan; no-provider-call-inside-`$transaction` scan; attempt-insert-precedes-call scan | static (23 §14, 24 I2) | §2.6, §2.7, rejection rows 4/10 |
| V5 | Idempotency contract tests: key formats pinned; duplicate approval; key reuse; retry-new-key; TTL branch with fixed clock | contract (24 I1–I9) | §2.7, rejection rows 3/13, case 4.1 |
| V6 | Webhook fixture tests: invalid signature; replay; out-of-order; connected-account mismatch → quarantine; livemode → quarantine | contract (fixtures, no DB/live creds) | §2.2, §2.6, §2.8, §2.13, cases 4.2/4.3/4.10 |
| V7 | Ownership/visibility denial tests: cross-tenant 404s; payment-method ownership; student restrictions; instructor `_view_own` 404; responsible-payer access | contract + running-app denial paths (CLAUDE.md §8) | §2.2, §2.3, rejection rows 6/7/8, cases 4.4/4.6/4.7 |
| V8 | Refund suite: unauthorized refund; second approval; requester ≠ approver; over-cap 422; dispute block; duplicate submit 409; audit row per transition | contract | §2.4, rejection row 12, case 4.8 |
| V9 | Fee suite: no-org-write static test (27 §8.4); fee calculation; `termsSnapshot` immunity to policy edits; disclosure labeling review | static + contract + UI review | §2.5, rejection row 5, case 4.5 |
| V10 | Boot rules: partial config fails; live-prefix key + `test` flag fails; secrets-unset routes inert | contract on `assertProductionEnv` + route tests | §2.12, §2.13 |
| V11 | ACH truth tests: `processing` never maps to paid; refund impossible pre-settlement; dashboard buckets ACH-pending separately | contract | rejection row 11 |
| V12 | Impersonation denial suite across all money routes; audit re-attribution fixture | contract | §2.11, case 4.8 |
| V13 | Export contract: permission gating; manifest-atomic `EXPORTED`; re-run exclusion; **pre-ship check** that export files use private storage | contract + Part 3 checklist item | §2.9 |

---

## 7. Relationship to Part 1 docs

| Doc | Relationship |
|---|---|
| [01-revenue-engine-architecture.md](./01-revenue-engine-architecture.md) §11 | Extends its threat-model rows (webhook forgery/replay) into the full Part AB audit; consumes the engine map and adapter seam. |
| [13-database-model.md](./13-database-model.md) | Canonical for every model/constraint this assessment leans on (§7 idempotency inventory, §4.10/§4.12 shapes, FK policy). Nothing reinterpreted. |
| [03](./03-revenue-review-lifecycle.md) / [09](./09-payment-timing-and-collection.md) / [11](./11-responsible-payers.md) / [12](./12-revenue-allocation-and-reporting.md) | Binding inputs: approval transaction and consequence-truthful controls; webhook pipeline + runner; payer identity/visibility; allocation/ledger/export contracts. |
| Part 2 siblings 17–31, 34 | This document audits them; every mitigation cites its owner. Where two siblings disagree, [34-part2-database-additions.md](./34-part2-database-additions.md) §2 arbitrates shapes; unresolved non-schema conflicts are recorded below, not adjudicated here. |
| [SECURITY_STANDARDS.md](../SECURITY_STANDARDS.md) | The platform baseline (auth, sessions, secrets, OWASP, audit) this assessment builds on; its "aspirational" markers are honored — nothing aspirational is claimed as a current control. |

---

## 8. Out of scope for this assessment

- **Implementation verification** — by definition; Part 3 runs §6's map. This document must be revisited if Part 3 deviates from any cited design.
- **Live-launch review** — legal/accounting review, D2 fee terms, livemode-quarantine removal, key provisioning with restricted scopes: all Part 3+ launch-review territory (18 §7; 23 §17).
- **Platform-account compromise at Stripe** (Stripe-side controls, owner MFA on the Stripe dashboard) — an ops-runbook item, not an application design item; noted for the launch checklist.
- **Multi-instance hardening** (shared rate limiter, sweep coordination) — correctness is already DB-guaranteed; efficiency work deferred (23 §17).
- **DDoS beyond rate-damping** — hosting/CDN layer concern.

---

## 9. Open questions

| # | Question | Recommendation | Who decides |
|---|---|---|---|
| Q1 | **Recorded sibling conflict (evidence submission):** doc 18 (§7 item 6, §10 C3) states Express has no dispute UI and AeroOps submits evidence **via API**; doc 26 §3.3.3 ships deadline/attachment tracking with actual submission happening "in the Stripe dashboard". Under Express the org has no such dashboard surface, so Part 2's minimal path is effectively platform-staff-assisted. Which is the Part 2 posture? | Adopt doc 26's minimal build but correct its submission sentence: interim submission is a **platform-staff runbook action** in the provider dashboard (audited via `evidenceSubmittedAt`), with the doc 18 API path as the Part 3 target. Consistency/refresh agent aligns doc 26; no security property changes either way — the threat surface (org staff can never submit unaudited) is identical. | Design-set owner + doc 18/26 owners |
| Q2 | **Env-name consistency:** docs 19 §4 and 23 §3.2/§12 validate `STRIPE_SECRET_KEY` for Revenue Engine boot, while 17 §7 / 18 §9.1 finalize `STRIPE_CONNECT_SECRET_KEY` (with `STRIPE_SECRET_KEY` reserved for System 1). Key separation is a Part AB property (§2.13); the boot rules must name the Connect key. | Align 19/23 to `STRIPE_CONNECT_SECRET_KEY` via the designated refresh agent (extends 17 §16 Q3). | Refresh agent |
| Q3 | **Quarantine/dead-letter attention SLA** (inherits 23 §18 Q2): quarantined tenancy mismatches and livemode events are security signals visible only in-console until an alert channel exists. Acceptable for a test-mode pilot? | Acceptable for test mode; a minimal ops alert hook (email/webhook) becomes a **live-launch blocker** — add to the Part 3 launch checklist. | Product owner / ops |
| Q4 | **Writable impersonation and money routes** (§2.11 residual): confirm as policy that impersonation sessions touching any Revenue Engine mutation remain read-only-only, so the denial suite (V12) can assert it unconditionally. | Confirm; any future exception requires revising this assessment. | Product owner |
| Q5 | **PII retention pair** (inherits 20 §11 Q3 + 23 §18 Q1): consent IP/UA and `PaymentProviderEvent.payload` retention windows. Not a launch blocker for test mode; privacy posture item before live. | 18-month payload-body prune with envelope kept (23's recommendation); consent evidence retained with the financial records it evidences; legal review before live. | Product owner + counsel |

---

## Related documents

[17-two-financial-systems.md](./17-two-financial-systems.md) · [18-stripe-connect-decision.md](./18-stripe-connect-decision.md) · [19-connected-account-onboarding.md](./19-connected-account-onboarding.md) · [20-payment-methods-and-consent.md](./20-payment-methods-and-consent.md) · [21-card-and-ach-workflows.md](./21-card-and-ach-workflows.md) · [22-approval-to-payment.md](./22-approval-to-payment.md) · [23-webhooks-and-reconciliation.md](./23-webhooks-and-reconciliation.md) · [24-idempotency.md](./24-idempotency.md) · [25-payment-failure-workflow.md](./25-payment-failure-workflow.md) · [26-refunds-voids-disputes.md](./26-refunds-voids-disputes.md) · [27-platform-fee.md](./27-platform-fee.md) · [29-instructor-compensation.md](./29-instructor-compensation.md) · [30-revenue-dashboard.md](./30-revenue-dashboard.md) · [34-part2-database-additions.md](./34-part2-database-additions.md) · [13-database-model.md](./13-database-model.md) · [../SECURITY_STANDARDS.md](../SECURITY_STANDARDS.md)
