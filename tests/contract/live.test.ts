// tests/contract/live.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { liveConfig, instanceAvailable, skipReason } from "./setup.js";
import { request } from "../../src/lib/client.js";
import { fetchSpec } from "../../src/commands/sync.js";
import { buildManifest } from "../../src/manifest.js";
import { DolibarrApiError } from "../../src/lib/errors.js";

// Availability is only known once beforeAll has run, which is AFTER vitest
// collects tests. `it.skipIf` is evaluated at collection time and would
// therefore always see the initial value, so skip from inside each test.
let available = false;
beforeAll(async () => {
  available = await instanceAvailable();
  if (!available) console.warn(skipReason());
});

const live = (name: string, fn: () => Promise<void>, timeout?: number) =>
  it(name, async (ctx) => {
    if (!available) ctx.skip();
    await fn();
  }, timeout);

describe("live Dolibarr", () => {
  live("authenticates and reports a version", async () => {
    const status = (await request(liveConfig, { method: "get", path: "/status" })) as any;
    expect(status.success.dolibarr_version).toMatch(/^\d+\.\d+/);
  });

  live("rejects a bad API key with 401", async () => {
    await expect(request({ ...liveConfig, apiKey: "wrong" }, { method: "get", path: "/status" }))
      .rejects.toBeInstanceOf(DolibarrApiError);
  });

  live("serves a spec that builds a non-empty manifest", async () => {
    const spec = await fetchSpec(liveConfig);
    const manifest = buildManifest(spec, { fetchedAt: new Date().toISOString() });
    expect(Object.keys(manifest.modules).length).toBeGreaterThan(10);
    for (const [name, mod] of Object.entries(manifest.modules)) {
      const commands = mod.operations.map((o) => o.command);
      expect(new Set(commands).size, `duplicate command in ${name}`).toBe(commands.length);
    }
  }, 240_000);

  live("returns a bare array for lists, with no total", async () => {
    const result = await request(liveConfig, {
      method: "get", path: "/thirdparties", query: { limit: 1 },
    });
    expect(Array.isArray(result)).toBe(true);
  });

  live("round-trips a thirdparty", async () => {
    const created = (await request(liveConfig, {
      method: "post", path: "/thirdparties", body: { name: "dolibarr-cli contract test" },
    })) as number;
    // Dolibarr answers create with a bare JSON integer. Note it is inconsistent:
    // reading the same record back returns `id` as a STRING.
    expect(typeof created).toBe("number");

    // finally, not a trailing call: an assertion failure between create and
    // delete would otherwise orphan the record permanently, and repeated CI
    // failures would accumulate junk in whatever instance is configured.
    try {
      const fetched = (await request(liveConfig, {
        method: "get", path: "/thirdparties/{id}", pathParams: { id: String(created) },
      })) as any;
      expect(fetched.name).toBe("dolibarr-cli contract test");
    } finally {
      await request(liveConfig, {
        method: "delete", path: "/thirdparties/{id}", pathParams: { id: String(created) },
      }).catch(() => {
        console.warn(`Could not delete contract-test thirdparty ${created}; remove it manually.`);
      });
    }
  });

});
