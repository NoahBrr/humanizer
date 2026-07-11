# Instructor Compensation — Recognition Policies, Holds, Clawbacks & Reporting

> **Status:** Proposed — Phase 8 Part 2 · **Date:** 2026-07-10 · **Lead roles:** Chief Flight Instructor; Aviation Accounting Specialist; Financial Systems Architect; Independent Flight Instructor · **Part of:** Revenue Engine design set ([README](./README.md))

Covers spec **Part Y (Instructor Compensation)** — Part 2 deliverable 14. This is the Part 2 deepening of the compensation half of [04-instructor-time-and-rates.md](./04-instructor-time-and-rates.md) and the compensation sections of [12-revenue-allocation-and-reporting.md](./12-revenue-allocation-and-reporting.md) (§2.4, §2.5 comp legs, §2.8 comp reports). Written for the engineers implementing Part 3. Customer-facing name: **Instructor Compensation**; backend model: `InstructorEarning` ([13-database-model.md](./13-database-model.md) §4.7, canonical).

---

## 1. Purpose & scope

Part 1 bound *what* an Instructor Compensation record is: an append-only `InstructorEarning` snapshot written from COMPENSATION-kind Instructor Rate Profiles, structurally separate from customer billing (principle 6), corrected only by signed reversal rows. Part 2 owns *when it becomes payable*, because payments now exist:

1. **Recognition policies** — the spec's five org-configurable policies (earned at lesson completion / at Revenue Review approval / after payment succeeds / held until ACH settles / manual approval required), including exactly when the `InstructorEarning` row is created and what status it starts in under each.
2. **The full status machine** — the spec's eight states (Draft, Pending Approval, Approved, Held, Exported, Paid, Adjusted, Reversed) mapped onto the canonical `InstructorEarningStatus`, with every transition's trigger: approval transaction, human approval, payment webhooks (doc 23), refund/dispute reversals (doc 26), export jobs (Part 3).
3. **ACH interaction** — holds until settlement; returns after recognition.
4. **Refund/dispute impact** — org-configurable claw-back vs school-absorbs, tied to the Part 2 refund workflow (doc 26).
5. **Reports and privacy** — the spec's report set as defined queries over earning/ledger rows; instructors see only their own compensation (Part AB rejection condition).
6. **Export seam** — how earnings hand off to `FinancialExportJob` (Part 3 executes).

Out of scope here (owned by siblings): time entry and rate resolution ([04](./04-instructor-time-and-rates.md), unchanged), the approval transaction skeleton ([03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) §2.6 / Part 2 doc 22), webhook mechanics (doc 23), refund execution (doc 26), allocation/ledger engine (doc 28 extending [12](./12-revenue-allocation-and-reporting.md)), dashboard composition (doc 30), notification delivery (doc 31). Final binding shapes for every NEW column/enum/model proposed here: **[34-part2-database-additions.md](./34-part2-database-additions.md)**.

> Sibling Part 2 documents are referenced by deliverable number (doc 22 approval-to-payment, doc 23 webhooks, doc 25 payment failures, doc 26 refunds/voids/disputes, doc 27 platform fee, doc 28 revenue allocation, doc 30 Revenue Dashboard, doc 31 notifications, doc 33 payment test plan, doc 34 database additions); exact filenames settle in the README index.

**Required disclaimer (verbatim, binding on every compensation surface and export):**

> **AeroOps does not determine legal worker classification and does not claim to generate official tax documents.**

The longer UI copy from doc 04 §7 remains required wherever classification is set or displayed.

---

## 2. Relationship to Part 1 docs (what this extends and finalizes)

| Part 1 doc | What Part 2 does with it |
|---|---|
| [04-instructor-time-and-rates.md](./04-instructor-time-and-rates.md) | **Extends.** Time entry, rate profiles, resolution tiers, `compensationUsesBilledQuantity`, `allowCompensationLinkedToBilling`, manual additive earnings (§2.7), permission keys — all unchanged. This doc adds the recognition-timing axis and the payment-driven transitions doc 04 explicitly deferred ("payout execution … Part 3"; earnings recording rides Part 1's approval event). |
| [12-revenue-allocation-and-reporting.md](./12-revenue-allocation-and-reporting.md) | **Extends §2.4 and refines §2.5.** The PENDING→APPROVED→EXPORTED flow, `compensationApprovalMode`, `compensationRefundPolicy`, reversal-on-refund proposal, R6 invariant, and the comp reports are kept. Refinement (§7 below): the `INSTRUCTOR_COMP_EXPENSE/PAYABLE` accrual journal posts when an earning **enters `APPROVED`**, which is inside the review-approval transaction for default-configured orgs — identical behavior to doc 12's posting matrix in the default case, and the only reading consistent with doc 12's own R6 invariant in the non-default cases. |
| [13-database-model.md](./13-database-model.md) | **Canonical, honored exactly.** `InstructorEarning` §4.7 shape, `InstructorEarningStatus { PENDING, APPROVED, EXPORTED, REVERSED }`, R6 merged shape, FK actions, indexes, wipe order. Part 2 additions (one enum value `HELD`, columns `earnedAt`/`adjustmentId`, one new enum, one `RevenueSettings` column, one small new model) are **additive**; doc 34 makes the final call. |
| [08-adjustments-discounts-credits.md](./08-adjustments-discounts-credits.md) | **Consumes.** `instructorClawbackPolicy` (`NEVER \| SERVICE_LINES_ONLY \| ALWAYS_PRO_RATA`, default `SERVICE_LINES_ONLY`) decides *which* refunds/voids implicate compensation; this doc + doc 26 decide *how* the implication executes. |
| [03-revenue-review-lifecycle.md](./03-revenue-review-lifecycle.md) | **Consumes.** Approval transaction step 5 writes earning rows; void flow (§6.4) always auto-reverses earnings; `RevenueWorkflowPolicy.instructorSeesOwnCompensation` gating unchanged. |
| [09-payment-timing-and-collection.md](./09-payment-timing-and-collection.md) | **Consumes.** ACH Pending window (~4 business days), settlement semantics, `Payment` 1:1 with successful `PaymentAttempt`, offline-payment recording rules. |
| [16-risks-and-open-decisions.md](./16-risks-and-open-decisions.md) | R6 (ACH return vs recognition) is closed by the `HELD` design + clawback flow here. D44 (contractor 1099 / externally-paid marker) stays a Part 3 decision; nothing here forecloses either option. |

No Part 1 statement is weakened. The one Part 1-internal tension found (doc 12 posting-matrix wording vs its own R6 invariant for non-default approval modes) is resolved in §7 and flagged in Open questions for the Part 1 refresh owners.

---

## 3. Spec status names → canonical model (binding mapping)

The spec names eight statuses. Doc 13's enum is canonical and additive-only, and two of the spec's states are *presentation states* that DATABASE_STANDARDS forbids storing (they are derivable at read; storing them would be a re-synced computed value). The mapping:

| Spec status | Canonical representation | Stored? |
|---|---|---|
| Draft | Compensation **preview** on a not-yet-approved Revenue Review — resolver output rendered live, labeled "Draft — not yet payable". No `InstructorEarning` row exists before the approval transaction (Part 1: pre-approval nothing is stored). | No — derived |
| Pending Approval | `InstructorEarningStatus.PENDING` | Yes (Part 1) |
| Approved | `InstructorEarningStatus.APPROVED` | Yes (Part 1) |
| Held | `InstructorEarningStatus.HELD` — **new additive enum value, Part 2** | Yes (new) |
| Exported | `InstructorEarningStatus.EXPORTED` | Yes (Part 1) |
| Paid | Reserved. Part 1 deliberately omitted `PAID`; activating it (or the `externallyPaidAt` marker) is decision **D44**, owned by Part 3 with payout/1099 work. No writer in Part 2. | Not in Part 2 |
| Adjusted | Derived badge: a primary earning whose reversal family (§6.4) contains signed rows but nets ≠ 0. | No — derived |
| Reversed | `InstructorEarningStatus.REVERSED` — terminal mark stamped when the family nets to exactly 0. | Yes (Part 1) |

`HELD` ships in the same DDL migration that creates `InstructorEarningStatus` if doc 14's M14 has not yet run when Part 2 implementation starts; if M14 has already shipped, `HELD` gets its own additive enum migration before first use (two-step rule, [14-migration-plan.md](./14-migration-plan.md)).

---

## 4. Recognition policies — when the row is created, and in what status

### 4.1 The org-facing selector (customer wording, per spec)

One setting, presented as a five-option radio group in Revenue Settings → Instructor Compensation. **Simpler-workflow choice:** one selector the Director of Operations can read in plain language, stored as two orthogonal typed columns — the new `compensationRecognitionEvent` plus Part 1's existing `compensationApprovalMode` — rather than a five-value enum that would duplicate and fight the Part 1 column.

| # | Selector option (verbatim spec policy) | `compensationRecognitionEvent` | `compensationApprovalMode` |
|---|---|---|---|
| 1 | Earned at lesson completion | `LESSON_COMPLETION` | `AUTO_ON_REVIEW_APPROVAL` |
| 2 | **Earned at Revenue Review approval (default)** | `REVIEW_APPROVAL` | `AUTO_ON_REVIEW_APPROVAL` |
| 3 | Earned after payment succeeds | `PAYMENT_SETTLED` | `AUTO_ON_REVIEW_APPROVAL` |
| 4 | Held until ACH settles | `ACH_SETTLEMENT_HOLD` | `AUTO_ON_REVIEW_APPROVAL` |
| 5 | Manual approval required | `REVIEW_APPROVAL` | `SEPARATE_APPROVAL` |

An advanced checkbox — "Also require manual approval before compensation becomes payable" — sets `SEPARATE_APPROVAL` on top of options 1, 3, or 4 (it *is* option 5 when combined with option 2). Every combination of the two columns is legal and defined below. Settings changes are zod-validated PATCH with before/after `recordAudit`; a policy change affects **only reviews approved after the change** — rows already written keep their lifecycle (§13.7).

**Default recommendation: option 2** (`REVIEW_APPROVAL` + `AUTO_ON_REVIEW_APPROVAL`) — identical to Part 1's shipped default, zero-setup correct. Rationale: most schools pay instructors on a payroll calendar regardless of whether the student's card cleared; making instructor pay hostage to collections by default would erode instructor trust at the five schools we onboard tomorrow. Contractor-heavy operations that only pay on collected revenue opt into option 3 deliberately.

### 4.2 Row creation — one creation site, always the approval transaction

Under **every** policy, `InstructorEarning` rows are created **inside the Revenue Review approval transaction** (doc 03 §2.6 step 5 / doc 22), one row per compensable time entry, from the frozen compensation-rate snapshot. This is deliberate and load-bearing:

- The spec itself frames creation as "after Revenue Review approval or payment"; **"earned at lesson completion" is a recognition-*dating* policy, not a pre-approval row-creation policy.** Hours are unconfirmed and rates unfrozen before approval — writing compensation facts from unapproved data would pay instructors amounts no one signed off on. Under `LESSON_COMPLETION` the row is still born at approval; what changes is `earnedAt` (the reporting bucket) = the **service date**, so compensation lands in the accounting period the instruction actually happened — exactly what an accountant means by earned-at-lesson-completion (the same accrual-dating move as Tax Collected bucketing on `TaxSnapshot.serviceDate`, doc 12 §2.8).
- One creation site keeps the approval snapshot complete, keeps `timeEntryId @unique` trivially safe, and means doc 03's approval-transaction contents list stays true verbatim for every policy.
- What varies per policy is the **birth status** and the **`earnedAt` stamp**:

| Policy | Row created (tx) | Birth status | `earnedAt` | Accrual journal (§7) |
|---|---|---|---|---|
| 1 — Lesson completion | Approval tx | `APPROVED` | **Service date**: dispatch-backed → `RevenueReview.flightDate`; ground-only → the time entry's `scheduleEvent` start date, else review `createdAt` (deterministic order) | In the approval tx |
| 2 — Review approval (default) | Approval tx | `APPROVED` | Approval timestamp | In the approval tx |
| 3 — Payment succeeds | Approval tx | `HELD` | `null` until release; stamped at settlement release | Deferred to release tx |
| 4 — ACH settlement hold | Approval tx | `HELD` **iff the collection path is ACH** (review's `PaymentMethodReference.type = US_BANK_ACCOUNT`, or timing policy `ACH_ONLY_BATCH`); otherwise `APPROVED` | Settlement time / approval time respectively | Release tx / approval tx |
| 5 — Manual approval (`SEPARATE_APPROVAL`, any event) | Approval tx | `PENDING` (or `HELD` first, when combined with 3/4 — hold wins; release lands in `PENDING`) | Stamped when the row enters `APPROVED` | Human-approval tx |

Boundary rules:

- **Zero-compensation reviews** (no compensable entries, or no resolved compensation rate — doc 04's warn-only default): no rows; the doc 04 §2.7 gap report and manual-earning path recover late onboarding.
- **Zero-total reviews** (review APPROVED→PAID with no attempt, doc 09 §5.2): compensable time still earns. Under policies 3/4 the review's direct `PAID` transition is a release trigger (§6.3) — instructor pay never depends on there being a charge.
- **Manual additive earnings** (doc 04 §2.7) are born `APPROVED` (`PENDING` under `SEPARATE_APPROVAL`) in their own transaction with `earnedAt` = recording time; recognition-event holds do not apply (the human recording it *is* the decision).
- **Method switched to ACH after approval** under policy 4 (card failed, retried on bank): rows already born `APPROVED` are **not** retroactively held — recognition happened; the ACH-return clawback path (§6.5) covers the residual risk. Stated so nobody "fixes" it into a retroactive mutation.

---

## 5. Status machine (canonical transition table)

States: `PENDING`, `APPROVED`, `HELD` (new), `EXPORTED`, `REVERSED` (terminal). `PAID` reserved (Part 3, D44). Draft/Adjusted are derived (§3). Every transition is a **guarded `updateMany` claim** (`WHERE id AND status = expected`, count 0 → 409/no-op) — the ADR-033 idiom — so webhook replays and double-clicks are structurally idempotent. Rows are append-only: `status`, `approvedByUserId/approvedAt`, `earnedAt`, `exportJobId/exportedAt` are the **only** mutable columns; `hours`/`rate`/`amount` never change (corrections are signed rows, §6.4).

| # | From → To | Trigger | Actor / mechanism | Transaction |
|---|---|---|---|---|
| T1 | *(created)* → `APPROVED` | Review approval, policies 1–2 (or 4 on a non-ACH path) with `AUTO_ON_REVIEW_APPROVAL`; manual additive earning | Approval engine (`src/lib/revenue-review.ts` step 5); `revenue.compensation_manage` for manual rows | Approval tx / own tx |
| T2 | *(created)* → `PENDING` | Review approval under `SEPARATE_APPROVAL` (recognition already satisfied at approval) | Approval engine | Approval tx |
| T3 | *(created)* → `HELD` | Review approval under policy 3 (all methods) or policy 4 (ACH path) | Approval engine | Approval tx |
| T4 | `PENDING` → `APPROVED` | Explicit compensation approval | Human holding `revenue.compensation_approve` — **never the earning's own instructor** (engine compares instructor userId to session userId; doc 12 §6) | Route tx: guarded claim + `approvedByUserId/approvedAt` + `earnedAt` + accrual journal |
| T5 | `HELD` → `APPROVED` | Review fully collected: `payment.succeeded` / ACH settlement webhook reduce (doc 23), offline payment recording settling the invoice, or zero-due `PAID` transition — under `AUTO_ON_REVIEW_APPROVAL` | Webhook reducer / payments route — system actor (`system:webhook-reducer`), audited | Settlement/reducer tx (same tx as the `Payment` row + review transition) — **async hop from approval** |
| T6 | `HELD` → `PENDING` | Same settlement triggers as T5, under `SEPARATE_APPROVAL` | Webhook reducer / payments route | Settlement tx |
| T7 | `HELD` → `APPROVED` (early release) | Explicit override: "Release compensation before settlement" — **reason required**, audited `revenue.earning_release_override` | Human holding `revenue.compensation_approve` | Route tx: guarded claim + journal |
| T8 | `APPROVED` → `EXPORTED` | Compensation Financial Export run marks included rows atomically with the manifest ([12](./12-revenue-allocation-and-reporting.md) §2.7) | `FinancialExportJob` (`INSTRUCTOR_COMPENSATION_CSV`) — **Part 3 executes**; `revenue.exports_run` | Export tx |
| T9 | `PENDING` \| `HELD` \| `APPROVED` \| `EXPORTED` → `REVERSED` | Reversal family nets to exactly 0: void (always auto, doc 03 §6.4), refund/dispute clawback per policy (§6.4–6.6, doc 26), `PENDING` rejection, manual correction | Void engine / refund engine (`AUTO_REVERSE`) / human decision on a proposal (`REQUIRE_APPROVAL`) — reason required | Same tx that appends the final offsetting reversal row |
| T10 | `EXPORTED` → `PAID` | **Reserved — no writer in Parts 2–3 until D44 resolves.** | — | — |

Notes: `REVERSED` originals keep their `exportJobId`/`exportedAt` stamps (history preserved). There is no transition out of `REVERSED`. There is no `APPROVED → PENDING` (un-approval does not exist; a wrong approval is corrected by reversal + re-record). `HELD` rows whose payment **fails** stay `HELD` (§6.5) — failure is not a state change here, only settlement or reversal is.

---

## 6. Sequences (transaction boundaries; async hops marked)

### 6.1 Review approval (extends doc 03 §2.6 / doc 22 — one `db.$transaction`)

1. *(steps 1–4 per doc 03: guarded claim to APPROVED, server-side Decimal totals, invoice freeze, `approvalSnapshot`)*
2. Compensation engine (`src/lib/instructor-compensation.ts`, pure) receives the frozen time entries + resolved COMPENSATION rate snapshot and returns rows to write: `{instructorId, timeEntryId, category, hours, rate, amount, currency, classification, rateProfileId/Version, rateSource, birthStatus, earnedAt}` per §4.2. Quantity basis honors `compensationUsesBilledQuantity`; `amount = round-half-up(hours × rate)` in Decimal.
3. Write `InstructorEarning` rows.
4. For rows born `APPROVED`: post the accrual journal legs (§7) via `src/lib/ledger.ts` in the same tx.
5. *(rest of doc 03 step 5: ScheduledCharge, TaxSnapshot, allocations, PlatformFee, approval journal)*
6. **Commit. Post-commit only:** `recordAudit('revenue.earning_recorded', …)`, notifications per doc 31 (instructor: "Compensation recorded/approved/held pending payment" per policy). No provider calls anywhere in this tx.

### 6.2 Manual compensation approval (`SEPARATE_APPROVAL`)

`POST /api/revenue/compensation/[id]/approve` — thin route: `authorize('revenue.compensation_approve', { mutating: true })` → zod → engine:

1. **Tx:** guarded claim `PENDING → APPROVED`; refuse if the earning's instructor resolves to the session user (self-approval — engine rule, not a role check); stamp `approvedByUserId/approvedAt/earnedAt`; post accrual journal.
2. Post-commit: `recordAudit('revenue.compensation_approved')`; notification (`COMPENSATION_APPROVED`, doc 31).

Rejection is not a status: rejecting a `PENDING` earning appends a full reversal row + `REVERSED` mark (T9) with required reason — the record that time was worked is never deleted.

### 6.3 Settlement release of `HELD` rows — *async hop*

Trigger sites (all reduce to one engine function, `releaseHeldEarnings(tx, revenueReviewId, mode)`):

- **Webhook reduce** (doc 23): `payment.succeeded` (card capture) / ACH settlement event → inside the reducer's tx, after the `Payment` row and review transition, when the invoice's Amount Due (derived, ADR-035) reaches zero.
- **Offline payments route**: recording cash/check that settles the invoice.
- **Zero-due approval path** (doc 09 §5.2): review goes directly `APPROVED → PAID`.

In that same tx: guarded `updateMany` `HELD → APPROVED` (or `→ PENDING` under `SEPARATE_APPROVAL`) for all earnings of the review; stamp `earnedAt = settlement time`; post accrual journals for rows entering `APPROVED`. Post-commit: audit (`revenue.earning_held_released`, actor `system:webhook-reducer` or the recording user) + notifications. Replay-safe: a duplicate webhook re-runs the claim and matches zero rows. **Partial collection does not release** — release requires the review fully collected (`PAID`); partials are visible in the Held-aging queue (§12). Simpler-workflow choice: full-settlement release over pro-rata partial release — pro-rata compensation on partial collections is unexplainable to an instructor and unreconcilable for an accountant.

### 6.4 Refund clawback (ties to doc 26 and [08](./08-adjustments-discounts-credits.md))

Two org knobs compose (both Part 1, unchanged): **scope** — `instructorClawbackPolicy` (`SERVICE_LINES_ONLY` default: only refunds touching the instruction lines that earned the compensation; `ALWAYS_PRO_RATA`: any refund implicates comp proportionally; `NEVER`: school absorbs) — and **behavior** — `compensationRefundPolicy` (`REQUIRE_APPROVAL` default / `AUTO_REVERSE` / `NEVER`, i.e. claw back with a human decision, claw back automatically, or school absorbs).

When a REFUND `RevenueAdjustment` is APPLIED and its refund executes (doc 26):

1. Engine computes implicated earnings and clawback amounts: proportional to the refunded instruction amount, Decimal, largest-remainder across multiple earnings, half-up division; **capped at each family's remaining net** (never reverse below zero).
2. `AUTO_REVERSE`: in the refund's own tx, append reversal rows (negative `amount`, `reversesEarningId`, `adjustmentId` = the REFUND adjustment, `reversalReason`, born `APPROVED` with `approvedByUserId` = refund approver), post reversing journals for originals that had accrued (§7), stamp `REVERSED` where net hits 0. Post-commit: audit `revenue.compensation_reversed` + instructor notification.
3. `REQUIRE_APPROVAL`: no rows in the refund tx. A **reversal proposal** appears in the dashboard queue — *derived*, not stored: refund adjustments implicating compensation with neither reversal rows nor a `CompensationReversalDecision` recorded. Deciding it (`revenue.compensation_approve`, reason required):
   - **Approve clawback** → tx: `CompensationReversalDecision(outcome: REVERSED)` + reversal rows + journals + terminal marks, as in step 2.
   - **Decline (school absorbs)** → tx: `CompensationReversalDecision(outcome: DECLINED)` + reason. The decision row is what removes the item from the queue — load-bearing queue state never lives only in `AuditLog` (audit is best-effort, doc 13).
4. `NEVER`: nothing; the refund audit payload notes `compensationImpact: "none (org policy)"`.

**Voids always auto-reverse** every non-reversed earning of the review regardless of both knobs (Part 1 binding, doc 03 §6.4) — a review that should never have existed pays nobody. Reversals of rows that never accrued (`PENDING`/`HELD`) post **no journal** (nothing was posted to reverse).

### 6.5 ACH return — *async hop* (doc 23 webhook → doc 25/26 handling)

- **Return before settlement** (payment failed within the pending window): review → Payment Failed (doc 09). Earnings: `HELD` rows **stay `HELD`** — recognition simply hasn't happened; they surface in Held-aging and release whenever collection eventually succeeds (retry, new method, manual invoice, offline). Already-`APPROVED` rows (policies 1/2/5) are untouched by a mere failure — the school still owes the instructor unless a refund/void/write-off flow says otherwise.
- **Return after settlement / after recognition** (late administrative or unauthorized-debit returns, NACHA 60-day consumer window — doc 09 §2.6): the reversal-shaped provider event routes through doc 26's adjustment machinery, and compensation follows **the same clawback flow as §6.4** (spec Part Y: "Returned after recognition → Reversed + adjustment records", executed per org policy). Reuses `compensationRefundPolicy` — one knob for "collection went backwards" (see Open question 3 on whether returns deserve a stricter default than refunds).

### 6.6 Disputes (doc 26)

Dispute **opened**: no compensation effect — an instructor is never docked on an accusation. Dispute **LOST** (funds withdrawn): treated as a refund for compensation purposes — §6.4 flow under the same two knobs. Dispute WON / WARNING_CLOSED: no effect.

### 6.7 Export (Part 3 seam)

`FinancialExportJob` kind `INSTRUCTOR_COMPENSATION_CSV` (shape per [12](./12-revenue-allocation-and-reporting.md) §2.7): selects `APPROVED` earnings (and `APPROVED` reversal rows, netting exported originals) for the period/filters; marks included rows `EXPORTED` + `exportJobId`/`exportedAt` **in the same transaction that finalizes the manifest**; per-row errors, checksum, file as `Document`. Part 2 ships the columns, statuses, and this contract; Part 3 ships the job runner and CSV generation. Nothing in Part 2 writes `EXPORTED`.

---

## 7. Ledger interaction (refinement of [12](./12-revenue-allocation-and-reporting.md) §2.5)

**Rule: the compensation accrual journal (`DEBIT INSTRUCTOR_COMP_EXPENSE / CREDIT INSTRUCTOR_COMP_PAYABLE`, `sourceType: "InstructorEarning"`) posts in the same transaction in which the earning enters `APPROVED`.**

- Default orgs (rows born `APPROVED` at approval): the legs ride the review-approval journal — doc 12's posting matrix, verbatim.
- `SEPARATE_APPROVAL` / `HELD` rows: legs post at T4/T5/T7, in their own journal. This is the only reading under which doc 12's own invariant **R6** (`INSTRUCTOR_COMP_PAYABLE` balance = Σ approved, non-reversed earning amounts, net of reversals) holds continuously; the posting-matrix row described the default mode.
- Earning reversal: `DEBIT INSTRUCTOR_COMP_PAYABLE / CREDIT INSTRUCTOR_COMP_EXPENSE` (doc 12 matrix), posted only when the reversed original had accrued.
- Instructor compensation remains **deliberately not a `RevenueAllocation` category** (doc 12 §1 / spec Part X note): it is a cost-side record paid from `SCHOOL_RETAINED_REVENUE`. Doc 28 owns the allocation side; nothing here writes allocation rows.
- New reporting figure, not a new invariant: **Held compensation** = Σ `HELD` amounts (no ledger presence by design — unrecognized). R6 unchanged.

---

## 8. Configuration surface

### Org-level (`RevenueSettings` — typed columns, absent row = defaults; zod-validated PATCH + before/after audit)

| Setting | Type | Default | Meaning |
|---|---|---|---|
| `compensationRecognitionEvent` | **New enum** `CompensationRecognitionEvent` | `REVIEW_APPROVAL` | §4: `LESSON_COMPLETION` \| `REVIEW_APPROVAL` \| `PAYMENT_SETTLED` \| `ACH_SETTLEMENT_HOLD` |
| `compensationApprovalMode` | Part 1, unchanged | `AUTO_ON_REVIEW_APPROVAL` | Born `APPROVED` vs born `PENDING` (`SEPARATE_APPROVAL`) |
| `compensationRefundPolicy` | Part 1, unchanged | `REQUIRE_APPROVAL` | Clawback behavior on refunds / late ACH returns / lost disputes (voids always auto-reverse) |
| `instructorClawbackPolicy` | Part 1, unchanged | `SERVICE_LINES_ONLY` | Clawback scope |
| `compensationUsesBilledQuantity` | Part 1, unchanged | `true` | Pay on normalized billable quantity vs entered hours |
| `allowCompensationLinkedToBilling` | Part 1, unchanged | `false` | `percentOfBilling` gate (principle 6) |

`RevenueWorkflowPolicy.instructorSeesOwnCompensation` (Part 1, default `false`) continues to gate only the in-review Allocation display; the My Compensation surface rides the permission key (§11).

### Platform-level

**None.** Instructor compensation has no platform-owned knobs and no platform fee interaction beyond what doc 27 already defines (platform fee is computed on collected revenue, never on compensation). Platform staff have no compensation visibility surface in Part 2.

---

## 9. Data model additions (Prisma-flavored; final call in doc 34)

### 9.1 Additive changes to `InstructorEarning` (doc 13 §4.7 shape otherwise exact)

```prisma
enum InstructorEarningStatus {
  PENDING
  APPROVED
  HELD      // NEW (Part 2): recognized-at-payment policies; releases on settlement (§6.3)
  EXPORTED
  REVERSED
  // PAID still deliberately absent — D44 / Part 3 (additive when decided)
}

model InstructorEarning {
  // ... all doc 13 §4.7 fields unchanged ...

  earnedAt     DateTime?          // NEW: recognition date — the reporting bucket (§4.2);
                                  // null while PENDING/HELD; = service date under LESSON_COMPLETION
  adjustmentId String?            // NEW: on reversal rows created by a refund/void/dispute —
                                  // structural provenance to the driving RevenueAdjustment

  adjustment RevenueAdjustment? @relation(fields: [adjustmentId], references: [id], onDelete: Restrict)
  reversalDecisions CompensationReversalDecision[]

  @@index([organizationId, instructorId, earnedAt]) // NEW: period reports bucket on earnedAt
}
```

Spec field-list coverage on the canonical shape: Organization → `organizationId`; Instructor → `instructorId`; **Lesson → derived via `timeEntry.scheduleEventId`** (reversal rows reach it through `reversesEarning`); Revenue Review → `revenueReviewId`; Time category → `category` + `customLabel`; Hours → `hours`; Rate → `rate`; Gross compensation → `amount` (signed); Adjustment → the reversal family (`reversesEarningId`, `adjustmentId`, `reversalReason`); Status → `status`; Earned date → `earnedAt` (new); Approved date → `approvedAt`; Exported date → `exportedAt`; **Paid date → deferred per spec's own "if later supported" (D44)**; Classification → `classification`; Notes → `notes`.

### 9.2 New enum + `RevenueSettings` column

```prisma
enum CompensationRecognitionEvent {
  LESSON_COMPLETION
  REVIEW_APPROVAL
  PAYMENT_SETTLED
  ACH_SETTLEMENT_HOLD
}

// RevenueSettings (doc 13 §4.14) gains:
//   compensationRecognitionEvent CompensationRecognitionEvent @default(REVIEW_APPROVAL)
```

No policy snapshot column on the earning row: a `HELD` row's release condition is uniform (full settlement / review `PAID`) regardless of which policy created it, so nothing about the row's lifecycle depends on re-reading org config (R25 satisfied — the state machine runs on the status enum alone).

### 9.3 New model — `CompensationReversalDecision` (append-only)

The one genuinely new table: the durable outcome of a `REQUIRE_APPROVAL` clawback proposal (§6.4 step 3). Follows the `DispatchRestrictionDecision` idiom (immutable one-time decision record); without it, a declined clawback either haunts the queue forever or vanishes into best-effort audit.

```prisma
enum CompensationReversalOutcome {
  REVERSED  // clawback approved — reversal row(s) created in the same tx
  DECLINED  // school absorbs — earning stands
}

model CompensationReversalDecision {
  id             String @id @default(cuid())
  organizationId String

  earningId    String   // the implicated primary earning
  adjustmentId String   // the driving REFUND/VOID/dispute RevenueAdjustment

  outcome           CompensationReversalOutcome
  reversalEarningId String? @unique   // set iff outcome = REVERSED
  reason            String            // required both ways (engine-enforced)
  decidedByUserId   String?
  decidedByLabel    String

  createdAt DateTime @default(now())

  organization    Organization      @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  earning         InstructorEarning @relation(fields: [earningId], references: [id], onDelete: Restrict)
  adjustment      RevenueAdjustment @relation(fields: [adjustmentId], references: [id], onDelete: Restrict)
  reversalEarning InstructorEarning? @relation("DecisionReversalRow", fields: [reversalEarningId], references: [id], onDelete: Restrict)

  @@unique([adjustmentId, earningId])         // one decision per (adjustment × earning) — replay guard
  @@index([organizationId, createdAt])
}
```

Housekeeping (same slice, house rules): `CompensationReversalDecision` joins `org-snapshot.ts` `TableKey`/capture/wipe/restore — wipe order: **before** `InstructorEarning` (Restrict FKs), i.e. prepended to doc 13 §10 step 13. Seed fixtures (both demo orgs): earnings in `APPROVED`/`HELD`/`PENDING`/`EXPORTED`-shaped states, one reversal family, one `DECLINED` decision, one contractor-classified instructor — demo1234 logins untouched. `STATUS_TONE` entries: `HELD` (attention/amber family) plus the derived Adjusted badge tone, registered once.

Migrations: all additive; enum value + columns + table ride the Part 2 compensation slice per [14-migration-plan.md](./14-migration-plan.md) ordering (after M14's earnings table exists; two-step rule if M14 already shipped).

---

## 10. Validation & business rules

1. All Part 1 rules from doc 04 §5 stand unchanged (Decimal-only math, single rounding site, exactly-one-of rate/percentOfBilling, kind separation contract test, append-only earnings).
2. **Birth status matrix (§4.2) is engine-owned and contract-tested** — a pure function `(recognitionEvent, approvalMode, methodType, timingPolicy) → { birthStatus, earnedAtBasis }` with the full matrix as fixtures.
3. `earnedAt` is written exactly once, at `APPROVED`-entry (value per §4.2); never recomputed; reversal rows carry their own `earnedAt` = reversal approval time so corrections bucket into the **current** period (a closed period is never restated — doc 12 tax-correction precedent).
4. Reversal rows: `reversesEarningId` + `reversalReason` required; `adjustmentId` required when driven by a refund/void/dispute; family net ≥ 0 enforced in-tx (Decimal); `REVERSED` stamped iff net = 0. Reversing a reversal row is refused — over-reversal is corrected by a positive row referencing the original.
5. Positive correction rows (under-payment fixes) are legal signed rows via the doc 04 §2.7 manual path; same reason/audit requirements.
6. Journals: accrual posts only at `APPROVED`-entry (§7); reversal journals only for accrued originals; every journal balanced, one currency, `sourceType: "InstructorEarning"` — sole writer `src/lib/ledger.ts` in the same tx.
7. Release (T5/T6) requires the wrapped invoice fully collected (derived Amount Due = 0 within the settlement tx); partial payments never release; guarded claims make every trigger idempotent under webhook replay (doc 23 tests).
8. Tenancy: every route org-scoped from the session; `earningId`/`adjustmentId` verified org-owned; cross-tenant → 404. Currency of earnings = review currency (single org currency, Part 1).
9. No AI pathway approves, releases, reverses, or records compensation (constitution rule 8); read-only impersonation blocks all compensation mutations.
10. `CompensationReversalDecision` is append-only: no update/delete API.

---

## 11. RBAC, approvals & audit

### Permissions (existing Part 1 keys — **no new keys needed**; data in `src/lib/permissions.ts`)

| Key | Grants (Part 2 scope) | Default bundles |
|---|---|---|
| `revenue.compensation_view` | View **all** Instructor Compensation records, queues, and reports | ACCOUNT_OWNER, SCHOOL_ADMIN, ACCOUNTANT |
| `revenue.compensation_view_own` | View **only own** earnings/rates ("My Compensation") — route scopes to the session user's instructor profile | INSTRUCTOR (+ the row above) |
| `revenue.compensation_approve` | T4 approvals, T7 early release (reason required), §6.4 clawback decisions | ACCOUNT_OWNER, SCHOOL_ADMIN, ACCOUNTANT |
| `revenue.compensation_manage` | COMPENSATION profiles, classification, manual additive earnings, manual corrections | SCHOOL_ADMIN, ACCOUNT_OWNER (Finance OrgRole templates) |
| `revenue.exports_run` | Part 3 export execution | per doc 12 §6 |

**Privacy (spec Part AB rejection condition — "Instructor can view another instructor's compensation without permission"):** the enforcing key is **`revenue.compensation_view_own`** — it grants *self-scope only*; any query it authorizes is filtered to the session user's instructor profile in the engine, not the UI. Cross-instructor visibility requires `revenue.compensation_view`. Students and payers never see any compensation data on any surface (doc 30 student/payer view exclusion list). A contract test asserts: instructor A with only `_view_own` requesting instructor B's earnings → 404; the compensation list route never returns rows for other instructors under `_view_own`. Separation of duties: an instructor holding `revenue.compensation_approve` cannot approve, release, or decide clawbacks on their **own** earnings (engine-enforced identity comparison, T4/T7/§6.4).

### Audit actions (`recordAudit`, every mutation, reconstruct-without-DB-state payloads)

Part 1 actions stand (`revenue.earning_recorded`, `_adjusted`, `_recorded_manual`, `earnings_exported`, `compensation_approved` / `_reversed` / `_reversal_proposed`). Part 2 adds: `revenue.earning_held_released` (T5/T6 — actor `system:webhook-reducer` or the recording user; payload: reviewId, earning ids, settlement reference), `revenue.earning_release_override` (T7 — reason required), `revenue.compensation_reversal_declined` (§6.4 — decision id, reason).

### Notifications & events (owned by doc 31)

Trigger points this doc defines: compensation recorded (per policy wording), compensation approved (spec Part AA "Compensation approved" — `NotificationKind.COMPENSATION_APPROVED`, additive enum value, two-step migration), held-released, clawback proposal opened (to `revenue.compensation_approve` holders), clawback decided (to the instructor). In-app `Notification` rows only; no email claim while the email adapter is absent (Part AA). No new domain events registered by this doc — compensation transitions ride existing review/payment events; if doc 31 registers a `compensation.approved` event it must have a live emit site (constitution).

---

## 12. Reports (defined queries on earning + ledger rows — spec Part Y list)

All queries bounded/windowed, org-leading indexes (§9.1), periods bucket on **`earnedAt`** in the org `timeZone` (`PENDING`/`HELD` rows appear only in accrual/aging views, since `earnedAt` is null), read snapshotted rows only — never recomputed from current rates. Dimensions join `InstructorEarning → RevenueReview` (location) and `→ timeEntry.scheduleEvent` (lesson/program via Syllabus), per doc 12 §2.8.

| Report / queue | Grain & filters | Definition |
|---|---|---|
| Compensation by Instructor | instructor × date range | Σ signed `amount` grouped by status bucket: earned (`APPROVED`+`EXPORTED`), pending, held; hours by category |
| Compensation by Location | location × period | join review `locationId`; same figures |
| Compensation by Program | program (Syllabus) × period | join time entry → scheduleEvent → syllabus; unattributed rows in an explicit "No program" bucket, never dropped |
| Flight vs Ground split | category group × period | pure catalog fn `categoryGroup()`: FLIGHT = `FLIGHT_INSTRUCTION`; GROUND = `GROUND_INSTRUCTION, PREFLIGHT_BRIEFING, POSTFLIGHT_DEBRIEFING, ORAL_PREPARATION, CHECKRIDE_PREPARATION, STAGE_CHECK, GROUND_SCHOOL`; SIM = `SIMULATOR_INSTRUCTION`; OTHER = `ADMINISTRATIVE, CUSTOM` — contract-tested, exhaustive over the enum |
| Contractor totals / Employee totals | classification × period | group by `classification` snapshot (`CONTRACTOR` / `EMPLOYEE` / `UNSPECIFIED` shown separately, never merged) |
| Pending approval queue | org | `status = PENDING` + open clawback proposals (§6.4 derived queue) — dashboard queue-first placement (doc 30) |
| Held / awaiting settlement | org | `status = HELD` with review payment status + expected ACH settlement window (doc 09) + days-held aging |
| Export status | export filter | `status ∈ {APPROVED (unexported), EXPORTED}`, `exportJobId`, `exportedAt` — the Part 3 handoff view |
| Compensation liability tile | org, point-in-time | `INSTRUCTOR_COMP_PAYABLE` ledger balance (R6) + Held total (§7) — feeds doc 30's executive dashboard "Instructor compensation liability" |
| Contractor Compensation (calendar year) | contractor × year | doc 12 §2.8 report unchanged; accrual-based until D44 adds the payment marker |
| Compensation gap report | org | doc 04 §2.7 — approved reviews with compensable entries but no earnings (late onboarding) |

Every figure links to the rows behind it (a number without a why is a bug). Reports for a `_view_own` holder are the same queries hard-scoped to their own instructor profile.

---

## 13. Failure modes & edge cases

1. **Payment never collects (policy 3/4):** earnings sit `HELD` indefinitely by design; the Held-aging queue escalates (doc 25's failure escalation references it). Resolution paths: collection succeeds (release), review voided (auto-reverse), early release override (T7), or Part 3 write-off flow (reserved `WRITTEN_OFF` — a write-off does not auto-release or auto-reverse; it routes through the §6.4 decision so the school explicitly chooses to pay or absorb).
2. **Late ACH return after release:** §6.5 — clawback flow; never a silent edit to the released earning.
3. **Refund larger than instruction share / multiple instructors on one review:** proportional computation per earning, largest-remainder, capped at family net (§6.4.1).
4. **Webhook replay / duplicate settlement events:** guarded claims match zero rows on the second pass; decision uniqueness `[adjustmentId, earningId]` blocks duplicate clawbacks (ADR-033 posture).
5. **Instructor departs with open earnings:** `Instructor` FK is Restrict — history survives; earnings remain payable/exportable; membership removal does not touch financial rows.
6. **Classification changes:** snapshot per row at creation; historical rows never restated; reports group by the snapshot. (Disclaimer applies — §1.)
7. **Org changes recognition policy mid-flight:** affects only future approvals. Existing `HELD` rows keep the uniform release condition; an org moving off collection-based recognition clears its backlog via T7 early release (each with reason, audited) — never a bulk silent mutation.
8. **`SEPARATE_APPROVAL` org where only the instructor holds the approve key:** self-approval is refused unconditionally; the queue surfaces the stall on the dashboard and the org fixes role assignments — compensation approval has **no** `SELF_APPROVED_SOLE_USER` relaxation (unlike doc 03's review approvals: review approval blocks operations revenue; compensation approval only delays the school paying itself, and self-approved pay is exactly what separation of duties exists to stop).
9. **Earning on a review that gets `DISPUTED`:** no effect until LOST (§6.6); the dashboard shows the linkage so an accountant sees exposure.
10. **Manual earnings on a review under policies 3/4:** born per §4.2 boundary rule (`APPROVED`/`PENDING`, no hold) — the recording human is the recognition decision.
11. **Crash between settlement tx and post-commit notifications:** state is committed and correct; notifications are best-effort post-commit; the reconciliation sweep (doc 23) re-drives unprocessed provider events, and release claims are idempotent.

---

## 14. UX notes

- **My Compensation (instructor, `_view_own`):** period totals (flight/ground/sim/other hours, amount earned), rows with status chips, and — recommendation, Open question 4 — `HELD` rows shown labeled *"Held — pays when the student's payment settles (org policy)"* with the expected settlement window. Hiding held pay creates the "where's my money" support call; showing it with an honest label builds trust.
- **Status language (customer-facing):** Pending Approval / Approved / Held / Exported / Reversed; derived badges "Draft — not yet payable" (pre-approval preview) and "Adjusted" (net-affected family). Tones from `STATUS_TONE` only.
- **Settings screen:** the five-option selector (§4.1) with one consequence line each, e.g. option 3: *"Instructors accrue compensation when the review is approved, but it becomes payable only after the customer's payment settles."* The advanced `SEPARATE_APPROVAL` checkbox sits beneath.
- **Clawback proposal card:** refund number, refunded amount, implicated instructor(s), computed clawback, and two verbs — "Reverse compensation" / "School absorbs" — reason required either way. Consequence-truthful controls, per the approve-wording rule.
- **Disclaimer:** the §1 verbatim sentence renders on My Compensation, the compensation reports, the classification editor, and every compensation export preview.
- Light/dark + mobile parity; loading/empty/error states; errors actionable (*"Cannot approve your own compensation — another holder of Compensation approval must review it."*).

---

## 15. Out of scope for Part 2 / deferred to Part 3

- **Export execution** (`INSTRUCTOR_COMPENSATION_CSV` job runner, file generation, `EXPORTED` writer) — Part 3; Part 2 ships the contract (§6.7).
- **`PAID` status / externally-paid marker and paid date** — D44, Part 3 (payment-based 1099 figures). No writer in Part 2.
- **Payout execution** (Stripe transfers to instructors, payroll integrations), **1099/tax-document generation** — deferred beyond Phase 8 (doc 04 §9); the disclaimer stands meanwhile.
- **Write-off interaction** — `WRITTEN_OFF` has no writer in Parts 2–3; the §13.1 posture is designed but dormant.
- **Standalone earnings without a Revenue Review** (stipends) — still deferred (doc 04 §9).
- **Multi-currency compensation** — single org currency per Part 1.

---

## 16. Open questions

1. **Default recognition policy.** Recommendation: option 2 (`REVIEW_APPROVAL`, matching Part 1's shipped default). Confirm no launch segment (contractor-heavy academies) warrants defaulting to `PAYMENT_SETTLED` instead — this changes when instructors get paid and is a product-owner call.
2. **ACH-return clawback knob.** This design reuses `compensationRefundPolicy` for late ACH returns and lost disputes (§6.5–6.6). Argument for a stricter separate default: on a return the school never kept the money, so `AUTO_REVERSE` may be fairer there even where refunds require approval. Recommendation: one knob (simpler); needs owner + Aviation Accounting Specialist confirmation.
3. **Early-release threshold.** T7 requires `revenue.compensation_approve` + reason. Should releases above a dollar threshold require a second approver (mirroring `RevenueWorkflowPolicy` second-approval families)? Recommendation: no in Part 2 (audited single approval), revisit with real usage.
4. **Held visibility to instructors.** Recommendation: show `HELD` rows labeled in My Compensation (§14). Confirm schools are comfortable exposing collection state ("payment not yet settled") to instructors at that granularity.
5. **For the Part 1 refresh owners (consistency, not a product call):** doc 12 §2.5's posting-matrix row "Revenue Review approved" lists the comp-accrual legs unconditionally, while its own R6 invariant requires accrual only for `APPROVED` earnings; §7 resolves this as accrual-at-`APPROVED`-entry. Doc 12's wording should be aligned when Part 1 docs are next refreshed.
