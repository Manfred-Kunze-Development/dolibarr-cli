// src/lib/data-file.ts
import { readFileSync } from "node:fs";

/**
 * Resolve --data's @file convention in the CLI layer, keeping lib/body.ts
 * runtime-agnostic (the body-assembly logic is reused in browser bundles that
 * have no filesystem).
 */
export function resolveDataArg(data: string | undefined): string | undefined {
  if (data === undefined || !data.startsWith("@")) return data;
  const file = data.slice(1);
  try {
    return readFileSync(file, "utf8");
  } catch (err) {
    // readFileSync's ENOENT mentions neither --data nor what to do about it.
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`--data file could not be read: ${file} (${reason})`);
  }
}
