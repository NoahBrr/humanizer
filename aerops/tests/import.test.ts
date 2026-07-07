import { describe, it, expect } from "vitest";
import { parseCsv, parsePaste } from "@/lib/import/parse";
import { IMPORT_SPECS, specOf, suggestMapping, templateCsv } from "@/lib/import/spec";
import { prepareRows, findInFileDuplicates } from "@/lib/import/engine";

/** Import Center engine contracts (parsing, mapping, validation, dedupe). */

describe("CSV / paste parsing", () => {
  it("parses quoted fields, escaped quotes, and embedded newlines", () => {
    const t = parseCsv('Name,Notes\n"Nguyen, Taylor","He said ""hi""\nsecond line"\nMarcus,plain');
    expect(t.columns).toEqual(["Name", "Notes"]);
    expect(t.rows[0].Name).toBe("Nguyen, Taylor");
    expect(t.rows[0].Notes).toContain('"hi"');
    expect(t.rows[0].Notes).toContain("second line");
    expect(t.totalRows).toBe(2);
  });

  it("parses tab-separated paste and skips template comment rows", () => {
    const t = parsePaste("Tail\tMake\n# guidance row,ignore\nN735GG\tCessna");
    expect(t.columns).toEqual(["Tail", "Make"]);
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0].Tail).toBe("N735GG");
  });
});

describe("auto-mapping", () => {
  it("maps aliases and source-specific headers", () => {
    const spec = specOf("aircraft")!;
    const mapping = suggestMapping(spec, ["Tail #", "Make", "Model", "Wet Rate", "Hobbs"], "flight-circle");
    expect(mapping.tailNumber).toBe("Tail #");
    expect(mapping.manufacturer).toBe("Make");
    expect(mapping.hourlyRateWet).toBe("Wet Rate");
    expect(mapping.currentHobbs).toBe("Hobbs");
  });

  it("QuickBooks invoice headers map to invoice fields", () => {
    const spec = specOf("invoices")!;
    const mapping = suggestMapping(spec, ["Num", "Customer", "Open Balance"], "quickbooks");
    expect(mapping.number).toBe("Num");
    expect(mapping.customerEmail).toBe("Customer");
    expect(mapping.total).toBe("Open Balance");
  });
});

describe("row validation", () => {
  const spec = specOf("students")!;

  it("coerces types, splits full names, and flags bad values with row numbers", () => {
    const prepared = prepareRows(spec, [
      { Name: "Taylor Nguyen", Email: "taylor@example.com", Balance: "$1,204.50" },
      { Name: "Bad Row", Email: "not-an-email", Balance: "abc" },
    ], { fullName: "Name", email: "Email", accountBalance: "Balance" });

    expect(prepared[0].errors).toEqual([]);
    expect(prepared[0].values.firstName).toBe("Taylor");
    expect(prepared[0].values.lastName).toBe("Nguyen");
    expect(prepared[0].values.accountBalance).toBe(1204.5);
    expect(prepared[0].row).toBe(2); // header is row 1

    expect(prepared[1].row).toBe(3);
    expect(prepared[1].errors.join(" ")).toMatch(/email/i);
    expect(prepared[1].errors.join(" ")).toMatch(/number/i);
  });

  it("requires required fields", () => {
    const prepared = prepareRows(spec, [{ Email: "x@y.com" }], { email: "Email" });
    expect(prepared[0].errors.join(" ")).toMatch(/First name/);
  });

  it("detects in-file duplicates by the spec's keys", () => {
    const prepared = prepareRows(spec, [
      { First: "A", Last: "B", Email: "same@x.com" },
      { First: "C", Last: "D", Email: "same@x.com" },
    ], { firstName: "First", lastName: "Last", email: "Email" });
    const dupes = findInFileDuplicates(spec, prepared);
    expect(dupes).toHaveLength(1);
    expect(dupes[0].row).toBe(3);
    expect(dupes[0].message).toMatch(/row 2/);
  });
});

describe("templates", () => {
  it("every data type ships a template whose headers round-trip through the parser", () => {
    for (const spec of IMPORT_SPECS) {
      const csv = templateCsv(spec);
      const parsed = parseCsv(csv);
      expect(parsed.columns).toEqual(spec.fields.map((f) => f.label));
      expect(parsed.rows.length).toBe(spec.templateRows.length);
      // Template examples must themselves validate cleanly with a 1:1 mapping.
      const mapping = Object.fromEntries(spec.fields.map((f) => [f.key, f.label]));
      const prepared = prepareRows(spec, parsed.rows, mapping);
      for (const p of prepared) expect(p.errors).toEqual([]);
    }
  });
});
