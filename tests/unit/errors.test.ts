import { describe, it, expect, vi, afterEach } from "vitest";
import { DolibarrApiError, handleError, hintFor, parseError, parseErrorBody } from "../../src/lib/errors.js";

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

describe("parseError", () => {
  // Captured verbatim from a live 22.0.4 instance: creating a thirdparty with
  // client=2 and no code_client. Restler serialises the PHP
  // array_merge($obj->error, $obj->errors) into numeric string keys sitting
  // next to `message`, which is where the only usable diagnosis lives.
  const createFailure = {
    error: {
      code: 500,
      message: "Internal Server Error: Error creating thirdparty",
      "0": "",
      "1": "ErrorCustomerCodeRequired",
    },
    debug: { source: "api_thirdparties.class.php:324 at call stage" },
  };

  it("keeps the message", () => {
    expect(parseError(createFailure).message).toBe(
      "Internal Server Error: Error creating thirdparty",
    );
  });

  it("recovers the numeric detail keys that name the real cause", () => {
    expect(parseError(createFailure).details).toEqual(["ErrorCustomerCodeRequired"]);
  });

  it("drops empty numeric keys rather than emitting blank detail lines", () => {
    // error["0"] is $obj->error, which Dolibarr commonly leaves empty.
    expect(parseError(createFailure).details).not.toContain("");
  });

  it("orders details numerically, not by string collation", () => {
    const body = {
      error: { message: "boom", "2": "third", "10": "eleventh", "1": "second" },
    };
    expect(parseError(body).details).toEqual(["second", "third", "eleventh"]);
  });

  it("surfaces debug.source as the PHP file:line pointer", () => {
    expect(parseError(createFailure).source).toBe(
      "api_thirdparties.class.php:324 at call stage",
    );
  });

  it("reports no details for the update path, which sends none at all", () => {
    // put() throws RestException(500, $this->company->error) — the singular
    // field, which verify() leaves empty. Nothing but a generic message arrives.
    const updateFailure = { error: { code: 500, message: "Internal Server Error" } };
    expect(parseError(updateFailure).details).toEqual([]);
    expect(parseError(updateFailure).source).toBeUndefined();
  });

  it("ignores the numeric-looking `code` key", () => {
    expect(parseError(createFailure).details).not.toContain(500);
  });

  it("tolerates a plain string body", () => {
    expect(parseError("gateway down")).toEqual({ message: "gateway down", details: [] });
  });

  it("tolerates null", () => {
    expect(parseError(null)).toEqual({ message: "", details: [] });
  });
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

describe("handleError — detail rendering", () => {
  const captured: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    captured.length = 0;
    process.exitCode = 0;
  });

  const capture = () => {
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      captured.push(args.map(String).join(" "));
    });
    return () => captured.join("\n");
  };

  const createFailure = new DolibarrApiError(500, "Internal Server Error: Error creating thirdparty", {
    details: ["ErrorCustomerCodeRequired"],
    source: "api_thirdparties.class.php:324 at call stage",
  });

  it("prints the detail that names the real cause", () => {
    const output = capture();
    handleError(createFailure, false);
    expect(output()).toContain("ErrorCustomerCodeRequired");
  });

  it("prints the PHP source pointer", () => {
    const output = capture();
    handleError(createFailure, false);
    expect(output()).toContain("api_thirdparties.class.php:324");
  });

  it("includes details in --json output so pipelines can read them", () => {
    const output = capture();
    handleError(createFailure, true);
    const parsed = JSON.parse(output());
    expect(parsed.details).toEqual(["ErrorCustomerCodeRequired"]);
    expect(parsed.source).toBe("api_thirdparties.class.php:324 at call stage");
  });

  it("emits valid JSON with no details key when there are none", () => {
    const output = capture();
    handleError(new DolibarrApiError(404, "Not found"), true);
    const parsed = JSON.parse(output());
    expect(parsed.status).toBe(404);
    expect(parsed.details).toBeUndefined();
  });

  it("still sets a failing exit code", () => {
    capture();
    handleError(createFailure, false);
    expect(process.exitCode).toBe(1);
  });
});

describe("hintFor — detail-less 500", () => {
  it("says the server sent no detail, rather than an opaque generic error", () => {
    // The update path: put() throws RestException(500, $this->company->error),
    // the singular field verify() leaves empty. Nothing arrives to explain it.
    const err = new DolibarrApiError(500, "Internal Server Error", { details: [] });
    expect(hintFor(err, [])).toMatch(/no detail/i);
  });

  it("does not claim missing detail when detail was in fact returned", () => {
    const err = new DolibarrApiError(500, "Error creating thirdparty", {
      details: ["ErrorCustomerCodeRequired"],
    });
    expect(hintFor(err, [])).not.toMatch(/no detail/i);
  });

  it("does not send the user to the server log when the cause is already printed", () => {
    // The generic 500 hint reads "Check its logs for detail" — directly
    // contradicting the detail rendered one line above it.
    const err = new DolibarrApiError(500, "Error creating thirdparty", {
      details: ["ErrorCustomerCodeRequired"],
    });
    expect(hintFor(err, [])).toBe("");
  });

  it("still explains api/temp even though that 500 carries no details", () => {
    const err = new DolibarrApiError(500, "Erreur temp dir api/temp not writable", { details: [] });
    expect(hintFor(err, [])).toMatch(/activateModule/i);
  });
});
