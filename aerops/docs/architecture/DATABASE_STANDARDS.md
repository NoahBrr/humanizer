# AeroOps Database Standards

How the schema (`prisma/schema.prisma`, 50 models) is designed, migrated,
and queried. These standards describe what the codebase actually does;
anything not yet true is marked **(aspirational — not yet enforced)**.

## Prisma conventions

- **Prisma 6 is pinned — never upgrade to 7.** Hard rule (CLAUDE.md §2,
  do-not-break rule 4). Generator: `prisma-client-js`; datasource:
  PostgreSQL 16 via `DATABASE_URL`. `directUrl` for migrations arrives with
  the Neon move (PRODUCTION.md §13.3) **(aspirational — not yet enforced)**.
- One client instance, imported as `db` from `src/lib/db.ts`. Engines and
  routes never instantiate their own `PrismaClient`.
- **Money = `Decimal`, never float**: `@db.Decimal(10, 2)` for currency
  (`accountBalance`, `unitPrice`, `costParts`), `@db.Decimal(9, 1)` for
  meters/hours (`currentHobbs`, `totalHours`). JS-side reads convert
  explicitly (`Number(...)`) at the boundary.
- **`db.$transaction` wherever money moves or multiple rows must agree.**
  Canonical example: dispatch closeout
  (`src/app/api/dispatch/[id]/close/route.ts`) — dispatch status + aircraft
  meters + student balance + invoice + optional squawk/grounding in one
  transaction. Do-not-break rule 5.
- **Computed values are derived at read time, never stored and re-synced**
  (airworthiness, fleet/org health, readiness). A stored copy of a
  computable answer is a bug.
- Schema comments (`///`) state intent the types can't
  (`/// sha256 of the full key; the key itself is shown once at creation.`).
  Keep them.

## Naming rules

| Thing | Convention | Examples |
|---|---|---|
| Models | PascalCase singular, no `@@map` | `ScheduleEvent`, `MaintenanceOrder`, `ImportJob` |
| Fields | camelCase | `organizationId`, `hourlyRateWet`, `rolledBackAt` |
| Enums | PascalCase type, SCREAMING_SNAKE values | `DispatchStatus { PENDING RELEASED CLOSED CANCELLED }` |
| IDs | `String @id @default(cuid())` everywhere | — |
| Timestamps | `createdAt @default(now())`, `updatedAt @updatedAt`, lifecycle markers as `<verb>edAt` | `releasedAt`, `revokedAt`, `deletedAt` |
| Booleans | `is`/`has`/verb-participle prefixes | `isActive`, `isDemo`, `weatherAcknowledged` |
| Free-form config | `String[]` of catalog keys defined in `src/lib` | `permissions`, `modules`, `scopes` |

## Migration rules

- **Named migrations only**: `npx prisma migrate dev --name x`. The history
  in `prisma/migrations/` is uniformly `TIMESTAMP_snake_case_name`
  (`20260707044928_import_center`) — a name describes the slice, not the SQL.
- **Additive-only within a release** (PRODUCTION.md §7.43): no destructive
  change ships in the same release as the code that stops using the column.
  This keeps app rollback always DB-safe.
- Production applies with `prisma migrate deploy` as a release step before
  promoting the deploy **(aspirational — not yet enforced; no production
  exists)**.
- Never edit an applied migration; a mistake gets a follow-up migration.

## Foreign keys

- **Every model with `organizationId` has a real `Organization` relation**
  (ADR-021) — a bare `organizationId String` with no relation is banned
  (`tests/schema-governance.test.ts`). New org-owned models declare the
  relation or carry a documented exception with a reason.
- **Org-owned children cascade from `Organization`**
  (`onDelete: Cascade`): users, locations, aircraft, schedule events,
  invoices, documents, syllabi, import jobs, leads, parts, API keys,
  webhooks, invite links, Mission Control scenes, platform notes, etc.
  Deleting a tenant is a platform operation, and cascades do the bulk. The
  exceptions are the security/audit logs (`AuditLog`, `LoginEvent`), which
  are `onDelete: SetNull` so the trail outlives its subject.
- **Instructor-linked records are `RESTRICT`**: `LessonRecord.instructor`
  and `Endorsement.instructor` are required relations with no `onDelete`
  override — Prisma's default RESTRICT. You cannot delete an instructor who
  has signed training records. **Deletion helpers therefore order children
  first**; the canonical FK-aware wipe order is
  `wipeOrganizationData()` in `src/lib/org-snapshot.ts` (lesson records,
  endorsements, checkrides, ratings before users; events before invoices;
  aircraft late; users/roles/departments last).
- **Audit rows survive their subject**: `AuditLog.organization` is
  `onDelete: SetNull` — the immutable trail is never cascaded away, and the
  wipe order never touches it.
- Optional operational references (`ScheduleEvent.aircraft`,
  `Invoice.student`) stay nullable so history outlives resource changes.

## Index strategy

- **Every tenant-scoped query pattern gets a composite index leading with
  `organizationId`**: `[organizationId, status]` (aircraft, invoices,
  leads), `[organizationId, createdAt]` (audit, notifications, snapshots),
  `[organizationId, start, end]` (schedule).
- Child tables index their parent FK plus the discriminator actually
  queried: `[aircraftId, status]` (squawks, maintenance),
  `[studentId, date]` (lesson records, checkrides),
  `[webhookId, createdAt]` (deliveries).
- Scheduling adds per-resource time indexes for conflict detection:
  `[aircraftId, start]`, `[instructorId, start]`, `[studentId, start]`,
  `[seriesId]`.
- Uniqueness expresses invariants. **Globally unique** only where the value
  is global by nature: `Organization.slug`, `User.email`, `ApiKey.keyHash`,
  `Invitation.tokenHash`. **Tenant-owned natural keys are unique per
  organization**, never globally (ADR-021) — a global unique both leaks
  cross-tenant existence and blocks legitimate reuse:
  `[organizationId, tailNumber]` (aircraft), `[organizationId, number]`
  (invoices), `[organizationId, partNumber]` (parts),
  `[organizationId, name]` (roles, departments, scenes). Enforced by
  `tests/schema-governance.test.ts`.
- New query shape → check the plan supports it with an org-leading index
  before merging (merge checklist: "tenant isolation checked for new
  queries").

## Audit fields

- `createdAt DateTime @default(now())` on every org-owned table —
  **enforced** by `tests/schema-governance.test.ts` (ADR-021), which allows a
  documented domain-specific substitute that says more (`Invoice.issuedAt`,
  `Document.uploadedAt`, `SimulationRun.startedAt`). `updatedAt @updatedAt`
  and `deletedAt` are added **where lifecycle matters** (CONSTITUTION.md
  conventions).
- **`createdBy`/`updatedBy` are satisfied by the audit log, not columns** —
  a documented shortcut (CONSTITUTION.md): every mutation writes an
  `AuditLog` row with actor, action, entity, old/new values, IP, and user
  agent. Revisit if row-level provenance becomes a query need. Where a
  display label is cheap and useful, a denormalized string is acceptable
  (`ImportJob.createdByLabel`, `OrgSnapshot.createdBy`).
- The audit trail is immutable — never rewritten (do-not-break rule 3);
  snapshot restore explicitly never rewrites audit rows.

## Secret & token storage

- **Bearer tokens are stored as one-way hashes only** (ADR-020,
  SECURITY_STANDARDS.md). The column is named `tokenHash` (or `keyHash` for
  API keys), typed `String @unique`, and holds a hex sha256 produced by
  `lib/tokens.ts`. There is **no raw `token` column** on any model —
  `tests/token-security.test.ts` fails the build if one appears. A raw-token
  field requires an allowlist entry with a written reason in that test.
- **Lookup by hash, never by raw value**: `where: { tokenHash: hashToken(x) }`.
  Querying these models by a raw `token` field is statically banned.
- **Documented raw-secret exceptions** — reversible-by-necessity symmetric
  secrets that the server must re-read to *verify*, so they cannot be
  one-way hashed. These are signing/shared keys, not bearer tokens:
  - `Webhook.secret` — HMAC-SHA256 signing key re-read per delivery
    (`lib/webhooks.ts`); org-scoped, never returned by a read API, rotated by
    recreating the subscription.
  - `mfaSecret` (`User`, `PlatformUser`) — the TOTP shared secret, re-read by
    `verifyTotp` (`lib/totp.ts`) on every MFA check. Encryption-at-rest
    (envelope/KMS) is the intended hardening — roadmapped, not yet done.

  `tests/token-security.test.ts` allowlists exactly these two by field name;
  any new raw `*token`/`*secret` String column fails the build until added
  with a written reason.
- **Migrations that hash an existing raw column backfill in place** so live
  values survive: add `tokenHash`, `UPDATE … SET tokenHash =
  encode(sha256(convert_to(token,'UTF8')),'hex')` (byte-identical to
  `lib/tokens.ts`), then drop the raw column. See
  `20260707193000_hash_invite_tokens`.

## Soft delete policy

- `deletedAt` **where recovery matters; never hard-delete customer data
  unbidden** (CONSTITUTION.md rule 7). Implemented today on `User` and
  `Organization`; session resolution refuses soft-deleted users
  (`src/lib/session.ts`).
- Revocation-style lifecycles use their own timestamp instead of deletion:
  `ApiKey.revokedAt`, `InviteLink.revokedAt`, `Organization.suspendedAt`.
- Hard deletes are reserved for platform tooling (tenant wipe/restore,
  demo-org cleanup) and import rollback — always through the manifest or
  the canonical wipe order, always audited.
- Extending `deletedAt` to more operational records (aircraft, students) is
  expected as recovery needs appear **(aspirational — not yet enforced)**;
  queries on soft-deletable models must filter `deletedAt: null`.

## Multi-tenant isolation

- **Every operational record hangs off `Organization`**, either directly
  (`organizationId` + scoped indexes) or through its parent: `Squawk` and
  `MaintenanceOrder` scope via `Aircraft`, `Dispatch` via
  `ScheduleEvent`/`Aircraft`, `Student`/`Instructor` via `User`.
- **Org scope comes from the session, never from client input**
  (do-not-break rule 1). Queries either filter
  `organizationId: session.organizationId` or join through a scoped parent:
  `where: { id, aircraft: { organizationId: session.organizationId } }` —
  a cross-tenant id is a 404.
- Cross-tenant queries exist only on `/api/platform/*` routes behind
  `authorizePlatform()`.
- `PlatformUser` is a separate identity table — staff are never members of
  customer orgs. `DemoRequest` and `LoginEvent` are deliberately
  tenant-optional (public intake / pre-auth events).
- No Postgres row-level security; isolation is enforced at the application
  layer by the single `authorize()` gate plus session-scoped queries, and
  reviewed per the merge checklist.

## Performance expectations

- Queries are **bounded**: list endpoints combine a filter window with a
  hard `take` (schedule: date range + 1000; search: 4–5 per entity). No
  unbounded `findMany` on unbounded tables.
- Budgets (ROADMAP, mirrored in PRODUCTION.md §6.36): dashboard < 2 s,
  schedule < 500 ms. Load sanity gate before launch: 50 concurrent
  dashboard loads without connection exhaustion (PRODUCTION.md §13.3).
- Production posture **(aspirational — not yet enforced)**: pooled
  connection URL at runtime, `DIRECT_URL` confined to migrations,
  `pg_stat_statements` with alerts on > 500 ms p95 queries and connection
  saturation (PRODUCTION.md §6.35).
- Select narrowly (`select`/`include` with explicit fields — see
  `eventInclude` in `src/app/api/schedule/events/route.ts`); heavy
  aggregates belong in `src/lib` engines where they can be tested and, when
  load arrives, cached (scaling order in PRODUCTION.md §9.54).

## Backup philosophy

From PRODUCTION.md §11 — **a plan, not yet provisioned (aspirational — not
yet enforced)**:

1. Neon PITR, 30-day window — restore to any second. RPO ≤ 15 min.
2. Nightly logical `pg_dump` (Inngest cron) → R2, 90-day retention, with a
   **weekly restore-verify job** that loads the dump into a scratch branch
   and row-counts key tables.
3. Documents bucket: object versioning on; lifecycle to infrequent access
   at 90 days.
4. Quarterly full DR drill against the runbook (restore branch → repoint
   `DATABASE_URL` → invalidate sessions; RTO ≤ 4 h), timing logged in the
   repo.

Local development: reseed with `npm run seed` (TRUNCATE CASCADE — wipes
runtime-created rows); the dev seed **never** runs in production
(PRODUCTION.md §8.48).

## Related documents

- [CONSTITUTION.md](../../CONSTITUTION.md) — the enforced rules
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system shape and engines
- [SECURITY_STANDARDS.md](./SECURITY_STANDARDS.md) — auth, tenancy, secrets
- [ENGINEERING_HANDBOOK.md](../engineering/ENGINEERING_HANDBOOK.md) — how we work
- [DECISIONS.md](./DECISIONS.md) — ADR-007 (no-RLS tenancy), ADR-015 (additive-only migrations)
- [PRODUCTION.md](../../PRODUCTION.md) — launch plan (§11 backups, §13 blockers)
