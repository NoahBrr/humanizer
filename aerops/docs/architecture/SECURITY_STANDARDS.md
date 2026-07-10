# AeroOps Security Standards

The security posture of the platform: what is enforced today, where it lives
in the code, and what is planned but not yet built. Companions:
[CONSTITUTION.md](../../CONSTITUTION.md) (the enforced rules),
[PRODUCTION.md](../../PRODUCTION.md) §3/§12/§13 (the launch-hardening plan).
Anything marked **(aspirational — not yet enforced)** is a documented gap,
not a current guarantee. Never document a defense you haven't confirmed in
the code.

## Authentication standards

| Standard | Implementation |
|---|---|
| Provider | NextAuth v5, JWT strategy (`src/auth.ts`, `src/auth.config.ts`) |
| Primary factor | Email + password (bcrypt hashes, `bcrypt.compare` in `authorize()`) |
| Second factor | TOTP per RFC 6238 — SHA-1, 6 digits, 30 s steps, ±1 drift window, dependency-free (`src/lib/totp.ts`); challenged in the credentials flow when `mfaEnabled` |
| Password policy | ≥12 chars, all four character classes, breached/common-password blocklist (`src/lib/password.ts`); tested in `tests/security.test.ts` |
| Breach check | Local blocklist today; HaveIBeenPwned k-anonymity adapter **(aspirational — not yet enforced)** |
| SSO | Google / Microsoft Entra ID seams, active only when env credentials exist; OAuth **never auto-provisions** — the email must match an existing active user (`signIn` callback, `src/auth.ts`) |
| Login audit | Every attempt — success or failure, with reason — writes a `LoginEvent` row; logging failure never blocks auth |
| Pre-auth MFA check | `/api/auth/mfa-check` is a catalogued public route, rate-limited (`tests/constitution.test.ts` PUBLIC_ROUTES) |
| MFA enforcement for admins/platform staff | **(aspirational — not yet enforced)** — PRODUCTION.md §4.28 |
| Email verification / password reset | **Not built.** Planned in PRODUCTION.md §13.1 (hashed single-use tokens, sessionVersion bump on reset) |

## Authorization standards

- **One gate.** Every API route calls `authorize(permission, {mutating})` or
  `authorizePlatform(roles)` from `src/lib/session.ts`. This is
  machine-enforced by `tests/constitution.test.ts`: the only exceptions are
  the catalogued PUBLIC_ROUTES (each with a written reason) and
  SELF_SERVICE_ROUTES (which must still session-guard and 401).
- `authorize()` handles, in order: API-key resolution, unauthenticated,
  individual accounts (no org yet → 403), suspended orgs, read-only
  refusal of any `mutating` call, missing permission, and module gating
  (permission namespace → feature module).
- **RBAC is data.** The permission catalog is `src/lib/permissions.ts`;
  roles (built-in or custom `OrgRole`) are bundles of catalog keys. Routes
  and pages check permissions, never role names. Navigation maps every
  section to a permission in `src/lib/rbac.ts` (`SECTION_PERMISSIONS`,
  constitution-tested).
- **Org scoping comes from the session, never from client input.**
  Cross-tenant queries exist only behind `authorizePlatform()`.
- **Founder authority is an immutable identity, not a role** (ADR-024).
  Founder-only surfaces (`/platform/founder`, Platform User management) gate on
  `PlatformUser.isFounder` via `authorizeFounder()` / `requireFounderSession()` —
  server-side, never a UI, email, or client check. `isFounder` is set only by the
  gated, idempotent, audited bootstrap (`scripts/bootstrap-founders.ts`: passwords
  from protected env vars, hashes only, never printed or overwritten, rotation
  forced on first sign-in); `FOUNDER_SUPER_ADMIN` is never assignable through the
  role-change flow, and the last active founder cannot be deactivated. Platform
  access can be time-boxed (`accessStartsAt`/`accessExpiresAt`, enforced per
  request in `getSession`), read-only, or restricted to named organizations
  (`restrictedOrgIds`, enforced by `platformOrgScopeError` on every org-targeting
  route + the org detail page) — all in the authorize layer, never the UI. A
  founder can never be scoped (no self/last-founder lockout).
- Platform staff (`PlatformUser`) are a **separate identity table** — never
  members of customer organizations. `/platform` capabilities are a data-driven
  matrix: `src/lib/platform-permissions.ts` maps the `PlatformRole` enum
  (FOUNDER_SUPER_ADMIN / FOUNDER / PLATFORM_ADMIN / SOFTWARE_ENGINEER /
  CUSTOMER_SUCCESS / SUPPORT_ENGINEER / BILLING_ADMIN / AUDITOR) to a
  `PlatformPermission` catalog.
  Routes gate with `authorizePlatform(platformRolesWith("platform.users.manage"), …)`
  — the allowed-role list is *derived* from the matrix, not hardcoded, so adding
  a role/capability is a data edit and AUDITOR is provably read-only (ADR-022).
  The six idealized spec role names are display aliases, not enum values.
- **Platform authority and organization ownership are authorized
  independently** (ADR-023). `PlatformUser` (AeroOps staff) and personal `User`
  are distinct identity tables with distinct RBAC (`PLATFORM_ROLE_PERMISSIONS`
  vs org `Permission` bundles). A Platform Super Admin manages orgs through
  *platform* authorization and is **never** inserted as an org member or owner;
  an Account Owner gets **no** platform permission. Platform org-creation invites
  or assigns an owner — it never adds the staff member as a member.
- **Platform mutations are refused while impersonating.**
  `authorizePlatform(roles, { mutating: true })` returns 403 when the session
  carries an impersonation cookie: during impersonation the acting id is the
  *target customer's*, so a write would bypass read-only impersonation and lose
  its audit (the customer id fails the `AuditLog.actorPlatformUserId` FK).
- **Platform-staff actions on a customer user** (`PATCH /api/platform/users/[id]`
  — deactivate, reactivate, force-logout, role change, owner transfer) are each
  matrix-gated, audited with the staff actor, and surfaced to the org as a
  notification when they change access. Guardrails (ADR-023): the current
  Account Owner cannot be deactivated, demoted, role-changed, or
  membership-removed until ownership is transferred, and the last active
  administrator cannot be deactivated; ownership (`Organization.ownerId` plus the
  owner's active `ACCOUNT_OWNER` membership) moves only through the
  ownership-transfer service, atomically, never a bare role edit; a custom role
  must belong to the target's own org; promotions clear `customRoleId` so they
  actually take effect. No hard deletes — `isActive`/`deletedAt` only.
- API keys pass through the **same** `authorize()` gate as humans: scopes
  are permission keys, read-only keys are refused all mutations, module
  gating and suspension apply identically (`apiKeySession`,
  `src/lib/session.ts`).

## Session handling

| Concern | Implementation |
|---|---|
| Session shape | One `AppSession` type for the whole app (`src/lib/session.ts`); three kinds: `org`, `platform`, `individual` (signed up, no org → `/welcome` only) |
| Resolution | Always `getSession()` — never `auth()` directly — so tenancy rules live in exactly one place |
| Strategy | NextAuth JWT (`session: { strategy: "jwt" }`, `src/auth.config.ts`); default NextAuth cookies (httpOnly, SameSite Lax) — no custom cookie override in the repo |
| Revocation | `sessionVersion` on `User`/`PlatformUser`: any bump (or `isActive = false`) kills all live JWTs on the next request. Org users check in `orgSessionFor()`; platform users check on **every** request in `getSession()` via `platformClaimsValid()` (`src/lib/session-rules.ts`), which also fails closed on tokens missing the version claim. The platform **role** is read from the row, not the token, so demotions apply immediately. Pinned by `tests/auth-security.test.ts` |
| Impersonation | HMAC-SHA256-signed, expiring (1 h TTL) `aerops-impersonation` cookie, verified with `timingSafeEqual` (`encodeImpersonation`/`decodeImpersonation`), anchored to a durable `ImpersonationSession` row (reason, start, expiry, org, target, `endedAt`) whose id + staff label the cookie carries. Read-only by default; read-only blocks **all** mutations at the gate. Start and stop are audited (`platform.impersonation_start/_end`) and the customer org is notified at session end (`src/app/api/platform/impersonate/route.ts`). Expiry alone stops impersonated access **and** audit attribution; nested impersonation is impossible (starting it is a refused mutating action). Never weaken this. |
| Impersonation cookie flags | `httpOnly`, `sameSite: "lax"`, `secure` in production, 1 h `maxAge` |
| API-key sessions | `Bearer aero_…` header beats the browser cookie; key is sha256-hashed for lookup; revoked keys are refused |
| Server-side session store (Redis) | **(aspirational — not yet enforced)** — PRODUCTION.md §2.6 lists sessions as a Redis candidate |

## Secret management

- **No secrets in the repo.** `.gitignore` excludes `.env*` (only
  `.env.example` is committed, placeholder-only — audited as part of
  PRODUCTION.md §3.12).
- **AUTH_SECRET fails closed.** All access goes through
  `requireAuthSecret()` in `src/lib/env.ts` (statically enforced by
  `tests/auth-security.test.ts`): in production a missing, placeholder, or
  short secret **fails the boot gate** (`src/instrumentation.ts`) — the
  process may bind its port but every request, `/api/health` included,
  returns 500, and no JWT or cookie is ever signed. Unrecognized `NODE_ENV`
  values count as production. Development without a configured secret uses the
  documented `DEV_ONLY_AUTH_SECRET` constant, which production rejects by
  value. Note `next start` runs in production mode — local verification
  servers need a real generated secret in `.env`
  (`openssl rand -base64 32`).
- `AUTH_SECRET` signs both the NextAuth JWT and the impersonation cookie
  HMAC; both consume it through `requireAuthSecret()` — there is no
  fallback path in production (see the fail-closed bullet above), and each
  stage uses its own strong secret (PRODUCTION.md §16).
- **Token storage policy (ADR-020):** every bearer token AeroOps issues —
  API keys, invitation tokens, invite-link tokens — is stored **only** as a
  sha256 hash (`keyHash` / `tokenHash`) via `lib/tokens.ts`; the raw value is
  shown once at creation and never persisted. Lookup hashes the presented
  token and matches the stored hash. A database read (backup leak, injection,
  insider) yields no working credential. Enforced by
  `tests/token-security.test.ts` (no raw `token` column, no `where: { token`
  lookup). Consequence: an invite link, being one-way-hashed, is shown once
  and is not re-displayable — reshare by creating a new link. Impersonation
  and session tokens are HMAC-signed / JWT, not stored (see the session
  table above). Webhook secrets are a special case: stored raw because the
  sender must re-read them to HMAC-sign each delivery (documented exception,
  DATABASE_STANDARDS.md).
- Vercel encrypted envs per stage, 1Password/Doppler as source of truth,
  quarterly rotation **(aspirational — not yet enforced)** — PRODUCTION.md
  §3.13.

## Environment variables

- Local: `.env` from `.env.example` (`DATABASE_URL`, `AUTH_SECRET`,
  `AUTH_TRUST_HOST` — that is the complete current contract).
- Production adapters are **env-gated and degrade gracefully when unset**:
  OAuth providers activate only with credentials present (`src/auth.ts`);
  the same pattern is mandated for email, Stripe, Sentry, Redis, R2.
- The full per-stage matrix (who needs what, which stage, secret or not,
  rollback levers) is PRODUCTION.md §16. Per-stage values, preview envs on
  Neon branches never pointing at prod **(aspirational — not yet
  enforced)**.

## OWASP checklist (Top 10, 2021)

| # | Risk | AeroOps defense | Where |
|---|---|---|---|
| A01 | Broken Access Control | Single `authorize()`/`authorizePlatform()` gate, machine-enforced; org scope from session; permission-mapped navigation; module gating | `src/lib/session.ts`, `src/lib/rbac.ts`, `tests/constitution.test.ts` |
| A02 | Cryptographic Failures | bcrypt password hashes; sha256-hashed API keys; HMAC-SHA256 (impersonation cookie, webhooks) with `timingSafeEqual`; TLS terminates at host — HSTS **(aspirational)** | `src/auth.ts`, `src/lib/session.ts`, `src/lib/webhooks.ts` |
| A03 | Injection | Prisma parameterized queries only (see SQL injection section); zod validation at every route boundary | `src/lib/db.ts`, route handlers |
| A04 | Insecure Design | Constitution-tested architecture rules; explainable engines; impersonation read-only by default; AI never mutates | `CONSTITUTION.md`, `tests/constitution.test.ts` |
| A05 | Security Misconfiguration | Env-gated adapters defaulting off; placeholder-only `.env.example`; security headers (CSP/HSTS/frame-ancestors) **(aspirational — Phase A, PRODUCTION.md §13.4)** | `next.config.ts` (headers not yet present) |
| A06 | Vulnerable & Outdated Components | Minimal dependency policy ("no new dependencies without a strong reason"); Prisma 6 pin; `npm audit` in CI + monthly updates **(aspirational — no CI workflow exists yet)** | `package.json`, `CLAUDE.md` §2, PRODUCTION.md §13.5 |
| A07 | Identification & Auth Failures | 12-char policy + breach blocklist; TOTP MFA; sliding-window rate limits on auth/public endpoints; `sessionVersion` revocation; `LoginEvent` trail | `src/lib/password.ts`, `src/lib/totp.ts`, `src/lib/rate-limit.ts`, `src/auth.ts` |
| A08 | Software & Data Integrity Failures | Signed outbound webhooks; signed impersonation cookie; additive-only migrations; immutable audit log; inbound Stripe webhook signature verification **(aspirational — route not built)** | `src/lib/webhooks.ts`, `src/lib/audit.ts`, PRODUCTION.md §13.2 |
| A09 | Logging & Monitoring Failures | Structured logger (JSON in prod); `AuditLog`, `LoginEvent`, `WebhookDelivery` tables; `/api/health` (public, data-free); Sentry + uptime paging **(aspirational — PRODUCTION.md §13.5)** | `src/lib/logger.ts`, `src/lib/audit.ts`, `src/app/api/health/route.ts` |
| A10 | SSRF | Only user-influenced outbound fetch is webhook delivery: URLs are set by `settings.manage` admins only, 5 s timeout, failures isolated. No egress allowlist/private-IP block yet **(aspirational — not yet enforced)** | `src/lib/webhooks.ts`, `src/app/api/developer/webhooks/route.ts` |

## CSP

**(aspirational — not yet enforced.)** `next.config.ts` currently sets no
security headers — only the `/api/v1` rewrite. The plan (PRODUCTION.md
§13.4, checklist §12): CSP in report-only first, plus HSTS (short max-age
initially), `frame-ancestors 'none'`, nosniff, referrer-policy — landing in
Phase A (A6) before any deploy. The one inline script (theme/service-worker
init in `src/app/layout.tsx`) must be accounted for (nonce or hash) when CSP
lands.

## CSRF

- Auth routes: NextAuth v5's built-in CSRF token protects the sign-in/out
  flows (`/api/auth/[...nextauth]`).
- App mutations: defense is same-site cookies — NextAuth session cookies
  default to `SameSite=Lax`, and the impersonation cookie is explicitly
  `sameSite: "lax"` (verified in `src/app/api/platform/impersonate/route.ts`);
  no custom cookie config overrides the defaults. Mutations are JSON `POST`/
  `PATCH`/`DELETE` handlers, which cross-site form posts cannot exercise with
  Lax cookies.
- Public API calls authenticate with `Bearer aero_` headers, which browsers
  never attach cross-site.
- Per-route CSRF tokens beyond NextAuth's: not implemented and not currently
  required given the Lax-cookie + JSON-API posture; revisit if any
  cookie-authenticated form-encoded mutation is ever added.

## XSS prevention

- React escaping is the primary defense; user data is rendered through JSX
  text interpolation everywhere.
- `dangerouslySetInnerHTML` appears **exactly once** in the codebase
  (verified by grep): the static, first-party theme/service-worker init
  script in `src/app/layout.tsx`. It interpolates no user data. Any new use
  is a review blocker — treat "no `dangerouslySetInnerHTML`" as the rule and
  this one constant as the allowlisted exception.
- No `eval`, no user-controlled URLs in `<script>`/`<iframe>` surfaces.
- CSP as backstop **(aspirational — see CSP section)**.

## SQL injection prevention

- **All database access goes through Prisma** (`src/lib/db.ts`);
  parameterized queries are the defense.
- Raw SQL policy: verified by grep, the only `$queryRaw` in `src/` is the
  static tagged-template `` db.$queryRaw`SELECT 1` `` in
  `src/app/api/health/route.ts` (no interpolation; tagged templates are
  parameterized anyway). No `$executeRaw` anywhere. Keep it that way: new
  raw SQL requires a written reason and must use tagged templates, never
  string concatenation.
- Input shape is validated with zod before any query is built.

## File upload security

- **Uploads today are parse-only, nothing is stored.** The single upload
  endpoint is `src/app/api/import/parse/route.ts` (Import Center):
  permission-gated (`data.import`), 5 MB cap (`IMPORT_LIMITS.maxBytes`,
  `src/lib/import/parse.ts`), 5 000-row cap, CSV/XLSX parsed in memory
  (exceljs) and returned to the client — the file never touches disk or
  object storage.
- The Documents module stores **metadata only** (`Document.fileUrl` is a
  string in `prisma/schema.prisma`); there is no binary upload path.
- Real uploads via Cloudflare R2 presigned URLs — private bucket, org-id key
  prefixes, never public listing — **(aspirational — not yet enforced)**,
  PRODUCTION.md §2.4–5.

## Logging

- One structured logger, `src/lib/logger.ts`: JSON lines in production,
  `key=value` in development; levels debug/info/warn/error;
  dependency-free by design (pino/OpenTelemetry is a swap-the-transport
  change).
- Never log secrets, raw passwords, or tokens. Planned email/reset tokens
  are explicitly never logged (PRODUCTION.md §13.1).
- Sentry forwarding with PII scrubbing (`beforeSend` strips cookies, auth
  headers, emails) **(aspirational — not yet enforced)** — PRODUCTION.md
  §13.5.

## Audit trail

- `recordAudit` (`src/lib/audit.ts`) appends to the **immutable** `AuditLog`
  with: org, actor (`actorUserId` or `actorPlatformUserId` + label),
  dot-namespaced action (`dispatch.close`, `org.suspend`), entity type/id,
  old/new values, client IP (`x-forwarded-for`/`x-real-ip`) and truncated
  user agent.
- Every important mutation is audited (CLAUDE.md do-not-break rule 3); audit
  rows are never rewritten — even the org-snapshot restore engine preserves
  them (`src/lib/org-snapshot.ts`).
- Audit failure never breaks the operation it describes, but is loudly
  logged.
- **Impersonation attribution is corrected in one place** (ADR-023): every
  customer route records `actorUserId: session.userId`, but during impersonation
  that id is the *customer's*. `recordAudit` applies the pure, tested
  `computeAttribution` — a customer-written action inside an active session is
  re-attributed so the staff member becomes `actorPlatformUserId`, the customer
  is preserved as `impersonatedUserId`, the support session is linked via
  `impersonationSessionId`, and `actorUserId` is cleared so no row implies the
  customer acted alone. One shared-layer fix covers all ~37 customer routes and
  both identities are always preserved. Session expiry stops attribution, nested
  impersonation cannot occur, and audit rows carry ids and labels only — never
  cookies, tokens, or secrets.
- The audit log doubles as the Mission Control command timeline.
- Retention policy (2 y hot, then export to R2) **(aspirational — not yet
  enforced)** — PRODUCTION.md §3.16.

## Dependency review policy

- **No new dependencies without a strong reason** — prefer what's already
  here (CLAUDE.md §2). The runtime dependency list is deliberately short
  (`package.json`).
- **Prisma 6 is pinned — never upgrade to 7** (do-not-break rule 4).
- `npm audit --audit-level=high` in CI, weekly dependency review, monthly
  update pass, external pen test before GA **(aspirational — not yet
  enforced; no `.github/workflows` exists yet)** — PRODUCTION.md §9.51,
  §12, §13.5.

## Related documents

- [CONSTITUTION.md](../../CONSTITUTION.md) — the enforced engineering rules
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system shape, engines, event bus
- [ENGINEERING_HANDBOOK.md](../engineering/ENGINEERING_HANDBOOK.md) — coding, workflow, and release standards
- [PRODUCTION.md](../../PRODUCTION.md) — launch plan; §3/§12/§13 are the security hardening path
- [DECISIONS.md](./DECISIONS.md) — ADR-003 (JWT sessions), ADR-004 (separate PlatformUser identity), ADR-023 (ownership, membership, impersonation audit attribution)
- [CLAUDE.md](../../CLAUDE.md) — session-start operating system
