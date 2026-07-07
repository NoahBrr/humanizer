# AeroOps — Production Launch Plan

The step-by-step plan for taking AeroOps from verified local app to
production SaaS. **This is a plan, not a deployment** — nothing here has been
provisioned. Work items are mirrored in [ROADMAP.md](./ROADMAP.md);
architecture context lives in [docs/architecture/ARCHITECTURE.md](./docs/architecture/ARCHITECTURE.md).

Independently verification-audited on 2026-07-07 against the running
codebase: 112 tests green, lint + production build green, weather
single-source proven by mutation test, one authorization gate, immutable
audit trail, tenant-scoped queries throughout.

**Ground rules until explicitly instructed otherwise:** do not deploy, do
not connect real customers, do not charge cards, do not send production
email. All implementation lands behind env flags that default to today's
behavior.

**Start here:** §13 has the implementation plan for each of the five launch
blockers; §14 is the phase-by-phase checklist (A–F); §15 the sequence and
risks; §16 the environment-variable matrix.

---

## 1. Recommended architecture (v1 — "boring and reversible")

```
Cloudflare DNS/CDN/WAF
        │
   Vercel (Next.js app: marketing + app + platform + API routes)
        │                     │                    │
  Neon Postgres        Upstash Redis          Inngest (queue/cron)
  (+ PgBouncer,        (rate limits,          (imports >5k rows,
   PITR backups)        cache, sessions*)      digests, automations)
        │
  Cloudflare R2 (documents/uploads, signed URLs)
        │
  Resend (email) · Twilio (SMS, later) · Web Push (VAPID)
  Sentry (errors/APM) · BetterStack (uptime) · Stripe (billing)
```

Why this shape: the app is a single Next.js codebase with server components
and API routes — Vercel deploys it with zero platform work; Neon gives
branch databases (preview environments get real, isolated DBs); every vendor
below has a usable free tier, so the stack starts near-free and scales by
sliding a slider, not re-architecting. Everything is swappable: Prisma hides
the DB, the event bus hides the queue, adapters hide email/SMS/storage.

**Self-host alternative** (enterprise ask later): one Docker image (Next.js
standalone) + Postgres + Redis behind Caddy; same env contract.

## 2. Infrastructure

| # | Concern | Recommendation | Notes |
|---|---|---|---|
| 1 | Hosting | **Vercel Pro** | Native Next.js 15, preview deploys per PR, edge network included |
| 2 | Database | **Neon Postgres** (Launch) | Serverless Postgres, PITR, branching for previews; RDS later if steady-state load favors provisioned |
| 3 | CDN | **Cloudflare** in front (DNS proxy) + Vercel edge | Static/marketing cached at edge; WAF + bot rules on /api/auth/* and public forms |
| 4 | File storage | **Cloudflare R2** | Zero egress fees; S3-compatible; documents module gets real uploads via presigned URLs |
| 5 | Object storage | Same R2 buckets: `aerops-documents` (private, signed URLs), `aerops-public` (marketing assets) | Bucket-per-purpose, org-id key prefixes, never public listing |
| 6 | Redis / caching | **Upstash Redis** | Rate limiting (today per-instance memory — must move), weather cache, hot dashboards |
| 7 | Queue | **Inngest** (or Upstash QStash) | Behind `emitDomainEvent`: webhooks, email fan-out, >5k-row imports, nightly rollups |
| 8 | Background workers | Inngest functions (serverless) | No standing worker fleet needed at v1; revisit if import volumes demand it |

## 3. Security

| # | Concern | State today | Production action |
|---|---|---|---|
| 9 | Authentication | NextAuth v5 credentials + TOTP MFA, sessionVersion revocation, login events, OAuth seams (Google/Entra, env-gated) | Set strong `AUTH_SECRET`; enable OAuth creds; add email verification (see §Customer Platform) |
| 10 | Authorization | Single `authorize()`/`authorizePlatform()` gate, data-driven RBAC, custom roles, module gating — constitution-tested | Keep the constitution tests in CI as a merge gate |
| 11 | SSL | n/a locally | Automatic via Vercel/Cloudflare; enforce HSTS (add header), redirect http→https |
| 12 | Environment variables | `.env` local | Vercel envs per stage (dev/preview/prod); no secrets in repo — audit `.env.example` stays placeholder-only |
| 13 | Secret management | — | Vercel encrypted envs now; 1Password/Doppler as the source of truth; rotate `AUTH_SECRET`, DB, and API keys quarterly and on staff changes |
| 14 | API security | Scoped `aero_` keys (hashed at rest), signed webhooks, zod validation everywhere | Publish key-rotation guidance; add per-key rate limits |
| 15 | Rate limiting | In-memory `lib/rate-limit.ts` on auth/public endpoints | Swap store to Upstash Redis (same interface) so limits survive multi-instance |
| 16 | Audit logging | Immutable `AuditLog` with actor/org/IP/UA on every important mutation, platform actions, imports, impersonation | Add retention policy (e.g. 2 years hot, then export to R2) |
| 17 | Backups | — | Neon PITR (7–30 days) + nightly `pg_dump` to R2 with 90-day retention; document restore drill and run it quarterly |
| 18 | Disaster recovery | — | RPO ≤ 15 min (PITR), RTO ≤ 4 h: restore Neon branch → point Vercel env at it → invalidate sessions. Runbook in repo; test twice a year |

Also before beta: security headers (CSP, HSTS, frame-ancestors), `npm audit`
in CI, dependency updates monthly, and an external pen test before GA.

## 4. Customer platform

| # | Concern | State today | Production action |
|---|---|---|---|
| 19 | Stripe subscriptions | Plan catalog in DB; no processor | Stripe Products/Prices mirroring the 4 plans; Checkout for self-serve, Billing Portal for card/plan changes; webhook → `planId` + org status |
| 20 | Payment processing | In-app invoices/ledgers complete | Phase 2: Stripe Connect for customer-facing card payments on invoices |
| 21 | Customer onboarding | Self-serve sign-up → create/join org, invite links, Import Center | Add guided setup checklist; wire onboarding emails |
| 22 | Trial organizations | Starter assigned at self-serve creation | Add `trialEndsAt` + dunning path: 14-day trial → subscribe or read-only |
| 23 | Demo organizations | Demo Data Generator + simulation + snapshots (founder platform) | Auto-expire demo orgs after N days (sweeper job) |
| 24 | Founder platform | Complete (orgs, impersonation, imports, demo tooling, analytics) | Restrict by IP or require MFA for platform roles in production |
| 25 | Admin platform | Same surface; role-gated (FOUNDER/ADMIN/SUPPORT/AUDITOR/BILLING) | — |
| 26 | Email verification | Not built | Token table + verify route (mirror invitation flow); require before org creation |
| 27 | Password reset | Not built (admin-assisted only) | Token + email flow; rate-limited; sessions revoked on reset |
| 28 | MFA | Complete (TOTP, backup path via admin) | Enforce MFA for SCHOOL_ADMIN and all platform staff |

## 5. Communication

| # | Concern | Recommendation |
|---|---|---|
| 29 | Email | **Resend** (or Postmark): verification, resets, invitations, join-request decisions, demo-request acks, invoice sends. React Email templates in-repo; all sends through one `lib/email.ts` adapter with a dev-mode console transport |
| 30 | SMS | **Twilio**, phase 2: booking reminders, weather cancellations. Keep behind the notification bus with per-user opt-in |
| 31 | Push | Web Push (VAPID) from the existing service worker; fan out from the same notification bus |
| 32 | In-app | Complete today (bell, feeds, Mission Control alerts) — becomes the fallback channel for everything above |

## 6. Monitoring

| # | Concern | Recommendation |
|---|---|---|
| 33 | Error logging | **Sentry** (client + server + edge). Wire `lib/logger.ts` errors to Sentry; source maps on deploy |
| 34 | App monitoring | Sentry Performance or Vercel Observability: route latency, slow server actions |
| 35 | DB monitoring | Neon metrics + `pg_stat_statements`; alert on connection saturation and >500 ms p95 queries |
| 36 | Performance | Budgets from ROADMAP (dashboard <2s, schedule <500ms); Lighthouse CI on marketing pages |
| 37 | Uptime | BetterStack/Pingdom on `/api/health` (exists, data-free) + marketing homepage; status page |
| 38 | Health checks | Extend `/api/health` with DB round-trip + queue depth once Inngest lands |

## 7. DevOps

| # | Concern | Plan |
|---|---|---|
| 39 | CI/CD | GitHub Actions: `npm ci && npm test && npm run build` on every PR (suite <1 s); Vercel preview per PR; merge to `main` = production deploy |
| 40 | Docker | `Dockerfile` (Next standalone output) for parity/self-host; not the primary deploy path |
| 41 | Vercel deployment | Project → env vars per stage → `main` = prod. Node runtime for Prisma routes (already the default here) |
| 42 | DB migrations | `prisma migrate deploy` as a release step **before** promoting the deploy (Vercel build hook or GitHub Action step against prod DB) |
| 43 | Rollback | Vercel instant rollback for app code. Migrations: additive-only policy (no destructive change in the same release as code that stops using it) — makes app rollback always safe |
| 44 | Build verification | Already practiced: tests + build + running-app verification; add Playwright smoke (sign-in → dashboard → book) post-deploy |

## 8. Operations

| # | Concern | Plan |
|---|---|---|
| 45 | Domain | `aerops.io` (marketing + app) — single domain keeps cookies/CORS trivial; `api.` alias later if SDKs want it |
| 46 | DNS | Cloudflare; apex + www → Vercel; SPF/DKIM/DMARC records for Resend |
| 47 | Prod env vars | `DATABASE_URL` (pooled), `DIRECT_URL` (migrations), `AUTH_SECRET`, `AUTH_TRUST_HOST`, OAuth ids/secrets, `ANTHROPIC_API_KEY`, Stripe keys + webhook secret, Resend key, R2 keys, Upstash URL/token, Sentry DSN |
| 48 | Prod seed/demo | **No dev seed in prod.** Bootstrap script creates: plan catalog, platform org staff, one demo org via the Demo Data Generator (marked `isDemo`, auto-expiring) |
| 49 | Founder access | Platform staff rows created by bootstrap with forced MFA enrollment on first login; no shared accounts |
| 50 | Support tools | Already strong: impersonation (read-only default, audited, customer-notified), platform notes, audit log, import rollback. Add: Sentry link-out per org, demo-request pipeline states |

## 9. Long-term operations

| # | Concern | Plan |
|---|---|---|
| 51 | Maintenance schedule | Weekly: dependency review, error triage. Monthly: `npm audit` fixes, restore-drill spot check, cost review. Quarterly: secret rotation, DR drill, load re-check |
| 52 | Release process | PR → CI green → preview review → merge → migrate → deploy → post-deploy smoke → update ROADMAP.md. Hotfix path identical, minus ceremony |
| 53 | Versioning | CalVer for the app (`2026.07`), SemVer for the public API (`/api/v1` frozen; breaking changes = `/api/v2`) |
| 54 | Scaling strategy | Order of operations when load arrives: (1) Redis cache for dashboards/Mission Control snapshots, (2) move SSE fan-out to a dedicated channel (Pusher/Ably) past ~500 concurrent walls, (3) Postgres read replica for reports/executive, (4) nightly rollup tables for platform analytics. The 10k-user target needs 1–2 only |
| 55 | Multi-region (future) | Not needed for v1 (US-centric aviation ops). When EU customers arrive: Vercel multi-region functions + Neon read replicas; data residency = second Neon project + org "home region" pin. Revisit at first non-US enterprise deal |

## 10. Estimated costs

**Launch (0–20 orgs):**

| Service | Plan | $/mo |
|---|---|---|
| Vercel | Pro | 20 |
| Neon | Launch | 19 |
| Upstash Redis | Pay-as-you-go | ~5 |
| Cloudflare (DNS/CDN/WAF) + R2 | Free tier + usage | ~5 |
| Resend | Pro | 20 |
| Sentry | Team | 26 |
| BetterStack | Starter | 10 |
| Inngest | Free tier | 0 |
| Domain | — | ~2 |
| **Total** | | **~$107/mo** |

**Growth (~100 orgs / ~5k users):** Vercel ~$60 (usage), Neon Scale ~$70,
Upstash ~$25, R2 ~$15, Resend ~$35, Sentry ~$50, Inngest ~$50, Twilio ~$50 →
**~$350–450/mo**. **Scale (~500 orgs):** ~$1.5–2.5k/mo, dominated by DB and
email/SMS volume — still <2% of revenue at those org counts on current
pricing, which is the number that matters.

## 11. Backup strategy (recommended)

1. Neon PITR window 30 days (restore to any second).
2. Nightly logical `pg_dump` (Inngest cron) → R2, 90-day retention, weekly
   restore-verify job that loads the dump into a scratch branch and row-counts
   key tables.
3. R2 documents bucket: object versioning on; lifecycle to infrequent access
   at 90 days.
4. Quarterly full DR drill against the runbook; log the timing in the repo.

## 12. Security checklist (pre-beta)

- [ ] Strong `AUTH_SECRET`, per-stage envs, secrets out of repo history
- [ ] Redis-backed rate limiting on auth, sign-up, public forms, API keys
- [ ] Security headers: HSTS, CSP, X-Frame-Options/frame-ancestors, referrer-policy
- [ ] MFA enforced for platform staff + org admins
- [ ] Email verification + password reset live
- [ ] `npm audit` + dependency review in CI
- [ ] Backups running + one restore drill completed
- [ ] Impersonation restricted to production platform staff with MFA
- [ ] Webhook signatures verified end-to-end (already implemented — re-verify in prod)
- [ ] External penetration test scheduled before GA


## 13. Implementation plans — the five launch blockers

Detailed plans in the priority order set by the 2026-07-07 verification
audit. **Build order differs from priority order**: 3 → 4 → 5 → 1 → 2
(you need a database and a staging environment before anything else has
somewhere to run). Every plan splits work into *owner* (accounts, DNS,
secrets, money, approvals) and *Claude Code* (all code, always behind env
flags, never touching live keys or production sends).

### 13.1 Email — provider, verification, password reset, invites, notifications

| | |
|---|---|
| **Recommended** | **Resend** (simple API, React-friendly templates, good deliverability). Alternatives: Postmark (best transactional reputation), AWS SES (cheapest, most setup) |
| **Env vars** | `RESEND_API_KEY` · `EMAIL_FROM` (e.g. `AeroOps <no-reply@mail.aerops.io>`) · `EMAIL_REPLY_TO` · `EMAIL_ENABLED` (`false` → console transport, today's behavior) · `APP_BASE_URL` (link generation) |
| **Files** | New `src/lib/email.ts` (single adapter: resend / console / noop) + `src/lib/email-templates/` (verify, reset, invitation, join-request decision, demo-request ack). Changed: `api/auth/register` (issue token + send); new `api/auth/verify-email`, `api/auth/forgot-password`, `api/auth/reset-password`; invitation create route (send on create); join-request decision route; demo-request route; sign-up UI (verify notice); `tests/constitution.test.ts` (catalogue the three new PUBLIC routes with reasons); new `tests/email.test.ts` |
| **DB migration** | Additive `email_tokens`: `User.emailVerifiedAt DateTime?` + model `EmailToken { id, userId, purpose VERIFY_EMAIL\|RESET_PASSWORD, tokenHash @unique, expiresAt, usedAt, createdAt }` — store a SHA-256 hash, never the raw token (tighter than `Invitation.token`, which should migrate to the same pattern later) |
| **Security** | Single-use hashed tokens (verify 24 h, reset 45 min); identical response on forgot-password whether or not the account exists (no enumeration); all three routes rate-limited via `lib/rate-limit.ts`; `sessionVersion++` on successful reset (revokes every session); DKIM/SPF/DMARC on a **mail subdomain** so app-domain reputation is isolated; tokens never logged or written to audit metadata |
| **Testing** | Contract tests: issue → verify → second use fails → expired fails; dev console transport lets e2e read the token from the DB and complete the flow against :3100; unverified user blocked from org creation but not from `/welcome`; constitution scan green |
| **Rollback** | `EMAIL_ENABLED=false` → registration auto-verifies exactly as today, reset link hidden; migration is additive, nothing to unwind |
| **Order** | adapter+templates → migration → verify flow → reset flow → invitation/join/demo sends → enforcement gate **last**, flipped only after staging proof |
| **Owner** | Resend account; add DKIM/SPF/DMARC DNS records; verify domain; choose From/Reply-To; set env vars in Vercel; approve the enforcement flip |
| **Claude Code** | Everything code-side against console transport + Resend *test* key on staging. Never flips production enforcement, never sends production email |

### 13.2 Billing — Stripe subscriptions, checkout, portal, webhooks

| | |
|---|---|
| **Recommended** | **Stripe Billing + hosted Checkout + Customer Portal** — card data never touches AeroOps, and Stripe Connect (customer-facing invoice payments, ROADMAP Phase 2) stays in the same vendor. Alternatives: Paddle / Lemon Squeezy (merchant-of-record handles tax but forecloses Connect) |
| **Env vars** | `STRIPE_SECRET_KEY` · `STRIPE_WEBHOOK_SECRET` · `BILLING_ENFORCEMENT` (`off` \| `warn` \| `enforce`; default `off`). Price IDs live on `SubscriptionPlan` rows, not env |
| **Files** | New `src/lib/stripe.ts` (client + plan-sync helper); new `api/billing/checkout` + `api/billing/portal` (org-admin authorized); new `api/webhooks/stripe` (**PUBLIC route — signature-verified; catalogue in the constitution with a written reason**); org settings → billing page (status, subscribe/manage); platform plans page (sync button, price IDs); platform org detail (subscription status); `scripts/bootstrap-production.ts` (plan catalog); new `tests/billing-webhook.test.ts` |
| **DB migration** | Additive `stripe_billing`: `SubscriptionPlan.stripeProductId/stripePriceId`; `Organization.stripeCustomerId @unique, stripeSubscriptionId, subscriptionStatus (NONE\|TRIALING\|ACTIVE\|PAST_DUE\|CANCELED, default NONE), currentPeriodEnd, trialEndsAt`; model `BillingEvent { id, stripeEventId @unique, type, payload Json, processedAt }` for idempotency + forensic replay |
| **Security** | Reject any webhook that fails `constructEvent` signature verification; idempotency by unique insert on `stripeEventId`; org linkage **only** via `metadata.organizationId` set server-side when the Checkout session is created — never from the client; prices resolved server-side; every subscription state change goes through `recordAudit`; test keys everywhere except the production env |
| **Testing** | Stripe test mode + Stripe CLI (`stripe listen --forward-to localhost:3100/api/webhooks/stripe`): subscribe (4242), upgrade, `payment_failed`, cancel, trial expiry via test clocks; contract tests drive the webhook reducer with fixture payloads (event → org state transition table); duplicate-event test; cross-tenant test (org A cannot open org B's portal) |
| **Rollback** | `BILLING_ENFORCEMENT=off` → app behaves exactly as today (plans informational); webhook route inert without `STRIPE_WEBHOOK_SECRET`; subscriptions cancelable from the Stripe dashboard; migration additive |
| **Order** | migration → lib/stripe + plan sync → webhook reducer + idempotency (fixtures first) → checkout/portal + UI → trial fields/status surfaces → enforcement mode **last**, post-beta decision |
| **Owner** | Stripe account + business verification (**takes days — start in week 1**); create/approve products & prices (test, then live); configure Customer Portal + branding; decide trial length (recommend 14 days) and Stripe Tax; register the production webhook URL; hold live keys until Phase F |
| **Claude Code** | Full implementation and testing in test mode. Never handles live keys, never enables enforcement |

### 13.3 Database — managed Postgres, PITR, pooling

| | |
|---|---|
| **Recommended** | **Neon** — serverless Postgres 16, PITR to any second, and **DB branching**: every preview deployment gets a real isolated database, which is also how staging and restore drills work. Alternatives: Supabase (fine; more platform than needed), AWS RDS (revisit when steady load favors provisioned) |
| **Env vars** | `DATABASE_URL` (pooled `-pooler` host — the app) · `DIRECT_URL` (direct — migrations only) |
| **Files** | `prisma/schema.prisma` (add `directUrl = env("DIRECT_URL")`); `.env.example`; new `scripts/bootstrap-production.ts` (plan catalog + platform staff + nothing else — **the dev seed never runs in prod**); DR runbook section in this file |
| **DB migration** | None structural — `prisma migrate deploy` replays the existing history onto the new instance |
| **Security** | TLS (`sslmode=require`); app uses the pooled URL only; `DIRECT_URL` confined to the migration step (CI/release), not runtime; distinct passwords per environment; platform staff bootstrap forces MFA enrollment on first login |
| **Testing** | Staging branch: migrate deploy + bootstrap + full smoke; **PITR drill**: restore to a branch, point a preview at it, verify row counts (satisfies §11.4); pooling sanity: 50 concurrent dashboard loads without connection exhaustion (Prisma on serverless is the classic failure — the pooled URL is the fix) |
| **Rollback** | PITR restore to a fresh branch + repoint `DATABASE_URL` (RPO ≤ 15 min, RTO ≤ 4 h per §3); keep the old branch until verified; the additive-only migration policy (§7.43) keeps app rollbacks DB-safe |
| **Order** | **First.** Everything else needs a database to point at |
| **Owner** | Neon account/project (region near first customers — US East default); PITR retention 30 days; copy both URLs into Vercel; approve the restore-drill window |
| **Claude Code** | Schema `directUrl`, bootstrap script, migration release step, runbook. Never runs destructive SQL against production |

### 13.4 Hosting — Vercel, domain, DNS/SSL, secrets, environment separation

| | |
|---|---|
| **Recommended** | **Vercel Pro** (native Next 15, preview per PR, instant rollback) + **Cloudflare** DNS (SPF/DKIM records live here; WAF/CDN per §2). Alternative: Railway/Fly single Docker image — the self-host seam (§7.40) |
| **Env vars** | Full matrix in §16, entered per Vercel scope: Development / Preview / Production. `AUTH_SECRET` distinct per scope; `AUTH_TRUST_HOST=true`; `APP_BASE_URL` per scope. **Preview scope points at a Neon branch, never at prod** |
| **Files** | `next.config.ts` (security headers: HSTS, `frame-ancestors 'none'`, nosniff, referrer-policy; CSP in report-only first); new `vercel.json` (region pin); `.env.example` completeness pass; README deploy section. **Vercel "Root Directory" must be `aerops/`** — the repo root is an umbrella |
| **DB migration** | None |
| **Security** | Absolute env separation (the Neon-branch-per-preview pattern makes prod-DB bleed structurally impossible — still audit it); secrets only in Vercel encrypted envs, 1Password/Doppler as source of truth (§3.13); secure cookies automatic on https; HSTS starts with a short max-age; rotating `AUTH_SECRET` logs everyone out — do it deliberately, not accidentally |
| **Testing** | Staging deploy: full smoke (sign-up → org → book → dispatch → invoice → import → platform login → marketing pages); securityheaders.com scan; SSL + cookie-flag audit; explicit check that no preview env carries the prod `DATABASE_URL` |
| **Rollback** | Vercel instant rollback (previous build stays warm); Cloudflare TTL 300 s during the launch window so DNS can be reverted in minutes |
| **Order** | Immediately after Neon. Staging first; the production project stays dark until Phase E |
| **Owner** | Domain purchase/transfer; Vercel team + repo connect + root directory; Cloudflare zone + nameservers; enter all secrets; approve DNS cutover (Phase F only) |
| **Claude Code** | Headers, `vercel.json`, `.env.example`, runbooks, smoke scripts. Never enters real secrets, never triggers a production deploy |

### 13.5 CI/CD, Sentry, uptime monitoring

| | |
|---|---|
| **Recommended** | **GitHub Actions** (repo already on GitHub; suite is DB-free and sub-second) · **Sentry** (`@sentry/nextjs`, client+server+edge) · **BetterStack** (or UptimeRobot) on `/api/health` |
| **Env vars** | CI: none. Sentry: `SENTRY_DSN` (runtime; absent → all wrappers no-op) · `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` (build-time source maps, GitHub secrets) · `SENTRY_ENVIRONMENT` per scope |
| **Files** | New `.github/workflows/ci.yml` **at the repo root** (`working-directory: aerops`; `npm ci && npm test && npm run build`, `npm audit --audit-level=high`, later a Playwright smoke job against the preview URL); new `aerops/instrumentation.ts` + Sentry config files; `next.config.ts` wrapped with `withSentryConfig` (conditional on DSN); new `src/app/global-error.tsx`; `src/lib/logger.ts` (forward `error` level); `src/app/api/health/route.ts` (add DB round-trip + build version) |
| **DB migration** | None |
| **Security** | `beforeSend` scrubbing — cookies, auth headers, emails stripped; **tenant PII must never land in Sentry**; GitHub secrets least-privilege; pin action versions |
| **Testing** | A deliberately failing PR proves CI blocks merge; thrown test errors (server + client) on staging arrive in Sentry with correct source maps; kill staging → uptime alert fires → restore |
| **Rollback** | Unset `SENTRY_DSN` → no-op; delete the workflow file; monitors are external and read-only |
| **Order** | **CI lands day one** — it needs no infrastructure. Sentry + uptime after staging exists |
| **Owner** | Enable Actions; Sentry org/project + DSN + auth token; BetterStack monitor + alert contacts; decide who gets paged |
| **Claude Code** | Workflow, Sentry wiring behind env checks, health-endpoint extension, alerting runbook |

## 14. Launch checklist — Phases A–F

Tag legend: **(owner)** manual console/DNS/money step · **(claude)** safe to
implement on request · **(both)** paired. Every phase ends with an explicit
exit criterion; no phase starts production traffic. **Hard rule carried from
the session brief: no real customers, no live charges, no production email,
no deploy until each is explicitly instructed.**

### Phase A — Infrastructure Foundation *(blockers 3+4, CI head start · ≈1 week)*

- [ ] A1 (owner) Neon project, PITR 30 d, copy pooled + direct URLs
- [ ] A2 (claude) `directUrl` in schema · `.env.example` matrix · `scripts/bootstrap-production.ts`
- [ ] A3 (claude) GitHub Actions CI (test + build per PR) as merge gate — day one
- [ ] A4 (owner) Vercel team/project, **Root Directory `aerops/`**, staging env vars
- [ ] A5 (owner) domain + Cloudflare zone (no cutover)
- [ ] A6 (claude) security headers + `vercel.json`
- [ ] A7 (both) staging deploy on a Neon branch: `migrate deploy` + bootstrap + smoke
- [ ] A8 (claude) restore-drill runbook · (owner) schedule the drill

**Exit:** staging URL serves AeroOps on an isolated branch DB; CI blocks red PRs.

### Phase B — Auth & Email *(blocker 1 · ≈1 week)*

- [ ] B1 (owner) Resend account, mail-subdomain DNS (DKIM/SPF/DMARC), domain verified
- [ ] B2 (claude) `lib/email.ts` adapter + templates (console transport default)
- [ ] B3 (claude) `email_tokens` migration + verify-email flow
- [ ] B4 (claude) forgot/reset-password flow + session revocation on reset
- [ ] B5 (claude) invitation / join-request / demo-request sends through the adapter
- [ ] B6 (both) staging round-trip with the Resend **test** key
- [ ] B7 (owner) approve enforcement flip on staging → (claude) flip + regression pass

**Exit:** on staging, new sign-ups must verify; resets work; invites deliver.

### Phase C — Billing *(blocker 2 · ≈1–2 weeks, overlaps D)*

- [ ] C1 (owner) Stripe account + business verification — **start during Phase A**
- [ ] C2 (claude) `stripe_billing` migration + `lib/stripe.ts` + plan sync
- [ ] C3 (claude) webhook reducer + `BillingEvent` idempotency + fixture tests
- [ ] C4 (claude) checkout/portal routes + org billing settings UI
- [ ] C5 (owner) test-mode products/prices; Customer Portal + branding config
- [ ] C6 (both) staging E2E: subscribe → upgrade → payment-fail → cancel (Stripe CLI + test clocks)
- [ ] C7 (owner) decide trial length + Stripe Tax; **live keys stay unentered until Phase F**

**Exit:** full subscription lifecycle green in test mode; `BILLING_ENFORCEMENT=off`.

### Phase D — Observability & CI hardening *(blocker 5 · ≈3–4 days, overlaps C)*

- [ ] D1 (owner) Sentry org/project · (claude) SDK wiring + PII scrubbing + source maps
- [ ] D2 (claude) `/api/health` DB round-trip · (owner) BetterStack monitor + paging contacts
- [ ] D3 (claude) `npm audit` in CI + Playwright smoke job against the preview URL
- [ ] D4 (both) alarm drill: break staging → Sentry event + uptime page both fire

**Exit:** a staging error pages a human with a readable stack trace within minutes.

### Phase E — Pre-Launch Verification *(≈1 week)*

- [ ] E1 security checklist (§12) executed top-to-bottom, boxes ticked in this file
- [ ] E2 PITR restore drill executed and timed; result recorded (§11.4)
- [ ] E3 Playwright golden path vs staging: sign-up → verify → create org → invite → book → dispatch → invoice → import → rollback
- [ ] E4 denial + cross-tenant sweep re-run against staging (constitution behavior under prod config)
- [ ] E5 load sanity: 50 concurrent users on dashboard/schedule inside ROADMAP p95 budgets
- [ ] E6 headers/SSL/cookies scanned behind the real domain (test subdomain)
- [ ] E7 production project stood up dark: envs entered (live keys still absent), prod DB migrated + bootstrapped, DNS staged at TTL 300
- [ ] E8 rollback rehearsal: deploy → instant rollback → verify
- [ ] E9 owner sign-off recorded here with date

**Exit:** everything a customer touches is proven on staging; production is standing by, dark.

### Phase F — Controlled Beta Launch *(only on explicit instruction, step by step)*

- [ ] F1 (owner) DNS cutover → (both) immediate production smoke
- [ ] F2 (owner) live Stripe keys + production webhook; one live checkout with a real card, immediately refunded, to prove the pipe
- [ ] F3 (owner) enable production email; invite **5–10 friendly operators by hand** — public sign-up stays gated
- [ ] F4 watch week: daily Sentry triage, uptime review, cost review; fix list worked down
- [ ] F5 (owner) decision gate: open public sign-up; `BILLING_ENFORCEMENT` `warn` → `enforce`
- [ ] F6 announce; post-launch cadence per §9 takes over

## 15. Implementation sequence, risks & dependencies

**Calendar shape (≈4 working weeks to "production standing by, dark"):**

| Week | Work |
|---|---|
| 1 | Phase A (Neon → staging Vercel → CI day one) · **C1 Stripe verification submitted** |
| 2 | Phase B (email flows on staging) |
| 3 | Phase C + Phase D in parallel (billing test-mode; Sentry/uptime) |
| 4 | Phase E (verification week) → **stop** — Phase F waits for explicit instruction |

**Critical path:** Neon → staging → email → Phase E. Stripe is *off* the
critical path: a beta can launch free/trial-only and flip enforcement later.

**Dependencies:** B needs A (staging + DNS for DKIM). C needs A (staging,
webhook URL) + C1 lead time. D needs A (somewhere to monitor). E needs B+C+D.
F needs E + owner sign-off. CI (A3) depends on nothing — first thing to land.

| Risk | Mitigation |
|---|---|
| Stripe business verification takes days–weeks | Submit in week 1 (C1); it's async to all code work |
| Email deliverability ramp on a fresh domain | Mail subdomain, DMARC `p=none` first, warm gradually with beta invites before any volume |
| DNS cutover surprises | TTL 300 during launch; test subdomain proven in E6; revert path is a nameserver record |
| Preview env accidentally reaches prod DB | Neon branch-per-preview makes it structural; E-phase env audit double-checks |
| Serverless Prisma connection exhaustion | Pooled URL only at runtime; load sanity gate E5; Prisma 6 pin unchanged |
| Secret sprawl / rotation panic | One source of truth (1Password/Doppler); rotation runbook; `AUTH_SECRET` rotation acknowledged as a global logout |
| Solo-operator bus factor | Every owner console step gets recorded in the runbook as performed, so it's reproducible |

## 16. Environment variable matrix

| Variable | Needed from | Stage | Secret | Purpose |
|---|---|---|---|---|
| `DATABASE_URL` | Phase A | all (per-stage values) | yes | Pooled Postgres URL (runtime) |
| `DIRECT_URL` | Phase A | CI/release step only | yes | Direct URL for `migrate deploy` |
| `AUTH_SECRET` | Phase A | all, distinct per stage | yes | NextAuth JWT signing |
| `AUTH_TRUST_HOST` | Phase A | all | no | `true` behind Vercel/proxy |
| `APP_BASE_URL` | Phase A | all | no | Absolute links (emails, webhooks) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional | prod | yes | OAuth seam (already env-gated) |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | optional | prod | yes | OAuth seam (already env-gated) |
| `ANTHROPIC_API_KEY` | optional | prod | yes | Live LLM narration seam |
| `RESEND_API_KEY` | Phase B | preview (test key) / prod | yes | Email adapter |
| `EMAIL_FROM` / `EMAIL_REPLY_TO` | Phase B | preview / prod | no | Sender identity |
| `EMAIL_ENABLED` | Phase B | all | no | `false` = console transport (rollback lever) |
| `STRIPE_SECRET_KEY` | Phase C | preview (test) / prod (live, Phase F) | yes | Billing API |
| `STRIPE_WEBHOOK_SECRET` | Phase C | preview / prod | yes | Webhook signature verification |
| `BILLING_ENFORCEMENT` | Phase C | all | no | `off` \| `warn` \| `enforce` (rollback lever) |
| `SENTRY_DSN` / `SENTRY_ENVIRONMENT` | Phase D | preview / prod | no | Error tracking (absent = no-op) |
| `SENTRY_AUTH_TOKEN` + org/project | Phase D | CI only | yes | Source-map upload |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | post-launch | prod | yes | Distributed rate limiting (ROADMAP) |
| `R2_*` (account, key, secret, buckets) | post-launch | prod | yes | Document uploads (ROADMAP) |

Variables marked *post-launch* have no consumers in code yet — they land with
their ROADMAP items and follow the same flag-off-by-default pattern.
