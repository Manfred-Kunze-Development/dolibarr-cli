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

describe("buildBody — array and extrafield integrity", () => {
  it("edits an element inside an array without destroying the rest", () => {
    // Found in final review. Replacing the array with a fresh object turned
    // {"lines":[{desc,qty},{desc,qty}]} into {"lines":{"0":{"qty":9}}} — both
    // descriptions and the second line silently deleted on the way to a live
    // ERP. The README teaches exactly this --data-as-template pattern.
    const body = buildBody({
      data: '{"socid":1,"lines":[{"desc":"line one","qty":2},{"desc":"line two","qty":3}]}',
      set: ["lines.0.qty=9"],
    });
    expect(body).toEqual({
      socid: 1,
      lines: [
        { desc: "line one", qty: 9 },
        { desc: "line two", qty: 3 },
      ],
    });
  });

  it("refuses a non-numeric key into an array rather than dropping it", () => {
    expect(() =>
      buildBody({ data: '{"lines":[{"qty":1}]}', set: ["lines.total=5"] }),
    ).toThrow(/array/i);
  });

  it("sets an extrafield even when --data carries an empty array_options", () => {
    // Dolibarr returns "array_options": [] on every record, so dump-edit-resend
    // hit this every time: the extrafield was written onto an array and dropped
    // by JSON.stringify.
    expect(buildBody({ data: '{"array_options":[]}', extrafield: ["colour=red"] }))
      .toEqual({ array_options: { options_colour: "red" } });
  });

  it("merges into an existing array_options object", () => {
    expect(buildBody({ data: '{"array_options":{"options_a":"1"}}', extrafield: ["b=2"] }))
      .toEqual({ array_options: { options_a: "1", options_b: "2" } });
  });

  it("refuses to write past the end of an array instead of padding with nulls", () => {
    // The intermediate segments were bounds-checked but the final one was not,
    // so `--set lines.9=x` on a 2-element array shipped seven fabricated null
    // line items to the ERP.
    expect(() => buildBody({ data: '{"lines":[{"desc":"a"},{"desc":"b"}]}', set: ["lines.9=x"] }))
      .toThrow(/out of range/i);
    // Appending to the end is still allowed.
    expect(buildBody({ data: '{"lines":[1,2]}', set: ["lines.2=3"] }))
      .toEqual({ lines: [1, 2, 3] });
  });

  it("rejects an index too large to be stored as an array element", () => {
    // /^\d+$/ accepted these, but JS stores them as named properties and
    // JSON.stringify drops them — silent loss, the same class as the
    // array_options bug.
    expect(() => buildBody({ data: '{"lines":[1]}', set: ["lines.4294967296=x"] }))
      .toThrow(/valid index/i);
  });
});
