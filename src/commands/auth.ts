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

      if ((!apiKey || !baseUrl) && !process.stdin.isTTY) {
        // Without a terminal, readline resolves the first prompt from whatever
        // is piped and then awaits forever on a closed stdin. Node sees no
        // remaining handles and exits 0 mid-await — a silent no-op that reports
        // success, which is the worst possible outcome for a CI job.
        console.error(
          chalk.red("auth login needs a terminal for prompts."),
        );
        console.error(
          chalk.dim("Pass both --api-key and --base-url when stdin is not a terminal."),
        );
        process.exitCode = 1;
        return;
      }

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

      // Verify rather than cheerfully accepting a typo and failing on the next
      // command. Credentials are kept either way — a temporarily unreachable
      // instance is not a reason to discard correct input — but the exit status
      // reflects that they are unproven.
      try {
        const status = (await request({ apiKey, baseUrl }, {
          method: "get",
          path: "/status",
        })) as any;
        console.log(
          chalk.green(`Verified against Dolibarr ${status?.success?.dolibarr_version ?? "(unknown version)"}.`),
        );
        console.log(chalk.dim('Run "dolibarr sync" to build the command tree.'));
      } catch (err) {
        console.error(
          chalk.yellow(
            `Warning: saved, but could not verify: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        process.exitCode = 1;
      }
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

      // deleteContext promotes whichever context was created earliest, which is
      // arbitrary from the user's point of view. Say so, rather than leaving
      // them pointed at a different instance without knowing it.
      const now = getActiveContextName();
      if (now !== name) {
        console.log(chalk.yellow(`Active context is now "${now}".`));
      }
    });

  return cmd;
}
