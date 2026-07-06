# AeroOps — session-start brief

Multi-tenant aviation operating system (Next.js 15 App Router, TypeScript,
Tailwind 4, Prisma 6 **pinned — do not upgrade to 7**, PostgreSQL 16,
NextAuth v5). Read [CONSTITUTION.md](./CONSTITUTION.md) before writing code;
[ARCHITECTURE.md](./ARCHITECTURE.md) explains the system, [ROADMAP.md](./ROADMAP.md)
what's next.

## Non-negotiables (machine-enforced by `tests/constitution.test.ts`)

- Every API route goes through `authorize()` / `authorizePlatform()`
  (`src/lib/session.ts`). Org scoping comes from the session, never the client.
- Domain events go through `emitDomainEvent` (`src/lib/events.ts`) — never
  call `emitWebhook` outside `src/lib`.
- Business logic lives in `src/lib` engines; computed answers must carry
  their reasons (factors/basis/confidence).
- Status colors: `src/lib/status-colors.ts` only; meanings never change.
- RBAC is data (`src/lib/permissions.ts`); never hardcode role checks.
- Mutations are audited (`recordAudit`); AI never mutates on its own.

## Commands

```bash
npm test                # vitest — engine contracts + constitution compliance
npm run build           # must be green before any commit
npx tsc --noEmit        # quick typecheck
npx prisma migrate dev  # schema changes (name the migration)
npm run seed            # reset demo data (TRUNCATE CASCADE — wipes runtime rows)
npm start -- -p 3100    # production server used for verification
```

Local DB: `postgresql://aerops:aerops@localhost:5432/aerops`
(start via `pg_ctlcluster 16 main start`). Demo logins: password `demo1234`,
`admin@aerops.demo` (org admin), `founder@aerops.io` (platform), full list in
README.md.

## Working style

- Verify against the running app: real requests for APIs (including denial
  and cross-tenant paths), screenshots for UI, then commit.
- Extend existing modules; match surrounding idiom; small slices, each
  deployable.
- Record honest deferrals — in the PR/report and, if durable, in ROADMAP.md.
- Update docs when architecture moves. Documentation is part of the feature.

## Gotchas

- Shell cwd resets between commands: run npm/npx from `aerops/`, git from
  the repo root.
- Reseeding wipes runtime-created rows (API keys, webhooks, notes, scenes).
- Verify page gating by content markers, not status codes — `redirect()`
  streams a 200 shell. Strip SSR comment markers (`<!-- -->`) before grepping
  rendered HTML.
- Playwright: launch with `executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`;
  Mission Control holds an SSE connection open, so wait for `load` or a
  selector, never `networkidle`.
