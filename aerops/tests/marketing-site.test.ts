import { describe, expect, it } from "vitest";
import { SOLUTIONS } from "../src/components/marketing/solutions-data";

describe("marketing site solutions", () => {
  it("includes the requested flight school and aviation growth paths", () => {
    const slugs = SOLUTIONS.map((solution) => solution.slug);

    expect(slugs).toEqual(
      expect.arrayContaining([
        "flight-schools",
        "flying-clubs",
        "university-aviation-programs",
        "corporate-aviation",
      ]),
    );
  });
});
