# AeroOps AI Review Board

A feature is **not complete until it has passed every reviewer on this
board** (the 8-gate rule). The board exists to make "done" mean the same
thing whether a human or an AI built the slice. Companions:
[CONSTITUTION.md](../../CONSTITUTION.md) (the law the board enforces),
[CLAUDE.md](../../CLAUDE.md) (session operating system),
[PRODUCTION.md](../../PRODUCTION.md) (launch plan the Production Reviewer
audits against).

Reviewers review; they do not patch. Findings go back to the builder
(`engineer`), who fixes and resubmits. A builder never passes their own gate.

## How the board runs

**Gates by change size.** Don't ceremonialize small fixes — a typo doesn't
need a committee (CLAUDE.md). The board scales:

| Change size | Mandatory gates | Optional |
|---|---|---|
| Docs-only change | Documentation | — |
| Bug fix | QA + the domain reviewer whose area is touched (Security if auth/tenancy/routes; UX if screens; Performance if queries) | Architect if the fix reveals a design flaw |
| Feature slice | **All 8** | — |
| Release-sized merge | **All 8**, Production Reviewer last and blocking | — |

**Order for a feature slice** (mirrors the CLAUDE.md role flow): AI CTO →
Principal Architect → build → Security + Performance + QA + UX in parallel →
Documentation → Production (release-sized merges only run Production as the
final gate).

**Recording verdicts.** Each gate's verdict is recorded in the PR/commit
description as one line per reviewer: `PASS` / `FAIL (blocking list)` /
`N/A (reason)`, with evidence (file:line, command output, screenshot path).
A gate marked `N/A` needs a written reason, exactly like the constitution
test's PUBLIC/SELF_SERVICE allowlists. A verdict claiming verification that
was not actually performed is itself an automatic rejection — for the
reviewer and the change.

**Agent mapping.** Reviewers map to the Claude Code subagents in
[.claude/agents/](../../.claude/agents/):

| # | Reviewer | Subagent |
|---|---|---|
| 1 | AI CTO | `architect` |
| 2 | Principal Software Architect | `architect` + `db-architect` |
| 3 | Security Reviewer | `security-reviewer` |
| 4 | Performance Reviewer | **none yet** — see below |
| 5 | QA Reviewer | `qa-engineer` |
| 6 | UX Reviewer | `ui-engineer` |
| 7 | Documentation Reviewer | `docs-engineer` |
| 8 | Production Reviewer | `production-reviewer` |

> **Gap:** the Performance Reviewer has no dedicated agent. Today the
> checklist is split across `db-architect` (queries/indexes) and
> `production-reviewer` (scale). Recommend creating
> `.claude/agents/performance-reviewer.md` (read-only, like the other
> reviewers) so gate 4 has one owner. Flagged, not created.

---

## 1. AI CTO

**Subagent:** `architect`

**Responsibilities.** Product fit, vision, technical direction, long-term
scalability. Decides whether the change belongs in AeroOps at all, and
whether it strengthens the platform (engines, event vocabulary, API surface,
Mission Control) rather than just its own page.

**Checklist**
- [ ] The change maps to a ROADMAP.md row (or adds one) in the right
      priority context.
- [ ] It extends an existing engine in `src/lib` or justifies a new one —
      no parallel abstraction where `lib/scheduling.ts`, `lib/work-orders.ts`,
      etc. already fit.
- [ ] Computed answers are explainable: factors/basis/confidence, like
      `lib/readiness.ts` and `lib/fleet-health.ts`.
- [ ] New domain events extend the `lib/events.ts` vocabulary with a live
      emit site (the constitution test rejects vocabulary drift).
- [ ] The slice is independently shippable; deferrals are stated, not hidden.
- [ ] Nothing forecloses the staged seams: monorepo split, durable queue
      behind `emitDomainEvent`, production adapters (Stripe/METAR/email).

**Pass:** the change makes the platform stronger, lands in roadmap context,
and its deferrals are written down.
**Automatic rejection:** a feature that duplicates an existing engine's
job; a new dependency with no written justification (CLAUDE.md §2); a slice
that cannot ship without a second undelivered slice; an unexplainable score
or recommendation (a number without a "why").

## 2. Principal Software Architect

**Subagents:** `architect` + `db-architect`

**Responsibilities.** Architecture, maintainability, technical debt, system
boundaries: the `src/lib` engine layer, thin routes/pages, the Prisma schema,
and the module seams described in ARCHITECTURE.md.

**Checklist**
- [ ] Business logic is in `src/lib`; routes only validate (zod), authorize,
      call an engine, audit, emit. Components only render.
- [ ] A computation appearing twice became a lib function (the
      `computeOrgHealth` pattern).
- [ ] Schema changes are named migrations, additive-only within a release;
      money is `Decimal`; org-owned tables carry `organizationId` + scoped
      indexes + `createdAt`.
- [ ] FK actions are explicit; instructor-linked records (lesson records,
      endorsements) stay RESTRICT and wipe helpers order children first
      (`lib/org-snapshot.ts` is canonical).
- [ ] Multi-row money mutations use `db.$transaction` (dispatch closeout in
      `api/dispatch/[id]/close/route.ts` is the reference).
- [ ] TypeScript strict, no `any` escape hatches, idiom matches the
      surrounding code.

**Pass:** the diff would look native to a reader of ARCHITECTURE.md;
`npx tsc --noEmit` and `npm test` green.
**Automatic rejection:** business logic in a component or route; a migration
that drops or renames a column in the same release as the code change; a
Prisma 7 upgrade (pinned at 6); `emitWebhook` called outside `src/lib`;
money as float; a rewrite of a working system with no stated reason.

## 3. Security Reviewer

**Subagent:** `security-reviewer`

**Responsibilities.** Authentication, authorization, tenant isolation,
secrets, OWASP-class issues — audited in the priority order of
`.claude/agents/security-reviewer.md`.

**Checklist**
- [ ] Every new/changed route calls `authorize()` / `authorizePlatform()`
      (`lib/session.ts`); any PUBLIC or SELF_SERVICE addition is catalogued
      in `tests/constitution.test.ts` with a written reason and rate limiting
      (`lib/rate-limit.ts`).
- [ ] Every query's org scope comes from the session — grep the diff for
      `organizationId` sourced from a request body or params.
- [ ] Privilege boundaries hold: individual vs org vs platform sessions,
      impersonation read-only enforcement, invite-link expiry/max-use.
- [ ] zod on every input; no raw SQL from user data; secrets never logged,
      committed, or written to audit metadata.
- [ ] Every mutation lands in `AuditLog` with a real actor via `recordAudit`.
- [ ] Denial and cross-tenant paths were exercised against the running app,
      not assumed.

**Pass:** findings list empty at high/critical, and "verified safe" claims
name what was actually checked.
**Automatic rejection:** any route not calling `authorize()` /
`authorizePlatform()` and not catalogued with a reason; org scope taken from
client input; a mutation without `recordAudit`; a secret in the repo; any
path where the AI layer mutates (dispatch, maintenance approval, payments,
deletion are human-only); weakened impersonation controls.

## 4. Performance Reviewer

**Subagent:** none yet — split across `db-architect` and
`production-reviewer` until a dedicated agent exists (flagged above).

**Responsibilities.** Query shape, API latency, React rendering, bundle
size, caching, behavior at 100+ orgs.

**Checklist**
- [ ] No N+1: list pages batch with `include`/`select` or grouped queries,
      never a query per row in a loop (`lib/scheduling.ts` batches with
      `Promise.all` — that is the idiom).
- [ ] New query axes get scoped indexes in the style of `ScheduleEvent`
      (`@@index([organizationId, start, end])`, `@@index([aircraftId, start])`).
- [ ] Computed values (airworthiness, health, readiness) stay derived at
      read time — no stored-and-resynced caches.
- [ ] Mission Control additions feed from the single snapshot builder
      (`lib/mission-control.ts`); no widget polls independently.
- [ ] Client components only where interaction requires them; heavy
      dependencies justified against bundle size.
- [ ] Hot paths at 100+ orgs are flagged with the rollup/index proposed in
      ROADMAP.md now, even if not built.

**Pass:** the change stays inside ROADMAP p95 budgets on the running app and
introduces no unindexed org-scoped query.
**Automatic rejection:** a per-row query inside a render or map loop over an
unbounded list; a new org-scoped table or query axis with no
`organizationId`-leading index; a stored copy of a derivable value; a
Mission Control widget with its own polling loop.

## 5. QA Reviewer

**Subagent:** `qa-engineer`

**Responsibilities.** Tests, edge cases, regression risk, user flows —
nothing is done until proven against the running application.

**Checklist**
- [ ] `npm test` and `npm run build` green; new engine → new contract test
      in `tests/`; new static rule → scanner test (the
      `constitution.test.ts` pattern).
- [ ] Runtime verification on :3100: happy path, a permission-denial path,
      and a cross-tenant path.
- [ ] Edge cases exercised where the domain has them (e.g. closeout rejects
      `hobbsIn <= hobbsOut`; release returns 409 for a non-airworthy
      aircraft).
- [ ] Gating verified by content markers, not status codes; Mission Control
      waited on selectors, never `networkidle`.
- [ ] Report states what was run, what failed, and what was NOT covered.

**Pass:** green suites plus honest runtime evidence for every claimed
behavior.
**Automatic rejection:** claimed verification that wasn't performed; an
existing test edited to pass without an explicit contract-change note
(do-not-break rule 10); a new engine with no contract test; a new route
missing from the constitution authorization scan.

## 6. UX Reviewer

**Subagent:** `ui-engineer`

**Responsibilities.** Visual consistency, accessibility, mobile experience,
workflow quality, and the aviation-professional tone
(see [AVIATION_STANDARDS.md](../aviation/AVIATION_STANDARDS.md) §Aviation-specific UX).

**Checklist**
- [ ] Built from `src/components/ui` primitives and design tokens
      (`bg-primary`, `text-brand-sky`, `bg-sidebar`); brand marks from
      `src/components/brand/logo.tsx`.
- [ ] Status colors exclusively via `lib/status-colors.ts`
      (`statusToneOf` / `statusHex`).
- [ ] Loading, empty, and error states shipped with the feature; errors say
      what to do next.
- [ ] Light + dark parity; desktop/tablet/mobile (base `grid-cols-1` track,
      bottom nav below `lg`); screenshots at 1440/820/390 in both themes.
- [ ] Keyboard reachable (⌘K palette, focus-trapped drawers), aria labels,
      WCAG AA contrast.
- [ ] Aviation terminology per AVIATION_STANDARDS.md — dispatch/release/
      closeout/squawk, never "check-in" or "ticket".

**Pass:** screenshots prove all breakpoints/themes; every state present; no
token or terminology violations.
**Automatic rejection:** a raw hex color in a component; a second
`STATUS_TONE` map or a meaning change to an existing `STATUS_TONE` entry;
a hardcoded role check in a component instead of `SECTION_PERMISSIONS`;
a screen that only works in one theme or breakpoint; flashy
gradients/glassmorphism.

## 7. Documentation Reviewer

**Subagent:** `docs-engineer`

**Responsibilities.** README, API, architecture, and user documentation stay
truthful — stale docs are bugs.

**Checklist**
- [ ] ROADMAP.md rows moved/added; "Last session update" refreshed.
- [ ] ARCHITECTURE.md gains an engine entry when `src/lib` gained one.
- [ ] CLAUDE.md touched only if a durable rule or workflow changed — and
      kept tight.
- [ ] README.md still the "how to run it" door (demo logins, quick start,
      feature map); PRODUCTION.md updated if the launch plan moved.
- [ ] Deferrals and known limitations recorded, not omitted.
- [ ] No documented behavior that wasn't confirmed in the code.

**Pass:** a new session reading only the docs would not be misled about
anything this change did.
**Automatic rejection:** a landed engine absent from ARCHITECTURE.md; a
ROADMAP left claiming the work is not done (or claiming undone work is
done); documentation of behavior the reviewer did not confirm in code;
narration bloat added to CLAUDE.md.

## 8. Production Reviewer

**Subagent:** `production-reviewer`

**Responsibilities.** Infrastructure readiness, monitoring, logging,
deployment safety, rollback readiness — audited against PRODUCTION.md
(§12 security checklist, §13 launch blockers, §14 phases). Never deploys.

**Checklist**
- [ ] Tests + build green; new routes catalogued in the constitution scan.
- [ ] Migrations additive-only and rollback-safe in practice (code rollback
      safe while the migration stays applied).
- [ ] New adapters behind env flags, degrading gracefully when unset
      (`EMAIL_ENABLED`, `BILLING_ENFORCEMENT`, `SENTRY_DSN` patterns);
      `.env.example` placeholder-only.
- [ ] Rate limiting on new public/self-service surfaces; structured logging
      via `lib/logger.ts`; `/api/health` still data-free.
- [ ] Mutations audited; errors actionable; no silent row failures (Import
      Center is the reference pattern).
- [ ] Marketing/print screenshots regenerated if UI changed
      (`scripts/capture-marketing.mjs`).

**Pass:** pass/fail per item with evidence (file:line or command output);
blocking list empty.
**Automatic rejection:** a destructive migration in the same release as its
code change; an adapter that hard-fails when its env vars are unset; a
secret or live key in the repo or `.env.example`; a deploy performed without
explicit instruction; a new public surface with no rate limit.

---

## Related documents

- [CONSTITUTION.md](../../CONSTITUTION.md) — the enforced law behind every gate
- [CLAUDE.md](../../CLAUDE.md) — session operating system and role flow
- [ARCHITECTURE.md](../../ARCHITECTURE.md) — the system the board protects
- [PRODUCTION.md](../../PRODUCTION.md) — the Production Reviewer's audit basis
- [ROADMAP.md](../../ROADMAP.md) — where verdicts' deferred work lands
- [AVIATION_STANDARDS.md](../aviation/AVIATION_STANDARDS.md) — domain standards the UX/QA gates enforce
- [.claude/agents/](../../.claude/agents/) — the reviewer subagent definitions
