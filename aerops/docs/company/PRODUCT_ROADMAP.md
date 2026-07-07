# AeroOps Product Roadmap

Where the product goes, tiered by release. This is the *product* roadmap
(what we build for users); the *engineering* backlog with statuses lives in
[../../ROADMAP.md](../../ROADMAP.md), and the *launch* plan in
[../../PRODUCTION.md](../../PRODUCTION.md). Every item here must trace to
[VISION.md](./VISION.md), [NORTH_STAR.md](./NORTH_STAR.md), and
[PRODUCT_PRINCIPLES.md](./PRODUCT_PRINCIPLES.md) — if it doesn't, it isn't on
this list.

Sequencing rule: nothing that weakens a NORTH_STAR "must never change" item
ships, ever. Within a tier, order by *friction removed per unit of build*
(the Zero-Friction lens from Phase 2/2.5).

---

## Beta — earn the first 20 operators

The bar: a real flight school runs a full training season on AeroOps and
would be upset to lose it. Focus is trust and time-to-value, not surface
area.

- Guided new-org setup checklist ("add aircraft → invite team → first booking") on the empty dashboard.
- Contextual actions: "Book next lesson" from the student page; "Add endorsement" from the student page; "Note on aircraft" from dispatch closeout. *(Playbooks #1,2,10,13 — the "do it from where I am" theme.)*
- Empty-state pass across every module (started in Phase 2.5): every empty screen says what's missing, why, and the next step.
- Default landing page per role (dispatcher → Dispatch, instructor → their day, owner → Executive).
- "Blast radius" confirmations for grounding, cancelling, and snapshot restore (show affected-flight counts before confirming).
- Live METAR/TAF adapter (replaces the simulated generator behind the same functions) — weather stops being illustrative.
- Email verification + password reset (the two Critical onboarding blockers; need the email provider).
- Import prompt inside the create-company wizard (link the wizard to the Import Center).

## Version 1.0 — the operating system stands on its own

The bar: an operator runs *everything* here and retires the whiteboard, the
paper binder, and the spreadsheets.

- Stripe subscriptions (self-serve plans, trial → subscribe, billing portal).
- Real document uploads (R2) with signed URLs — Documents becomes a true vault, and insurance/airworthiness expiries feed the dashboard.
- Currency & expiration guardrails at dispatch time: block solo/PIC on a lapsed medical, endorsement, or CFI currency (not just display them).
- Instructor "my day" view: their flights, reassign-in-one-tap, stage-check queue.
- Chief-instructor pipeline board: readiness, stage checks, checkride queue as one screen.
- Bulk actions the playbooks demand: "reassign all of CFI X today", "cancel weather day at a location", auto-offer freed slots to the waitlist.
- Guided setup checklist graduates into an activation score the owner can see.
- Web push + richer notification fan-out from the existing bus.

## Version 1.5 — depth for growing operations

The bar: multi-location schools and 100+-aircraft operations feel first-class
without the simple case getting heavier.

- Per-org invoice-number sequences (retire the timestamp scheme; exact within-tenant numbering).
- Background import processing + progress for large files (>5k rows).
- Customer-facing card payments on invoices (Stripe Connect).
- Multi-location dashboards and cross-location fleet balancing.
- Scheduled org snapshots + a restore-verify job; restore shows a diff summary.
- Reporting depth: cohort/term grouping, instructor productivity, aircraft profitability trends over time.
- iCal feeds (per user / per aircraft) — low effort, high delight.

## Version 2.0 — the platform others build on

The bar: AeroOps is the operational data layer for GA services, not just an
app.

- Public API maturity: OpenAPI, versioned SDKs, per-key rate limits.
- Integration ecosystem: avionics/engine-monitor data, LMS, accounting (QuickBooks two-way).
- Consent-gated global airframe record (N-number + serial) for cross-operator airframe history / e-logbook portability — with the hard rule that tenant isolation forbids one operator reading another's operational data without both-party consent.
- Charter (Part 135) module: duty-time tracking, trip economics.
- Native mobile apps (the PWA is the bridge).

## Long-Term Vision

The bar: the default answer to "what do you run your operation on?" for GA,
and a data layer the next generation of aviation services trusts.

- AeroOps data informs operators' insurance and financing conversations (opt-in, operator-owned).
- International: Canada then EASA-terminology adapters, data-residency by org home-region.
- Predictive operations: maintenance forecasting, utilization optimization, weather-aware scheduling as first-class, explainable engines.
- An aviation-services marketplace built on the API — *only* once the system-of-record position is earned (VISION.md keeps marketplaces out of scope until then).

---

## Product Intelligence Roadmap

Where AeroOps could *proactively* help — surfaced as explained, confidence-
scored insights, never autonomous mutations (NORTH_STAR: AI advises, humans
act). Prioritized by safety value first, then friction removed. **Not to be
implemented in this phase** — this is the sequenced backlog.

| # | Proactive assist | Trigger it watches | Value | Tier | Notes |
|---|---|---|---|---|---|
| 1 | Currency guard | medical / endorsement / CFI currency vs. a booked solo/PIC flight | **Safety** — prevents an illegal flight | 1.0 | Warn at booking + block at dispatch; data already tracked |
| 2 | Airworthiness forecast | inspection countdowns + repeat squawks | **Safety** — grounding before it strands a schedule | 1.0/1.5 | Extends the existing fleet-health engine |
| 3 | Checkride readiness nudge | syllabus stage progress + missing endorsements | Student throughput | 1.0 | Builds on the readiness engine's factors |
| 4 | Weather risk on the day's flights | active-location flight category / TAF | **Safety** + fewer surprise cancels | Beta/1.0 | Needs the live weather adapter |
| 5 | Implausible-closeout catch | Hobbs delta vs. scheduled duration | Billing integrity | 1.0 | Guards the money path before it commits |
| 6 | Scheduling bottleneck alert | instructor load + aircraft availability | Owner visibility | 1.5 | "Tuesdays are over-subscribed on N735GG" |
| 7 | Utilization / profitability drift | fleet hours + revenue trend | Owner decisions | 1.5 | Explainable, ties to the executive engine |
| 8 | Resource-conflict pre-warning | overlapping bookings before they're saved | Fewer mistakes | 1.0 | Conflict engine exists; surface it earlier |
| 9 | Expiring-document sweep | insurance / registration / airworthiness expiries | Compliance | 1.0 | Needs real document uploads (R2) |

Each, when built, must carry its reasons (the factor/basis/confidence rule)
and route any action through a permissioned human.

## Related documents

[VISION.md](./VISION.md) · [NORTH_STAR.md](./NORTH_STAR.md) ·
[PRODUCT_PRINCIPLES.md](./PRODUCT_PRINCIPLES.md) ·
[../operations/PLAYBOOKS.md](../operations/PLAYBOOKS.md) ·
[../../ROADMAP.md](../../ROADMAP.md) · [../../PRODUCTION.md](../../PRODUCTION.md)
