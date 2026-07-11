# Responsible Payer Model (Parents, Guardians, Employers, Sponsors)

> **Status:** Proposed — Phase 8 Part 1 · **Date:** 2026-07-10 · **Lead roles:** Head of Product; Financial UX Designer; Principal Payments Architect at Stripe · **Part of:** Revenue Engine design set ([README](./README.md))

This document owns spec **Part K — Parent, Guardian, and Responsible Payer Model**. It defines who pays when the person flying is not the person paying: the payer entities, the student–payer relationships, payer identity and tenancy, payer capabilities, charge routing on a Revenue Review, minors and consent, and the privacy boundary between financial visibility and training records.

---

## 1. Purpose & scope

Today the only billing party in AeroOps is `Invoice.studentId` (prisma/schema.prisma ~L1101), and the only balance concept is `Student.accountBalance` (~L566). There is no parent, guardian, employer, or sponsor anywhere in the schema, no payer-facing surface, and no way to route a charge to anyone but the student. Flight training reality is different: a large share of Part 61/141 students are minors whose parents pay, university and academy students whose institutions pay, and career changers on employer or scholarship funding.

This design introduces:

- **`ResponsiblePayer`** — an org-scoped registration of a paying party (person or entity), optionally linked to a real AeroOps `User` account.
- **`StudentPayerRelationship`** — an org-scoped link between one Student and one ResponsiblePayer, carrying capabilities, consent, and default-payer routing.
- **Charge routing** — how a Revenue Review resolves *which payer's Payment Method gets charged*, how the default is chosen, and how it is overridden before approval.
- **The payer surface** — a self-service financial view for linked payers (invoices, receipts, Payment Methods, payment status, optional charge approval).

In scope for this document: the data model, lifecycles, routing rules, RBAC/audit, consent, and privacy boundaries. Out of scope (owned by siblings): Revenue Review statuses and approval chains (04-revenue-review-lifecycle.md), Stripe customer/payment-method mechanics (02-architecture.md, final shapes in 13-database-model.md), checkout restriction evaluation (12-checkout-restrictions.md), and payer-transfer adjustments after approval (10-adjustments-and-discounts.md).

**Vocabulary note.** Customer-facing term is **Responsible Payer** (short form "Payer" in dense UI). Per AVIATION_STANDARDS.md, this document says *aircraft return / operational closeout*, never "check-in", for the moment the spec calls aircraft check-in.

---

## 2. The five-way identity separation

The spec requires these five identities to be clearly separated. Each maps to exactly one model, and no model plays two of these roles.

| # | Identity | What it is | Model | Cardinality & scope |
|---|----------|------------|-------|---------------------|
| 1 | **Student receiving service** | The person who flew / took the lesson. Operational and training records attach here. | Existing `Student` (via `User`) | One per dispatch. Org-scoped via membership. Never changed by billing decisions. |
| 2 | **Customer identity** | The bill-to party on a Revenue Review / Invoice — who legally owes this money. | `RevenueReview.payerId` / `Invoice.payerId` (nullable FK → `ResponsiblePayer`; **null = the student is their own customer**, the adult-renter default) plus an immutable `billToLabel` snapshot at approval | One per Revenue Review. Resolved at draft creation, overridable pre-approval, frozen at approval. |
| 3 | **Responsible payer** | The registered paying party: parent, guardian, employer, sponsor. Holds contact info, portal access, consent, and relationships to students. | **New `ResponsiblePayer`** + **new `StudentPayerRelationship`** | One `ResponsiblePayer` row per (organization, paying party). One relationship row per (student, payer). |
| 4 | **Stripe customer** | The provider-side customer object that owns saved cards/ACH mandates. | `PaymentCustomer` (defined in 02-architecture.md; binding shape in 13-database-model.md) referencing exactly one payer party: a `ResponsiblePayer` **or** a self-paying `Student` | One per (organization, payer party). Stripe customers live on the **org's connected account**, so they can never be shared across tenants — Stripe's object model enforces what our tenancy rules require. |
| 5 | **Organization receiving proceeds** | The tenant whose connected account receives the funds. | Existing `Organization` (+ its Stripe Connect account reference, Part 2) | One per Revenue Review. Always `session.organizationId`, never client input. |

Consequences worth stating plainly:

- A parent with two children at the same school: **one** `ResponsiblePayer`, **two** `StudentPayerRelationship` rows, **one** `PaymentCustomer`, one saved card charged for both children's Revenue Reviews.
- A parent with children at two different schools: **two** `ResponsiblePayer` rows (one per org), **two** `PaymentCustomer` rows on two different connected accounts, and a card saved separately with each school. Payment Methods never cross tenants.
- An adult renter paying for themselves: **zero** payer rows. `payerId` stays null, the student is the customer identity, and their `PaymentCustomer` references the Student directly. We do not manufacture a "self payer" row — that would double-represent identity #1.
- An employer paying for five employees: one `ResponsiblePayer` of type `EMPLOYER` (with `companyName`), five relationships, one saved corporate card.

### Tenancy resolution (explicit)

**The payer's `User` account is global; every payer record is org-scoped.** `User.email` is globally unique and a `User` can exist with no membership at all (the "individual" session kind, src/lib/session.ts:28-58). We reuse that: a payer's login is one global `User`. But `ResponsiblePayer`, `StudentPayerRelationship`, saved Payment Methods, notifications, and everything financial hang off org-scoped rows with a real `Organization` FK, per ADR-021 and tests/schema-governance.test.ts. Cross-org payer visibility exists only inside the payer's own portal ("your students at Coastal Flight Academy / at Blue Ridge Flying Club"), assembled by iterating the payer's own `ResponsiblePayer` rows — exactly how multi-org `Membership` works today (ADR-023). No org ever sees another org's payer data; a payer never sees anything an ACTIVE relationship in that org does not authorize.

A payer does **not** get a `Membership`. Memberships carry org roles and org-app navigation; a payer is not org staff and must never land in the org app. See §7 for the `authorizePayer()` gate.

---

## 3. How it works

### 3.1 Payer types

`PayerType` enum, fixed vocabulary from the spec (org-defined subtypes are not needed; `OTHER` + `displayName`/`notes` covers the tail):

| Value | Typical case | Entity? |
|-------|-------------|---------|
| `PARENT` | Parent paying for a minor or adult child | Person |
| `GUARDIAN` | Legal guardian (consent fields apply) | Person |
| `EMPLOYER` | Company funding an employee's training | Entity (`companyName`) |
| `SCHOLARSHIP_SPONSOR` | Scholarship fund / foundation | Entity |
| `UNIVERSITY` | University or academy program | Entity |
| `CLUB_SPONSOR` | Flying-club sponsorship | Entity |
| `OTHER` | Anything else | Either |

### 3.2 ResponsiblePayer lifecycle

```
                 ┌────────────┐  invitation accepted / user linked  ┌────────┐
  staff create → │  INVITED   │ ───────────────────────────────────→│ ACTIVE │
                 └────────────┘                                     └───┬────┘
                       │ archive (never invited/accepted)     suspend │ ↕ reinstate
                       ▼                                              ▼
                 ┌────────────┐            archive             ┌───────────┐
                 │  ARCHIVED  │ ←──────────────────────────────│ SUSPENDED │
                 └────────────┘                                └───────────┘
```

- **INVITED** — created by org staff (name, email, type). No portal access yet. The org may already route charges to this payer *only* for `MANUAL_INVOICE` timing (no saved Payment Method can exist yet). An invitation token (sha256 `inviteTokenHash`, ADR-020 pattern, `InviteLink` precedent) is issued; raw token shown once / sent to the payer.
- **ACTIVE** — a real `User` is linked (`userId` set). Portal access on, Payment Methods can be saved, automatic charging possible.
- **SUSPENDED** — org paused this payer. No new Revenue Reviews may route to them; existing approved-and-scheduled charges still execute (the approval snapshot is immutable); portal remains read-only. Reversible.
- **ARCHIVED** — soft retirement. Hidden from pickers, relationships must already be revoked, history and issued invoices retain their snapshots. `ResponsiblePayer` rows are never hard-deleted while relationships or invoices reference them (FK `Restrict`).

Transitions are guarded `updateMany` claims in a `$transaction` (the dispatch-close idempotency pattern, src/app/api/dispatch/[id]/close/route.ts:71-88), each with `recordAudit`.

**Invitation acceptance flow:** payer opens the invite URL → signs in or creates an account (existing public sign-up; the new user is an "individual"-kind session) → accepts the org's billing authorization text (§3.5) → `ResponsiblePayer.userId` set, status → ACTIVE, `payer.invitation_accepted` audited. If the signed-in user's email differs from the invitation email, acceptance is allowed on token possession but the mismatch is recorded and surfaced to the org for confirmation (see Open Questions).

### 3.3 StudentPayerRelationship lifecycle

```
  staff link → PENDING ──(consent satisfied / not required)──→ ACTIVE ──revoke──→ REVOKED
                  │ revoke                                                (terminal)
                  └──────────────────────────────────────────→ REVOKED
```

- **PENDING** — link created but a required consent is outstanding (guardian consent for a minor, or adult-student acknowledgment when the org enables that setting). No routing, no visibility yet.
- **ACTIVE** — routing and visibility per the relationship's capability flags.
- **REVOKED** — terminal; a new link can be created later. Revocation requires a reason and is audited. Revoking the default payer forces the actor to either pick a new default or explicitly leave the student self-pay.

**One default payer, multiple approved payers** (spec Part K): any number of ACTIVE relationships per student; at most one has `isDefault = true`. Enforced three ways: engine logic clears the previous default in the same `$transaction`; a Postgres **partial unique index** (`ON "StudentPayerRelationship"("studentId") WHERE "isDefault" AND "status" = 'ACTIVE'`, added as raw SQL in the DDL migration — Prisma cannot express partial indexes in schema); and validation in the routing resolver. *Different payer by program or charge category is explicitly a future phase* — see §10; the model reserves no columns for it now (a future `PayerRoutingRule` table is the right shape, not JSON on this row).

### 3.4 Payer capabilities

Capabilities are per-relationship booleans — a parent may manage payment for one child and only view for another.

| Capability (flag) | Default | What it grants on the payer surface |
|---|---|---|
| `canViewInvoices` | `true` | Revenue Reviews (financial view only, post-approval), Invoices, receipts, payment status, and the Amount Due arising from them — **scoped to records where this payer is the snapshotted bill-to party** (`Invoice.payerId` / review snapshot `payerId` = this payer). Does not include the student's self-pay invoices or invoices billed to another approved payer (§3.9). |
| `fullFinancialVisibility` | `false` | Opt-in widening of `canViewInvoices` to **all** of the linked student's financials in this org (self-pay and other-payer invoices included). For arrangements that genuinely need it (a parent covering everything, a sponsor auditing total spend). See §3.9 and Open Question 1 for the consent interplay. |
| `canManagePaymentMethods` | `true` | Add/replace/remove saved Payment Methods via Stripe-hosted surfaces (SetupIntent; card data never touches AeroOps — ADR-018 SAQ-A posture) |
| `receivesNotifications` | `true` | In-app payment notifications: receipt, payment failed, ACH pending/returned, upcoming scheduled charge, charge-approval request. (In-app `Notification` rows only in Phase 8 — no email provider exists; do not send production email.) |
| `chargeApprovalRequired` | `false` | When `true` *and* the org enables payer charge approval (§4), an approved Revenue Review routed to this payer waits for the payer's explicit approval before the Payment Attempt is created |
| Spending alerts | — | **Future phase** (spec). No columns reserved. |

"Personal AeroOps account" and "link to one or more students" from the spec's capability list are structural (§2, §3.2), not flags.

### 3.5 Billing authorization (consent to charge)

Before any automatic charge to a payer's saved Payment Method, the payer must have accepted the billing authorization: *"I authorize {Organization} to charge my saved payment method for approved charges for {linked students}."* Recorded as `billingAuthorizationVersion` + `billingAuthorizationAcceptedAt` on `ResponsiblePayer` (per org — a parent authorizes each school separately). Captured during invitation acceptance and re-prompted if the org's authorization text version changes. ACH mandates are additionally handled by Stripe at SetupIntent time (owned by 02-architecture.md). Manual timing policies (`MANUAL_INVOICE`) do not require it; automatic charging does — the payment-readiness evaluator treats a missing authorization exactly like a missing Payment Method.

### 3.6 Charge routing — which payer a Revenue Review charges

**Resolution at draft creation** (when aircraft return / operational closeout generates the draft Revenue Review, 03-operational-checkout.md → 04-revenue-review-lifecycle.md):

1. **Explicit payer on the Dispatch** — captured at aircraft checkout ("Responsible payer if known", spec Part A; field lands on `Dispatch` per 03/13) — wins if that relationship is still ACTIVE.
2. **Student's default payer** — the single ACTIVE `isDefault` relationship.
3. **Student self-pay** — `payerId = null`; the student is the customer identity.

The resolver is an explainable engine function (CONSTITUTION rule 6): it returns the chosen party **and why** (`explicit_dispatch | student_default | self_pay`), and that basis is stored on the draft (`payerResolutionBasis`) so reviewers and auditors see how the bill-to was chosen. If the resolver finds an explicit dispatch payer whose relationship has been revoked or suspended since checkout, it falls through to the next rule and attaches a **warning** to the draft ("Payer selected at dispatch is no longer available").

**Pre-approval override:** any reviewer holding `billing.payers_manage` (or the review-edit permission per 04) may reassign the bill-to party on a Draft / Awaiting-Review / Changes-Requested Revenue Review to (a) any ACTIVE approved payer for that student, or (b) student self-pay. Reason required; audited with before/after (`revenue_review.payer_changed`). This is routing, not an adjustment — amounts do not change.

**At approval, the customer identity freezes.** The approval snapshot (owned by 04) includes: `payerId`, `billToLabel` (display name at that moment), `payerType`, the selected `PaymentMethodReference` id, and the payment timing policy. Changing a payer's name, archiving them, or revoking the relationship tomorrow must not alter yesterday's approved review — same immutability carve-out as rate snapshots (DATABASE_STANDARDS.md "computed values" rule does not apply to point-in-time financial facts; see 13-database-model.md).

**Post-approval transfer** ("Transfer responsibility to another payer", spec Part H) is *not* an edit to the snapshot: it is an adjustment flow owned by 10-adjustments-and-discounts.md (void/reissue or transfer adjustment with actor, reason, before/after, approval), and it re-runs payment-readiness against the new payer.

**Payment execution:** the Payment Attempt charges the snapshotted payer's selected Payment Method via that payer's `PaymentCustomer` on the org's connected account. Failure handling, retries, and dunning are owned by 04/02; the payer surface shows the resulting payment status and the payer gets the failure notification if `receivesNotifications`.

### 3.7 Payer charge approval (optional, org-configured)

When armed (org setting + relationship flag), the flow after operations approval is:

```
Approved ──→ Payment Scheduled (awaiting payer) ──payer approves──→ charge initiated
                    │                                   (Payment Processing …)
                    ├─ payer declines (reason) ──→ ops notified; review flagged;
                    │                              Amount Due / manual follow-up per org policy
                    └─ approval window expires (default 3 days) ──→ ops notified; same as decline
```

The payer's approve/decline is a first-class human action: `authorizePayer()`-gated route, `recordAudit` (`revenue_review.payer_approved` / `payer_declined`), and it is the payer — a human — who triggers the charge, satisfying "AI never mutates / payments require a human" (CONSTITUTION rule 8) and spec principle 2 (the payer-facing control reads **"Approve and charge my saved payment method"** with the exact amount). Status names and transitions belong to 04-revenue-review-lifecycle.md; this section defines only the payer's part.

### 3.8 Minors and guardian consent

- The relationship carries `guardianConsentAt`, `guardianConsentByLabel`, and optional `consentDocumentId` (FK → existing `Document`) so orgs can attach a signed training/billing agreement.
- Org setting `minorPayerPolicy` (§4) can require a PARENT/GUARDIAN relationship before dispatch of a minor student — evaluated as a **financial checkout restriction** (12-checkout-restrictions.md), i.e. configurable warn/block, never overriding safety actions.
- `Student` has no date-of-birth field today. Phase 8 does **not** add age computation; "minor" is asserted by the org when it marks a relationship as guardian-consent-required or enables the minor policy per student. (Whether to add `Student.dateOfBirth` additively is an open question — it is a training-records decision, not a billing one.)
- AeroOps records that consent was captured, by whom, and when; it does not adjudicate guardianship or provide legal advice. A disclaimer to that effect appears wherever guardian consent is recorded (mirrors the contractor-classification disclaimer in 07-instructor-compensation-rates.md).

### 3.9 Privacy boundary — financials, never training records

The payer surface is a **financial** window, hard-scoped to (payer's ACTIVE relationships) × (that relationship's capability flags):

| Payers CAN see (per linked student, per org) | Payers can NEVER see |
|---|---|
| Approved Revenue Reviews **billed to this payer** — financial view: charges, taxes, discounts, totals, payment status | Draft/in-review Revenue Reviews (pre-approval) |
| Invoices where they are the bill-to party, receipts, Payment Attempt outcomes, and the Amount Due arising from them | Training records: lesson content/grades, LessonRecords, endorsements, checkrides, syllabus progress |
| Their own Payment Methods (brand/last4/expiry only — provider references, no PAN ever) | Medical, TSA, certificate data; student documents |
| Their own notifications and charge-approval requests | Schedule, dispatch/operational data, squawks |
| Line **descriptions** as written on the invoice | Other students' data; any org data beyond their linked students' financials; instructor compensation or org allocations (school-internal — payers see charges, not margins) |

**Whose invoices (bill-to scope) — explicit.** `canViewInvoices` covers only invoices and approved Revenue Reviews where this payer is the **snapshotted bill-to party** (`Invoice.payerId` = this payer / the review's snapshot `payerId`). It does not expose the student's self-pay history or charges billed to a different approved payer. The per-relationship `fullFinancialVisibility` flag (§3.4, default `false`) is the explicit opt-in that widens visibility to all of the linked student's financials in this org. The narrow default is deliberate: because `adultStudentConsent` defaults to `ORG_AUTHORITY` (§4 — staff can link a payer to an adult student without the student's acknowledgment), an employer or sponsor must never gain an adult student's entire financial history merely by being linked; granting `fullFinancialVisibility` is audited, and whether it should require the adult student's acknowledgment is folded into Open Question 1.

Two enforcement notes: (1) line descriptions are payer-visible by design — the org-side UI says so where lines are edited ("Visible to the student and their payer"); (2) every payer query is scoped `relationship → student → invoice` inside the engine — there is no payer-side query that starts from `organizationId`, so a missing filter fails closed to *nothing* rather than to the org's data. Cross-tenant or unlinked ids return 404, indistinguishable from nonexistent (API_STANDARDS.md).

The student (adult) always sees their own financials regardless of payer arrangement, on the student-facing billing surface (a ROADMAP deferral that Phase 8 Part 3 picks up); payer visibility is additive, never a transfer of the student's own visibility.

---

## 4. Configuration surface (org-level, strong defaults)

Per spec principle 7 and the house config pattern (typed org-scoped config, no settings JSON blob), these live on the Revenue Engine's org configuration record (binding storage decided in 13-database-model.md; referenced here as *Revenue Settings*). Zero-setup default: payers off until first used — every option below works untouched.

| Setting | Type / options | Default | Effect |
|---|---|---|---|
| `payerChargeApproval` | `OFF \| PER_RELATIONSHIP` | `OFF` | `OFF`: `chargeApprovalRequired` flags are ignored. `PER_RELATIONSHIP`: §3.7 flow armed where the flag is set. |
| `payerApprovalWindowDays` | int 1–14 | `3` | Expiry of a pending payer charge approval before ops is notified. |
| `adultStudentConsent` | `ORG_AUTHORITY \| STUDENT_ACKNOWLEDGE` | `ORG_AUTHORITY` | `STUDENT_ACKNOWLEDGE`: linking a payer to an adult student creates the relationship PENDING until the student acknowledges (`studentAcknowledgedAt`). Default: org staff authority suffices; student is notified. |
| `minorPayerPolicy` | `OFF \| WARN \| REQUIRE` | `WARN` | Evaluated at dispatch as a financial checkout restriction (12-checkout-restrictions.md): student flagged as minor with no ACTIVE PARENT/GUARDIAN payer → warn or block. Never blocks emergency/safety actions. |
| `payerInvitationExpiryDays` | int 1–60 | `14` | Invitation token TTL; expired invitations re-issuable. |
| `billingAuthorizationVersion` | string (org's current authorization text version) | `"v1"` (platform default text) | Version stamped into `billingAuthorizationAcceptedAt` acceptances; bumping it forces re-acceptance before the next automatic charge. |
| `payerNotificationsEnabled` | boolean | `true` | Master switch for payer in-app notifications (per-relationship `receivesNotifications` still applies). |

Changes go through the standard zod-validated PATCH with before/after `recordAudit` (`org.settings_change` precedent, src/app/api/organization/settings/route.ts). Policy changes never touch already-approved reviews — timing/approval policy is snapshotted at approval (spec Part I).

---

## 5. Data model proposal (Prisma-flavored)

Final binding shapes, precisions, and index set are ratified in 13-database-model.md; this section is the proposal from the payer domain. All models follow ADR-021: real `Organization` FK with explicit `onDelete`, tenant-scoped uniques, `createdAt`, org-leading indexes.

### 5.1 New enums

```prisma
enum PayerType {
  PARENT
  GUARDIAN
  EMPLOYER
  SCHOLARSHIP_SPONSOR
  UNIVERSITY
  CLUB_SPONSOR
  OTHER
}

enum PayerStatus {
  INVITED
  ACTIVE
  SUSPENDED
  ARCHIVED
}

enum PayerRelationshipStatus {
  PENDING
  ACTIVE
  REVOKED
}
```

New enum values ship in their own DDL migration before any code or backfill uses them (DATABASE_STANDARDS.md L55-70; two-step pattern per 14-migration-plan.md).

### 5.2 `ResponsiblePayer` (new)

```prisma
/// A paying party registered with one organization: parent, guardian,
/// employer, sponsor. Identity #3 of the five-way separation. The linked
/// User (portal login) is global; this row and everything financial under
/// it are strictly org-scoped. Never hard-deleted while relationships or
/// invoices reference it — archive instead.
model ResponsiblePayer {
  id             String      @id @default(cuid())
  organizationId String
  /// Global login identity; null until the invitation is accepted
  /// (or if the org manages this payer without portal access).
  userId         String?
  payerType      PayerType
  /// Person or entity display name — snapshotted onto approved reviews
  /// as billToLabel; editing it never rewrites history.
  displayName    String
  /// Legal/billing entity name for EMPLOYER / UNIVERSITY / sponsors.
  companyName    String?
  email          String
  phone          String?
  status         PayerStatus @default(INVITED)

  /// Consent to charge saved payment methods for approved Revenue Reviews.
  billingAuthorizationVersion    String?
  billingAuthorizationAcceptedAt DateTime?

  /// Invitation (ADR-020: sha256 only, raw token shown once).
  inviteTokenHash String?   @unique
  inviteExpiresAt DateTime?
  invitedByLabel  String?

  /// Staff-only notes; never shown on the payer surface.
  notes      String?
  archivedAt DateTime?
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt

  organization  Organization               @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user          User?                      @relation(fields: [userId], references: [id], onDelete: SetNull)
  relationships StudentPayerRelationship[]
  // invoices Invoice[]            — back-relation, §5.4
  // paymentCustomer PaymentCustomer? — owned by 13-database-model.md

  @@unique([organizationId, userId])   // one payer registration per user per org (NULL userId exempt per Postgres)
  @@index([organizationId, status])
  @@index([organizationId, email])
  @@index([userId])
}
```

Notes: `user … onDelete: SetNull` — the payer row is a financial party record and must survive account deletion (contact fields retained), mirroring the audit-grade SetNull convention. `Organization` cascade is acceptable because org deletion wipes all tenant financials by design (org-snapshot wipe order updated, §5.6). No money columns on this model; if any are ever added they follow Decimal(12,2) + ISO 4217 currency per 13-database-model.md.

### 5.3 `StudentPayerRelationship` (new)

```prisma
/// Links one Student to one ResponsiblePayer within one organization:
/// routing (default payer), capabilities, and consent. Routing config —
/// not a financial record; approved reviews snapshot the payer identity
/// and survive revocation.
model StudentPayerRelationship {
  id             String                  @id @default(cuid())
  organizationId String
  studentId      String
  payerId        String
  status         PayerRelationshipStatus @default(ACTIVE)
  /// At most one ACTIVE default per student — partial unique index (§5.5)
  /// + engine transaction guard.
  isDefault      Boolean                 @default(false)

  // Capabilities (§3.4)
  canViewInvoices         Boolean @default(true)
  /// Widens canViewInvoices from bill-to-scoped (Invoice.payerId = this
  /// payer) to all of the linked student's financials in this org (§3.9).
  fullFinancialVisibility Boolean @default(false)
  canManagePaymentMethods Boolean @default(true)
  receivesNotifications   Boolean @default(true)
  chargeApprovalRequired  Boolean @default(false)

  // Consent (§3.8)
  guardianConsentAt      DateTime?
  guardianConsentByLabel String?
  consentDocumentId      String?
  studentAcknowledgedAt  DateTime?

  // Lifecycle
  revokedAt     DateTime?
  revokedReason String?
  createdByLabel String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  organization    Organization     @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  student         Student          @relation(fields: [studentId], references: [id], onDelete: Cascade)
  payer           ResponsiblePayer @relation(fields: [payerId], references: [id], onDelete: Restrict)
  consentDocument Document?        @relation("PayerConsentDocuments", fields: [consentDocumentId], references: [id], onDelete: SetNull)

  @@unique([studentId, payerId])          // one relationship per pair; re-link after revoke = update or new row per engine rules
  @@index([organizationId, status])
  @@index([payerId, status])
  @@index([studentId, status])
}
```

`payer … onDelete: Restrict` intentionally blocks hard-deleting a payer with any relationship history — archive is the path. `@@unique([studentId, payerId])` means re-linking after revocation reactivates the existing row (status REVOKED → PENDING/ACTIVE via guarded transition, audited) rather than accreting duplicates.

### 5.4 Modifications to existing models (additive only)

| Model | Change | Notes |
|---|---|---|
| `User` | + `payerProfiles ResponsiblePayer[]` back-relation | Relation only; no columns. |
| `Student` | + `payerRelationships StudentPayerRelationship[]` back-relation | Relation only. |
| `Document` | + `payerConsentRelationships StudentPayerRelationship[]` back-relation (`"PayerConsentDocuments"`) | Relation only. |
| `Invoice` | + `payerId String?` FK → `ResponsiblePayer` (`onDelete: Restrict`), + `billToLabel String?` snapshot, + `@@index([payerId])` | Null `payerId` = student self-pay (**all existing invoices backfill to null — their meaning is unchanged**, spec Part L: no silent reinterpretation). `billToLabel` set at issuance from the approved review snapshot. |
| `Dispatch` | + `payerId String?` FK → `ResponsiblePayer` ("responsible payer if known" at checkout) | Field placement owned by 03-operational-checkout.md / 13-database-model.md; requirement stated here: nullable, org-validated against an ACTIVE relationship for the dispatch's student. |
| `RevenueReview` (new model owned by 04) | This doc contributes: `payerId String?`, `payerResolutionBasis String` (`explicit_dispatch \| student_default \| self_pay \| manual_override`), approval-snapshot fields `billToLabel`, `billToPayerType`, `paymentMethodRefId`, payer-approval fields `payerApprovalRequestedAt`, `payerApprovedAt`, `payerDeclinedAt`, `payerDeclineReason` | Snapshot fields immutable after approval. |
| `PaymentCustomer` (new model owned by 02/13) | Requirement from this doc: exactly one owning party per row — `payerId String?` **xor** `studentId String?`, `@@unique([organizationId, payerId])`, `@@unique([organizationId, studentId])`; Stripe customer id is an opaque provider reference (safe to store, ADR-020) | Stripe customers are created lazily on first Payment Method save, on the org's connected account. |
| `NotificationKind` | + values used for payer notifications (e.g. `PAYMENT_RECEIPT`, `PAYMENT_FAILED`, `CHARGE_APPROVAL_REQUESTED`) | Additive enum migration; shared with 04 — 13-database-model.md owns the final list. |

### 5.5 Indexes & constraints summary

| Constraint / index | Purpose |
|---|---|
| `ResponsiblePayer @@unique([organizationId, userId])` | One payer registration per user per org (tenant-scoped, ADR-021) |
| `ResponsiblePayer.inviteTokenHash @unique` | Token lookup pre-tenancy (InviteLink precedent) |
| `ResponsiblePayer @@index([organizationId, status])`, `@@index([organizationId, email])`, `@@index([userId])` | Org payer lists; invite dedup; payer-portal resolution (`userId → payer rows`) |
| `StudentPayerRelationship @@unique([studentId, payerId])` | No duplicate links |
| **Partial unique** `("studentId") WHERE "isDefault" AND status='ACTIVE'` (raw SQL in migration) | One default payer per student, DB-enforced |
| `StudentPayerRelationship @@index([payerId, status])`, `@@index([studentId, status])`, `@@index([organizationId, status])` | Portal queries; routing resolution; org relationship lists |
| `Invoice @@index([payerId])` | Payer-portal invoice lists and payer statements/reconciliation |

### 5.6 Platform wiring (same slice as the models)

- **org-snapshot.ts**: add `responsiblePayers` and `studentPayerRelationships` to `TableKey`, capture, restore order (payers before relationships; both before invoices restore since `Invoice.payerId` references them), and the FK-safe wipe order (**relationships → invoices → payers**, because both relationship and invoice FKs are `Restrict`).
- **Seed** (prisma/seed.ts): fixtures in **both** orgs — demo org: a PARENT payer (ACTIVE, default for one minor-flagged student, with guardian consent recorded) and a UNIVERSITY payer (INVITED, no user); Blue Ridge: an EMPLOYER payer linked to one member — proving tenant isolation and the multi-org validation matrix (spec Part L). Demo logins untouched.
- **Import Center**: payer/relationship import spec is a Part 3 extension of src/lib/import/spec.ts (noted, not designed here).

---

## 6. Validation & business rules

| # | Rule | Enforcement |
|---|---|---|
| V1 | `payerId` anywhere (Dispatch, RevenueReview, Invoice, override APIs) must belong to `session.organizationId` **and** have an ACTIVE `StudentPayerRelationship` with the record's student | Engine check on every write; cross-tenant/unlinked → 404 |
| V2 | At most one ACTIVE default relationship per student | Partial unique index + `$transaction` guard (clear-then-set) |
| V3 | No duplicate (student, payer) relationship | `@@unique([studentId, payerId])` |
| V4 | Routing resolution order: explicit dispatch payer → student default → self-pay; basis recorded | Resolver in `src/lib` (explainable engine); contract-tested |
| V5 | Bill-to override allowed only pre-approval, only to an ACTIVE approved payer or self-pay, reason required | Route + engine guard; audited |
| V6 | Approval snapshots payer identity (`payerId`, `billToLabel`, `payerType`, Payment Method ref, timing policy); snapshot never mutated by later payer changes | Snapshot columns written in the approval transaction (04); immutability carve-out per 13 |
| V7 | SUSPENDED/ARCHIVED payer: no new routing, no new relationships, cannot be set default; already-approved scheduled charges still execute | Resolver + transition guards |
| V8 | Archive requires zero ACTIVE/PENDING relationships; hard delete blocked by `Restrict` FKs | Engine + DB |
| V9 | Revoking the default relationship forces explicit choice: new default or self-pay (never silently reroutes) | Transactional revoke API |
| V10 | Automatic charging requires: ACTIVE payer, accepted billing authorization at current version, saved Payment Method; otherwise payment-readiness warnings on the review ("Missing payer", "Missing payment method", spec Part A warnings) and `MANUAL_INVOICE` fallback per org timing policy | Payment-readiness evaluator (04/12); warnings never block operational closeout unless org-configured |
| V11 | Minor policy (`minorPayerPolicy`) evaluates as a **financial** checkout restriction: warn/block per org, never overrides safety/airworthiness actions | 12-checkout-restrictions.md |
| V12 | PENDING relationship (consent outstanding): no routing, no payer visibility | Resolver + payer-surface scoping |
| V13 | Payer charge approval: approve/decline only by the payer's own linked `User`, only while the review awaits payer approval; refused with 403 under read-only impersonation; guarded `updateMany` claim prevents double-approval/replay | `authorizePayer({ mutating: true })` + state-machine claim |
| V14 | Invitation acceptance: unexpired token, single use (`inviteTokenHash` nulled on acceptance in the same transaction); email mismatch recorded and flagged | Self-service route + transaction |
| V15 | Existing invoices: `payerId` backfills to NULL (student self-pay) — behavior identical to today; no reinterpretation | 14-migration-plan.md; backfill is a no-op data migration |
| V16 | Payer-surface reads start from the payer's relationships, never from `organizationId`; capability flags applied per relationship; invoice/review visibility limited to records where the payer is the snapshotted bill-to party (`Invoice.payerId` = payer) unless the relationship's `fullFinancialVisibility` flag is set (§3.9) | `authorizePayer()` + engine scoping (§7) |

---

## 7. RBAC, approvals & audit

### 7.1 Org-side permissions (data-driven, src/lib/permissions.ts)

New keys in the `billing.` namespace so the existing `MODULE_BY_PREFIX` gate (src/lib/session.ts:263-266) module-gates them with zero wiring. (If the design set standardizes a `revenue.` prefix instead, that prefix must be added to `MODULE_BY_PREFIX` — flagged for 02-architecture.md consistency.)

| Permission key | Grants | Default bundles |
|---|---|---|
| `billing.payers_view` | View payers, relationships, routing on reviews | ACCOUNT_OWNER, SCHOOL_ADMIN, ACCOUNTANT, DISPATCHER (needs routing visibility at dispatch) |
| `billing.payers_manage` | Create/invite/edit/suspend/archive payers; create/revoke relationships; set default; override bill-to pre-approval; record guardian consent | ACCOUNT_OWNER, SCHOOL_ADMIN, ACCOUNTANT |

No new `Role` enum values (enum growth is deprecated; ADR-023/D2 precedent). Role templates (src/lib/role-templates.ts — e.g. "Front Office") gain these keys where appropriate. Routes check permission keys only, never role names. All mutating routes pass `{ mutating: true }` so read-only impersonation and read-only API keys are refused.

### 7.2 Payer-surface authorization — `authorizePayer()`

Payers are not org members, so `authorize(permission)` cannot gate them (an "individual"-kind session has an empty permission set and reaches `/welcome` only). Design:

- New helper **`authorizePayer(opts: { mutating?: boolean })`** beside `authorize()` in src/lib/session.ts (the single-gate rule is preserved: one file, one session resolution path). It requires any signed-in `User` (org, or individual kind), resolves `session.userId → ResponsiblePayer rows (status ACTIVE)`, and returns the payer scope (payer rows + ACTIVE relationships + capability flags). No org permissions involved; no `organizationId` from the client — scope derives entirely from the caller's own payer rows.
- **Impersonation semantics identical to `authorize()`** (SECURITY_STANDARDS.md: read-only impersonation blocks ALL mutations at the gate). `getSession()` resolves individual-kind impersonation targets (src/lib/session.ts:130-153), so a platform staffer impersonating a payer's `User` reaches this gate. Every mutating payer route passes `{ mutating: true }`, and while `session.impersonation?.readOnly` is set, `authorizePayer({ mutating: true })` refuses with 403 — covering accept invitation, billing-authorization acceptance, Payment Method management, notification read-state, and charge approve/decline. **"Approve and charge my saved payment method" must never be triggerable under read-only impersonation.** Full-access impersonated payer actions are re-attributed via the centralized `computeAttribution` (ADR-023), same as org routes. Part 2's definition of done includes a denial test: read-only impersonation of a payer `User` → 403 on every mutating `/api/payer/*` route. Mirrored in 15-adr.md (payer-boundary ADR risks) and the risk register (doc 16, R4).
- Payer routes live under `/api/payer/*` and are catalogued in **`SELF_SERVICE_ROUTES`** in tests/constitution.test.ts with a written reason, following the existing individual-onboarding precedent ("each route acts only on the caller's own membership and is engine-validated" — payer routes act only on the caller's own payer relationships). This is a new security boundary and is called out in the design-set ADR (15-adr.md) per the governance requirement.
- Payer app surface `/payer` (see §8); org app navigation is untouched — a payer-only `User` never sees org sections (`SECTION_PERMISSIONS` unchanged for them).
- Rate limiting (src/lib/rate-limit.ts) on all payer-facing routes, as required for self-service surfaces.
- Mutations available to payers are exactly: accept invitation, accept billing authorization, manage own Payment Methods (via Stripe-hosted surfaces), notification read-state, approve/decline a charge when requested (§3.7). Nothing else on the payer surface mutates.

### 7.3 Audit actions (every mutation via `recordAudit`)

Dot-namespaced, with before/after in `oldValue`/`newValue`; impersonation attribution is centralized (ADR-023) so these routes just pass `actorUserId: session.userId`. Payer self-service actions audit with the payer's own userId as actor and the relationship's org as `organizationId`.

| Action | Fired on |
|---|---|
| `payer.created` / `payer.updated` / `payer.suspended` / `payer.reinstated` / `payer.archived` | ResponsiblePayer lifecycle |
| `payer.invited` / `payer.invitation_accepted` / `payer.authorization_accepted` | Invitation & consent-to-charge |
| `payer.relationship_created` / `payer.relationship_activated` / `payer.relationship_revoked` | Relationship lifecycle (revoke includes reason) |
| `payer.default_changed` | Default payer set/cleared (old and new payer ids) |
| `payer.consent_recorded` / `payer.student_acknowledged` | Guardian consent / adult-student acknowledgment |
| `revenue_review.payer_changed` | Pre-approval bill-to override (reason, before/after) |
| `revenue_review.payer_approved` / `revenue_review.payer_declined` | Payer charge approval (§3.7) |

Domain events: no new `WEBHOOK_EVENTS` entries from this document (every registered event needs a live emit site; payer lifecycle does not need external fan-out in Phase 8). Payment-lifecycle events are owned by 04. Payer notifications are direct `Notification` rows (`userId` = payer's user id; the model already supports non-member users).

---

## 8. UX notes (aviation-native, operational workflow first)

- **Dispatch (checkout):** one compact line on the release card — `Bill to: Sarah Chen (Parent) ▾` — prefilled with the student's default payer; dispatcher can switch among approved payers or "Student pays". No accounting vocabulary, no modal detours; a dispatcher releasing an aircraft should spend zero extra seconds when the default is right. A "no payment method on file" state shows as a quiet amber warning chip (warn-only by default, per 12-checkout-restrictions.md), never as a blocker mixed in with airworthiness.
- **Aircraft return / operational closeout:** payer is *not* asked about at return — the resolver already decided, and financial questions do not belong in the return flow (spec principle 1). The draft Revenue Review shows the resolved payer with its basis ("Default payer" / "Selected at dispatch").
- **Revenue Review — Payment section (04's layout):** Responsible Payer with type chip, payment readiness (method on file? authorization current? approval required?), and a permission-gated `Change payer` action requiring a reason. Missing-payer/missing-method warnings render here, in the review queue — not in the cockpit-adjacent flows.
- **Students & payers admin:** payer management lives inside the student profile (a "Billing & Payer" tab) plus an org-level payer list under Billing. Status chips (INVITED / ACTIVE / SUSPENDED / ARCHIVED, PENDING / ACTIVE / REVOKED) come from the single `STATUS_TONE` map (src/lib/status-colors.ts — new entries, existing meanings untouched).
- **Payer surface (`/payer`):** deliberately small and financial: linked students grouped by organization; per student — Amount Due, recent invoices, receipts, payment status; Payment Methods (Stripe-hosted management); notifications; pending charge approvals with the explicit control **"Approve and charge my saved payment method — $412.50"**. No schedule, no training data, no org branding leakage across tenants. Light+dark and mobile parity per house UI rules — parents will use this on phones.
- **Language:** "Responsible Payer", "Bill to", "Approve and charge". Never "guarantor", "account holder", "debtor". Student-facing views avoid "account balance" (spec principle 4) — "Amount Due" only, and only when one exists.

---

## 9. Interactions with other Revenue Engine components

| Sibling doc | Interaction |
|---|---|
| 02-architecture.md | `PaymentCustomer` / `PaymentMethodReference` / Stripe Connect: one Stripe customer per (org, payer party) on the org's connected account; SetupIntent-hosted method capture; SAQ-A posture. This doc supplies the party model those objects hang off. |
| 03-operational-checkout.md | `Dispatch.payerId` capture at checkout ("responsible payer if known"); "Missing payer / missing payment method" configurable warnings at return; operational closeout never blocked by payer state unless org-configured. |
| 04-revenue-review-lifecycle.md | Draft routing resolution (§3.6), payer fields in the approval snapshot, payer charge-approval states (§3.7), payment-readiness evaluation, payer notifications on payment outcomes. |
| 05-aircraft-pricing-profiles.md | None directly; membership/program pricing eligibility keys off the **student**, never the payer — who pays must not change what is charged. |
| 09-tax-model.md | Tax treatment keys off the org/location/items, not the payer, in Phase 8. (Payer-based exemptions, e.g. university sponsors, are explicitly deferred.) |
| 10-adjustments-and-discounts.md | Post-approval "transfer responsibility to another payer" is an adjustment with actor/reason/before-after/approval; split responsibility across payers is deferred with it. |
| 12-checkout-restrictions.md | `minorPayerPolicy`, "payment method missing", "prior payment failed", "amount due above threshold" evaluate against the **resolved payer**, not the student, in the financial (never safety) restriction category. |
| 13-database-model.md | Binding call on all shapes above, Decimal(12,2)+currency convention, the immutable-snapshot ADR carve-out, `PaymentCustomer` final shape, `NotificationKind` additions, index budget. |
| 14-migration-plan.md | DDL migration (3 enums, 2 models, additive columns, partial unique index as raw SQL) + separate idempotent backfill (`Invoice.payerId = NULL` no-op, seed fixtures); validation against fresh/seeded/multi-org fixtures. |
| 15-adr.md | Records the payer-surface security boundary (`authorizePayer()`, SELF_SERVICE_ROUTES entries), the global-User/org-scoped-payer tenancy decision, and the payer identity snapshot as part of the immutability carve-out. |

---

## 10. Out of scope for Part 1 / deferred to Parts 2–3

**Part 2 (implementation):** models + migrations, org-side payer management UI/APIs, routing resolver + review integration, snapshot fields, permissions, audit actions, seed fixtures, org-snapshot wiring, and the `authorizePayer({ mutating: true })` read-only-impersonation denial test (§7.2) in the definition of done.

**Part 3:** payer surface (`/payer`) + `authorizePayer()` routes, invitation acceptance flow, payer notifications, payer charge approval, Stripe-hosted Payment Method capture for payers, payer rows in the Import Center.

**Deferred beyond Phase 8 (explicitly, per spec):**

- Per-program / per-charge-category payer routing (future `PayerRoutingRule` model; nothing reserved for it now).
- Spending alerts and payer-configured limits.
- Split responsibility across multiple payers on one Revenue Review (with 10's split deferral).
- Payer-initiated link requests ("I'd like to pay for this student") — staff-initiated only in Phase 8.
- Email notifications to payers (no email provider; in-app only, behind the future `EMAIL_ENABLED` adapter).
- Payer-based tax exemption handling.
- Payer statements / consolidated multi-student billing documents.
- `Student.dateOfBirth`-driven automatic minor detection (see Open Questions).

---

## 11. Open questions

1. **Adult-student consent default.** Is `ORG_AUTHORITY` (staff may link a payer to an adult student, student notified) the right default, or should `STUDENT_ACKNOWLEDGE` be the default with orgs opting down? Related sub-question: should granting `fullFinancialVisibility` (§3.4/§3.9) on an adult student's relationship always require the student's acknowledgment, even under `ORG_AUTHORITY`? Privacy-forward vs. operations-forward; product owner call.
2. **Invitation email mismatch.** When the accepting account's email differs from the invited email, we currently propose accept-with-flag. Alternative: hard-block and require staff to reissue. Fraud-surface vs. friction trade-off; needs a security review verdict.
3. **Payer charge approval in Phase 8 scope.** §3.7 is designed, but shipping it in Part 3 adds a payment-lifecycle state and an expiry job dependency (no queue runtime exists). Ship in Phase 8 Part 3 or defer the approval flow entirely to Phase 9?
4. **`Student.dateOfBirth`.** Add additively to power automatic minor detection (and `minorPayerPolicy` enforcement without manual flagging), or keep minors org-asserted? DOB is training-records/PII territory beyond billing; owner decision.
5. **Permission namespace.** This doc proposes `billing.payers_*` for free module gating via `MODULE_BY_PREFIX`. If the design set adopts a distinct `revenue.*` namespace/module, that mapping must be added — needs one consistent call across all Part 1 docs (02 to arbitrate).
6. **Non-student customers.** `Invoice.studentId` is already nullable, but renters/customers without a `Student` profile have no payer linkage path in this design (relationships require a Student). Acceptable for Phase 8, or does the club/FBO business profile need payer links to plain members sooner?
