// src/lib/manifest-store.ts
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import type { Manifest } from "../manifest.js";
import { manifestPathFor, getActiveContextName } from "./config.js";

/**
 * Write the manifest atomically.
 *
 * A plain writeFileSync can be interrupted or interleaved by a concurrent
 * `sync`, and a truncated manifest may still parse as valid JSON with fewer
 * modules — loading silently as a complete-looking but wrong picture of the
 * instance. Writing to a temp file and renaming makes the swap atomic, so a
 * reader sees either the old manifest or the new one.
 *
 * Indented on purpose: this is a file users open when a command they expected
 * is missing after a sync.
 */
export function saveManifestTo(path: string, manifest: Manifest): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(manifest, null, 2), "utf8");
    renameSync(temp, path);
  } catch (err) {
    rmSync(temp, { force: true });
    throw err;
  }
}

/**
 * A missing or corrupt manifest is not fatal — the CLI falls back to static
 * commands. But it says so on stderr for anything other than "not synced yet",
 * because silently offering fewer commands than expected is hard to diagnose.
 */
export function loadManifestFrom(path: string): Manifest | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // Not synced yet is the normal first-run state, not a problem worth reporting.
    if (code === "ENOENT") return undefined;
    // A permissions problem is actionable, and "run sync" will NOT fix it —
    // sync would fail writing to the same place.
    process.stderr.write(
      `[warning] Could not read the command manifest at ${path}: ` +
        `${err instanceof Error ? err.message : String(err)}\n`,
    );
    return undefined;
  }

  try {
    return JSON.parse(raw) as Manifest;
  } catch {
    process.stderr.write(
      `[warning] The command manifest at ${path} is unreadable. ` +
        `Run "dolibarr sync" to rebuild it.\n`,
    );
    return undefined;
  }
}

export function saveManifest(manifest: Manifest, contextName = getActiveContextName()): string {
  const path = manifestPathFor(contextName);
  saveManifestTo(path, manifest);
  return path;
}

export function loadManifest(contextName = getActiveContextName()): Manifest | undefined {
  return loadManifestFrom(manifestPathFor(contextName));
}
