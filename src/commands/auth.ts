// src/commands/auth.ts
import { Command } from "commander";
import chalk from "chalk";
import { createInterface } from "node:readline/promises";
import {
  getStore, setContext, setActiveContext, getActiveContextName, getActiveContext,
  getAllContexts, deleteContext, resolveConfig, isJsonOutput,
} from "../lib/config.js";
import { request } from "../lib/client.js";
import { handleError } from "../lib/errors.js";

function maskKey(key: string): string {
  return key.length <= 8 ? "****" : `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export function makeAuthCommand(): Command {
  const cmd = new Command("auth").description("Manage authentication");

  cmd
    .command("login")
    .description("Store credentials for the active context")
    .option("--api-key <key>", "API key (Setup → Users → API key in Dolibarr)")
    .option("--base-url <url>", "Base URL, ending in /api/index.php")
    .action(async (opts) => {
      let { apiKey, baseUrl } = opts;
      const current = getActiveContext();

      if (!apiKey || !baseUrl) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        try {
          if (!baseUrl) {
            const suggestion = current?.baseUrl ?? "http://localhost:8023/api/index.php";
            baseUrl = (await rl.question(`Base URL [${suggestion}]: `)) || suggestion;
          }
          if (!apiKey) apiKey = await rl.question("API key: ");
        } finally {
          rl.close();
        }
      }

      if (!apiKey || !baseUrl) {
        console.error(chalk.red("Both an API key and a base URL are required."));
        process.exitCode = 1;
        return;
      }

      const name = getActiveContextName();
      setContext(name, { apiKey, baseUrl });
      setActiveContext(name);
      console.log(chalk.green(`Credentials saved for context "${name}".`));
      console.log(chalk.dim(`Config: ${getStore().path}`));
      console.log(chalk.dim('Run "dolibarr sync" to build the command tree.'));
    });

  cmd
    .command("status")
    .description("Verify the stored credentials against the instance")
    .action(async (_opts, command: Command) => {
      try {
        const config = resolveConfig(command);
        const status = (await request(config, { method: "get", path: "/status" })) as any;
        const version = status?.success?.dolibarr_version ?? "unknown";

        if (isJsonOutput(command)) {
          console.log(JSON.stringify({
            authenticated: true,
            context: getActiveContextName(),
            baseUrl: config.baseUrl,
            dolibarrVersion: version,
          }));
        } else {
          console.log(chalk.green("Authenticated"));
          console.log(`  Context:  ${getActiveContextName()}`);
          console.log(`  Base URL: ${config.baseUrl}`);
          console.log(`  API key:  ${maskKey(config.apiKey)}`);
          console.log(`  Dolibarr: ${version}`);
        }
      } catch (err) {
        handleError(err, isJsonOutput(command));
      }
    });

  cmd
    .command("logout")
    .description("Remove the active context's credentials")
    .action(() => {
      const name = getActiveContextName();
      if (Object.keys(getAllContexts()).length <= 1) {
        getStore().set("contexts", {});
      } else {
        deleteContext(name);
      }
      console.log(chalk.green(`Credentials cleared for "${name}".`));
    });

  return cmd;
}
