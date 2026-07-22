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

describe("fetchSpec — entity scoping and timeouts", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends DOLAPIENTITY so the tree matches the entity commands will run against", async () => {
    // Verified on a live 23.0.3: the explorer document is entity-sensitive.
    // No header or entity=1 yields 287 paths; entity=2 yields 1. Syncing
    // without the header builds the entity-1 tree while every generated command
    // then targets the configured entity — the two halves silently disagree.
    const spec = JSON.parse(readFileSync("openapi/swagger-23.0.3.json", "utf8"));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(spec), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchSpec({ ...cfg, entity: "2" });
    expect((fetchMock.mock.calls[0] as any)[1].headers.DOLAPIENTITY).toBe("2");
  });

  it("honours an explicit timeout", async () => {
    const fetchMock = vi.fn(async (_u: string, init: { signal: AbortSignal }) => {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: () =>
          new Promise<string>((_res, rej) => {
            init.signal.addEventListener("abort", () => {
              const e = new Error("aborted");
              e.name = "AbortError";
              rej(e);
            });
          }),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchSpec(cfg, { timeoutMs: 100 })).rejects.toThrow(/timed out/i);
  });

  it("reports the underlying cause of a connection failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("unable to verify the first certificate");
    }));
    await expect(fetchSpec(cfg)).rejects.toThrow(/unable to verify the first certificate/);
  });
});
