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
