# AeroOps — The Operating System for Aviation

A modern, multi-tenant SaaS platform for flight schools and aviation academies:
scheduling, dispatch, aircraft management, student training, billing,
maintenance, reporting, and compliance in one system.

Built with Next.js 15 (App Router), TypeScript, Tailwind CSS 4, Prisma, and
PostgreSQL. UI patterned after modern enterprise tools: command palette (⌘K),
dark/light mode, keyboard-friendly, responsive.

## Public website & onboarding

The marketing site lives at `/` (with `/features`, `/solutions/*`, `/pricing`,
`/about`, `/contact`, `/demo`) and is fully separate from the authenticated
app. Self-serve onboarding:

- **`/sign-up`** creates an individual account (no organization). Individuals
  land on **`/welcome`** — create a company, join one, or continue solo.
- **Create company** (`/welcome/create`): name → business activities →
  location & contact → team invites → done; the creator becomes the owner and
  activities enable the right modules.
- **Join company** (`/welcome/join`): search by name/airport/city/org code and
  file a join request (role, certificate info, message). Admins review at
  **`/settings/join-requests`** — approve (assign role + location), reject, or
  ask for more info; everything is audited and the member is notified.
- **Invite links** (`/join/<token>`): shareable links with role, expiration,
  max uses, and auto-approve vs. request mode.
- Demo/contact form submissions surface on the Founder Platform dashboard.

Sidebar: collapses to icons with an always-visible edge handle and the `[`
keyboard shortcut; phones/tablets use the bottom navigation bar.

## Quick start

Requirements: Node 20+, PostgreSQL 14+.

```bash
npm install
cp .env.example .env          # set DATABASE_URL + AUTH_SECRET
npx prisma migrate dev        # create schema
npm run seed                  # load the demo flight school
npm run dev                   # http://localhost:3000
```

### Demo logins (password `demo1234`)

| Role | Email |
|---|---|
| **Platform: Founder** | `founder@aerops.io` |
| **Platform: Support** | `support@aerops.io` |
| **2nd tenant admin** | `admin@blueridge.demo` |
| School Administrator | `admin@aerops.demo` |
| Dispatcher | `dispatch@aerops.demo` |
| Instructor (CFI) | `sarah.cfi@aerops.demo` |
| Student | `student@aerops.demo` |
| Maintenance | `maintenance@aerops.demo` |
| Accountant | `accounting@aerops.demo` |

The sign-in page has one-click buttons for each demo role. Every role sees
only the modules its permissions allow (enforced in the UI, in server pages,
and in every API route).

## What's implemented (MVP)

- **Authentication & RBAC** — Auth.js credentials sign-in, JWT sessions,
  seven roles, per-route and per-API authorization, multi-tenant data model
  (every record is scoped to an `Organization`).
- **Dashboard** — today's flights, fleet availability, students flying,
  revenue today/this month, utilization per aircraft, upcoming checkrides,
  outstanding balances, open squawks, upcoming maintenance, notifications,
  and a weather strip.
- **Scheduling engine** — FullCalendar day/week/month/timeline(by aircraft)/list
  views; drag-to-book, drag-to-move, resize; search + aircraft/instructor
  filters; quick-schedule panel. Server-side **conflict detection**
  (aircraft/instructor/student double-booking, maintenance overlap, grounded
  aircraft) returns HTTP 409 with **automatic alternative-slot suggestions**;
  staff can override. Weather cancellations, no-shows, cancellations tracked
  with reasons.
- **Dispatch** — three-column board (awaiting release → released/in flight →
  closed today). Pre-flight release checklist (fuel, oil, weather ack,
  document verification, instructor/student approval) blocks non-airworthy
  aircraft. Post-flight closeout captures hobbs/tach in-out, landings,
  night/instrument time, fuel added, and optional squawk; it computes billable
  time from hobbs, rolls aircraft meters forward, logs dual/PIC time,
  updates student hours and balance, and **auto-generates the invoice** in one
  transaction. A grounding squawk grounds the aircraft immediately.
- **Aircraft management** — fleet cards with maintenance countdowns; profile
  pages with rates, meters, insurance/registration expirations, inspection &
  component tracking (annual, 100-hour, oil, ELT, transponder, pitot-static,
  ADS-B) with hours- and date-based progress bars, squawk history, maintenance
  history, flight log, and documents.
- **Student management** — profiles with training goal, certificate, medical,
  TSA status, balances; Part 61/141 syllabus tracking with stages, stage
  checks, per-lesson completion; lesson history with instructor notes and
  digital signature status; endorsements with FAR references; ratings and
  checkrides; upcoming lessons and invoices. Progress bars throughout.
- **Instructor portal** — availability by weekday, assigned students,
  upcoming flights, hours taught and revenue generated (month to date),
  certificate/medical expirations.
- **Maintenance portal** — fleet status grid with ground/return-to-line
  actions (grounding notifies the org), squawk workflow
  (open → in progress → resolved/deferred with resolution notes),
  maintenance queue, upcoming inspections radar, completed work history.
- **Billing** — auto-generated invoices with typed line items (rental,
  instruction, fuel surcharge, membership, late fees…), payment recording
  (card/ACH/cash/check/credit/gift certificate), partial payments, student
  ledger updates, outstanding/overdue rollups. Stripe/QuickBooks are modeled
  as integration points.
- **Reports & analytics** — 30-day revenue and flights charts, revenue per
  aircraft/instructor/student, cancellation reasons, average flight length,
  utilization; CSV export on every dataset. Charts follow a validated
  colorblind-safe palette in both themes.
- **Notifications** — bell with unread count in the top bar, full
  notification center, mark-all-read; events are emitted by domain actions
  (squawk filed, aircraft grounded, balance overdue…). Email/SMS/push
  channels are modeled per-org in Settings.
- **Documents** — expiration-tracked document vault grouped by type
  (medicals, IDs, insurance, maintenance logs); students see only their own.
- **Settings** — branding, time zone, locations, lesson types & rates,
  user/role/MFA table, notification channels, integrations, API keys.

## Platform layer (multi-tenant SaaS)

AeroOps operates like Shopify/Salesforce: one deployment, many isolated
organizations, plus a separate internal backend for AeroOps staff.

- **`/platform` admin console** — platform staff (Founder, Support, Auditor…)
  live in a separate identity table and never belong to customer orgs.
  Dashboard (org counts, MRR, system health), organization management
  (create via wizard, suspend/reactivate/soft-delete, plan changes), audit
  log viewer, staff directory.
- **Subscription plans** — Starter/Professional/Enterprise/University with
  user/aircraft/location/storage limits and per-plan module lists. Seat
  limits are enforced at invitation time.
- **Feature flags** — plan grants module availability; per-org overrides
  disable modules; navigation and section access respect both.
- **Data-driven permissions** — a cataloged permission set
  (`lib/permissions.ts`); roles are bundles stored per-org (`OrgRole`),
  system roles seeded from defaults, custom roles supported. Every API
  route authorizes through one `authorize(permission)` gate.
- **Session layer** — `getSession()` resolves org users, platform staff,
  and impersonation from one place; org suspension locks pages and APIs.
- **Impersonation** — platform staff can view a workspace as any user
  (read-only or full) via a signed, expiring cookie. A persistent banner is
  shown, start/end are audit-logged, mutations are blocked in read-only
  mode, and the organization is notified when the session ends.
- **Invitations** — admins invite by email + role; recipients accept at
  `/invite/<token>`, set a password, and land in the org. Expiring tokens,
  seat-limit checks, duplicate protection.
- **Audit trail** — immutable `AuditLog` (actor, org, action, old/new
  values, IP, user agent) written by every important mutation: scheduling,
  dispatch, payments, grounding, invitations, platform actions.
- **Demo Data Generator** (`/platform/demo-data`) — one click creates an
  isolated, fully-populated demo tenant from a business template (small/
  medium school, university, flying club, corporate, FBO, charter, aircraft
  management) at 5/25/100/500 aircraft: realistic tail numbers, staff,
  students/members, a ±7-day schedule, dispatch history, invoices &
  payments, squawks, maintenance, CRM leads, parts inventory, documents.
- **Live Simulation Engine** (`/platform/simulation`) — 8 scenarios
  (Morning Rush, Busy Weekend, Weather Event, Maintenance Crisis, Checkride
  Week, University Semester, Flying Club Weekend, Charter Surge); each tick
  writes weighted, realistic activity into a tenant — dispatches, flight
  completions with invoices, new reservations, weather cancellations,
  squawks/groundings, payments, check-ins, AI recommendations. Point
  Mission Control at the tenant and the wall moves on its own — built for
  trade shows and investor demos.
- **Organization snapshots** — capture a tenant's complete dataset as JSON
  (row IDs preserved) from the org detail page and restore it later, so a
  polished demo environment is always one click away. Audit/forensic rows
  are deliberately excluded from restores.

## Brand system

Centralized and token-driven:

- `src/components/brand/logo.tsx` — `AeroOpsMark` (the "A" icon),
  `AeroOpsLogo`, `AeroOpsLogoStacked` (color + mono variants), used by the
  sign-in page, org sidebar, and platform portal.
- `public/brand/` — standalone SVGs for emails/reports/PDFs:
  `aerops-logo.svg`, `aerops-logo-dark.svg`, `aerops-mark.svg`,
  `aerops-mark-white.svg`, `aerops-mark-mono.svg`.
- `src/app/icon.svg` — favicon; `public/icons/` PNGs back the PWA manifest.
- `src/app/globals.css` — palette tokens: Deep Navy `#0B2447`, Royal Blue
  `#1E63D0`, Sky Blue `#38A1E8`, Silver `#C6CFD8`, Gunmetal `#2E3A46`, plus
  semantic success/warning/danger/info tokens consumed everywhere
  (`bg-primary`, `text-brand-sky`, `bg-sidebar`, …). Change brand in one
  place; both themes and the platform portal follow.

## Architecture

```
src/
  auth.ts, auth.config.ts     Auth.js (edge-safe split), role claims in JWT
  middleware.ts               session gate for all app routes
  lib/db.ts                   Prisma client singleton
  lib/rbac.ts                 role → section access map
  lib/scheduling.ts           conflict detection + alternative-slot search
  app/(auth)/sign-in          public auth pages
  app/(app)/…                 role-gated product pages (server components)
  app/api/…                   REST endpoints (zod-validated, org-scoped)
  components/ui, shell        design system + navigation chrome
prisma/schema.prisma          ~30 models, FKs + indexes, multi-tenant
prisma/seed.ts                demo flight school with a live two-week schedule
```

Key design decisions:

- **Multi-tenant by construction** — every query filters by the session's
  `organizationId`; there is no cross-tenant path through the API.
- **Server components by default** — pages read Prisma directly and render on
  the server; client components are used only where interaction demands it
  (calendar, dispatch forms, charts, palette).
- **Transactions where money moves** — flight closeout and payment recording
  are single `db.$transaction` batches so meters, ledgers, and invoices never
  drift.
- **Indexes on every scheduling axis** — `(organizationId, start, end)` plus
  per-resource `(aircraftId|instructorId|studentId, start)` keep conflict
  checks and calendar range queries fast at fleet scale.

## Production integrations (stubs by design)

MFA enrollment, Stripe charging, QuickBooks sync, Twilio/SendGrid delivery,
S3/Supabase uploads, and live METAR/TAF are represented in the schema, UI,
and settings but not wired to external accounts — each is an isolated
adapter point ready for keys.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | dev server |
| `npm run build && npm start` | production build / serve |
| `npm run seed` | reseed demo data (idempotent, wipes org data) |
| `npm run db:setup` | migrate + seed |
| `npx prisma studio` | browse the database |
