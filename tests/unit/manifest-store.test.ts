import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveManifestTo, loadManifestFrom } from "../../src/lib/manifest-store.js";
import type { Manifest } from "../../src/manifest.js";

let dir: string;
const manifest: Manifest = {
  dolibarrVersion: "23.0.3",
  fetchedAt: "2026-07-22T00:00:00Z",
  basePath: "/api/index.php",
  modules: { invoices: { operations: [] } },
};

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "doli-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("manifest store", () => {
  it("round-trips a manifest", () => {
    const path = join(dir, "nested", "acme.json");
    saveManifestTo(path, manifest);
    expect(existsSync(path)).toBe(true);
    expect(loadManifestFrom(path)).toEqual(manifest);
  });

  it("returns undefined when absent", () => {
    expect(loadManifestFrom(join(dir, "missing.json"))).toBeUndefined();
  });

  it("returns undefined for a corrupt file rather than throwing", () => {
    const path = join(dir, "bad.json");
    saveManifestTo(path, manifest);
    writeFileSync(path, "{not json");
    expect(loadManifestFrom(path)).toBeUndefined();
  });
});
