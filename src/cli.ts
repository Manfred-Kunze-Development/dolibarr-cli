#!/usr/bin/env node
// src/cli.ts — executable entry point. Kept separate from index.ts so importing
// the program builder in tests never parses argv or touches the manifest store.
import chalk from "chalk";
import type { Command } from "commander";
import { buildProgram } from "./index.js";
import { loadManifest } from "./lib/manifest-store.js";
import { getActiveContextName, manifestPathFor } from "./lib/config.js";

const fail = (err: unknown): void => {
  console.error(chalk.red(err instanceof Error ? err.message : String(err)));
  process.exitCode = 1;
};

// Building the tree is separated from running it so the manifest advice below
// attaches ONLY to a build failure. Wrapping both together told users to delete
// their command tree whenever they mistyped a context name — advice that is
// destructive and, for every error except this one, wrong.
let program: Command;
try {
  program = buildProgram(loadManifest());
} catch (err) {
  fail(err);
  console.error(
    chalk.yellow(
      "The cached API description for this context could not be turned into commands.\n" +
        `Re-run "dolibarr sync", or delete ${manifestPathFor(getActiveContextName())} and try again.`,
    ),
  );
  process.exit(1);
}

await program.parseAsync().catch(fail);
