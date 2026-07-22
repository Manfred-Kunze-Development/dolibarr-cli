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
