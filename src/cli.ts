#!/usr/bin/env node
// src/cli.ts — executable entry point. Kept separate from index.ts so importing
// the program builder in tests never parses argv or touches the manifest store.
import chalk from "chalk";
import { buildProgram } from "./index.js";
import { loadManifest } from "./lib/manifest-store.js";
import { getActiveContextName, manifestPathFor } from "./lib/config.js";

// buildProgram runs BEFORE parseAsync, so a manifest that cannot be turned into
// a command tree would otherwise escape as a raw Node stack trace with no hint
// that the cached manifest is at fault or how to clear it.
try {
  await buildProgram(loadManifest()).parseAsync();
} catch (err) {
  console.error(chalk.red(err instanceof Error ? err.message : String(err)));
  const path = manifestPathFor(getActiveContextName());
  console.error(
    chalk.yellow(
      `If this mentions a command name, the cached API description may be unusable.
` +
        `Re-run "dolibarr sync", or delete ${path} and try again.`,
    ),
  );
  process.exitCode = 1;
}
