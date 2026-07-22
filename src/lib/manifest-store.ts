// src/lib/manifest-store.ts
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { Manifest } from "../manifest.js";
import { manifestPathFor, getActiveContextName } from "./config.js";

export function saveManifestTo(path: string, manifest: Manifest): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(manifest), "utf8");
}

/** A missing or corrupt manifest is not fatal — the CLI falls back to static commands. */
export function loadManifestFrom(path: string): Manifest | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Manifest;
  } catch {
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
