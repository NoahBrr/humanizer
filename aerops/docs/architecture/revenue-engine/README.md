# AeroOps Revenue Engine — Design Set Index

> **Status:** Proposed — Phase 8 Part 1 · **Date:** 2026-07-10 · **Lead roles:** Head of Product; Documentation Engineer · **Part of:** Revenue Engine design set ([README](./README.md))

## What the Revenue Engine is

The **Revenue Engine** is the aviation-native financial operating system of AeroOps: it connects aircraft dispatch, aircraft return, Hobbs and Tach time, instructor time, organization-defined charges, invoice review, payment collection, instructor compensation, revenue allocation, reporting, and accounting exports. It is not a basic billing module — it is the financial workflow that begins the moment an aircraft is dispatched and ends only when the flight is operationally closed, the Revenue Review is approved, the customer is charged, the school receives its proceeds, AeroOps earns its platform fee, Instructor Compensation is recorded, and reports and Financial Exports are updated. "Revenue Engine" is the customer-facing module name; backend records keep standard accounting and provider terms (Invoice, InvoiceLine, PaymentIntent, PaymentTransaction, Refund, TaxSnapshot, LedgerEntry, Dispute) — existing database concepts are never renamed for marketing reasons. This design set is **Part 1 of 3 — design only**: no schema, code, migration, deploy, live Stripe charge, or production email ships with it.

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

## Deliverables map

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

## Conventions that hold across every doc

- Money is Prisma `Decimal` — never float. New financial models carry an explicit ISO 4217 currency column; the default recommendation is `Decimal(12,2)` + currency, with the binding per-field call made in [13-database-model.md](./13-database-model.md).
- The existing `Dispatch` model is reused and extended — no parallel dispatch model is introduced.
- Org-owned records are tenant-scoped by `organizationId` taken from the session; every API route authorizes via `authorize()`; every mutation is audited via `recordAudit`; domain events go through `emitDomainEvent`; migrations are additive-only; business logic lives in `src/lib` engines with thin routes; RBAC is data in `src/lib/permissions.ts`, never hardcoded role checks.

## What happens next

Approval of this design set **and the accompanying threat model** gates Part 2 implementation — no schema, code, or migration work starts before that sign-off. On approval, the ADRs proposed in [15-adr-proposals.md](./15-adr-proposals.md) merge into DECISIONS.md, and Parts 2–3 implement the doc-13 schema in the sequence set by [14-migration-plan.md](./14-migration-plan.md).
