# Revenue Review Lifecycle

> **Status:** Proposed — Phase 8 Part 1 · **Date:** 2026-07-10 · **Lead roles:** Head of Product; Chief Flight Instructor; Financial UX Designer; SaaS Revenue Operations Architect · **Part of:** Revenue Engine design set ([README](./README.md))

This document is deliverable 4 of Part 1: the complete lifecycle of a **Revenue Review** — the customer-facing face of a backend **Invoice** draft. It defines the screen anatomy, the full status machine with backend enum mapping, the approval sequence and every org-configurable approval policy, approval/snapshot semantics, and void/reopen rules. Payment-side statuses are *driven by* the payment engine (doc 09); this document owns the state machine they move through.

---

## 1. Purpose & scope

### What a Revenue Review is

A Revenue Review is one flight's (or one charge event's) money, presented the way an aviation operator thinks about it: flight → time → charges → payment → allocation. Technically it is a thin, org-scoped workflow record wrapped around exactly one backend `Invoice` in `DRAFT` status. The Invoice and its `InvoiceLine` rows remain the accounting system of record (existing model names are kept — see Part L of the spec and canonical terminology in the README); the Revenue Review adds:

- the review/approval **state machine** (16 statuses, below),
- **who** submitted, requested changes, approved, and voided — with reasons,
- the **immutable approved snapshot** (frozen totals, rate provenance, payment timing),
- the link back to the `Dispatch` that generated it (duplicate-billing prevention).

One Revenue Review ↔ one Invoice (1:1, enforced). One *active* Revenue Review per Dispatch (enforced; see §5). Reviews may also exist without a dispatch (ground-only lesson, simulator session, membership fee, no-show fee, manual charge). A dispatch-less review that carries an `instructorId` — a ground lesson, for example — routes through the instructor step exactly like a dispatch review (§2.9); the instructor step is skipped only when no instructor applies (spec Part C: instructors enter their own time, dispatch or not).

### In scope for this document

- Revenue Review screen sections (Part B: flight info, time summary, charges, payment, allocation)
- Complete status machine + transition table + backend enum mapping
- Default approval sequence; all Part B approval policies incl. second approval and separation of duties
- Approval semantics (snapshot freeze; exact control wording per payment timing policy)
- Void and reopen rules, pre- and post-approval

### Out of scope (owned by sibling docs)

- How charges are *priced* — Aircraft Pricing Profile resolution and Instructor Rate Profiles (pricing and instructor-rate docs in this set; see [README](./README.md))
- Instructor time entry categories, rounding, and Hobbs-suggestion rules (instructor time doc; Part C)
- Payment Method storage, Payment Attempt execution, refunds, disputes, webhooks (payment engine, doc 09)
- Revenue Allocation and Instructor Compensation record creation (allocation/compensation docs)
- Binding column types, migrations, and the per-org number sequence ([13-database-model.md](./13-database-model.md) makes final calls; this doc states requirements)

### Governance anchors

- Draft-review creation replaces the immediate `OPEN` invoice inside the dispatch closeout transaction. That modifies the ADR-011 pattern (do-not-break rule 5), so the Part 1 ADR proposal (ADR-025 in this set) supersedes ADR-011's invoice clause **before any code lands**. The closeout transaction stays atomic; only *what it creates financially* changes (a `DRAFT` Invoice + Revenue Review instead of an `OPEN` Invoice).
- No Stripe or other external call ever runs inside a database transaction. Charging happens post-approval, post-commit, via the payment engine (doc 09).
- Spec Part A/B says "aircraft check-in"; AVIATION_STANDARDS.md bans "check-in" in UI copy. This doc (and all UI copy) uses **aircraft return / return closeout**. The operational checkout doc in this set owns the terminology resolution; the mapping is 1:1.

---

## 2. How it works

### 2.1 Anatomy of a Revenue Review (screen sections, Part B)

Every Revenue Review renders five sections. "Editable until" refers to review status; **nothing is editable after Approved** (corrections then go through adjustment/refund records — see §6.4).

#### Flight information

| Field | Source | Editable |
|---|---|---|
| Date | `Dispatch.closedAt` (return closeout) | Never |
| Location | Dispatch/ScheduleEvent location | Never |
| Aircraft | `Dispatch.aircraftId` (tail number) | Never |
| Student/customer | `Dispatch.studentId` → Student/User | Never |
| Instructor | `Dispatch.instructorId` | Never |
| Program | Student's program/syllabus enrollment | Never |
| Lesson | ScheduleEvent / LessonType | Never |
| Dispatch reference | `RevenueReview.dispatchId` (deep link) | Never |

Operational facts are read-only on the review by design — they are corrected on the operational record via the permission-gated, audited **meter-correction action on the dispatch** ([02-operational-dispatch-and-closeout.md](./02-operational-dispatch-and-closeout.md)), which re-derives the draft review's priced lines. Post-approval, meter corrections never touch the review: they route through adjustment records instead ([08-adjustments-discounts-credits.md](./08-adjustments-discounts-credits.md)). Manual (dispatch-less) reviews show only the applicable rows.

#### Time summary

| Field | Source | Editable |
|---|---|---|
| Hobbs Out / Hobbs In / Hobbs elapsed | Dispatch meters | Never (operational fact) |
| Tach Out / Tach In / Tach elapsed | Dispatch meters | Never (operational fact) |
| Instructor flight time | Instructor time entry (suggested from Hobbs; Part C rules) | Until Approved¹ |
| Ground instruction time | Instructor time entry | Until Approved¹ |
| Briefing time / Debriefing time | Instructor time entry | Until Approved¹ |
| Simulator time | Instructor time entry | Until Approved¹ |
| Other instructional time | Instructor time entry (custom categories) | Until Approved¹ |

¹ Instructors edit their own time until they submit; after submission only users with `revenue.time_override` (defined in doc 04 §6) may override, and every override requires a reason and is audited (Part C).

#### Charges

Line items are `InvoiceLine` rows on the wrapped draft Invoice, generated by pricing resolution and by Revenue Items, plus manual additions. The section shows, per line: description, kind/Revenue Item, quantity, unit price, line total, tax treatment, and provenance (which Aircraft Pricing Profile / Instructor Rate Profile / Revenue Item produced it — the explainable-engine rule).

Charge rows the section must support (Part B, verbatim): aircraft rental · instructor flight instruction · instructor ground instruction · simulator instruction · airport fee · landing fee · ramp fee · parking · fuel surcharge · oil · training materials · books · headset rental · checkride preparation · stage check · discovery flight fee · membership fee · cancellation/no-show fee · taxes · discounts · credits · custom line items.

Footer: subtotal → discounts/credits → tax → **total**, in the review's single explicit currency. All arithmetic is server-side Decimal; the client never supplies a price or total.

#### Payment

| Field | Source | Notes |
|---|---|---|
| Responsible payer | Payer resolution (responsible payer doc, Part K) | Warn when missing |
| Payment timing policy | Org policy (doc 09); snapshotted at approval | Shows *effective* policy pre-approval, *snapshotted* policy after |
| Default payment method | Payer's saved Payment Method reference (doc 09) | Provider reference only — never card/bank data |
| Card or ACH | Method type of the selected Payment Method | — |
| Payment readiness | Computed: `READY` / `READY_WITH_WARNINGS` / `NOT_READY` + reasons (doc 09 §5.2 evaluator — canonical vocabulary) | Explainable — every state carries its reasons |
| Missing-payment warnings | Readiness reasons (no payer, no saved method, prior failure) | Warning by default; org may make blocking via `approveWithoutMethod = BLOCK` (doc 09; §5) |

#### Allocation

Pre-approval this is a **preview**; at approval it is snapshotted; actual Revenue Allocation and Instructor Compensation records are written by the allocation engine at financial closeout (allocation/compensation docs).

Rows: aircraft revenue · instructor-service revenue · airport/landing fees · fuel revenue · tax · platform fee · school retained revenue · instructor compensation · other allocations.

Visibility: the Allocation section (and instructor compensation figures in it) requires `revenue.allocation_view`; instructors see their own compensation line only if the org enables it (§3).

### 2.2 Status machine

Canonical customer-facing statuses (spec Part B, verbatim) and their backend enum values. New Prisma enum `RevenueReviewStatus`; every status also gets a `STATUS_TONE` entry in `src/lib/status-colors.ts` (single-source rule).

| # | Customer-facing status | `RevenueReviewStatus` value | Invoice.status projection² | Written by |
|---|---|---|---|---|
| 1 | Draft | `DRAFT` | `DRAFT` | Review engine |
| 2 | Awaiting Instructor Review | `AWAITING_INSTRUCTOR_REVIEW` | `DRAFT` | Review engine |
| 3 | Awaiting Operations Review | `AWAITING_OPERATIONS_REVIEW` | `DRAFT` | Review engine |
| 4 | Changes Requested | `CHANGES_REQUESTED` | `DRAFT` | Review engine |
| 5 | Approved | `APPROVED` | `OPEN` | Review engine |
| 6 | Payment Scheduled | `PAYMENT_SCHEDULED` | `OPEN` | Payment engine (doc 09) |
| 7 | Payment Processing | `PAYMENT_PROCESSING` | `OPEN` | Payment engine (doc 09) |
| 8 | Card Paid | `CARD_PAID` | `PAID` | Payment engine (doc 09) |
| 9 | ACH Pending | `ACH_PENDING` | `OPEN` | Payment engine (doc 09) |
| 10 | Paid | `PAID` | `PAID` | Payment engine (doc 09) |
| 11 | Payment Failed | `PAYMENT_FAILED` | `OPEN` (→ `OVERDUE` derived) | Payment engine (doc 09) |
| 12 | Partially Refunded | `PARTIALLY_REFUNDED` | `PARTIALLY_REFUNDED`³ | Payment engine (doc 09) |
| 13 | Refunded | `REFUNDED` | `REFUNDED`³ | Payment engine (doc 09) |
| 14 | Voided | `VOIDED` | `VOID` | Review engine |
| 15 | Disputed | `DISPUTED` | `DISPUTED`³ | Payment engine (doc 09) |
| 16 | Written Off *(future only)* | `WRITTEN_OFF` | *(future)* | *(no writer in Parts 2–3)* |

² `Invoice.status` becomes a coarse **projection** of the review status, maintained by the review/payment engines in the same transaction as the review transition. Legacy invoices with no Revenue Review keep today's behavior untouched (existing seed fixtures, Import Center, simulation, and the manual payments route stay valid — spec Part L). Partial manual payments against an `APPROVED` review set the Invoice to `PARTIALLY_PAID` while the review stays `Approved`; `OVERDUE` stays a derived/legacy notion and is never a review status.

³ `PARTIALLY_REFUNDED`, `REFUNDED`, and `DISPUTED` are proposed **additive** `InvoiceStatus` values (each new enum value ships in its own migration before use — DATABASE_STANDARDS.md). Final call in [13-database-model.md](./13-database-model.md); the fallback projection if they are rejected is `PAID`/`VOID` with the truth carried by the review status.

`WRITTEN_OFF` is reserved in the enum from day one (avoids a later enum migration) but **no transition writes it in Parts 2–3**.

### 2.3 Transition table

All review-engine transitions execute as a guarded `updateMany` claim (`where: { id, status: <expected> }`, `count === 0` → 409) inside a `db.$transaction`, mirroring the proven dispatch-closeout idempotency pattern. Payment-engine transitions (doc 09) use the same claim pattern keyed additionally by Payment Attempt identity, so a replayed webhook cannot move a review twice.

| From | To | Who / what triggers | Side effects (same tx unless noted) |
|---|---|---|---|
| — | Draft | **System**: return closeout tx (operational checkout doc) creates the review; **System**: a completed instruction-only `ScheduleEvent` with no dispatch (ground lesson, simulator session) auto-creates a draft review carrying the `instructorId` (§2.9); or staff — or an instructor, scoped to their own completed sessions (§2.9) — with `revenue.review_create` creates a manual review | `DRAFT` Invoice + `InvoiceLine`s generated via pricing resolution; review number allocated; payer + payment readiness resolved; post-commit: `recordAudit('revenue_review.created')`, `emitDomainEvent('revenue_review.created')`, notification to instructor if applicable |
| Draft | Awaiting Instructor Review | **System**, immediately after creation, when the review carries an `instructorId` (from a dispatch **or** dispatch-less — ground/sim, §2.9) and policy `instructorSubmissionRequired` is on | Instructor notification ("confirm your time") |
| Draft | Awaiting Operations Review | **System** when no instructor step applies (solo/rental, a manual review with no `instructorId`, or `instructorSubmissionRequired` off); or staff with `revenue.review_submit` submits | Risk flags computed (§2.5); audit + `revenue_review.submitted` event |
| Awaiting Instructor Review | Awaiting Operations Review | **Instructor** (`revenue.review_submit`) submits after entering/confirming time; or staff with `revenue.review_edit` submits on the instructor's behalf (reason required) | `submittedAt`/`submittedById`; risk flags computed; audit + event; approver-queue notification |
| Awaiting Instructor Review | Approved | **Instructor** holding `revenue.approve_routine`, only when policy `instructorMayApproveRoutine` is on AND the review is *routine* (§2.5) | Full approval side effects (§2.6) |
| Awaiting Operations Review | Changes Requested | **Approver** (`revenue.approve`), reason required; may optionally tag the specific time entries/lines the reason concerns (ids stored with the reason — `changesRequestedTargetIds`) | `changesRequestedAt/ById/Reason` + target ids; instructor notification; tagged items highlighted in the instructor's Changes Requested view; audit `revenue_review.changes_requested` + event |
| Changes Requested | Awaiting Operations Review | **Instructor** (`revenue.review_submit`) or staff (`revenue.review_edit`) corrects and resubmits | Risk flags recomputed; audit + event; queue card gains a **Resubmitted after changes** chip showing the prior reason and what was edited since (derived from existing audit rows — no new storage) |
| Awaiting Operations Review | Awaiting Operations Review *(no transition)* | **Approver** actions "Save draft" (persist edits, stay in queue) and "Escalate for second approval" (records first approval, sets `secondApprovalRequired`) | Edits audited; escalation audited; in-app Notification to every other holder of the missing kind's permission (§2.7); review remains awaiting the missing approval kind(s) |
| Awaiting Operations Review | Approved | **Approver** (`revenue.approve`; `revenue.approve_finance` for the FINANCE kind) once **all required approval kinds** are recorded; separation-of-duties checks pass (§2.8) | Full approval side effects (§2.6) |
| Draft / Awaiting Instructor Review / Awaiting Operations Review / Changes Requested | Voided | **Staff** with `revenue.void`, reason required (pre-approval void) | Invoice → `VOID`; dispatch link retained; regeneration permitted (§6.5); audit `revenue_review.voided` + event |
| Approved | Payment Scheduled | **System** (payment engine) when snapshotted timing policy is a batch or custom date | `scheduledChargeAt` set from policy |
| Approved | Payment Processing | **System** (payment engine) under charge-immediately policy, post-commit of approval; or human "Charge now" (`revenue.charge`) | Payment Attempt created (doc 09) |
| Approved | Paid | **Staff** (`billing.record_payments`) records full manual payment (manual-charge/manual-invoice policies; cash/check) | `Payment` row; Invoice → `PAID`; audit; receipt event |
| Approved / Payment Scheduled / Payment Failed | Voided | **Staff** with `revenue.void`, reason required — only while **no Payment Attempt has succeeded or is in flight AND nothing has been collected**: Σ settled `Payment` rows against the Invoice (including offline cash/check and `ACCOUNT_CREDIT` payments, which create `Payment` rows with no Payment Attempt) must be 0 (§6.4) | Scheduled charge cancelled; Invoice → `VOID`; audit + event |
| Payment Scheduled | Payment Processing | **System** (batch runner, doc 09) at `scheduledChargeAt`; or human "Charge now" (`revenue.charge`) | Payment Attempt created |
| Payment Processing | Card Paid | **Payment engine**: card charge succeeded | Payment/PaymentTransaction recorded; Invoice → `PAID`; receipt; allocation handoff |
| Payment Processing | ACH Pending | **Payment engine**: ACH debit accepted, awaiting settlement | — |
| Payment Processing | Payment Failed | **Payment engine**: decline, error, or timeout reconciliation | Failure reason stored on Payment Attempt; notifications; dunning per doc 09 |
| ACH Pending | Paid | **Payment engine**: ACH settlement confirmed (webhook) | Invoice → `PAID`; receipt; allocation handoff |
| ACH Pending | Payment Failed | **Payment engine**: ACH return | As payment-failed above |
| Card Paid | Paid | **Payment engine**: settlement/reconciliation confirms the transaction | Reconciliation record (doc 09) |
| Payment Failed | Payment Processing | **Human** retry (`revenue.charge`) or configured automatic retry (doc 09) | New Payment Attempt (never reuses a failed one) |
| Payment Failed | Payment Scheduled | **Staff** (`revenue.charge`) reschedules | New `scheduledChargeAt` |
| Payment Failed | Paid | **Staff** (`billing.record_payments`) records full manual payment | As manual-paid above |
| Card Paid / Paid | Partially Refunded | **Staff**-initiated refund (`revenue.refund`, doc 09; second approval per policy §3) for less than the total | Refund record; Invoice → `PARTIALLY_REFUNDED` |
| Partially Refunded | Partially Refunded *(self)* | Additional partial refund | Cumulative refund tracking |
| Partially Refunded | Refunded | Refunds reach the approved total | Invoice → `REFUNDED` |
| Card Paid / Paid | Refunded | Full refund | Invoice → `REFUNDED` |
| Card Paid / Paid / Partially Refunded | Disputed | **System**: provider dispute webhook (doc 09) | `Dispute` record; org notification; audit |
| Disputed | Paid | **Payment engine**: dispute closed in org's favor | Dispute resolution recorded |
| Disputed | Refunded / Partially Refunded | **Payment engine**: dispute lost (chargeback, full/partial) | Chargeback recorded as refund-equivalent |
| *(any)* | Written Off | *(future — no writer in Parts 2–3)* | — |

**Terminal statuses:** `VOIDED`, `REFUNDED` (and future `WRITTEN_OFF`). `PAID` is terminal except for refund/dispute paths.

### 2.4 Default approval sequence (spec Part B)

1. Aircraft return closeout creates the **Draft** Revenue Review (inside the operational closeout transaction — the review/draft-invoice writes are DB-only and fast; no external calls).
2. Instructor enters or confirms instruction time (Part C rules; Hobbs *suggests*, never silently determines).
3. Instructor submits the review → **Awaiting Operations Review**.
4. A configured approver — anyone holding `revenue.approve` (Operations Director, Chief Flight Instructor, Chief Pilot ship as OrgRole templates carrying it) — reviews it.
5. The approver may: **Approve and charge** · **Request changes** · **Save draft** · **Escalate for second approval** · **Void** (if appropriate).
6. Approval locks the approved financial snapshot (§2.6).
7. Payment is initiated according to the org's payment timing policy, as snapshotted on the review (doc 09).

Ground-only and simulator sessions follow the same sequence from step 2 — the review is created by one of §2.9's paths instead of step 1's return closeout.

### 2.5 "Routine" reviews and risk flags

At every submission the engine computes and stores `riskFlags` (queue filtering + second-approval logic + audit):

| Flag | Set when |
|---|---|
| `MANUAL_ITEM` | Any manually added line item |
| `DISCOUNT` | Any discount, credit, or fee waiver line |
| `DAMAGE_FEE` | Any Revenue Item categorized damage (or flagged `requiresSecondApproval`) |
| `OVER_THRESHOLD` | Total > `secondApprovalAmountThreshold` |
| `TIME_OVERRIDE` | Instructor time overridden post-submission, or outside the configured Hobbs tolerance (Part C) |
| `MISSING_PAYER` / `MISSING_PAYMENT_METHOD` | Payment readiness reasons |

A review is **routine** iff it was system-generated (from a dispatch, or auto-created from a completed instruction-only `ScheduleEvent` — §2.9), has *no* risk flags, and its total is ≤ `routineApprovalMaxAmount` (when set). Staff-created manual reviews are never routine. Only routine reviews are eligible for instructor self-approval (§3) and for bulk approval (§2.10).

### 2.6 Approval semantics — the immutable snapshot

Approval is the moment financial history becomes fact. In **one** `db.$transaction`:

1. **Claim**: guarded `updateMany` from the expected status to `APPROVED`; zero rows → 409 ("already approved or changed"). The request must also carry the review's `updatedAt` token and the total the approver saw (`expectedTotal`); a mismatch → 409 "This review changed since you loaded it — reload before approving." A stale screen can never approve unseen numbers.
2. **Recompute**: totals recomputed server-side in Decimal from the `InvoiceLine` rows (client-supplied figures are never trusted).
3. **Freeze**: `subtotal`, `taxTotal`, `total`, `currency`, `approvedAt` written onto the Invoice; Invoice `DRAFT` → `OPEN`. From this instant the Invoice's lines and totals are immutable (engine-enforced: no route mutates lines of an approved invoice; corrections are adjustment records — Part H doc).
4. **Snapshot**: `approvalSnapshot` (Json) written on the review — full line breakdown with rate provenance (Aircraft Pricing Profile / Instructor Rate Profile ids + versions), tax snapshot reference, payer, selected Payment Method reference, allocation preview, and payment timing policy. This is a **point-in-time financial fact**, not a computed cache — the explicit carve-out from DATABASE_STANDARDS.md's derive-at-read rule, recorded in the ADR proposal.
5. **Record approvals**: the final `RevenueReviewApproval` row (§2.7), `approvedAt`/`approvedById` on the review, `paymentPolicyAtApproval` + `scheduledChargeAt` snapshotted. Changing org policy later never alters an approved review (spec Part I).
6. **Post-commit** (never inside the tx): `recordAudit('revenue_review.approved')`, `emitDomainEvent('revenue_review.approved')`, payment engine handoff per the snapshotted timing policy.

**Approve control wording** (principle 2 — financial consequence must be explicit). The primary control's label states exactly what happens, driven by the effective timing policy:

| Timing policy (doc 09) | Control label |
|---|---|
| Charge immediately after approval | `Approve Revenue Review and charge the saved payment method` *(verbatim, required)* |
| Same-day batch | `Approve Revenue Review and schedule payment for today's batch` |
| Nightly batch | `Approve Revenue Review and schedule payment for tonight's batch` |
| Weekly batch | `Approve Revenue Review and schedule payment for the weekly batch` |
| ACH-only batch | `Approve Revenue Review and schedule payment for the next ACH batch` |
| Custom future date | `Approve Revenue Review and schedule payment for {date}` |
| Manual charge | `Approve Revenue Review — payment will be charged manually` |
| Manual invoice | `Approve Revenue Review and issue the invoice for manual payment` |

The label always names the consequence; a bare "Approve" button is a design failure.

### 2.7 Second and finance approvals

Escalated approval never adds statuses; it adds **approval records**. `RevenueReviewApproval` rows are append-only, at most one **active** (non-superseded) row per kind per review:

| Kind | Recorded by | Required when |
|---|---|---|
| `INSTRUCTOR_ROUTINE` | Instructor self-approving a routine review | Substitutes for `OPERATIONS` under that policy only |
| `OPERATIONS` | First approver (`revenue.approve`) | Always, when `operationsApprovalRequired` |
| `SECOND` | A **different** user with `revenue.approve` | Any second-approval trigger fires (§3) or first approver escalates |
| `FINANCE` | User with `revenue.approve_finance` | `financeApprovalRequired` is on |

The review transitions to `APPROVED` only when every required kind is present. Until then it stays `Awaiting Operations Review`, with the queue showing which approvals are still missing ("Awaiting second approval — total exceeds $2,500"). Refund second approvals reuse the same policy switches but execute in the refund flow (doc 09).

A recorded **adjustment-level** second approval ([08-adjustments-discounts-credits.md](./08-adjustments-discounts-credits.md) §3.1) satisfies the review-level `SECOND` kind for that adjustment — one second approval per corrected number, never two ceremonies for the same discount.

**Missing-kind notification.** Whenever a required `SECOND` or `FINANCE` kind is missing — on an explicit escalation or on a policy trigger at submission — the engine emits an in-app Notification to every holder of `revenue.approve` (`revenue.approve_finance` for the `FINANCE` kind) **other than** the recorded `OPERATIONS` approver. The ops queue splits into **needs my approval** and **awaiting another approver**, so an escalated review is actively surfaced rather than waiting for a second approver to happen upon it.

**Approval invalidation.** A recorded approval binds to the numbers its approver saw. Any financial change made after an approval kind is recorded — a line add/edit, an instructor-time override, a staged adjustment (Part H doc), or a transition to Changes Requested — stamps `supersededAt` on every existing `RevenueReviewApproval` row of the review, and the engine re-requires **every** required kind against the corrected numbers. Rows are never deleted or otherwise mutated (append-only history); superseding is a stamped marker, recorded in the audit entry of the change that caused it. Uniqueness is therefore per *active* approval — a raw-SQL partial unique index on `(revenueReviewId, kind) WHERE "supersededAt" IS NULL` (binding SQL and name in [13-database-model.md](./13-database-model.md) §4.4) — so a fresh approval of the corrected numbers can be recorded. The final approval claim's `updatedAt`/`expectedTotal` check (§2.6) protects the last step; this rule protects every earlier recorded kind from ending up attached to numbers its approver never saw.

### 2.8 Separation of duties (spec Part B, mandatory rule)

When `separationOfDutiesRequired` is on (default **on**):

- **No one approves their own high-risk manual adjustment**: a user may not record `OPERATIONS`, `SECOND`, or `FINANCE` approval on a review where they are the recorded actor of any line carrying `DAMAGE_FEE` or `TIME_OVERRIDE` risk flags (unconditional), or `MANUAL_ITEM` / `DISCOUNT` flags **when the adjustment is policy-triggered** — over the doc 08 thresholds (`discountSecondApprovalPercent` / `discountSecondApprovalAmount`, §3) or an always-second-approval kind. This deliberately mirrors doc 08 §3.1's binding precedence note ([08-adjustments-discounts-credits.md](./08-adjustments-discounts-credits.md)): below-threshold, non-high-risk adjustments may auto-approve for the same person; policy-triggered ones never. The same policy-triggered scoping applies wherever this section references the `MANUAL_ITEM` and `DISCOUNT` flags. (Adjustment records carry `actorUserId` — Part H doc — which is what the engine compares.)
- `SECOND` approval must come from a different user than `OPERATIONS` — enforced unconditionally, not just by policy.
- The submitting instructor cannot record the `OPERATIONS` approval on a **risk-flagged** review (`MANUAL_ITEM`, `DISCOUNT`, `DAMAGE_FEE`, or `TIME_OVERRIDE` — the spec's separation-of-duties requirement is the high-risk manual adjustment, not every routine review). On an unflagged review, a submitting instructor who also holds `revenue.approve` may approve it; the UI warns and the audit record notes the self-approval (the `instructorMayApproveRoutine` path remains the purpose-built route for this).

**Single-approver relaxation.** When the organization has exactly one user holding `revenue.approve`, the self-approval blocks above (first and third bullets) auto-relax instead of deadlocking: the engine permits the approval, records it as an audit-flagged self-approval, and the review keeps its risk flags for reporting — mirroring doc 04's solo-CFI `allowRateSelfApproval` posture. The relaxation extends to **policy-triggered `SECOND` approvals** (refunds, discounts over the doc 08 thresholds, large credit issues): when exactly one user holds `revenue.approve`, that user may record the `SECOND` kind atop their own `OPERATIONS` approval, and the approval is audit-flagged `SELF_APPROVED_SOLE_USER` — mirroring D18's carve-out, so a solo owner's first refund is a flagged act, not a hard stop. HIGH-risk items keep D18's evidence floor: an org with exactly one human may bill HIGH-risk items (damage fees) only via the **audited sole-user exception** — mandatory attachment + reason, `SELF_APPROVED_SOLE_USER` audit flag — per [06-revenue-items.md](./06-revenue-items.md). `FINANCE` remains never self-satisfiable: it is opt-in, and the settings UI refuses to enable `financeApprovalRequired` when no second eligible approver exists. This base case is recorded as an explicit P1 decision in the decision register (doc 16 §2.2); D17/D18 there are being extended to record this relaxation family explicitly.

Violations are hard 403s with the reason ("Separation of duties: you added the damage fee on this review"). When the policy is off, the UI still warns and the audit record notes the self-approval.

### 2.9 Ground-only and dispatch-less instructor reviews

Spec Part C — "instructors enter their own time" — holds whether or not an aircraft moved. A ground lesson or simulator session produces no dispatch, but it still produces instructor time and a Revenue Review, and the instructor must be able to reach it. Two creation paths:

1. **Auto-creation (default path).** A completed instruction-only `ScheduleEvent` with no dispatch (ground lesson, simulator session) auto-creates a Draft review carrying the event's `instructorId`, `studentId`, and `locationId` — same creation side effects as the closeout path (§2.3 row 1).
2. **Instructor-initiated manual creation.** The INSTRUCTOR permission bundle carries a **scoped** `revenue.review_create`: instructors may create a manual review only for their own completed sessions (engine-scoped, like `revenue.review_view`'s own-reviews scope — §6.1). Staff creation (`revenue.review_create`, unscoped) is unchanged.

Flow: when the review carries an `instructorId` and `instructorSubmissionRequired` is on, it moves Draft → **Awaiting Instructor Review** exactly like a dispatch review (§2.3). In that status the **assigned instructor holds time-entry rights**: they enter ground/briefing/sim time directly (no Hobbs suggestion — there are no meters), under the same Part C rules; post-submission overrides still require `revenue.time_override` + reason (doc 04 §6). Doc 04's editability matrix is aligned to grant the assigned instructor time entry in Awaiting Instructor Review for these reviews. The Flight information section shows only the applicable rows (§2.1); everything else — risk flags, approvals, separation of duties — is identical.

### 2.10 Routine bulk approval

At real volumes (30 reviews/day) opening every flag-free review is queue torture, not control. The queue therefore offers **approve-from-card** and **bulk approve** for reviews that are **routine per §2.5 only**:

- The server recomputes and claims **each review individually** with its own `updatedAt` token and `expectedTotal` (§2.6 semantics, per review — never one aggregate claim). A single stale or changed review 409s alone and stays in the queue with its reason; the rest proceed.
- The control carries an **aggregate consequence label**, e.g. `Approve 12 routine Revenue Reviews — $4,310.00 will be charged to saved payment methods` (wording tracks the effective timing policy, §2.6). A bare "Approve all" is a design failure for the same reason a bare "Approve" is.
- **Risk-flagged reviews always require opening the review** — they are excluded from bulk selection and render no approve-from-card control.

### 2.11 Queue aging, reminders, and instructor-review escalation

One creation-time notification is not a workflow — unbilled money must never pool silently behind a forgetful instructor:

- **Age is visible.** Review queues default to **oldest-first** and every card shows a days-in-status age chip.
- **Reminder, then escalation.** After `instructorReviewReminderHours` (org-configurable, default 48) in Awaiting Instructor Review, the engine re-notifies the instructor; after a second interval the review also surfaces in the operations queue flagged "overdue instructor review".
- **Submit on the instructor's behalf.** The ops queue offers a one-click "Submit on instructor's behalf (reason required)" action wired to `revenue.review_edit` — the same transition as §2.3, surfaced where the bottleneck is visible.

---

## 3. Configuration surface

One `RevenueWorkflowPolicy` row per organization (created lazily with defaults; together with the single-approver relaxation in §2.8, the defaults below let any school — including a solo owner-CFI who is both submitter and only approver — run with **zero setup**, product principle 10). Edited via a zod-validated PATCH route with before/after `recordAudit`, following the org-settings template.

| Option | Field | Default | Effect |
|---|---|---|---|
| Instructor submission step | `instructorSubmissionRequired Boolean` | `true` | Dispatch reviews with an instructor go to Awaiting Instructor Review first; off = straight to operations queue |
| Instructor may approve routine reviews | `instructorMayApproveRoutine Boolean` | `false` | Enables the `AWAITING_INSTRUCTOR_REVIEW → APPROVED` path for routine reviews (§2.5) |
| Routine approval cap | `routineApprovalMaxAmount Decimal(12,2)?` | `null` (no cap) | Reviews above this total are never routine |
| Operations approval always required | `operationsApprovalRequired Boolean` | `true` | Off only makes sense together with instructor routine approval; at least one approval kind is always required — the engine refuses a configuration with zero approvers |
| Second approval above a dollar threshold | `secondApprovalAmountThreshold Decimal(12,2)?` | `null` (off) | Sets `OVER_THRESHOLD`; requires `SECOND` approval |
| Second approval for manual line items | `secondApprovalForManualItems Boolean` | `false` | `MANUAL_ITEM` flag requires `SECOND` approval |
| Second approval for discounts — percent threshold | `discountSecondApprovalPercent Decimal(5,2)` | `10.00` | Discounts/waivers above this % of the pre-tax review total make the `DISCOUNT` flag require `SECOND` approval (threshold semantics owned by doc 08 §4) |
| Second approval for discounts — amount threshold | `discountSecondApprovalAmount Decimal(12,2)` | `250.00` | …or above this absolute amount — whichever trips first. This threshold pair is the **single** discount second-approval mechanism (it replaces an earlier `secondApprovalForDiscounts` boolean; docs 08 and 13 carry the same resolution) |
| Second approval for damage fees | `secondApprovalForDamageFees Boolean` | `true` | `DAMAGE_FEE` flag requires `SECOND` approval (high-risk default on) |
| Second approval for refunds | `secondApprovalForRefunds Boolean` | `true` | Enforced in the refund flow (doc 09) |
| Separate finance approval | `financeApprovalRequired Boolean` | `false` | Adds required `FINANCE` kind (`revenue.approve_finance`) |
| Separation of duties | `separationOfDutiesRequired Boolean` | `true` | §2.8 rules become hard blocks |
| Instructors see own compensation on reviews | `instructorSeesOwnCompensation Boolean` | `false` | Gates the compensation row of the Allocation section for instructors |
| Instructor review reminder | `instructorReviewReminderHours Int?` | `48` | Hours in Awaiting Instructor Review before the reminder/escalation cycle fires (§2.11); `null` disables |

Payment timing policy, payment readiness blocking, and dunning/retry configuration live with the payment engine (doc 09) and the checkout-restrictions doc (Part J); this table intentionally excludes them. Whatever timing policy is effective at approval is snapshotted here (§2.6).

**Solo-operator first run.** When exactly one user holds `revenue.approve`, the settings surface shows a first-run nudge to enable `instructorMayApproveRoutine` (enabling it auto-grants `revenue.approve_routine` to the enabling role), and routine reviews render a combined, audit-flagged **Submit and approve** control under §2.8's single-approver relaxation — the solo owner-CFI handles each flight in one action instead of ping-ponging between "submit as instructor" and "approve as operations" forever.

Approver identity is **not** configured by role name: "configured approver" means "holders of `revenue.approve` in this org," shaped via OrgRole permission bundles (data-driven RBAC). Shipped OrgRole templates — Operations Director, Chief Flight Instructor, Chief Pilot — carry `revenue.approve` out of the box.

---

## 4. Data model proposal

Prisma-flavored; binding types/precision/index decisions land in [13-database-model.md](./13-database-model.md). Money is `Decimal(12,2)` + ISO 4217 `currency` per the design set's default recommendation. All models follow schema-governance: real Organization FK with explicit `onDelete`, tenant-scoped uniques, `createdAt`, org-leading indexes. All three new models must be added to `org-snapshot.ts` capture/wipe/restore (financial children delete before Invoice) and to seed fixtures for both seeded orgs.

```prisma
enum RevenueReviewStatus {
  DRAFT
  AWAITING_INSTRUCTOR_REVIEW
  AWAITING_OPERATIONS_REVIEW
  CHANGES_REQUESTED
  APPROVED
  PAYMENT_SCHEDULED
  PAYMENT_PROCESSING
  CARD_PAID
  ACH_PENDING
  PAID
  PAYMENT_FAILED
  PARTIALLY_REFUNDED
  REFUNDED
  VOIDED
  DISPUTED
  WRITTEN_OFF // reserved — no writer in Parts 2–3
}

enum RevenueApprovalKind {
  INSTRUCTOR_ROUTINE
  OPERATIONS
  SECOND
  FINANCE
}

model RevenueReview {
  id             String              @id @default(cuid())
  organizationId String
  number         String              // "RR-<seq>" from the per-org sequence (13-database-model.md)
  status         RevenueReviewStatus @default(DRAFT)
  currency       String              @default("USD") @db.Char(3)

  invoiceId    String  @unique       // the wrapped backend Invoice (1:1, required)
  dispatchId   String?               // null for manual reviews; active-uniqueness via partial index (§5)
  studentId    String?
  payerId      String?               // ResponsiblePayer (Part K doc)
  instructorId String?
  locationId   String?

  riskFlags              String[]    // MANUAL_ITEM | DISCOUNT | DAMAGE_FEE | OVER_THRESHOLD | TIME_OVERRIDE | ...
  secondApprovalRequired Boolean     @default(false)

  submittedAt            DateTime?
  submittedById          String?
  changesRequestedAt     DateTime?
  changesRequestedById   String?
  changesRequestedReason String?
  changesRequestedTargetIds String[]  // optional: line/time-entry ids the reason concerns (§2.3)
  approvedAt             DateTime?
  approvedById           String?
  approvalSnapshot       Json?       // point-in-time financial fact (§2.6), never recomputed
  totalAtApproval        Decimal?    @db.Decimal(12, 2)
  paymentPolicyAtApproval PaymentTimingPolicy? // enum owned by doc 09
  scheduledChargeAt      DateTime?
  voidedAt               DateTime?
  voidedById             String?
  voidReason             String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  organization Organization            @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  invoice      Invoice                 @relation(fields: [invoiceId], references: [id], onDelete: Restrict)
  dispatch     Dispatch?               @relation(fields: [dispatchId], references: [id], onDelete: SetNull)
  approvals    RevenueReviewApproval[]

  @@unique([organizationId, number])
  @@index([organizationId, status])                      // review queues
  @@index([organizationId, createdAt])                   // org/date reporting
  @@index([organizationId, status, scheduledChargeAt])   // batch pickup (doc 09)
  @@index([instructorId, status])                        // "My Revenue Reviews" queue
  @@index([dispatchId])
}

model RevenueReviewApproval {
  id              String              @id @default(cuid())
  organizationId  String
  revenueReviewId String
  kind            RevenueApprovalKind
  approverUserId  String?             // FK SetNull; comparison basis for separation of duties
  approverLabel   String              // denormalized display name — survives user deletion
  note            String?
  supersededAt    DateTime?           // stamped when a later financial change invalidates this approval (§2.7); never cleared
  createdAt       DateTime @default(now())

  organization Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  review       RevenueReview @relation(fields: [revenueReviewId], references: [id], onDelete: Cascade)
  approver     User?         @relation(fields: [approverUserId], references: [id], onDelete: SetNull)

  // One ACTIVE approval per kind — raw-SQL partial unique index, Prisma cannot express it
  // (binding SQL and name in 13-database-model.md §4.4):
  //   UNIQUE ON ("revenueReviewId", "kind") WHERE "supersededAt" IS NULL
  @@index([revenueReviewId, kind])
  @@index([organizationId, createdAt])
}

model RevenueWorkflowPolicy {
  id                            String   @id @default(cuid())
  organizationId                String   @unique
  instructorSubmissionRequired  Boolean  @default(true)
  instructorMayApproveRoutine   Boolean  @default(false)
  routineApprovalMaxAmount      Decimal? @db.Decimal(12, 2)
  operationsApprovalRequired    Boolean  @default(true)
  secondApprovalAmountThreshold Decimal? @db.Decimal(12, 2)
  secondApprovalForManualItems  Boolean  @default(false)
  discountSecondApprovalPercent Decimal  @default(10.00) @db.Decimal(5, 2)
  discountSecondApprovalAmount  Decimal  @default(250.00) @db.Decimal(12, 2)
  secondApprovalForDamageFees   Boolean  @default(true)
  secondApprovalForRefunds      Boolean  @default(true)
  financeApprovalRequired       Boolean  @default(false)
  separationOfDutiesRequired    Boolean  @default(true)
  instructorSeesOwnCompensation Boolean  @default(false)
  instructorReviewReminderHours Int?     @default(48)   // §2.11 reminder/escalation; null disables

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
}
```

**Modified existing models** (additive; binding call in [13-database-model.md](./13-database-model.md)):

| Model | Change required by this design |
|---|---|
| `Invoice` | Add `currency Char(3)`, `subtotal`/`taxTotal`/`total Decimal(12,2)?` (null until approval — snapshot columns, not caches), `approvedAt DateTime?`, `updatedAt @updatedAt`, `revenueReview RevenueReview?` back-relation. Additive `InvoiceStatus` values `PARTIALLY_REFUNDED`, `REFUNDED`, `DISPUTED` (each in its own migration before use). Existing rows and consumers keep working — every new column nullable, no reinterpretation of existing statuses. |
| `InvoiceLine` | No new fields required by this doc (rate-provenance/source columns belong to the pricing and Revenue Item docs). New rule: lines of an approved invoice are never mutated — engine-enforced. |
| `Dispatch` | `revenueReviews RevenueReview[]` back-relation only. (`organizationId` + backfill and return-capture fields are owned by the operational checkout doc and 13-database-model.md.) |
| `Payment` | Untouched here; the payment engine (doc 09) owns Payment/PaymentAttempt/Refund changes, including moving off `onDelete: Cascade`. |

**Partial unique index** (raw SQL in the DDL migration — Prisma cannot express it):

```sql
CREATE UNIQUE INDEX "RevenueReview_dispatch_active_key"
  ON "RevenueReview" ("dispatchId")
  WHERE status <> 'VOIDED';
```

(Canonical SQL — matches [13-database-model.md](./13-database-model.md) §4.4/R4 and the migration plan M9 verbatim; NULL `dispatchId` rows are distinct in a unique index, so manual reviews are unaffected.)

One *active* review per dispatch at the database level; voided reviews stay attached for history, and regeneration after void is possible without weakening the constraint.

**FK rationale:** `dispatch` is `SetNull` because `Dispatch` cascade-deletes with its `ScheduleEvent` — a deleted schedule event must never erase a financial record. `invoice` is `Restrict` — an Invoice with a review cannot be deleted out from under it. Org deletion cascades both, consistent with `Invoice` (the tenant-wipe path already deletes financial children in FK-safe order via `org-snapshot.ts`).

---

## 5. Validation & business rules

| Rule | Enforcement |
|---|---|
| Duplicate Revenue Review for one dispatch | Partial unique index (§4) + creation inside the closeout claim (the `RELEASED→CLOSED` guarded update already guarantees single execution) |
| Charging the same dispatch twice | Status machine (payment-side transitions only from `APPROVED`/`PAYMENT_SCHEDULED`/`PAYMENT_FAILED`) + Payment Attempt idempotency (doc 09) |
| Client-supplied prices/totals | Never trusted; approval recomputes totals server-side in Decimal (§2.6); `expectedTotal` is a *confirmation*, not an input |
| Stale approval | `updatedAt` token + `expectedTotal` must match at claim time → 409 otherwise |
| Illegal transition | Guarded `updateMany` claims; zero rows → 409 with actionable message ("This review was already approved by …") |
| Approval with charging consequence but no payment readiness | If the snapshotted policy will auto-charge and readiness is `NOT_READY` (no payer or no saved Payment Method), the default `approveWithoutMethod = WARN` (doc 09) lets approval proceed with the effective policy converted to `MANUAL_INVOICE` — the control reads `Approve Revenue Review and issue the invoice for manual payment`, so the consequence stays truthful. Approval is refused with the reason only when the org sets `approveWithoutMethod = BLOCK`. The default posture is open decision D13 (doc 16) |
| Negative total | Blocked — a review whose lines sum below zero cannot be submitted or approved (credits beyond the total become credit adjustments, Part H doc) |
| Zero total | Allowed (fully discounted flight) with explicit confirm. No payment runs: the review's `ScheduledCharge` claim resolves directly to `COMPLETED` with no Payment Attempt and no `Payment` row (doc 09 §5.1 — attempts require amount > 0), and the review transitions `APPROVED → PAID` in that same claim (audited) |
| Currency consistency | Single `currency` per review; every line and the wrapped Invoice must match; mixed currencies are a 400 |
| Cross-tenant references | Every load org-scoped from the session; body-supplied ids (payer, payment method, line targets) verified org-owned before use; cross-tenant ids are 404s |
| Post-approval line mutation | No code path mutates `InvoiceLine` rows of an approved invoice; corrections are adjustment records (Part H) or refunds (doc 09) |
| Instructor time editing | Own time only, pre-submission; post-submission overrides require `revenue.time_override` + reason (doc 04 §6, Part C); all overrides set `TIME_OVERRIDE` |
| Payment-side status writes | Only the payment engine writes statuses 6–13 and 15 (§2.2); the review engine refuses them |
| Legacy invoices | Invoices without a review are untouched by all of the above; the existing manual payments route continues to serve them |

---

## 6. RBAC, approvals & audit

### 6.1 New permission keys

Added to `PERMISSIONS` in `src/lib/permissions.ts` (data-driven; routes check keys, never roles). The `revenue.` prefix must be registered in `MODULE_BY_PREFIX` (`src/lib/session.ts`) so Revenue Engine permissions are module-gated like `billing.*`.

| Key | Grants | Default roles |
|---|---|---|
| `revenue.review_view` | View Revenue Reviews (instructors: own reviews only — engine-scoped) | ADMIN tiers, DISPATCHER, ACCOUNTANT, INSTRUCTOR (own) |
| `revenue.review_create` | Create manual (dispatch-less) Revenue Reviews (instructors: engine-scoped to their own completed ground/sim sessions — §2.9) | ADMIN tiers, ACCOUNTANT, INSTRUCTOR (own sessions) |
| `revenue.review_submit` | Submit a review for approval; resubmit after Changes Requested | INSTRUCTOR, ADMIN tiers |
| `revenue.review_edit` | Edit charges/lines pre-approval only — instructor-time overrides require `revenue.time_override` (owned and defaulted by doc 04 §6) | ADMIN tiers |
| `revenue.approve` | Approve (OPERATIONS/SECOND kinds), request changes, escalate | ADMIN tiers; Operations Director / Chief Flight Instructor / Chief Pilot OrgRole templates |
| `revenue.approve_routine` | Instructor self-approval of routine reviews (only active when policy allows) | none by default |
| `revenue.approve_finance` | Record the FINANCE approval kind | ACCOUNTANT, ADMIN tiers |
| `revenue.void` | Void a review pre-approval, or post-approval while uncharged | ADMIN tiers |
| `revenue.charge` | "Charge now" / retry / reschedule (doc 09 executes) | ADMIN tiers, ACCOUNTANT |
| `revenue.allocation_view` | See the Allocation section incl. platform fee and compensation | ADMIN tiers, ACCOUNTANT |

`billing.view` / `billing.record_payments` keep their current meanings for legacy invoice surfaces. No Role enum values are added — Operations Director, Chief Flight Instructor, and Chief Pilot ship as OrgRole **templates** (the sanctioned path). Nav entries for the Revenue Dashboard/queues map into `SECTION_PERMISSIONS` and `SECTION_MODULES`.

### 6.2 Approval authority model

Authority = permission keys + `RevenueWorkflowPolicy` + separation-of-duties checks (§2.7–2.8). Never a role-name check. Read-only impersonation blocks every mutating action here (submit/approve/void/charge); full-access impersonation actions are re-attributed to the platform staffer automatically by `computeAttribution`. **No AI pathway may submit, approve, void, or charge** (constitution rule 8).

### 6.3 Audit actions & domain events

Every transition and every post-submission edit calls `recordAudit` with old/new values sufficient to reconstruct the change without current DB state:

| Audit action | When |
|---|---|
| `revenue_review.created` | Draft created (system or manual) |
| `revenue_review.submitted` | Instructor/staff submission, incl. computed risk flags |
| `revenue_review.time_overridden` | Post-submission time override (actor, reason, before/after) |
| `revenue_review.changes_requested` | With reason |
| `revenue_review.approval_recorded` | Each `RevenueReviewApproval` row (kind, approver) |
| `revenue_review.approved` | Final approval — includes total, currency, timing policy, snapshot reference |
| `revenue_review.voided` | With reason, pre- or post-approval |
| `revenue_review.regenerated` | New review created for a dispatch whose prior review was voided |

Domain events registered in `WEBHOOK_EVENTS` **with live emit sites** (constitution rule): `revenue_review.created`, `revenue_review.submitted`, `revenue_review.changes_requested`, `revenue_review.approved`, `revenue_review.voided`. Payment events (`payment.succeeded`, `payment.failed`, …) are owned by doc 09. Emissions happen post-commit only.

### 6.4 Void rules — pre- vs post-approval

| Phase | Allowed? | Conditions | Effects |
|---|---|---|---|
| Pre-approval (`DRAFT`, `AWAITING_INSTRUCTOR_REVIEW`, `AWAITING_OPERATIONS_REVIEW`, `CHANGES_REQUESTED`) | Yes — `revenue.void` + required reason | None beyond permission | Review → `VOIDED`; Invoice → `VOID`; **operational records untouched** (the dispatch stays closed, meters stay rolled — voiding money never reopens a flight) |
| Post-approval, uncharged (`APPROVED`, `PAYMENT_SCHEDULED`, `PAYMENT_FAILED` with nothing collected) | Yes — `revenue.void` + required reason | No Payment Attempt succeeded or in flight **and** Σ settled `Payment` rows against the Invoice = 0 — the sum includes offline (cash/check) and `ACCOUNT_CREDIT` payments, which create `Payment` rows without any Payment Attempt (a partial manual payment leaves the review at `APPROVED`, §2.2 note ², and blocks void). A review with any collected amount goes through the refund flow (doc 09) first. Scheduled charge cancelled atomically with the void claim | As above; audit records that an approved snapshot was voided (the snapshot itself is retained, never deleted) |
| Payment in flight (`PAYMENT_PROCESSING`, `ACH_PENDING`) | **No** | Wait for the attempt's outcome | Voiding mid-flight could desync provider truth; refuse with "Payment in progress — wait for the result, then refund or void" |
| Collected (`CARD_PAID`, `PAID`, `PARTIALLY_REFUNDED`) | **No** | Money moved; use the refund flow (doc 09) | Full refund → `REFUNDED` is the "void" of a paid review |

### 6.5 Reopen rules

- **Pre-approval "reopen"** is the Changes Requested loop — no special mechanism.
- **`VOIDED` is terminal.** To bill a dispatch whose review was voided, an authorized user (`revenue.review_create`) **regenerates** a new Revenue Review (new review number, new draft Invoice, fresh pricing resolution at *current* rates — with a visible notice when rates changed since the flight). The partial unique index permits this because the voided review no longer counts as active. Audited as `revenue_review.regenerated` with a link to the voided predecessor.
- **Post-approval un-approve does not exist.** The approved snapshot is immutable. Corrections: adjustment records against the review (Part H doc), refunds (doc 09), or void-and-regenerate while uncharged (§6.4).

---

## 7. UX notes (aviation-native, operational workflow first)

- **The instructor never fills out an invoice.** After return closeout they see "Confirm your time for N123AB — 1.4 Hobbs suggested" — time categories, prefilled suggestions, a notes field, one **Submit Revenue Review** action. Accounting vocabulary stays out of the instructor path.
- **Queues, not ledgers.** Approvers work a queue grouped by status (Awaiting Operations Review first), default-sorted oldest-first, each card showing tail number, student, instructor, date, total, risk-flag chips, payment readiness, and a days-in-status age chip (§2.11). Filters by flag ("show me everything with a discount"). The ops queue splits **needs my approval** / **awaiting another approver** (§2.7). Instructors get "My Revenue Reviews" (`[instructorId, status]` index).
- **Volume-honest approval.** Flag-free routine reviews approve from the card or in bulk (§2.10) with an aggregate consequence label ("Approve 12 routine Revenue Reviews — $4,310.00 will be charged to saved payment methods"); risk-flagged reviews always open. Overdue instructor reviews surface with a one-click "Submit on instructor's behalf (reason required)" action (§2.11).
- **Changes Requested is targeted.** Tagged lines/time entries are highlighted in the instructor's Changes Requested view; resubmitted reviews carry a **Resubmitted after changes** chip showing the prior reason and what changed since (§2.3).
- **Solo operators get one action.** Under the single-approver relaxation, routine reviews render the combined audit-flagged **Submit and approve** control (§3) — no self-ping-pong between two queue actions.
- **The review screen is one page, five sections** (§2.1), operational facts on top, money below — matching the mental flow of a return closeout, not an accounting form.
- **Consequence-truthful controls**: the approve button carries the exact wording of §2.6 for the effective timing policy; Request changes demands a reason inline; Void demands a reason and restates what will and won't happen ("The flight remains closed; nothing will be charged").
- **Provenance everywhere**: each charge line shows *why* ("Member Wet Rate v3 — $165/hr × 1.4 Hobbs"); payment readiness shows its reasons; ambiguous rate resolution shows the pricing engine's warning (pricing doc). A number without a why is a bug.
- **Status colors** exclusively via new `STATUS_TONE` entries for all 16 statuses; existing meanings untouched. Light + dark parity; mobile parity (instructors submit from the ramp); loading/empty/error states are part of the feature.
- **Terminology**: "aircraft return", "return closeout", "Revenue Review", "Approve and charge" — never "check-in", "ticket", or "student account balance" (principle 4; the payer-facing figure is **Amount Due**, and it appears only in the failure/deferred cases the spec enumerates).
- **Errors are actionable**: "This review changed since you loaded it — reload before approving." / "Separation of duties: you added the damage fee on this review — a second approver must approve it."

---

## 8. Interactions with other Revenue Engine components

| Component | Interaction |
|---|---|
| Operational checkout & return (deliverable 3; see [README](./README.md)) | Return closeout tx creates the Draft review + draft Invoice (replacing today's `OPEN` invoice creation — ADR-025 supersedes ADR-011's invoice clause). Operational validation (Hobbs/Tach, duplicate return) happens there; this doc trusts a closed dispatch. |
| Aircraft Pricing Profiles / Instructor Rate Profiles (Parts D–E docs) | Pricing resolution generates draft lines with profile ids + versions; approval freezes that provenance into the snapshot. Rate changes after approval never touch the review. |
| Instructor time (Part C doc) | Owns time categories, rounding, Hobbs suggestion/tolerance; feeds the Time summary section and the `TIME_OVERRIDE` flag. |
| Revenue Items (Part F doc) | Org-defined charges appear as lines; `requiresSecondApproval` items raise `DAMAGE_FEE`-class flags; requires-note/attachment rules enforced at line entry. |
| Taxes (Part G doc) | Tax lines + `TaxSnapshot` reference frozen at approval. |
| Adjustments, discounts, credits (Part H doc) | Pre-approval: discount/credit lines (risk-flagged). Post-approval: adjustment records only — the review's snapshot never mutates. |
| Payment engine, Payment Methods, Payment Attempts, refunds, disputes (doc 09) | Owns statuses 6–13 & 15, payment timing policy enum, readiness computation, batch runners, webhook idempotency (BillingEvent unique-insert pattern), receipts. Handoff is post-commit on `revenue_review.approved`. |
| Revenue Allocation & Instructor Compensation (allocation/compensation docs) | Allocation preview on the review; snapshot at approval; actual allocation/compensation records at financial closeout (Paid). |
| Responsible payers (Part K doc) | Payer resolution for the Payment section; payer-visible review states (Approved onward). |
| Checkout restrictions (Part J doc) | `PAYMENT_FAILED`/`DISPUTED` reviews and Amount Due feed the *financial* restriction evaluator (never the safety path). |
| Database model ([13-database-model.md](./13-database-model.md)) | Binding call on column types, `Decimal(12,2)` + currency, additive `InvoiceStatus` values, per-org number sequences, Dispatch `organizationId` backfill, indexes. |

---

## 9. Out of scope for Part 1 / deferred to Parts 2–3

- **Part 2 (build):** review engine (`src/lib/revenue-review.ts` — pure, contract-tested), routes (thin: authorize → zod → engine → audit → emit), queues + review screen, `RevenueWorkflowPolicy` settings UI, migrations + backfill, seed fixtures for both orgs (draft/awaiting/approved/failed-payment/voided states), STATUS_TONE entries, org-snapshot wiring, e2e verification incl. denial and cross-tenant paths.
- **Part 3 (payments live-path):** Stripe test-mode charging through the approved handoff, batch runners, dunning, receipts, dispute ingestion.
- **Deferred beyond Parts 2–3:** `WRITTEN_OFF` status (enum reserved, no writer), invoice merging, split payer responsibility, prepaid packages / wallet balances (spec Part H exclusions), payer approve-before-charge flows (Part K "approve charges if configured" — needs doc 09 + Part K alignment first), per-location workflow policies.

Nothing in this design is deployed in Part 1; no live payments, no production email — design only.

---

## 10. Open questions

1. **Instructor-triggered charging.** When `instructorMayApproveRoutine` is on and the timing policy is charge-immediately, instructor self-approval charges a customer's card. Is that acceptable to product, or should routine instructor approval always downgrade to a scheduled/ops-confirmed charge? (Default proposed here: policy off; org owner opts in with the consequence stated.)
2. **Gapless numbering.** Voided drafts consume review/invoice numbers, leaving gaps (audit-explainable). Do any target customers' accounting practices require gapless sequences, which would force allocate-at-approval numbering instead? (13-database-model.md needs the answer before fixing the sequence design.)
3. **`CARD_PAID` → `PAID` timing.** Should card captures roll to Paid immediately (simpler customer story) or only after settlement reconciliation (more truthful)? Owned by doc 09, but it changes what payers see and when receipts fire — product should decide the customer-facing rule.
4. **Changes-Requested dialogue.** Is the latest reason + AuditLog history enough, or do orgs need a visible comment thread on the review? (This design ships reason-only; a thread is additive later.)
5. **Additive `InvoiceStatus` values** (`PARTIALLY_REFUNDED`, `REFUNDED`, `DISPUTED`): confirmed with 13-database-model.md, or keep Invoice projection coarse (`PAID`/`VOID`) with refund/dispute truth only on the review?
6. **Disputed customers at dispatch.** Should an open `DISPUTED` review automatically raise a financial checkout restriction for that payer (Part J), and at what default severity (warn vs block)?
