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
});

describe("timestamp conventions", () => {
  // Every org-owned model carries a creation timestamp: createdAt, or a
  // documented domain-specific substitute that says more (DATABASE_STANDARDS).
  const CREATION_SUBSTITUTE: Record<string, string> = {
    Invoice: "issuedAt",
    Document: "uploadedAt",
    SimulationRun: "startedAt",
    LoginEvent: "createdAt", // has createdAt
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
