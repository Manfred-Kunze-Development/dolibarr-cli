// src/commands/modules.ts
import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import { getActiveContextName, isJsonOutput } from "../lib/config.js";
import { loadManifest } from "../lib/manifest-store.js";

export function makeModulesCommand(): Command {
  return new Command("modules")
    .description("List the modules the connected instance exposes")
    .action((_opts, command: Command) => {
      const manifest = loadManifest();
      if (!manifest) {
        if (isJsonOutput(command)) {
          console.log(JSON.stringify({ synced: false, modules: [] }));
        } else {
          console.error(chalk.yellow("No manifest for this context."));
          console.error(chalk.dim('Run "dolibarr sync" first.'));
          process.exitCode = 1;
        }
        return;
      }

      const rows = Object.entries(manifest.modules)
        .map(([name, mod]) => ({ module: name, operations: mod.operations.length }))
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
