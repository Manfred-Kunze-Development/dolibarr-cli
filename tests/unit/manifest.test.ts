import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildManifest } from "../../src/manifest.js";

const load = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const reference = load("openapi/swagger-reference-38mod.json");
const live23 = load("openapi/swagger-23.0.3.json");
const AT = "2026-07-22T00:00:00Z";

describe("buildManifest", () => {
  it("groups the reference spec into 38 modules and 440 operations", () => {
    const m = buildManifest(reference, { fetchedAt: AT });
    expect(Object.keys(m.modules)).toHaveLength(38);
    const total = Object.values(m.modules).reduce((n, mod) => n + mod.operations.length, 0);
    expect(total).toBe(440);
  });

  it("groups the live 23.0.3 spec into 30 modules and 428 operations", () => {
    const m = buildManifest(live23, { fetchedAt: AT });
    expect(Object.keys(m.modules)).toHaveLength(30);
    const total = Object.values(m.modules).reduce((n, mod) => n + mod.operations.length, 0);
    expect(total).toBe(428);
  });

  it("gives every operation a unique command name within its module", () => {
    for (const spec of [reference, live23]) {
      const m = buildManifest(spec, { fetchedAt: AT });
      for (const [name, mod] of Object.entries(m.modules)) {
        const commands = mod.operations.map((o) => o.command);
        expect(new Set(commands).size, `duplicate command in ${name}`).toBe(commands.length);
      }
    }
  });

  it("captures params and body presence", () => {
    const m = buildManifest(reference, { fetchedAt: AT });
    const list = m.modules.thirdparties.operations.find((o) => o.command === "list")!;
    expect(list.method).toBe("get");
    expect(list.path).toBe("/thirdparties");
    expect(list.query.map((q) => q.name)).toContain("sqlfilters");
    expect(list.hasBody).toBe(false);

    const create = m.modules.thirdparties.operations.find((o) => o.command === "create")!;
    expect(create.hasBody).toBe(true);

    const get = m.modules.thirdparties.operations.find((o) => o.command === "get")!;
    expect(get.pathParams.map((p) => p.name)).toEqual(["id"]);
  });

  it("preserves basePath", () => {
    expect(buildManifest(reference, { fetchedAt: AT }).basePath).toBe("/api/index.php");
  });

  it("harvests PATCH operations", () => {
    // The reference spec has exactly one PATCH. Dropping it would lose an
    // endpoint while still claiming complete coverage, and the live 23.0.3
    // fixture cannot catch that because it contains no PATCH at all.
    const m = buildManifest(reference, { fetchedAt: AT });
    const patched = m.modules.thirdparties.operations.filter((o) => o.method === "patch");
    expect(patched).toHaveLength(1);
    expect(patched[0].path).toBe("/thirdparties/{id}/accounts/{site}");
  });
});
