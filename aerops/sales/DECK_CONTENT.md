# AeroOps — Sales Deck Content

Slide-by-slide copy for the AeroOps presentation deck. Written for a visual
deck: minimal words on screen, weight carried by product screenshots. Roadmap
items are labeled as roadmap wherever they appear; everything unlabeled is
shipped and demonstrable today.

Format per slide: **Headline** (≤7 words) · *subhead* · body/bullets ·
`[VISUAL: …]` · _Speaker notes_.

---

## Slide 1 — Cover

# AeroOps
### The Operating System for Aviation

*Run the operation, not the paperwork.*

`[VISUAL: AeroOps wordmark on the navy brand field; faint dashboard screenshot
behind glass.]`

_Speaker notes: Open on the promise, not the feature list. AeroOps is the
system of record an operation runs its whole day on._

---

## Slide 2 — Mission

# One system. One truth.

Small aviation runs on whiteboards, dispatch binders, and five tools that
don't talk to each other.

- The schedule doesn't know the airplane is grounded.
- The invoice doesn't know the flight closed.
- The chief instructor recalls checkride readiness from memory.

**AeroOps makes the connected version the easy version.**

`[VISUAL: workflow diagram — five disconnected tools collapsing into one AeroOps core.]`

_Speaker notes: The incumbents digitized the forms. We connected the operation._

---

## Slide 3 — The industry runs on disconnected tools

# Fragmentation is the enemy

*Every seam between tools is where money and safety leak out.*

- **Revenue leaks** — flights that closed but never billed.
- **Airworthiness by memory** — the overdue inspection no spreadsheet flagged.
- **Training opacity** — readiness as tribal knowledge, not a record.
- **Compliance anxiety** — the FSDO conversation starts from recollection.

`[VISUAL: workflow diagram — the "gap" between schedule, maintenance, and billing highlighted in red.]`

_Speaker notes: These aren't feature gaps. They're structural failures of tools
that don't share a data model._

---

## Slide 4 — Why AeroOps

# An operating system, not an app

*Scheduling, dispatch, maintenance, training, and money as one continuous,
auditable motion — what airlines have had for decades.*

- One data model, not five products and a spreadsheet.
- Every computed answer carries its reasons.
- An immutable audit trail under every action.
- Adoptable by a 6-aircraft school in an afternoon.

`[VISUAL: architecture diagram — single core, modules orbiting, audit trail as the foundation layer.]`

_Speaker notes: This is the one-sentence thesis of the company. Land it slowly._

---

## Slide 5 — Platform Overview

# Everything the operation touches

*One login. One picture. One record.*

- **Fly** — Scheduling · Dispatch · Operations · Mission Control
- **Maintain** — Squawks · Work orders · Return-to-service · Parts
- **Teach** — Students · Instructors · Checkride readiness
- **Bill** — Invoices · Payments · Receivables
- **Know** — Reports · Executive view · Explainable insights

`[VISUAL: dashboard.png — the operator home showing the day's full operating picture.]`

_Speaker notes: Name the five verbs, then let the product do the talking for the
next dozen slides._

---

## Slide 6 — Dashboard

# What needs me today

*The morning triage, answered before the first click.*

- Today's flights, at a glance.
- **Needs Attention** — squawks, inspections due, checkrides, activity.
- Fleet status and weather for the active location.
- Personalized: every viewer sees only what their role should.

`[VISUAL: dashboard.png — "Needs Attention" row and Today's Flights centerpiece.]`

_Speaker notes: The owner opens this with coffee and knows the state of the
business in ten seconds._

---

## Slide 7 — Mission Control

# The operation on the wall

*A live, full-screen operations picture for the front desk and the ops room.*

- Real-time flight, fleet, and weather panels.
- The audit timeline as a first-class surface — not a log file.
- TV mode and scenes for the dispatch wall.

`[VISUAL: mission-control.png — the live wall in TV mode.]`

_Speaker notes: This is the trust surface. Everything that happened is visible,
in order, as it happens._

---

## Slide 8 — Scheduling

# Book it once, everywhere

*The schedule that knows the airplane, the instructor, and the student.*

- Conflicts caught before they're saved.
- Aircraft, instructor, student, and resource on one axis.
- Grounded aircraft can't quietly stay on the schedule.

`[VISUAL: schedule.png — the day/week scheduling grid.]`

_Speaker notes: The schedule is connected to airworthiness and to billing — so
one booking is entered once and reconciles everywhere._

---

## Slide 9 — Training

# The training pipeline, in the system

*Readiness with reasons — not reconstructed from memory.*

- Students, instructors, stage checks, and checkride queue in one place.
- Endorsements and currency on the record, not in a spreadsheet.
- Lesson records that follow the student through the syllabus.

`[VISUAL: training.png — the training / readiness board.]`

_Speaker notes: For the chief instructor, "who is ready, and why" stops living
in their head._

---

## Slide 10 — Fleet & Maintenance

# Airworthiness the system enforces

*Squawk → work order → return-to-service, with parts you can audit.*

- Squawks ranked by airworthiness impact.
- Signed return-to-service on the record.
- Parts movement as a typed, traceable ledger.
- Ground an aircraft and see the blast radius.

`[VISUAL: maintenance.png — squawk queue and work-order board with fleet health.]`

_Speaker notes: An airplane is either airworthy or it isn't. The system makes
that a fact, not an opinion._

---

## Slide 11 — Operations

# The day, in motion

*Release, watch, resolve, close out — without phone-tag.*

- Live releases and returns from one board.
- Status that's always truthful across schedule and maintenance.
- Conflicts and grounding impact surfaced before they bite.

`[VISUAL: operations.png — the operations board / dispatch releases view.]`

_Speaker notes: The dispatcher's whole job is that the right airplane, CFI, and
student are in the same place. This is where that happens._

---

## Slide 12 — Billing

# Money that reconciles itself

*Invoices, payments, and receivables built into the operation — not bolted on.*

- One invoice per flight, generated at closeout.
- Money is exact by construction (`Decimal`, never float).
- Receivables aging and payment records in the tenant.

`[VISUAL: billing.png — invoices and receivables view.]`

_Speaker notes: Note honestly — invoicing, ledgers, and receivables ship today.
Card processing on invoices is roadmap (Stripe adapter)._

---

## Slide 13 — One Motion: Dispatch → Invoice  *(feature moment)*

# One motion. No leak.

*The flight closes. The meters move. The invoice exists. Atomically.*

- Hobbs/Tach closeout updates meters, ledger, and invoice **in one transaction.**
- A closed flight cannot silently go unbilled.
- If any step fails, none of it commits.

`[VISUAL: workflow diagram — closeout arrow moving meters + ledger + invoice as a single atomic block.]`

_Speaker notes: This is the single most important slide for a finance buyer.
Revenue leakage isn't reduced — it's made structurally impossible._

---

## Slide 14 — Reports

# Numbers you can defend

*Executive reporting with the reasons behind every figure.*

- Revenue, utilization, and instructor productivity.
- Executive view for the owner and the board.
- An immutable audit trail underneath every number.

`[VISUAL: executive.png — the executive summary view; inset of reports.png.]`

_Speaker notes: "Can I hand my accreditor a defensible record without a week of
prep?" Yes — because the trail was never optional._

---

## Slide 15 — Role-Based Experience

# One product. Every seat.

*The student, the CFI, the dispatcher, the chief instructor, the ops director,
and the owner each open their own AeroOps.*

- Personalized by **permission**, never hardcoded by title.
- Student Pilots get a dedicated my-training workspace — never finance or fleet.
- Owners and Operations Directors see everything.

`[VISUAL: role dashboards — 2×3 grid of Student, Instructor, Dispatcher, Chief Instructor, Ops Director, Owner views.]`

_Speaker notes: Same system of record, six different front doors. No one sees
data their role shouldn't._

---

## Slide 16 — Customization

# Fits your operation, not the other way around

*Configure the product to the operation without a consultant.*

- Toggle dashboard widgets per user.
- Role-driven navigation and custom-role templates (Registrar, Front Office, Safety Officer, and more).
- School branding, time zone, and multiple locations.

`[VISUAL: dashboard.png with the Customize popover open; inset of settings/branding.]`

_Speaker notes: Dozens of real aviation job titles, zero new code — because a
role is just a bundle of permissions._

---

## Slide 17 — Import & Integrations  *(migration moment)*

# Bring your data. Roll it back if you don't like it.

*The Import Center is why switching isn't scary.*

- Presets for Flight Circle, Flight Schedule Pro, FlightLogger, Aviatize, QuickBooks, Stripe.
- Map → **test** (a real, rolled-back run) → commit → rollback manifest.
- Public API v1 and signed webhooks for what comes next.

`[VISUAL: import.png — the import wizard mapping/test step.]`

_Speaker notes: The biggest competitor is the incumbent's data-hostage
situation. "Test it, and roll it back" removes the fear._

---

## Slide 18 — Mobile

# The operation in your pocket

*A responsive, installable app — for the ramp, the desk, and the couch.*

- Installable PWA: add to home screen, works on phone and tablet.
- Bottom navigation and full light/dark parity.
- Every role's view, sized for the device.

`[VISUAL: mobile-dashboard.png — the student/operator mobile view.]`

_Speaker notes: Be precise — this is an installable PWA today; native app-store
wrappers are roadmap. It behaves like an app now._

---

## Slide 19 — Why Flight Schools Choose AeroOps

# Adopt it in an afternoon

*Built for the owner who is also the operations department.*

- One place — no re-entering a flight into three systems.
- Billing that happens by itself at closeout.
- Know tonight what today made.
- No manual, no consultant, no back office required.

`[VISUAL: dashboard.png + billing.png side by side — "the morning" and "the money."]`

_Speaker notes: The gravitational center of our customer base is the 4-aircraft
owner-operator. Speak to them._

---

## Slide 20 — Proof & Trust  *(trust moment)*

# Explainable by construction

*Trust is the product.*

- Every conflict, readiness score, and insight **shows its reasons**.
- The audit trail is immutable — never rewritten, never skipped.
- AI advises; it never acts. Mutations always require a permissioned human.
- Multi-tenant isolation enforced from the session, never the client.

`[VISUAL: intelligence.png — an insight card with its factors/confidence expanded.]`

_Speaker notes: This is what separates us from a scheduler with a dashboard.
Every answer can be interrogated._

---

## Slide 21 — Security & Architecture

# Enterprise-grade underneath

*The quiet parts that let a school sleep at night.*

- **Multi-tenant** — every record scoped to the organization by construction.
- **RBAC** — data-driven permissions, one authorization gate, no exceptions.
- **Audit** — an immutable trail under every mutation.
- **Atomic money** — closeout moves meters, ledger, and invoice as one transaction.

`[VISUAL: architecture diagram — tenant isolation, single authorize() gate, audit foundation.]`

_Speaker notes: MFA, session revocation, and hashed tokens ship today. This is
the SOC 2 foundation, honestly framed as a foundation._

---

## Slide 22 — Roadmap

# What's next — clearly future

*The seams are already built; we're plugging in the adapters.*

- **Delivery** — email & SMS notifications, web push.
- **Payments** — Stripe subscriptions and card-on-invoice.
- **Live weather** — real METAR/TAF (simulated today).
- **Documents** — cloud file storage with signed URLs.
- **Operational intelligence** — airworthiness forecasting, currency guards, live AI narration.

`[VISUAL: roadmap timeline diagram — Beta → 1.0 → 1.5, adapters snapping into existing seams.]`

_Speaker notes: Be explicit: everything on this slide is roadmap. The insight
engine with reasons ships today; predictive forecasting and live narration are
what's coming. Honesty is the sale._

---

## Slide 23 — Pricing Philosophy

# Priced for the operation you are

*Modern SaaS economics — no consultant, no hostage fees.*

- Transparent per-aircraft / per-seat pricing.
- Self-serve onboarding and a real import path out of any competitor.
- Scale shouldn't punish you — pricing grows with the operation, not against it.

**Transparent pricing — contact us.**

`[VISUAL: clean pricing-philosophy panel; no numbers, three principle tiles.]`

_Speaker notes: No fabricated prices. The message is the philosophy: transparent,
self-serve, no lock-in._

---

## Slide 24 — Closing / CTA

# Run the operation, not the paperwork.

### See your school on AeroOps.

**Request a demo · aerops.io**

`[VISUAL: mission-control.png behind glass; AeroOps wordmark; CTA button.]`

_Speaker notes: Close on the mission line we opened with. Offer to walk their
actual operation through a live demo org._
