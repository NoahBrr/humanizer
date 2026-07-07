# AeroOps Aviation Standards

What keeps AeroOps an aviation operations platform instead of generic
scheduling software. Every section states the standard, then grounds it in
the code that implements it. Where the codebase falls short of best
practice, the shortfall is listed honestly in **Gaps to close** at the end —
never papered over. Companions: [CONSTITUTION.md](../../CONSTITUTION.md),
[ARCHITECTURE.md](../../ARCHITECTURE.md),
[AI_REVIEW_BOARD.md](../engineering/AI_REVIEW_BOARD.md) (the UX and QA gates
enforce this document).

## FAA terminology

Use the regulator's vocabulary, spelled the way pilots read it. As
implemented:

| Term | Meaning | Where in AeroOps |
|---|---|---|
| Tail number (N-number) | Aircraft registration — the aircraft's identity | `Aircraft.tailNumber @unique` (globally unique by design, like the registry) |
| Part 61 / Part 141 | FAA training frameworks (flexible vs approved-syllabus) | `TrainingPart` enum on `Student` and `Syllabus` |
| FAR reference | Regulation cite, e.g. `61.87(b)` | `Endorsement.farReference` |
| DPE | Designated Pilot Examiner — administers checkrides | `Checkride.examinerName` |
| Stage check | Progress gate inside a syllabus | `SyllabusStage.isStageCheck` |
| Squawk | Reported aircraft discrepancy | `Squawk` model, severity `GROUNDING/MAJOR/MINOR` |
| AOG | Aircraft On Ground — highest maintenance urgency | `WorkOrderPriority.AOG` |
| Return to service | Signed maintenance approval to fly again | `MaintenanceOrder.approvedBy/approvedAt`, status `RETURN_TO_SERVICE` |
| Hobbs / Tach | The two aircraft time meters (see §Hobbs/Tach) | `Aircraft.currentHobbs/currentTach`, `Dispatch.hobbsOut/In, tachOut/In` |
| METAR | Coded surface weather observation | `lib/weather.ts` (simulated, METAR-shaped) |
| ICAO identifier | 4-letter airport code, K-prefix in CONUS | `Location.icao` |
| FTN | FAA Tracking Number (IACRA) | `Student.ftnNumber` |
| Certificate types | Student → ATP ladder incl. CFI/CFII/MEI | `CertificateType` enum |

Never "check-in", "ticket", "vehicle", or "technician sign-off" — see
§Aviation-specific UX.

## Aircraft scheduling

Standard: a booking is a claim on three scarce, safety-regulated resources —
aircraft, instructor, student — and every conflict must be explained, not
just refused.

As implemented (`src/lib/scheduling.ts`):

- `detectConflicts()` returns typed reasons: aircraft/instructor/student
  double-booking, maintenance-window overlap, `AIRCRAFT_GROUNDED`,
  `MEDICAL_EXPIRED`, `INSTRUCTOR_CREDENTIALS_EXPIRED` (CFI cert or medical
  lapsed *at flight time*, not at booking time), instructor availability
  windows.
- Grounded / in-maintenance / retired aircraft cannot be scheduled at all.
- `suggestResources()` and `suggestAlternatives()` answer the follow-up
  question a dispatcher actually has: what *is* free.
- Event types are aviation-shaped (`EventType`): flight lesson, solo flight,
  ground lesson, simulator, checkride, rental, maintenance block, meeting.
- Maintenance blocks compete for the aircraft like any other event —
  scheduled maintenance overlap is a first-class conflict.

## Dispatch workflows

Standard: a flight is *released*, flies, and is *closed out* — three
distinct legal moments, not a calendar status toggle.

As implemented (`Dispatch` model, `api/dispatch/[id]/release` and
`.../close`):

- Lifecycle `PENDING → RELEASED → CLOSED` (or `CANCELLED`), one dispatch per
  `ScheduleEvent`.
- **Pre-flight release checklist** is enforced server-side: fuel and oil
  quantities recorded, weather acknowledged and documents verified are
  `z.literal(true)` — the API rejects a release without them.
- **Airworthiness blocks release**: `airworthinessOf()` runs at release and
  returns 409 with the reason (`"N12345 is not airworthy: 100hr overdue by
  3.2 hrs."`) — enforced, not just displayed.
- Release stamps `releasedBy`/`releasedAt` and captures meter readings
  (`hobbsOut`, `tachOut`) from the aircraft record.
- **Closeout is atomic** (do-not-break rule 5): meters roll forward, pilot
  time logs, invoice generates, student balance updates — one
  `db.$transaction`. A squawk can be filed in the same closeout; a
  `GROUNDING` squawk sets the aircraft `GROUNDED` in the same transaction.
- Closeout emits `flight.closed` on the domain event bus.

## Instructor workflows

Standard: instructors are certificated airmen whose signatures carry legal
weight, not staff resources.

As implemented (`Instructor`, `Endorsement`, `LessonRecord`):

- Certificates (`CFI,CFII,MEI`), CFI number, CFI expiration, medical
  expiration tracked; expiry blocks scheduling (§Aircraft scheduling).
- Availability windows per day-of-week enforced at booking.
- **Endorsements** carry a FAR reference, full text, signature timestamp,
  and optional expiry — modeled as signed instruments, and the FK is
  RESTRICT: an instructor who signed endorsements or lesson records cannot
  be hard-deleted out from under their signatures.
- Lesson records are dual-signed (`signedByInstructor`, `signedByStudent`)
  with grade and flight/ground hours.

## Student workflows

Standard: a student is a pipeline from first contact to certificate, with
regulatory identity attached.

As implemented (`Student`, `StudentStatus`):

- Lifecycle: `LEAD → DISCOVERY_FLIGHT → PROSPECT → ENROLLED → GRADUATE /
  ALUMNI / INACTIVE`, with lead source and discovery-flight outcome (the CRM
  is aviation-shaped, not bolted on).
- Regulatory identity: FAA certificate number, FTN, certificate held,
  medical class + expiration, student certificate number, **TSA
  verification flag** (required before flight training for non-citizens).
- Training state: Part 61/141, syllabus enrollments, written test
  passed/score/date, total and solo hours, assigned instructor, account
  balance.
- Earned ratings accumulate in `StudentRating` as checkrides pass.

## Flight logging

Standard: closeout should capture what a pilot logs, in FAA logbook
categories.

As implemented (`Dispatch` closeout): flight time, landings, night time,
instrument time, dual received / dual given, PIC time, fuel added. Solo
flights increment `Student.soloHours`; every flight increments
`Student.totalHours`. Time splits are derived server-side: dual flights log
dual received (student) and dual given (instructor); solo/rental logs PIC.

This is dispatch-grade logging, not a full logbook replacement —
cross-country time, day/night landings split, approaches, and route are not
captured (see Gaps).

## Hobbs/Tach time

Standard: **Hobbs bills, Tach drives maintenance.** Hobbs runs on the master
switch/engine and is what the customer pays for; tach runs proportional to
RPM and is what inspections accrue against.

As implemented — read carefully, the second half of the standard is not yet
true in code:

- Both meters are captured at release (`hobbsOut`, `tachOut`) and closeout
  (`hobbsIn`, `tachIn`) and rolled onto `Aircraft.currentHobbs/currentTach`.
- **Billing is Hobbs**: `flightTimeFromHobbs()` (`lib/billing.ts`) computes
  billable time and rejects `hobbsIn <= hobbsOut`; the invoice line bills
  wet-rate × Hobbs delta.
- **Maintenance intervals currently run on Hobbs, not Tach**:
  `lib/airworthiness.ts` compares `AircraftComponent.dueAtHours` against
  `currentHobbs`, and closeout increments `engineTimeSmoh`/`propTimeSpoh` by
  the Hobbs-derived flight time. Tach is captured and stored but drives
  nothing yet. This is conservative (Hobbs ≥ tach, so inspections come due
  early, never late) but it is a deviation from standard practice — see
  Gaps.
- `tachIn` is validated positive but not validated against `tachOut` (see
  Gaps).

## Weather handling

Standard: one source of truth, METAR conventions, flight categories that
change operational decisions.

As implemented (`src/lib/weather.ts`, pinned by `tests/weather.test.ts`):

- **Single source**: every weather surface (top-bar chip, dashboard,
  operations board, Mission Control) renders from `airportWeather()` /
  `activeLocationWeather()` keyed to the active org/location. The test suite
  statically rejects hardcoded airport identifiers and METAR-style strings
  anywhere in `src/app` and shell components — the rule is enforced, not
  aspirational.
- Flight categories derived from ceiling and visibility: **IFR** (ceiling
  < 1,000 ft or vis < 3 SM), **MVFR** (ceiling < 3,000 ft or vis < 5 SM),
  else **VFR**. **LIFR is not implemented** (see Gaps).
- METAR conventions in display: `weatherSummary()` renders
  `310° 12G18kt · 10SM · BKN012 · 24°C`; `skyOf()` renders
  `CLR / SCT045 / BKN012 / OVC008`.
- Weather is operationally opinionated: IFR flags "student solos blocked",
  MVFR flags cross-country review, strong wind flags crosswind limits,
  density altitude > 2,500 ft flags degraded climb.
- The generator is a deterministic simulated METAR seeded by (ICAO, hour);
  the production METAR/TAF adapter (Aviation Weather API) replaces its
  internals without touching any consumer. TAF (forecast) has no surface yet
  (see Gaps).
- Release requires `weatherAcknowledged: true` — the dispatcher must look.

## Time zones

**Standard: a schedule time must be unambiguous at the operation's
location.** "0900" means 0900 on the ramp at that airport — store the UTC
instant, interpret and render in the location's IANA zone, and never let an
org with locations in two zones see ambiguous times.

Current state, honestly: `Organization.timeZone` and `Location.timeZone`
are stored (IANA strings, default `America/New_York`) but **not yet applied**.
`ScheduleEvent.start/end` are Prisma `DateTime` instants; conflict math is
correct (instant vs instant), but rendering and instructor-availability
matching (`getDay()`/`getHours()`, `toLocaleTimeString` without a `timeZone`
option in `lib/scheduling.ts`) use the server/browser locale, not
`Location.timeZone`. Correct so long as server, browser, and airport agree —
which multi-zone tenants will break. See Gaps.

## Airport data

Standard: locations are airports, identified the way aviation identifies
them.

As implemented (`Location` model):

- `icao` (K-prefix for CONUS fields, e.g. `KPAO`) and `iata`; `icaoOf()`
  falls back to a name-derived 4-letter code when a location (e.g. a
  heliport) has no ICAO.
- Operational fields a generic CRM would never carry: `weatherStation`,
  `fuelProvider`, `runwayNotes`, `patternNotes`, `emergencyNotes`,
  `operatingHours`, per-location `timeZone`.
- The active location is a per-user cookie falling back to the org's first
  active location; everything location-sensitive (weather, ops boards)
  respects it (CLAUDE.md §6).
- Note: `Location.weatherStation` is stored but `airportWeather()` keys off
  `Location.icao` — the dedicated METAR-source field is not yet consumed
  (see Gaps).

## Aircraft maintenance

Standard: inspections are legal limits; exceeding one grounds the aircraft;
returning to service requires a signature.

As implemented:

- `AircraftComponent` tracks inspection and life-limited items — annual,
  100-hour, ELT, pitot-static, transponder, ADS-B, oil, tires, brakes,
  battery — each date-based, hours-based, or both, with last-done and
  interval fields.
- `airworthinessOf()` (`lib/airworthiness.ts`) is the single computed answer
  to "can this aircraft fly": `GROUNDED / OUT_OF_SERVICE /
  MAINTENANCE_OVERDUE` block dispatch; `DUE_SOON` (≤ 10 hrs or ≤ 14 days)
  warns but flies; simulators are exempt from inspection tracking. Overdue
  by any margin = cannot dispatch — there is no override.
- Squawks carry airworthiness impact by severity: `GROUNDING` squawks set
  the aircraft `GROUNDED` (including in-transaction at closeout).
- Work orders (`MaintenanceOrder`) run a full shop lifecycle
  (`DRAFT → … → AWAITING_INSPECTION → APPROVED → RETURN_TO_SERVICE →
  COMPLETED/CLOSED`) with priority up to `AOG`/`EMERGENCY`, parts/labor
  cost, corrective action, and a **signed return-to-service**
  (`approvedBy`/`approvedAt`); transition legality lives in
  `lib/work-orders.ts` and is contract-tested.
- Insurance and registration expirations tracked on `Aircraft`.

## Checkride readiness

Standard: "is this student ready?" must be answered with reasons a CFI can
act on, mapped to what an examiner will actually require.

As implemented (`lib/readiness.ts`, `Checkride`):

- `computeReadiness()` scores 0–100 from six explained factors: flight
  hours vs syllabus `requiredHours`, syllabus lessons complete, stage
  checks passed, endorsements on file, knowledge (written) test, medical
  currency — each with met/detail/weight, and the weights sum to the score
  (contract-tested).
- Status ladder `NOT_READY → NEEDS_WORK → ALMOST_READY → READY`, overridden
  to `SCHEDULED` once a checkride is booked; weak areas surface alongside.
- `Checkride` records rating sought, DPE (`examinerName`), recommending
  instructor, and outcome `PASSED / FAILED / DISCONTINUED / CANCELLED` —
  *discontinued* is a real checkride outcome and gets its own status and
  color.

## Compliance

Standard: currency and eligibility are operational gates, not report-time
afterthoughts.

Tracked today and **enforced at booking** (`detectConflicts`): student
medical expiration, instructor CFI expiration, instructor medical
expiration — all checked against the *flight's start time*. Tracked but not
gate-enforced: TSA verification, written test, student certificate,
aircraft insurance/registration expiry. Not yet tracked at all: flight
review (61.56), IPC, 61.57 passenger/night currency, medical-class duration
rules, solo-endorsement validity at dispatch. See Gaps — the schema
distinction matters: don't document currency AeroOps doesn't compute.

## Audit trails

Standard: the audit log is the regulatory-defensibility layer — when the FAA
or an insurer asks "who released that aircraft and when," the answer must
already exist.

As implemented: every mutation goes through `recordAudit` into `AuditLog`
(actor, action, entity, old/new values, IP, user agent) — constitution rule
7, do-not-break rule 3. The log is immutable: never rewritten, preserved
verbatim through org snapshot restore (`lib/org-snapshot.ts`), and doubles
as the Mission Control command timeline. Dispatch release and closeout both
audit with tail number, meters/charges, and named human actor — and the AI
layer never mutates, so every logged action traces to a person.

## Aviation-specific UX

Standard: the interface should read like an FBO ops desk, not a SaaS admin
panel.

- **Terminology precision**: dispatch, release, closeout, squawk, work
  order, tail number, grounded, AOG — never "check-in", "ticket",
  "vehicle", or "booking confirmed". The schema, APIs, and UI share this
  vocabulary end-to-end.
- **Status colors match aviation severity** (`lib/status-colors.ts`, frozen
  meanings): `GROUNDED`/`AOG`/`EMERGENCY` dark red, `CRITICAL`/overdue
  red, cautions (`WAITING_PARTS`, `DUE_SOON`, `RESERVED`) amber, in-work
  orange, released/dispatched purple, in-flight/airworthy green. One map,
  one file, meanings never change (constitution rule 4).
- **METAR-shaped compactness**: weather renders in pilot shorthand
  (`310° 12kt · 10SM · SCT045`), not prose paragraphs.
- **Mission Control is the ops wall** (`/mission-control`): full-screen,
  SSE-live, one snapshot builder feeding every widget — schedule, fleet,
  weather, and the audit timeline as the command log.
- Tone: aviation-professional, enterprise-calm (CLAUDE.md §4) — no flashy
  gradients; errors tell the dispatcher what to do next.

## Gaps to close

Honest deltas between AeroOps today and aviation best practice. Roadmap
candidates, not documentation debt.

| # | Gap | Current state | Standard |
|---|---|---|---|
| 1 | **Tach doesn't drive maintenance** | `airworthinessOf()` and SMOH/SPOH accrual use Hobbs; tach is captured but unused | Inspection intervals (100-hr, oil) accrue on tach; Hobbs bills. Current behavior is conservative (inspections come due early) but overstates engine time |
| 2 | Tach closeout unvalidated | `tachIn` only checked positive; no `tachIn > tachOut` guard (Hobbs has one) | Reject impossible meter readings at the API |
| 3 | **No LIFR category** | `lib/weather.ts` derives VFR/MVFR/IFR only | LIFR (ceiling < 500 ft or vis < 1 SM) is a standard flight category with its own (magenta) convention |
| 4 | Time zones stored, not applied | `Location.timeZone` exists; schedule rendering and availability matching use server-local time | Interpret and render all schedule times in `Location.timeZone`; required before multi-zone tenants |
| 5 | `Location.weatherStation` unused | `airportWeather()` keys off `Location.icao` | Fields without airports (heliports, private strips) should pull METAR from the designated nearby station |
| 6 | No flight review / 61.57 currency | Only medical + CFI expiry tracked | Track flight review (61.56), IPC, night/passenger currency; gate solo and rental dispatch on them |
| 7 | Solo endorsement not checked at dispatch | Endorsements have `expiresAt` but release doesn't verify a current solo endorsement for `SOLO_FLIGHT` events | Solo release should verify 61.87 endorsements the way it verifies airworthiness |
| 8 | Partial logbook capture | No cross-country time, day/night landing split, approaches, or route at closeout | Capture full logbook categories, or integrate with an e-logbook |
| 9 | No TAF surface | Simulated METAR only; forecast adapter is a planned seam | TAF matters for scheduling decisions hours out; `lib/forecast.ts` forecasts load, not weather |
| 10 | DPE is a name string | `Checkride.examinerName` | Examiner records (contact, fees, aircraft preferences, scheduling) once checkride volume justifies it |
| 11 | TSA/written tracked but not gated | Flags exist on `Student`; no scheduling/dispatch enforcement | Gate flight training start on TSA verification per 49 CFR 1552 |

## Related documents

- [CONSTITUTION.md](../../CONSTITUTION.md) — enforced engineering law (weather + status-color single-source rules)
- [ARCHITECTURE.md](../../ARCHITECTURE.md) — the engine layer these standards live in
- [CLAUDE.md](../../CLAUDE.md) — session operating system, UI/UX and weather rules
- [ROADMAP.md](../../ROADMAP.md) — where "Gaps to close" rows belong
- [AI_REVIEW_BOARD.md](../engineering/AI_REVIEW_BOARD.md) — the gates that enforce this document
- `prisma/schema.prisma` · `src/lib/{scheduling,airworthiness,weather,readiness,billing,work-orders}.ts` · `tests/weather.test.ts` — the ground truth
