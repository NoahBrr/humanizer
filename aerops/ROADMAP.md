# AeroOps Roadmap & Release Blueprint

The Section 18 execution roadmap mapped onto reality: what is shipped, what
is a seam, what comes next. Companion to [ARCHITECTURE.md](./ARCHITECTURE.md)
(how to build) and the [README](./README.md) (how to run).

Status legend: ✅ shipped & verified against the running app · 🔩 seam built,
production adapter pending · 🗺 roadmap.

## Phase status

| Phase | Theme | Status |
|---|---|---|
| 1 | Foundation — auth, orgs, business profiles, locations, permissions, founder platform, dashboard, navigation, database | ✅ |
| 2 | Operations — scheduling, aircraft, dispatch, students, instructors, Mission Control, weather 🔩, notifications | ✅ |
| 3 | Maintenance — fleet, work orders, squawks, inventory, fleet health; vendors/compliance docs 🗺 | ✅ core |
| 4 | Business — CRM, admissions, finance, billing, executive workspace; memberships/flying-club billing 🗺 | ✅ core |
| 5 | AI — insights engine, forecasting, Mission Control intelligence, natural-language ask, automations; visual workflow builder 🗺 | ✅ core (live LLM narration 🔩 behind `ANTHROPIC_API_KEY`) |
| 6 | Marketplace — developer APIs ✅, scoped keys ✅, signed webhooks ✅; SDKs, app marketplace, theme engine 🗺 | partial |
| 7 | Enterprise — multi-location ✅, impersonation ✅, SSO 🔩 (env-gated Google/Entra), white label 🗺 | partial |
| 8–10 | International, ecosystem, full aviation OS | 🗺 |

## MVP checklist (Section 18) — evidence

| Requirement | Status | Where |
|---|---|---|
| Authentication (MFA, sessions, rate limits) | ✅ | Section 4 commit; `tests/security.test.ts` |
| Organization management + business profiles | ✅ | `/platform/organizations`, module manager |
| Scheduling (conflicts, recurrence, waitlist) | ✅ | `lib/scheduling.ts`, `/schedule` |
| Aircraft + airworthiness | ✅ | `lib/airworthiness.ts`, enforced at release |
| Dispatch (release → close → bill) | ✅ | one-transaction closeout + event bus |
| Students & instructors (training records, readiness) | ✅ | `/students`, `/training`, `lib/readiness.ts` |
| Billing (invoices, payments, webhooks) | ✅ | `/billing`; Stripe adapter 🔩 |
| Mission Control (live SSE, scenes, TV mode) | ✅ | `/mission-control` |
| Maintenance (WO lifecycle, inventory, fleet health) | ✅ | Sections 15A/15B |
| Mobile web + PWA | ✅ | manifest + sw.js + bottom nav |
| Founder platform + analytics | ✅ | `/platform/dashboard` success metrics |

## Definition of done (every slice, already practiced)

1. `npm test` green (engine contracts pinned in `tests/`).
2. `npm run build` green; migration applied and reviewed.
3. Verified against the running app — permission denials, tenant isolation,
   and the happy path exercised with real requests, not assumed.
4. Screenshot for anything user-facing.
5. Honest deferrals recorded in the section report / this file.

## Release cadence (target)

Internal builds weekly · beta monthly · production every 6–8 weeks · majors
twice a year. Branch model: `main` (releasable) ← PRs from `feature/*`;
`hotfix/*` straight to `main` with backports. This repo currently develops on
a single feature branch by instruction.

## Performance targets

Dashboard < 2s · scheduling < 500ms · search < 250ms · Mission Control
real-time (5s stream ticks) · 10k concurrent users (requires the queue/Redis
seams in ARCHITECTURE.md before horizontal scale-out).

## Next up (recommended order)

1. Production adapters: Stripe, SendGrid/Twilio, Aviation Weather, S3.
2. Durable queue behind `emitDomainEvent` + background jobs (exports, PDFs).
3. Vendors & procurement (15B deferral), technician certifications.
4. Visual workflow builder compiling to the automation registry.
5. Emergency mode + incident command (16C deferral).
6. OpenAPI generation from the route catalog; first SDK.
