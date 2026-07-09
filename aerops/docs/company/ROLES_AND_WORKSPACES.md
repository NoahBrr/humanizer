# AeroOps — Roles & Workspaces

How AeroOps models *who does what*. This is the governance companion to the
code: the `Role` enum and permission bundles in
[`src/lib/permissions.ts`](../../src/lib/permissions.ts), the section gating in
[`src/lib/rbac.ts`](../../src/lib/rbac.ts), and the seed catalog of long-tail
roles in [`src/lib/role-templates.ts`](../../src/lib/role-templates.ts).

**The load-bearing rule** (CLAUDE.md §3, constitution-tested): *routes and pages
authorize on permission keys, never on role names.* A role — built-in or custom
— is just a bundle of permissions. That is what lets AeroOps serve dozens of
real job titles without a single new enum value or auth change.

Three layers, in order of how the system resolves access:

1. **Permission primitives** — the 25 keys in `PERMISSIONS`. The only thing any
   gate checks.
2. **Base roles** — the 7-value `Role` enum, each a default permission bundle
   (`DEFAULT_ROLE_PERMISSIONS`), shown to users under aviation-native labels
   (`ROLE_LABELS`). These are the RBAC contract; renaming a label changes no
   permission.
3. **Custom-role templates** — data rows in the `OrgRole` table (permission
   arrays), seeded from `ROLE_TEMPLATES`. The long tail of aviation job titles
   lives here, *on top of* the primitives — **not** as enum expansion.

Platform staff are a separate identity table (`PlatformUser`) with their own
`PlatformRole` enum and `PLATFORM_ROLE_LABELS`; they never hold org roles and
reach tenant data only through audited, customer-notified impersonation.

---

## Role Matrix

Every role AeroOps recognizes: whether it reflects a real aviation seat, its
display name, how it is implemented, and whether it needs its own
dashboard/nav shape beyond permission-gating.

| Role | Real aviation seat? | Display name | How it maps | Own dashboard/nav? |
|---|---|---|---|---|
| SUPER_ADMIN | Yes — owner/operator | Account Owner | Base enum (all permissions) | No — sees everything |
| SCHOOL_ADMIN | Yes — ops director / chief instructor / program director | Operations Director | Base enum (all permissions) | No — sees everything |
| DISPATCHER | Yes — dispatcher / front desk | Flight Dispatcher | Base enum | No — permission-gated |
| INSTRUCTOR | Yes — CFI | Flight Instructor | Base enum | No — permission-gated |
| STUDENT | Yes — learner (a *consumer*, not an operator) | Student Pilot | Base enum | **Yes** — dedicated student workspace (see Dashboard Matrix) |
| MAINTENANCE | Yes — DOM / maintenance manager | Maintenance Manager | Base enum | No — permission-gated |
| ACCOUNTANT | Yes — finance/billing admin | Finance Manager | Base enum | No — permission-gated |
| Founder | Platform (AeroOps staff) | Founder | `PlatformRole.FOUNDER` | Platform portal (`/platform`) |
| Software Engineer | Platform | Software Engineer | `PlatformRole.SOFTWARE_ENGINEER` | Platform portal |
| Platform Administrator | Platform | Platform Administrator | `PlatformRole.PLATFORM_ADMIN` | Platform portal |
| Customer Success | Platform | Customer Success | `PlatformRole.CUSTOMER_SUCCESS` | Platform portal |
| Support Engineer | Platform | Support Engineer | `PlatformRole.SUPPORT_ENGINEER` | Platform portal |
| Billing Administrator | Platform | Billing Administrator | `PlatformRole.BILLING_ADMIN` | Platform portal |
| Read-Only Auditor (platform) | Platform | Read-Only Auditor | `PlatformRole.AUDITOR` | Platform portal |
| Assistant Chief Instructor | Yes | Assistant Chief Instructor | Custom template → `OrgRole` (basedOn INSTRUCTOR) | No — permission-gated |
| Independent Instructor | Yes | Independent Instructor | Custom template (basedOn INSTRUCTOR) | No |
| Operations Coordinator | Yes | Operations Coordinator | Custom template (basedOn DISPATCHER) | No |
| Maintenance Technician | Yes | Maintenance Technician | Custom template (basedOn MAINTENANCE) | No |
| Registrar | Yes | Registrar | Custom template (basedOn SCHOOL_ADMIN) | No |
| Admissions | Yes | Admissions | Custom template (basedOn SCHOOL_ADMIN) | No |
| Front Office | Yes | Front Office | Custom template (basedOn DISPATCHER) | No |
| Teaching Assistant | Yes | Teaching Assistant | Custom template (basedOn INSTRUCTOR) | No |
| Safety Officer | Yes | Safety Officer | Custom template (basedOn SCHOOL_ADMIN) | No |
| Marketing | Yes | Marketing | Custom template (basedOn SCHOOL_ADMIN) | No |
| Read-Only Auditor (org) | Yes | Read-Only Auditor | Custom template (basedOn SCHOOL_ADMIN) | No |

Only the **Student Pilot** needs a structurally different workspace — every
other role is served by the same shells with permission-gated sections. That is
the design intent: one product, personalized by permission, not a fork per role.

---

## Permission Matrix

Base roles × permission groups, derived directly from
`DEFAULT_ROLE_PERMISSIONS`. ✓ = the role holds at least one permission in the
group; footnotes flag partial/asymmetric coverage that matters.

| Group | Account Owner | Operations Director | Flight Dispatcher | Flight Instructor | Student Pilot | Maintenance Manager | Finance Manager |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| schedule | ✓ | ✓ | ✓ | ✓ ¹ | ✓ ² | ✗ | ✗ |
| dispatch | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| aircraft | ✓ | ✓ | ✓ ³ | ✓ ² | ✗ | ✓ ³ | ✗ |
| maintenance | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ |
| students | ✓ | ✓ | ✓ ² | ✓ | ✗ | ✗ | ✗ |
| instructors | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| billing | ✓ | ✓ | ✓ ⁴ | ✗ | ✗ | ✗ | ✓ |
| reports | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ |
| documents | ✓ | ✓ | ✓ ² | ✓ ² | ✓ ² | ✓ ² | ✓ ² |
| notifications | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| users | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| settings | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| import | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |

¹ Instructor has `schedule.view/create/edit` — **not** `delete` or
`override_conflicts`.
² View-only within the group (no manage/mutate).
³ `aircraft.view` + `aircraft.ground`, **not** `aircraft.manage`.
⁴ Dispatcher has `billing.record_payments` but **not** `billing.view` — it can
record a payment but the Billing section is hidden (see gaps).

---

## Sidebar Matrix

Base roles × nav destinations. Each nav href is gated by one key in
`SECTION_PERMISSIONS`; a role sees the item only if its bundle holds that key
(and, for `/training`, the org runs a training business profile). ✓ = visible.
Feature-module gating (plan/overrides) is orthogonal and assumed on here.

| Nav (gate) | Account Owner | Operations Director | Flight Dispatcher | Flight Instructor | Student Pilot | Maintenance Manager | Finance Manager |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Dashboard (`notifications.view`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Mission Control (`notifications.view`) | ✓ | ✓ | ✓ | ✓ | ✓ ⚠ | ✓ | ✓ |
| Intelligence (`students.view`) | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Schedule (`schedule.view`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Dispatch (`dispatch.release`) | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Operations (`dispatch.release`) | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Aircraft (`aircraft.view`) | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ |
| Maintenance (`maintenance.view`) | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ |
| Students (`students.view`) | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Instructors (`instructors.view`) | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Training (`students.manage`) | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| Billing (`billing.view`) | ✓ | ✓ | ✗ ⚠ | ✗ | ✗ | ✗ | ✓ |
| Reports (`reports.view`) | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ |
| Growth (`students.manage`) | ✓ | ✓ | ✗ | ✓ ⚠ | ✗ | ✗ | ✗ |
| Executive (`reports.view`) | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ |
| Notifications (`notifications.view`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Documents (`documents.view`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Import Data (`data.import`) | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Settings (`settings.manage`) | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |

⚠ flags where the derived result is arguably wrong for the persona — carried
into "Base-role permission gaps" below.

**What each role actually sees (nav):**
- **Account Owner / Operations Director** — the full 19-item sidebar.
- **Flight Dispatcher** — Dashboard, Mission Control, Intelligence, Schedule,
  Dispatch, Operations, Aircraft, Maintenance, Students, Instructors, Reports,
  Executive, Notifications, Documents. *No* Billing, Training, Growth, Import,
  Settings.
- **Flight Instructor** — Dashboard, Mission Control, Intelligence, Schedule,
  Dispatch, Operations, Aircraft, Students, Instructors, Training, Growth,
  Notifications, Documents. *No* Maintenance, Billing, Reports, Executive.
- **Student Pilot** — Dashboard, Mission Control, Schedule, Notifications,
  Documents. (Mission Control is the odd one — see gaps.)
- **Maintenance Manager** — Dashboard, Mission Control, Aircraft, Maintenance,
  Notifications, Documents.
- **Finance Manager** — Dashboard, Mission Control, Billing, Reports, Executive,
  Notifications, Documents.

---

## Dashboard Matrix

Base roles × dashboard sections, per the section-gating rules being implemented
in parallel. A section renders only if the viewer's permissions allow it.

| Section (gate) | Account Owner | Operations Director | Flight Dispatcher | Flight Instructor | Student Pilot | Maintenance Manager | Finance Manager |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Today's Flights (`schedule.view`, non-student) | ✓ | ✓ | ✓ | ✓ | — ᵈ | ✗ | ✗ |
| Needs Attention · Squawks (`maintenance.view`) | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ |
| Needs Attention · Maintenance (`maintenance.view`) | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ |
| Needs Attention · Checkrides (`students.view` OR `students.manage`) | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Needs Attention · Activity (always) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Weather (always) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Finance Snapshot (`billing.view`) | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Fleet Status (`aircraft.view`) | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ |

ᵈ **Student Pilot gets a dedicated workspace**, not the operator dashboard: My
Upcoming Lessons, My Training (hours logged + next checkride), Weather, and
Recent Activity — and never finance, fleet, or org-wide operational sections.

---

## Customer Advisory Board Review

Each of the twelve personas in
[CUSTOMER_ADVISORY_BOARD.md](./CUSTOMER_ADVISORY_BOARD.md), mapped to the role
they would actually hold, judged against the matrices above.

| # | Persona | Likely role | Dashboard helps? | Nav makes sense? | Sees finance? | Sees ops? | Confusion → simplification |
|---|---|---|---|---|:--:|:--:|---|
| 1 | Small & Growing Part 61 Owner | Account Owner | Yes — Needs-Attention triage is their morning | Yes (all) | Yes | Yes | Sees everything; that's what a one-person shop wants. None. |
| 2 | Part 141 Chief Flight Instructor | Operations Director, or Assistant Chief Instructor template | Yes — checkrides + Today's Flights | Yes | Depends on role | Yes | If run as base INSTRUCTOR they'd lose Reports/Executive for pipeline metrics → use the **Assistant Chief Instructor** template (adds `reports.view`) or Operations Director. |
| 3 | University Program Director | Operations Director | Yes | Yes | Yes | Yes | Role fits; the real gap is cohort/term reporting depth (roadmap), not roles. |
| 4 | Dispatcher / Front Desk | Flight Dispatcher | Yes — Today's Flights, Squawks, Fleet | Mostly | **No ⚠** | Yes | Can record a payment (`billing.record_payments`) but Billing is hidden (`billing.view` absent). → grant `billing.view` or seat them as **Front Office**. |
| 5 | Maintenance Manager / DOM | Maintenance Manager | Yes — Squawks/Maintenance/Fleet | Yes | No (correct) | Partial | Can ground an aircraft but the Schedule section is hidden, so the blast-radius picture isn't in nav. → consider `schedule.view` on the bundle. |
| 6 | Front Office Administrator | **Front Office** template | Yes | Yes (Schedule/Students/Billing/Documents) | Yes | Schedule | Base DISPATCHER would hide Billing; the Front Office template exists precisely to fix that. |
| 7 | Independent Flight Instructor | Individual account (`/welcome`), or **Independent Instructor** template in an org | Yes (instructor view) | Yes | No | Schedule/Dispatch | As an individual they live on `/welcome`, not the app sidebar — no confusion. Inside an org, the template matches a CFI. |
| 8 | Student Pilot | Student Pilot | Yes — dedicated student workspace | Mostly | No | No (correct) | **Mission Control appears in their sidebar** (gated only on `notifications.view`) and Billing does not, so "do I owe?" has no nav home. → hide Mission Control from students; add a student billing/balance view (roadmap). |
| 9 | Finance / Billing Administrator | Finance Manager | Yes — Finance Snapshot | Yes (Billing/Reports/Executive) | Yes | No (correct) | Can't open Schedule to tie a flight to an invoice — minor; drill-through lives in Billing. |
| 10 | Multi-location / Growing Operator | Operations Director | Yes | Yes | Yes | Yes | Role model fine; the ask is cross-location roll-up (roadmap 1.5), not roles. |
| 11 | Flying Club President / Board | Operations Director; board members → **Read-Only Auditor** template | Yes | Yes | Yes | Yes | Volunteer board members shouldn't mutate the operation → seat them with the org **Read-Only Auditor** template. |
| 12 | Corporate Flight-Dept Manager | Operations Director (training profile off) | Yes | Yes | Yes | Yes | Training-centric labels (Students/Training) are noise for trip ops; disabling the training profile hides Training. Vertical relabeling is a later-market concern, not a role change. |

---

## Role-Renaming Summary

Old generic labels → aviation-native labels, already applied in
`ROLE_LABELS` (`src/lib/rbac.ts`). **Display language only** — the `Role` enum
values and every permission bundle are untouched, so no gate, route, or
migration moved.

| Enum value | Old generic label | New aviation-native label | Rationale |
|---|---|---|---|
| SUPER_ADMIN | Super Admin | **Account Owner** | "Super admin" is IT jargon; the person is the owner who holds the account and the liability. |
| SCHOOL_ADMIN | School Admin | **Operations Director** | Names the operational seat (and reads correctly for clubs, FBOs, corporate depts, universities — not only "schools"). |
| DISPATCHER | Dispatcher | **Flight Dispatcher** | Aligns with the FAA-recognized function; distinguishes flight dispatch from generic scheduling. |
| INSTRUCTOR | Instructor | **Flight Instructor** | Matches the CFI's actual title; "instructor" alone is ambiguous in a school. |
| STUDENT | Student | **Student Pilot** | The airman certificate term; signals a learner-consumer, not an operator seat. |
| MAINTENANCE | Maintenance | **Maintenance Manager** | A person, not a department; conveys the airworthiness authority the bundle carries. |
| ACCOUNTANT | Accountant | **Finance Manager** | Broader than bookkeeping (receivables, closeout review, reporting) and reads as an operational peer. |

---

## Role audit

For each candidate role raised in the phase brief and the broader long-tail:
**keep** (base enum), **add-as-template** (`OrgRole` seed), **merge** (an
existing role already covers it), or **unnecessary**.

| Candidate | Verdict | Reasoning |
|---|---|---|
| Account Owner (SUPER_ADMIN) | Keep | Base primitive: the all-permissions owner. |
| Operations Director (SCHOOL_ADMIN) | Keep | Base primitive: all-permissions operational admin. |
| Flight Dispatcher (DISPATCHER) | Keep | Base primitive. |
| Flight Instructor (INSTRUCTOR) | Keep | Base primitive. |
| Student Pilot (STUDENT) | Keep | Base primitive + the one role with a bespoke workspace. |
| Maintenance Manager (MAINTENANCE) | Keep | Base primitive. |
| Finance Manager (ACCOUNTANT) | Keep | Base primitive. |
| Assistant Chief Instructor | Add-as-template (basedOn INSTRUCTOR) | Real deputy seat; instructor + pipeline reporting. No enum needed. |
| Independent Instructor | Add-as-template (basedOn INSTRUCTOR) | Org-member form of the individual-CFI persona; equals the instructor bundle. |
| Operations Coordinator | Add-as-template (basedOn DISPATCHER) | Dispatcher minus payment handling — a common assistant seat. |
| Maintenance Technician | Add-as-template (basedOn MAINTENANCE) | Works squawks without grounding/RTS authority (reserved to the DOM). |
| Registrar | Add-as-template (basedOn SCHOOL_ADMIN) | Records/enrollment admin; no flying or money. |
| Admissions | Add-as-template (basedOn SCHOOL_ADMIN) | Prospect-to-enrollment funnel + first-lesson scheduling. |
| Front Office | Add-as-template (basedOn DISPATCHER) | Desk role needing scheduling + first-line billing that base DISPATCHER can't see. |
| Teaching Assistant | Add-as-template (basedOn INSTRUCTOR) | Read-mostly instruction support; can't sign records. |
| Safety Officer | Add-as-template (basedOn SCHOOL_ADMIN) | Cross-operation read-only oversight. |
| Marketing | Add-as-template (basedOn SCHOOL_ADMIN) | Growth/CRM funnel + reporting. |
| Read-Only Auditor (org) | Add-as-template (basedOn SCHOOL_ADMIN) | Board/insurer/accreditor read-only observer. |
| Campus Administrator | Merge → Operations Director (SCHOOL_ADMIN) | A campus admin is an Operations Director scoped by location; location scoping is a data concern, not a new role. |
| Organization Administrator | Merge → Operations Director (SCHOOL_ADMIN) | Same all-permissions admin under a different name. |
| University Program Director | Merge → Operations Director, or Add-as-template if reporting-only | If they run the program → Operations Director. If they only consume reports → a read/report template (≈ Safety Officer/Auditor shape). Not a new enum. |
| Chief Instructor | Merge → Operations Director, or Assistant Chief Instructor template | Full authority → Operations Director; deputy authority → the Assistant Chief Instructor template. |
| Line / Staff Instructor | Merge → Flight Instructor (INSTRUCTOR) | Exactly the base instructor bundle. |
| Renter / Club Member | Unnecessary now | A billing/scheduling consumer; closest today is Student Pilot. A first-class "member" surface is a roadmap item, not a role to invent here. |
| Platform Super Admin | Unnecessary as an org role = Founder | Platform authority lives in `PlatformRole.FOUNDER` on the separate `PlatformUser` table, reached via impersonation — never an org role. |
| Owner | Merge → Account Owner (SUPER_ADMIN) | Same seat, canonical label already applied. |

---

## Base-role permission gaps (observations — not changed here)

Reported from the matrices above. These are permission-bundle / section-gate
observations for a future, separately-reviewed slice; **this deliverable changes
no bundle, gate, or route.**

1. **Student Pilot sees Mission Control.** `/mission-control` is gated only on
   `notifications.view` (everyone), so the full-screen operations wall appears
   in a learner's sidebar. Also affects Maintenance Manager and Finance Manager,
   but it is most incongruous for a student. Consider a dedicated gate or an
   explicit non-student exclusion.
2. **Dispatcher can record payments but can't see Billing.** DISPATCHER holds
   `billing.record_payments` but not `billing.view`; the Billing section
   (gated on `billing.view`) is hidden, so they record payments they can't then
   review. Asymmetric — grant `billing.view` or split the payment surface.
3. **Growth/CRM is coupled to `students.manage`.** `/crm` (Growth) *and*
   `/training` both gate on `students.manage`. Consequences: (a) line Flight
   Instructors get the Growth/marketing board they don't need; (b) a pure
   Marketing role can't reach Growth without also being granted student-record
   management (why the Marketing template carries `students.manage`). A dedicated
   `crm.*` or `marketing.*` permission would decouple these.
4. **Maintenance Manager can ground without schedule visibility.** MAINTENANCE
   has `aircraft.ground` but not `schedule.view`, so grounding's blast radius
   (which bookings it kills) isn't reachable from their nav.
5. **Intelligence is students-only.** `/intelligence` gates on `students.view`,
   so Maintenance and Finance roles never see the insight surface even though the
   engine produces maintenance- and finance-flavored insights.
6. **Student Pilot has no billing/balance nav home.** With `billing.view`
   absent and no student-scoped billing surface, the persona's core question
   ("do I owe anything?") has nowhere to land in navigation.

---

## Related documents

[VISION.md](./VISION.md) · [CUSTOMER_ADVISORY_BOARD.md](./CUSTOMER_ADVISORY_BOARD.md) ·
[NORTH_STAR.md](./NORTH_STAR.md) ·
[PRODUCT_PRINCIPLES.md](./PRODUCT_PRINCIPLES.md) ·
[../architecture/SECURITY_STANDARDS.md](../architecture/SECURITY_STANDARDS.md) ·
`src/lib/permissions.ts` · `src/lib/rbac.ts` · `src/lib/role-templates.ts`
