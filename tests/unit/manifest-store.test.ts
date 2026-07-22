import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
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

describe("manifest store — durability and diagnostics", () => {
  it("writes atomically and leaves no temp files behind", () => {
    const path = join(dir, "atomic.json");
    saveManifestTo(path, manifest);
    const strays = readdirSync(dir).filter((f) => f.includes(".tmp"));
    expect(strays).toEqual([]);
  });

  it("stores the manifest indented so users can inspect it", () => {
    const path = join(dir, "pretty.json");
    saveManifestTo(path, manifest);
    expect(readFileSync(path, "utf8")).toContain("\n  ");
  });

  it("is silent when no manifest exists yet — that is the normal pre-sync state", () => {
    const warn = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(loadManifestFrom(join(dir, "never-synced.json"))).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("warns when the manifest is corrupt, instead of silently offering fewer commands", () => {
    const warn = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const path = join(dir, "corrupt.json");
    writeFileSync(path, "{not json");
    expect(loadManifestFrom(path)).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toMatch(/sync/i);
    warn.mockRestore();
  });
});
