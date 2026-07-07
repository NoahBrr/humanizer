# AeroOps Engineering Constitution

The standards every engineer, AI coding assistant, and contributor follows.
Companions:
[docs/architecture/ARCHITECTURE.md](./docs/architecture/ARCHITECTURE.md)
(how the system is built), the standards library
([API](./docs/architecture/API_STANDARDS.md) ·
[database](./docs/architecture/DATABASE_STANDARDS.md) ·
[security](./docs/architecture/SECURITY_STANDARDS.md) ·
[handbook](./docs/engineering/ENGINEERING_HANDBOOK.md) ·
[review board](./docs/engineering/AI_REVIEW_BOARD.md)),
[ROADMAP.md](./ROADMAP.md) (what gets built when), and
[PRODUCTION.md](./PRODUCTION.md) (how it launches). Start every development
session by reading `CLAUDE.md` — it is the session-start digest of this
document.

Rules marked ⚖ are **enforced by `tests/constitution.test.ts`** — violating
them fails the build, not just the review.

## Philosophy

AeroOps is an aviation *operating system*, not a bundle of scheduling /
maintenance / CRM tools. Think platform first: every feature should
strengthen the engines, the event vocabulary, the API surface, and Mission
Control — not just its own page. Write for the engineer reading this in
twenty years; prefer readable over clever; never take an undocumented
shortcut (record it as an honest deferral in [ROADMAP.md](./ROADMAP.md)
instead).

## The enforced rules

1. ⚖ **One authorization gate.** Every API route calls `authorize()` /
   `authorizePlatform()`. Exactly two exception categories exist, each
   allowlisted **with a written reason in `tests/constitution.test.ts`**
   (the test is the authoritative enumeration): public-by-design routes
   (NextAuth, health, registration, invitation accept, pre-auth MFA check,
   demo requests) and self-service routes (own MFA/password/sessions, org
   create/join/search, waitlist, invite-link redemption), which must still
   session-guard and 401.
2. ⚖ **Never bypass the event bus.** `emitWebhook` is called only inside
   `src/lib`; domain code emits through `emitDomainEvent`. The event
   vocabulary must not drift from reality: every registered event must have
   a live emit site.
3. ⚖ **Navigation is permission-mapped.** Every nav item has a
   `SECTION_PERMISSIONS` entry; UI, server pages, and APIs gate from the same
   permission set. Never hardcode a role check in a component.
4. ⚖ **Canonical status colors.** One `STATUS_TONE` map, one file
   (`src/lib/status-colors.ts`), meanings frozen — the
   [design system](./docs/design/DESIGN_SYSTEM.md) documents them. New
   states get new entries; existing meanings never change.
5. **Business logic lives in `src/lib`.** Routes authorize, validate (zod),
   call an engine, audit, emit — pipeline per
   [API_STANDARDS.md](./docs/architecture/API_STANDARDS.md). Components
   render. If a computation appears
   in two places, it becomes a lib function (see `computeOrgHealth` — that
   refactor is the pattern).
6. **Explainable engines.** Computed answers ship with their reasons —
   factors, basis, confidence. The test suite pins this (fleet-health factors
   must sum to the score delta).
7. **Org scoping comes from the session**, never from client input. Every
   mutation is audited. Soft-delete where recovery matters; never
   hard-delete customer data unbidden.
8. **AI never mutates.** Dispatch, maintenance approval, payments, deletion
   always require a human through the permissioned APIs.

## Conventions (reviewed, not yet machine-enforced)

- **Database**: every org-owned table carries `organizationId` + scoped
  indexes and `createdAt`; add `updatedAt`/`deletedAt` where lifecycle
  matters. `createdBy`/`updatedBy` are satisfied today by the audit log
  rather than columns — a documented shortcut; revisit if row-level
  provenance becomes a query need.
- **UI**: every page works on desktop/tablet/mobile (base grid track +
  responsive columns — the `grid-cols-1` rule), in both themes, keyboard
  reachable (⌘K palette, focus-trapped drawers), WCAG AA contrast.
- **Components**: extend `src/components/ui` primitives; a second copy of
  anything becomes a shared component.
- **APIs**: REST now, versioned under `/api/v1` for external consumers;
  meaningful error strings that tell the caller what to do next.
- **TypeScript strict**; zod at every boundary; small functions with
  meaningful names.

## AI development rules (Claude Code and any assistant)

1. Read `CLAUDE.md`, then the relevant engine in `src/lib`, before writing.
2. Extend existing modules; never rewrite a working system without stating
   why in the commit message.
3. Match the surrounding idiom — comment density, naming, response shapes.
4. Update ARCHITECTURE.md / ROADMAP.md when the architecture moves.
5. Verify against the running app; screenshots for UI, real requests for
   APIs, and record honest deferrals.

## Merge checklist

Tests green (`npm test`) · build green (`npm run build`) · permissions
exercised (denial paths, not just happy paths) · tenant isolation checked
for new queries · migration reviewed · events emitted for anything another
system would care about · Mission Control snapshot considered · mobile +
dark mode viewed · docs updated · deferrals recorded.
