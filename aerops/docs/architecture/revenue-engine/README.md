# AeroOps Revenue Engine — Design Set Index

> **Status:** Proposed — Phase 8 Parts 1–2 · **Date:** 2026-07-10 · **Lead roles:** Head of Product; Documentation Engineer · **Part of:** Revenue Engine design set ([README](./README.md))

## What the Revenue Engine is

The **Revenue Engine** is the aviation-native financial operating system of AeroOps: it connects aircraft dispatch, aircraft return, Hobbs and Tach time, instructor time, organization-defined charges, invoice review, payment collection, instructor compensation, revenue allocation, reporting, and accounting exports. It is not a basic billing module — it is the financial workflow that begins the moment an aircraft is dispatched and ends only when the flight is operationally closed, the Revenue Review is approved, the customer is charged, the school receives its proceeds, AeroOps earns its platform fee, Instructor Compensation is recorded, and reports and Financial Exports are updated. "Revenue Engine" is the customer-facing module name; backend records keep standard accounting and provider terms (Invoice, InvoiceLine, PaymentIntent, PaymentTransaction, Refund, TaxSnapshot, LedgerEntry, Dispute) — existing database concepts are never renamed for marketing reasons. This design set now spans **Parts 1–2 of 3 — design only**: no schema, code, migration, deploy, Stripe object, live charge, or production email ships with it. Part 1 (docs 00–16) designed the workflow from dispatch to money; Part 2 (docs 17–35) designs the payments layer — Stripe Connect, saved Payment Methods, card and ACH execution, failures, refunds and disputes, the platform fee, allocation and compensation mechanics, and the Revenue Dashboard. Stripe **test mode** is the only sanctioned environment, and even it is not exercised in the design phase.

## The defining workflow: dispatch to payment

1. Aircraft dispatched — Hobbs and Tach Out recorded
2. Flight or lesson occurs
3. Aircraft returned — Hobbs and Tach In recorded
4. Operational records updated (operational closeout — immediate, never blocked by billing)
5. Revenue Review generated (the customer-facing face of a backend Invoice draft)
6. Instructor and Operations review the charges
7. Revenue Review approved — Invoice locked as an immutable snapshot
8. Saved card or ACH Payment Method charged (a Payment Attempt)
9. Payment reconciled
10. Revenue allocated — school proceeds and AeroOps platform fee recorded as Revenue Allocation rows
11. Instructor Compensation recorded
12. Receipt, Revenue Reports, and Financial Exports updated

Docs 02 (steps 1–4), 03 (steps 5–7), 09 (steps 8–9), and 12 (steps 10–12) own the workflow end to end; 13 binds every data shape underneath it.

## Reading order

Read in numeric order. Doc 13 is **canonical and binding** for the data model: where any design doc and 13 disagree on a name, type, constraint, or FK action, 13 wins.

### Part 1 — dispatch to money (docs 00–16)

| Doc | What it covers | Lead roles |
|---|---|---|
| [00-current-billing-audit.md](./00-current-billing-audit.md) | How billing works in AeroOps **today**: audit of the existing Prisma schema, `billing.ts`, and the dispatch-close write path; reuse-vs-new verdicts every other doc builds on | Database Architect; Financial Systems Architect |
| [01-revenue-engine-architecture.md](./01-revenue-engine-architecture.md) | Revenue Engine module architecture: engine placement in `src/lib`, the Revenue Rule Part 1 position (§7.1 — vocabulary and `RevenueLineOrigin.RULE` reserved; no rule-config model in Part 1; Part 2 model is go/no-go decision D43), `revenue.*` permission-module gating, `PaymentCustomer`/Stripe Connect topology, and the operational-vs-financial closeout boundary | Principal Software Architect at Stripe; Head of Software Engineering at Meta; Security Engineer at Cloudflare; Reliability/SRE Engineer |
| [02-operational-dispatch-and-closeout.md](./02-operational-dispatch-and-closeout.md) | Aircraft dispatch and return: every field captured at each moment, the validation matrix, duplicate prevention, and the strict split between operational closeout (immediate) and financial closeout (post-approval) | Dispatcher; Director of Operations; Maintenance Manager; Principal Software Architect at Stripe |
| [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) | The Revenue Review lifecycle: screen anatomy, the full status machine with backend enum mapping, approval sequence and org-configurable approval policies, snapshot semantics, void/reopen rules | Head of Product; Chief Flight Instructor; Financial UX Designer; SaaS Revenue Operations Architect |
| [04-instructor-time-and-rates.md](./04-instructor-time-and-rates.md) | Instructor time capture and Instructor Rate Profiles: customer billing rates and instructor compensation rates as separate concerns, plus contractor support | Chief Flight Instructor; Independent Flight Instructor; Aviation Accounting Specialist; Financial Systems Architect |
| [05-aircraft-pricing-profiles.md](./05-aircraft-pricing-profiles.md) | Aircraft Pricing Profiles: how an organization defines, approves, schedules, and versions aircraft rental pricing, and the deterministic L1–L6 rate-resolution order | Flight School Owner; Financial Systems Architect; Database Architect |
| [06-revenue-items.md](./06-revenue-items.md) | The Revenue Item catalog: built-in seed set, how catalog items become Revenue Review line items, manual-item controls, damage-fee handling, the relationship to `LineItemKind`, and the accounting-category seam for exports | Director of Operations; Head of Product; Aviation Accounting Specialist |
| [07-tax-model.md](./07-tax-model.md) | The tax model: tax rules and resolution, service-date semantics, `TaxSnapshot`, and tax warnings in the review UI | Aviation Accounting Specialist; Principal Payments Architect at Stripe |
| [08-adjustments-discounts-credits.md](./08-adjustments-discounts-credits.md) | Discounts, credits, and manual adjustments — before approval, after approval, and after payment — plus Refund handling and reversal rows, without ever editing an approved snapshot | Financial Systems Architect; Aviation Accounting Specialist; Director of Operations |
| [09-payment-timing-and-collection.md](./09-payment-timing-and-collection.md) | When and how an approved Revenue Review turns into money: org-configurable payment timing policies, saved Payment Methods (`PaymentCustomer`/`PaymentMethodReference`), the `PaymentAttempt` lifecycle including ACH windows, end-to-end idempotency, failure handling | Principal Payments Architect at Stripe; Reliability/SRE Engineer; SaaS Revenue Operations Architect |
| [10-checkout-restrictions.md](./10-checkout-restrictions.md) | The definitive checkout-restriction matrix: how organizations configure and enforce dispatch gates, safety/operational blocking vs financial blocking | Director of Operations; Chief Flight Instructor; Flight School Owner; Security Engineer at Cloudflare |
| [11-responsible-payers.md](./11-responsible-payers.md) | Who pays when the person flying is not the person paying: payer entities, student–payer relationships, charge routing, minors and consent, and the privacy boundary between financial visibility and training records | Head of Product; Financial UX Designer; Principal Payments Architect at Stripe |
| [12-revenue-allocation-and-reporting.md](./12-revenue-allocation-and-reporting.md) | Revenue Allocation, instructor earnings, the AeroOps platform fee, reconciliation, Revenue Reports, and Financial Exports | SaaS Revenue Operations Architect; Aviation Accounting Specialist; Financial Systems Architect |
| [13-database-model.md](./13-database-model.md) | **Canonical and binding** database model: every model, field, type, constraint, and FK action, with the override list that aligns docs 00–12; Parts 2–3 implement this schema exactly as written | Database Architect; Principal Software Architect at Stripe; Financial Systems Architect |
| [14-migration-plan.md](./14-migration-plan.md) | Additive-only migration sequencing and backfills for implementing the doc-13 schema across Parts 2–3 | Database Architect; Reliability/SRE Engineer |
| [15-adr-proposals.md](./15-adr-proposals.md) | Proposed ADRs for the decided patterns (including the snapshot carve-out from the computed-values rule, supersession of ADR-011's invoice-inside-closeout shape, and the L1–L6 rate-resolution order); merged into DECISIONS.md on approval | Principal Software Architect at Stripe; Financial Systems Architect; Database Architect |
| [16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md) | Consolidated risks, unresolved decisions that need a product/owner call before Part 2, and the Part 1 compliance confirmations (deliverables 17 and 18) | Head of Product; Reliability/SRE Engineer; Aviation Accounting Specialist; Flight School Owner |

### Part 2 — payments (docs 17–35)

Part 1 stays binding: Part 2 docs extend 00–16 by reference and never reinterpret them. [13-database-model.md](./13-database-model.md) remains canonical for every Part 1 model/enum/status name; [34-part2-database-additions.md](./34-part2-database-additions.md) is **canonical and binding for every NEW Part 2 shape** — where a Part 2 design doc and 34 disagree, 34 wins.

| Doc | What it covers | Lead roles |
|---|---|---|
| [17-two-financial-systems.md](./17-two-financial-systems.md) | Spec Part N: the hard separation between AeroOps' two money systems — SaaS billing (Stripe Billing, org subscriptions) vs Revenue Engine school payments (Stripe Connect) — with the platform fee as the one deliberate bridge | SaaS Revenue Operations Architect; Principal Software Architect at Stripe; Financial Systems Architect |
| [18-stripe-connect-decision.md](./18-stripe-connect-decision.md) | Spec Part O: the formal Connect evaluation and **the decision** — direct charges on per-org **Express** connected accounts, platform fee collected atomically via `application_fee_amount`; ADR-037; funds-flow diagrams (card, ACH, refunds, dispute, platform fee); resolves Part 1 open decision D1 | Principal Payments Architect at Stripe; Financial Systems Architect; Flight School Owner; Head of Product |
| [19-connected-account-onboarding.md](./19-connected-account-onboarding.md) | Spec Part P: the `ConnectedAccount` model, seven-status onboarding lifecycle, Stripe-hosted KYC, the hard gate that blocks charge initiation until the account is ready, suspension/deauthorization, and the Platform Console status view | Principal Payments Architect at Stripe; Head of Product; Security Engineer at Cloudflare |
| [20-payment-methods-and-consent.md](./20-payment-methods-and-consent.md) | Spec Part Q: `PaymentCustomer`/`PaymentMethodReference` semantics, saved cards and ACH, default methods, the safe-metadata allowlist (never raw card/bank data), and off-session charging consent records with revocation | Principal Payments Architect at Stripe; Financial UX Designer; Security Engineer at Cloudflare |
| [21-card-and-ach-workflows.md](./21-card-and-ach-workflows.md) | Spec Part R: rail-level card workflow (off-session 3-D Secure requires-action, decline catalog) and ACH Direct Debit workflow (verification gates, the pending window, R-code returns, late-return reversal); paid means webhook-confirmed, nothing else | Principal Payments Architect at Stripe; Reliability/SRE Engineer; Financial UX Designer |
| [22-approval-to-payment.md](./22-approval-to-payment.md) | Spec Part S: the approval readiness checklist, the approval transaction (one `db.$transaction`, no provider calls inside), the payment-request outbox, and the payment worker that executes charges with per-hop idempotency | Principal Software Architect at Stripe; Financial Systems Architect; Reliability/SRE Engineer |
| [23-webhooks-and-reconciliation.md](./23-webhooks-and-reconciliation.md) | Spec Part T: the inbound Stripe webhook pipeline (signature → `PaymentProviderEvent` unique insert → guarded reduce; tenancy from local references, never the payload), the event-handling matrix, and the reconciliation job that converges AeroOps and Stripe when events are late, lost, duplicated, or out of order | Principal Payments Architect at Stripe; Security Engineer at Cloudflare; Reliability/SRE Engineer |
| [24-idempotency.md](./24-idempotency.md) | Spec Part S (idempotency): the complete idempotency-key catalog and the exactly-once proof for every hop from approval to settled books, including the unknown-outcome (crashed-mid-call) protocol | Principal Software Architect at Stripe; Database Architect; Reliability/SRE Engineer |
| [25-payment-failure-workflow.md](./25-payment-failure-workflow.md) | Spec Part U: the failure sequence, safe customer-facing failure vocabulary, notification and escalation, authorized retry with duplicate prevention, org-configurable consequence policies (wired into the doc-10 restriction matrix), and late ACH returns | Head of Product; Reliability/SRE Engineer; Director of Operations; Financial UX Designer |
| [26-refunds-voids-disputes.md](./26-refunds-voids-disputes.md) | Spec Part V: void rules before payment initiation, full/partial Refunds with reversal writes (allocations, tax, platform fee, compensation impact), and Dispute tracking with a right-sized evidence workflow | Financial Systems Architect; Principal Payments Architect at Stripe; Aviation Accounting Specialist |
| [27-platform-fee.md](./27-platform-fee.md) | Spec Part W: per-org Platform Fee Agreements (percentage / fixed / combined / per-rail / volume-tier / introductory / negotiated / waiver), versioned and effective-dated, snapshotted per payment, platform-role-only control, honest disclosure, reconciliation | SaaS Revenue Operations Architect; Financial Systems Architect; Head of Product |
| [28-revenue-allocation-ledger.md](./28-revenue-allocation-ledger.md) | Spec Part X: Part 2 allocation and ledger mechanics — collection/settlement legs, processing-expense visibility, refund/dispute reversal sets, the category catalog, balanced and immutable throughout | Aviation Accounting Specialist; Financial Systems Architect; SaaS Revenue Operations Architect |
| [29-instructor-compensation.md](./29-instructor-compensation.md) | Spec Part Y: compensation recognition policies (lesson completion / approval / payment / ACH-settled / manual), holds and clawbacks, the full `InstructorEarning` status machine, contractor-vs-employee reporting | Chief Flight Instructor; Aviation Accounting Specialist; Financial Systems Architect; Independent Flight Instructor |
| [30-revenue-dashboard.md](./30-revenue-dashboard.md) | Spec Part Z: the three strictly separated Revenue Dashboard surfaces — executive dashboard, operations revenue queue, student/payer view — every figure mapped to snapshotted records, nothing paid-marked client-side | Financial UX Designer; Head of Product; Head of Human Interface Design at Apple; Aviation UX Lead at Boeing Digital Aviation |
| [31-notifications.md](./31-notifications.md) | Spec Part AA: the notification matrix (event → recipients → channels), digest and anti-spam rules, money-visibility boundaries, and honest dev-preview behavior when production email is off | Head of Product; Financial UX Designer; Reliability/SRE Engineer |
| [32-financial-security-threat-assessment.md](./32-financial-security-threat-assessment.md) | Spec Part AB: the financial security threat assessment — authorization, tenancy, payment-method access, webhook verification, idempotency, replay, secrets, and the automatic-rejection conditions; owner approval of this doc together with 18 gates Part 3 | Security Engineer at Cloudflare; Principal Payments Architect at Stripe; Reliability/SRE Engineer |
| [33-payment-test-plan.md](./33-payment-test-plan.md) | Spec Part AC: the payment test plan — approval/idempotency/webhook-replay/tenancy/visibility suites, Stripe test fixtures and mocks, no live credentials required by unit tests | QA/Test Engineer; Principal Payments Architect at Stripe; Reliability/SRE Engineer |
| [34-part2-database-additions.md](./34-part2-database-additions.md) | **Canonical and binding for every NEW Part 2 model, enum, column, constraint, and index** (e.g. `ConnectedAccount`, `PaymentConsent`, extensions to `PaymentProviderEvent`); where docs 17–31 and 34 disagree, 34 wins; 13 stays canonical for everything Part 1 bound | Database Architect; Principal Software Architect at Stripe; Financial Systems Architect |
| [35-part2-open-decisions-and-confirmations.md](./35-part2-open-decisions-and-confirmations.md) | Part 2 risks, open decisions needing a product/owner call before Part 3, and the Part 2 compliance confirmations (deliverables 19 and 20) | Head of Product; Flight School Owner; Reliability/SRE Engineer |

### Part 3 (UI, permissions, reporting, implementation plan)

| Document | Covers | Lead roles |
|---|---|---|
| [36-permissions-and-visibility.md](./36-permissions-and-visibility.md) | The definitive Revenue Engine RBAC + visibility matrix — every capability × role, new `SECTION_PERMISSIONS` keys, student/payer own-data-only rules, instructor own-compensation-only, platform-staff-only controls, server-side separation-of-duties, and the audit/constitution additions | Security Engineer at Cloudflare; Head of Product; Database Architect |
| [37-ui-workflows.md](./37-ui-workflows.md) | Screen-by-screen UI spec — check-in Hobbs/Tach capture, the Revenue Review screen and approval control, the operations queue, ramp-friendly instructor time entry, settings editors, payer/method/consent, failure/refund flows, Connect onboarding, and student/payer views (design-system components, states, light/dark, responsive) | Financial UX Designer; Head of Human Interface Design at Apple; Aviation UX Lead at Boeing Digital Aviation; Dispatcher |
| [38-reports-and-exports.md](./38-reports-and-exports.md) | Report catalog (financial + instructor compensation), Excel export via the existing `exceljs` dependency, and the accounting-export adapter foundation (`AccountingMapping`, `FinancialExportJob`, generic-CSV + QuickBooks-shaped), with export security and honest labeling | Aviation Accounting Specialist; SaaS Revenue Operations Architect; Documentation Engineer |
| [39-implementation-plan.md](./39-implementation-plan.md) | The phased build playbook — the eight fixed implementation phases, each with exact model/engine/route/UI scope, dependency ordering, test gates, the `PaymentProvider` abstraction + env matrix, seed plan, and per-phase "done" criteria | Head of Software Engineering at Meta; Principal Software Architect at Stripe; QA/Test Engineer; Reliability/SRE Engineer |

## Deliverables map

### Part 1 (18 deliverables)

The Phase 8 Part 1 spec requires 18 deliverables before Part 2 implementation begins.

| # | Deliverable | Where it lives |
|---|---|---|
| 1 | Current billing-system audit | [00-current-billing-audit.md](./00-current-billing-audit.md) |
| 2 | Revenue Engine architecture | [01-revenue-engine-architecture.md](./01-revenue-engine-architecture.md) |
| 3 | Operational checkout workflow | [02-operational-dispatch-and-closeout.md](./02-operational-dispatch-and-closeout.md) |
| 4 | Revenue Review lifecycle | [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) |
| 5 | Aircraft pricing-profile design | [05-aircraft-pricing-profiles.md](./05-aircraft-pricing-profiles.md) |
| 6 | Instructor billing-rate design | [04-instructor-time-and-rates.md](./04-instructor-time-and-rates.md) |
| 7 | Instructor compensation-rate design | [04-instructor-time-and-rates.md](./04-instructor-time-and-rates.md) |
| 8 | Revenue Item design | [06-revenue-items.md](./06-revenue-items.md) |
| 9 | Tax model | [07-tax-model.md](./07-tax-model.md) |
| 10 | Adjustment and discount model | [08-adjustments-discounts-credits.md](./08-adjustments-discounts-credits.md) |
| 11 | Responsible payer model | [11-responsible-payers.md](./11-responsible-payers.md) |
| 12 | Checkout-restriction matrix | [10-checkout-restrictions.md](./10-checkout-restrictions.md) |
| 13 | Database model proposal | [13-database-model.md](./13-database-model.md) |
| 14 | Migration plan | [14-migration-plan.md](./14-migration-plan.md) |
| 15 | ADR proposal | [15-adr-proposals.md](./15-adr-proposals.md) |
| 16 | Risks and unresolved decisions | [16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md) |
| 17 | Confirmation nothing was deployed | Compliance confirmations in [16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md) |
| 18 | Confirmation no live payments were enabled | Compliance confirmations in [16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md) |

Docs [09-payment-timing-and-collection.md](./09-payment-timing-and-collection.md) and [12-revenue-allocation-and-reporting.md](./12-revenue-allocation-and-reporting.md) carry spec Parts B/I and the allocation/reporting requirements that cut across the numbered deliverables; they are required reading even though no single deliverable number maps to them.

### Part 2 (20 deliverables)

The Phase 8 Part 2 spec requires 20 deliverables before Part 3 implementation begins.

| # | Deliverable | Where it lives |
|---|---|---|
| 1 | Stripe Connect architecture decision | [18-stripe-connect-decision.md](./18-stripe-connect-decision.md) (§1 decision, §7 ADR-037) |
| 2 | Funds-flow diagram | [18-stripe-connect-decision.md](./18-stripe-connect-decision.md) §8 |
| 3 | Connected-account onboarding workflow | [19-connected-account-onboarding.md](./19-connected-account-onboarding.md) |
| 4 | Payment-method architecture | [20-payment-methods-and-consent.md](./20-payment-methods-and-consent.md) |
| 5 | Card workflow | [21-card-and-ach-workflows.md](./21-card-and-ach-workflows.md) |
| 6 | ACH workflow | [21-card-and-ach-workflows.md](./21-card-and-ach-workflows.md) |
| 7 | Approval-to-payment workflow | [22-approval-to-payment.md](./22-approval-to-payment.md) |
| 8 | Webhook design | [23-webhooks-and-reconciliation.md](./23-webhooks-and-reconciliation.md) |
| 9 | Idempotency design | [24-idempotency.md](./24-idempotency.md) |
| 10 | Failure workflow | [25-payment-failure-workflow.md](./25-payment-failure-workflow.md) |
| 11 | Refund and dispute workflow | [26-refunds-voids-disputes.md](./26-refunds-voids-disputes.md) |
| 12 | Platform-fee design | [27-platform-fee.md](./27-platform-fee.md) |
| 13 | Revenue-allocation design | [28-revenue-allocation-ledger.md](./28-revenue-allocation-ledger.md) |
| 14 | Instructor-compensation design | [29-instructor-compensation.md](./29-instructor-compensation.md) |
| 15 | Revenue Dashboard design | [30-revenue-dashboard.md](./30-revenue-dashboard.md) |
| 16 | Notification design | [31-notifications.md](./31-notifications.md) |
| 17 | Security threat assessment | [32-financial-security-threat-assessment.md](./32-financial-security-threat-assessment.md) |
| 18 | Payment test plan | [33-payment-test-plan.md](./33-payment-test-plan.md) |
| 19 | Confirmation no live charges occurred | Compliance confirmations in [35-part2-open-decisions-and-confirmations.md](./35-part2-open-decisions-and-confirmations.md) |
| 20 | Confirmation nothing was deployed | Compliance confirmations in [35-part2-open-decisions-and-confirmations.md](./35-part2-open-decisions-and-confirmations.md) |

Docs [17-two-financial-systems.md](./17-two-financial-systems.md) (spec Part N — the SaaS-billing/Revenue-Engine separation) and [34-part2-database-additions.md](./34-part2-database-additions.md) (binding for all NEW Part 2 schema shapes) cut across the numbered deliverables; they are required reading even though no single deliverable number maps to them.

### Part 3 (UI, permissions, reporting, implementation plan)

| # | Deliverable | Document |
|---|---|---|
| 1 | Permissions & visibility matrix | [36-permissions-and-visibility.md](./36-permissions-and-visibility.md) |
| 2 | UI workflows (screen specs) | [37-ui-workflows.md](./37-ui-workflows.md) |
| 3 | Reports, Excel & accounting exports | [38-reports-and-exports.md](./38-reports-and-exports.md) |
| 4 | Phased implementation plan (8 phases) | [39-implementation-plan.md](./39-implementation-plan.md) |

## Conventions that hold across every doc

- Money is Prisma `Decimal` — never float. New financial models carry an explicit ISO 4217 currency column; the default recommendation is `Decimal(12,2)` + currency, with the binding per-field call made in [13-database-model.md](./13-database-model.md).
- The existing `Dispatch` model is reused and extended — no parallel dispatch model is introduced.
- Org-owned records are tenant-scoped by `organizationId` taken from the session; every API route authorizes via `authorize()`; every mutation is audited via `recordAudit`; domain events go through `emitDomainEvent`; migrations are additive-only; business logic lives in `src/lib` engines with thin routes; RBAC is data in `src/lib/permissions.ts`, never hardcoded role checks.

## What happens next

All three design parts (1–3) are now complete. Implementation follows the eight-phase sequence in [39-implementation-plan.md](./39-implementation-plan.md), building the [13-database-model.md](./13-database-model.md) schema plus the [34-part2-database-additions.md](./34-part2-database-additions.md) additions in the order set by [14-migration-plan.md](./14-migration-plan.md), against Stripe **test mode only**, behind env flags that default off — no live charge, no production email, no deploy. The ADRs proposed in [15-adr-proposals.md](./15-adr-proposals.md) and [18-stripe-connect-decision.md](./18-stripe-connect-decision.md) (ADR-037) merge into DECISIONS.md as the corresponding phases land. Before any **live** launch, the selected Connect posture (merchant of record, tax reporting, dispute and negative-balance liability) must be reviewed by qualified **legal and accounting professionals** (spec Part O; [18](./18-stripe-connect-decision.md) review requirements).
