import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { createToken, hashToken, generateToken } from "../src/lib/tokens";

// Phase 1B contracts: bearer tokens are stored only as one-way hashes, and
// no code path may store or look up a raw token. See ADR-020.

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const SCHEMA = readFileSync(path.join(ROOT, "prisma", "schema.prisma"), "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe("token helper (lib/tokens.ts)", () => {
  it("hashToken is deterministic hex sha256, byte-identical to the API-key pattern", () => {
    // The API-key path is createHash("sha256").update(key).digest("hex").
    expect(hashToken("demo-invite-blueridge")).toBe(
      "f16340826979c4961f93ce987c65b18c296e201f0cebf07cfc53ad90fe6b142e",
    );
    expect(hashToken("x")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generateToken returns high-entropy URL-safe tokens, unique each call", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, URL-safe
    expect(a.length).toBeGreaterThanOrEqual(32); // 24 bytes → 32 chars
  });

  it("createToken returns a raw token and its matching hash", () => {
    const { raw, hash } = createToken();
    expect(hash).toBe(hashToken(raw));
    expect(raw).not.toBe(hash);
  });
});

// --- Static enforcement ------------------------------------------------------

describe("no raw bearer-token storage (schema)", () => {
  // Every bearer secret must be stored as *Hash / *Secret, never a raw
  // `token` column. New raw-token fields require an allowlist entry + reason.
  const ALLOWED_TOKEN_FIELDS: Record<string, string> = {
    // (none) — Invitation.token and InviteLink.token were removed in Phase 1B.
  };

  it("no model declares a raw `token` field", () => {
    const offenders = SCHEMA.split("\n")
      .map((l, i) => ({ l: l.trim(), n: i + 1 }))
      .filter(({ l }) => /^token\s+String/.test(l))
      .filter(({ l }) => !ALLOWED_TOKEN_FIELDS[l]);
    expect(offenders.map((o) => `schema.prisma:${o.n}`)).toEqual([]);
  });

  it("invitation and invite-link tokens are stored as tokenHash @unique", () => {
    expect(SCHEMA).toMatch(/model Invitation \{[\s\S]*?tokenHash\s+String\s+@unique[\s\S]*?\}/);
    expect(SCHEMA).toMatch(/model InviteLink \{[\s\S]*?tokenHash\s+String\s+@unique[\s\S]*?\}/);
  });
});

describe("no raw-token queries or storage (source)", () => {
  const files = walk(SRC);

  it("nothing queries Invitation/InviteLink by a raw `token` field", () => {
    // A lookup must hash first: `where: { tokenHash: hashToken(...) }`.
    // A literal `where: { token` on these models is the bug this bans.
    const offenders = files
      .filter((p) => /where:\s*\{\s*token\b/.test(readFileSync(p, "utf8")))
      .map((p) => path.relative(SRC, p));
    expect(offenders).toEqual([]);
  });

  it("every Invitation/InviteLink create site hashes through lib/tokens", () => {
    // Storing a raw token is already impossible (no `token` column → tsc
    // rejects it). This is the positive invariant: any file that mints one of
    // these records must go through the shared hashing helper, so the raw
    // value exists only transiently for one-time display.
    const offenders = files.filter((p) => {
      const src = readFileSync(p, "utf8");
      const creates = /(invitation|inviteLink)\.create/i.test(src) || /invitations:\s*\{\s*\n?\s*create/.test(src);
      if (!creates) return false;
      return !/from "@\/lib\/tokens"/.test(src);
    }).map((p) => path.relative(SRC, p));
    expect(offenders).toEqual([]);
  });

  it("bearer-token hashing goes through lib/tokens (or the API-key call site)", () => {
    // Any file that hashes a token with sha256 should be the shared helper,
    // the API-key resolver, or the impersonation HMAC — not a new ad-hoc path.
    const ALLOWED = new Set([
      path.join("lib", "tokens.ts"),
      path.join("lib", "session.ts"), // API-key keyHash + impersonation HMAC
      path.join("app", "api", "developer", "keys", "route.ts"), // API-key mint
    ]);
    const offenders = files
      .filter((p) => /createHash\(["']sha256["']\)/.test(readFileSync(p, "utf8")))
      .map((p) => path.relative(SRC, p))
      .filter((p) => !ALLOWED.has(p));
    expect(offenders).toEqual([]);
  });
});
