import { describe, expect, it } from "vitest";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolveDataArg } from "../../src/lib/data-file.js";

describe("resolveDataArg", () => {
  it("passes plain strings through", () => {
    expect(resolveDataArg('{"a":1}')).toBe('{"a":1}');
    expect(resolveDataArg(undefined)).toBeUndefined();
  });

  it("reads @file contents", () => {
    writeFileSync("tmp-data.json", '{"b":2}', "utf8");
    try {
      expect(resolveDataArg("@tmp-data.json")).toBe('{"b":2}');
    } finally {
      rmSync("tmp-data.json");
    }
  });

  it("names --data in the read error", () => {
    expect(() => resolveDataArg("@does-not-exist.json")).toThrow(
      /--data file could not be read: does-not-exist.json/,
    );
  });

  it("body.ts stays free of node imports", () => {
    expect(readFileSync("src/lib/body.ts", "utf8")).not.toMatch(/from ["']node:/);
  });
});
