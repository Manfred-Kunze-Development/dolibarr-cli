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
