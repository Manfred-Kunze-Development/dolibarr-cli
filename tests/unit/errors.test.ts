import { describe, it, expect } from "vitest";
import { DolibarrApiError, hintFor, parseErrorBody } from "../../src/lib/errors.js";

describe("parseErrorBody", () => {
  it("reads Dolibarr's nested error shape", () => {
    expect(parseErrorBody({ error: { code: 404, message: "Thirdparty not found" } }))
      .toBe("Thirdparty not found");
  });
  it("falls back to a stringified body", () => {
    expect(parseErrorBody({ weird: true })).toContain("weird");
  });
  it("tolerates null", () => expect(parseErrorBody(null)).toBe(""));
});

describe("hintFor", () => {
  it("explains an unauthorised key", () => {
    expect(hintFor(new DolibarrApiError(401, "x"), [])).toMatch(/api key/i);
  });

  it("explains a 404 on a module the instance does not expose", () => {
    const err = new DolibarrApiError(404, "not found", { module: "mos" });
    const hint = hintFor(err, ["invoices", "thirdparties"]);
    expect(hint).toMatch(/not enabled/i);
    expect(hint).toContain("mos");
  });

  it("gives the ordinary 404 hint when the module does exist", () => {
    const err = new DolibarrApiError(404, "not found", { module: "invoices" });
    expect(hintFor(err, ["invoices"])).toMatch(/id/i);
  });

  it("explains the api/temp failure", () => {
    const err = new DolibarrApiError(500, "Erreur temp dir api/temp not writable");
    expect(hintFor(err, [])).toMatch(/activateModule|api\/temp/i);
  });
});
