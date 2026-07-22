// src/commands/modules.ts
import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import { getActiveContextName, isJsonOutput } from "../lib/config.js";
import { loadManifest } from "../lib/manifest-store.js";
import { commandNamesFor, BUILTIN_COMMANDS } from "../registry.js";
import { makeSyncCommand } from "./sync.js";

export function makeModulesCommand(): Command {
  return new Command("modules")
    .description("List the modules the connected instance exposes")
    .option("--refresh", "Re-run sync before listing")
    .action(async (opts, command: Command) => {
      if (opts.refresh) {
        await makeSyncCommand().parseAsync(["sync"], { from: "user" });
      }
      const manifest = loadManifest();
      if (!manifest) {
        // Exit non-zero in BOTH formats: a script doing
        // `dolibarr modules --json || handle_unsynced` must be able to branch on
        // status, and every other command signals failure regardless of format.
        process.exitCode = 1;
        if (isJsonOutput(command)) {
          console.log(JSON.stringify({ synced: false, modules: [] }, null, 2));
        } else {
          console.error(chalk.yellow("No manifest for this context."));
          console.error(chalk.dim('Run "dolibarr sync" first.'));
        }
        return;
      }

      // Report the command name actually exposed, which differs when a module
      // tag collided with a built-in and had to be renamed.
      const exposed = commandNamesFor(manifest, BUILTIN_COMMANDS);
      const rows = Object.entries(manifest.modules)
        .map(([name, mod]) => ({
          module: exposed.get(name) ?? name,
          operations: mod.operations.length,
        }))
        .sort((a, b) => a.module.localeCompare(b.module));

      if (isJsonOutput(command)) {
        console.log(JSON.stringify({
          synced: true,
          context: getActiveContextName(),
          dolibarrVersion: manifest.dolibarrVersion,
          fetchedAt: manifest.fetchedAt,
          modules: rows,
        }, null, 2));
        return;
      }

      const table = new Table({ head: [chalk.cyan("module"), chalk.cyan("operations")] });
      for (const row of rows) table.push([row.module, String(row.operations)]);
      console.log(table.toString());
      console.log(chalk.dim(
        `${rows.length} modules on Dolibarr ${manifest.dolibarrVersion ?? "(unknown)"} — synced ${manifest.fetchedAt}`,
      ));
    });
}
