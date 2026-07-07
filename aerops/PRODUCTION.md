# AeroOps — Production Readiness Plan

A complete, step-by-step plan for taking AeroOps from local development to a
production SaaS platform. **This is a plan, not a deployment** — nothing here
has been provisioned. Work items are mirrored in [ROADMAP.md](./ROADMAP.md);
architecture context lives in [ARCHITECTURE.md](./ARCHITECTURE.md).

Audited on 2026-07-07 against the running codebase: 112 tests green,
production build green, all app routes dynamic (no stale prerendering), one
authorization gate, immutable audit trail, tenant-scoped queries throughout.

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

## 13. Launch checklist (step-by-step)

**Phase A — Foundations (≈1 week)**
1. GitHub Actions CI (test + build + audit) as merge gate
2. Provision Neon (prod + preview branches), set pooled/direct URLs
3. Vercel project + domain + Cloudflare DNS/SSL
4. Sentry + BetterStack on `/api/health`
5. Production bootstrap script (plans, platform staff, no dev seed)

**Phase B — Customer readiness (≈2 weeks)**
6. Resend + email adapter + templates (verify, reset, invite, join decisions)
7. Email verification + password reset flows
8. Upstash Redis rate-limit store
9. R2 + real document uploads (presigned URLs)
10. Stripe subscriptions (checkout, portal, webhooks, trial expiry)

**Phase C — Hardening (≈1 week)**
11. Security headers + MFA enforcement + secret rotation runbook
12. Inngest queue behind `emitDomainEvent`; move >5k-row imports + nightly rollups onto it
13. Playwright post-deploy smoke suite
14. Backup restore drill; write the DR runbook result into the repo
15. Private beta (5–10 friendly operators) → fix list → public beta

## 14. Remaining high-priority improvements before public beta

1. **Email verification & password reset** (Critical — blocks real customers)
2. **Stripe subscriptions** (Critical — blocks revenue)
3. **CI pipeline + Sentry + uptime** (Critical — blind otherwise)
4. **Redis rate limiting** (High — current limiter resets per instance)
5. **Live METAR/TAF adapter** (High — weather is simulated; consumers ready)
6. **Real document uploads to R2** (High — module is metadata-only)
7. **Guided org setup checklist + onboarding emails** (High — activation)
8. **Playwright E2E in CI** (High — protects the golden paths)
9. **SEO pass on marketing site** (High — sitemap, OG images, structured data)
10. **Trial lifecycle + demo-org expiry** (Medium — keeps the tenant list honest)
