import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { canTransition, isFrozen, REVIEW_TRANSITIONS, reviewNumber, invoiceNumber } from "@/lib/revenue-review";

// Static guard for the ADR-025 closeout flip (the repo tests the close route by
// source scan — there is no DB-backed harness). These pin the invariants the
// three-reviewer pass called out: return creates a DRAFT review + DRAFT invoice
// and does NOT move the student's balance (nothing is owed until approval).
const closeSrc = readFileSync(path.resolve(__dirname, "../src/app/api/dispatch/[id]/close/route.ts"), "utf8");

describe("closeout ADR-025 flip (source invariants)", () => {
  it("creates a DRAFT Revenue Review wrapping a DRAFT invoice", () => {
    expect(closeSrc).toMatch(/tx\.revenueReview\.create/);
    expect(closeSrc).toMatch(/status:\s*"DRAFT"/);
  });
  it("does NOT decrement the student's account balance at closeout", () => {
    expect(closeSrc).not.toMatch(/accountBalance:\s*\{\s*decrement/);
  });
  it("still claims the RELEASED→CLOSED transition atomically (do-not-break rule 5)", () => {
    expect(closeSrc).toMatch(/updateMany\(\{[\s\S]*status:\s*"RELEASED"/);
    expect(closeSrc).toMatch(/\.count\s*===\s*0/);
  });
});

describe("Revenue Review status machine (doc 03)", () => {
  it("allows the happy-path lifecycle DRAFT → … → APPROVED", () => {
    expect(canTransition("DRAFT", "AWAITING_INSTRUCTOR_REVIEW")).toBe(true);
    expect(canTransition("AWAITING_INSTRUCTOR_REVIEW", "AWAITING_OPERATIONS_REVIEW")).toBe(true);
    expect(canTransition("AWAITING_OPERATIONS_REVIEW", "APPROVED")).toBe(true);
  });

  it("supports the changes-requested loop and void-before-approval", () => {
    expect(canTransition("AWAITING_OPERATIONS_REVIEW", "CHANGES_REQUESTED")).toBe(true);
    expect(canTransition("CHANGES_REQUESTED", "AWAITING_OPERATIONS_REVIEW")).toBe(true);
    expect(canTransition("DRAFT", "VOIDED")).toBe(true);
    expect(canTransition("AWAITING_INSTRUCTOR_REVIEW", "VOIDED")).toBe(true);
  });

  it("forbids illegal jumps (no skipping approval, no un-approving to draft)", () => {
    expect(canTransition("DRAFT", "APPROVED")).toBe(false);
    expect(canTransition("DRAFT", "PAID")).toBe(false);
    expect(canTransition("APPROVED", "DRAFT")).toBe(false);
    expect(canTransition("APPROVED", "AWAITING_OPERATIONS_REVIEW")).toBe(false);
  });

  it("terminal states have no outbound transitions", () => {
    for (const s of ["REFUNDED", "VOIDED", "WRITTEN_OFF"] as const) {
      expect(REVIEW_TRANSITIONS[s]).toEqual([]);
    }
  });

  it("freezes the snapshot at APPROVED and everything after; not before", () => {
    expect(isFrozen("DRAFT")).toBe(false);
    expect(isFrozen("AWAITING_OPERATIONS_REVIEW")).toBe(false);
    expect(isFrozen("CHANGES_REQUESTED")).toBe(false);
    expect(isFrozen("APPROVED")).toBe(true);
    expect(isFrozen("PAID")).toBe(true);
    expect(isFrozen("REFUNDED")).toBe(true);
  });

  it("formats zero-padded human numbers", () => {
    expect(reviewNumber(42)).toBe("RR-00042");
    expect(invoiceNumber(7)).toBe("INV-00007");
  });
});
