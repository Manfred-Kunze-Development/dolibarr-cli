import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fetchSpec, specUrlFor } from "../../src/commands/sync.js";

const cfg = { baseUrl: "http://host/api/index.php", apiKey: "k" };

describe("specUrlFor", () => {
  it("targets the explorer document", () => {
    expect(specUrlFor(cfg.baseUrl)).toBe("http://host/api/index.php/explorer/swagger.json");
  });
});

describe("fetchSpec", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the parsed spec", async () => {
    const spec = JSON.parse(readFileSync("openapi/swagger-23.0.3.json", "utf8"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(spec), { status: 200 })));
    const result = await fetchSpec(cfg);
    expect(result.swagger).toBe("2.0");
  });

  it("explains a disabled explorer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 403 })));
    await expect(fetchSpec(cfg)).rejects.toThrow(/API_EXPLORER_DISABLED|--spec/);
  });

  it("explains the api/temp failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("Erreur temp dir api/temp not writable", { status: 500 })));
    await expect(fetchSpec(cfg)).rejects.toThrow(/api\/temp/);
  });
});
