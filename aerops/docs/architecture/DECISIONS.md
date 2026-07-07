# AeroOps Architecture Decision Records

Every major engineering decision, recorded so future work (human or AI)
understands *why* the system is shaped this way before changing it.
**Check this log before altering an existing pattern**; changing a decided
pattern requires a new ADR that supersedes the old one, not a silent edit.

Format: Decision · Date · Context · Alternatives considered · Why selected ·
Risks · Reconsider when. Statuses: **Accepted** · Superseded (→ ADR-n).

---

## ADR-001 — Single Next.js App Router monolith for all five surfaces

**Date:** 2026-07 · **Status:** Accepted

- **Context:** AeroOps needs a marketing site, auth, tenant app, internal
  platform portal, Mission Control, and a REST API — built by a tiny team.
- **Alternatives:** separate marketing repo (Astro/Webflow) + app repo;
  monorepo with split services; separate admin app.
- **Why:** one deployable, one design-token system, one auth stack, zero
  cross-repo drift. Route groups (`(marketing)`, `(app)`, `/platform`) give
  hard layout/data separation inside one codebase; `src/lib` engine
  boundaries are the future package seams.
- **Risks:** blast radius of a bad deploy spans all surfaces; bundle
  discipline needed so marketing stays light.
- **Reconsider when:** marketing needs a CMS/localization program, or team
  size makes independent deploy cadences valuable.

## ADR-002 — Prisma 6 pinned; never upgrade to 7 without an ADR

**Date:** 2026-07 · **Status:** Accepted

- **Context:** Prisma 7 introduced breaking changes incompatible with this
  codebase's patterns and tooling assumptions.
- **Alternatives:** track latest Prisma; migrate to Drizzle/Kysely.
- **Why:** Prisma 6 is stable, fully sufficient, and the entire migration
  history + client usage is built on it. Upgrading mid-flight risks subtle
  query behavior changes for zero feature gain.
- **Risks:** eventual EOL; missing newer performance features.
- **Reconsider when:** Prisma 6 approaches end-of-support or a needed
  capability (e.g. driver adapters for serverless pooling) is 7-only.

## ADR-003 — JWT sessions (NextAuth v5) with `sessionVersion` revocation

**Date:** 2026-07 · **Status:** Accepted

- **Context:** three user populations (tenant, individual, platform staff)
  need sessions on serverless infrastructure.
- **Alternatives:** DB-backed sessions; Lucia; custom cookies; Clerk/Auth0.
- **Why:** JWT strategy avoids a session-table read per request on
  serverless; `sessionVersion` on the user row restores server-side
  revocation (logout-everywhere, forced logout on reset). NextAuth v5 gives
  battle-tested CSRF handling and OAuth seams for free; no vendor lock-in.
- **Risks:** JWTs live until expiry unless version-checked — every
  authorization pass must compare `sessionVersion` (it does, in
  `getSession()`).
- **2026-07 (Phase 1A):** the pattern was extended to `PlatformUser` —
  platform sessions now verify `isActive` + `sessionVersion` against the
  row on every request (`lib/session-rules.ts`), closing the gap where the
  platform branch trusted the JWT claim alone. Same decision, wider
  enforcement; no supersession.
- **Reconsider when:** sub-second global revocation becomes a compliance
  requirement (→ Redis session store).

## ADR-004 — Separate `PlatformUser` identity table for AeroOps staff

**Date:** 2026-07 · **Status:** Accepted

- **Context:** staff (founder, support, billing, auditors) need cross-tenant
  power that must never be reachable from a tenant account.
- **Alternatives:** `isPlatform` flag / role on `User`; a special "platform
  organization" tenant.
- **Why:** a separate table makes privilege escalation *structural* rather
  than a missing `where` clause: no tenant query can ever return a staff
  identity, and staff roles (FOUNDER … AUDITOR) evolve independently of
  tenant RBAC. (A parallel build attempted the flag approach; the merge
  kept the separate-table design and dropped the flag.)
- **Risks:** two auth paths to maintain; staff need distinct MFA enforcement.
- **Reconsider when:** never lightly — this boundary is do-not-break tier.

## ADR-005 — Machine-enforced constitution instead of convention documents

**Date:** 2026-07 · **Status:** Accepted

- **Context:** AI-assisted development iterates fast; prose conventions rot.
- **Alternatives:** code review checklists; lint rules only; trust.
- **Why:** `tests/constitution.test.ts` statically scans the codebase —
  every route calls `authorize()`, public routes are catalogued with written
  reasons, `emitWebhook` confined to `src/lib`, `STATUS_TONE` defined once,
  nav ⊆ `SECTION_PERMISSIONS`. Violations fail `npm test`, not the review.
  The 2026-07-07 audit mutation-tested the weather rule the same way.
- **Risks:** static scans can be fooled; scans must evolve with new rule
  classes.
- **Reconsider when:** a rule needs runtime context a static scan can't see
  (→ add integration tests, don't drop the scan).

## ADR-006 — Data-driven RBAC with a permission catalog, no hardcoded roles

**Date:** 2026-07 · **Status:** Accepted

- **Context:** eight+ business types need different role shapes; orgs want
  custom roles.
- **Alternatives:** enum role checks in code; per-route role lists; CASL.
- **Why:** `lib/permissions.ts` catalogs permissions; roles are bundles;
  custom org roles are rows. UI, pages, and APIs gate from the same
  `session.permissions` set, so a permission behaves identically everywhere;
  `SECTION_PERMISSIONS` maps nav to permissions and is tested.
- **Risks:** catalog sprawl; permission naming discipline required.
- **Reconsider when:** attribute/relationship-based needs emerge (per-fleet
  or per-location scoping inside an org).

## ADR-007 — Shared-schema row-scoped multi-tenancy, enforced in the engine layer

**Date:** 2026-07 · **Status:** Accepted

- **Context:** flight schools are small tenants; thousands may share the DB.
- **Alternatives:** schema-per-tenant; database-per-tenant; Postgres RLS.
- **Why:** one schema keeps migrations O(1) and cross-tenant platform
  analytics trivial. Scope-from-session (`authorize()` injects
  `organizationId`; client input never does) plus cross-tenant denial tests
  give the isolation RLS would, without RLS's Prisma ergonomics cost and
  dual-source-of-truth policies.
- **Risks:** a missed `organizationId` filter is the classic bug class —
  mitigated by the single-gate pattern, review checklist, and denial tests.
- **Reconsider when:** an enterprise/regulatory customer demands physical
  isolation (→ database-per-tenant for that customer via the same Prisma
  client, or RLS as defense-in-depth).

## ADR-008 — Deterministic simulated weather behind a single source module

**Date:** 2026-07 · **Status:** Accepted

- **Context:** every surface shows weather; live METAR needs an external
  API, but demos/tests need stable, realistic data now.
- **Alternatives:** live API from day one; random values; hardcoded strings
  per page (the pre-audit state that caused inconsistencies).
- **Why:** `lib/weather.ts` generates a deterministic METAR seeded by
  (ICAO, hour) — realistic, varies over time, identical across surfaces,
  test-stable. All consumers key off the active org/location; a static test
  bans hardcoded airports/METAR strings anywhere else. The production
  adapter swaps the generator's internals; consumers never change.
- **Risks:** simulated data must never reach a real customer making
  operational decisions — the live adapter is a launch-blocker-adjacent item
  (ROADMAP High).
- **Reconsider when:** Phase B/C of production work — wire the Aviation
  Weather API behind the same functions.

## ADR-009 — In-process domain event bus with confined webhook emission

**Date:** 2026-07 · **Status:** Accepted

- **Context:** webhooks, automations, notifications, and future analytics
  all react to domain activity.
- **Alternatives:** direct calls at each mutation site; a queue from day one.
- **Why:** `emitDomainEvent` gives one vocabulary and one place to attach
  consumers; subscriber failures are isolated from the emitting operation.
  Constitution tests keep `emitWebhook` inside `src/lib` and require every
  registered event to have a live emit site (no vocabulary drift). In-process
  is sufficient pre-scale; a durable queue (Inngest) slots in behind the
  same function without touching call sites.
- **Risks:** in-process delivery is lost on crash — acceptable for current
  consumers, not for billing-critical events (Stripe webhooks therefore get
  their own idempotency table, PRODUCTION.md §13.2).
- **Reconsider when:** any consumer becomes delivery-critical (→ Inngest).

## ADR-010 — Immutable audit log as a first-class product surface

**Date:** 2026-07 · **Status:** Accepted

- **Context:** aviation operations need regulatory defensibility; platform
  staff powers (impersonation) need accountability.
- **Alternatives:** application logs only; audit columns per table.
- **Why:** one `AuditLog` (actor, org, action, metadata, IP/UA) written via
  `recordAudit` on every important mutation; never rewritten — org snapshot
  restore deliberately preserves audit rows. It doubles as the Mission
  Control command timeline, making the audit trail visible product value,
  which keeps it maintained. `createdBy`/`updatedBy` columns are consciously
  omitted (the log answers provenance) — a documented shortcut.
- **Risks:** log volume growth (→ retention policy, PRODUCTION.md §3.16).
- **Reconsider when:** row-level provenance becomes a *query* need, not an
  investigation need.

## ADR-011 — Dispatch closeout is atomic: meters + ledger + invoice in one transaction

**Date:** 2026-07 · **Status:** Accepted

- **Context:** post-flight closeout updates aircraft meters, the student's
  ledger, and generates the invoice; partial application corrupts money or
  maintenance intervals.
- **Alternatives:** sequential writes with compensation; event-driven
  eventual consistency.
- **Why:** a single `db.$transaction` makes the invariant structural. This
  is do-not-break rule 5 and the reference write path in ARCHITECTURE.md §16.
- **Risks:** transaction breadth grows with closeout features — keep it to
  the money/meter core.
- **Reconsider when:** closeout gains slow external calls (→ move them
  post-commit onto the event bus, never into the transaction).

## ADR-012 — Import engine: dry-run executes the real path inside a rolled-back transaction

**Date:** 2026-07 · **Status:** Accepted

- **Context:** "test import" must predict exactly what a real import does;
  a separate validation path would drift.
- **Alternatives:** validation-only preview; shadow tables.
- **Why:** `runImport({dryRun})` runs the same per-type writers inside
  `db.$transaction` and throws a `DryRunDone` sentinel to roll back — the
  report is real, the writes are not. Committed imports record a
  created-records manifest enabling rollback (children-first deletion);
  updates mark `ROLLBACK_PARTIAL` honestly rather than pretending.
- **Risks:** long transactions on big files → hard caps (5 MB / 5 000 rows)
  until the queue lands (ROADMAP).
- **Reconsider when:** background imports arrive — same writers, chunked,
  per-chunk manifests.

## ADR-013 — Plans and business profiles are data; modules gate by profile

**Date:** 2026-07 · **Status:** Accepted

- **Context:** eight aviation business types need different module sets;
  pricing tiers change without deploys.
- **Alternatives:** build flags per vertical; separate products.
- **Why:** `SubscriptionPlan` rows + `lib/business-profiles.ts` drive
  module enablement per org, checked inside `authorize()` — one codebase
  serves flight schools through corporate flight departments, and sales can
  adjust plans in data.
- **Risks:** combinatorial testing surface — mitigated by profile templates
  in the demo generator.
- **Reconsider when:** per-seat or usage-based pricing (→ extend the plan
  model; Stripe metering).

## ADR-014 — Founder platform gets tenant-lifecycle tooling (demo gen, simulation, snapshots)

**Date:** 2026-07 · **Status:** Accepted

- **Context:** selling an ops platform requires convincing live demos and
  safe experimentation, without polluting real tenants.
- **Alternatives:** a static demo tenant; seeded videos; per-prospect manual setup.
- **Why:** `lib/demo-generator.ts` provisions isolated demo tenants from
  business templates at 5/25/100/500-aircraft scale; `lib/simulation.ts`
  writes live activity (Morning Rush, Weather Event scenarios);
  `lib/org-snapshot.ts` captures/restores tenants with FK-aware wipe order.
  All platform-gated, all audited.
- **Risks:** demo data must be visibly demo (flagging + expiry sweeper is a
  ROADMAP item).
- **Reconsider when:** demo volume needs auto-expiry (planned) or
  region-pinned demo infrastructure.

## ADR-015 — Additive-only migrations within a release

**Date:** 2026-07 · **Status:** Accepted

- **Context:** app rollback (Vercel instant) must always be DB-safe.
- **Alternatives:** free-form migrations; blue-green DB.
- **Why:** if release N only adds columns/tables/indexes, rolling the app
  back to N-1 needs no DB action. Destructive cleanup ships in N+1 after
  nothing references it.
- **Risks:** temporary schema clutter between releases — acceptable.
- **Reconsider when:** never for the policy; individual exceptions require
  an ADR + explicit downtime plan.

## ADR-016 — Marketing visuals are real captured screenshots, regenerated by script

**Date:** 2026-07 · **Status:** Accepted

- **Context:** the marketing site and print/presentation materials must
  show the real product, current.
- **Alternatives:** designed mockups; illustration style.
- **Why:** "real screenshots, not mockups" is the positioning; staleness is
  the failure mode, so regeneration is one command
  (`scripts/capture-marketing.mjs`) and print/PDF output is verified by
  `scripts/verify-print.mjs` (which encodes two Chromium footguns discovered
  in the 2026-07-07 audit).
- **Risks:** screenshots show demo-seed data — curate a showcase org before
  public launch (ROADMAP).
- **Reconsider when:** localization or per-vertical landing pages need
  variant captures.

## ADR-017 — "Boring and reversible" launch infrastructure (Vercel + Neon + adapters behind flags)

**Date:** 2026-07 · **Status:** Accepted

- **Context:** solo-operator launch; every vendor must be swappable and
  near-free at zero scale.
- **Alternatives:** AWS-native (ECS/RDS/SES); Kubernetes; self-host first.
- **Why:** PRODUCTION.md §1: Vercel deploys the monolith with zero platform
  work; Neon branches give real isolated DBs per preview (making prod-DB
  bleed structural nonsense); every integration is an adapter behind an env
  flag that defaults to today's behavior — which is also the rollback story
  (`EMAIL_ENABLED`, `BILLING_ENFORCEMENT`, `SENTRY_DSN` absent = no-op).
- **Risks:** Vercel/Neon pricing at scale — §10 cost model says it stays
  <2 % of revenue through the Scale tier.
- **Reconsider when:** steady-state load favors provisioned (→ RDS), or an
  enterprise self-host deal materializes (→ the Docker seam).

## ADR-018 — Stripe hosted Checkout/Portal; card data never touches AeroOps

**Date:** 2026-07 · **Status:** Accepted (implementation planned, Phase C)

- **Context:** subscription billing is the revenue gate; PCI scope must
  stay minimal.
- **Alternatives:** Stripe Elements in-app; Paddle/Lemon Squeezy
  (merchant-of-record).
- **Why:** hosted pages = SAQ-A PCI posture and zero card handling; Stripe
  keeps one vendor for both subscriptions now and Connect (customer-facing
  invoice payments) later, which merchant-of-record providers foreclose.
  Webhook idempotency via a `BillingEvent` unique-insert table; org linkage
  only via server-set metadata.
- **Risks:** Stripe business verification lead time (mitigated: submit week
  1); tax handling decision owned by the founder.
- **Reconsider when:** international tax complexity outgrows Stripe Tax.

## ADR-019 — Governance docs are versioned in-repo and machine-referenced (this system)

**Date:** 2026-07 · **Status:** Accepted

- **Context:** development is AI-assisted across many sessions; knowledge
  must persist in the repo, not in chat history.
- **Alternatives:** wiki/Notion; README sprawl; rely on CLAUDE.md alone.
- **Why:** `docs/{architecture,engineering,aviation}` + CLAUDE.md as the
  session-start index; the AI Review Board defines completion gates; ADRs
  make pattern changes deliberate. Docs live next to code so a PR that moves
  architecture carries its own documentation diff (reviewable, revertable).
- **Risks:** doc rot — countered by the Documentation Reviewer gate and the
  "docs are part of the feature" rule.
- **Reconsider when:** the org grows real (human) process tooling.

## ADR-020 — All bearer tokens stored as one-way sha256 hashes, raw shown once

**Date:** 2026-07 (Phase 1B) · **Status:** Accepted

- **Context:** API keys were already hashed (`keyHash`), but invitation and
  invite-link tokens were stored **raw** (`token String @unique`). A database
  read — backup leak, SQL injection, insider — handed out working
  account-creation and org-join credentials.
- **Alternatives:** encrypt-at-rest (reversible — still yields plaintext to
  anyone with the key; needed only if the raw value must be recovered);
  selector/verifier split (extra column, no benefit over hash-lookup here);
  leave invite links raw because they're "semi-public" (rejected — auto-approve
  links attach members directly; defense-in-depth applies).
- **Why:** one policy for every token the platform issues — store only
  `sha256(raw)` via `lib/tokens.ts`, show the raw value once, look up by
  hashing the presented token. Consistent with the existing API-key path,
  cheap per-request (fast hash, high-entropy token needs no bcrypt/salt),
  and machine-enforced (`tests/token-security.test.ts`).
- **Consequences / trade-offs:** hashing is one-way, so an invite link can no
  longer be re-displayed to the admin after creation — the settings UI moved
  to a one-time reveal + create-new-to-reshare (the redeemer's `/join/<token>`
  experience is unchanged). `Webhook.secret` stays raw as a documented
  exception: it is a signing key the delivery path must re-read to HMAC each
  attempt, not a bearer token. Impersonation/session tokens are signed-not-
  stored (ADR-003), so they're already covered.
- **Migration:** in-place backfill (`sha256(convert_to(token,'UTF8'))`,
  byte-identical to `lib/tokens.ts`) then drop the raw column, so existing
  links keep working — no invalidation. This drops a column in the **same
  release** as the consuming-code change, a deliberate exception to ADR-015's
  additive-only rule, permitted **only because AeroOps is pre-production**
  (no deployed release, no N-1 to break; ADR-015 allows exceptions with an
  ADR — this is it). Consequences to honor going forward:
  - **Roll-forward only.** Reverting the app past this commit would leave the
    code reading a `token` column that no longer exists → runtime failure.
    There is no down-migration and none is reconstructable (hashes are
    one-way). A future revert requires a forward-fix, not an instant rollback.
  - **Post-launch, this pattern must be two-phase** (add + dual-read →
    backfill → drop one release later), per ADR-015.
  - **If ever run against real tokens**, `DROP COLUMN` leaves plaintext in
    dead tuples/WAL/backups until `VACUUM FULL` + backup rotation; for real
    data, rotate the affected tokens instead of relying on the drop.
- **Risks:** sha256 (not bcrypt) is correct only because these tokens carry
  ≥192 bits of entropy; a future *low-entropy* token type must not reuse this
  helper without a KDF. Reconsider when email verification / password reset
  tokens land (Phase B) — they use the same hashed-single-use pattern
  (already the plan, PRODUCTION.md §13.1).

---

**Adding an ADR:** copy the format, take the next number, link any ADR it
supersedes, and update [ARCHITECTURE.md](./ARCHITECTURE.md) in the same PR.
