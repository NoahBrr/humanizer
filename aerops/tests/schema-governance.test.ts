import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// Phase 1C contracts: the schema must not drift from DATABASE_STANDARDS.md —
// every org-owned model has a real Organization FK, tenant-owned natural keys
// are unique per organization (not globally), and every org-owned model
// carries a creation timestamp. Documented exceptions are explicit here.

const SCHEMA = readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");

type Model = { name: string; body: string };
function models(): Model[] {
  return [...SCHEMA.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)].map((m) => ({ name: m[1], body: m[2] }));
}
const orgOwned = () => models().filter((m) => /^\s*organizationId\s+String/m.test(m.body));

describe("organization FK integrity", () => {
  it("every model with organizationId has a real Organization relation", () => {
    const offenders = orgOwned()
      .filter((m) => !/organization\s+Organization\??\s+@relation\([^)]*fields:\s*\[organizationId\]/.test(m.body))
      .map((m) => m.name);
    expect(offenders).toEqual([]);
  });

  it("every organization FK declares an onDelete action (Cascade, or SetNull for logs)", () => {
    // SetNull is only for records that must outlive their org (security/audit
    // logs); everything operational Cascades. No FK may default to NoAction.
    const SETNULL_OK = new Set(["AuditLog", "LoginEvent"]);
    const offenders = orgOwned()
      .map((m) => {
        const rel = m.body.match(/organization\s+Organization\??\s+@relation\([^)]*onDelete:\s*(\w+)/);
        return { name: m.name, action: rel?.[1] };
      })
      .filter(({ name, action }) => {
        if (!action) return true; // no onDelete at all
        if (action === "Cascade") return false;
        if (action === "SetNull") return !SETNULL_OK.has(name);
        return true; // any other action is unexpected for an org FK
      })
      .map((o) => `${o.name}:${o.action ?? "none"}`);
    expect(offenders).toEqual([]);
  });
});

describe("tenant-scoped uniqueness", () => {
  // Natural keys that recur across tenants (a tail number, an invoice number)
  // must be unique PER ORGANIZATION, never globally — a global unique both
  // leaks cross-tenant existence and blocks legitimate reuse (ADR-021).
  // Fields that ARE uniqueness-constrained and must be per-org. (LessonType.name
  // is intentionally not unique — two "Dual Flight" types in one org is fine.)
  const TENANT_SCOPED: Record<string, string> = {
    Aircraft: "tailNumber",
    Invoice: "number",
    Part: "partNumber",
    OrgRole: "name",
    Department: "name",
    MissionControlScene: "name",
  };

  it("tenant-owned natural keys are @@unique([organizationId, field]), not @unique", () => {
    const offenders: string[] = [];
    for (const [model, field] of Object.entries(TENANT_SCOPED)) {
      const m = models().find((x) => x.name === model);
      if (!m) { offenders.push(`${model} (missing)`); continue; }
      if (new RegExp(`^\\s*${field}\\s+String[^\\n]*@unique`, "m").test(m.body)) offenders.push(`${model}.${field} is globally @unique`);
      if (!new RegExp(`@@unique\\(\\[organizationId,\\s*${field}\\]\\)`).test(m.body)) offenders.push(`${model} lacks @@unique([organizationId, ${field}])`);
    }
    expect(offenders).toEqual([]);
  });

  // Derived catch-all (Architect + QA review): rather than only checking the
  // enumerated list above, forbid ANY single-field `@unique` on an org-owned
  // model unless the field is a legitimately-global identity/credential.
  // A tenant natural key (tail number, invoice number, scene name…) reverted
  // to a bare `@unique` is caught here even if it's not in TENANT_SCOPED.
  // Legitimately global on an org-owned model: credential hashes, and the
  // cross-org login identity (User.email — one person, one account; org
  // membership is a nullable FK). DATABASE_STANDARDS documents these.
  // `organizationId` is also allowed: `organizationId @unique` is the canonical
  // per-org 1:1 config-singleton pattern (Revenue Engine config rows —
  // RevenueWorkflowPolicy, DispatchPolicy, OrgPaymentPolicy, RevenueSettings,
  // etc.). It is tenant-safe by construction (the unique key IS the tenant), and
  // is the opposite of the natural-key-reverted-to-bare-@unique this rule guards
  // against. Contract expanded here when the Revenue Engine introduced singletons.
  // `scheduleEventId` is allowed for the same structural reason: it is the FK of a
  // 1:1 relation (ScheduleEvent 1:1 Dispatch), a system-generated cuid — never a
  // tenant natural key. Dispatch became org-owned in Revenue Engine Phase 2 (it
  // gained a nullable organizationId); its long-standing 1:1 `scheduleEventId
  // @unique` is tenant-safe by construction (the referenced ScheduleEvent is itself
  // org-scoped) and a 1:1-relation FK cannot be expressed as a composite @@unique.
  // `invoiceId` is allowed for the same structural reason as `scheduleEventId`: it is the FK of a
  // 1:1 relation (Invoice 1:1 RevenueReview), a system cuid — never a tenant natural key — and a
  // 1:1-relation FK cannot be expressed as a composite @@unique; tenant-safe via the wrapped Invoice.
  const GLOBAL_UNIQUE_OK = new Set(["keyHash", "tokenHash", "email", "organizationId", "inviteTokenHash", "scheduleEventId", "invoiceId"]);
  it("no org-owned model declares a single-field @unique on a non-global field", () => {
    const offenders: string[] = [];
    for (const m of orgOwned()) {
      for (const line of m.body.split("\n")) {
        const mm = line.match(/^\s*(\w+)\s+\w+[^\n]*@unique\b/);
        if (mm && !GLOBAL_UNIQUE_OK.has(mm[1])) offenders.push(`${m.name}.${mm[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("timestamp conventions", () => {
  // Every org-owned model carries a creation timestamp: createdAt, or a
  // documented domain-specific substitute that says more (DATABASE_STANDARDS).
  const CREATION_SUBSTITUTE: Record<string, string> = {
    Invoice: "issuedAt",
    Document: "uploadedAt",
    SimulationRun: "startedAt",
    // A support session's creation IS its start (ADR-023); startedAt says more.
    ImpersonationSession: "startedAt",
  };

  it("every org-owned model has createdAt or a documented creation stamp", () => {
    const offenders = orgOwned()
      .filter((m) => {
        if (/^\s*createdAt\s+DateTime/m.test(m.body)) return false;
        const sub = CREATION_SUBSTITUTE[m.name];
        return !(sub && new RegExp(`^\\s*${sub}\\s+DateTime`, "m").test(m.body));
      })
      .map((m) => m.name);
    expect(offenders).toEqual([]);
  });
});
