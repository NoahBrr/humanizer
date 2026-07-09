# AeroOps Customer Advisory Board

A standing panel of twelve representative operators we design *for*. It is
not a marketing artifact — it is a decision tool. When a feature is
proposed, we ask which board members it serves, which it burdens, and which
would notice if it disappeared. The board gives every one of the seven
personas in [VISION.md](./VISION.md) a working profile, and adds the
operational roles VISION serves but doesn't break out on its own —
independent instructor, student, finance administrator, and multi-location
operator — so the whole team can reason about them by name.

**How to use this board**

- Every feature slice names the board member(s) it serves in its plan
  (the architect gate). If it serves none, it isn't on the roadmap.
- When two members want opposite things, [NORTH_STAR.md](./NORTH_STAR.md)
  and [PRODUCT_PRINCIPLES.md](./PRODUCT_PRINCIPLES.md) break the tie —
  never "whoever shouts loudest."
- The simple case must not get heavier so the complex case can get lighter
  ([PRODUCT_PRINCIPLES.md](./PRODUCT_PRINCIPLES.md) #11 "Powerful When
  Necessary"; [PRODUCT_ROADMAP.md](./PRODUCT_ROADMAP.md) 1.5). The
  owner-operator of a 4-aircraft school is the gravitational center of this
  board; the university director and multi-location operator are the edge we
  grow toward, not the default we design around.
- Board members map to real seats in the demo org (Golden Gate Aviation
  Academy) so their workflows can be walked in the running app.

**Persona index**

| # | Board member | Operation | Primary surfaces |
|---|---|---|---|
| 1 | Small & Growing Part 61 Owner | 3–10 aircraft school/club | Dashboard, Executive, Billing |
| 2 | Part 141 Chief Flight Instructor | Approved 141 school | Training, Students, Schedule |
| 3 | University Aviation Program Director | Collegiate 141 program | Executive, Reports, Training |
| 4 | Dispatcher / Front Desk | Any operation | Dispatch, Schedule, Operations |
| 5 | Maintenance Manager / Director of Maintenance | School, rental, or shop | Maintenance, Aircraft |
| 6 | Front Office Administrator | Any operation | Schedule, Students, Billing |
| 7 | Independent Flight Instructor | Solo CFI / individual account | Schedule, Students, `/welcome` |
| 8 | Student Pilot | Learner at a member school | Training, Schedule, Billing |
| 9 | Finance / Billing Administrator | Growing school or club | Billing, Reports |
| 10 | Multi-location / Growing Operator | 2+ bases, 20–100+ aircraft | Executive, Operations, Schedule |
| 11 | Flying Club President / Board Member | Member-owned club | Executive, Billing, Reports |
| 12 | Corporate Flight-Department Manager | 1–5 aircraft under a company | Schedule, Executive, Reports |

---

## 1. Small & Growing Part 61 Owner

*"I fly, I instruct, I run the business, and I do payroll on Sunday night.
I don't have an operations department — I am the operations department."*

- **Operation:** Owner-operator of a 4-aircraft Part 61 school with two
  employed CFIs and a handful of independents. Growing toward 8 aircraft.
- **Goals:** Everything in one place; billing that happens by itself;
  knowing *tonight* what *today* made; hiring the next instructor without
  the wheels coming off.
- **Daily workflow:** Opens the dashboard with coffee to see the day's
  operating picture → checks nothing needs attention (squawks, expiries) →
  flies or instructs 2–3 lessons → glances at the schedule between flights →
  closes out the day's dispatches → checks the day's revenue before leaving.
- **Pain points:** Wears every hat; context-switches constantly; can't
  afford a tool that needs a consultant to configure; has been burned by
  software that digitized the *forms* but not the *operation*.
- **Success metrics:** Hours flown per aircraft per month; revenue per day;
  accounts-receivable age; instructor utilization; zero missed inspections.
- **Most-used pages:** Dashboard (home base), Executive, Billing, Schedule.
- **Common frustrations:** Re-entering the same flight into the schedule,
  the logbook, and the invoice; discovering an unpaid balance weeks late;
  "enterprise" tools that assume a back office they don't have.
- **Product expectations:** Adopt it in an afternoon; the dashboard answers
  "what needs me today?" without a click; money reconciles itself at
  closeout; nothing requires reading a manual.
- **Questions they'd ask:** *"What did today make?" · "What's about to
  ground an airplane?" · "Who owes me money?" · "Can I onboard my new CFI
  in ten minutes?"*
- **Features they'd want:** Guided new-org setup checklist; contextual
  actions ("book next lesson" from the student page); activation score;
  the dashboard's "Needs attention" row as the single morning triage.

## 2. Part 141 Chief Flight Instructor

*"The FAA can audit my training records at any time. I need the pipeline in
my head to live in the system instead."*

- **Operation:** Chief instructor of an approved Part 141 school; owns the
  syllabus, stage checks, and checkride readiness for 40–120 students.
- **Goals:** Training-pipeline visibility — who's ready for a stage check,
  whose endorsements are missing, who's cleared for a checkride — with the
  *reasons* visible, not reconstructed from memory.
- **Daily workflow:** Reviews the readiness board each morning → signs off
  completed stages → assigns stage checks → spot-checks lesson records for
  currency and endorsement gaps → clears (or holds) checkride candidates →
  reassigns students when an instructor is out.
- **Pain points:** Checkride readiness lives in his head and a spreadsheet;
  an endorsement gap surfaces the morning of a checkride; instructor
  turnover means orphaned students.
- **Success metrics:** Stage-check pass rate; time-to-solo and
  time-to-checkride per cohort; endorsement-completeness; no student flying
  solo without the endorsement on file.
- **Most-used pages:** Training, Students, Schedule, Reports.
- **Common frustrations:** No single "who is ready and why" screen;
  currency/endorsement rules that display but don't *guard*; reassignment
  that means editing twenty bookings by hand.
- **Product expectations:** Readiness with explained factors (matches the
  engine "reasons" rule); currency guardrails that *warn at booking and
  block at dispatch*; one-tap reassignment of a CFI's whole day.
- **Questions they'd ask:** *"Who is stage-check ready today and why?" ·
  "Which endorsements are missing before Friday's checkrides?" · "If I lose
  a CFI Monday, whose training stalls?"*
- **Features they'd want:** Chief-instructor pipeline board (readiness,
  stage checks, checkride queue on one screen); checkride-readiness nudge;
  bulk reassignment; currency guard at dispatch (Product Intelligence #1,3).

## 3. University Aviation Program Director

*"I'm not running a flight school. I'm running a degree program that
happens to fly airplanes, and my accreditor wants an audit trail."*

- **Operation:** Director of a collegiate Part 141 program — 60+ aircraft,
  hundreds of students in cohorts, multiple stage gates, accreditation
  obligations.
- **Goals:** Cohort-scale training records; fleet-utilization numbers that
  survive a provost's scrutiny; accreditation-grade audit trails; defensible
  data at term boundaries.
- **Daily workflow:** Reviews program-wide dashboards → tracks cohort
  progression against the term calendar → monitors fleet utilization and
  maintenance downtime → pulls reports for department meetings and
  accreditation → escalates bottlenecks (aircraft or instructor capacity).
- **Pain points:** Consumer flight-school tools don't think in cohorts or
  terms; utilization data is scattered; audit trails are an afterthought;
  scale exposes every seam a 4-aircraft tool never showed.
- **Success metrics:** On-time cohort progression; fleet utilization vs.
  capacity; instructor productivity; audit-trail completeness; cost per
  student-hour.
- **Most-used pages:** Executive, Reports, Training, Operations.
- **Common frustrations:** Reports that can't group by cohort/term; no
  cross-location fleet view; export gaps at audit time; per-seat pricing
  that punishes scale.
- **Product expectations:** The complex case gets *lighter* without making
  the simple case heavier; reporting depth (cohort/term grouping); immutable
  audit trail; scale that stays fast.
- **Questions they'd ask:** *"Is the spring cohort on track?" · "What's my
  fleet utilization against capacity this term?" · "Can I hand my accreditor
  a defensible record without a week of prep?"*
- **Features they'd want:** Cohort/term reporting; multi-location dashboards;
  instructor-productivity and aircraft-profitability trends; scheduled
  snapshots with restore-verify (Roadmap 1.5).

## 4. Dispatcher / Front Desk

*"My whole job is that the right airplane, the right instructor, and the
right student are in the same place at the same time — and that I hear about
a problem before the student does."*

- **Operation:** Dispatcher or front-desk lead at a busy single-base
  operation; the human switchboard for releases and returns.
- **Goals:** The day's flights, releases, and returns without phone-tag;
  conflicts caught *before* they happen; a clean closeout every time.
- **Daily workflow:** Opens Dispatch at start of day → releases flights as
  crews arrive → watches for weather and aircraft-status changes → resolves
  booking conflicts → receives returns and runs closeout (Hobbs, squawks,
  billing) → hands off open items at shift change.
- **Pain points:** Double-booked aircraft discovered at the desk; a grounded
  airplane still on the schedule; closeout math done by hand; the schedule
  and the maintenance status disagreeing.
- **Success metrics:** On-time dispatch rate; conflicts caught pre-flight;
  closeout accuracy; turnaround time; zero flights dispatched on a grounded
  aircraft.
- **Most-used pages:** Dispatch, Schedule, Operations, Mission Control.
- **Common frustrations:** Re-checking three screens to release one flight;
  closeout that doesn't atomically update meters + ledger + invoice; no
  early warning on conflicts.
- **Product expectations:** Conflicts surfaced *before* save; closeout as one
  atomic action; "blast radius" shown before grounding/cancelling;
  status that's always live and truthful.
- **Questions they'd ask:** *"Is this airplane actually flyable right now?" ·
  "Will this booking collide with anything?" · "Did closeout bill correctly?"*
- **Features they'd want:** Resource-conflict pre-warning; blast-radius
  confirmations; implausible-closeout catch (Hobbs vs. scheduled duration);
  auto-offer freed slots to the waitlist (Product Intelligence #5,8).

## 5. Maintenance Manager / Director of Maintenance

*"An airplane is either airworthy or it isn't. I need the squawks that
matter, the inspections that are coming, and a signature I can stand
behind."*

- **Operation:** Director of maintenance for a school, rental fleet, or
  shop; owns airworthiness, the work-order queue, and parts traceability.
- **Goals:** Squawks ranked by airworthiness impact; inspection countdowns
  that never surprise; signed return-to-service; auditable parts movement.
- **Daily workflow:** Reviews open squawks and fleet-health scores → triages
  the work-order board → orders/pulls parts through the movement ledger →
  performs and signs inspections → returns aircraft to service → forecasts
  the next grounding before it strands a schedule.
- **Pain points:** Squawks buried in a shared inbox; inspection deadlines
  tracked on a wall calendar; parts counts that drift; a grounding that
  strands a full day of bookings.
- **Success metrics:** Aircraft availability; time-to-return-to-service;
  no overrun inspections; parts stock above minimum; work-order backlog age.
- **Most-used pages:** Maintenance, Aircraft, Dispatch (for grounding).
- **Common frustrations:** Fleet health without *explained* deductions;
  parts quantities you can't audit; no forecast of the next grounding;
  grounding an airplane without seeing what flights it kills.
- **Product expectations:** Fleet-health with every deduction explained
  (matches the engine "reasons" rule); typed movement ledger for every part;
  RESTRICT-safe records; blast radius before grounding.
- **Questions they'd ask:** *"What's my worst airplane and why?" · "What
  grounds next, and when?" · "Where did that part go?" · "If I ground
  N735GG, whose lessons cancel?"*
- **Features they'd want:** Airworthiness forecast (inspection countdowns +
  repeat squawks); expiring-document sweep; parts low-stock alerts;
  return-to-service signing (Product Intelligence #2,9).

## 6. Front Office Administrator

*"I'm the first person the student talks to and the last person who touches
the paperwork. When something falls through a crack, it's my crack."*

- **Operation:** Office administrator handling enrollment, scheduling
  changes, family/customer communication, and first-line billing questions.
- **Goals:** Onboard a new student without a checklist in her head; keep the
  schedule truthful; answer "what do I owe?" instantly; never lose a task in
  the gap between systems.
- **Daily workflow:** Enrolls new students → books and reschedules lessons →
  fields billing and scheduling questions at the desk and by phone → chases
  missing documents → reconciles the day's small cash/card items → hands off
  open threads.
- **Pain points:** Student onboarding spread across forms; reschedules that
  ripple into billing errors; documents that never arrive; being the manual
  glue between the schedule, the roster, and the invoices.
- **Success metrics:** Onboarding time per student; schedule accuracy;
  first-contact resolution on billing questions; document-completeness.
- **Most-used pages:** Schedule, Students, Billing, Documents.
- **Common frustrations:** No guided onboarding; contextual actions missing
  ("add endorsement," "book next lesson" from where she already is); document
  expiries she finds out about too late.
- **Product expectations:** Guided student onboarding; contextual actions
  from the student page; a document vault with expiry visibility; clear,
  actionable errors that tell her the next step.
- **Questions they'd ask:** *"What's left to onboard this student?" · "Does
  this family owe anything?" · "Whose medical or renter's insurance is about
  to expire?"*
- **Features they'd want:** Student-onboarding checklist; contextual
  actions; document uploads with expiry feeds to the dashboard; waitlist
  auto-offer (Playbooks #1,2; Roadmap Beta/1.0).

## 7. Independent Flight Instructor

*"It's just me. I don't have a school behind me — I have my logbook, my
students, and my phone."*

- **Operation:** Freelance CFI operating as an individual account
  (`/welcome`), possibly instructing at one or more schools' aircraft.
- **Goals:** A clean record of her students and hours without a school's
  overhead; scheduling that fits between other jobs; a professional footing
  before she ever forms an org.
- **Daily workflow:** Checks her day → logs completed lessons and
  endorsements → tracks each student's progress → keeps her own currency and
  documents in order → occasionally joins a school's org by invitation.
- **Pain points:** Most tools assume an organization; she has none yet; she
  doesn't want an "empty enterprise app," she wants her day and her
  students.
- **Success metrics:** Students served; hours logged; currency kept;
  friction-free path from individual → joining or forming an org.
- **Most-used pages:** `/welcome`, Schedule, Students, Training.
- **Common frustrations:** Onboarding flows that demand an org on day one;
  no lightweight individual mode; join-by-invite that's clumsy.
- **Product expectations:** Individual accounts are first-class (session
  kind `individual` → `/welcome`), not a degraded org; joining an org via
  invite is one clean step; nothing pressures her into complexity she
  doesn't need.
- **Questions they'd ask:** *"What's my day?" · "Is this student endorsed?" ·
  "How do I join the school that just invited me?"*
- **Features they'd want:** A focused individual home; simple student and
  endorsement tracking; frictionless invite acceptance; instructor "my day"
  view (Roadmap 1.0).

## 8. Student Pilot

*"I just want to know when I'm flying, what I'm working on next, and whether
I'm behind."*

- **Operation:** Learner at a member school; a *consumer* of the platform,
  not an operator — but the reason the operation exists.
- **Goals:** Know the next lesson; understand progress toward the next stage
  and the checkride; see what's owed; feel the training has a shape.
- **Daily workflow:** Checks the next scheduled lesson → reviews what to
  prepare → after flying, sees the lesson recorded and progress advance →
  pays a balance → books the next lesson.
- **Pain points:** Opaque progress ("am I behind?"); surprise balances;
  scheduling by text-message tag; no sense of the path ahead.
- **Success metrics:** Lessons completed on schedule; visible progress to
  solo/checkride; no billing surprises; confidence in what's next.
- **Most-used pages:** Training (progress), Schedule, Billing.
- **Common frustrations:** Progress locked in the instructor's head; can't
  self-book; finds out about a balance late.
- **Product expectations:** A clear, honest progress view; self-service next
  booking; transparent billing; explanations, not jargon.
- **Questions they'd ask:** *"When do I fly next?" · "What's my next stage,
  and am I ready?" · "Do I owe anything?"*
- **Features they'd want:** Student progress view; self-booking; balance
  clarity; "book next lesson" from their own page (Playbooks; Roadmap 1.0).

## 9. Finance / Billing Administrator

*"Every flight is a transaction. My job is that every one of them is billed,
once, correctly, and that the money the report shows is the money in the
account."*

- **Operation:** Dedicated billing/finance administrator at a growing school
  or club; owns invoicing, receivables, and month-end.
- **Goals:** Every flight billed once and correctly; receivables under
  control; reports that reconcile to reality; a defensible money trail.
- **Daily workflow:** Reviews the day's closeouts and invoices → chases
  overdue balances → posts payments → reconciles the ledger → runs
  month-end revenue and AR-aging reports → investigates any closeout that
  looks wrong.
- **Pain points:** Flights that close without billing; duplicate or missing
  invoices; a report total that doesn't match the bank; no guard on an
  implausible closeout before it commits.
- **Success metrics:** Billing accuracy (one invoice per flight); AR-aging;
  days-sales-outstanding; zero unbilled closeouts; report-to-ledger parity.
- **Most-used pages:** Billing, Reports, Executive.
- **Common frustrations:** Money math that isn't atomic (meters, ledger,
  invoice drifting apart); float-rounding cents; no early catch on a bad
  Hobbs entry; invoice numbering that isn't exact within the tenant.
- **Product expectations:** Money is `Decimal`, never float; closeout is one
  transaction (meters + ledger + invoice); implausible-closeout catch guards
  the money path *before* it commits; auditable movements.
- **Questions they'd ask:** *"Is every flight billed?" · "What's overdue and
  by how long?" · "Does this month's report match the account?" · "Why is
  this closeout's Hobbs delta off?"*
- **Features they'd want:** Implausible-closeout catch; AR-aging views;
  per-org invoice-number sequences; card payments on invoices; utilization/
  profitability drift (Product Intelligence #5,7; Roadmap 1.5).

## 10. Multi-location / Growing Operator

*"I started with one field and four airplanes. Now I have three bases, and
the tool that got me here is the thing slowing me down."*

- **Operation:** Owner or ops director of a 2–4 location operation, 20–100+
  aircraft, mixed 61/141, multiple teams.
- **Goals:** One truthful picture across bases; balance fleet and instructors
  across locations; keep each base's day clean; grow without the operation
  fragmenting.
- **Daily workflow:** Scans a cross-location executive view → checks each
  base's day and exceptions → rebalances aircraft/instructors where demand
  is uneven → reviews per-location performance → escalates capacity
  constraints.
- **Pain points:** Location-blind tools; data that can't roll up *or* drill
  down; the active-location context leaking or lost; scale exposing latency
  and N+1 seams.
- **Success metrics:** Utilization balance across bases; per-location P&L;
  cross-location instructor coverage; no location's data bleeding into
  another's.
- **Most-used pages:** Executive, Operations, Schedule, Reports.
- **Common frustrations:** No cross-location dashboard; weather/ops boards
  that ignore the active location; reports that can't segment by base;
  performance sagging as the fleet grows.
- **Product expectations:** Active-location context is respected everywhere
  (the `aerops-location` cookie rule); roll-up *and* drill-down; tenant
  isolation absolute across bases; the platform stays fast at scale.
- **Questions they'd ask:** *"Which base is over capacity Tuesday?" · "Can I
  move N204SP to the busy field this week?" · "How does each location's P&L
  compare?"*
- **Features they'd want:** Multi-location dashboards; cross-location fleet
  balancing; scheduling-bottleneck alerts; per-location reporting
  (Product Intelligence #6; Roadmap 1.5).

## 11. Flying Club President / Board Member

*"I'm a volunteer with a day job. The club trusts me with its money and its
airplanes, and I answer to the members at the annual meeting."*

- **Operation:** Elected president or board member of a member-owned flying
  club; part-time steward accountable to a membership.
- **Goals:** Member self-service so the board isn't the help desk;
  equity/dues billing that runs itself; utilization and financial numbers
  the board and members can trust.
- **Daily workflow:** Checks club health between work obligations → reviews
  member balances and dues → monitors fleet utilization and reserves →
  prepares numbers for the board meeting → responds to member questions and
  the occasional dispute.
- **Pain points:** Volunteer time is scarce; disputes need defensible data;
  dues/equity billing is fiddly; board transitions lose institutional
  knowledge.
- **Success metrics:** Member satisfaction / self-service rate; dues
  collection; fleet utilization vs. reserves; board-report credibility;
  clean handoff between boards.
- **Most-used pages:** Executive, Billing, Reports, Members.
- **Common frustrations:** Being the manual billing engine; numbers the
  membership can dispute; no self-service; knowledge trapped in the last
  treasurer's spreadsheet.
- **Product expectations:** Member self-service; dues/equity billing that
  runs itself; utilization numbers the board can trust; an audit trail that
  survives a leadership change.
- **Questions they'd ask:** *"Are dues current?" · "Is the fleet earning its
  reserves?" · "Can I show the members numbers they'll believe?"*
- **Features they'd want:** Member self-service billing; equity/dues
  handling; trustworthy utilization reporting; scheduled snapshots for board
  continuity (Roadmap 1.0/1.5).

## 12. Corporate Flight-Department Manager

*"We're not a flight school. We move executives, and the airplane is a tool
the company owns. My job is that it's legal, available, and defensible when
finance or the FAA asks."*

- **Operation:** Manager of a corporate flight department — 1–5 aircraft
  operated under a company (Part 91), trip-centric rather than
  training-centric. VISION's persona for a *later* market (expansion #4,
  after the flight-school/club beachhead), on the board so the product
  doesn't accrete assumptions that would exclude it.
- **Goals:** Trip legs planned and flown on time; crew currency never in
  question; executive-grade reporting for the CFO; records defensible in an
  audit or an incident review.
- **Daily workflow:** Reviews upcoming trip legs and crew assignments →
  confirms each crew member's currency and duty status → coordinates
  maintenance around the trip schedule → closes out flights → produces
  utilization and cost reporting for company leadership.
- **Pain points:** Training-shaped tools that assume students and syllabi,
  not trips and crews; currency tracked in a spreadsheet; reporting that a
  CFO won't accept; no single defensible record.
- **Success metrics:** On-time trip completion; zero currency/duty
  violations; aircraft availability for demand; clean, exportable records;
  cost-per-hour transparency.
- **Most-used pages:** Schedule, Executive, Reports, Aircraft, Maintenance.
- **Common frustrations:** Everything framed as instruction; crew currency
  that displays but doesn't guard; reporting that can't speak the language
  of a corporate finance team.
- **Product expectations:** The training-centric core doesn't force
  trip-centric operations into the wrong shape; currency guardrails apply to
  crew, not just students; an immutable, exportable audit trail; executive
  reporting with explained numbers.
- **Questions they'd ask:** *"Is the crew legal for Thursday's trip?" · "Is
  the airplane available and airworthy for the leg?" · "Can I hand finance a
  cost report they'll trust?"*
- **Features they'd want:** Trip/leg scheduling; crew currency & duty
  tracking; executive/cost reporting; a defensible records export. Most sit
  in VISION's expansion markets (#4 corporate, #5 Part 135) and the Roadmap
  2.0 charter module — this seat keeps them from being designed out early.

---

## What the board tells us to build next

Reading the twelve together, the highest-frequency, highest-trust asks
converge — and they already lead the [PRODUCT_ROADMAP.md](./PRODUCT_ROADMAP.md)
Beta/1.0 tiers, which is the point of the exercise:

1. **Do it from where I am** — contextual actions (owner, admin, chief
   instructor, independent CFI all ask for this). *Playbooks #1,2,10,13.*
2. **Guard the money and the airworthiness before they commit** — currency
   guard, implausible-closeout catch, airworthiness forecast (finance,
   dispatch, maintenance, chief instructor). *Product Intelligence #1,2,5.*
3. **Tell me what needs me today** — the dashboard "Needs attention" triage
   (every operator persona). *Shipped in Phase 2.*
4. **Don't make me heavier as I grow** — multi-location, cohort/term
   reporting, scale that stays fast (university director, multi-location
   operator, club board). *Roadmap 1.5.*
5. **Meet me where I am on day one** — individual accounts, guided setup,
   frictionless invites (independent CFI, student, small owner).
   *Roadmap Beta.*

No board member asks for more surface area. Every one asks for less friction
on the surface they already use — which is exactly what NORTH_STAR and the
Zero-Friction lens demand.

## Related documents

[VISION.md](./VISION.md) · [NORTH_STAR.md](./NORTH_STAR.md) ·
[PRODUCT_PRINCIPLES.md](./PRODUCT_PRINCIPLES.md) ·
[PRODUCT_ROADMAP.md](./PRODUCT_ROADMAP.md) ·
[../operations/PLAYBOOKS.md](../operations/PLAYBOOKS.md) ·
[../design/DESIGN_SYSTEM.md](../design/DESIGN_SYSTEM.md)
