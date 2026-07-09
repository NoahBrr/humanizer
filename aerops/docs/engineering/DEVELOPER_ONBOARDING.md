# AeroOps — Developer Onboarding

Everything a new developer needs to clone, run, understand, and safely
contribute to AeroOps. Pair this with [../../CONTRIBUTING.md](../../CONTRIBUTING.md)
(workflow + rules) and [../../CLAUDE.md](../../CLAUDE.md) (the operating system).

Estimated time to a running local app: **~15 minutes**.

---

## 1. Project overview

AeroOps is a production-quality, **multi-tenant SaaS aviation operations
platform** — scheduling, dispatch, maintenance, training, billing, CRM,
Mission Control, and explainable insights in one system of record, plus a
public marketing site, self-serve onboarding, an Import Center, and an internal
staff portal. Every organization is a fully isolated tenant.

Read [docs/company/VISION.md](../company/VISION.md) for the "why," and
[docs/architecture/ARCHITECTURE.md](../architecture/ARCHITECTURE.md) for the
system source of truth.

## 2. Tech stack

- **Next.js 15** (App Router) · **TypeScript** · **React 19**
- **Tailwind CSS 4** (design tokens in `src/app/globals.css`)
- **Prisma 6** (pinned — never upgrade to 7) on **PostgreSQL 16**
- **NextAuth v5** (JWT sessions)
- **Vitest** (contracts + constitution) · **Playwright** (verification)

No new dependencies without a strong reason — prefer what's already here.

## 3. Folder structure

```
aerops/
├─ src/
│  ├─ app/
│  │  ├─ (marketing)/     public website (/, /features, /pricing, …)
│  │  ├─ (auth)/          sign-in / sign-up
│  │  ├─ (app)/           the authenticated tenant app (dashboard, schedule, …)
│  │  ├─ platform/        internal AeroOps staff portal
│  │  ├─ mission-control/ full-screen live ops wall
│  │  └─ api/             route handlers (every one authorizes)
│  ├─ components/         UI (ui/ design system, shell/ app chrome, marketing/)
│  ├─ lib/                business-logic engines — the heart of the app
│  │                      (session, permissions, rbac, scheduling, billing,
│  │                       dispatch, audit, events, weather, import/, …)
│  ├─ auth.ts / auth.config.ts / middleware.ts   auth wiring
│  └─ instrumentation.ts  startup checks (fail-closed AUTH_SECRET)
├─ prisma/                schema.prisma, migrations/, seed.ts
├─ tests/                 vitest (constitution, security, weather, roles, …)
├─ scripts/               capture-marketing / verify-print / verify-portal
├─ docs/                  the governance library (architecture, company, …)
├─ sales/                 sales & presentation package (generated assets)
├─ CLAUDE.md              session operating system + quality gates
├─ CONSTITUTION.md        machine-enforced rules
├─ ROADMAP.md             living backlog + session log
└─ PRODUCTION.md          launch plan (maintainer-owned)
```

**Architecture rule:** business logic lives in `src/lib` engines; pages and
routes stay thin. Every API route authorizes through `authorize()` /
`authorizePlatform()` (`src/lib/session.ts`) — one gate, no exceptions.

## 4. Local setup

Prerequisites: **Node 20+**, **npm**, and **PostgreSQL 16** (Docker is easiest).

```bash
# 1. clone and enter the app
git clone <repo-url> && cd humanizer/aerops

# 2. environment
cp .env.example .env          # local dev values; NEVER commit .env

# 3. a local Postgres (Docker example)
#    a database reachable at postgresql://aerops:aerops@localhost:5432/aerops
#    (matches DATABASE_URL in .env.example)

# 4. install + database + run
npm install
npm run db:setup              # prisma migrate + seed the demo flight school
npm run dev                   # → http://localhost:3000
```

**Demo logins** (password `demo1234` — demo data only, not real credentials):

| Login | Role |
|---|---|
| `admin@aerops.demo` | Account Owner |
| `dispatch@aerops.demo` | Flight Dispatcher |
| `sarah.cfi@aerops.demo` | Flight Instructor |
| `student@aerops.demo` | Student Pilot |
| `maintenance@aerops.demo` | Maintenance Manager |
| `accounting@aerops.demo` | Finance Manager |
| `founder@aerops.io` | Platform staff (→ `/platform`) |

## 5. Commands

| Command | Purpose |
|---|---|
| `npm install` | install dependencies |
| `npm run dev` | dev server → http://localhost:3000 |
| `npm test` | vitest — contracts + constitution (must be green) |
| `npm run lint` | eslint |
| `npx tsc --noEmit` | typecheck |
| `npm run build` | lint + types + production build (green before every PR) |
| `npm start -- -p 3100` | serve the production build (verification server) |
| `npm run seed` | reseed demo data (TRUNCATE CASCADE — wipes runtime rows) |
| `npm run db:setup` | migrate + seed (first-time setup) |
| `npx prisma migrate dev --name <x>` | create a **named** schema migration |
| `node scripts/verify-portal.mjs` | assert the running app reflects the build |

## 6. Common troubleshooting

- **`fatal: not a git repository` / `npm ENOENT package.json`** — you're in the
  wrong folder. Run commands from `humanizer/aerops`.
- **A UI change doesn't appear** — `next start` never hot-reloads and a stale
  `.next` / lingering `next-server` serves old code. Stop the server,
  `rm -rf .next`, rebuild, restart, then `node scripts/verify-portal.mjs`.
- **DB connection refused** — Postgres isn't running or `DATABASE_URL` is wrong.
  Start your local Postgres; verify `psql "$DATABASE_URL" -c 'select 1'`.
- **Production build rejects AUTH_SECRET** — `next start` runs in production
  mode and rejects the placeholder secret. Set a real `AUTH_SECRET`
  (`openssl rand -base64 32`) in `.env` for the :3100 server.
- **Prisma "update available 7.x"** — ignore it. Prisma 6 is pinned.
- **Tests fail after pulling** — run `npm install` (deps may have changed),
  then `npm test`.

## 7. Governance — read these before writing code

The constitution and governance library are law here (machine-enforced where
possible). Before any non-trivial change, walk CLAUDE.md §12's sequence:

1. [CLAUDE.md](../../CLAUDE.md) — operating system + quality gates (§13).
2. [CONSTITUTION.md](../../CONSTITUTION.md) — machine-enforced rules.
3. [docs/architecture/ARCHITECTURE.md](../architecture/ARCHITECTURE.md) +
   [DECISIONS.md](../architecture/DECISIONS.md) (ADR log).
4. [docs/architecture/SECURITY_STANDARDS.md](../architecture/SECURITY_STANDARDS.md)
   · [DATABASE_STANDARDS.md](../architecture/DATABASE_STANDARDS.md)
   · [API_STANDARDS.md](../architecture/API_STANDARDS.md).
5. [ENGINEERING_HANDBOOK.md](./ENGINEERING_HANDBOOK.md) ·
   [AI_REVIEW_BOARD.md](./AI_REVIEW_BOARD.md) ·
   [docs/design/DESIGN_SYSTEM.md](../design/DESIGN_SYSTEM.md).

## 8. Permission rules for external developers

These are binding for anyone with contributor (not maintainer) access:

- **Work on branches only.** Never commit or push directly to `main`.
- **Do not deploy.** Deployment and production infrastructure are
  maintainer-owned (PRODUCTION.md). There is no exception.
- **Do not access production secrets.** You get local dev values only
  (`.env.example`). Never request or commit real keys, tokens, or database URLs.
- **Do not modify billing, security, or authentication** (auth, sessions,
  impersonation, the money path) **without prior written approval.**
- **Do not change the database schema without an approved migration plan** —
  a named, additive Prisma migration reviewed before merge.
- **Follow CLAUDE.md and the governance docs.** Keep `npm test` and
  `npm run build` green; open a PR for review; the maintainer merges.
- **Never commit secrets or `.env` files.** If you think a secret was committed,
  stop and tell the maintainer immediately.

Everything you contribute goes through a pull request and code review against
the quality gates in CLAUDE.md §13. Welcome aboard.
