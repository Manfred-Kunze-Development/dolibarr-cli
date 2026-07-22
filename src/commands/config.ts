// src/commands/config.ts
import { Command } from "commander";
import chalk from "chalk";
import { getStore, getActiveContextName, isJsonOutput, manifestPathFor } from "../lib/config.js";

export function makeConfigCommand(): Command {
  const cmd = new Command("config").description("Inspect CLI configuration");

  cmd
    .command("path")
    .description("Show where configuration and manifests are stored")
    .action((_opts, command: Command) => {
      const payload = {
        config: getStore().path,
        manifest: manifestPathFor(getActiveContextName()),
        activeContext: getActiveContextName(),
      };
      if (isJsonOutput(command)) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.log(`Config:   ${payload.config}`);
        console.log(`Manifest: ${payload.manifest}`);
        console.log(`Context:  ${chalk.green(payload.activeContext)}`);
      }
    });

  return cmd;
}
