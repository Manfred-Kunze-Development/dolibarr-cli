import { describe, it, expect } from "vitest";
import { kebab, baseCommandName, pathParamNames, assignCommandNames } from "../../src/naming.js";

describe("kebab", () => {
  it("splits camelCase", () => expect(kebab("CreateLine")).toBe("create-line"));
  it("handles acronym runs", () => expect(kebab("GetByRefExt")).toBe("get-by-ref-ext"));
});

describe("baseCommandName", () => {
  it("maps root CRUD verbs", () => {
    expect(baseCommandName("listThirdparties", "thirdparties")).toBe("list");
    expect(baseCommandName("retrieveThirdparties", "thirdparties")).toBe("get");
    expect(baseCommandName("createThirdparties", "thirdparties")).toBe("create");
    expect(baseCommandName("updateThirdparties", "thirdparties")).toBe("update");
    expect(baseCommandName("removeThirdparties", "thirdparties")).toBe("delete");
  });

  it("strips the module prefix and normalises the leading verb", () => {
    expect(baseCommandName("thirdpartiesRetrieveByEmail", "thirdparties")).toBe("get-by-email");
    expect(baseCommandName("invoicesCreateLine", "invoices")).toBe("create-line");
    expect(baseCommandName("invoicesRemoveLine", "invoices")).toBe("delete-line");
    expect(baseCommandName("productsDelSubproducts", "products")).toBe("delete-subproducts");
    expect(baseCommandName("thirdpartiesMerge", "thirdparties")).toBe("merge");
  });
});

describe("pathParamNames", () => {
  it("extracts braces in order", () => {
    expect(pathParamNames("/thirdparties/{id}/accounts/{site}")).toEqual(["id", "site"]);
    expect(pathParamNames("/invoices")).toEqual([]);
  });
});

describe("assignCommandNames", () => {
  it("disambiguates a duplicate operationId by its extra path parameter", () => {
    // Real case from live Dolibarr 23.0.3.
    const ops = [
      { operationId: "thirdpartiesCreateSocieteAccount", method: "post", path: "/thirdparties/{id}/accounts" },
      { operationId: "thirdpartiesCreateSocieteAccount", method: "post", path: "/thirdparties/{id}/accounts/{site}" },
    ];
    const named = assignCommandNames(ops, "thirdparties");
    expect(named.map((o) => o.command).sort()).toEqual([
      "create-societe-account",
      "create-societe-account-by-site",
    ]);
  });

  it("is deterministic regardless of input order", () => {
    const a = [
      { operationId: "listInvoices", method: "get", path: "/invoices" },
      { operationId: "createInvoices", method: "post", path: "/invoices" },
    ];
    const b = [...a].reverse();
    expect(assignCommandNames(a, "invoices")).toEqual(assignCommandNames(b, "invoices"));
  });
});

describe("assignCommandNames — collision hardening", () => {
  it("never lets a disambiguated name collide with another operation's base name", () => {
    // Found by review. Disambiguating the duplicate pair produces
    // "create-societe-account-by-site", which is ALSO the natural base name of
    // the third operation. Commander throws on duplicate registration, so this
    // would prevent the CLI from starting at all.
    const ops = [
      { operationId: "thirdpartiesCreateSocieteAccount", method: "post", path: "/thirdparties/{id}/accounts" },
      { operationId: "thirdpartiesCreateSocieteAccount", method: "post", path: "/thirdparties/{id}/accounts/{site}" },
      { operationId: "thirdpartiesCreateSocieteAccountBySite", method: "post", path: "/thirdparties/{id}/socacc/{site}" },
    ];
    const names = assignCommandNames(ops, "thirdparties").map((o) => o.command);
    expect(new Set(names).size).toBe(3);
  });

  it("resolves collisions between paths with equal parameter counts", () => {
    const ops = [
      { operationId: "dupOp", method: "get", path: "/alpha/{id}" },
      { operationId: "dupOp", method: "get", path: "/beta/{ref}" },
      { operationId: "dupOp", method: "post", path: "/alpha/{id}" },
    ];
    const names = assignCommandNames(ops, "things").map((o) => o.command);
    expect(new Set(names).size).toBe(3);
  });

  it("emits only well-formed command names", () => {
    const ops = [
      { operationId: "dupOp", method: "get", path: "/a/{id}" },
      { operationId: "dupOp", method: "post", path: "/a/{id}" },
      { operationId: "", method: "get", path: "/b/{x}" },
      { operationId: "thingsUpdateBy", method: "put", path: "/c/{notification_id}" },
    ];
    for (const { command } of assignCommandNames(ops, "things")) {
      expect(command).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("sorts by codepoint so results do not depend on the host locale", () => {
    // ICU orders "{" before letters; codepoint order puts it after ("t" 0x74 <
    // "{" 0x7B). The sort decides which member of a collision group is emitted
    // first and which keeps the plain base name, so a locale-sensitive
    // comparator would make output vary with the host's Node build.
    // Under localeCompare this comes back reversed.
    const ops = [
      { operationId: "dupOp", method: "get", path: "/bankaccounts/{id}" },
      { operationId: "dupOp", method: "get", path: "/bankaccounts/transfer" },
    ];
    const named = assignCommandNames(ops, "bankaccounts");
    expect(named.map((o) => o.path)).toEqual(["/bankaccounts/transfer", "/bankaccounts/{id}"]);
    expect(named.map((o) => o.command)).toEqual(["dup-op", "dup-op-by-id"]);
  });
});
