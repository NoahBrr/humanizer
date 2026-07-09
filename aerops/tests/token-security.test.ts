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
  // Every bearer token must be stored hashed (`*Hash`). A field whose name
  // ends in `token`/`secret`/`apikey`/`accesskey` and is a raw `String` is
  // presumed a raw credential and banned — new ones need an allowlist entry
  // with a written reason (documented raw secrets: TOTP + webhook signing key,
  // which are reversible-by-necessity symmetric secrets, not bearer tokens —
  // ADR-020, DATABASE_STANDARDS §Secret & token storage).
  const ALLOWED_RAW_SECRETS: Record<string, string> = {
    mfaSecret: "TOTP shared secret — must be re-read to verify codes; encryption-at-rest is roadmap",
    secret: "Webhook.secret — HMAC signing key re-read per delivery",
  };

  it("no model declares a raw token/secret String field (only *Hash)", () => {
    const offenders = SCHEMA.split("\n")
      .map((l, i) => ({ l: l.trim(), n: i + 1 }))
      // field line like `name  Type ...`; flag a secret-ish name typed String
      // that is not itself a `*Hash` column.
      .filter(({ l }) => /^(\w*(?:token|secret|apikey|accesskey))\s+String\b/i.test(l))
      .filter(({ l }) => !/hash\s+String/i.test(l))
      .filter(({ l }) => {
        const name = l.match(/^(\w+)/)?.[1] ?? "";
        return !(name in ALLOWED_RAW_SECRETS);
      });
    expect(offenders.map((o) => `schema.prisma:${o.n} — ${o.l}`)).toEqual([]);
  });

  it("invitation and invite-link tokens are stored as tokenHash @unique", () => {
    expect(SCHEMA).toMatch(/model Invitation \{[\s\S]*?tokenHash\s+String\s+@unique[\s\S]*?\}/);
    expect(SCHEMA).toMatch(/model InviteLink \{[\s\S]*?tokenHash\s+String\s+@unique[\s\S]*?\}/);
  });
});

describe("no raw-token queries or storage (source)", () => {
  const files = walk(SRC);

  it("nothing queries by a raw `token` field (single- or multi-line where)", () => {
    // A lookup must hash first: `where: { tokenHash: hashToken(...) }`.
    // Match `where: { token` and `where: {\n token:` — a raw-token lookup.
    const offenders = files
      .filter((p) => /where:\s*\{\s*token\b/.test(readFileSync(p, "utf8").replace(/\s*\n\s*/g, " ")))
      .map((p) => path.relative(SRC, p));
    expect(offenders).toEqual([]);
  });

  it("the self-serve org-create engine returns invite URLs (never a dead hash-only row)", () => {
    // Regression guard for the Phase 1B review finding: onboarding must
    // surface the raw invite URL like every sibling create site, not discard
    // it — otherwise those invitations are unredeemable and consume seats.
    const src = readFileSync(path.join(SRC, "lib", "onboarding.ts"), "utf8");
    expect(src).toMatch(/invites\.push\(\{\s*email,\s*url:\s*`\/invite\/\$\{token\}`/);
    expect(src).not.toMatch(/tokenHash:\s*createToken\(\)\.hash/); // the discarded-raw antipattern
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

  it("token hashing goes through lib/tokens — no ad-hoc sha256 elsewhere", () => {
    // The only sanctioned sha256 outside lib/tokens is the impersonation
    // cookie HMAC (a different primitive, createHmac). Everything that hashes
    // a bearer token must call hashToken(). API keys were unified in the
    // Phase 1B review follow-up, so the allowlist is now just the helper.
    const ALLOWED = new Set([path.join("lib", "tokens.ts")]);
    const offenders = files
      .filter((p) => /createHash\(["']sha256["']\)/.test(readFileSync(p, "utf8")))
      .map((p) => path.relative(SRC, p))
      .filter((p) => !ALLOWED.has(p));
    expect(offenders).toEqual([]);
  });
});
