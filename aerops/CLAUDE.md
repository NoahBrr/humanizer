# AeroOps — Claude Code Operating System

Read this first, every session. AeroOps is a **production SaaS aviation
operations platform** — treat every change as customer-facing.
[CONSTITUTION.md](./CONSTITUTION.md) is law (machine-enforced),
[ARCHITECTURE.md](./ARCHITECTURE.md) explains the system,
[ROADMAP.md](./ROADMAP.md) is the living backlog,
[PRODUCTION.md](./PRODUCTION.md) is the launch plan.

## 1. Project overview

Multi-tenant operating system for aviation organizations (flight schools,
flying clubs, rental, FBOs, maintenance, charter, corporate, universities):
scheduling, dispatch, maintenance, training, billing, CRM, Mission Control,
AI insights — plus a public marketing site, self-serve onboarding, an Import
Center, and an internal Founder Platform for AeroOps staff.

Surfaces: `(marketing)` public site · `(auth)` sign-in/up · `/welcome`
(individual accounts) · `(app)` tenant app · `/platform` internal staff
portal · `/mission-control` full-screen wall · `/api/v1` public API.

## 2. Tech stack

Next.js 15 App Router · TypeScript · Tailwind 4 (design tokens in
`globals.css`) · **Prisma 6 pinned — never upgrade to 7** · PostgreSQL 16 ·
NextAuth v5 · vitest · Playwright for verification. No new dependencies
without a strong reason — prefer what's already here.

## 3. Architecture rules

- Business logic lives in `src/lib` engines; pages/routes stay thin.
  Computed answers carry their reasons (factors/basis/confidence).
- Every API route authorizes through `authorize()` / `authorizePlatform()`
  (`src/lib/session.ts`) — one gate, no exceptions (constitution-tested).
- Domain events go through `emitDomainEvent` (`src/lib/events.ts`); never
  call `emitWebhook` outside `src/lib`.
- RBAC is data (`src/lib/permissions.ts`); never hardcode role checks.
  Nav items must map to `SECTION_PERMISSIONS` (tested).
- Extend existing modules and idioms; do not invent parallel abstractions.
  Simple beats clever — this codebase optimizes for maintainability.

## 4. UI/UX standards

- Design system only: components from `src/components/ui`, brand marks from
  `src/components/brand/logo.tsx`, colors from tokens (`bg-primary`,
  `text-brand-sky`, `bg-sidebar`…) — never raw hex in components.
- Status colors come exclusively from `src/lib/status-colors.ts`
  (`STATUS_TONE` defined exactly once — tested).
- Every page works in light + dark, desktop + tablet + mobile (bottom nav
  below `lg`). Loading, empty, and error states are part of the feature.
- Tone: aviation-professional, enterprise-calm. No flashy gradients or
  trendy effects. Errors tell the user what to do next.
- Marketing pages use real product screenshots from `public/marketing/` —
  regenerate them after UI changes (see §12) so print/presentation surfaces
  never show an outdated interface.

## 5. Database standards

- Multi-tenant by construction: every operational record hangs off
  `Organization`; org scope comes **from the session, never the client**.
- Schema changes = named migration (`npx prisma migrate dev --name x`),
  additive-only within a release (rollback safety). Money = `Decimal`,
  never float.
- Wherever money moves or multiple rows must agree: `db.$transaction`.
- Mind FK actions: instructor-linked records (lesson records, endorsements)
  are RESTRICT — deletion helpers order children first (see
  `lib/org-snapshot.ts` for the canonical wipe order).

## 6. Authentication, organization & location rules

- Session kinds: `org` (tenant member), `platform` (AeroOps staff — separate
  `PlatformUser` identity table), `individual` (signed up, no org yet →
  `/welcome` only). Resolve via `getSession()` — never `auth()` directly.
- Impersonation is a signed, expiring cookie; read-only blocks mutations;
  start/stop are audited and customer-notified. Never weaken this.
- Users join orgs only via join-request approval, invite link, email
  invitation, or import. `User.organizationId` may be null (individual).
- The **active location** is the per-user `aerops-location` cookie, falling
  back to the org's first active location. Anything location-sensitive
  (weather, ops boards, filters) must respect it.

## 7. Weather source-of-truth rules

All weather comes from `src/lib/weather.ts` (`airportWeather`,
`activeLocationWeather`, `weatherSummary`) keyed to the active org/location.
**Never hardcode an airport identifier or METAR string in the UI** —
`tests/weather.test.ts` statically rejects it. The generator is a
deterministic simulated METAR; the production METAR/TAF adapter will replace
its internals without touching any consumer.

## 8. Testing requirements

- `npm test` green before any commit (engine contracts, constitution
  compliance, security, weather, import suites — sub-second).
- New engine → new contract test. New API route → it must pass the
  constitution authorization scan (add to the catalogued PUBLIC /
  SELF_SERVICE lists only with a written reason).
- Verify against the running app (`npm start -- -p 3100`): real requests for
  APIs **including denial and cross-tenant paths**, Playwright + screenshots
  for UI. Never claim verification you didn't perform.

## 9. Deployment readiness expectations

Follow [PRODUCTION.md](./PRODUCTION.md). **Do not deploy unless explicitly
asked.** Production adapters (email, Stripe, METAR, storage, queue) plug
into existing seams — build behind env flags and degrade gracefully when
unset. Additive migrations only; secrets never in the repo.

## 10. Code quality rules

- `npm run build` green (lint + types) before every commit; no `any`
  escape-hatches, no unused exports, no dead code left behind.
- Comments state constraints the code can't express (never narrate a diff).
- Mutations are audited (`recordAudit`); AI never mutates on its own;
  user-facing errors are actionable; rows/records never fail silently
  (the Import Center is the reference pattern).
- Small slices, each deployable. Update docs (this file, ROADMAP,
  ARCHITECTURE) when the architecture moves — docs are part of the feature.

## 11. Do-not-break rules

1. Tenant isolation — no query without org scope from the session.
2. The `authorize()` gate — no route bypasses it.
3. The audit trail — never rewritten, never skipped for mutations.
4. The Prisma 6 pin, and the seeded demo logins (`demo1234` accounts).
5. Dispatch closeout atomicity (meters + ledger + invoice in one tx).
6. Weather single-source rule (§7) and status-color single-source rule.
7. Sidebar reopenability, mobile bottom nav, light/dark parity.
8. Marketing ↔ app separation (no org data on public pages).
9. Import rollback manifests (every created record tracked).
10. Existing tests — fix the code, not the test, unless the contract truly
    changed (say so explicitly when it did).

## 12. Instructions for future Claude Code sessions

1. Start: read this file → skim ROADMAP's "Last session update" → `npm test`.
2. Work in slices using the roles below; keep the constitution green.
3. DB down? `pg_ctlcluster 16 main start`; reseed with `npm run seed`
   (wipes runtime-created rows: API keys, webhooks, notes, scenes).
   Shell cwd resets between commands — run npm/npx from `aerops/`, git from
   the repo root.
4. UI changed? Rebuild, serve on :3100, and refresh the marketing/print
   visuals: `node scripts/capture-marketing.mjs` — then eyeball the homepage.
5. Playwright: `executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`;
   Mission Control holds an SSE connection open — wait for `load` or a
   selector, never `networkidle`.
6. Verify page gating by content markers, not status codes (`redirect()`
   streams a 200 shell); strip SSR comment markers (`<!-- -->`) before
   grepping rendered HTML.
7. Record honest deferrals in your report and, if durable, in ROADMAP.md.
8. Before ending: update ROADMAP.md (statuses + "Last session update"),
   commit with a clear message, push to the designated branch.

## Engineering roles (Claude Code subagents)

Specialized subagents live in `.claude/agents/` (symlinked from the repo
root's `.claude/agents/` so they're discovered from either anchor). Use them
so work runs like a coordinated team — but don't ceremonialize small fixes; a typo doesn't
need a committee. Typical flow for a feature slice:

**architect → engineer (+ ui-engineer / db-architect where touched) →
qa-engineer + security-reviewer in parallel → docs-engineer →
production-reviewer before release-sized merges.**

| Role | Agent | Use when |
|---|---|---|
| AI CTO / Product Architect | `architect` | Scoping a feature, choosing between designs, sequencing a phase |
| Senior Full-Stack Engineer | `engineer` | Implementing slices end-to-end (the default builder) |
| UI/UX Engineer | `ui-engineer` | New screens, design-system changes, responsive/dark-mode passes |
| Database Architect | `db-architect` | Schema changes, migrations, query performance, FK safety |
| QA/Test Engineer | `qa-engineer` | Contract tests, running-app verification, regression hunts |
| Security Reviewer | `security-reviewer` | Auth/tenancy changes, new public or self-service routes, pre-beta audits |
| Documentation Engineer | `docs-engineer` | CLAUDE/ROADMAP/ARCHITECTURE/README updates after changes land |
| Production Readiness Reviewer | `production-reviewer` | Pre-release audit against PRODUCTION.md checklists |

## Commands

```bash
npm test                # vitest — contracts + constitution (must be green)
npm run build           # lint + types + build (must be green)
npx tsc --noEmit        # quick typecheck
npx prisma migrate dev  # schema changes (always name the migration)
npm run seed            # reset demo data (TRUNCATE CASCADE — wipes runtime rows)
npm start -- -p 3100    # production server used for verification
node scripts/capture-marketing.mjs  # refresh marketing/print screenshots
node scripts/verify-print.mjs       # verify homepage print render + PDF export
```

Local DB: `postgresql://aerops:aerops@localhost:5432/aerops`.
Demo logins (password `demo1234`): `admin@aerops.demo` (org admin),
`founder@aerops.io` (platform founder); full list in README.md.
