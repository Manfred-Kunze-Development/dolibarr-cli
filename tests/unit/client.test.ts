import { describe, it, expect, vi, afterEach } from "vitest";
import { buildUrl, request } from "../../src/lib/client.js";
import { DolibarrApiError } from "../../src/lib/errors.js";

const cfg = { baseUrl: "http://host/api/index.php", apiKey: "k" };

describe("buildUrl", () => {
  it("substitutes path parameters", () => {
    expect(buildUrl(cfg.baseUrl, "/invoices/{id}", { id: "42" }, {}))
      .toBe("http://host/api/index.php/invoices/42");
  });

  it("url-encodes path parameters", () => {
    expect(buildUrl(cfg.baseUrl, "/thirdparties/email/{email}", { email: "a b@c.d" }, {}))
      .toContain("a%20b%40c.d");
  });

  it("appends query parameters and skips undefined", () => {
    const url = buildUrl(cfg.baseUrl, "/invoices", {}, { limit: 10, page: undefined, sortorder: "ASC" });
    expect(url).toBe("http://host/api/index.php/invoices?limit=10&sortorder=ASC");
  });

  it("strips trailing slashes from the base URL", () => {
    expect(buildUrl("http://host/api/index.php/", "/status", {}, {}))
      .toBe("http://host/api/index.php/status");
  });
});

describe("request", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the DOLAPIKEY header and returns parsed JSON", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ id: 1 }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await request(cfg, { method: "get", path: "/invoices" });
    expect(result).toEqual([{ id: 1 }]);
    expect((fetchMock.mock.calls[0] as any)[1].headers.DOLAPIKEY).toBe("k");
  });

  it("sends DOLAPIENTITY only when an entity is configured", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await request(cfg, { method: "get", path: "/status" });
    expect((fetchMock.mock.calls[0] as any)[1].headers.DOLAPIENTITY).toBeUndefined();

    await request({ ...cfg, entity: "2" }, { method: "get", path: "/status" });
    expect((fetchMock.mock.calls[1] as any)[1].headers.DOLAPIENTITY).toBe("2");
  });

  it("throws DolibarrApiError carrying the module for non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "Not Found" } }), { status: 404 })));

    await expect(request(cfg, { method: "get", path: "/mos/1", module: "mos" }))
      .rejects.toMatchObject({ status: 404, message: "Not Found", module: "mos" });
  });

  it("surfaces a non-JSON error body verbatim", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("Erreur temp dir api/temp not writable", { status: 500 })));

    await expect(request(cfg, { method: "get", path: "/explorer/swagger.json" }))
      .rejects.toThrow(/api\/temp not writable/);
  });
});
