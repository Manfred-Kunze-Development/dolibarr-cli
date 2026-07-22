import { describe, it, expect } from "vitest";
import { buildBody, checkRequired } from "../../src/lib/body.js";

describe("buildBody", () => {
  it("returns undefined when nothing is supplied", () => {
    expect(buildBody({})).toBeUndefined();
  });

  it("parses inline JSON", () => {
    expect(buildBody({ data: '{"name":"ACME"}' })).toEqual({ name: "ACME" });
  });

  it("applies --set on top of --data", () => {
    expect(buildBody({ data: '{"name":"ACME","client":1}', set: ["client=2"] }))
      .toEqual({ name: "ACME", client: 2 });
  });

  it("coerces numbers and booleans but keeps other strings", () => {
    expect(buildBody({ set: ["a=1", "b=true", "c=hello", "d=1.5"] }))
      .toEqual({ a: 1, b: true, c: "hello", d: 1.5 });
  });

  it("supports dot paths", () => {
    expect(buildBody({ set: ["a.b=1"] })).toEqual({ a: { b: 1 } });
  });

  it("routes extrafields into array_options", () => {
    expect(buildBody({ extrafield: ["colour=red"] }))
      .toEqual({ array_options: { options_colour: "red" } });
  });

  it("rejects a malformed --set", () => {
    expect(() => buildBody({ set: ["noequals"] })).toThrow(/key=value/);
  });

  it("rejects malformed JSON with a clear message", () => {
    expect(() => buildBody({ data: "{oops" })).toThrow(/not valid JSON/i);
  });
});

describe("checkRequired", () => {
  it("passes when all required fields are present", () => {
    expect(() => checkRequired("thirdparties", { name: "ACME" }, { thirdparties: ["name"] })).not.toThrow();
  });

  it("names every missing field", () => {
    expect(() => checkRequired("bankaccounts", { ref: "x" }, { bankaccounts: ["ref", "label", "type"] }))
      .toThrow(/label, type/);
  });

  it("is a no-op for modules with no known requirements", () => {
    expect(() => checkRequired("unknown", {}, {})).not.toThrow();
  });
});

describe("buildBody — data integrity and safety", () => {
  it("preserves leading zeros instead of coercing to a number", () => {
    // Dolibarr has real fields where a leading zero is significant: postal
    // codes, account refs, barcodes, phone numbers with a trunk prefix.
    expect(buildBody({ set: ["zip=01234"] })).toEqual({ zip: "01234" });
    expect(buildBody({ set: ["ref=007"] })).toEqual({ ref: "007" });
    expect(buildBody({ set: ["phone=0176"] })).toEqual({ phone: "0176" });
  });

  it("still coerces values that round-trip cleanly", () => {
    expect(buildBody({ set: ["a=1", "b=true", "c=hello", "d=1.5", "e=-3", "f=0"] }))
      .toEqual({ a: 1, b: true, c: "hello", d: 1.5, e: -3, f: 0 });
  });

  it("does not pollute Object.prototype via a __proto__ path", () => {
    // CWE-1321. cursor["__proto__"] resolves to Object.prototype, which passes
    // a naive typeof-object guard, so assignment lands on the real prototype
    // and poisons every object in the process.
    expect(() => buildBody({ set: ["__proto__.polluted=1"] })).toThrow(/unsafe|__proto__/i);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("rejects other prototype-walking segments", () => {
    expect(() => buildBody({ set: ["constructor.prototype.x=1"] })).toThrow(/unsafe|constructor/i);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it("explains a missing --data file in CLI terms", () => {
    expect(() => buildBody({ data: "@definitely-missing-file.json" }))
      .toThrow(/--data.*could not be read|could not read/i);
  });
});
