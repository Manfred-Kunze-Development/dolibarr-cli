// src/commands/context.ts
import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import { existsSync } from "node:fs";
import {
  getAllContexts, getActiveContextName, setActiveContext, setContext,
  deleteContext, isJsonOutput, manifestPathFor,
} from "../lib/config.js";

export function makeContextCommand(): Command {
  const cmd = new Command("context").description("Switch between Dolibarr instances");

  cmd
    .command("list")
    .description("List configured contexts")
    .action((_opts, command: Command) => {
      const contexts = getAllContexts();
      const active = getActiveContextName();

      if (isJsonOutput(command)) {
        console.log(JSON.stringify({ activeContext: active, contexts: Object.keys(contexts) }, null, 2));
        return;
      }
      if (Object.keys(contexts).length === 0) {
        console.log(chalk.dim('No contexts. Run "dolibarr auth login".'));
        return;
      }

      const table = new Table({ head: ["", chalk.cyan("context"), chalk.cyan("base URL")] });
      for (const [name, entry] of Object.entries(contexts)) {
        table.push([name === active ? chalk.green("*") : " ", name, entry.baseUrl]);
      }
      console.log(table.toString());
    });

  cmd
    .command("use")
    .description("Switch the active context")
    .argument("<name>", "Context name")
    .action((name: string) => {
      setActiveContext(name);
      console.log(chalk.green(`Switched to "${name}".`));
      // Each context caches its own command tree, so switching to one that has
      // never been synced silently leaves only the static commands available.
      if (!existsSync(manifestPathFor(name))) {
        console.log(chalk.dim('No command tree cached yet — run "dolibarr sync".'));
      }
    });

  cmd
    .command("create")
    .description("Create a context")
    .argument("<name>", "Context name")
    .requiredOption("--base-url <url>", "Base URL, ending in /api/index.php")
    .requiredOption("--api-key <key>", "API key")
    .action((name: string, opts: { baseUrl: string; apiKey: string }) => {
      setContext(name, { baseUrl: opts.baseUrl, apiKey: opts.apiKey });
      console.log(chalk.green(`Created context "${name}".`));
    });

  cmd
    .command("delete")
    .description("Delete a context")
    .argument("<name>", "Context name")
    .action((name: string) => {
      deleteContext(name);
      console.log(chalk.green(`Deleted context "${name}".`));
    });

  return cmd;
}
