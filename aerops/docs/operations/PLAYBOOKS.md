# AeroOps Operational Playbooks

The recommended way to run each common flight-school operation in AeroOps —
written for the people who actually do the job (owner, dispatcher, chief
instructor, instructor, maintenance, front desk), not for engineers. Each
playbook names the **trigger**, the **goal**, the **AeroOps workflow** (the
fewest steps that stay safe), the **automation opportunities** and **UX
improvements** we should build, and the **future AI assist** we could add.

Guiding rule (NORTH_STAR): the software should disappear behind the
operation. If a playbook needs more than a sentence of explanation, that's a
product problem, recorded as a UX improvement here and in
[PRODUCT_ROADMAP.md](../company/PRODUCT_ROADMAP.md).

Legend for maturity of each suggestion: **[now]** shipped · **[soon]**
small build · **[later]** roadmap. Statuses reflect the product as of
Phase 2.5.

---

## 1. Student onboarding

- **Trigger:** a prospective student decides to train, or a discovery-flight lead converts.
- **Goal:** a training-ready student record (contact, role, syllabus, first lesson) in minutes, with no double entry.
- **Workflow:** CRM → convert lead to student (one click issues an invite link) **[now]**, or Students → Add. Assign the Part 61/141 syllabus at creation. The student receives a self-serve invite link.
- **Automation:** on convert, pre-fill the student from the lead (name, email, phone, interest) — already carried; extend to auto-assign the org's default syllabus **[soon]**.
- **UX:** a single "New student" entry point should exist from both CRM and Students so the front desk never wonders which page to use **[soon]**.
- **Future AI:** suggest the likely syllabus and first-lesson type from the lead's stated goal ("PPL", "instrument") **[later]**.

## 2. First flight lesson

- **Trigger:** a new student is ready for lesson 1.
- **Goal:** the right aircraft + instructor + lesson type booked at a legal time, with the student informed.
- **Workflow:** Schedule → drag-to-book on the aircraft timeline; conflict detection blocks double-books, maintenance overlaps, and grounded aircraft, and suggests the nearest open slot **[now]**.
- **Automation:** default the lesson type and duration from the syllabus stage the student is on **[soon]**.
- **UX:** from the student's page, a "Book next lesson" button that opens the schedule pre-filtered to that student + their instructor **[soon]**.
- **Future AI:** propose the best slot from instructor load, aircraft availability, and weather trend **[later]**.

## 3. Daily dispatch

- **Trigger:** start of the operating day; flights are scheduled.
- **Goal:** every flight released against a current airworthiness check and closed out with meters + billing in one motion.
- **Workflow:** Dispatch → Awaiting Release column → run the pre-flight release checklist (a grounded/non-airworthy aircraft is blocked) → after landing, Post-flight closeout captures Hobbs/Tach and, in one transaction, updates meters, the student ledger, and the invoice **[now]**.
- **Automation:** default closeout Hobbs from the aircraft's current meter so the dispatcher types only the ending value **[soon]**.
- **UX:** the Dispatch board is the front desk's home screen — it should be the default landing page for the dispatcher role **[soon]**.
- **Future AI:** flag a closeout whose Hobbs delta is implausible vs. scheduled duration before it bills **[later]**.

## 4. Aircraft unavailable (non-maintenance)

- **Trigger:** an aircraft is temporarily out (owner use, relocation, soft field).
- **Goal:** stop new bookings without losing the aircraft's history; move affected flights.
- **Workflow:** Aircraft → set status; the schedule and dispatch respect it immediately. Conflict detection then offers alternative aircraft for affected bookings **[now]**.
- **Automation:** on marking unavailable with existing bookings, prompt "reassign N affected flights?" and suggest swaps **[soon]**.
- **UX:** a status change should surface the count of impacted bookings inline, not silently **[soon]**.

## 5. Maintenance grounding

- **Trigger:** a squawk with airworthiness impact, or a due inspection.
- **Goal:** the aircraft cannot be dispatched until returned to service; the schedule reflects it.
- **Workflow:** Maintenance → raise squawk with airworthiness impact → aircraft grounds; dispatch release is blocked automatically. Open a work order **[now]**.
- **Automation:** when grounding, auto-notify instructors/students with flights on that tail today **[soon]**.
- **UX:** grounding reason should show on the schedule tooltip for that aircraft **[soon]**.
- **Future AI:** predict grounding risk from inspection countdowns and repeat squawks **[later]**.

## 6. Weather cancellation

- **Trigger:** conditions below minimums for scheduled flights.
- **Goal:** cancel affected flights, notify, and free the aircraft/instructor, with a clear reason.
- **Workflow:** Schedule → cancel with reason "weather"; the slot frees and the waitlist can fill it **[now]**. Mission Control shows the weather category per location **[now]**.
- **Automation:** a "cancel weather day" bulk action from Mission Control for a location + time window **[later]**.
- **UX:** surface the active-location flight category (VFR/MVFR/IFR/LIFR) next to each scheduled flight so the dispatcher sees risk at a glance **[soon]**.
- **Future AI:** proactive "3 lessons at KPAO are IFR-risk at 14:00" alert from the TAF (needs the live weather adapter) **[later]**.

## 7. Instructor absence

- **Trigger:** an instructor calls in sick or is unavailable.
- **Goal:** reassign or reschedule their flights with minimal student disruption.
- **Workflow:** Schedule filtered by instructor → reassign each flight to an available, appropriately-rated CFI (conflict detection guards) or cancel with reason **[now]**.
- **Automation:** "reassign all of CFI X today" with suggested substitutes ranked by load and rating **[later]**.
- **UX:** an instructor-day view that lists their flights with one-tap reassign **[soon]**.

## 8. Student cancellation

- **Trigger:** a student cancels a lesson.
- **Goal:** free the slot, offer it to the waitlist, keep the record.
- **Workflow:** Schedule → cancel with reason; waitlist entries for that window are surfaced **[now]**.
- **Automation:** auto-offer the freed slot to the first eligible waitlisted student **[later]**.
- **UX:** show cancellation-rate on the student record so instructors spot a pattern **[later]**.

## 9. Aircraft swap

- **Trigger:** the booked aircraft becomes unavailable close to a flight.
- **Goal:** move the flight to an equivalent aircraft without re-entering everything.
- **Workflow:** Schedule → edit booking → pick an alternative aircraft; conflict detection validates the new tail **[now]**.
- **Automation:** one-click "swap to nearest equivalent" that filters by aircraft type/rating **[soon]**.

## 10. Fuel issue

- **Trigger:** an aircraft returns low/mis-fueled, or a fuel discrepancy is noted.
- **Goal:** record it against the aircraft and, if airworthiness-relevant, raise a squawk.
- **Workflow:** Maintenance → squawk (minor) on the aircraft; note in the flight closeout **[now]**.
- **UX:** a quick "note on aircraft" affordance from the dispatch closeout so the dispatcher needn't leave the flow **[soon]**.

## 11. Checkride preparation

- **Trigger:** a student nears the end of a syllabus stage.
- **Goal:** confirm readiness (endorsements, stage checks, experience) before scheduling a DPE.
- **Workflow:** Training → student readiness score, factor by factor (what's complete, what's missing) **[now]**.
- **Automation:** a "checkride readiness" checklist that blocks scheduling a checkride until required endorsements exist **[soon]**.
- **Future AI:** "Aisha is 2 night-landings and 1 endorsement from checkride-ready" surfaced proactively **[later]**.

## 12. Checkride completion

- **Trigger:** a checkride is passed (or failed/discontinued).
- **Goal:** record the outcome, advance the student, capture the DPE and certificate.
- **Workflow:** Training → checkride record with status and examiner **[now]**.
- **Automation:** on pass, auto-advance the student's rating and prompt the next syllabus **[later]**.
- **UX:** a celebratory but professional confirmation ("PPL earned — logged and on the record") **[soon]** (delight, not gimmick).

## 13. Solo endorsement

- **Trigger:** an instructor judges a student ready to solo.
- **Goal:** a dated, signed endorsement on the record that the dispatch/solo flow can check.
- **Workflow:** Training → add endorsement (instructor-linked; the record is RESTRICT-protected so it can't be silently deleted) **[now]**.
- **UX:** from the student page, "Add endorsement" pre-filled with the standard 90-day solo language **[soon]**.
- **Future AI:** warn when a solo is booked but the required endorsement is missing or expired **[later]**.

## 14. Stage check

- **Trigger:** a student completes a syllabus stage.
- **Goal:** an assessed stage check by a different instructor, recorded, gating stage advance.
- **Workflow:** Training → stage check with grade; advances the enrollment **[now]**.
- **UX:** a chief-instructor "stage-check queue" so pending checks are one list, not a hunt **[soon]**.

## 15. Certificate / rating expiration

- **Trigger:** a student or CFI certificate/rating approaches expiry.
- **Goal:** no one operates on a lapsed certificate; renewals happen ahead of time.
- **Workflow:** Training shows CFI renewal + medical dates with day-countdowns and a currency alert under 60 days **[now]**.
- **Automation:** notification at 60/30/7 days; block dispatch of an instructor whose required currency has lapsed **[soon]**.

## 16. Medical expiration

- **Trigger:** a pilot's medical nears expiry.
- **Goal:** the pilot doesn't fly PIC on a lapsed medical.
- **Workflow:** the medical date and countdown show on the training/instructor view **[now]**.
- **Automation:** proactive reminder + a dispatch-time guard for solo/PIC flights **[soon]**.

## 17. Insurance expiration

- **Trigger:** the operation's or an aircraft's insurance nears renewal.
- **Goal:** never operate uninsured; renewal is prompted early.
- **Workflow:** store the policy in Documents with an expiry **[now]**.
- **Automation:** surface document expiries on the dashboard "needs attention" and notify at 30 days **[soon]** — the Documents module is metadata today; real uploads (R2) are a launch item.

## 18. Fleet maintenance (scheduled)

- **Trigger:** a 100-hour, annual, ELT, or pitot-static inspection comes due.
- **Goal:** the inspection is planned before it grounds an aircraft mid-schedule.
- **Workflow:** Maintenance → inspection countdowns (hours and days) per aircraft; open a work order ahead of due **[now]**.
- **Automation:** propose a maintenance window that least disrupts the schedule **[later]**.
- **Future AI:** forecast the due date from utilization trend, not just current hours **[later]**.

## 19. Aircraft returned to service

- **Trigger:** maintenance completes and the aircraft is airworthy again.
- **Goal:** a signed return-to-service, the aircraft available, the schedule reopened.
- **Workflow:** Maintenance → close the work order with a signed return-to-service; the aircraft's status clears and dispatch release unblocks **[now]**.
- **UX:** on RTS, offer to restore the bookings that were displaced by the grounding **[later]**.

## 20. Emergency grounding

- **Trigger:** an urgent airworthiness concern (bird strike, hard landing, AD).
- **Goal:** stop all flights on that tail immediately, notify, document.
- **Workflow:** Maintenance → ground with a critical squawk; dispatch release is blocked at once **[now]**.
- **Automation:** one action that grounds + cancels today's flights on the tail + notifies affected people **[soon]**.
- **UX:** a prominent, unambiguous "Ground aircraft" action that's confirm-guarded but fast **[soon]**.

## 21. Organization onboarding

- **Trigger:** a new flight school signs up (self-serve or platform-created).
- **Goal:** a usable operation — aircraft, people, first booking — with the least setup.
- **Workflow:** create-company wizard picks business activities (which light up modules), sets the primary location, and hands out team invite links at the end **[now]**; or migrate existing data through the Import Center **[now]**.
- **Automation:** a guided setup checklist ("add aircraft → invite team → first booking") on the new-org dashboard **[soon]**.
- **Future AI:** infer sensible defaults (lesson types, syllabus) from the chosen activities **[later]**.

## 22. Semester startup (university / large cohort)

- **Trigger:** a cohort of students begins together.
- **Goal:** bulk-create students, assign syllabi and instructors, without per-student clicks.
- **Workflow:** Import Center → students CSV with syllabus + instructor columns; test import, commit, roll back if needed **[now]**.
- **UX:** a cohort view that groups students by start term and instructor **[later]**.

## 23. Large import

- **Trigger:** migrating from Flight Circle / FSP / QuickBooks, or a big spreadsheet.
- **Goal:** clean data in, nothing silently dropped, reversible.
- **Workflow:** Import Center → source → map columns (remembered per source) → **test import** (real code path, rolled back) → commit → per-row errors downloadable → roll back if wrong **[now]**.
- **Automation:** background processing + progress for files over the 5k-row cap **[later]**.
- **UX:** the test step's created/updated/skipped/failed counts are the confidence moment — keep them prominent **[now]**.

## 24. Data recovery / backup verification

- **Trigger:** an accidental bulk change, or a routine backup-integrity check.
- **Goal:** restore a known-good state; prove backups actually restore.
- **Workflow (platform):** Org Snapshots → capture before risky changes; restore rewinds the tenant's data (audit rows preserved) **[now]**. Import rollback undoes a specific import via its created-records manifest **[now]**.
- **Automation:** scheduled snapshots before imports/simulations; a periodic restore-verify job **[later]** (PRODUCTION.md §11).
- **UX:** restore should show a diff summary ("this will remove N aircraft added since the snapshot") before confirming **[soon]**.

---

## Cross-cutting patterns these playbooks reveal

1. **"Do it from where I am."** Repeatedly the fastest path is an action on the record you're already looking at (book from the student page, note from the closeout, endorse from the student page). Contextual actions beat navigating to a module. → roadmap theme.
2. **"Tell me the blast radius before I commit."** Grounding, cancelling, restoring — each should show how many flights/people it affects. → roadmap theme.
3. **"Warn me before the unsafe thing, don't just record after."** Expired endorsement/medical/currency at dispatch time; implausible Hobbs before billing. → the Product Intelligence roadmap.

## Related documents

[../company/VISION.md](../company/VISION.md) ·
[../company/NORTH_STAR.md](../company/NORTH_STAR.md) ·
[../company/PRODUCT_PRINCIPLES.md](../company/PRODUCT_PRINCIPLES.md) ·
[../company/PRODUCT_ROADMAP.md](../company/PRODUCT_ROADMAP.md) ·
[../aviation/AVIATION_STANDARDS.md](../aviation/AVIATION_STANDARDS.md)
