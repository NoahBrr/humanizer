# Contributing to AeroOps

Welcome. AeroOps is a **production-quality, multi-tenant SaaS aviation
operations platform** — treat every change as customer-facing. This guide is
the short version; the full engineering operating system lives in
[CLAUDE.md](./CLAUDE.md), [CONSTITUTION.md](./CONSTITUTION.md), and the
governance library under [docs/](./docs/). New here? Start with
[docs/engineering/DEVELOPER_ONBOARDING.md](./docs/engineering/DEVELOPER_ONBOARDING.md).

## Ground rules (read once, honor always)

1. **Do not deploy.** There is no "just this once." Deployment is out of scope
   for contributors — the maintainer owns releases (see PRODUCTION.md).
2. **Never commit secrets.** No `.env`, API keys, database URLs, or tokens.
   `.gitignore` excludes `.env*`; put local values in `.env` (copied from
   `.env.example`), never in tracked files.
3. **Work on branches. Never push to `main`.** Open a pull request for review.
4. **Keep the constitution green.** `npm test` and `npm run build` must pass
   before every commit — `tests/constitution.test.ts` enforces the
   architectural rules (one authorization gate, tenant isolation, single
   status/weather source, nav ⊆ permissions).
5. **Don't touch auth, billing, security, or the schema without an approved
   plan.** See "Sensitive areas" below.

## Local setup

```bash
cd aerops
cp .env.example .env      # local dev values; never commit .env
npm install
npm run db:setup          # prisma migrate + seed the demo flight school
npm run dev               # http://localhost:3000
```

Demo logins (password `demo1234`, demo data only — not real credentials):
`admin@aerops.demo` (owner), `dispatch@aerops.demo`, `sarah.cfi@aerops.demo`,
`student@aerops.demo`, `maintenance@aerops.demo`, `accounting@aerops.demo`.

## The commands that must stay green

| Command | When |
|---|---|
| `npm test` | before every commit (vitest — contracts + constitution, sub-second) |
| `npm run lint` | before every commit |
| `npx tsc --noEmit` | quick typecheck |
| `npm run build` | before opening a PR (lint + types + build) |
| `npm run seed` | reset demo data (TRUNCATE CASCADE — wipes runtime rows) |

## Branch naming

Short, kebab-case, prefixed by intent:

- `feat/<area>-<summary>` — a new capability (`feat/schedule-waitlist`)
- `fix/<area>-<summary>` — a bug fix (`fix/dispatch-double-close`)
- `chore/<summary>` / `docs/<summary>` / `refactor/<summary>`

One branch per logical change. Rebase or merge `main` before opening the PR.

## Commit messages

- Imperative subject, ≤72 chars: "Fix dispatch closeout double-billing".
- A short body explaining **why**, not just what. Note verification
  (tests/build) and any deliberate deferral.
- Never include secrets, tokens, or internal hostnames.

## Pull request expectations

Before you open a PR:

- [ ] `npm test`, `npm run lint`, `npm run build` all pass locally.
- [ ] New engine → new contract test; new API route passes the constitution
      authorization scan (see CLAUDE.md §8).
- [ ] Docs updated in the same PR when behavior/architecture changed
      (README / ROADMAP / ARCHITECTURE — docs are part of the feature).
- [ ] UI change? Regenerate screenshots (`node scripts/capture-marketing.mjs`)
      and confirm the rendered app matches (`node scripts/verify-portal.mjs`).

PR description: what changed, why, how you verified it, and which governance
gates apply (CLAUDE.md §13). Keep PRs small and reviewable — one concern each.

## Code review expectations

- Reviews check the [quality gates](./CLAUDE.md#13-governance-library--quality-gates):
  architecture, security, performance, UX, QA, docs, production, aviation
  standards — scaled to change size (a typo doesn't convene a committee).
- Address review comments in follow-up commits on the same branch; don't
  force-push over a review in progress unless asked.
- The maintainer merges. Contributors do not self-merge into `main`.

## Sensitive areas — require an approved plan first

Open an issue and get sign-off **before** changing any of these:

- **Authentication / sessions / impersonation** (`src/lib/session.ts`,
  `src/lib/auth*`, `middleware.ts`).
- **Billing and the money path** (dispatch closeout, invoices, ledgers).
- **RBAC / permissions** (`src/lib/permissions.ts`, `src/lib/rbac.ts`).
- **The database schema** (`prisma/schema.prisma`). Schema changes require a
  **named, additive migration** and a written migration plan — never edit the
  schema without one (CLAUDE.md §5, DATABASE_STANDARDS.md).
- **Tenant isolation** — every query is org-scoped from the session, never the
  client. This is do-not-break rule #1.

## Governance documents to read first

1. [CLAUDE.md](./CLAUDE.md) — the session operating system + quality gates.
2. [CONSTITUTION.md](./CONSTITUTION.md) — machine-enforced rules.
3. [docs/architecture/ARCHITECTURE.md](./docs/architecture/ARCHITECTURE.md) —
   system source of truth, and [DECISIONS.md](./docs/architecture/DECISIONS.md).
4. [docs/architecture/SECURITY_STANDARDS.md](./docs/architecture/SECURITY_STANDARDS.md)
   and [DATABASE_STANDARDS.md](./docs/architecture/DATABASE_STANDARDS.md).
5. [docs/engineering/ENGINEERING_HANDBOOK.md](./docs/engineering/ENGINEERING_HANDBOOK.md).

Thank you for keeping AeroOps calm, correct, and customer-ready.
