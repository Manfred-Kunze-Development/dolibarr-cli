import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const table = JSON.parse(readFileSync("src/data/required-fields.json", "utf8"));

describe("required-fields.json", () => {
  it("matches values extracted from the Dolibarr PHP source", () => {
    expect(table.thirdparties).toEqual(["name"]);
    expect(table.products).toEqual(["ref", "label"]);
    expect(table.orders).toEqual(["socid", "date"]);
    expect(table.bankaccounts).toEqual(["ref", "label", "type", "currency_code", "country_id"]);
    expect(table.stockmovements).toEqual(["product_id", "warehouse_id", "qty"]);
  });

  it("has no empty module keys", () => {
    for (const [module, fields] of Object.entries(table)) {
      expect(Array.isArray(fields), `${module} must map to an array`).toBe(true);
    }
  });
});

describe("required-fields.json is generator-canonical", () => {
  it("is byte-identical to what extract-fields.mjs produces", () => {
    // Keeping the committed file in the generator's exact output format makes
    // `npm run extract:fields && git diff --exit-code` a usable drift check
    // against a new Dolibarr major. Hand-formatting it would make every
    // regeneration show a cosmetic diff and hide real changes in the noise.
    const raw = readFileSync("src/data/required-fields.json", "utf8");
    const table = JSON.parse(raw);
    const canonical =
      JSON.stringify(
        Object.fromEntries(Object.entries(table).sort(([a], [b]) => a.localeCompare(b))),
        null,
        2,
      ) + "\n";
    expect(raw.split("\r\n").join("\n")).toBe(canonical);
  });
});
