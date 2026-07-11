# UI Workflows — Screen-by-Screen Specification

> **Status:** Proposed — Phase 8 Part 3 · **Date:** 2026-07-11 · **Lead roles:** Financial UX Designer; Head of Human Interface Design at Apple; Aviation UX Lead at Boeing Digital Aviation; Dispatcher · **Part of:** Revenue Engine design set ([README](./README.md))

This is the Part 3 screen build spec: every Revenue Engine surface, its route, its layout in **real** design-system components (`src/components/ui/*`), its loading/empty/error states, light/dark + responsive behavior, and the primary persona's 30-second task path. It builds nothing new in the design system and invents no route: it composes the components the seams audit found (`Card`, `Button`, `StatusBadge`, `Table`, `Input`/`Select`/`Textarea`, `Drawer`, `PageHeader`, `EmptyState`, `Skeleton`, `Progress`) and the proven server-component + bounded-query + client-CSV reports pattern. Where a figure is shown, it cites its source query from [30-revenue-dashboard.md](./30-revenue-dashboard.md) §4.2 (which itself binds to the allocation/ledger rows in [28-revenue-allocation-ledger.md](./28-revenue-allocation-ledger.md) and [12-revenue-allocation-and-reporting.md](./12-revenue-allocation-and-reporting.md)).

North-star lens applied to every screen: the Director of Operations reads truth without a calculator, the dispatcher clears a flight in seconds, the accountant trusts every number, the instructor confirms time from the ramp, and the student sees a plain Amount Due and nothing about anyone else. Wherever a control's consequence could confuse a demo, the label states the consequence verbatim (doc 03 §2.6). **Demo-simplicity flags** (`⚠ SIMPLIFY`) mark anything that would need more than two sentences to explain, with the simpler choice taken inline.

---

## 0. Migration posture & URL strategy (binding, from doc 30 §3)

Expand `/billing` in place; keep every existing URL. No `/revenue` top-level section (it would break bookmarks, nav muscle memory, and the `SECTION_PERMISSIONS`/`SECTION_MODULES`/`billing`-module wiring). Nav label `Billing → Revenue` is **label-only** (href/icon/permission unchanged, mirrors `ROLE_LABELS`).

| Surface | Route | Change | Doc |
|---|---|---|---|
| Revenue Dashboard (executive) | `/billing` | **Replaces** the invoice-list landing page | 30 §4 |
| Operations revenue queue | `/billing/queue` | **New**; nav item "Revenue Reviews" (gate `revenue.review_view`) | 30 §5, §3 (this doc) |
| Student/payer self-view | `/billing/my` | **New**; nav item "My Payments" (gate `revenue.self_view`) | 30 §6, §9 |
| Revenue Review detail | `/billing/reviews/[id]` | **New**; queue cards + dashboard tiles + notifications deep-link here | 03 §2.1, §2 |
| Legacy invoice list | `/billing/invoices` | Current `/billing` list content moves here unchanged | 30 §3 |
| Legacy invoice detail | `/billing/[id]` | Kept for non-review invoices (manual `PaymentForm`); **review-wrapped invoices server-redirect** to `/billing/reviews/[id]` (`RevenueReview.invoiceId @unique` lookup) | 30 §3 |
| Reports / Executive | `/reports`, `/executive` | URLs unchanged; revenue math re-pointed at `src/lib/revenue-dashboard.ts` (one engine) | 30 §3 |
| Aircraft return / closeout | `/dispatch` (`dispatch-board.tsx`) | **Expanded** in place: Hobbs/Tach In additions + Draft Revenue Review preview | §1 |
| Instructor time entry | `/billing/reviews/[id]` (time section) + `/billing/reviews` scoped list | **New**, instructor-scoped | §4 |
| Settings editors | `/settings/revenue/*`, aircraft `Pricing` tab, `/settings/payments/*` | **New** under existing Settings; §5–§8 | §5–§8 |
| Payer portal | `/payer/*` (`authorizePayer()`) | **New** self-service surface | §6, §9 |
| Notifications | `/notifications` (existing) + `/settings/notifications` (new prefs) | **Expanded** | §10 |

Static segments (`/billing/queue`, `/billing/invoices`, `/billing/my`, `/billing/reviews`) take Next.js precedence over `[id]` — no route collision. Wiring: `SECTION_PERMISSIONS` gets `/billing/queue → revenue.review_view`, `/billing/my → revenue.self_view`; `SECTION_MODULES` maps both to `billing`; `MODULE_BY_PREFIX` gains `revenue → billing` (doc 30 §9, §11). Nav items appear automatically once permission+module+SECTION_PERMISSIONS exist (`allowedPaths` flow, layout.tsx).

Global rules obeyed on every surface below (not repeated per surface): design-system components only; colors from tokens + `STATUS_TONE` (`statusToneOf()`); light+dark parity decided together; desktop/tablet/mobile with bottom nav below `lg`; route-level `loading.tsx` skeletons that mirror the grid so nothing jumps; actionable inline error states ("Couldn't load X — Retry") that never blank the page; `EmptyState` never renders a bare "No data"; every mutating control **hidden (not disabled)** when the user lacks the key or is read-only-impersonating, and the owning route independently refuses `{mutating:true}` (doc 30 §11). Money renders via `formatCurrency` with `tabular-nums`.

---

## 1. Surface — Aircraft return / closeout additions (Hobbs In / Tach In)

**Route:** `/dispatch` — the existing three-column board (`dispatch-board.tsx`); the **`ReleasedCard`** closeout form is expanded. No new page. (Checkout/release additions — `hobbsOut`/`tachOut` confirm, `squawksAcknowledged` — land on the sibling `PendingCard` release form, same pattern.)
**Primary persona:** Dispatcher (also instructors who close their own flights).
**Data/authorization:** `authorize("dispatch.close", {mutating:true})`; `canClose = permissions.has('dispatch.close') && !impersonation?.readOnly`.

### Layout (expanded `ReleasedCard`, doc 02 §2.3 / §7)

One `Card`, one primary action, still under a minute. Fields in the dispatcher's order (doc 02 §7 — "the dispatcher is not an accountant"):

| Row | Component | Field(s) | Notes |
|---|---|---|---|
| Meters | `Input` (type number, `inputMode="decimal"`) ×2 | **Hobbs In**, **Tach In** | Prefilled from `out + typical delta` (today's behavior). `tabular-nums`. |
| Flight facts | `Input` ×4 | landings, night, instrument, fuel added (gal) | Existing. |
| + Oil | `Input` | **oilAddedQt** (new) | Optional. |
| + Fees | quick-add chips = `Button variant="outline" size="sm"` | Landing fee · Ramp fee · Airport fee (from org Revenue Items) | One tap adds a fee line; item default amount prefilled when set, else an `Input` appears for the amount (doc 06: built-ins ship amount-empty). Gated by `DispatchPolicy.captureAirportFees`. |
| + Airports/condition | `Input`/`Textarea` | airportsVisited, conditionIn, returnNotes | Optional. |
| Squawk | existing `Textarea` + severity `Select` | optional squawk | Existing. |
| Preview | `CardContent` stat block | **Draft Revenue Review preview** | Retitled from "billable estimate"; fixed caption *"No one is charged at closeout. Charges are confirmed in the Revenue Review."* Calls the same pure pricing resolver as the server (`src/lib/pricing.ts`) so the number cannot drift (doc 02 §7). |
| Submit | `Button variant="success"` | **Close out flight** | Retires today's "Close & bill flight" — closeout no longer bills (doc 02 §7). |

### Warnings vs blocks — presentation (doc 02 §5)

The engine returns `{ blocks, warnings }`, each carrying `code` + actionable aviation-plain `message` + the triggering values (doc 02 §5). Presentation is the whole point of this surface:

- **Hard blocks (H1–H11, never overridable)** render as `text-destructive` inline text under the offending field and **disable the submit button** with the next step spelled out — e.g. Hobbs In ≤ Hobbs Out: *"Hobbs In 1,247.3 must exceed Hobbs Out 1,248.1 — check for a mis-read meter."* No override affordance exists for these (there is no button to render).
- **Warnings (W1–W9)** render as calm amber annotations (token `text-warning` / amber `Badge`) under the field that triggered them and **do not block** by default — the aircraft is physically back. They ride onto the Draft Revenue Review (`Dispatch.closeoutWarnings` → review `warnings`) so Operations sees them at approval.
- **BLOCK-mode warnings** (org opted a warning to BLOCK) return `409 {error, warnings:[{code,message}]}`. The card shows the reason and, **only for holders of `dispatch.override_warnings`**, an "Override with reason…" affordance: a `Textarea` (min length enforced) + `Button variant="destructive" size="sm"` "Close out with override". Users without the key see the reason and "Ask a supervisor to override" — the control never dead-ends silently.
- **Post-close meter correction** (doc 02 §5.5) is a separate audited action on a `CLOSED` dispatch card — "Correct meters…" (`revenue.…`/`dispatch.correct_meters`, hidden without it) opening a `Drawer` with corrected Hobbs/Tach + required reason; **blocked once the review is approved** (409, with the message "Approved charges are frozen — use an adjustment").

### States

- **Loading:** board `loading.tsx` skeleton = three columns of `Skeleton` cards (existing pattern, matched grid).
- **Empty (Closed Today col):** `EmptyState` "No flights closed today. Closed flights and their Revenue Review status appear here."
- **Error (submit):** inline `text-destructive` from the route's actionable JSON; `router.refresh()` on success. On 409 duplicate-close (H5), the card refreshes to the closed state — the outcome the user wanted already happened.
- **Success:** the Closed Today card shows a Revenue Review status chip (`StatusBadge`, `DRAFT` gray); the success line links to `/billing/reviews/[id]` — "RR-1042 created — awaiting instructor time" for `revenue.review_view` holders (in the DISPATCHER bundle), else just "Flight closed."

### Light/dark + responsive
Card reflows to single column below `md`; the whole board is already one-handed-friendly. Amber warnings and destructive blocks use tokens (`text-warning`, `text-destructive`) with **text labels** so color is never the sole signal. Bottom nav below `lg`.

### 30-second task path (dispatcher, tap count)
1. Tap the released flight's card → it expands (**1 tap**).
2. Hobbs In and Tach In are prefilled; correct if needed (**0–2 taps**).
3. Landings prefilled `1`; adjust if needed (**0–1**).
4. Optional: tap a fee chip (Landing fee) if one applies (**0–1**).
5. Tap **Close out flight** (**1 tap**).

**A solo return with zero extras is three fields confirmed and one button — 2 taps minimum, ~4 typical.** ⚠ *SIMPLIFY:* financial fields (payer, method, rate) are **never** on this card — they belong to the review. The preview is display-only. That is the entire reason closeout stays fast (doc 02 §2.5 two-state contract). Nothing here waits on Stripe, ever.

---

## 2. Surface — Revenue Review screen

**Route:** `/billing/reviews/[id]` (owned by doc 03 §2.1). Legacy `/billing/[id]` server-redirects here when the invoice has a review.
**Primary persona:** Operations Director / Chief Flight Instructor (approver); instructor (time confirm) and accountant also work here.
**Data/authorization:** page gate `revenue.review_view` (instructors engine-scoped to own reviews); server component loads the review + wrapped `Invoice`/`InvoiceLine` + approvals + readiness, org-scoped from session. Section-level and action-level gates below.

### Layout — one page, five sections, operational facts on top, money below (doc 03 §2.1)

`PageHeader` eyebrow "Revenue Engine", title `RR-1042 · N123AB`, with a **status banner** immediately under it (see below). Five `Card`s in the mental order of a return closeout:

| # | Section (`CardTitle`) | Contents / components | Editable until | Gate |
|---|---|---|---|---|
| 1 | **Flight information** | `Table` (label/value): date, location, aircraft tail, student/customer, instructor, program, lesson, Dispatch deep link | Never (operational facts; corrected on the dispatch, §1) | `revenue.review_view` |
| 2 | **Time summary** | `Table`: Hobbs/Tach out/in/elapsed (read-only meters) + instructor time entry rows (§4) | Instructor time until submit; overrides need `revenue.time_override` | view / `revenue.time_entry` |
| 3 | **Charges** | `Table` per line: description, Revenue Item/kind, qty, unit price, line total, tax treatment, **provenance** ("Member Wet v3 — $165/hr × 1.4 Hobbs"); footer subtotal → discounts/credits → tax → **total** in the review's currency | Until Approved (`revenue.review_edit`) | amounts visible only with `billing.view` (doc 04 §7 instructor-default) |
| 4 | **Payment** | responsible payer + type chip; timing policy (effective pre-approval, snapshotted after); default method chip (brand+last4+exp, `StatusBadge` consent state); **payment readiness** as an actionable checklist (below) | pre-approval | view; `Change payer`/`Select method` gated |
| 5 | **Allocation** | `Table`: aircraft revenue · instructor-service revenue · fees · fuel · tax · platform fee · school retained · instructor compensation · other — plain-language ("Your school keeps $445.40", doc 12 §7) | preview → snapshot at approval | `revenue.allocation_view`; instructor comp line additionally gated by `instructorSeesOwnCompensation` |

Each charge line shows its **why** (rate provenance, doc 05 §3.6); an `AMBIGUOUS_RATE` line renders a blocking amber banner (`Card` with amber left border) showing the tied profiles side-by-side and one-click explicit selection, and the approve control stays hidden/disabled with actionable text (doc 05 §8).

### Status banner (doc 03 §2.2, all 16 statuses)

Full-width strip below `PageHeader`: `StatusBadge` (customer-facing name via `statusToneOf()` — new `STATUS_TONE` entries from doc 30 §13) + a one-line plain-language state + the last actor/timestamp. Examples: `Changes Requested` (orange) → the reason + tagged items highlighted in the Time/Charges sections (doc 03 §2.3); `Payment Failed` (red) → safe `failureMessage` + Amount Due; `ACH Pending` (cyan) → "typically completes within 4 business days" + elapsed. Terminal states (`VOIDED`, `REFUNDED`) show the snapshot is retained.

### Action bar — by role × status (doc 03 §2.3–2.11)

A sticky bottom action bar (`Button` cluster) whose contents are computed server-side from status + the viewer's keys + separation-of-duties. **Hidden, not disabled** for missing keys/read-only. `variant="success"` for approve/submit, `variant="destructive"` for void, `variant="outline"`/`ghost` for the rest.

| Status | Actions (permission) |
|---|---|
| Draft | Submit (`revenue.review_submit`) · Edit charges (`revenue.review_edit`) · Change payer (`billing.payers_manage`) · Void w/ reason (`revenue.void`) |
| Awaiting Instructor Review | (instructor) Confirm time + **Submit Revenue Review** (`revenue.review_submit`) · (staff) **Submit on instructor's behalf, reason required** (`revenue.review_edit`) |
| Awaiting Operations Review | **Approve control (see below)** · Request changes w/ reason (`revenue.approve`) · Save draft · Escalate for second approval · Void |
| Changes Requested | (instructor) Correct & resubmit (`revenue.review_submit`) |
| Approved / Payment Scheduled | Charge now (`revenue.charge`) · Record offline payment (`billing.record_payments`) · Void while uncharged (`revenue.void`) |
| Payment Failed | Retry / Re-point method / Record offline / Reschedule / Escalate — §7 |
| Card Paid / Paid / Partially Refunded | Issue refund (`revenue.refund`) — §7 |
| Disputed | Manage evidence (`revenue.dispute_manage`) — §7 |

### The approval control (exact wording + readiness checklist)

The primary approve `Button variant="success"` carries the **consequence-truthful label driven by the effective timing policy** (doc 03 §2.6). Under the default charge-immediately policy the label is verbatim:

> **Approve Revenue Review and charge the saved payment method**

Other policies swap the label per the doc 03 §2.6 table (schedule for today's/tonight's/weekly/ACH batch; for {date}; charged manually; issue the invoice for manual payment). A bare "Approve" is a design failure.

Directly above the control, a **readiness checklist** surfaces the doc 09 §5.2 `READY / READY_WITH_WARNINGS / NOT_READY` reasons as **actionable items**, each a row with a status glyph + the reason + a one-click fix (never a dead end):

| Readiness reason | Actionable item shown |
|---|---|
| Missing payer | "No responsible payer — **Assign payer**" (`billing.payers_manage`) |
| No saved / no default method | "No payment method on file — **Request method from payer**" (doc 31 notification) / "**Select saved method**" |
| Consent missing / stale / revoked | "Off-session consent needed — **Request re-acceptance**" (doc 20 §3.6) |
| Connected account not ready | "Payments account not set up — **Set up payments**" (link to §8) / manual-invoice note |
| `AMBIGUOUS_RATE` | "Two profiles tie — **Select one**" (blocks approval, doc 05 §3.3) |
| Card expires before charge date | amber warning "Card expires {mm/yy} before the scheduled charge" |

When readiness is `NOT_READY` under `approveWithoutMethod = WARN`, the effective policy converts to `MANUAL_INVOICE` and the control **relabels itself** to "Approve Revenue Review and issue the invoice for manual payment" — so the consequence stays truthful (doc 09 §5.2). Under `BLOCK`, the control is disabled with the exact blocking reason. On click, the client sends the review's `updatedAt` token + `expectedTotal`; a mismatch returns 409 "This review changed since you loaded it — reload before approving" (doc 03 §2.6). Solo-operator orgs render a combined audit-flagged **Submit and approve** control (doc 03 §3). Second/finance approvals never add statuses — the bar shows "Awaiting second approval — total exceeds $2,500" (doc 03 §2.7).

**Request changes** demands a reason inline (`Textarea`, may tag specific lines/time entries → `changesRequestedTargetIds`). **Void** demands a reason and restates what happens: "The flight remains closed; nothing will be charged" (doc 03 §7).

### States
- **Loading:** `loading.tsx` mirrors the five-card stack with `Skeleton`.
- **Empty:** n/a (a review always has content); manual reviews show only applicable rows.
- **Error:** per-section inline retry ("Couldn't load allocation — Retry"); a failed section never blanks the page (doc 30 §13). Approval 409s render reconciliation-toned, not error-toned ("Already approved by J. Alvarez, 14:31").
- **Success:** quiet toast "Revenue Review RR-1042 approved — charging saved card" (no celebration). ⚠ *SIMPLIFY:* no separate "confirm approval" modal — the label already states the consequence; a second dialog is friction, not safety.

### Light/dark + responsive
Cards stack single-column below `md`; the action bar becomes a fixed bottom bar above the mobile bottom nav (an approver clears a routine review from the run-up area). Provenance popovers and the readiness checklist are keyboard-reachable; the ambiguity banner uses text + tone.

### 30-second task path (approver, routine review)
Open from the queue → status banner reads *Awaiting Operations Review*, readiness checklist all-green → glance tail + total (typographic priority) → tap **Approve Revenue Review and charge the saved payment method** → quiet toast. For routine reviews this is **one screen, one tap** (and can be done without opening, from the queue card — §3).

---

## 3. Surface — Operations revenue queue

**Route:** `/billing/queue` (new). Nav item "Revenue Reviews" (Business group, gate `revenue.review_view`).
**Primary persona:** Dispatcher / Chief Flight Instructor / Operations Director working the daily list top-to-bottom.
**Precedent:** `dispatch-board.tsx` three-column card board with in-card expandable action forms, checkbox-gated submit, live estimate `Badge`, `router.refresh()` + inline error on POST (doc 30 §5, seams audit). This is the direct pattern.
**Data/authorization:** page gate `revenue.review_view` (instructors engine-scoped to own reviews). Defaults to the **active location** (`aerops-location` cookie) with an "All locations" toggle held in a URL param; all filters are URL params so shared links mean the same thing (doc 30 §5).

### Layout — tabbed queues (doc 30 §5.1)

`PageHeader` eyebrow "Revenue Engine", title "Revenue Reviews", location toggle (`Select`). Below, a tab row (each tab a `Button variant="ghost"` with a count `Badge`). Default tab **"All needing attention"** de-dupes by review, ordered by cross-queue urgency (doc 30 §5.2). Every tab's list is `take`-bounded (50, oldest-first, paginated). Every card = one Revenue Review (`Card`, doc 30 §5.4):

- Review number `RR-1042`, `StatusBadge`, **tail number + total** with typographic priority (a CFI scans by aircraft then size), student (payer chip "Bill to: Acme Aviation Scholarship" when different), instructor, flight date.
- Risk-flag chips (`MANUAL_ITEM`, `DISCOUNT`, `DAMAGE_FEE`, `OVER_THRESHOLD`, `TIME_OVERRIDE` — amber/orange `Badge`s), payment-readiness chip, and a **days-in-status age chip** (`warning` tone at ≥ 7 days).
- In-card action buttons (thin wrappers over sibling routes, doc 30 §5.3).

### Queue matrix — predicate · sort · in-card actions · data source

Every queue queries `[organizationId, status]` (doc 13 index; source per doc 30 §5.1). Flag queues filter `riskFlags` in SQL within the status-bounded set.

| Tab | Predicate (source: doc 30 §5.1) | Sort | In-card actions (permission) |
|---|---|---|---|
| Draft | `status = DRAFT` | oldest | Open · Submit (`revenue.review_submit`) · Edit charges (`revenue.review_edit`) · Void (`revenue.void`) |
| Awaiting instructor | `AWAITING_INSTRUCTOR_REVIEW`; overdue chip after `instructorReviewReminderHours` (48) | oldest | Remind · Submit on instructor's behalf, reason required (`revenue.review_edit`) |
| Awaiting Operations | `AWAITING_OPERATIONS_REVIEW`, split **Needs my approval / Awaiting another approver** (doc 03 §2.7) | oldest w/in split | Open · **Approve-from-card** (routine only) · **Bulk approve** (routine only) · Request changes (`revenue.approve`) · Escalate |
| Changes requested | `CHANGES_REQUESTED`; "Resubmitted after changes" chip on return | oldest | Open (instructor: correct & resubmit) |
| Missing payment method | statuses 1–5 AND readiness `MISSING_PAYMENT_METHOD` | approval-imminent first | Request method from payer · Select saved method (`revenue.payment_methods_manage`) · Switch to Manual Invoice (`revenue.charge`) |
| Payment failed | `PAYMENT_FAILED`; safe `failureCode`/`failureMessage` + hard-decline markers | oldest failure first | Retry (`revenue.charge`) · Re-point method · Record offline (`billing.record_payments`) · Escalate — §7 |
| ACH pending | `ACH_PENDING`; initiation date + expected settlement + days elapsed | oldest | **None — deliberately action-free** (only exit is the webhook); stale → exception chip |
| High-value | statuses 1–5 AND (`OVER_THRESHOLD` OR `secondApprovalRequired`); threshold = `secondApprovalAmountThreshold` | **largest total first** | Open · missing-approval-kind chips |
| Manual items req. approval | statuses AND riskFlags ∩ {`MANUAL_ITEM`,`DAMAGE_FEE`} | oldest | Open (second-approval; damage-fee adder-never-sole-approver chip) |

⚠ *SIMPLIFY:* the High-value queue **reuses** the second-approval threshold rather than adding a "high-value" knob — one number, one meaning (doc 30 §5.1). ⚠ *SIMPLIFY:* ACH pending has **no** actions — teaching operators that a 4-day settlement window is normal physics, not a problem, is part of the design (doc 30 §5.2).

### Urgency (the "All needing attention" tab, doc 30 §5.2)
Fixed cross-queue priority: ① Payment failed → ② Missing method w/ approval imminent → ③ Needs my approval → ④ Changes requested → ⑤ Awaiting instructor (overdue only) → ⑥ Draft > 24h → ⑦ rest. **ACH pending never ranks urgent.** Filters (risk flag, tail, instructor, student, payer, amount band) compose with the location toggle; all URL params.

### Approve-from-card & bulk approve (doc 30 §5.3, doc 03 §2.10) — routine only
Routine cards render an inline approve button carrying the aggregate consequence label — e.g. **"Approve 12 routine Revenue Reviews — $4,310.00 will be charged to saved payment methods"** (wording tracks the effective timing policy; a bare "Approve all" is a design failure). Selection = per-card checkboxes (`input` in the card, like the dispatch board's checklist gate). The server re-verifies routineness and **claims each review individually** with its own `updatedAt` + `expectedTotal`; one stale review 409s alone with its reason inline on its card, the rest proceed. Risk-flagged reviews render **no** approve-from-card control and cannot be bulk-selected — they always open (doc 03 §2.10). Bulk approve is desktop-oriented but not desktop-only.

### States
- **Loading:** `loading.tsx` = tab row skeleton + a column of `Skeleton` cards matching the responsive grid (doc 30 §13).
- **Empty (fresh org):** `EmptyState` "Nothing needs attention. Reviews appear here when flights close." Never "No data".
- **Error:** per-tab inline "Couldn't load this queue — Retry"; a failed count badge shows "—", not zero.
- **Concurrent workers:** second approver's card refreshes to "Already approved by J. Alvarez, 14:31" (reconciliation tone). Read-only impersonation hides every action button and the routes refuse.

### Light/dark + responsive
Cards single-column below `md`; tabs become a horizontally scrollable row (`overflow-x-auto`) below `sm`. Age/risk chips carry text so tone is never the sole signal. Bottom nav below `lg`.

### 30-second task path (dispatcher)
Land on "All needing attention" (active location) → scan top card (highest urgency) → for a routine card, tap **Approve … will be charged** right on the card; for a flagged card, tap Open → clear it → back. Work down until the tab badge reads 0.

---

## 4. Surface — Instructor time entry (mobile-first, ramp-friendly)

**Route:** the **Time summary** section of `/billing/reviews/[id]` (doc 03 §2.1 section 2), plus a scoped **"My Revenue Reviews"** list at `/billing/reviews` filtered to the session instructor (`[instructorId, status]` index, doc 03 §7). Instructors reach it from the notification "Confirm your time on RR-1042" (doc 31 #2) or the scoped list.
**Primary persona:** Instructor, on a phone, after the debrief, on the ramp.
**Data/authorization:** `revenue.time_entry` (own time on own-performed lessons); post-submission overrides need `revenue.time_override` + reason (doc 04 §6). Editability follows the parent review status (doc 04 §2.2 matrix), enforced by a guarded `updateMany` keyed on review status.

### Layout — a paper instruction record, not an accounting grid (doc 04 §7)

The instructor **never fills out an invoice** (doc 03 §7). After closeout they see a compact sheet: the flight header ("N123AB with Dana Marsh, Jul 9") and category rows in the doc 04 §2.1 order, each a labeled `Input` (hours). Seeded suggestions render as chips:

- **Flight instruction: 1.4 h** — chip "suggested from Hobbs (9.9 → 11.3). Confirm or adjust." (`source = HOBBS_SUGGESTED`). Cannot ride a submission until confirmed/edited under `SUGGEST_CONFIRM` (doc 04 §2.3).
- **Preflight briefing / Postflight debriefing** — chips prefilled from org defaults (0.3 / 0.2).
- Optional categories (ground, sim, oral prep, checkride prep, stage check, custom) added via a `Select` + `Input`; `CUSTOM` shows a label field.
- `Textarea` notes; one primary `Button variant="success"` **Submit Revenue Review**.

**Divergence** beyond `maxHobbsDivergenceHours` (0.5) shows amber inline: "Entered 2.5 h vs Hobbs 1.4 h — explain in notes or adjust" (doc 04 §7); under `hobbsDivergenceAction = BLOCK`, submission is blocked until corrected or supervisor-overridden.

**Rates are not shown to the wrong eyes** (doc 04 §7): the time sheet shows hours only. Billing amounts appear in the Charges section only for `billing.view` holders; when visible to the submitting instructor, required copy rides the submit screen: *"Rates shown are what the customer is charged. Your compensation is tracked separately under My Compensation."* Compensation figures need `revenue.compensation_view`; the instructor's own figures live on the separate **My Compensation** panel (`revenue.compensation_view_own`, doc 04 §6) — reached from the dashboard, never re-implemented here (doc 30 §2).

Ground-only / sim sessions with no dispatch attach to an auto-created review (doc 03 §2.9); same sheet, **no Hobbs suggestion** (no meters) — the instructor enters ground/brief/sim time directly.

### States
- **Loading:** `Skeleton` rows matching the category list.
- **Empty ("My Revenue Reviews" list):** `EmptyState` "No reviews need your time. When you close a flight, confirm your time here."
- **Error:** inline `text-destructive`; a stale edit racing an approval loses cleanly with 409 "This review was approved while you were editing" (doc 04 §2.2).
- **Success:** toast "Time submitted — RR-1042 sent for approval."

### Light/dark + responsive
Designed phone-first: full-width stacked rows, large tap targets, numeric keypad (`inputMode="decimal"`), the suggestion chip a single tap to confirm. Works identically light/dark; bottom nav below `lg`.

### 30-second task path (CFI, four flights a day)
Open notification → sheet shows Hobbs number prefilled + two suggestion chips → tap **Confirm** on flight-instruction chip (**1 tap**) → tap **Submit Revenue Review** (**1 tap**). *"A CFI confirms time in seconds per flight"* (doc 04 §7). ⚠ *SIMPLIFY:* closeout asks nothing about instructor time — suggestions are seeded silently server-side (doc 04 §7); the instructor deals with them here, later, on their phone.

---

## 5. Surface — Settings editors

All under existing **Settings**, new `/settings/revenue/*` group (+ the aircraft-detail **Pricing** tab and `/settings/payments/*`). Shared shape for every editor: a **list** page (`Table` of records with derived-state `StatusBadge`, `Button` "New") + an **editor** (`Card` form of `Input`/`Select`/`Textarea`/`Label`, or a `Drawer` for quick edits) + effective-dating UX + ambiguity warnings. Every mutation: zod at the boundary, `authorize({mutating:true})`, before/after `recordAudit`. New derived-state chips register in `STATUS_TONE` (doc 04/05/07 UX notes). Loading = `Skeleton` table rows; Empty = teaching `EmptyState`; Error = inline retry — stated once here, not repeated per editor.

**Primary personas:** Owner / School Admin / Accountant (config); Chief Flight Instructor for rates.

### 5.1 Aircraft Pricing Profiles (doc 05)
**Routes:** aircraft detail **Pricing** tab (rate card grouped by family) + org-level `/settings/revenue/pricing` (fleet-wide profiles, defaults, everything Scheduled).
**List:** `Table` rows = profile name, selectors summary, rate/basis/wet-dry, priority, **derived state chip** (Draft/Scheduled/Active/Ended/Archived — derived at read from effective dates + status, doc 05 §3.1). `Button` "New profile".
**Editor:** `Card` form — name, selectors (`eligibleCustomerTypes`/`eligibleMembershipRoles`/`eligibleProgramIds` multi-`Select`, `locationId`), `billingBasis` (`Select`: HOBBS/TACH/FIXED/CUSTOM_UNIT), wet/dry, `rateAmount` (`Input`), `minBillableQuantity`, `roundingRule`, tax treatment, `priority`. Approve (`revenue.pricing_approve`) is an electronic-signature `Button variant="success"`.
**Effective-dating UX:** approved rows are immutable except set-future-`effectiveEnd` and archive (doc 05 §6 V4). "Change this rate" is a first-class **"Schedule rate change"** action creating the next version with a future `effectiveStart`; the rate card shows *"Active $149.00 → $159.00 from Aug 1"* so the whole desk sees it coming (doc 05 §8). Dates entered/displayed in org `timeZone`.
**Ambiguity/foot-gun warnings:** creating an **org default (L5)** warns inline — *"An organization default outranks each aircraft's own default rate. Most schools price per aircraft — are you sure?"* with the affected-aircraft list (doc 05 §8). Approval-time overlap check warns when a new approved profile ties another at the same level+priority (doc 05 §6 V6). ⚠ *SIMPLIFY:* ambiguity handling is **not configurable** — warn + block review approval until explicit selection (doc 05 §4). The review-side blocking banner lives in §2.

### 5.2 Instructor billing & compensation rates (doc 04)
**Route:** `/settings/revenue/instructor-rates`, two lists by `kind` (BILLING / COMPENSATION) — RBAC is a row filter (`revenue.rates_view`/`revenue.compensation_view`).
**List:** `Table` = name, scope (instructor/location/program), rate lines summary, classification (comp only), derived **superseded** badge when a newer approved version exists (doc 04 §2.4). "New" / "New version".
**Editor:** `Card` — scope selectors, `InstructorRateProfileLine` rows (category `Select` + rate `Input` **or** `percentOfBilling` — exactly one; `percentOfBilling` only on COMPENSATION when `allowCompensationLinkedToBilling`). Approve = `revenue.rates_approve` (billing) / `revenue.compensation_manage` (comp).
**Effective-dating:** same immutable-version model as pricing; "rate change" = duplicate → new DRAFT (same `familyId`, `version+1`) → approve → old version renders superseded once the new `effectiveFrom` arrives (doc 04 §2.4).
**Ambiguity/legacy warnings:** approval-time overlap check ("resolution will tie-break deterministically; set priorities to disambiguate"); an unresolved `AMBIGUOUS_RATE` (either kind) **blocks Revenue Review approval** (doc 04 §5 V11). Tier-8 **legacy fallback** resolutions attach a visible review warning "billed at legacy default rate — create an Instructor Rate Profile" (doc 04 §2.5). **Required disclaimers:** the classification disclaimer wherever classification is set ("AeroOps does not determine legal worker classification…", doc 04 §7). `allowRateSelfApproval` self-approvals are audit-flagged and surfaced on the dashboard.

### 5.3 Revenue Items (doc 06)
**Route:** `/settings/revenue/items`.
**List:** `Table` = name/code, category, pricing (FIXED/VARIABLE + unit basis), taxable default, **requirement chips** (note / attachment / second approval — visible before selection), availability scope, active + effective window. Built-ins seeded per org (`isSystem`, fully editable); unlimited custom (`revenue.items_manage`).
**Editor:** `Card` — name, category, `defaultAmount` (may be empty — built-ins ship amount-empty), unit basis, taxability, `requiresNote`/`requiresAttachment`/`requiresSecondApproval` toggles, availability (locations/programs/aircraft), accounting-category seam.
**Effective-dating:** `isActive` + optional `effectiveFrom`/`effectiveTo` control whether an item can be *added* to new reviews; **no version column** — historical immutability comes from snapshotting name/code/amount/basis/taxability/category onto the line at add-time and freezing at approval (doc 06 §2, §3). Deactivation never touches existing lines.
**Ambiguity/guardrail warnings:** amount-empty items show a hint "Set a default amount to enable the over/under warning (W6)" — W6 stays inert until configured (doc 06 §3, "no silent guardrail"). HIGH-risk (damage-fee) items ship `requiresNote`+`requiresAttachment`+`requiresSecondApproval` **on**; relaxing them needs `revenue.items_manage` + `settings.manage`, an explicit confirm, and audit; the two-person floor (adder never sole approver when a second human exists) is default-on (doc 06 §3). Examiner Fee shows the pass-through-account recommendation as a UI hint (doc 06 §3).

### 5.4 Tax rules (doc 07)
**Route:** `/settings/revenue/tax`.
**List:** `Table` = jurisdiction label, rate %, scope (org-wide / per-location), charge classes it applies to (`appliesToKinds`), derived state (Scheduled/Active/Expired/Deactivated). "New rule".
**Editor:** `Card` — jurisdiction label (free text), `ratePercent` (`Input`), scope `Select` (org-wide or a location), `appliesToKinds` multi-`Select` (catalog charge-class keys, not enum values), effective window.
**Effective-dating:** editing a used rule is impossible — "edit" closes the current version's window and inserts the next (doc 07 §2). Dates in org `timeZone`.
**Ambiguity/guidance:** **required honesty banner** at the top of the surface — *"AeroOps applies exactly the rules you configure. It does not determine legal tax treatment. Consult your tax professional."* (doc 07 §1). Multi-state guidance in the UI: "an org with locations in different jurisdictions should scope every rule to a location and keep zero org-wide rules" (doc 07 §2). Stacking produces one snapshot row per rule (no tax-on-tax); a duplicate-jurisdiction overlap raises a warning at resolution (doc 07 §5). Receipts never claim to be tax documents (§9, §5.4 export honesty).

### 5.5 Payment timing (doc 09)
**Route:** `/settings/payments/timing` (part of `OrgPaymentPolicy`).
**Editor:** single `Card` — `defaultTimingPolicy` (`Select`: `IMMEDIATE_ON_APPROVAL` default, `SAME_DAY_BATCH`, `NIGHTLY_BATCH`, `WEEKLY_BATCH`, `MANUAL_CHARGE`, `MANUAL_INVOICE`, `ACH_ONLY_BATCH`, `CUSTOM_DATE`), `overridePolicies` (multi-`Select`, what an approver may pick per review), batch-hour inputs, `manualInvoiceNetDays` (14), `customDateMaxDays` (30), `achOnlyFallback`, and **`approveWithoutMethod`** (`WARN`/`BLOCK`) with a stated consequence: WARN → approval falls back to manual invoice; BLOCK → approval disabled until a method exists (doc 09 §3, §5.2). Each policy row shows a plain-language example of the approve-control wording it produces, so the admin sees exactly what the approver will read.
No effective-dating on policy — but the **effective policy is snapshotted at approval**, so changing it never alters an approved review (doc 09 §5.2; a UI note states this).

### 5.6 Approval policies (doc 03 §3)
**Route:** `/settings/revenue/approvals` (`RevenueWorkflowPolicy`, `revenue.payment_policy_manage`-adjacent per doc).
**Editor:** one `Card` of toggles/thresholds (all zero-setup defaults): instructor submission step, instructor-may-approve-routine, routine cap, operations-always-required, second-approval amount threshold, second-approval for manual items / discounts (percent + amount pair) / damage fees / refunds, finance approval, **separation of duties** (the single org-wide `separationOfDutiesRequired` shared by pricing/rates/reviews — doc 05 §4 unification), instructor-sees-own-compensation, instructor-review reminder hours (48).
**Ambiguity/guardrails:** the settings API **refuses** a config with zero approvers, and refuses to enable `financeApprovalRequired` when no second eligible approver exists (doc 03 §2.8). **Solo-operator first-run nudge:** when exactly one user holds `revenue.approve`, the surface suggests enabling `instructorMayApproveRoutine` (which auto-grants `revenue.approve_routine`), and routine reviews then render the combined **Submit and approve** control (doc 03 §3). Discount second-approval is the single percent+amount pair (replaces the retired boolean).

### 5.7 Checkout restrictions (doc 10 + doc 25 additions)
**Route:** `/settings/revenue/checkout-restrictions`.
**List/editor:** `Table` of restriction keys grouped by **tier** — SAFETY (pinned `BLOCK`, read-only — policy rows rejected by the API), OPERATIONAL (floor `WARN`, escalatable), FINANCIAL (fully configurable). Each FINANCIAL row: enforcement mode `Select` (legend **O**=Off · **W**=Warn · **R**=Require review · **V**=Block-overridable · **B**=Block · **X**=role exemptions), threshold `Input` where applicable, `exemptOrgRoleIds` multi-`Select`, and (doc 25) the `applyAtBooking` toggle. New FINANCIAL key `MEMBERSHIP_FINANCIAL_HOLD` (default `BLOCK_OVERRIDABLE`); `PRIOR_PAYMENT_FAILED` and `AMOUNT_DUE_OVER_THRESHOLD` (threshold 500 USD default) now source from derived Amount Due / failed reviews (doc 25 §5).
**Guardrails (hard, in UI copy):** SAFETY tier is code, not data — "these can never be turned off; safety authority paths (grounding, return-to-service) live in maintenance." FINANCIAL keys skip maintenance/positioning dispatches and never gate aircraft return/closeout or safety actions (doc 10 §3.3, doc 25 §7.1). Related notification/hold config (`escalationDays` 7, `failureNotifyRoleIds`, `escalationNotifyRoleIds`, `autoHoldAfterEscalation` off) lives on the same `OrgPaymentPolicy` PATCH under §5.5's Payments settings (doc 25 §6.3).

### 30-second task path (Owner, e.g. schedule a rate increase)
Aircraft → Pricing tab → **Schedule rate change** on the active profile → new amount + `effectiveStart` Aug 1 → Approve. The rate card immediately reads "Active $149 → $159 from Aug 1"; nothing reprices past flights.

---

## 6. Surface — Payer & payment-method management (+ consent capture)

Two sides of one model: **org-side** (staff-assisted) and the **payer portal** (`/payer/*`, `authorizePayer()`). Card/bank data is **only ever entered on provider-hosted surfaces** — AeroOps renders no card field, no account-number field, no micro-deposit field (SAQ-A, doc 20 §3.2).

### 6.1 Org side — responsible payers (doc 11)
**Routes:** student profile **"Billing & Payer"** tab + org-level payer list under Billing (`/settings/revenue/payers` or Billing → Payers). Gate `billing.payers_view` / `billing.payers_manage`.
**List:** `Table` = payer display name, type chip (`PARENT`/`GUARDIAN`/`EMPLOYER`/…), linked students, status `StatusBadge` (INVITED/ACTIVE/SUSPENDED/ARCHIVED). "Invite payer".
**Editor / actions:** create+invite (name/email/type → invite token, raw shown once), link/revoke `StudentPayerRelationship` with capability toggles (`canViewInvoices`, `fullFinancialVisibility` default off, `canManagePaymentMethods`, `receivesNotifications`, `chargeApprovalRequired`), set default payer (clears prior default in one tx), record guardian consent (+ optional `consentDocumentId`), suspend/archive. Every mutation audited (doc 11 §7.3).
**On the dispatch release card:** one compact line `Bill to: Sarah Chen (Parent) ▾` (`Select`) prefilled with the student default; a "no method on file" amber chip (warn-only), never mixed with airworthiness (doc 11 §8).

### 6.2 Org side — payment methods (doc 20)
**Where:** method chips on the review Payment section, the payer/student record, and readiness panels — brand glyph + `•••• 4242` + `exp 04/28` + status tone (`StatusBadge`: ACTIVE / REQUIRES_VERIFICATION / SUSPENDED / DETACHED), with a **consent secondary line** ("Consent: current (v2)" / "Re-acceptance needed" / "Revoked"). Expired = derived from exp date (never a stored status), shown with the fix ("Expired — ask the payer to update").
**Staff actions (`revenue.payment_methods_manage`):** **Add payment method** → generates a QR code + short link (staff never type card data); detach (reason); change default (auto-promotes the sole survivor); record a payer-requested consent revocation (reason); trigger re-accept. ⚠ *SIMPLIFY:* front-desk flow = staff hits Add → QR/link → **payer completes on their own phone** → the staff screen live-updates to the method chip when the webhook lands. The UI says why: "For your security, card details go directly to Stripe" (doc 20 §9).

### 6.3 Payer portal (doc 11 §8, doc 20 §9)
**Routes:** `/payer` home + `/payer/methods`, `/payer/consent`, invitation-accept. `authorizePayer({mutating:true})`; scope derives entirely from the caller's own `ResponsiblePayer` rows — never an org id from the client. Rate-limited; catalogued in `SELF_SERVICE_ROUTES`.
**Home layout:** linked students grouped by organization; per student — Amount Due, recent invoices, receipts, payment status. Deliberately small and financial: **no schedule, no training data, no cross-tenant branding** (doc 11 §8).
**Methods:** list of own methods (safe metadata only) with **Add** (launches the provider-hosted setup flow), Verify (ACH micro-deposit → straight to the Stripe-hosted page; never an amount field in AeroOps), set default, detach.

### 6.4 Consent capture (doc 20 §3.3, §9)
The **consent screen** (rendered by AeroOps immediately before the hosted setup, or on re-acceptance) is deliberately plain: org name, the exact versioned billing-authorization text, the amount context ("charged after each approved flight review"), a **single un-prechecked** checkbox (`acceptConsent: true` literal required), and "You can revoke this at any time in your payment settings." No dark patterns; a parent reads it in fifteen seconds (doc 20 §9). Consent **can never be performed by staff, AI, or impersonation** — staff *initiate*, the paying party *accepts* in their own session (doc 20 §7). A version bump flips consent to stale (derived at read) and surfaces a re-accept notification + a two-click Sequence-C refresh; the org settings screen states the consequence before confirming the bump ("All payers must re-accept before their next automatic charge").

### States (all payer/method surfaces)
- **Loading:** `Skeleton` chips/rows.
- **Empty:** methods list explains what saving a method enables; payer with no `User` shows "Payer cannot receive notifications — no account yet" + invite action (doc 31 §8), never silently claimed as notified.
- **Error:** ACH pending-verification rows show the expected window + a Verify button; provider-detach-failed still detaches locally (local state governs charging), drift → reconciliation exception.
- **Success:** the staff screen live-updates when the webhook lands; return page polls "Confirming with your bank…" and **writes nothing** (webhook-confirmed only).

### Light/dark + responsive
Payer portal is phone-first (parents use it on phones); method chips wrap; consent checkbox and text are large-tap. Bottom nav below `lg` where the portal has nav.

### 30-second task path (dispatcher onboarding a renter)
Student record → **Add payment method** → hand the renter the QR → renter scans, signs in, accepts consent + enters card on their phone → staff screen shows the method chip. No card numbers spoken, no staff keyboard entry.

---

## 7. Surface — Failure / retry & refund flows (confirmation friction)

**Principle (financial-consequence):** every control states its exact money consequence on the button; irreversible/large-consequence actions add friction proportional to the stakes (doc 25 §10, doc 26 §9). `variant="destructive"` for money-out; reasons required inline.

### 7.1 Failed-payments queue & retry (doc 25 §10)
**Where:** the Payment-failed tab of `/billing/queue` (§3) is the operational home; row detail opens a **failure drawer** (`Drawer`).
**Row/drawer:** review number, payer, **Amount Due**, category chip (`Declined`/`Insufficient funds`/`Card expired`/`Action required`/`Bank return`/`Do not retry` — `STATUS_TONE` entries), attempts count, age, next auto-retry, `Escalated` red-tier badge. The drawer shows the **append-only attempt timeline** (the accountant's "prove nothing was double-charged" view, one click).
**Actions, each consequence-labeled (doc 25 §10):**
- **Retry** — "Retry — charge Visa •••• 4242 $412.50 now" (never a bare "Retry"). Disabled while any attempt is `CREATED`/`PROCESSING` and for hard declines (method `SUSPENDED`). Amount re-resolved server-side = `min(snapshot, current Amount Due)`.
- **Update payment method** — generates the hosted link + a **copy-ready payer message** (drawn from the safe catalog, `payerCopyFor()`) so front desk can text/email manually. When a newer ACTIVE method exists, the UI pre-selects **"Use new method and retry"** (re-point + `FAILED → PROCESSING` in one action).
- **Record offline payment** (`billing.record_payments`) · **Reschedule** · **Void** (only when eligible) · **Place hold** (`revenue.financial_hold_manage`).
**Safe vocabulary (hard, contract-tested):** payer-facing surfaces render **only** `payerCopyFor()` output — never raw provider errors, never accusatory copy (a `stolen_card` shows generic "this method can't be used"). Staff see the normalized code; payers never do (doc 25 §4.3).
**Financial hold banner:** an ACTIVE hold renders on the student profile / dispatch board with reason + who placed it + resolution path ("Resolve Amount Due of $412.50 or contact the office") — visible before the student drives to the airport (doc 25 §10).

### 7.2 Refund flow — three tabs, live remainder, honest ACH (doc 26 §9)
**Where:** a **refund modal/`Drawer`** launched from a collected review's action bar (`revenue.refund`); a second approver approves (`revenue.refund_approve`, always-second-approval default).
**Three tabs (doc 26 §3.2.4):** ⚠ *SIMPLIFY:* the accurate path is the easy path — **Full refund** (pre-filled remainder) leads, **Specific charges** (line pick with per-line refunded-so-far, line-targeted allocation) second, **Custom amount** (proportional across categories) third.
**Confirmation friction (consequence-truthful, doc 26 §9):** the confirm button states the exact destination — "Issue refund of $200.00 to Visa •••• 4242" / "Issue $200.00 as customer credit (expires 2027-07-10)" / "Record $200.00 refunded by check". Live remainder math shown. **Inline warnings** as friction: age > 90 days requires an explicit confirm; **ACH 60-day return risk** states the plain risk with the date ("This bank payment can still be returned by the customer's bank until <date> — refunding now means a later return would leave the school out both amounts"); past the provider window → hard-block with `CUSTOMER_CREDIT`/`MANUAL` offered. Payer-facing status is honest: "Refund initiated — bank refunds typically take 5–10 business days"; never "refunded" before the terminal webhook.
**Void control:** "Void this Revenue Review — nothing will be charged"; post-approval adds "The approved record is kept and marked Voided" (doc 26 §9). Voids need no second approval (nothing collected).

### 7.3 Disputes (doc 26 §3.3, §9)
**Where:** a **dispute banner** (DISPUTED tone) on the review + a dispute queue; `revenue.dispute_manage` to act, viewing rides `revenue.review_view`.
**Layout:** amount, reason code in plain words ("Customer says they didn't authorize this charge"), an **evidence-due countdown chip**, an evidence checklist with one-click attach from existing org `Document`s (rental agreement, dispatch record, lesson record — what a flight school actually wins with), a link out to the Stripe dashboard for submission, and **"Mark evidence submitted"**. Outcomes state the money facts: "Dispute lost — $200.00 and a $15.00 bank dispute fee were withdrawn from the school's account." ACH-return-shaped disputes show "Bank return — cannot be contested". ⚠ *SIMPLIFY:* Part 2/3 tracks/stores/notifies; **actual evidence submission happens in the Stripe dashboard** (auto-assembly is deferred) — the UI is honest about that.
**Clawback queue:** compensation decisions appear in the Instructor Compensation queue — "Refund on RR-1042 touched instruction charges — reverse $60.00 of Alex R.'s compensation?" with Keep / Reverse (required reason on Reverse). Instructors see only the applied outcome on their own records (doc 26 §9).

### States
- **Loading/Empty/Error:** every queue has all three; the failed-payments **empty state is a feature** — "No failed payments. Nice." (doc 25 §10). Dispute queue empty: "No open disputes."
- **Concurrency:** two staff hitting Retry → one wins, the other gets 409 "Charge already in progress — refresh"; one attempt, one provider call.

### Light/dark + responsive
Drawers follow the `ui/drawer.tsx` focus-trap + ESC + focus-restore contract. Category/escalation chips carry text. Mobile parity throughout.

### 30-second task path (Director of Operations, morning failure sweep)
Open Payment-failed tab → top row shows category + Amount Due → tap **Update payment method** (copies a ready message to text the parent) or **Retry — charge Visa •••• 4242 $412.50 now** → done. Each row resolves on one screen.

---

## 8. Surface — Connect onboarding settings page + status

**Route:** `/settings/payments` — a **"Payments" card** (replaces today's "Stripe payments: Planned" badge); return/refresh at `/settings/payments/connect/return` and `/refresh` (doc 19 §9).
**Primary persona:** Owner (or School Admin) — no Stripe vocabulary required.
**Data/authorization:** read via `revenue.payment_policy_manage`; initiate/continue/sync via `revenue.connect_manage` (`{mutating:true}`). `ConnectedAccount` mirror; absent row = `NOT_STARTED`.

### Layout — one card, one primary action, plain language (doc 19 §9)
`Card` whose copy + `StatusBadge` + primary `Button` derive from the seven-status derivation (doc 19 §3.2):

| State | Copy | Primary action |
|---|---|---|
| `NOT_STARTED` | "Accept online payments from your students. Setup takes about 10 minutes and is handled securely by Stripe." | **Set up payments** (terms checkbox + version inline) |
| `PENDING` | "Setup in progress — Stripe is verifying your information." | **Continue setup** / Refresh status |
| `REQUIREMENTS_DUE` | "Payments are on. Stripe needs more information by **Jul 22** or payments will pause." | **Provide information** |
| `RESTRICTED` | "Payments are paused — Stripe needs information from you. Your invoices can still be sent and paid by cash or check." | **Fix issues** |
| `ENABLED` | "Payments are on. Statement descriptor: *BLUE RIDGE AVIATION*. Cards ✓ · Bank debits (ACH) ✓/pending" | Refresh status |
| `DISABLED` / `SUSPENDED` | "Payments are unavailable. Contact AeroOps support." (+ reason category, never raw provider codes) | Contact support |

Requirement keys translate to human labels via a `src/lib` catalog ("company.tax_id" → "Business tax ID") with an honest fallback to the raw key. ⚠ *SIMPLIFY:* one status card, one next action — Stripe's requirements taxonomy is **not** exposed; the accountant sees what's needed and by when, nothing else (doc 19 §9). All seven statuses register in `STATUS_TONE` (ENABLED green, REQUIREMENTS_DUE amber, PENDING/NOT_STARTED gray, RESTRICTED/SUSPENDED/DISABLED red).

**Onboarding sequence (doc 19 §3.4):** click **Set up payments** (accept in-app terms) → POST creates the row (`PENDING`) → server mints a single-use hosted Account Link → client redirects to **Stripe-hosted** onboarding (AeroOps sees no KYC/bank data) → return page triggers a retrieve-and-reduce sync and renders the **real** derived status (the redirect itself is never trusted, doc 19 §3.6). "Refresh status" does a manual retrieve-and-reduce.

**Platform Console** (`platform.connect.view`, out of the org app): a `ConnectPanel` on the org detail page — status chip, opaque `acct_…`, charges/payouts flags, requirement keys + deadline, disabled reason, terms/sync recency, suspend/reinstate/sync-now (`platform.connect.suspend`). **No balances, payouts, customer data, or secrets** — the model cannot store them (doc 19 §9).

### The readiness consequence everywhere (doc 19 §3.8)
When the account is not ready, degradation is graceful, never a stuck workflow: the review readiness checklist (§2) shows "Payments account not set up" and the approve control converts to manual-invoice wording; the due-charges queue shows held charges with the reason; manual invoice + offline recording keep working. Method capture is allowed in `PENDING`/`REQUIREMENTS_DUE`/`RESTRICTED`, refused in `SUSPENDED`/`DISABLED`/`NOT_STARTED`.

### States
- **Loading:** `Skeleton` card.
- **Empty:** the `NOT_STARTED` card *is* the empty state.
- **Error:** `REVENUE_CHARGING=off` → card reads "Online payments are not yet available" with no initiate button; provider retrieve timeout → status unchanged, staleness keeps it in the reconciliation sweep, "Refresh status" available.
- **Success:** first `ENABLED` fires a "Payments are ready" notification (doc 19 §7).

### Light/dark + responsive
Single card, full-width below `md`; status chip tones from `STATUS_TONE`; bottom nav below `lg`.

### 30-second task path (Owner)
Settings → Payments → **Set up payments** (check terms) → complete on Stripe → back on the card, see "Payments are on." Everything financial that was manual-invoice degraded now auto-charges.

---

## 9. Surface — Student / payer financial views

**Route:** `/billing/my` (student in-app self-view, gate `revenue.self_view`); the same **view contract** renders in the `/payer` portal (§6.3) via `authorizePayer()` + relationship capability flags.
**Primary persona:** Student pilot; parent/responsible payer.
**Data/authorization:** identity resolved **server-side** from the session (`session.userId → Student (userId @unique)`; payer via `StudentPayerRelationship`). The self-view engine (`src/lib/revenue-self.ts`) is scoped to own identity and **must never import `revenue-dashboard.ts`** (static source-scan test, doc 30 §6). Every id in the URL not owned by the session → 404.

### Layout — their own money, complete and honest, structurally nothing else (doc 30 §6.1)
`PageHeader` (no "Revenue Engine" eyebrow for students — plain). Then:

| Block | Renders | Source (doc 30 §6.1) |
|---|---|---|
| **Amount Due** | verbatim "Amount Due" (never "account balance"), itemized per review + a total across open reviews | ADR-035 derivation over own invoices only |
| Revenue Review summary | own reviews, customer-facing status names, flight date, aircraft, line summary from `approvalSnapshot` once approved | `RevenueReview where studentId/payerId = own` |
| Invoice | frozen lines + totals, itemized | `Invoice`+`InvoiceLine` via `review.invoiceId` |
| Payment status | customer-facing status + plain ACH copy ("typically take about 4 business days to clear") | review status + safe method snapshot |
| Receipt | in-app receipt per settled payment: INV-…, date, amount, method brand+last4, itemized breakdown | `Payment` via own invoices |
| Refund | "$150.00 refunded to Visa •• 4242, May 3", incl. refund-to-credit with remaining credit | `Refund`/`CustomerCredit` (own) |
| Payment methods | safe metadata only, default marker, expiring-soon nudge; "Update payment method" launches hosted setup when self-service enabled, else "Contact your school to update" — never dead-ends | `PaymentMethodReference` (own) |
| Payment history | chronological settled payments, refunds, credits applied, with receipts | own `Payment`/`Refund`/`CreditApplication` |

Rows rendered as `Card`s + `Table`s; amounts `tabular-nums`; statuses via `StatusBadge`. A pre-approval review shows "Being prepared — your school is reviewing this flight's charges" with **no editable anything** (students never see drafts churn line-by-line, doc 30 §6.3).

### The never-show list — enforced, not decorative (doc 30 §6.2)
School revenue, instructor compensation, platform fees, other customers, and org-wide reports are **structurally absent** — the serializer is an allowlist (fields enumerated), the engine is own-identity-scoped, and the STUDENT bundle lacks `billing.view`/`revenue.review_view`/`reports.view` so `/billing`, `/billing/queue`, `/reports`, `/executive` render the permission-denied state. Payers see only students linked by an ACTIVE relationship, financials only where they are the snapshotted bill-to party (unless `fullFinancialVisibility`), and **never training records** (doc 11 §3.9). Contract-tested (Part AC): a student self-view body contains no `InstructorEarning`, `PlatformFee`, `RevenueAllocation`, or foreign-student ids.

### Tone (doc 30 §6.3)
Plain language: "Amount Due", "Paid", "Refunded", "Payment didn't go through — please update your payment method". Every charge itemized (a student who sees *why* calls the front desk less). Failure copy is customer-friendly, never raw decline codes.

### States
- **Loading:** `Skeleton` matching the block stack.
- **Empty:** `EmptyState` "No charges yet. Your flight charges and receipts will appear here."
- **Error:** inline retry per block; a failed block never exposes another person's data (fails closed to nothing).
- **Success:** payment-method update returns to a polling status page ("Confirming…") that writes nothing.

### Light/dark + responsive
Phone-first (students/parents on phones); single-column blocks; bottom nav below `lg`. Solves the ROLES_AND_WORKSPACES gap "Student Pilot has no billing/balance nav home" — `/billing/my` + "My Payments" nav is that home.

### 30-second task path (student)
Tap "My Payments" → Amount Due at the top, itemized → tap a review to see the itemized receipt → done. Or "Update payment method" → hosted flow.

---

## 10. Surface — Notifications

**Routes:** `/notifications` (existing center, **expanded**) + `/settings/notifications` (new preferences). Payer variant surfaces in `/payer` (§6) when the portal ships.
**Primary persona:** everyone — payer, instructor, approver, accountant — each finding exactly one truthful, actionable message.
**Engine:** all revenue rows written by the single `src/lib/revenue-notifications.ts` (doc 31 §3.2); notifications are **pointers, never truth** — the durable queues (§3) are the real state.

### Notification center (existing page extended, doc 31 §9.3)
Rows in the existing `divide-y Card` list, driven by the `KIND_META` icon+color map (the type system forces entries for all ten new `NotificationKind` values: `REVENUE_REVIEW_ACTION`, `PAYMENT_SCHEDULED`, `PAYMENT_RECEIPT`, `PAYMENT_FAILED`, `PAYMENT_METHOD_REQUIRED`, `REFUND_ISSUED`, `DISPUTE_OPENED`, `COMPENSATION_APPROVED`, `EXPORT_READY`, `RECONCILIATION_EXCEPTION`). Each row: new-kind icon, title/body (consequence-truthful verbs — *will be charged / was charged / could not be charged / will not be charged*), a **counter badge** (`count`) for aggregated org-queue rows, relative `lastEventAt`, and row navigation via `linkPath` (app-relative, deep-links into the review/receipt/queue surface). Statuses inside linked surfaces come from `STATUS_TONE` only. `MarkAllRead` unchanged.

**Anti-spam (doc 31 §3.6):** counter rows collapse busy topics ("4 Revenue Reviews are awaiting your approval", "30 awaiting" — one row per approver, not 30); the payer billing-status thread refreshes one row (approved → scheduled → voided) so the payer always sees the latest truth; ACH produces exactly two payer rows (initiation + terminal), nothing in the multi-day window. Actor suppression: no "you approved RR-1042" echo.

**Delivery honesty (doc 31 §3.7):** header copy corrected to "Notifications are in-app. Email delivery is not yet configured." The email column in preferences is visible but disabled with "coming soon". `emailStatus` renders an "emailed" state only from `SENT` (no writer until Part 3) — never claims a delivery that didn't happen.

### Preferences (new, `/settings/notifications`, doc 31 §9.3)
`GET/PATCH /api/notifications/preferences` (`{mutating:true}`, own rows only, zod-validated topic). Layout: topic list grouped by kind, a toggle per topic; **mandatory topics shown locked** with the reason ("Always on — payment outcomes are always delivered"). Mandatory floor = `instructor_review_required`, `changes_requested`, the payer money family (`review_approved` incl. voided refresh, `ach_initiated`, `payment_receipt`, `payment_failed`, `payment_method_required`, `refund_issued`), and org-side `dispute_opened` (doc 31 §4). A preference row for a mandatory topic is refused 422.

### Trigger→recipient at a glance (doc 31 §3.4 — full matrix there)
Payer money family → `payingParty(review)`, mandatory, consequence-truthful copy with Amount Due. Approver queue topics → `holders(revenue.approve)` as counter rows. Instructor → "Confirm your time on RR-1042" (mandatory), "3 entries approved today — $312.50" (compensation, counter). Dispute opened → `holders(revenue.refund)` + escalation roles with `evidenceDueBy`; payer never notified of a dispute they raised. Reconciliation exception → `holders(revenue.reconciliation_manage)`. Export ready → `requester(job)`.

### Content allowlist (doc 31 §6.2)
Titles/bodies/`linkPath`/payloads/logs carry only: RR-/ADJ-/INV- numbers, amounts+currency, dates/windows, tail, names, method **brand+last4** (the ceiling), safe-coded failure reasons, evidence deadlines, export names. **Never** PAN/CVV/bank numbers, tokens/secrets, raw provider errors, or absolute URLs. `linkPath` is app-relative (`^/`); links needing a fresh secret (hosted method setup) point at an AeroOps page that mints the session **on click after authorization** — the row never carries a token.

### States
- **Loading:** `Skeleton` rows.
- **Empty:** "You're all caught up."
- **Error:** the badge/count degrades to "—", never a false zero; a lost notification loses a ping, never money (the queue still shows it).

### Light/dark + responsive
`max-w-2xl` list; icons+tone with text; mobile parity; bottom nav below `lg`. Notifications **never** carry money-mutating buttons — they navigate to the authorized surface where the action lives behind its own gate (doc 31 §9.3).

### 30-second task path (parent)
Push/in-app "RR-1042 approved — $412.50 will be charged to Visa •••• 4242 today" → (later) "Payment received — $412.50 … View receipt" → tap → receipt. If it fails: "We couldn't process your $412.50 payment — card declined. Update your payment method" → tap → hosted setup.

---

## 11. Cross-cutting compliance & test hooks

- **Hidden not disabled + dual enforcement:** every mutating control above is hidden when the viewer lacks the key or is read-only-impersonating, **and** the owning route refuses `{mutating:true}` — both, never either (doc 30 §11; constitution). No AI pathway acts from any surface.
- **One engine / derive-at-read:** all dashboard tiles, `/executive` figures, and queue counts call `src/lib/revenue-dashboard.ts`; nothing is marked paid client-side; paid = webhook-confirmed (doc 30 §10, §4.2 metric→source map is the single citation for every figure).
- **Terminology (UX-gate):** dispatch/release/return/closeout; Revenue Dashboard/Review/Item/Allocation, Instructor Compensation, Financial Export, Amount Due, Payment Method. Never "check-in", "ticket", "account balance".
- **States are the feature:** every surface ships loading (`loading.tsx` skeletons), empty (`EmptyState`, never "No data"), and actionable error states; light+dark decided together; desktop/tablet/mobile with bottom nav below `lg`.
- **Design-system fidelity:** only `Card`/`Button`/`Badge`+`StatusBadge`/`Table`/`Input`/`Select`/`Textarea`/`Label`/`Drawer`/`PageHeader`/`EmptyState`/`Skeleton`/`Progress`/`Avatar` from `src/components/ui`; the reports `downloadCsv`/`useMode`/`tooltipStyle` + Recharts pattern for any chart; extend never fork.

## 12. Open questions (product-owner decisions only)

1. **Approve-from-card default reach.** Doc 03 §10 Q1: when `instructorMayApproveRoutine` is on with charge-immediately timing, instructor self-approval charges a customer's card from the queue card. Ship instructor approve-from-card at GA, or force routine instructor approvals to a scheduled/ops-confirmed charge? (Recommendation: policy off by default; owner opts in with the consequence stated.)
2. **Student self-service method updates at GA.** Doc 30 §15 Q3 / doc 20 §11 Q1: should `/billing/my` and `/payer` default to self-service "Update payment method" ON (payer convenience) or OFF ("Contact your school", schools control the money conversation)? (Recommendation: OFF by default, one org toggle.)
3. **Platform-fee tile visibility to org staff.** Doc 30 §15 Q1: keep the org-transparent platform-fee tile for all `billing.view` holders (doc 12) vs hide per spec Part W commercial discretion. (Recommendation: keep it visible — discovering the fee only on a payout statement is a trust failure — but it touches commercial posture.)
4. **Payer notification mandatory-floor vs org switches.** Doc 31 §11 Q1: should the failure/refund payer notifications pierce `payerNotificationsEnabled`/`receivesNotifications`? Part 3 honors doc 11 (org switches win, loud settings warning). (Recommendation: let money-moved/failed always reach the payer, via a doc-11-coordinated amendment.)
5. **`/executive` consolidation.** Doc 30 §15 Q2: fold `/executive` revenue panels into `/billing` after telemetry, or keep two executive surfaces? (Recommendation: consolidate after Part 3 telemetry.)

## Compliance note
Design only. No schema, code, migration, Stripe object, or live charge ships with this document; Stripe test mode is the only environment referenced; no production email; no Part 1/2 doc (00–35) is modified or weakened. All model/enum/status names trace to [13-database-model.md](./13-database-model.md) and [34-part2-database-additions.md](./34-part2-database-additions.md).
