# AeroOps — Company Vision

The top of the governance stack, with [NORTH_STAR.md](./NORTH_STAR.md) and
[PRODUCT_PRINCIPLES.md](./PRODUCT_PRINCIPLES.md). Strategy documents change
rarely and deliberately; when this file and a roadmap item disagree, this
file wins until an explicit decision changes it.

## Why AeroOps exists

Small aviation operations run on whiteboards, paper dispatch binders,
spreadsheet stacks, and a patchwork of single-purpose tools that don't share
data. The flight school's schedule doesn't know the aircraft is grounded;
the invoice doesn't know the flight closed; the chief instructor
reconstructs checkride readiness from memory. The incumbents that computerized
this world a decade ago digitized the *forms*, not the *operation*.

AeroOps exists to give aviation operations what airlines have had for
decades — an operations system where scheduling, dispatch, maintenance,
training, and money are one continuous, auditable motion — at a price and
polish a 6-aircraft flight school can adopt in an afternoon.

## Mission

**Run the operation, not the paperwork.** Every flight-hour of
administrative work AeroOps eliminates is an hour the operation spends
flying, teaching, and maintaining aircraft.

## Vision

**The operating system for aviation** — the default system of record for
every small-to-mid aviation operation in North America, and eventually
anywhere piston engines turn: the place where an operation's aircraft,
people, schedule, money, and compliance live as one system that explains
itself.

## Long-term purpose

Aviation safety and aviation businesses both fail through the same crack:
information that existed but wasn't connected. The squawk that didn't reach
the scheduler. The overdue inspection nobody's spreadsheet flagged. The
student who soloed without the endorsement on file. AeroOps' purpose is to
make the connected version the *easy* version — so the safe, compliant,
profitable way to run an operation is also the path of least resistance.

## Core customer personas

| Persona | Operation | What they need from AeroOps |
|---|---|---|
| **The owner-operator** | 3–10 aircraft flight school or club | Everything in one place; billing that happens by itself; knowing tonight what today made |
| **The chief flight instructor** | Part 61/141 school | Training pipeline visibility: stage checks, endorsements, checkride readiness with reasons |
| **The dispatcher / front desk** | Any operation | The day's flights, releases, and returns without phone-tag; conflicts caught before they happen |
| **The director of maintenance** | School, rental, or shop | Squawks with airworthiness impact, inspection countdowns, signed return-to-service, parts traceability |
| **The club president / board** | Member-owned flying club | Member self-service, equity/dues billing, utilization numbers the board can trust |
| **The corporate flight-department manager** | 1–5 aircraft under a company | Trip legs, crew currency, executive reporting, defensible records |
| **The university program director** | Part 141 collegiate program | Cohort-scale training records, fleet utilization, accreditation-grade audit trails |

## Problems AeroOps solves

1. **Fragmentation** — schedule, dispatch, maintenance, training, billing,
   and CRM as one data model instead of five products and a spreadsheet.
2. **Silent revenue leaks** — flights that closed but never billed; the
   dispatch-closeout→invoice transaction makes leakage structurally
   impossible.
3. **Airworthiness by memory** — grounding, inspection countdowns, and
   release-blocking enforced by the system, not by whoever remembers.
4. **Training opacity** — readiness, stage progress, and endorsements as
   explained scores instead of tribal knowledge.
5. **Compliance anxiety** — an immutable audit trail underneath every
   mutation, so the FSDO/insurer/accreditor conversation starts from records,
   not recollection.
6. **Switching-cost paralysis** — the Import Center (map, test, commit,
   roll back) exists because the biggest competitor is the incumbent's
   data hostage situation.

## What success looks like

| Horizon | Success is |
|---|---|
| **1 year** | Controlled beta → paying customers: ~20 organizations live, one full training-cycle season completed on AeroOps, import-from-competitor proven in the field, churn ≈ 0 because onboarding was honest |
| **3 years** | ~300 organizations; AeroOps is a name flight-school owners recommend to each other; the platform runs multi-location operations; live METAR, payments, and mobile PWA are unremarkable table stakes; revenue supports a small full-time team |
| **5 years** | ~1,000+ organizations across all seven verticals; the API/webhook surface has an integration ecosystem (avionics data, LMS, accounting); AeroOps data informs operators' insurance and financing conversations; international (EASA-terminology) expansion underway |
| **10 years** | The default answer to "what do you run your operation on?" for GA operations — the system a new flight school signs up for the week it incorporates, and the operational data layer the next generation of aviation services builds against |

## Competitive differentiation

Against the incumbents (Flight Circle, Flight Schedule Pro, FlightLogger,
Aviatize, and spreadsheet inertia):

1. **An operating system, not a scheduler with add-ons** — one data model
   where dispatch closeout moves meters, ledgers, and invoices atomically.
2. **Explainable by construction** — every computed answer (conflict,
   readiness, health score, insight) carries its reasons. Trust is the
   product.
3. **Audit-first** — the immutable trail is a first-class surface (Mission
   Control's timeline), not a log file.
4. **Modern platform economics** — true multi-tenant SaaS with self-serve
   onboarding, transparent pricing, and an import path out of any
   competitor, including "roll it back if the test import scared you."
5. **Enterprise-calm design** — a system the front desk enjoys at 7 AM;
   professional, fast, dark-mode-native, printable.
6. **AI that advises and never acts** — insights with confidence and
   reasoning; mutations always require a permissioned human.

## Markets AeroOps will expand into (in order)

1. US Part 61/141 flight schools and flying clubs (beachhead — current).
2. Aircraft rental operators and FBO front desks (current modules).
3. Independent maintenance shops (squawk→work-order→RTS is already native).
4. Corporate flight departments and university programs (higher ACV,
   current modules with deeper reporting).
5. Charter (Part 135) operations — post-beta; adds duty-time and trip
   economics.
6. Canada, then EASA-land — terminology/regulatory adapters, same core.
7. Adjacent data services — insurance-grade operational reports, financing
   dossiers — only once the system-of-record position is earned.

## Intentionally outside scope

These are decisions, not omissions ([DECISIONS.md](../architecture/DECISIONS.md)):

- **Flight planning / EFB** — ForeFlight's territory; we integrate, we
  don't compete.
- **Airline / Part 121 operations** — different regulatory universe.
- **Avionics/telemetry hardware** — we consume data, we don't build boxes.
- **Accounting software** — we generate clean exports and (later) sync to
  QuickBooks; we will not re-implement a general ledger.
- **Marketplace/aggregator plays** (discovery-flight portals, instructor
  marketplaces) — we serve operators; we don't broker their customers.
- **Social features** — logbook-sharing networks etc.; operational value or
  it doesn't ship.

## Related documents

[NORTH_STAR.md](./NORTH_STAR.md) ·
[PRODUCT_PRINCIPLES.md](./PRODUCT_PRINCIPLES.md) ·
[CUSTOMER_ADVISORY_BOARD.md](./CUSTOMER_ADVISORY_BOARD.md) ·
[ROLES_AND_WORKSPACES.md](./ROLES_AND_WORKSPACES.md) ·
[../architecture/ARCHITECTURE.md](../architecture/ARCHITECTURE.md) ·
[../aviation/AVIATION_STANDARDS.md](../aviation/AVIATION_STANDARDS.md) ·
[../../ROADMAP.md](../../ROADMAP.md) · [../../PRODUCTION.md](../../PRODUCTION.md)
