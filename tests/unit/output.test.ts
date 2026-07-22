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
    expect(formatFooter(1, 0)).toBe("1 result (page 1)");
    expect(formatFooter(3, 2)).toBe("3 results (page 3)");
  });
});

describe("renderValue", () => {
  it("renders nullish as a dash", () => expect(renderValue(null)).toBe("—"));
  it("stringifies objects", () => expect(renderValue({ a: 1 })).toBe('{"a":1}'));
  it("passes scalars through", () => expect(renderValue(42)).toBe("42"));
});

describe("pickColumns — against real Dolibarr shapes", () => {
  // Key order in a Dolibarr entity is PHP property declaration order, not
  // business relevance. On a real 163-key thirdparty the first six keys are
  // module/id/entity/import_key/array_languages/contacts_ids — four of them
  // null — while `name` is at index 46. Declaration order is therefore useless
  // as a fallback, and most modules have no hint list.
  const realThirdparty = {
    module: "societe",
    id: 1,
    entity: 1,
    import_key: null,
    array_options: [],
    array_languages: null,
    contacts_ids: null,
    name: "Output Rendering Test Co",
    code_client: null,
    email: null,
    town: null,
    status: 1,
  };

  it("surfaces recognisable identifying fields when no hints are configured", () => {
    const columns = pickColumns([realThirdparty], undefined, undefined);
    expect(columns).toContain("name");
    expect(columns).toContain("id");
    expect(columns).not.toContain("import_key");
    expect(columns).not.toContain("array_languages");
  });

  it("still honours explicit hints over the heuristic", () => {
    expect(pickColumns([realThirdparty], ["town", "status"], undefined)).toEqual(["town", "status"]);
  });

  it("considers keys from every row, not only the first", () => {
    // A key absent from row 0 would otherwise be invisible for the whole table.
    const rows = [{ id: 1 }, { id: 2, ref: "FA-2" }];
    expect(pickColumns(rows, undefined, undefined)).toContain("ref");
  });

  it("never picks a column that is null in every row", () => {
    const columns = pickColumns([realThirdparty], undefined, undefined);
    for (const c of columns) {
      expect(realThirdparty[c as keyof typeof realThirdparty]).not.toBeNull();
    }
  });
});
