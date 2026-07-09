import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { NAV_GROUPS, NAV_ITEMS } from "@/components/shell/nav-config";
import { SECTION_PERMISSIONS } from "@/lib/rbac";

const SRC = path.resolve(__dirname, "../src");

describe("sidebar navigation groups", () => {
  it("flat NAV_ITEMS is exactly the grouped items, in order, with no duplicates", () => {
    const grouped = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href));
    expect(grouped).toEqual(NAV_ITEMS.map((i) => i.href));
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("every grouped destination is permission-mapped (no orphan nav entries)", () => {
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        expect(SECTION_PERMISSIONS[item.href], `${item.href} missing from SECTION_PERMISSIONS`).toBeDefined();
      }
    }
  });

  it("groups are non-empty and labelled", () => {
    for (const group of NAV_GROUPS) {
      expect(group.label.length).toBeGreaterThan(0);
      expect(group.items.length).toBeGreaterThan(0);
    }
  });
});

// Regression guard for the sidebar hydration mismatch: the collapsed state must
// initialize identically on the server and the client's first render, so no
// browser global may be read during render — only inside effects/handlers.
describe("sidebar hydration safety", () => {
  const src = readFileSync(path.join(SRC, "components/shell/sidebar.tsx"), "utf8");

  it("initializes collapsed state without reading browser globals", () => {
    expect(src).toMatch(/useState\(false\)/);
    // No lazy initializer that reads localStorage/document at first render.
    expect(src).not.toMatch(/useState\(\s*\(\)\s*=>[\s\S]*?(localStorage|document)/);
  });

  it("never touches document, localStorage, or window in the render body", () => {
    // The JSX return — `return (` immediately followed by the root element,
    // not the `return () =>` effect-cleanup arrows earlier in the file.
    const match = src.match(/return \(\s*</);
    expect(match, "could not locate the JSX return").not.toBeNull();
    const renderBody = src.slice(match!.index!);
    expect(renderBody).not.toMatch(/localStorage/);
    expect(renderBody).not.toMatch(/document\./);
    expect(renderBody).not.toMatch(/window\./);
  });
});
