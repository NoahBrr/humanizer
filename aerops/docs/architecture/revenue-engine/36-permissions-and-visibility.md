# Revenue Engine — Permissions & Visibility

> **Status:** Proposed — Phase 8 Part 3 · **Date:** 2026-07-11 · **Lead roles:** Security Engineer (Cloudflare); Head of Product; Database Architect · **Part of:** Revenue Engine design set ([README](./README.md))

The definitive RBAC and visibility design for the Revenue Engine. It fixes the exact permission keys, their default role bundles, the section/nav wiring, the student/payer/instructor visibility boundaries, the platform-staff-only surfaces, the server-side separation-of-duties enforcement points, impersonation coverage, the constitution-test additions, and the audit-event catalog. Everything here is **data and enforcement**, never role-name checks (CLAUDE.md §3).

This document is derived from and bound by: doc 03 (§6.1 review keys, §2.8 separation of duties), doc 04 (§6 time/rates keys), doc 05 (§ pricing keys), doc 06 (items), doc 07 (taxes), doc 08 (adjustments/discounts/credits/promo), doc 09 (charge/methods/policy), doc 10 (§6 financial holds), doc 11 (`authorizePayer()`, payer visibility), doc 12 (§6 allocation/exports/reconciliation keys), doc 19 (§ Connect keys), doc 26 (§ refund/dispute keys), doc 27 (§8 platform-fee keys), doc 29 (§ compensation keys/privacy), doc 30 (§11 dashboard RBAC + nav). Model/enum/status names are canonical from **13-database-model.md** and **34-part2-database-additions.md**. On any conflict, 13/34 win and it is logged in Open questions — never silently diverged.

**D3 is resolved (a): one `revenue.*` prefix.** Per doc 16 D3, the adjustment/refund/promo keys that docs 08/11 introduced as `billing.*` are renamed to `revenue.*` in this consistency pass so the catalog is single-brain and `MODULE_BY_PREFIX` needs exactly one new entry. Renames: `billing.adjust → revenue.adjust`, `billing.adjust_approve → revenue.adjust_approve`, `billing.promo_manage → revenue.promo_manage`. (`billing.refund`/`billing.refund_approve` were already re-pointed to `revenue.refund`/`revenue.refund_approve` in doc 26.) `billing.view` and `billing.record_payments` keep their names and meanings (they gate the legacy invoice surfaces and offline payment recording, doc 30 §3).

---

## 1. Permission catalog additions (`src/lib/permissions.ts`)

All keys below are **new** entries in the `PERMISSIONS` map. They module-gate to `billing` through the single `MODULE_BY_PREFIX` addition in §5. Descriptions are the user-facing strings for the role editor.

| Key | Description | Owning doc |
|---|---|---|
| `revenue.review_view` | View Revenue Reviews (instructors: own reviews only — engine-scoped) | 03 |
| `revenue.review_create` | Create manual Revenue Reviews (instructors: own completed sessions only) | 03 |
| `revenue.review_submit` | Submit a review for approval; resubmit after Changes Requested | 03 |
| `revenue.review_edit` | Edit charges/lines pre-approval (not instructor time) | 03 |
| `revenue.approve` | Approve (OPERATIONS/SECOND kinds), request changes, escalate | 03 |
| `revenue.approve_routine` | Instructor self-approval of routine reviews (active only when policy allows) | 03 |
| `revenue.approve_finance` | Record the FINANCE approval kind; set `accountingClosedThrough` | 03, 07 |
| `revenue.charge` | Initiate/retry/cancel a charge on an approved review; run the due-payments pass | 09 |
| `revenue.void` | Void a review pre-approval, or post-approval while uncharged | 03 |
| `revenue.refund` | Request refunds / partial refunds | 26 |
| `revenue.refund_approve` | Approve refunds; retry/cancel FAILED refunds | 26 |
| `revenue.dispute_manage` | Attach evidence, mark evidence submitted, add dispute outcome notes | 26 |
| `revenue.adjust` | Create/request adjustments: discount, waiver, credit, correction, promo redemption, payer transfer | 08 |
| `revenue.adjust_approve` | Approve/reject/apply adjustments; act as second approver | 08 |
| `revenue.promo_manage` | Create/edit/deactivate promo codes | 08 |
| `revenue.time_entry` | Enter/edit/confirm **own** instructor time on eligible reviews | 04 |
| `revenue.time_override` | Enter/edit/override/recategorize **any** instructor's time (reason required post-submit) | 04 |
| `revenue.pricing_view` | View aircraft pricing profiles, history, resolution reasons | 05 |
| `revenue.pricing_manage` | Create/edit/delete DRAFT pricing profiles; new versions; archive | 05 |
| `revenue.pricing_approve` | Approve/supersede pricing profiles (electronic signature) | 05 |
| `revenue.rates_view` | View instructor billing-rate profiles | 04 |
| `revenue.rates_manage` | Create/edit DRAFT billing-rate profiles | 04 |
| `revenue.rates_approve` | Approve/supersede/archive billing-rate profiles | 04 |
| `revenue.items_manage` | Manage the Revenue Item catalog (availability, accounting category) | 06 |
| `revenue.taxes_manage` | Create/version/deactivate tax rules; change org tax settings | 07 |
| `revenue.payment_methods_manage` | Start hosted method-setup on a payer's behalf; detach methods | 09, 20 |
| `revenue.payment_policy_manage` | Edit `OrgPaymentPolicy` (payment timing/collection) | 09 |
| `revenue.financial_hold_manage` | Place and lift financial holds | 10 |
| `revenue.connect_manage` | Initiate/continue Connect onboarding, accept terms, manual status sync | 19 |
| `revenue.allocation_view` | See the Allocation section incl. platform fee and compensation totals | 12 |
| `revenue.compensation_view` | View **all** Instructor Compensation records, queues, reports | 29 |
| `revenue.compensation_view_own` | View **only own** earnings/rates ("My Compensation") — engine-scoped | 29 |
| `revenue.compensation_approve` | Approve/release earnings; decide clawbacks — never on own earnings | 29 |
| `revenue.compensation_manage` | Manage COMPENSATION profiles, classification, manual additive earnings | 29 |
| `revenue.reconciliation_manage` | View/resolve/ignore reconciliation exceptions; trigger verification runs | 12 |
| `revenue.exports_run` | Create/download `FinancialExportJob`s; manage `AccountingMapping` | 12 |
| `revenue.self_view` | See **own** financials only (My Payments / student self-view) — engine-scoped to session identity | 30 |

Note the **rates vs. pricing split is intentional and preserved**: `revenue.rates_*` gate instructor billing-rate profiles (doc 04); `revenue.pricing_*` gate aircraft pricing profiles (doc 05). They are different money-configuration surfaces with different approval trails, so they stay separate keys.

`revenue.self_view` is not a staff key. It grants access to the *shape* of the self-view surface; the **data** is always scoped to the session's own identity in the engine (§6), so the key alone never exposes another person's rows.

---

## 2. Full permission matrix — capability × base role

Columns are the seven `Role` enum values under their `ROLE_LABELS` display names. `SUPER_ADMIN` (legacy Account Owner) mirrors `ACCOUNT_OWNER` and is omitted; both carry `ALL_PERMISSIONS`. **●** = held by default. **○(own)** = held but engine-scoped to the actor's own records. **—** = not held; grantable via a custom OrgRole. Account Owner and Operations Director hold **every** key (they are `ALL_PERMISSIONS`), so their column is uniformly ●.

| Capability (key) | Account Owner | Operations Director | Flight Dispatcher | Flight Instructor | Student Pilot | Maintenance Mgr | Finance Manager |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| View queue / reviews (`revenue.review_view`) | ● | ● | ● | ○(own) | — | — | ● |
| Create manual review (`revenue.review_create`) | ● | ● | — | ○(own) | — | — | ● |
| Enter own instructor time (`revenue.time_entry`) | ● | ● | — | ○(own) | — | — | — |
| Override any instructor time (`revenue.time_override`) | ● | ● | — | — | — | — | — |
| Edit draft review lines (`revenue.review_edit`) | ● | ● | — | — | — | — | — |
| Submit review (`revenue.review_submit`) | ● | ● | — | ● | — | — | — |
| Approve + charge (`revenue.approve`) | ● | ● | — | — | — | — | — |
| Instructor routine self-approve (`revenue.approve_routine`) | — ¹ | — ¹ | — | — ¹ | — | — | — |
| Second/finance approval (`revenue.approve_finance`) | ● | ● | — | — | — | — | ● |
| Initiate/retry charge (`revenue.charge`) | ● | ● | — | — | — | — | ● |
| Add manual Revenue Item (`revenue.items_manage` cat.) ² | ● | ● | — | — | — | — | ● |
| Apply discount/credit (`revenue.adjust`) | ● | ● | — | — | — | — | ● |
| Approve adjustment (`revenue.adjust_approve`) | ● | ● | — | — | — | — | ● |
| Manage promo codes (`revenue.promo_manage`) | ● | ● | — | — | — | — | — |
| Void review (`revenue.void`) | ● | ● | — | — | — | — | — |
| Request refund (`revenue.refund`) | ● | ● | — | — | — | — | ● |
| Approve refund (`revenue.refund_approve`) | ● | ● | — | — | — | — | ● |
| Manage disputes (`revenue.dispute_manage`) | ● | ● | — | — | — | — | ● |
| Configure aircraft pricing — view (`revenue.pricing_view`) | ● | ● | ● | ● | — | — | ● |
| Configure aircraft pricing — manage (`revenue.pricing_manage`) | ● | ● | — | — | — | — | ● |
| Configure aircraft pricing — approve (`revenue.pricing_approve`) | ● | ● | — | — | — | — | — |
| Instructor billing rates — view (`revenue.rates_view`) | ● | ● | ● | — | — | — | ● |
| Instructor billing rates — manage (`revenue.rates_manage`) | ● | ● | — | — | — | — | ● |
| Instructor billing rates — approve (`revenue.rates_approve`) | ● | ● | — | — | — | — | — |
| Manage Revenue Items (`revenue.items_manage`) | ● | ● | — | — | — | — | ● |
| Configure taxes (`revenue.taxes_manage`) | ● | ● | — | — | — | — | ● |
| Manage payer payment methods (`revenue.payment_methods_manage`) | ● | ● | — | — | — | — | ● |
| Configure payment timing (`revenue.payment_policy_manage`) | ● | ● | — | — | — | — | — |
| Manage financial holds (`revenue.financial_hold_manage`) | ● | ● | — | — | — | — | — |
| Manage Connect onboarding (`revenue.connect_manage`) | ● | ● ³ | — | — | — | — | — |
| View org revenue reports/allocation (`revenue.allocation_view`) | ● | ● | — | — | — | — | ● |
| View **all** compensation (`revenue.compensation_view`) | ● | ● | — | — | — | — | ● |
| View **own** compensation (`revenue.compensation_view_own`) | ● | ● | — | ○(own) | — | — | ● |
| Approve/release compensation (`revenue.compensation_approve`) | ● | ● | — | — | — | — | ● |
| Manage compensation profiles (`revenue.compensation_manage`) | ● | ● | — | — | — | — | — |
| Reconciliation queue (`revenue.reconciliation_manage`) | ● | ● | — | — | — | — | ● |
| Run exports (`revenue.exports_run`) | ● | ● | — | — | — | — | ● |
| Self-view own financials (`revenue.self_view`) | — ⁴ | — ⁴ | — | — | ● | — | — |
| Record offline payment (`billing.record_payments`, existing) | ● | ● | ● | — | — | — | ● |
| View legacy billing surfaces (`billing.view`, existing) | ● | ● | ● ⁵ | — | — | — | ● |

¹ `revenue.approve_routine` ships in **no** default bundle. It is granted implicitly when an org turns on `RevenueWorkflowPolicy.instructorMayApproveRoutine` (the enabling role gains it, doc 03 §7); it never confers approval on non-routine or risk-flagged reviews.
² "Add manual Revenue Item line to a review" is authorized by the reviewer's `revenue.approve` on the review plus the item catalog being managed under `revenue.items_manage`; damage-fee items carry the HIGH-risk floor (§9). It is not a separate line-add key.
³ Connect onboarding default holder is **Account Owner**; whether Operations Director (`SCHOOL_ADMIN`) also holds it is doc 19 Open question 1 (carried in §13).
⁴ Owners/admins are staff, not their own customers; they see all financials through the staff surfaces, so they do not carry `revenue.self_view`. A staff user who is *also* a student holds both key sets and sees both surfaces; the identities never blend (doc 30 §12, ADR-031).
⁵ Flight Dispatcher gains `billing.view` under the D34 fix (see §3). Maintenance Manager holds no revenue or billing keys.

---

## 3. Default bundle deltas & OrgRole templates

### 3.1 `DEFAULT_ROLE_PERMISSIONS` additions

`ACCOUNT_OWNER`, `SUPER_ADMIN`, `SCHOOL_ADMIN` are `ALL_PERMISSIONS` — every new key is theirs with no listing change. The remaining base roles gain exactly:

- **DISPATCHER (Flight Dispatcher):** `revenue.review_view`, `revenue.rates_view`, `revenue.pricing_view`, **`billing.view`** (D34 fix — resolves the "records payments but can't see Billing" wart; existing org grants are untouched, new-org seed only).
- **INSTRUCTOR (Flight Instructor):** `revenue.review_view` (own), `revenue.review_create` (own sessions), `revenue.review_submit`, `revenue.time_entry`, `revenue.compensation_view_own`, `revenue.pricing_view`.
- **STUDENT (Student Pilot):** `revenue.self_view` (this is the "no billing/balance nav home" fix, ROLES_AND_WORKSPACES.md gap 6).
- **MAINTENANCE (Maintenance Manager):** none.
- **ACCOUNTANT (Finance Manager):** `revenue.review_view`, `revenue.review_create`, `revenue.approve_finance`, `revenue.charge`, `revenue.refund`, `revenue.refund_approve`, `revenue.dispute_manage`, `revenue.adjust`, `revenue.adjust_approve`, `revenue.pricing_view`, `revenue.pricing_manage`, `revenue.rates_view`, `revenue.rates_manage`, `revenue.items_manage`, `revenue.taxes_manage`, `revenue.payment_methods_manage`, `revenue.allocation_view`, `revenue.compensation_view`, `revenue.compensation_view_own`, `revenue.compensation_approve`, `revenue.reconciliation_manage`, `revenue.exports_run`.
  - Finance Manager deliberately does **not** get `revenue.approve` (customer-facing operational approval is an operations act, not a bookkeeping act), `revenue.void`/`revenue.time_override`/`revenue.review_edit`/`revenue.review_submit` (operational edits), `revenue.pricing_approve`/`revenue.rates_approve` (approval authority is owner/ops), `revenue.promo_manage`/`revenue.payment_policy_manage`/`revenue.financial_hold_manage`/`revenue.connect_manage`/`revenue.compensation_manage` (owner/ops governance). This keeps the accountant a powerful *finalizer* without making them a unilateral approver — a real separation-of-duties posture, not just a rejection-condition checkbox.

### 3.2 OrgRole templates (`src/lib/role-templates.ts`, seeded rows — not enum values)

No new `Role` enum values. The named operational seats ship as `OrgRole` permission bundles (doc 01 §96, doc 03 §7):

| Template (basedOn) | Adds beyond its base, for the Revenue Engine |
|---|---|
| **Operations Director** (SCHOOL_ADMIN-shaped) | full revenue set incl. `revenue.approve`, `revenue.void`, `revenue.adjust*`, `revenue.refund`, `revenue.financial_hold_manage` |
| **Chief Flight Instructor** (INSTRUCTOR) | `revenue.approve`, `revenue.time_override`, `revenue.review_edit`, `revenue.review_view` (unscoped), `revenue.rates_view`, `revenue.allocation_view` |
| **Chief Pilot** (INSTRUCTOR) | `revenue.approve`, `revenue.review_view` (unscoped) |
| **Assistant Chief Instructor** (INSTRUCTOR) | `revenue.approve`, `revenue.time_override`, `reports.view` |
| **Front Office** (DISPATCHER) | `billing.view`, `revenue.review_view`, `revenue.payment_methods_manage` |
| **Read-Only Auditor (org)** (SCHOOL_ADMIN) | view-only revenue keys: `revenue.review_view`, `revenue.allocation_view`, `revenue.compensation_view`, `revenue.pricing_view`, `revenue.rates_view` — **no** mutate/approve keys |

"Configured approver" throughout the Revenue Engine means "any holder of `revenue.approve`," shaped by these bundles. No route or engine ever checks a template name.

---

## 4. Section wiring & nav placement

### 4.1 `SECTION_PERMISSIONS` + `SECTION_MODULES` (`src/lib/rbac.ts`, `src/lib/features.ts`)

Two new hrefs. Both are required by the constitution nav-mapping test (every `NAV_ITEMS` href must have a `SECTION_PERMISSIONS` entry). Migration posture is **expand-in-place** (doc 30 §3): `/billing` keeps its key and module; no `/revenue` top-level section.

| Href | New `SECTION_PERMISSIONS` key | New `SECTION_MODULES` module | Notes |
|---|---|---|---|
| `/billing` (existing) | `billing.view` (unchanged) | `billing` (unchanged) | Landing page becomes the Revenue Dashboard; nav **label** `Billing → Revenue` (label-only). |
| `/billing/queue` (new) | `revenue.review_view` | `billing` | Operations revenue queue. Instructors reach it but the engine scopes rows to their own reviews. |
| `/billing/my` (new) | `revenue.self_view` | `billing` | Student self-view. Data scoped to session identity in the engine. |
| `/billing/invoices`, `/billing/[id]`, `/billing/reviews/[id]` | `billing.view` (inherited prefix match not automatic — add explicit rows if they appear in `NAV_ITEMS`; deep-linked sub-routes that are not nav items need no `SECTION_PERMISSIONS` entry but their pages still call `authorize`) | `billing` | Legacy + review surfaces; route-level `authorize()` gates them regardless of nav. |

### 4.2 Nav (`src/components/shell/nav-config.ts`, Business group)

- **Rename** the existing Billing item label to **Revenue** (href `/billing`, icon `Receipt`, gate `billing.view` — all unchanged; mirrors the `ROLE_LABELS` display-language pattern).
- **Add** `Revenue Reviews` → `/billing/queue`, gate `revenue.review_view`, icon `ClipboardCheck` (lucide), Business group.
- **Add** `My Payments` → `/billing/my`, gate `revenue.self_view`, icon `Wallet` (lucide), Business group.

The `allowedPaths` flow (`(app)/layout.tsx` → `canAccessSection`) makes each item appear automatically once its permission + module + `SECTION_PERMISSIONS`/`SECTION_MODULES` entries exist. The **payer portal is deliberately not a nav item** — payers are not org members and get no sidebar (§6.2).

---

## 5. Module gating & the `authorizePayer()` boundary

### 5.1 `MODULE_BY_PREFIX` (`src/lib/session.ts`)

One line: `revenue: "billing"`. Every `revenue.*` key then module-gates behind the org's `billing` module inside `authorize()` — no per-route wiring. (`billing.*` already maps to `billing`.) This is the single binding module call doc 01 §96/§278 delegates here.

### 5.2 `authorizePayer()` — new self-service boundary (`src/lib/session.ts`)

A third gate **beside** `authorize()`/`authorizePlatform()`, per doc 11 §7.2 (single-file, single session-resolution rule preserved). Signature: `authorizePayer(opts: { mutating?: boolean })`.

- Requires any signed-in `User` (org or individual kind). **No org permission is consulted** — payers hold none.
- Resolves `session.userId → ResponsiblePayer` rows with `status = ACTIVE`, and returns the payer scope: payer rows + ACTIVE `StudentPayerRelationship`s + capability flags (`canViewInvoices`, `canManagePaymentMethods`, `fullFinancialVisibility`).
- **Scope derives entirely from the caller's own payer rows** — never an `organizationId` from the client — so a missing filter fails closed to *nothing*, not to a tenant.
- **Impersonation semantics identical to `authorize()`**: `{ mutating: true }` is refused with 403 while `session.impersonation?.readOnly` is set. "Approve and charge my saved payment method" must never fire under read-only impersonation.
- `/api/payer/*` routes are catalogued in `SELF_SERVICE_ROUTES` with written reasons and are rate-limited.

---

## 6. Student & payer visibility rules

The automatic-rejection condition is "Student can view organization-wide revenue." The structural defense is **identity-scoped engines**, not UI hiding.

### 6.1 Student self-view (`/billing/my`, `revenue.self_view`)

- Identity is resolved **server-side from the session**: `session.userId → Student (userId @unique)`. Never a client parameter (doc 30 §6).
- The self-view is served by a **dedicated engine `src/lib/revenue-self.ts`** that queries only the session student's own Revenue Reviews, invoices, receipts, Amount Due, and payment history.
- **`revenue-self.ts` must never import `revenue-dashboard.ts`** (the org-wide engine). Enforced by a static source-scan test (§11). This makes org-wide aggregates structurally unreachable from the student surface — a student cannot see school revenue, instructor compensation, platform fees, other customers, or org reports because the code path to compute them does not exist on that surface.
- A `STUDENT` session hitting `/billing`, `/billing/queue`, `/billing/invoices`, `/reports`, or `/executive` is denied — its bundle lacks `billing.view`/`revenue.review_view`/`reports.view` (contract-tested denial, doc 30 §9).

### 6.2 Payer portal (`/payer`, `authorizePayer()`)

Payers are **not** Memberships: no org role, no org nav, no org-app landing (doc 11 §7). They reach a separate `/payer` surface only.

- **Every payer query starts from the payer's relationships, never from `organizationId`** (doc 11 §7.2, V16). A payer sees financials only for records where they are the snapshotted bill-to party (`Invoice.payerId = payer`) on their **linked** students — unless a relationship's `fullFinancialVisibility` flag is set. Capability flags apply per relationship: `canViewInvoices` gates invoice detail; `canManagePaymentMethods` gates method actions.
- **A payer never sees training records** — no lesson records, endorsements, progress, schedules, or drafts. Only post-approval financials: reviews (approved), invoices, receipts, Amount Due, payment status, and their own Payment Methods.
- **Payer surface routes must not select `PlatformFee`/`PlatformFeePolicy`** (doc 27 §8.4, static-scan tested) and must return no `InstructorEarning`/`RevenueAllocation`/foreign-student data.
- A parent/guardian payer linked to two children sees only those two children's linked financials; a payer who is a global `User` across two orgs enumerates neither org by id — the relationship scope confines them (doc 16 R4).

### 6.3 Payer as the human who charges

Optional payer charge-approval makes the payer the human trigger of the charge. The control reads exactly **"Approve and charge my saved payment method — $X"** (doc 11 §3, doc 20). It is `authorizePayer({ mutating: true })`-gated, audited (`revenue_review.payer_approved` / `payer_declined`), guarded by a state-machine `updateMany` claim against double-approval, and refused under read-only impersonation. This satisfies CONSTITUTION rule 8 (a human, never AI, triggers payment).

---

## 7. Instructor own-compensation-only rule

The automatic-rejection condition is "Instructor compensation conflated with customer billing" and "instructor can view another instructor's compensation." Two structural defenses:

1. **Separate keys, separate surfaces.** Customer billing rides `billing.*`/`revenue.review_*`/`revenue.charge`. Instructor compensation rides `revenue.compensation_*` and a distinct "My Compensation" surface. They are never the same query.
2. **The enforcing key is `revenue.compensation_view_own`** — it grants *self-scope only*. Any query it authorizes is filtered **in the engine** to the session user's instructor profile, not in the UI (doc 29 §privacy). Cross-instructor visibility requires `revenue.compensation_view`, which instructors do not hold by default.

- Contract test (doc 29): instructor A holding only `revenue.compensation_view_own` requesting instructor B's earnings → **404**; the compensation-list route returns no other instructor's rows under `_view_own`.
- **Students and payers see no compensation data on any surface** (doc 30 exclusion list; enforced by §6 engine isolation).
- **Separation of duties on compensation:** an instructor holding `revenue.compensation_approve` cannot approve, release (T7 early release), or decide clawbacks on their **own** earnings — engine compares the earning's instructor `userId` to `session.userId` (doc 29 T4/T7/§6.4). Error copy: "Cannot approve your own compensation — another holder of Compensation approval must review it."

---

## 8. Platform-staff-only capabilities

Platform fee agreements and the Connect console are **platform data behind `authorizePlatform`**, on the separate `PlatformUser`/`PlatformRole` identity. These keys live in the platform permission catalog (resolved via `platformRolesWith()` / `resolvePermissions`), **not** in the org `PERMISSIONS` map. No org role, no OrgRole template, and no impersonated org session can hold them. Routes derive holder lists via `platformRolesWith()` — never hardcoded role arrays.

| Platform key | Capability | Platform-role holders |
|---|---|---|
| `platform.fees.view` | View Platform Fee Agreements, fee reports, unpriced-review flags | `FOUNDER_SUPER_ADMIN`, `FOUNDER`, `PLATFORM_ADMIN`, `BILLING_ADMIN` (+ `AUDITOR` via view-only derivation) |
| `platform.fees.manage` | Create/supersede fee agreements at any scope; delete never-effective drafts | `FOUNDER_SUPER_ADMIN`, `FOUNDER`, `PLATFORM_ADMIN`, `BILLING_ADMIN` |
| `platform.connect.view` | Connected-payments panel: status, requirements, capabilities, sync recency, opaque `acct_…` id (no balances/payouts/PII — model can't store them) | `FOUNDER_SUPER_ADMIN`, `FOUNDER`, `PLATFORM_ADMIN`, `BILLING_ADMIN`, `SUPPORT_ENGINEER`, `SOFTWARE_ENGINEER`, `CUSTOMER_SUCCESS` (+ `AUDITOR`) |
| `platform.connect.suspend` | Suspend/reinstate an org's connected account (reason required); "Sync now" | `FOUNDER_SUPER_ADMIN`, `FOUNDER`, `PLATFORM_ADMIN`, `BILLING_ADMIN` |

Enforcement invariants (automatic-rejection: "platform fee editable by organization staff"):

- **The platform fee is structurally not org-editable.** No org route, field, or UI changes fee math; org staff get read-only fee statements (doc 27 §8). A **static-scan test** asserts no route under `src/app/api/` **outside** `api/platform/**` writes `PlatformFeePolicy`/`PlatformFeeTier` (doc 27 §8.4).
- All fee-agreement and Connect-console mutations pass `authorizePlatform({ mutating: true, orgId? })` — refused under read-only impersonation and while impersonating a customer (a platform mutation during impersonation would misattribute the audit actor). Org-scoped console routes pass `orgId` for `restrictedOrgIds` enforcement (both constitution-tested).
- `SUPPORT_ENGINEER`, `CUSTOMER_SUCCESS`, `SOFTWARE_ENGINEER` get **neither** fee key — pricing is a commercial capability aligned with the existing `platform.pricing.change` boundary.
- **Org-side** Connect onboarding is a different, org-scoped capability (`revenue.connect_manage`, §1) — the org admin walks the Stripe-hosted flow; platform staff only observe/suspend. The two never overlap.

---

## 9. Separation-of-duties enforcement points (server + engine, never UI-only)

Every rule below is enforced in the **engine/route**, returning a hard **403** with a reason. The UI additionally hides/warns, but the UI is never the enforcement (automatic-rejection: "permission checks exist only in the UI"). Enforcement basis is a stored **actor id** compared to the session user — not a role name.

| # | Rule | Enforcement point | Basis |
|---|---|---|---|
| S1 | `SECOND` approval must be a **different** user than `OPERATIONS` — unconditional | Review approval engine (doc 03 §2.8) | `RevenueReviewApproval.approverUserId` ≠ session user |
| S2 | No one approves (`OPERATIONS`/`SECOND`/`FINANCE`) a review where they are the recorded actor of any **HIGH-risk** line: `DAMAGE_FEE` or `TIME_OVERRIDE` (unconditional), or policy-triggered `MANUAL_ITEM`/`DISCOUNT` over doc 08 thresholds | Approval engine | adjustment/line `actorUserId` vs session user |
| S3 | Submitting instructor cannot record `OPERATIONS` on a **risk-flagged** review; on an unflagged review a submitter with `revenue.approve` may approve (UI warns, audit notes self-approval) | Approval engine | `submittedById` vs approver + risk flags |
| S4 | Adjustment approve requires `approvedById ≠ requestedById` when policy requires; second approval captured when policy requires | Adjustment engine (doc 08 §4) | `requestedById` vs `approvedById` |
| S5 | Refund approval (`revenue.refund_approve`) is a **different** pair of eyes from the requester by default | Refund engine (doc 26) | requester vs approver |
| S6 | Instructor cannot approve/release/clawback **own** compensation | Compensation engine (doc 29 T4/T7/§6.4) | earning instructor `userId` vs session user |
| S7 | **Approval invalidation:** any post-approval financial change stamps `supersededAt` on every existing approval row and re-requires all kinds against corrected numbers | Approval engine (doc 03 §2.7) | partial unique `(revenueReviewId, kind) WHERE supersededAt IS NULL` |
| S8 | **Stale-screen guard:** the final approval claim carries `updatedAt` + `expectedTotal`; mismatch → 409 | Guarded `updateMany` claim (doc 03 §2.6) | optimistic token + total |
| S9 | `FINANCE` kind is never self-satisfiable; settings refuse to enable `financeApprovalRequired` with no second eligible approver | Policy + approval engine (doc 03 §2.8) | approver identity |
| S10 | Charge occurs **only** after all required approval kinds are recorded (never before authorized approval) | Payment engine reads the frozen approved snapshot (doc 22) | review status + approval rows |

**Single-approver relaxation (solo owner-CFI, doc 03 §2.8):** when exactly one user holds `revenue.approve`, S1–S3 auto-relax to avoid deadlock — the engine permits the approval, records it audit-flagged `SELF_APPROVED_SOLE_USER`, and keeps risk flags for reporting. HIGH-risk items (damage fees) still require the audited sole-user exception (mandatory attachment + reason). `FINANCE` remains never self-satisfiable. When `separationOfDutiesRequired` is off, the UI still warns and the audit still records the self-approval.

---

## 10. Impersonation read-only coverage

Read-only impersonation (and read-only API keys) must be blocked at **both** layers: the UI hides every mutating control, **and** the route refuses `{ mutating: true }` (doc 30 §11 — BOTH, not either). `authorize()` already enforces this at `session.ts:247`; `authorizePayer()` mirrors it. Every mutating Revenue Engine route below passes `{ mutating: true }`:

| Surface | Mutating routes that must carry `{ mutating: true }` |
|---|---|
| Review lifecycle | submit, edit, approve, request-changes, escalate, void, time-entry, time-override, add manual item, apply adjustment |
| Charging | initiate charge, retry, cancel, run due-payments pass, schedule/reschedule |
| Refunds/disputes | request refund, approve refund, retry/cancel failed refund, attach dispute evidence |
| Configuration | pricing/rates create/manage/approve, items, taxes, payment policy, financial holds, promo codes |
| Compensation | approve, early-release, clawback decision, manual earning, classification |
| Connect (org) | initiate onboarding, accept terms, refresh link, manual sync |
| Payer (via `authorizePayer`) | accept invitation, accept billing authorization, add/detach/verify/set-default payment method, revoke consent, **approve-and-charge** / decline |
| Platform (via `authorizePlatform`) | fee-agreement create/supersede, Connect suspend/reinstate/sync — additionally refused while *any* impersonation session is active (audit-attribution integrity) |

No AI pathway may act from any of these surfaces (constitution rule 8). Dashboards and self/queue views are **reads** — no audit rows for viewing, and read-only impersonation may view whatever the permission set allows.

---

## 11. Constitution-test additions (`tests/constitution.test.ts` + siblings)

The machine-enforced suite gains these rules so a regressing PR fails CI, not review:

1. **Nav mapping (existing test, now covers new items):** `/billing/queue` and `/billing/my` must appear in `SECTION_PERMISSIONS` (they will, per §4.1). No test change needed beyond adding the nav items — the existing loop catches a missing entry.
2. **Self-service gate recognizes `authorizePayer`:** extend the `SELF_SERVICE_ROUTES` branch so `/api/payer/*` routes are accepted when the source calls `authorizePayer(` (currently the branch only greps `getSession()` + `401`). Add `/api/payer/**` to `SELF_SERVICE_ROUTES` with written reasons.
3. **Student self-view isolation (new static-scan test):** `src/lib/revenue-self.ts` must **not** import `revenue-dashboard.ts` (regex over the source; the `emitWebhook`-scan idiom). Fails if the org-wide engine leaks into the student surface.
4. **Platform-fee write confinement (new static-scan test, doc 27 §8.4):** no route file under `src/app/api/` outside `api/platform/**` may write `PlatformFeePolicy`/`PlatformFeeTier`.
5. **Payer-surface fee redaction (new static-scan test, doc 27 §8.4):** no route under `api/payer/**` may select `PlatformFee`/`PlatformFeePolicy`.
6. **`STATUS_TONE` single-source (existing test):** the review/payment tones (§ doc 30 §13) are added **only** in `src/lib/status-colors.ts` — the existing "defined exactly once" test enforces this.
7. **`MODULE_BY_PREFIX` completeness (recommended new assertion):** every prefix used by a `PERMISSIONS` key either maps in `MODULE_BY_PREFIX` or is intentionally always-on — pins `revenue → billing` so a future `revenue.*` key can never silently escape module gating.
8. **Denial contract tests (security suite, not constitution):** a `STUDENT` session is denied `/billing`, `/billing/queue`, `/reports`, `/executive`; instructor A cannot read instructor B's compensation; read-only impersonation → 403 on every mutating `/api/payer/*` route (doc 11 §7.2 definition-of-done).

---

## 12. Audit-event catalog (`recordAudit` action names)

New capabilities emit these audit actions (existing convention: `domain.verb`, past-tense, actor + before/after in metadata). Domain **events** (`emitDomainEvent`) are owned by the lifecycle docs and must each have a live emit site (constitution) — this catalog is the `recordAudit` action set the new capabilities add.

| Capability | Audit action(s) | Key metadata |
|---|---|---|
| Review lifecycle | `revenue_review.created`, `.submitted`, `.changes_requested`, `.approved`, `.voided` | reviewId, status, reason, expectedTotal |
| Instructor time | `revenue.time_entered`, `.time_updated`, `.time_overridden`, `.time_deleted` | reviewId, oldValue/newValue, **reason (required on override)**, target instructor |
| Approvals | `revenue_review.approval_recorded` (kind), `.approval_superseded`, `.escalated` | kind (OPERATIONS/SECOND/FINANCE), approverUserId, self-approval flag |
| Manual items / adjustments | `revenue.adjustment_created`, `.adjustment_approved`, `.adjustment_second_approved`, `.adjustment_rejected`, `.adjustment_cancelled`, `.adjustment_applied` | kind, before/after amounts, reason, policy trigger |
| Promo codes | `revenue.promo_created`, `.promo_redeemed` | code terms snapshot, redemption amount |
| Charging | `revenue.charge_initiated`, `.charge_scheduled`, `.charge_retried`, `.charge_cancelled`, `.charge_succeeded`, `.charge_failed` | reviewId, attemptId, rail, provider ref |
| Payment methods | `revenue.payment_method_added`, `.payment_method_detached`, `.payment_method_suspended` | payerId, method ref, consent version, acceptor |
| Refunds / disputes | `revenue.refund_requested`, `.refund_approved`, `.refund_processed`, `.refund_failed`, `.dispute_opened`, `.dispute_evidence_submitted`, `.dispute_closed` | payment id, amount, destination, provider ref |
| Payer actions | `revenue_review.payer_approved`, `revenue_review.payer_declined` | reviewId, payerUserId, amount |
| Pricing / rates | `revenue.pricing_profile_created/_approved/_archived/_superseded`, `revenue.rate_profile_created/_approved/_superseded` | profileId, familyId, version, approverId |
| Items / taxes | `revenue.item_created/_updated/_deactivated`, `revenue.tax_rule_created/_versioned/_deactivated`, `revenue.tax_settings_changed` | id, category, before/after |
| Policies | `revenue.payment_policy_changed`, `revenue_review.workflow_policy_changed`, `revenue.accounting_closed_through_changed` | before/after values |
| Financial holds | `revenue.financial_hold_placed`, `.financial_hold_lifted` | subjectId, reason, source (MANUAL/POLICY_ESCALATION) |
| Compensation | `revenue.earning_recorded`, `.earning_recorded_manual`, `.earning_adjusted`, `.compensation_approved`, `.earning_held_released`, `.earning_release_override`, `.compensation_reversal_proposed`, `.compensation_reversed`, `.compensation_reversal_declined` | reviewId, earning ids, reason, settlement ref |
| Connect (org) | `revenue.connect_onboarding_started`, `.connect_account_created`, `.connect_status_changed` | orgId, terms version, status, actor |
| Exports / reconciliation | `revenue.export_created`, `.export_completed`, `.export_failed`, `revenue.reconciliation_resolved` | kind, period, rowCount/errorCount, checksum, resolution note |
| Platform (platform actor) | `platform.fee_agreement_created/_superseded`, `platform.connect_suspended/_reinstated/_synced` | scope, version, orgId, reason |

Dashboards and self/queue **reads** produce no audit rows (house convention, doc 30 §11); CSV export of any drill-down list is audited by the export path under `reports.export` (or `revenue.exports_run` for `FinancialExportJob`).

---

## 13. Open questions (genuine product-owner decisions)

1. **D34 — Dispatcher `billing.view` in new bundles.** This doc recommends adding `billing.view` to the DISPATCHER default bundle (new-org seed only) to resolve the "records payments but can't see Billing" wart. Confirm the fix ships in the new Revenue Engine bundles and that existing org grants stay untouched. *(Owner: Head of Product — D34.)*
2. **D19 — Connect onboarding holder.** Is `revenue.connect_manage` Account-Owner-only, or also Operations Director (`SCHOOL_ADMIN`)? Doc 19 Open question 1. *(Owner: Head of Product.)*
3. **Finance Manager approval scope.** Confirm Finance Manager (`ACCOUNTANT`) should *not* hold `revenue.approve` (operational approval), keeping the accountant a finalizer (`approve_finance`, charge, refund) rather than a unilateral operations approver — the separation-of-duties intent of §3.1. *(Owner: Head of Product + owner persona.)*
4. **Compensation early-release second approval.** Should T7 early releases above a dollar threshold require a second approver (mirroring `RevenueWorkflowPolicy` second-approval families), or stay audited single-approval? Doc 29 recommends single-approval in Part 2. *(Owner: Head of Product.)*
5. **Platform-fee org transparency vs. spec Part W.** Doc 30 §15 logs a posture tension: the platform-fee/school-retained tiles are org-transparent (`billing.view`) per doc 12, while spec Part W leans stricter. Confirm org-transparent is correct for GA. *(Owner: Head of Product + Security.)*
