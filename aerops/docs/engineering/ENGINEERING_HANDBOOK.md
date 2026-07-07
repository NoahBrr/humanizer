# AeroOps Engineering Handbook

How code gets written, reviewed, and shipped here. The
[CONSTITUTION.md](../../CONSTITUTION.md) is law (machine-enforced where
marked ⚖); this handbook is the working practice around it. Anything marked
**(aspirational — not yet enforced)** describes the intended standard where
the tooling or process doesn't exist yet.

## Coding standards

- **TypeScript strict** (`"strict": true` in `tsconfig.json`); no `any`
  escape-hatches, no unused exports, no dead code left behind (CLAUDE.md
  §10).
- zod at every boundary — request bodies, credentials, imported rows.
- Small functions with meaningful names; readable beats clever; write for
  the engineer reading this in twenty years.
- Comments state constraints the code can't express — never narrate a diff.
  Match the surrounding idiom (comment density, naming, response shapes).
- Errors are actionable: user-facing strings tell the caller what to do
  next ("Ask an administrator to grant it", "split it and import in
  batches"). Rows/records never fail silently — the Import Center is the
  reference pattern.
- `npm run build` (lint + types) green before every commit.
- No new dependencies without a strong reason; **Prisma 6 pinned — never 7**.

## Folder organization

```
aerops/
  src/app/(marketing)/   Public site — never shows org data
  src/app/(auth)/        Sign-in/up, invitations, public forms
  src/app/(app)/         Tenant workspaces (dashboard, schedule, dispatch, …)
  src/app/platform/      Staff portal (separate PlatformUser identity)
  src/app/mission-control/  Full-screen live wall (outside the shell)
  src/app/api/           REST routes — thin; every one authorizes
  src/lib/               THE ENGINE LAYER — all business logic
  src/components/ui/     Primitives (badge, button, card, drawer, input, table)
  src/components/shell/  Nav, topbar, command palette
  src/components/brand/  logo.tsx — the only source of brand marks
  prisma/                Schema, migrations, demo seed
  tests/                 Vitest suites (engines, constitution, security, …)
  scripts/               Verification + marketing-capture tooling
```

Internal boundaries are the future monorepo package seams — nothing crosses
them except through exported functions (ARCHITECTURE.md "Shape").

## Naming conventions

| Thing | Convention | Example |
|---|---|---|
| Files/modules | kebab-case | `src/lib/fleet-health.ts`, `status-colors.ts` |
| Components | PascalCase exports in kebab-case files | `Drawer` in `ui/drawer.tsx` |
| Permission keys | dot-namespaced `noun.verb` | `dispatch.release`, `settings.manage` |
| Audit actions | dot-namespaced verb | `dispatch.close`, `platform.impersonation_start` |
| Domain events | `noun.past-tense` | `flight.closed`, `aircraft.grounded` |
| Prisma models | PascalCase; enums SCREAMING_SNAKE | `AuditLog`, `WEATHER_CANCELLED` |
| Cookies | `aerops-` prefix | `aerops-location`, `aerops-impersonation` |
| API keys | `aero_` prefix, stored as sha256 hash | `apiKeySession` in `src/lib/session.ts` |
| Env vars | SCREAMING_SNAKE | `AUTH_SECRET`, `DATABASE_URL` |
| Migrations | named, descriptive | `npx prisma migrate dev --name add_email_tokens` |

## Component design philosophy

- **Components render; engines compute.** Business logic never lives in a
  component or route — if a computation appears in two places it becomes a
  `src/lib` function (`computeOrgHealth` is the canonical refactor).
- Extend `src/components/ui` primitives; a second copy of anything becomes
  a shared component (CONSTITUTION.md conventions).
- Brand marks come only from `src/components/brand/logo.tsx`.
- `ui/drawer.tsx` is the reference interactive primitive: focus trap, ESC
  to close, focus restore, `role="dialog"` + `aria-modal`.
- Loading, empty, and error states are part of the feature, not follow-ups.
- Never hardcode a role check in a component — gate from
  `session.permissions` via `SECTION_PERMISSIONS` (`src/lib/rbac.ts`,
  constitution-tested).

## State management

- **Server components + minimal client state.** No state library exists in
  the codebase — verified by grep: no zustand, redux, jotai, recoil,
  react-query, or swr in `src/` or `package.json`. Keep it that way unless
  an architect-level decision says otherwise.
- Server components fetch through lib engines; client components hold only
  local UI state (`useState`/`useRef`) and re-fetch via route handlers.
- Cross-cutting client prefs live in cookies/localStorage with `aerops-`
  keys (theme, sidebar, active location) — read once at boot
  (`src/app/layout.tsx` theme init).
- Real-time is SSE from one snapshot builder (`src/lib/mission-control.ts`);
  no widget polls independently.

## Styling rules

- Tailwind 4 with **design tokens only** — semantic tokens (`bg-primary`,
  `text-muted-foreground`, `bg-sidebar`) and brand tokens
  (`text-brand-sky`) defined in `src/app/globals.css`. **Never raw hex in
  components**; change brand in `:root`, everywhere else consumes tokens.
- Status colors come exclusively from `src/lib/status-colors.ts` —
  `STATUS_TONE` is defined exactly once (constitution-tested) and meanings
  never change. Its `hex` values exist solely for SVG/calendar surfaces
  where CSS classes can't reach.
- Both themes always: every surface styled for light and dark (`.dark`
  token block); light/dark parity is do-not-break rule 7.
- Tone: aviation-professional, enterprise-calm. No flashy gradients or
  trendy effects.
- Print is a first-class surface: the marketing site doubles as
  presentation material (`@media print` block in `globals.css`); refresh
  screenshots with `node scripts/capture-marketing.mjs` after UI changes.

## Accessibility standards

- WCAG AA contrast in both themes (status hexes keep ≥3:1 against their
  surface — `src/lib/status-colors.ts`).
- Everything keyboard reachable: ⌘K command palette, `[` sidebar toggle,
  focus-trapped drawers with ESC + focus restore (`ui/drawer.tsx`).
- `prefers-reduced-motion` honored globally (`globals.css` reduces all
  animation/transition durations to 0.01 ms).
- Visible focus outlines (`--ring` token; see the FullCalendar bridge's
  `:focus` rule).
- Dialogs carry `role="dialog"`, `aria-modal`, `aria-label`.
- Automated a11y checks in CI **(aspirational — not yet enforced)**.

## Responsive design rules

- Every page works on desktop, tablet, and mobile. Grids start
  single-column: base `grid-cols-1` track, columns added at breakpoints
  (CONSTITUTION.md conventions).
- Mobile/tablet get the bottom navigation bar below `lg`; the sidebar is
  desktop-only, collapses to icons via `html[data-sidebar="collapsed"]`
  (`globals.css`), and must **always remain reopenable** (edge handle + `[`)
  — do-not-break rule 7.
- Viewport is `viewportFit: "cover"` PWA-ready (`src/app/layout.tsx`);
  wide content scrolls in its own container, never the page.

## Database workflow

1. Schema change → **named migration**: `npx prisma migrate dev --name x`.
2. **Additive-only within a release** — no destructive change in the same
   release as the code that stops using it; this keeps app rollback always
   safe (PRODUCTION.md §7.43).
3. Every org-owned table: `organizationId` + scoped indexes + `createdAt`;
   `updatedAt`/`deletedAt` where lifecycle matters. Soft-delete where
   recovery matters.
4. Money is `Decimal`, never float. Wherever money moves or multiple rows
   must agree: `db.$transaction` (dispatch closeout atomicity is
   do-not-break rule 5).
5. Mind FK actions: instructor-linked records are RESTRICT — deletion
   helpers order children first (`src/lib/org-snapshot.ts` is the canonical
   wipe order).
6. Reseed with `npm run seed` (TRUNCATE CASCADE — wipes runtime-created
   rows). The dev seed never runs in production.

## API workflow

Every route follows the same shape: **validate (zod) → authorize → call an
engine → audit → emit** (thin routes, ARCHITECTURE.md rule 3).

- Gate through `authorize(permission, {mutating})` /
  `authorizePlatform(roles)` — no exceptions; new routes must pass the
  constitution scan, and PUBLIC / SELF_SERVICE catalog entries require a
  written reason in `tests/constitution.test.ts`.
- Org scope from the session, never the client.
- Domain events through `emitDomainEvent` only; `emitWebhook` never outside
  `src/lib` (constitution-tested).
- External surface is `/api/v1/*` (rewrite in `next.config.ts`); SemVer —
  breaking changes fork `/api/v2`, never mutate v1.
- Rate-limit public/auth endpoints via `src/lib/rate-limit.ts`.
- Meaningful error strings that tell the caller what to do next.

## Pull request expectations

A PR is one deployable slice. Before it opens, the merge checklist
(CONSTITUTION.md) holds: tests green · build green · permissions exercised
(denial paths, not just happy paths) · tenant isolation checked for new
queries · migration reviewed · events emitted · Mission Control snapshot
considered · mobile + dark mode viewed · docs updated · deferrals recorded.
PR descriptions record the verification actually performed (real requests,
screenshots) — never claim verification you didn't perform. CI as a merge
gate **(aspirational — no `.github/workflows` exists yet; PRODUCTION.md
§13.5 lands it day one of Phase A)**.

## Code review process

- Features pass the **AI Review Board** ([AI_REVIEW_BOARD.md](./AI_REVIEW_BOARD.md),
  being written in parallel with this handbook): a feature is not complete
  until it passes all 8 reviewers.
- Role-based review flow (CLAUDE.md "Engineering roles"): architect scopes →
  engineer builds → qa-engineer + security-reviewer in parallel →
  docs-engineer → production-reviewer before release-sized merges. Don't
  ceremonialize small fixes — a typo doesn't need a committee.
- Security review is mandatory for auth/tenancy changes and any new public
  or self-service route.
- Reviewers hold the "conventions" tier of the constitution (the rules not
  yet machine-enforced): DB column standards, UI parity, component reuse.

## Testing philosophy

- `npm test` green before **any** commit. The suite is DB-free and
  sub-second: engine contracts, constitution compliance, security
  (TOTP/password/rate-limit/RBAC), weather single-source, import parsing
  (`tests/`).
- **New engine → new contract test.** Tests pin explainability: factors
  must sum to the score delta.
- Architecture rules are tests, not prose: `tests/constitution.test.ts`
  fails the build on an ungated route, a bypassed event bus, unmapped nav,
  or a second `STATUS_TONE`.
- Routes are verified against the running app (`npm start -- -p 3100`):
  real requests **including denial and cross-tenant paths**; Playwright +
  screenshots for UI. Verify page gating by content markers, not status
  codes.
- Fix the code, not the test — unless the contract truly changed, and say
  so explicitly when it did (do-not-break rule 10).

## Git strategy

- The repo root (`humanizer/`) is an **umbrella**; the project is
  `aerops/`. Run `git` from the root, `npm`/`npx` from `aerops/`.
- Trunk-based: `main` is the default branch; feature work lands on
  short-lived branches and merges back. No develop/GitFlow layer.
- Commit style: **imperative subject + body explaining why** (see
  `git log` — e.g. "Add Import Center, unify weather source…"). State in
  the commit message when you rewrote a working system and why.
- Small slices, each deployable; push to the designated branch at session
  end (CLAUDE.md §12.8).

## Branch naming

- Current flow: feature work on `claude/*` branches (e.g.
  `claude/aerops-flight-school-lerio6`) merged to `main`.
- Human-authored branches: short kebab-case topic names. A
  `type/topic` convention (`feat/`, `fix/`, `docs/`) **(aspirational — not
  yet enforced)**.
- Never commit directly to `main` for feature work.

## Release process

Per PRODUCTION.md §7/§9 — the deploy pipeline itself is
**(aspirational — nothing is provisioned yet; do not deploy unless
explicitly asked)**:

1. PR → CI green (`npm ci && npm test && npm run build`) → Vercel preview
   review.
2. Merge to `main`.
3. `prisma migrate deploy` **before** promoting the deploy (§7.42).
4. Deploy → post-deploy Playwright smoke (sign-in → dashboard → book).
5. Update ROADMAP.md ("Last session update" + statuses).

Versioning: **CalVer for the app** (`2026.07`), **SemVer for the public
API** (`/api/v1` frozen; breaking = `/api/v2`). Rollback: instant app
rollback is always DB-safe because migrations are additive-only.

## Hotfix process

Identical to the release path, minus ceremony (PRODUCTION.md §9.52): branch
→ fix → tests + build green → merge → migrate (if any — still additive-only)
→ deploy → smoke. No process skips the constitution tests, the audit trail,
or the additive-migration rule — "hotfix" is a speed setting, not a
permission slip. **(aspirational in its deploy steps — no production
environment exists yet.)**

## Documentation requirements

**Docs are part of the feature; stale docs are bugs.** When a slice lands:

| Doc | Update when |
|---|---|
| `ROADMAP.md` | Every slice: statuses + "Last session update" line |
| `ARCHITECTURE.md` | The architecture moves; new `src/lib` engine → new engine-table entry |
| `CLAUDE.md` | A durable rule or workflow changes — keep it tight, no narration |
| `README.md` | The "how to run it" door: quick start, demo logins, feature map |
| `PRODUCTION.md` | Launch-plan deltas, checklist ticks |
| This handbook / SECURITY_STANDARDS | A standard itself changes |

Never document behavior you haven't confirmed in the code. Record honest
deferrals ("Known limitations") instead of taking undocumented shortcuts.

## Related documents

- [CONSTITUTION.md](../../CONSTITUTION.md) — the enforced engineering rules
- [ARCHITECTURE.md](../../ARCHITECTURE.md) — system shape, engines, event bus
- [SECURITY_STANDARDS.md](../architecture/SECURITY_STANDARDS.md) — security posture and OWASP mapping
- [AI_REVIEW_BOARD.md](./AI_REVIEW_BOARD.md) — the 8-reviewer feature gate
- [PRODUCTION.md](../../PRODUCTION.md) — launch plan, release/rollback detail
- [CLAUDE.md](../../CLAUDE.md) — session-start operating system
