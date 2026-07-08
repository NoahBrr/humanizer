# AeroOps — 20-Minute Live Demo Script

**Audience:** owner-operators, chief instructors, DOMs, club boards, university program directors, corporate flight-department managers.
**Goal of the demo:** land one idea — *AeroOps is one operating system where the schedule, the airplane, the training, and the money are a single connected motion.*
**Format:** live, in the running app on the demo org **Golden Gate Aviation Academy**.

**Before you start (2 min, off the clock):**
- Have the app open and signed in as `admin@aerops.demo` (password `demo1234`), on `/dashboard`.
- Have five more tabs ready to log in as: `dispatch@aerops.demo`, `sarah.cfi@aerops.demo`, `student@aerops.demo`, `maintenance@aerops.demo`, `accounting@aerops.demo` (all `demo1234`).
- Know your prospect's seat. If they're a DOM, lean on Maintenance; if a club board, lean on Executive + role-based access.
- **Do not narrate the UI.** Narrate *their operation.* Every click should answer a question they actually have at 7 AM.

**Honesty guardrails for the presenter:** if asked about card payments, live weather, email, or file uploads — say **"on the roadmap"** and show the seam. Never imply simulated weather is live METAR. A buyer who catches one overclaim discounts everything else you said.

---

## 0:00–2:00 — Cold open: "What needs you today?"

**Where:** `/dashboard` (logged in as `admin@aerops.demo`).

**Do:** Don't tour the nav. Land on the dashboard and let the "Needs attention" row carry it — squawks, upcoming maintenance, checkrides due, recent activity — next to today's flights and fleet status.

**Say:**
> "This is the first screen the owner of Golden Gate sees with their coffee. Not a menu — a triage. Before anyone's phoned in, the system has already told them what needs a human today: which airplane is about to need an inspection, who's ready for a checkride, what closed out overnight. Nothing here was typed by hand. It's the operation, explaining itself."

**Wow beat:** Point out that *every* number on this screen is a live read of the same data the invoice, the logbook, and the maintenance board use — "there's no spreadsheet behind this."

---

## 2:00–4:30 — The schedule that knows the airplane

**Where:** `/schedule`.

**Do:** Show the day's bookings — aircraft, instructors, students on one board. Mention conflict detection (double-booked aircraft caught before save).

**Say:**
> "This is where most tools stop — a calendar. Watch what makes ours different: this schedule is wired to the airplane's real airworthiness status and to billing. When we release a flight from here, the system checks the aircraft is actually flyable — and when it comes back, the money takes care of itself. Let me show you the part nobody else does cleanly."

**Wow beat:** Tease the closeout. "Keep your eye on that 172 — we're about to fly it and close it out, and I'm not going to touch an invoice to bill it."

---

## 4:30–9:00 — The one motion: dispatch → closeout → invoice

**Where:** `/dispatch` (this is the centerpiece — give it the time).

**Do, part 1 — Release:** Open a pending flight. Walk the **release checklist**: fuel, oil, weather acknowledged, documents verified. Point out the airworthiness gate.

**Say:**
> "Before this airplane is released, AeroOps confirms it's airworthy — inspections current, no grounding squawk. If it weren't, the release would be *blocked*, right here, with the reason. That's not a reminder you can click past. The system won't dispatch a grounded airplane."

**Do, part 2 — Closeout:** Take a released flight and close it out. Enter **Hobbs in / Tach in**, landings, and — this is the moment — capture a squawk with a severity (say, MINOR) on the way.

**Say (slowly, this is the whole demo):**
> "Watch one button. When I close this out, in a *single transaction*: billable time is computed from the Hobbs delta; the aircraft meters roll forward — Hobbs, Tach, engine and prop time; the student's flight hours and solo time are logged; the invoice is generated with the wet rate and the instructor time as line items; the student's balance is decremented; and this squawk I just noted lands on the maintenance board. Either *all* of that happens, or *none* of it does. I never opened the billing screen."

**Wow beat:** Now navigate to `/billing` and show the invoice that just appeared — with the correct line items — and `/maintenance` to show the squawk waiting for the DOM. "Two screens I never typed into. That flight cannot fly and not get billed. Revenue leakage isn't discouraged here — it's structurally impossible."

**Objection pre-empt:** "And yes — every one of those steps just wrote an audit entry. We'll come back to that."

---

## 9:00–11:00 — Maintenance: airworthiness the system enforces

**Where:** `/maintenance`, then `/aircraft` (log in as `maintenance@aerops.demo` in a second tab if it lands better for a DOM in the room).

**Do:** Show the squawk that arrived from closeout moving through the work-order queue → return-to-service. Show fleet health with the *reasons* for each aircraft's status.

**Say:**
> "This is where that squawk landed. From here it's a work order, and when it's fixed, a signed return-to-service — the same signature you'd stand behind for the FAA. And notice the fleet health score explains itself: every deduction has a reason. You're never told an airplane is 'yellow' without being told *why*."

**Wow beat:** "The scheduler couldn't dispatch this airplane if I ground it — and I can see the blast radius of which bookings that would kill before I do it. The schedule and the maintenance status can never silently disagree, because they're the same system."

---

## 11:00–13:30 — Training: readiness with its reasons

**Where:** `/training`, `/students`.

**Do:** Open a student. Show hours logged (the ones that just came from closeout), stage progress, endorsements, checkride readiness.

**Say:**
> "For the chief instructor, the pipeline that used to live in your head and a spreadsheet lives here — who's stage-check ready and *why*, whose endorsement is missing before Friday's checkride, who's cleared to solo. The hours on this screen are the same hours the flight closeout logged twenty minutes ago. One number, one place."

**Wow beat:** "No student appears 'ready' without the factors behind it. When the FAA or your accreditor asks how you knew, the answer is on the screen, not in a memory."

---

## 13:30–16:30 — The role-based dashboard reveal (log in as a Student, then an Owner)

**Where:** two tabs — `student@aerops.demo` and back to `admin@aerops.demo`.

**Do:** This is the trust beat. Log in as **Taylor Nguyen, the student**. Show their world: *My upcoming lessons, my training progress, my own balance, weather, my notifications.* Then point out what is **not** there — no finance for the whole school, no fleet, no other students, no operations wall.

**Say:**
> "Same platform, completely different screen. Taylor sees her next lesson, her progress toward the checkride, and what *she* owes. She cannot see another student's record, the school's revenue, or the fleet. This isn't a setting someone remembered to switch on — the app authorizes on *permissions*, not on a job title, on every page and every route. There is no 'oops, the student could see the P&L.'"

**Do:** Flip back to the **owner** tab — the full 19-item sidebar, executive view, billing, settings. Same product, personalized by permission.

**Say:**
> "And the owner sees everything, because they hold the account and the liability. Between these two seats sit the dispatcher, the DOM, the finance manager, the CFI — each gets exactly their surface. You can even build custom roles — Assistant Chief Instructor, Front Office, a read-only Auditor for your board — without us shipping new code."

**Wow beat:** Two logins, side by side. "That's your insurer's question, your accreditor's question, and your board's question — answered by construction."

---

## 16:30–18:30 — Executive + audit trail: the numbers you can defend

**Where:** `/executive` (as owner), then `/mission-control` for the "wow," then reference the audit trail.

**Do:** Show the executive view — utilization, revenue, receivables. Then open `/mission-control` full-screen for the live operations wall (it holds a live connection — give it a second to load). Mention every mutation you did today is in the immutable audit trail.

**Say:**
> "For the owner, the board, the CFO: what did today make, what's overdue, is the fleet earning its keep. And underneath all of it is an audit trail that's never rewritten — every release, every closeout, every grounding, with who and when. When the FSDO, the insurer, or the accreditor asks, you start from records, not recollection. Mission Control here is the wall for the front desk or the ops room — live, and it makes a heck of a lobby screen."

**Wow beat:** The Mission Control wall on a big screen. Let it breathe for five seconds of silence.

---

## 18:30–20:00 — Close: "and you're not trapped by your current tool"

**Where:** `/import` (as owner).

**Do:** Land the switching-cost close. Show the Import Center — sources include Flight Circle, Flight Schedule Pro, FlightLogger. Emphasize: map → **test in a rolled-back transaction** → commit → **rollback manifest**.

**Say:**
> "The reason people stay on a tool they've outgrown is the fear of moving the data. So we built the answer in. Import Center reads exports from Flight Circle, Flight Schedule Pro, FlightLogger and more — you map the columns, you run a *test* import that uses the exact same code as the real one but rolls itself back, so the preview numbers are the truth. Then you commit. And if you don't like it, every record we created is tracked — you roll it back. You can try us with your real data and lose nothing."

**Say (the actual close):**
> "So here's what you saw: one flight that scheduled, dispatched, closed out, billed itself, logged the training, and flagged a squawk — in one motion, on one system, with an audit trail underneath and a different safe view for every seat. That's the difference between software that digitized your *forms* and a system that runs your *operation*. What would it take to run your next week of flying on this?"

**Honesty note if it comes up in the close:** card payments online, live METAR, and emailed invoices are on the roadmap; everything you saw today is live. Say it plainly — it's the reason they'll trust the rest.

---

## Sidebar: Answering objections live (3 fast rebuttals)

**"We already use [Flight Circle / FSP] and it's fine."**
> "Then you already have a scheduler — keep the muscle memory. What I'd ask you to price is the flight that flew and never got billed, and the morning you find out an inspection lapsed. Those come from data that lives in separate places. Show me your current tool binding the closeout to the invoice in one step — if it does, we're a UI upgrade. If it doesn't, that gap is money."

**"This looks like it costs more / is more than we need."**
> "The question isn't features, it's leakage. One un-billed dual flight a week is more than a seat costs, and our closeout makes that leak structurally impossible. And the simple case stays simple — a four-airplane school runs on the dashboard and the dispatch screen; the depth is there when you grow into it, not in your way on day one."

**"My instructors will never learn a new system."**
> "They'll learn one screen: dispatch. Release with a checklist, close out with the Hobbs — that's their whole day, and it's fewer taps than what they do now across three apps and a paper binder. And the student self-serves their own progress and schedule, so your CFIs field fewer 'when do I fly next' texts, not more."
