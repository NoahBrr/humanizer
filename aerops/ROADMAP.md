# AeroOps Roadmap — Living Product Backlog

The single source of truth for where AeroOps stands and what gets built next.
Companion to [ARCHITECTURE.md](./ARCHITECTURE.md) (how to build),
[PRODUCTION.md](./PRODUCTION.md) (how to launch), and the [README](./README.md)
(how to run). **Update this file after every major development session.**

**Statuses:** `Complete` · `In Progress` · `Not Started` · `Blocked` · `Needs Review`
**Priorities:** `Critical` · `High` · `Medium` · `Low` · `Future`
**Effort:** S (≤1 day) · M (days) · L (week+) · XL (multi-week)

_Last session update: 2026-07-07 — Claude Code operating system (CLAUDE.md
rewrite + 8 role subagents in `.claude/agents/`) and marketing/print visual
refresh: all 16 screenshots recaptured from the latest UI, Import Center added
to the product tour, `@media print` styles, in-repo capture script
(`scripts/capture-marketing.mjs`), stale boilerplate assets removed._

---

## Public Website

| Item | Status | Priority | Effort | Notes |
|---|---|---|---|---|
| Marketing shell (header/footer/nav, brand system) | Complete | — | — | `(marketing)` route group, separate from app |
| Homepage with 13-workspace product tour (real screenshots) | Complete | — | — | Screenshots regenerate via capture script after UI changes |
| /features, /solutions (+6 verticals), /pricing, /about, /contact, /demo | Complete | — | — | Solutions catalog in `components/marketing/solutions-data.ts` |
| Demo/contact intake → Founder Platform | Complete | — | — | `DemoRequest` model, rate-limited public API |
| SEO pass (sitemap.xml, robots.txt, OG images, structured data) | Not Started | High | S | Before public beta |
| Screenshot refresh automation in CI | Not Started | Medium | S | Re-run capture script on release |
| Blog / changelog | Not Started | Low | M | Content strategy needed |

## Navigation

| Item | Status | Priority | Effort | Notes |
|---|---|---|---|---|
| Permission-mapped sidebar (constitution-tested) | Complete | — | — | `NAV_ITEMS` ⊆ `SECTION_PERMISSIONS` enforced by tests |
| Collapsible sidebar that can't get stuck (edge handle, `[` shortcut, tooltips, persisted) | Complete | — | — | Phase 1 fix |
| Mobile bottom navigation + "More" sheet | Complete | — | — | |
| Command palette (⌘K) | Complete | — | — | |
| Per-user pinned/reordered nav items | Not Started | Low | M | |

## Onboarding

| Item | Status | Priority | Effort | Notes |
|---|---|---|---|---|
| Public sign-up → individual accounts (org-less users) | Complete | — | — | `User.organizationId` nullable; session kind `individual` |
| /welcome chooser + pending request tracking | Complete | — | — | |
| Self-serve create-company wizard (business activities → modules) | Complete | — | — | Creator becomes owner; Starter plan |
| Join requests (search, request, admin approve/reject/more-info) | Complete | — | — | `/settings/join-requests`, audited |
| Shareable invite links (role, expiry, max uses, auto-approve) | Complete | — | — | `/join/<token>` |
| Email verification on sign-up | Not Started | Critical | M | Blocked on email provider (see Production Deployment) |
| Self-serve password reset | Not Started | Critical | M | Blocked on email provider |
| Guided in-app setup checklist for new orgs | Not Started | High | M | "Add aircraft → invite team → first booking" |
| Import prompt inside the create-company wizard | Not Started | Medium | S | Link wizard → Import Center |

## Weather Consistency

| Item | Status | Priority | Effort | Notes |
|---|---|---|---|---|
| Single source of truth (`lib/weather.ts`) keyed to active org + active location | Complete | — | — | Top bar, dashboard, operations, Mission Control all consume it |
| Hardcoded airports/METAR strings removed, regression-tested | Complete | — | — | `tests/weather.test.ts` statically forbids them |
| Live METAR/TAF adapter (Aviation Weather API) | Not Started | High | M | Consumers unchanged — swap generator for fetcher + cache |
| TAF-based scheduling risk hints | Not Started | Medium | M | Depends on live adapter |

## Import Center

| Item | Status | Priority | Effort | Notes |
|---|---|---|---|---|
| `/import` wizard: source → type → upload/paste → preview → map → validate → test → commit → summary | Complete | — | — | 9 sources incl. Flight Circle / FSP / FlightLogger / Aviatize / QuickBooks / Stripe presets |
| 12 data types: students, members, instructors, aircraft (+Hobbs/Tach/rates), locations, lesson types, schedule & flight history, maintenance/work orders, squawks, invoices (+payments/balances), CRM leads (+discovery flights), parts/inventory (+vendors field) | Complete | — | — | Spec-driven: `lib/import/spec.ts` |
| CSV / Excel (.xlsx) / copy-paste parsing with limits (5 MB / 5,000 rows) | Complete | — | — | exceljs; RFC-4180 CSV |
| Column mapping with per-source aliases + remembered mappings | Complete | — | — | Remembered per (org, source, data type) |
| Duplicate strategies (skip / update / create) + detection by email, tail, invoice #, part #, name+phone, in-file external ID | Complete | — | — | |
| Row-level errors with row numbers, failed-row CSV download, nothing silent | Complete | — | — | |
| Test import = real code path in a rolled-back transaction | Complete | — | — | Dry-run numbers match commit exactly |
| Import history (user, source, file, counts, mapping, errors) + rollback via created-records manifest | Complete | — | — | Updates are irreversible → `ROLLBACK_PARTIAL` |
| Downloadable templates for all 12 types (required/optional, examples, notes) | Complete | — | — | Template↔parser round-trip is tested |
| Platform staff view of all import jobs + rollback | Complete | — | — | `/platform/imports`; staff run customer migrations via impersonated Import Center |
| More data types: endorsements, training records, documents metadata, inspections/components, vendor directory, dues schedules, dispatch closeouts | Not Started | High | M | Same spec pattern; add engine writers |
| Background processing for >5k-row files + progress streaming | Not Started | High | L | Needs queue/worker (see Production); capped with clear messaging today |
| Review-one-by-one duplicate resolution UI | Not Started | Medium | M | Bulk strategies cover most migrations |
| Saved customer migration packages (files + mappings bundle) | Not Started | Medium | M | Founder tooling |

## Founder Platform

| Item | Status | Priority | Effort | Notes |
|---|---|---|---|---|
| Dashboard (orgs, MRR, success metrics, health, demo requests) | Complete | — | — | |
| Organization management (wizard, plans, suspend, modules, notes) | Complete | — | — | |
| Impersonation (signed cookie, read-only mode, audited, customer-notified) | Complete | — | — | |
| Demo Data Generator (8 business templates × 5–500 aircraft) | Complete | — | — | |
| Live Simulation engine (8 scenarios) | Complete | — | — | |
| Organization snapshots (capture/restore) | Complete | — | — | |
| Import jobs oversight + rollback | Complete | — | — | |
| Demo-request pipeline states (assigned, contacted, closed) | Not Started | Medium | S | List-only today |
| Billing operations (Stripe sync, dunning console) | Not Started | High | L | Depends on Payments |

## Payments

| Item | Status | Priority | Effort | Notes |
|---|---|---|---|---|
| In-app invoicing, payments, ledgers, receivables aging | Complete | — | — | Processor not attached (by design, adapter seam) |
| Stripe subscriptions for AeroOps plans (checkout, portal, webhooks) | Not Started | Critical | L | The revenue gate — see PRODUCTION.md |
| Customer-facing card payments on invoices (Stripe Connect) | Not Started | High | XL | Per-org connected accounts; pricing/fees decision needed |
| Dunning + failed-payment handling | Not Started | High | M | After subscriptions |
| QuickBooks Online export/sync | Not Started | Medium | L | Import exists; sync is the ask |

## Database

| Item | Status | Priority | Effort | Notes |
|---|---|---|---|---|
| Multi-tenant schema (60+ models), FK-safe, indexed scheduling axes | Complete | — | — | Prisma 6 (pinned) on PostgreSQL 16 |
| Named migrations, deploy via `prisma migrate deploy` | Complete | — | — | |
| Managed Postgres + point-in-time recovery | Not Started | Critical | S | Neon / Supabase / RDS — PRODUCTION.md compares |
| Connection pooling for serverless (PgBouncer / Prisma Accelerate) | Not Started | Critical | S | Required on Vercel |
| Nightly rollups for platform analytics | Not Started | Medium | M | Customer-success reads flagged as future hot path |
| Retention/sweeper jobs (soft-deleted orgs, old login events) | Not Started | Low | M | |

## Production Deployment

| Item | Status | Priority | Effort | Notes |
|---|---|---|---|---|
| Production readiness plan & audit | Complete | — | — | [PRODUCTION.md](./PRODUCTION.md): infra, security, costs, launch checklist |
| CI pipeline (tests + build on every PR) | Not Started | Critical | S | GitHub Actions; suite runs in <1s |
| Hosting (Vercel) + managed DB + domain/DNS/SSL | Not Started | Critical | M | Step-by-step in PRODUCTION.md |
| Error tracking (Sentry) + uptime monitoring | Not Started | Critical | S | `/api/health` endpoint exists |
| Email provider (Resend/Postmark) + transactional templates | Not Started | Critical | M | Unblocks verification, resets, invites, join/demo notifications |
| Object storage for documents (S3/R2) with signed URLs | Not Started | High | M | Documents are metadata-only today |
| Queue/worker (Inngest / Upstash QStash) | Not Started | High | M | Unblocks big imports, digests, scheduled automations |
| Redis (Upstash) for rate limits + cache | Not Started | High | S | Rate limiter is per-instance in-memory today |
| Docker image for self-host/enterprise | Not Started | Medium | M | Vercel-first |

## Mission Control

| Item | Status | Priority | Effort | Notes |
|---|---|---|---|---|
| Live wall (SSE), scenes, TV mode, intelligence panels | Complete | — | — | |
| Weather panels from the shared weather source | Complete | — | — | Phase 1B |
| Demo Mode via simulation engine | Complete | — | — | Founder-driven |
| Multi-wall layouts per location | Not Started | Low | M | |

## AI

| Item | Status | Priority | Effort | Notes |
|---|---|---|---|---|
| Insight engine with reasons/confidence + NL ask endpoint | Complete | — | — | AI never mutates — constitution rule |
| Live LLM narration (Claude adapter seam) | Blocked | High | S | Needs `ANTHROPIC_API_KEY` in production env |
| LLM-assisted import column mapping | Not Started | Medium | M | Fallback for unrecognizable headers |
| Schedule optimization suggestions | Not Started | Future | XL | |

## Mobile / PWA

| Item | Status | Priority | Effort | Notes |
|---|---|---|---|---|
| Responsive app, bottom nav, installable PWA (manifest, SW, icons) | Complete | — | — | |
| Web push notifications | Not Started | High | M | VAPID keys + fan-out from the notification bus |
| Offline read-cache for the schedule | Not Started | Medium | L | SW exists; needs a data caching strategy |
| Native wrappers (Capacitor) | Not Started | Future | XL | Only if app-store presence matters |

## Marketplace

| Item | Status | Priority | Effort | Notes |
|---|---|---|---|---|
| Public API v1 (scoped keys) + signed webhooks | Complete | — | — | |
| Developer portal (`/settings/developers`) | Complete | — | — | |
| Published TypeScript SDK | Not Started | Medium | M | Generate from route contracts |
| Third-party app marketplace + install flow | Not Started | Future | XL | Module flag already exists |

## Integrations

| Item | Status | Priority | Effort | Notes |
|---|---|---|---|---|
| File imports: Flight Circle, FSP, FlightLogger, Aviatize, QuickBooks, Stripe | Complete | — | — | Import Center source presets |
| Live METAR/TAF | Not Started | High | M | See Weather Consistency |
| Stripe (subscriptions + Connect) | Not Started | Critical | L | See Payments |
| QuickBooks Online sync | Not Started | Medium | L | |
| iCal feeds (per user / per aircraft) | Not Started | Medium | S | High delight, low effort |
| SSO (Google / Microsoft Entra) | Blocked | Medium | S | Built and env-gated; needs OAuth credentials |

## Security

| Item | Status | Priority | Effort | Notes |
|---|---|---|---|---|
| MFA (TOTP), password policy + breach list, session revocation, rate limits | Complete | — | — | |
| Data-driven RBAC, custom roles, single authorize() gate (constitution-tested) | Complete | — | — | |
| Immutable audit trail (org + platform + imports + impersonation) | Complete | — | — | |
| Tenant isolation (org scope from session only, never the client) | Complete | — | — | |
| Production secret management + env separation | Not Started | Critical | S | PRODUCTION.md §Security |
| Distributed rate limiting (Redis-backed) | Not Started | High | S | Per-instance memory today |
| Security headers (CSP, HSTS) + `npm audit` in CI | Not Started | High | S | |
| External penetration test before GA | Not Started | High | M | After beta |
| SOC 2 groundwork | Not Started | Future | XL | Audit trail + RBAC are the foundation |

## Testing

| Item | Status | Priority | Effort | Notes |
|---|---|---|---|---|
| Engine contracts + constitution + security suites | Complete | — | — | 112 tests, sub-second |
| Weather consistency suite | Complete | — | — | Includes static hardcoding guards |
| Import engine suite (parse/map/validate/dedupe/template round-trip) | Complete | — | — | |
| Playwright E2E in CI (sign-up → create org → book → dispatch → invoice) | Not Started | High | M | Verification scripts exist; formalize into CI |
| DB-backed integration tests (import commit/rollback round-trip) | Not Started | Medium | M | Needs a CI test database |
| Load test: scheduling writes + Mission Control SSE fan-out | Not Started | Medium | M | Before the first large tenant |

---

## Future ideas (unprioritized)

- White-label theming per organization (brand color exists; full theme engine later)
- Multi-region deployment & data residency (PRODUCTION.md §Long-Term)
- Examiner/DPE portal for checkride scheduling
- Line-service / fuel-truck dispatch module
- Insurance certificate feeds
- Logbook export in ForeFlight/LogTen formats
- Marketplace revenue share

---

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
seams before horizontal scale-out).
