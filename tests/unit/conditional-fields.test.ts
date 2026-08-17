import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { ConditionalRule } from "../../src/lib/body.js";

const table: Record<string, ConditionalRule[]> = JSON.parse(
  readFileSync("src/data/conditional-fields.json", "utf8"),
);

describe("conditional-fields.json", () => {
  it("carries the thirdparty code rules verified against the Dolibarr source", () => {
    expect(table.thirdparties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ when: { field: "client", not: 0 }, require: "code_client" }),
        expect.objectContaining({
          when: { field: "fournisseur", eq: 1 },
          require: "code_fournisseur",
        }),
      ]),
    );
  });

  it("is well-formed: every rule names a trigger, a comparison and a required field", () => {
    for (const [module, rules] of Object.entries(table)) {
      expect(Array.isArray(rules), `${module} must map to an array`).toBe(true);
      for (const rule of rules) {
        expect(typeof rule.when?.field, `${module}.when.field`).toBe("string");
        expect(typeof rule.require, `${module}.require`).toBe("string");
        const comparisons = [rule.when.eq, rule.when.not].filter((v) => v !== undefined);
        expect(comparisons.length, `${module}.${rule.require} needs exactly one of eq/not`).toBe(1);
      }
    }
  });
});

describe("conditional-fields.json is hand-maintained", () => {
  it("is never written by the field extractor", () => {
    // This is the whole reason the rules do not live in required-fields.json:
    // extract-fields.mjs rewrites that file wholesale, and per the version
    // support policy it re-runs on every roll of the supported-major window.
    // Hand-written entries there would be silently destroyed. See issue #8.
    const extractor = readFileSync("scripts/extract-fields.mjs", "utf8");
    expect(extractor).not.toContain("conditional-fields");
  });
});
