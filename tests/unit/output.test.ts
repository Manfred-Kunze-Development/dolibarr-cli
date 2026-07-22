import { describe, it, expect } from "vitest";
import { pickColumns, formatFooter, renderValue } from "../../src/lib/output.js";

describe("pickColumns", () => {
  it("prefers the configured hint list, keeping only present fields", () => {
    const rows = [{ id: 1, ref: "FA-1", nonexistent: undefined, total_ttc: 10 }];
    expect(pickColumns(rows, ["id", "ref", "missing"], undefined)).toEqual(["id", "ref"]);
  });

  it("honours an explicit override", () => {
    expect(pickColumns([{ a: 1, b: 2 }], ["a"], ["b", "a"])).toEqual(["b", "a"]);
  });

  it("falls back to the first six scalar keys", () => {
    const row: Record<string, unknown> = {};
    for (let i = 0; i < 10; i++) row[`f${i}`] = i;
    row.nested = { x: 1 };
    expect(pickColumns([row], undefined, undefined)).toEqual(["f0", "f1", "f2", "f3", "f4", "f5"]);
  });

  it("returns an empty list for no rows", () => {
    expect(pickColumns([], undefined, undefined)).toEqual([]);
  });
});

describe("formatFooter", () => {
  it("never invents a total, because Dolibarr does not return one", () => {
    expect(formatFooter(20, 0)).toBe("20 results (page 1)");
    expect(formatFooter(3, 2)).toBe("3 results (page 3)");
  });
});

describe("renderValue", () => {
  it("renders nullish as a dash", () => expect(renderValue(null)).toBe("—"));
  it("stringifies objects", () => expect(renderValue({ a: 1 })).toBe('{"a":1}'));
  it("passes scalars through", () => expect(renderValue(42)).toBe("42"));
});
