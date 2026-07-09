import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * Regression guard for the dispatch-closeout idempotency fix.
 *
 * The closeout bills the student, decrements their balance, and increments
 * SMOH/SPOH meters. A concurrent double-submit (double-click, client retry)
 * must NOT do any of that twice. The fix claims the RELEASED→CLOSED transition
 * atomically inside the transaction via a guarded `updateMany` and aborts when
 * it matches zero rows. This test fails if the route regresses to the old
 * read-check-then-update-by-id shape, which is racy under READ COMMITTED.
 */
const routePath = path.resolve(__dirname, "../src/app/api/dispatch/[id]/close/route.ts");
const src = readFileSync(routePath, "utf8");

describe("dispatch closeout is idempotent", () => {
  it("uses an interactive transaction (can abort on a lost claim)", () => {
    expect(src).toMatch(/\$transaction\(\s*async\s*\(\s*tx\s*\)/);
  });

  it("claims the RELEASED→CLOSED transition atomically with a guarded updateMany", () => {
    // updateMany scoped to status RELEASED — only one concurrent request wins.
    expect(src).toMatch(/updateMany\(\{[\s\S]*status:\s*"RELEASED"/);
    // and aborts the whole transaction when the claim matched nothing.
    expect(src).toMatch(/\.count\s*===\s*0/);
  });

  it("does not fall back to a bare status-less dispatch.update inside the tx", () => {
    // The old racy form updated the dispatch by id with no status predicate.
    // Every meter/billing write now hangs off the guarded claim instead.
    expect(src).not.toMatch(/tx\.dispatch\.update\(\{\s*where:\s*\{\s*id\s*\}/);
  });
});
