// src/index.ts
import { createRequire } from "node:module";
import { Command } from "commander";
import chalk from "chalk";
import type { Manifest } from "./manifest.js";
import { registerGeneratedCommands } from "./registry.js";
import { makeAuthCommand } from "./commands/auth.js";
import { makeContextCommand } from "./commands/context.js";
import { makeConfigCommand } from "./commands/config.js";
import { makeSyncCommand } from "./commands/sync.js";
import { makeModulesCommand } from "./commands/modules.js";
import { makeApiCommand } from "./commands/api.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

/**
 * Module names provided by hand-crafted commands. Generated commands for these
 * are suppressed. Empty in v1 -- the engine ships before any crafted module.
 */
const CRAFTED_MODULES = new Set<string>();

export function buildProgram(manifest: Manifest | undefined): Command {
  const program = new Command();

  program
    .name("dolibarr")
    .description("CLI for the Dolibarr ERP/CRM REST API (also installed as `doli`)")
    .version(pkg.version)
    .option("--api-key <key>", "API key (overrides config)")
    .option("--base-url <url>", "Base URL ending in /api/index.php (overrides config)")
    .option("--entity <id>", "Entity id for multi-company instances (DOLAPIENTITY)")
    .option("--timeout <seconds>", "Request timeout in seconds (default 60)")
    .option("--json", "Output raw JSON")
    .option("--no-color", "Disable coloured output");

  program.addCommand(makeAuthCommand());
  program.addCommand(makeContextCommand());
  program.addCommand(makeConfigCommand());
  program.addCommand(makeSyncCommand());
  program.addCommand(makeModulesCommand());
  program.addCommand(makeApiCommand());

  if (manifest) {
    registerGeneratedCommands(program, manifest, CRAFTED_MODULES);
  } else {
    program.addHelpText(
      "after",
      chalk.yellow('\nNo API description cached for this context yet.\n') +
        'Run "dolibarr auth login" then "dolibarr sync" to expose this instance\'s modules.\n',
    );
  }

  return program;
}
