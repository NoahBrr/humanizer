# Notifications — Revenue Engine Events, Recipients, and Channels

> **Status:** Proposed — Phase 8 Part 2 · **Date:** 2026-07-10 · **Lead roles:** Head of Product; Financial UX Designer; Reliability/SRE Engineer · **Part of:** Revenue Engine design set ([README](./README.md))

This document is Part 2 deliverable 16 (spec Part AA): who gets told what, when, and through which channel, for every financially meaningful moment in the Revenue Engine — without spam, without leaking money data to the wrong eyes, and without ever claiming a delivery that did not happen. It is design only: Stripe test mode is the only sanctioned environment, no production email is sent, nothing deploys.

North-star framing: a parent whose card is about to be charged, an instructor whose time needs confirming, and an accountant whose payment failed overnight should each find exactly one truthful, actionable message waiting for them — and a Director of Operations at a 30-flight-per-day school should never wake up to 30 identical notifications.

---

## 1. Purpose & scope

### In scope

- The full **event → recipients → channel matrix** for every spec Part AA trigger (review created, instructor review required, changes requested, operations approval required, approved, payment scheduled, card succeeded/failed, ACH initiated/pending/succeeded/returned, payment method required, refund issued, dispute opened, compensation approved, export ready), plus the Part 1-mandated triggers that ride the same machinery (instructor-review reminders/escalation, missing-approval-kind escalation, charge held, reconciliation exception, review voided).
- Recipient resolution as **roles, permissions, and relationships** — payer, student, instructor, permission-holder groups, doc 25's configured escalation roles — never hardcoded users.
- Integration with the **existing `Notification` model and `NotificationKind` enum** (seams audit): the additive enum values, additive columns, and the one new model (`NotificationPreference`).
- The single notification engine (`src/lib/revenue-notifications.ts`), its `emitDomainEvent` subscription, and the new domain events registered so org webhooks stay consistent with in-app notifications.
- **De-duplication, refresh threads, and throttling** — ACH and busy approval queues must not spam.
- **Delivery honesty**: production email is not active; the design binds to the planned `lib/email.ts` env-flag seam (PRODUCTION.md §13.1, CLAUDE.md §9), dev preview only, with delivery status recorded truthfully on the row. No raw tokens, secrets, or provider payloads in notification content or logs.
- Notification preferences: per-user opt-outs over org defaults, with a mandatory floor.
- Deep links into the Revenue Review / receipt surfaces (doc 30 owns the routes).

### Out of scope (owned by siblings)

- The emit sites themselves — approval transaction (doc [22-approval-to-payment.md](./22-approval-to-payment.md)), webhook reduce (doc 23), refunds/disputes (doc 26, spec Part V), compensation approval (doc 29, spec Part Y), exports ([12-revenue-allocation-and-reporting.md](./12-revenue-allocation-and-reporting.md)). This doc consumes their post-commit events.
- The failure **workflow** (retry, escalation policy matrix) — doc 25 (spec Part U). This doc consumes its recipient configuration.
- Dashboard queues and receipt surface anatomy — doc 30 (spec Part Z). Queues are the durable truth notifications point at.
- Final Prisma shapes — [34-part2-database-additions.md](./34-part2-database-additions.md) makes the final call on everything proposed in §5.
- Building the email adapter, any SMS/push channel, and the payer portal notification center — Part 3 (§10).

---

## 2. Relationship to Part 1 docs

This doc **finalizes and extends — never reinterprets**:

| Part 1 doc | What it fixed (binding) | What this doc adds |
|---|---|---|
| [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) §2.3, §2.7, §2.11 | Which transitions notify (created/submit/changes-requested/failed/disputed), the missing-approval-kind notification to permission holders, `instructorReviewReminderHours` (default 48) reminder-then-escalation cadence | The delivery mechanics: topics, dedupe threads, counter rows, the queue-less reminder pass, per-user preferences |
| [09-payment-timing-and-collection.md](./09-payment-timing-and-collection.md) §2.7, §7 | Failed charge notifies in-app and waits for a human; named `PAYMENT_FAILED` / `PAYMENT_RECEIPT` as example new kinds; in-app is the only channel — no email system exists | The final additive `NotificationKind` list (§5.1); payer-vs-org recipient split per payment event; ACH anti-spam rules |
| [10-checkout-restrictions.md](./10-checkout-restrictions.md) §3.5 | The idempotent-refresh precedent: repeat requests refresh rather than multiply a notification | Generalized into the dedupe-thread and counter-row mechanism (§3.6) |
| [11-responsible-payers.md](./11-responsible-payers.md) §4, §6 | `StudentPayerRelationship.receivesNotifications` (default true), `RevenueSettings.payerNotificationsEnabled` master switch (R29), the payer notification list (receipt, payment failed, ACH pending/returned, upcoming charge), payer privacy boundary | The paying-party selector (§3.3), the mandatory-floor interaction with those switches (§6.4, open question Q1), honesty about payers with no login surface until Part 3 (§8) |
| [12-revenue-allocation-and-reporting.md](./12-revenue-allocation-and-reporting.md) §6–7 | `export.completed` and `reconciliation.exception_opened` registered as domain events; `revenue.compensation_*` permission keys; `compensationApprovalMode` | Their notification rows, recipients, and dedupe behavior |
| [13-database-model.md](./13-database-model.md) enum table, §4.14 | `NotificationKind` additive values are owned by the Part 2 notification slice under the two-step enum rule; `RevenueSettings` hosts the payer notification switches | The final value list and the additive `Notification` columns — proposed here, bound by doc 34 |
| [14-migration-plan.md](./14-migration-plan.md) §113 | Optional `NotificationKind` additions: own migration, no same-migration writes | The concrete migration slice (§5.4) |
| [16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md) compliance §176 | "Payer notifications are designed as in-app only"; no production email | Restated as the channel matrix baseline; email designed dormant behind the seam |

Part 2 siblings consumed: [22-approval-to-payment.md](./22-approval-to-payment.md) (W0 hold notification, receipt notification hand-off, "held charges are loud"), [24-idempotency.md](./24-idempotency.md) (reconciliation exceptions rely on dashboard prominence + notifications until the scheduler lands), doc 23 (webhook reduce emits the payment events), doc 25 (Part U escalation-role policy matrix — recipient groups), doc 26 (refund/dispute emit sites), doc 29 (compensation emit sites), doc 30 (deep-link targets), doc 33 (test hooks in §7.4).

---

## 3. How it works

### 3.1 Principles

1. **Notifications are pointers, never truth.** Every operationally critical condition (failed payment, held charge, pending approval, reconciliation exception) lives in a durable dashboard queue derived from state (doc 30). A lost notification can never lose money, block a workflow, or hide a condition — it can only delay a human noticing what the queue already shows.
2. **One writer.** All Revenue Engine notification rows are written by one engine, `src/lib/revenue-notifications.ts` — never by scattered `db.notification.create` calls (the seams audit found 14 scattered sites for the *existing* kinds; the revenue kinds do not repeat that). One writer is what makes dedupe, throttling, preferences, and the security invariants (§6) enforceable and testable.
3. **Post-commit only.** Revenue notifications are side effects of committed financial state, emitted after the owning transaction commits — never inside it. (The dispatch-close route writes an operational maintenance notification in-transaction; financial notifications deliberately do not follow that precedent: nobody is told about money that has not committed, and payment transactions stay short.)
4. **Truthful, consequence-stating copy** — the notification equivalent of the approve-control wording rule. "Will be charged", "was charged", "could not be charged", "will not be charged" are distinct sentences and are never blurred.
5. **Never claim a delivery that didn't happen.** In-app rows are the only live channel in Part 2. Email is designed dormant behind the `lib/email.ts` seam; its status is recorded truthfully per row (§3.7). A payer with no login has no surface until the Part 3 payer portal — the org sees that stated, not papered over.
6. **No secrets, no PII beyond the safe allowlist, no raw provider data** in titles, bodies, links, payloads, or logs (§6.2).

### 3.2 Delivery architecture

The engine registers as a third subscriber on the in-process domain event bus (`src/lib/events.ts` — subscribers are isolated; a notification failure never affects webhooks or the emitting operation, and adding this consumer touches no domain code):

```
1. [TX] Owning financial transaction commits
      (approval tx — doc 22 §3.4 · webhook reduce — doc 23 · runner TX A/B —
       doc 22 §3.6 · refund reduce — doc 26 · export job — doc 12 §2.7)
2.  Post-commit, same process: recordAudit → emitDomainEvent(event, payload)
      payload: record ids + safe display fields only (§6.2)
3. [ASYNC — in-process bus hop] "notifications" subscriber
       (src/lib/revenue-notifications.ts):
   a. Re-load subjects by id from the DB, org-scoped (payload is a pointer,
      never trusted content)
   b. Resolve recipient selectors → concrete ACTIVE userIds (§3.3)
   c. Apply org gates (payer switches), per-user NotificationPreference,
      and the mandatory floor (§4)
   d. Compute topic, kind, dedupe key, template copy, linkPath (§3.6, §9)
   e. [TX — small, notification rows only] per recipient:
      refresh-or-create — an unread row with the same
      (organizationId, userId, dedupeKey) is updated (count, lastEventAt,
      title/body); otherwise a new row is inserted
4.  Email channel (dormant, §3.7): resolve transport via the lib/email.ts
    seam → record emailStatus truthfully; never "sent" in Part 2
```

Two trigger families do not ride a domain event and call the engine directly (both are still single-writer paths inside `src/lib`):

- **Internal workflow escalations** — the missing-approval-kind notification (doc 03 §2.7) fires from the escalation/submission engine.
- **The reminder pass** (doc 03 §2.11) — no cron exists (seams audit). `remindOverdueReviews({ organizationId, limit: 25 })` is a bounded engine pass that piggybacks on the existing sweep seams: it runs at the end of a Trigger-2 payment-runner/reconciliation sweep (docs 22/23) and on Revenue Dashboard load (cheap, indexed, bounded). Honest limitation, stated in product: reminders fire *at the next pass*, not at the exact hour; exact-time delivery arrives with the Part 3 scheduler adapter (D14). Reminder state needs no new column — the thread row's `lastEventAt` (§5.2) is the "last reminded" fact.

### 3.3 Recipient selectors (roles and relationships — never user ids in config)

| Selector | Resolution (at send time, org-scoped from the emitting record) | Gates applied |
|---|---|---|
| `payingParty(review)` | The review's **snapshotted** paying party: `payerId → ResponsiblePayer.userId`; when `payerId` is null (self-pay), `studentId → Student.userId`. Approved reviews snapshot payer identity and survive relationship revocation (doc 11) — payment outcomes go to the party of record for that payment | Payer case: `RevenueSettings.payerNotificationsEnabled` **and** `StudentPayerRelationship.receivesNotifications`; self-pay student: not gated by payer switches (they are the customer). Mandatory-floor interaction: §6.4 / Q1 |
| `student(review)` | `studentId → Student.userId` | Used only where the student is entitled to the content (their own review/receipt surfaces, Part Z) |
| `instructor(review\|earning)` | `instructorId → Instructor.userId` | Compensation content additionally requires the recipient hold `revenue.compensation_view_own` |
| `holders(permission)` | Every ACTIVE org member whose role/OrgRole grants the permission — resolved through the data-driven RBAC (`src/lib/permissions.ts`), never role-name checks. Supports exclusions (`minus: actorUserId`) | Per-user `NotificationPreference`; actor suppression (§3.6) |
| `escalationRoles(orgPolicy)` | Doc 25's Part U configured escalation groups ("Notify Finance Manager", "Notify Account Owner") — doc 25 owns the policy matrix and binds each toggle to a permission-holder selector; this engine consumes the resolved selector list | Per-user preference; doc 25 decides which are mandatory at the policy level |
| `requester(job)` | The user who created the job (e.g. `FinancialExportJob.createdById`) | Per-user preference |

**Actor suppression:** the user whose own deliberate action produced the event is excluded from that event's recipient set (no "you approved RR-1042" echo). System actors (`system:payment-runner`, `system:stripe-webhook`) suppress nobody.

### 3.4 The trigger matrix

Rows 1–17 are the spec Part AA list, in spec order; E-rows are Part 1/sibling-mandated triggers on the same machinery. "Counter row" and "thread" are the §3.6 dedupe mechanisms. Kinds are the §5.1 additive `NotificationKind` values. Deep-link targets per topic: §9.2.

| # | Trigger | Domain event (emit site) | Kind | Topic | Recipients (in-app) | Opt-out |
|---|---|---|---|---|---|---|
| 1 | Revenue Review created | `revenue_review.created` — closeout tx post-commit (docs 02/03), ground/sim auto-create, manual create route | `REVENUE_REVIEW_ACTION` | `review_created` | `instructor(review)` when attached **and** the review does not immediately enter Awaiting Instructor Review (else folded into #2 — one row, not two). **Deliberately no payer/student notification at creation**: draft amounts can still change, and a customer must never be shown numbers that may move (first customer contact is #5, post-approval) | Allowed |
| 2 | Instructor review required | `revenue_review.created` with payload status `AWAITING_INSTRUCTOR_REVIEW` (no new event; doc 03 §2.3) | `REVENUE_REVIEW_ACTION` | `instructor_review_required` | `instructor(review)` — "Confirm your time on RR-1042" | **Mandatory** (unbilled money must never pool silently — doc 03 §2.11) |
| E1 | Instructor review overdue (reminder → escalation) | — internal reminder pass (§3.2) | `REVENUE_REVIEW_ACTION` | `instructor_review_required` (thread refresh) / `review_overdue` (ops) | Reminder: `instructor(review)` after `instructorReviewReminderHours` (default 48, org timeZone); after a second interval, counter row to `holders(revenue.approve)` flagged "overdue instructor review" | Reminder mandatory (rides #2); ops counter allowed |
| 3 | Changes requested | `revenue_review.changes_requested` | `REVENUE_REVIEW_ACTION` | `changes_requested` | `instructor(review)`; plus the on-behalf submitter when staff submitted for the instructor (doc 03 §2.3) | **Mandatory** (work assignment) |
| 4 | Operations approval required | `revenue_review.submitted` | `REVENUE_REVIEW_ACTION` | `operations_approval_required` | `holders(revenue.approve)` minus the submitter — **one counter row per recipient**: "4 Revenue Reviews are awaiting your approval" | Allowed (the ops queue is truth) |
| E2 | Second / Finance approval required | — internal (doc 03 §2.7 missing-kind escalation; policy trigger at submission or explicit escalation) | `REVENUE_REVIEW_ACTION` | `additional_approval_required` | `holders(revenue.approve)` (`revenue.approve_finance` for the FINANCE kind) minus the recorded OPERATIONS approver — counter row | Allowed (queue is truth) |
| 5 | Review approved | `revenue_review.approved` | `PAYMENT_SCHEDULED` | `review_approved` (payer **billing-status thread**, §3.6) | `payingParty(review)` — copy states the exact financial consequence, mirroring the doc 03 §2.6 control-wording family: charge today / scheduled for date / invoice issued with Amount Due and due date ("No card will be charged automatically") | **Mandatory** (off-session charging expectation — the payer must know money is about to move) |
| 6 | Payment scheduled | same event — `PAYMENT_SCHEDULED` review status, batch/`CUSTOM_DATE`/`MANUAL_CHARGE` policies | `PAYMENT_SCHEDULED` | folded into `review_approved` — the #5 thread row **carries** the schedule ("will be charged on Jul 11"). No second row: identical moment, one truth | — (rides #5) |
| 7 | Card succeeded | `payment.succeeded` (webhook reduce post-commit, doc 23) | `PAYMENT_RECEIPT` | `payment_receipt` | `payingParty(review)` — receipt row with deep link to the doc 30 receipt surface. **No org notification on success** (dashboard tiles are the org's view; silence on success is what keeps failure notifications loud). Simpler-workflow choice: success is org-silent by default rather than a per-payment stream nobody reads | Payer: **mandatory** (money moved) |
| 8 | Card failed | `payment.failed` (webhook reduce or synchronous W3 failure, docs 22/23) | `PAYMENT_FAILED` | `payment_failed` | `payingParty(review)` — customer-friendly, safe-coded reason (never raw provider errors, spec Part U), with "update payment method" deep link; **org:** counter row to `holders(revenue.charge)` + `escalationRoles` per doc 25's policy matrix | Payer: **mandatory** (subject to Q1); org: allowed (failed-payments queue is truth) |
| 9 | ACH initiated | `payment.initiated` **(new event, §3.5)** — runner post-W3 when method type is `US_BANK_ACCOUNT` (doc 22) | `PAYMENT_SCHEDULED` | `ach_initiated` | `payingParty(review)` — "Payment of $412.50 initiated from Chase •••• 6789 — typically completes within 4 business days" (expected window per spec Part R) | **Mandatory** (a debit is hitting their bank) |
| 10 | ACH pending | — **no separate notification.** Pending *is* the initiated state; the review shows ACH Pending with the expected window (docs 09/21). Exactly **two** payer rows per ACH attempt: initiation (#9) and terminal (#11/#12) — nothing in between | — | — | — | — |
| 11 | ACH succeeded | `payment.succeeded` | `PAYMENT_RECEIPT` | `payment_receipt` | `payingParty(review)` — receipt (settlement, not initiation, per Part R: ACH is never instant) | **Mandatory** |
| 12 | ACH returned | `payment.failed` with ACH return code | `PAYMENT_FAILED` | `payment_failed` | As #8; payer copy maps the R-code to safe language ("your bank returned the payment — insufficient funds"). Late return after settlement (doc 09 §2.6) rides the same topic from its adjustment/dispute-shaped reduce | As #8 |
| 13 | Payment method required | `payment.held` **(new event, §3.5)** with a payer-actionable reason (`method_detached`, `consent_revoked`); `payment.failed` with hard-decline code (method → `SUSPENDED`, doc 09 §2.7); internal readiness trigger when a review nears approval carrying `MISSING_PAYMENT_METHOD` | `PAYMENT_METHOD_REQUIRED` | `payment_method_required` | `payingParty(review)` — "Add a payment method for Coastal Flight Academy — a charge is waiting", deep link to the payer's payment-methods page (which mints a fresh provider-hosted setup session on click — the notification itself **never** carries setup tokens or client secrets, §6.2) | **Mandatory** (collection is blocked on the payer's action) |
| E3 | Charge held (org side) | `payment.held` — W0 pre-flight hold, any reason incl. `account_not_ready` (doc 22 §3.6) | `PAYMENT_FAILED` | `charge_held` | Counter row to `holders(revenue.charge)` + `escalationRoles` with the machine-readable hold reason and fix link ("held charges are loud", doc 22 §10). `account_not_ready` is **org-only** — an org's onboarding problem is never exposed to its customers | Allowed (held-charges queue is truth) |
| 14 | Refund issued | `refund.issued` **(new event, §3.5)** — refund settlement reduce (doc 26); for `CUSTOMER_CREDIT` destination, emitted when the credit is issued | `REFUND_ISSUED` | `refund_issued` | `payingParty` of the **original payment** (snapshotted party of record); credit-destination copy names the credit and its expiry instead of a card return | **Mandatory** (money moved) |
| 15 | Dispute opened | `dispute.opened` **(new event, §3.5)** — webhook reduce (docs 23/26) | `DISPUTE_OPENED` | `dispute_opened` | `holders(revenue.refund)` + `escalationRoles` — amount, safe reason, and **`evidenceDueBy`** in the copy. Payer/student are **never** notified (they raised it with their bank; a platform notification to them is noise at best) | **Mandatory** (org side — a deadline-bearing financial threat may not be muted) |
| 16 | Compensation approved | `compensation.approved` **(new event, §3.5)** — approval tx post-commit under `AUTO_ON_REVIEW_APPROVAL`; compensation-approval route under `SEPARATE_APPROVAL` (doc 12 §2.2) | `COMPENSATION_APPROVED` | `compensation_approved` | `instructor(earning)` holding `revenue.compensation_view_own` — **rolling counter row per instructor** ("3 entries approved today — $312.50") so the default AUTO mode never produces one row per flight. Deep links to the instructor's own compensation view, never the review (the review row is gated separately by `instructorSeesOwnCompensation`) | Allowed |
| 17 | Export ready | `export.completed` (existing, doc 12 §7) | `EXPORT_READY` | `export_ready` | `requester(job)`; `COMPLETED_WITH_ERRORS` states the row-error count truthfully ("ready — 3 rows need mapping") | Allowed |
| E4 | Reconciliation exception opened | `reconciliation.exception_opened` (existing, doc 12 §7; attention SLA per [24-idempotency.md](./24-idempotency.md) §12 Q2) | `RECONCILIATION_EXCEPTION` | `reconciliation_exception` | Counter row to `holders(revenue.reconciliation_manage)` — kind + count; "money in outcome-unknown may only sit as long as a human looks" | Allowed (exceptions queue is truth), default on |
| E5 | Review voided | `revenue_review.voided` (existing) | `PAYMENT_SCHEDULED` | `review_approved` thread refresh | `payingParty(review)` **only if previously notified at #5** — the unread "will be charged" row refreshes to "RR-1042 was voided — you will not be charged." A customer told to expect a charge is always told when it will not happen | **Mandatory** (rides #5) |

Phase 9 (dormant, designed in doc 11 §3.7, deferred per D7): payer charge-approval request/decline/expiry notifications. Their `CHARGE_APPROVAL_REQUESTED` kind is **not** added in Part 2 — enum values ship in the release that first writes them (doc 14 rule).

### 3.5 Domain-event registry changes (org webhooks stay consistent)

Notifications and outbound org webhooks fire from the **same** `emitDomainEvent` call, so an org's own integrations always see what its people were told. Existing registered events reused: `revenue_review.created` / `submitted` / `changes_requested` / `approved` / `voided`, `payment.succeeded` / `payment.failed`, `export.completed`, `reconciliation.exception_opened`.

**New events this doc registers in `WEBHOOK_EVENTS`** (constitution test requires a live emit site for each; all four have Part 2 emit sites):

| Event | Emit site (owner) | Payload (ids + safe display fields only) |
|---|---|---|
| `payment.initiated` | Payment runner post-W3, both method types (doc 22 §3.6; ACH is the notification consumer, card orgs get webhook parity) | `revenueReviewId`, `paymentAttemptId`, `amount`, `currency`, `methodType`, `methodBrand`, `methodLast4` |
| `payment.held` | Payment runner W0 hold post-commit (doc 22 §3.6; coordinated with doc 25) | `revenueReviewId`, `scheduledChargeId`, `holdReason` (`method_detached` \| `consent_revoked` \| `account_not_ready`) |
| `refund.issued` | Refund settlement reduce post-commit (doc 26) | `revenueReviewId`, `refundId`, `amount`, `currency`, `destination` |
| `dispute.opened` | Inbound webhook reduce post-commit (docs 23/26) | `revenueReviewId`, `disputeId`, `amount`, `currency`, `evidenceDueBy` |

Payloads never contain provider payloads, tokens, secrets, PANs/bank numbers, or anything outside the doc 13 safe-metadata allowlist (brand/last4 are the ceiling). The in-process bus remains fan-out only — never inbound payment truth (ADR-009).

### 3.6 De-duplication, threads, and throttling

Three mechanisms, all keyed on `dedupeKey` scoped within `(organizationId, userId)` (§5.2). Refresh-or-create is engine-enforced inside the notification write transaction (lookup + update/insert); no DB unique is placed on `dedupeKey` — a rare race producing a duplicate advisory row is harmless and self-heals on read, unlike money rows, which is why notifications do not borrow ADR-033's structural-uniqueness machinery. Simpler-workflow choice: engine-level refresh over a raw-SQL partial unique — one less schema-governance exception for a non-financial table.

1. **Billing-status thread (per review, payer-facing).** `dedupeKey = "rr:<reviewId>:billing"`. Approved → scheduled → held (payer-actionable) → voided all refresh **one** unread row so the payer always sees the *latest* truth about the upcoming charge, never a stack of stale contradictions. Once read, the next state change creates a fresh row (read history is not rewritten).
2. **Terminal money rows (per attempt/refund — never collapsed).** Receipts, failures, ACH initiation, refunds each get their own row: `"rr:<reviewId>:receipt:a<attemptNumber>"`, `":failed:a<attemptNumber>"`, `":ach:a<attemptNumber>"`, `"refund:<refundId>"`. Each is a distinct financial fact; a retry failure (bounded by `maxAutoRetries` ≤ 3 + manual retries) is a new fact and notifies again.
3. **Counter rows (org queue topics).** For `operations_approval_required`, `additional_approval_required`, `charge_held`, `payment_failed` (org side), `reconciliation_exception`, `compensation_approved`: the engine maintains **at most one unread row per (recipient, topic)** — `dedupeKey = "topic:<topic>"` — carrying `count` and refreshed `lastEventAt`, e.g. "2 payments failed in the last 24 hours — open the failed-payments queue." This is the doc 10 §3.5 refresh precedent generalized, and it is the entire anti-spam story for a busy school: 30 submissions produce one row per approver reading "30 awaiting", not 30 rows.

**ACH rule restated (spec anti-spam requirement):** exactly two payer notifications per ACH attempt — initiation and terminal outcome. The multi-day pending window produces zero rows; the review's ACH Pending status with its expected window (doc 21/30) is the always-current answer to "where is my payment?"

Ordering uses `lastEventAt` (additive column, §5.2) so refreshed rows surface on activity while `createdAt` stays an honest creation fact.

### 3.7 Email channel — designed dormant, honest by construction

Per the seams audit there is **no email adapter anywhere** (the invitation route returns a link with a comment; `lib/email.ts` is planned but unbuilt). Spec Part AA: if production email is not active — use development preview, do not claim email was sent, do not include raw tokens in logs. Binding design:

- **Seam:** the engine calls a `sendNotificationEmail(...)` boundary that resolves the transport exactly as PRODUCTION.md §13.1 plans (`EMAIL_ENABLED` flag; `resend | console | noop`). Part 2 ships templates and the call path; **no production transport ships or is configured in this phase**. (PRODUCTION.md names Resend; older code comments say SendGrid — this doc follows PRODUCTION.md; flagged in Q5.)
- **Truthful per-row status:** additive `Notification.emailStatus` (§5.2): `null` = topic not email-eligible or email suppressed by preference; `NOT_CONFIGURED` = an email would have gone here, no transport exists (the Part 2 steady state); `PREVIEWED` = rendered through the console transport (development only — the console transport is refused when `NODE_ENV === "production"`, so customer financial content never prints to production logs); `SENT` / `FAILED` = **reserved, no writer until the Part 3 adapter** (the WRITTEN_OFF precedent). The UI never renders an "emailed" state from anything but `SENT`.
- **Email-eligible topics** (when the adapter lands): the payer money family (`review_approved`, `ach_initiated`, `payment_receipt`, `payment_failed`, `payment_method_required`, `refund_issued`) and `export_ready`. Org queue counters are in-app only by design — queues, not inboxes, run operations.
- **Dev preview content rules:** rendered previews carry the same safe-allowlist content as in-app rows — no tokens, no links with embedded credentials, no provider payloads. Structured logs around the send record `{ notificationId, topic, emailStatus }` only — never title/body/recipient address.
- **Honest settings copy:** the org settings surface states "Email delivery: not configured — notifications are in-app" until a real adapter reports otherwise. The existing notifications-page header copy ("Email, SMS, and push channels are configured per user in Settings") overstates today's reality and is corrected in the Part 2 UI slice (§9.3).

---

## 4. Configuration surface

**Deliberately no new org-level notification settings blob.** Org-level behavior lives in the policy singletons that own each workflow (typed columns, absent row = defaults — the binding config pattern); per-user choice is `NotificationPreference` rows; everything else is code defaults in the topic catalog. Simpler-workflow choice: a school configures *workflows* (reminder hours, escalation roles) and individuals mute *topics* — no 17×N settings matrix to administer.

| Level | Surface | Fields (defaults) | Owner |
|---|---|---|---|
| Org | `RevenueSettings` (existing, R29) | `payerNotificationsEnabled` (true) — master switch for payer-directed rows | docs 11/13 |
| Org | `StudentPayerRelationship` (existing) | `receivesNotifications` (true) — per-relationship payer gate | doc 11 |
| Org | `RevenueWorkflowPolicy` (existing) | `instructorReviewReminderHours` (48) — reminder/escalation cadence | doc 03 |
| Org | Part U failure policy (doc 25) | "Notify Finance Manager" / "Notify Account Owner" escalation toggles → permission-holder selectors consumed by §3.3 | doc 25 |
| User | `NotificationPreference` (new, §5.3) | Per-topic opt-out rows; **absent row = enabled** (zero-setup); `emailEnabled` column dormant until Part 3 | this doc / 34 |
| Code | `src/lib/revenue-notifications.ts` topic catalog | Topic keys, kind mapping, mandatory set, email eligibility, templates, deep-link builders, throttle constants (counter-row model; reminder intervals from policy) — R25 pattern: string keys validated against a `src/lib` catalog with contract tests | this doc |
| Platform | — none | Platform staff consume the Platform Console (pull); no platform notification rows in Part 2 | — |

**Mandatory floor (not configurable, enforced in the engine and hidden in the UI):** `instructor_review_required`, `changes_requested`, and the paying-party money family — `review_approved` (incl. voided refresh), `ach_initiated`, `payment_receipt`, `payment_failed`, `payment_method_required`, `refund_issued` — plus org-side `dispute_opened`. A `NotificationPreference` row for a mandatory topic is refused with 422 at write and ignored at send. Interaction with the org-level payer switches: §6.4 / Q1.

---

## 5. Data model additions (Prisma-flavored; final call: [34-part2-database-additions.md](./34-part2-database-additions.md))

### 5.1 `NotificationKind` — additive values (existing enum, extended)

Ten new values, all with Part 2 writers, shipped in their own migration before first use (doc 14 §113 rule):

```prisma
enum NotificationKind {
  // ... existing 10 values unchanged (UPCOMING_FLIGHT ... GENERAL)
  REVENUE_REVIEW_ACTION    // review workflow: created / confirm time / changes requested / approval needed / overdue
  PAYMENT_SCHEDULED        // approved with charge consequence; ACH initiated; billing-status thread (incl. voided refresh)
  PAYMENT_RECEIPT          // card/ACH settled — receipt (name fixed by doc 09 §7)
  PAYMENT_FAILED           // decline, ACH return, charge held (org) (name fixed by doc 09 §7)
  PAYMENT_METHOD_REQUIRED  // payer action required to collect
  REFUND_ISSUED
  DISPUTE_OPENED
  COMPENSATION_APPROVED
  EXPORT_READY
  RECONCILIATION_EXCEPTION
}
```

Notes: the legacy `BALANCE_DUE` value gets **no new writers** — Revenue Engine vocabulary is "Amount Due" and its notifications use the new kinds; the enum value itself is never renamed or removed (binding enum rule). `CHARGE_APPROVAL_REQUESTED` (doc 11's Phase 9 flow) is deferred with its writer (D7).

### 5.2 `Notification` — additive columns (existing model, extended; no existing column changes)

```prisma
model Notification {
  // ... existing fields unchanged ...
  topic       String?   // catalog key (§3.4); null = legacy/non-revenue row
  dedupeKey   String?   // §3.6 thread/counter key, scoped per (organizationId, userId)
  linkPath    String?   // app-relative deep link, must start with "/" (§6.2); null = no link
  count       Int       @default(1)      // counter rows: events aggregated into this row
  lastEventAt DateTime  @default(now())  // last refresh; sort key — createdAt stays honest
  emailStatus NotificationEmailStatus?   // null = not email-eligible / suppressed (§3.7)

  @@index([organizationId, userId, dedupeKey]) // refresh-or-create lookup
}

enum NotificationEmailStatus {
  NOT_CONFIGURED // email-eligible, no transport exists (Part 2 steady state)
  PREVIEWED      // rendered via dev console transport only
  SENT           // reserved — Part 3 adapter is the first writer
  FAILED         // reserved — Part 3
}
```

All nullable/defaulted — additive, no backfill; legacy rows keep their exact meaning (null topic). Existing indexes (`[organizationId, createdAt]`, `[userId, isRead]`) untouched.

### 5.3 `NotificationPreference` — new model

```prisma
model NotificationPreference {
  id             String   @id @default(cuid())
  organizationId String
  userId         String
  topic          String   // engine-validated against the src/lib topic catalog (R25);
                          // rows for mandatory topics are refused (422) and ignored
  inAppEnabled   Boolean  @default(true)
  emailEnabled   Boolean  @default(true) // dormant until the Part 3 email adapter
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([organizationId, userId, topic]) // tenant-scoped, schema-governance compliant
  @@index([organizationId, userId])
}
```

Absent row = enabled (zero-setup, principle 10). Org-scoped deliberately: a user who is a member of two orgs mutes per org.

### 5.4 Migration & platform wiring

- One additive enum migration (`NotificationKind` values + `NotificationEmailStatus`), then a separate migration for columns + `NotificationPreference` — no same-migration writes (doc 14 §113); slots after M15 in doc 14's sequence (no financial table depends on it; final sequencing by doc 34).
- `NotificationPreference` joins org-snapshot capture/wipe/restore and `TableKey`; `Notification` is already wired. Seed fixtures: a handful of revenue notifications for both demo orgs matching the seeded review states (draft/awaiting/approved/failed-payment/voided) so the notification center demos truthfully; `demo1234` logins untouched.

---

## 6. Validation & business rules

### 6.1 Structural rules

1. **Single writer:** revenue `NotificationKind` values are written only by `src/lib/revenue-notifications.ts`. Enforceable by a static source-scan test (doc 33): the new kind literals may appear only in the engine, the schema, and the UI `KIND_META` map.
2. **Never org-wide:** revenue notifications are always per-user rows. The engine refuses `userId = null` for revenue kinds — org-wide rows render for **every** member including students (existing notifications page queries `userId: null OR userId: me`), so a null-user financial row is a tenant-internal information leak (Part AB auto-reject: "student can view organization revenue"). Contract-tested.
3. **Post-commit only** (§3.1); the notification write is its own small transaction and never joins a financial transaction.
4. **Recipient resolution at send time** against ACTIVE members/relationships — permission-holder lists are never stored in config.
5. **Bounded work:** recipient queries and the reminder pass are indexed and bounded (`limit 25` per pass; counter rows keep per-event row counts ≤ recipients).

### 6.2 Content allowlist (applies to titles, bodies, linkPath, event payloads, email previews, and logs)

| Permitted | Forbidden |
|---|---|
| Review/adjustment/invoice numbers (RR-/ADJ-/INV-), amounts + currency, dates/windows, aircraft tail, first/last names, method **brand + last4** (the doc 13 safe-metadata ceiling), safe-coded failure reasons (doc 25's mapping), hold reason labels, evidence deadlines, export names/row-error counts | PAN/CVV/bank or routing numbers, any provider token/secret/client secret, `Stripe-Signature` material, raw provider error strings or payloads, setup/invite URLs with embedded tokens, absolute URLs (phishing/open-redirect surface), internal stack traces |

`linkPath` is validated app-relative (`^/`); links that require a fresh secret (hosted method setup) point at an AeroOps page that mints the provider-hosted session **on click, after authorization** — never a pre-minted link at rest in a notification row. Engine logs carry `{ notificationId, topic, kind, recipientCount }` — never content.

### 6.3 Copy rules (Financial UX)

- Consequence-truthful verbs, mirroring the approve-control wording family (doc 03 §2.6): *will be charged / was charged / could not be charged / will not be charged*.
- Payer/student copy always says **Amount Due**, itemized on click-through — never "account balance" (banned vocabulary).
- ACH copy always states the expected window and never implies settlement at initiation (Part AB auto-reject: ACH treated as instant).
- Failure copy is actionable: what happened (safe-coded), what to do next, one-click path there.

### 6.4 Suppression precedence (evaluated in order)

1. Engine invariants (§6.1–6.2) — hard refusals.
2. Org payer switches (`payerNotificationsEnabled`, `receivesNotifications`) — suppress payer-directed rows **including the mandatory money family** in Part 2, because doc 11 §4 bindingly defines those flags as covering receipt/failure/ACH notifications. The settings UI warns loudly ("payers will not be told about failed charges"); whether the failure/refund subset should pierce these org switches is open question Q1 — this doc does not silently reinterpret doc 11.
3. Actor suppression (§3.3).
4. Per-user `NotificationPreference` — honored except for mandatory topics (§4).
5. Dedupe/thread collapse (§3.6) — suppresses duplicate rows, never the first row.

---

## 7. RBAC, approvals & audit

### 7.1 Permissions

No new permission keys. Notification reads/writes are self-scoped (own rows only); recipient *selection* consumes existing `revenue.*` keys as data (§3.3). Rationale: a "manage notifications" permission would gate nothing — preferences are personal, and mandatory topics are engine-enforced, not permission-enforced.

| Action | Gate |
|---|---|
| List own notifications / unread badge | `getSession()` org member (existing pattern); payer variant via `authorizePayer()` in Part 3 |
| Mark read (existing `POST /api/notifications/read`) | Existing self-service route, own rows only; blocked under read-only impersonation (`{ mutating: true }`) |
| `GET/PATCH /api/notifications/preferences` (new) | `authorize()` (any member), `{ mutating: true }` on PATCH, zod-validated topic against the catalog, own rows only — a body-supplied foreign `userId` is refused |
| Viewing another user's notifications | No surface, no route — deliberately does not exist |

### 7.2 Privacy boundaries (restating the bindings this engine enforces by construction)

- Students/payers never receive org revenue, instructor compensation, platform-fee, or other-customer content — their topics are scoped to their own reviews/payments (Part Z "never show" list).
- Instructor compensation rows go only to that instructor (`revenue.compensation_view_own`); another instructor's compensation never appears (Part AB auto-reject).
- Platform-fee agreements never appear in any org-facing notification (spec Part W: hidden from students; fee visibility is doc 27's concern).
- Deep links re-authorize on landing — a notification is never an access grant; a stale link 403/404s safely.

### 7.3 Audit

- Notification row creation is **not** individually audited — rows are derived advisories of already-audited financial mutations; auditing them would double every financial audit trail with noise. (The emitting mutation's `recordAudit` is the reconstruction record.)
- `NotificationPreference` mutations **are** audited (`notification.preference_changed`, before/after topic + channels) — org standard: every mutation audited.
- Delivery honesty is queryable: `emailStatus` on the row is the record of what was and wasn't claimed.
- No AI pathway generates, suppresses, or reads notifications on anyone's behalf (constitution rule 8 posture: notifications derive from audited human/system state changes only).

### 7.4 Test hooks (consumed by doc 33, spec Part AC; DB-free per testing standards)

- Pure-engine contract tests: recipient resolution from fixtures (payer/self-pay/instructor/holders/exclusions), mandatory-floor enforcement, suppression precedence, dedupe-key computation, counter-row collapse, template output contains only allowlisted fields, ACH two-row rule, linkPath validation.
- Static source scans: revenue kind literals only in the engine/schema/`KIND_META`; no `db.notification.create` for revenue kinds outside the engine; no `userId: null` write path in the engine.
- Constitution test auto-covers: new events emitted somewhere; preferences route authorization.

---

## 8. Failure modes & edge cases

| Scenario | Behavior |
|---|---|
| Process crashes between financial commit and the notifications subscriber (in-process bus, no retry today) | Row is lost — **and nothing breaks**: every critical condition is queue-backed (§3.1); receipts remain visible on the review/receipt surface. The Part 3 queue adapter upgrades the same seam to at-least-once; `dedupeKey` already makes redelivery idempotent, so the upgrade is a delivery change, not a redesign |
| Subscriber throws (template bug, DB hiccup) | Isolated by `events.ts`; logged with ids only; webhooks/automations unaffected; emitting operation unaffected |
| Payer has no `User` account (INVITED, or none) | No in-app row is possible. The review's payment panel shows "Payer cannot receive notifications — no account yet" with the invite action. Never silently claimed as notified |
| Third-party payer has a `User` but no org membership (payer portal is Part 3) | Rows are written durably now (org-scoped, payer's `userId`) and surface when the Part 3 payer portal ships; until then the org-side panel states "payer has no notification surface yet." Recommendation against a half-built interim payer page: §10 |
| Payer relationship revoked / payer archived after approval | Payment-outcome notifications for in-flight money still go to the snapshotted party of record (doc 11: approved reviews survive revocation); no *new* review notifications route to a revoked payer |
| `receivesNotifications` or master switch off | Payer rows suppressed per doc 11 binding; settings UI warns; open question Q1 for the failure/refund subset |
| Duplicate webhook delivery | The doc 23 reduce no-ops on `processedAt`; no second transition → no second emit → no duplicate row. Structural, no notification-side logic needed |
| Auto-retry failures (up to `maxAutoRetries` 3) | One row per attempt (distinct financial fact, §3.6); org counter row aggregates regardless |
| Recipient loses the qualifying permission after send | Existing rows persist (point-in-time advisories containing nothing beyond what they were entitled to at send); deep links re-authorize and fail safely |
| Member deactivated / user deleted | Send-time resolution skips non-ACTIVE members; existing rows cascade with the user (existing FK) |
| Review voided while payer's "will be charged" row unread | Billing thread refreshes to the void copy (E5) — the payer is never left expecting a charge that will not come |
| Reminder pass never runs (quiet org, nobody opens the dashboard, no sweep) | Honest known limitation of the queue-less phase (doc 24 §357): reminders fire at next pass; the age chips and oldest-first queues (doc 03 §2.11) remain the operational backstop; Inngest (Part 3) closes it |
| Multi-instance deployment | Bus is per-instance; the emitting instance writes the rows — no cross-instance coordination needed. Refresh race across instances can duplicate an advisory row; harmless (§3.6) |
| Read-only impersonation | Mark-read and preference PATCH refuse (`{ mutating: true }`); impersonated reads show the user's rows (support parity) and are audited by the impersonation session itself |

---

## 9. UX notes

### 9.1 Copy examples (templates live in the engine catalog; representative, binding in tone)

| Topic (audience) | Example |
|---|---|
| `review_approved` immediate (payer) | "Revenue Review RR-1042 approved — $412.50 will be charged to Visa •••• 4242 today." |
| `review_approved` scheduled (payer) | "RR-1042 approved — $412.50 will be charged to Visa •••• 4242 on Jul 11." |
| `review_approved` manual invoice (payer) | "Invoice INV-0231 issued — Amount Due $412.50 by Jul 24. No card will be charged automatically." |
| `ach_initiated` (payer) | "Payment of $412.50 initiated from Chase •••• 6789 — typically completes within 4 business days." |
| `payment_receipt` (payer) | "Payment received — $412.50 to Coastal Flight Academy for RR-1042. View receipt." |
| `payment_failed` (payer) | "We couldn't process your $412.50 payment — card declined. Update your payment method or contact the school." |
| `payment_failed` ACH return (payer) | "Your bank returned the $412.50 payment (insufficient funds). Amount Due is unchanged — update your payment method or contact the school." |
| `payment_method_required` (payer) | "Add a payment method for Coastal Flight Academy — a $412.50 charge is waiting." |
| `refund_issued` (payer) | "Refund of $150.00 issued to Visa •••• 4242 — typically appears in 5–10 business days." |
| `review_approved` void refresh (payer) | "RR-1042 was voided — you will not be charged." |
| `instructor_review_required` (instructor) | "Confirm your time on RR-1042 — N123AB with Dana Marsh, Jul 9." |
| `operations_approval_required` (approver, counter) | "4 Revenue Reviews are awaiting your approval." |
| `charge_held` (org, counter) | "1 charge is on hold — payment method was removed. Open held charges." |
| `dispute_opened` (org) | "Dispute opened on RR-1042 — $412.50 (product not received). Evidence due Jul 24." |
| `compensation_approved` (instructor, counter) | "3 entries approved today — $312.50 added to your compensation." |
| `export_ready` (requester) | "Financial Export 'June revenue (QuickBooks CSV)' is ready — 214 records. 3 rows need mapping." |

### 9.2 Deep links (`linkPath` targets; final routes owned by doc 30)

| Topic | Lands on |
|---|---|
| Review workflow topics (1–4, E1–E2) | The Revenue Review detail, scrolled to the actionable section (time confirmation / changes / approval panel) |
| `review_approved` thread | The review's payment section — the doc 22 "what happens next" timeline |
| `payment_receipt` | The doc 30 receipt surface for that payment |
| `payment_failed`, `payment_method_required` | Payer: own payment-method page (mints hosted setup on click); org: the failed-payments / held-charges queue |
| `refund_issued` | The refund's receipt-style view (doc 26/30) |
| `dispute_opened` | The dispute record (doc 26) |
| `compensation_approved` | The instructor's own compensation view (doc 30) — never the review |
| `export_ready` | The Financial Export job page (download re-authorizes; the link carries no file token) |
| `reconciliation_exception` | The exceptions queue (doc 30) |

### 9.3 Surfaces

- **Notification center (existing page, extended):** rows with new-kind icons (`KIND_META` is `Record<NotificationKind, …>` — the type system forces entries for all ten new values), counter badges (`count`), relative `lastEventAt`, and row-level navigation via `linkPath`. Kind→icon/color mapping stays single-sourced in `KIND_META`; statuses shown inside linked surfaces come from `STATUS_TONE` only.
- **Header copy corrected** to the truthful "Notifications are in-app. Email delivery is not yet configured." (replacing today's aspirational email/SMS/push sentence).
- **Preferences UI (Settings → Notifications):** topic list grouped by kind, toggle per topic, mandatory topics shown locked with the reason ("Always on — payment outcomes are always delivered"). Email column visible but disabled with "coming soon" honesty until Part 3.
- Light/dark + mobile parity, loading/empty/error states (empty: "You're all caught up"), unread badge unchanged.
- Notifications never carry action buttons that mutate money — they navigate to the authorized surface where the action (retry, approve, update method) lives behind its own gate.

---

## 10. Out of scope for Part 2 / deferred to Part 3

- **Email adapter build and activation** (`lib/email.ts`, `EMAIL_ENABLED`, Resend transport), `emailStatus` `SENT`/`FAILED` writers, email receipts. No production email in this phase, ever.
- **Payer portal notification center** (`/payer`, `authorizePayer()`) — rows written in Part 2 surface there when it ships (doc 11 §10). Recommendation: do not pull forward an interim payer-only page; one well-built portal beats two half-built surfaces.
- **Payer charge-approval notifications** and the `CHARGE_APPROVAL_REQUESTED` kind — Phase 9 with D7.
- **Exact-time reminders and unattended digests** — Part 3 scheduler (Inngest, D14); the dedupe keys and counter rows are already redelivery-safe for that upgrade.
- **SMS/push channels**, per-org configurable topic-default matrices, notification retention/archival policy — not planned for Phase 8.
- **Dunning sequences** — doc 25 designs, Part 3 executes; their notifications will ride the existing `payment_failed`/`payment_method_required` topics.

---

## 11. Open questions

1. **(Owner)** **Mandatory floor vs doc 11's payer switches.** Doc 11 §4 bindingly lets an org suppress payer notifications per relationship (`receivesNotifications`) and org-wide (`payerNotificationsEnabled`), explicitly including payment-failed; spec Part AA treats payment failure to the payer as the canonical mandatory notification. Part 2 honors doc 11 (org switches win, with a loud settings warning) rather than silently reinterpreting Part 1. Should the failure/refund subset pierce the org switches? Recommendation: yes in Part 3, via an additive doc-11-coordinated amendment — a payer whose money moved or failed to move should always know.
2. **(Owner)** **Student copy on third-party-payer receipts.** When a parent/sponsor pays, should the student also receive a receipt-style row by default? Recommendation: **no** — the paying party gets money notifications; the student sees status on their own review surface (Part Z); orgs wanting more can revisit in Part 3. Avoids double-messaging families.
3. **(Owner)** **Counter-row scope for org failure topics.** This doc collapses org-side `payment_failed` into one refreshing counter row per recipient. Should orgs above a size threshold be able to opt into per-review failure rows instead? Recommendation: no — the failed-payments queue is the per-review view; keep one mechanism.
4. **(Coordination — doc 25)** Bind the Part U escalation toggles ("Notify Finance Manager", "Notify Account Owner") to concrete permission-holder selectors and decide which are policy-mandatory; this engine consumes the result (§3.3).
5. **(Coordination — docs 34/23/26/29)** Bind the §5 shapes (`NotificationKind` values, `Notification` columns, `NotificationPreference`, `NotificationEmailStatus`) and confirm the four new `WEBHOOK_EVENTS` (`payment.initiated`, `payment.held`, `refund.issued`, `dispute.opened`) with their emitting owners. Also confirm the email transport naming (PRODUCTION.md says Resend; legacy code comments say SendGrid — this doc follows PRODUCTION.md).
6. **(Coordination — doc 30)** Final `linkPath` route table (§9.2) once the Revenue Dashboard routes are bound.
