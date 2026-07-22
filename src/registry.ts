// src/registry.ts
import { Command, Option } from "commander";
import type { Manifest, OperationSpec } from "./manifest.js";
import { resolveConfig, rootOf } from "./lib/config.js";
import { request } from "./lib/client.js";
import { buildBody, checkRequired } from "./lib/body.js";
import { formatResult } from "./lib/output.js";
import { handleError } from "./lib/errors.js";
import { createRequire } from "node:module";

// Loaded via createRequire rather than an ESM JSON import: import attributes
// behave differently across Node/TS versions, and this resolves relative to the
// emitted file, so it works the same from src (vitest) and dist (installed).
const require = createRequire(import.meta.url);
const REQUIRED: Record<string, string[]> = require("./data/required-fields.json");
const COLUMNS: Record<string, string[]> = require("./data/columns.json");

function addQueryOptions(cmd: Command, op: OperationSpec): void {
  for (const param of op.query) {
    const flag = `--${param.name} <value>`;
    const description = param.description?.replace(/\s+/g, " ").slice(0, 120) ?? "";
    cmd.addOption(new Option(flag, description));
  }
}

function addBodyOptions(cmd: Command): void {
  cmd
    .option("--data <json>", "Request body as JSON, or @file.json to read from disk")
    .option("--set <key=value...>", "Set a body field; dot paths supported. Applied over --data")
    .option("--extrafield <key=value...>", "Set a custom field (maps to array_options)");
}

function buildOperationCommand(module: string, op: OperationSpec): Command {
  const cmd = new Command(op.command);
  if (op.summary) cmd.description(op.summary.replace(/\s*🔐\s*$/, "").trim());

  for (const param of op.pathParams) {
    cmd.argument(`<${param.name}>`, param.description ?? `${param.name} path parameter`);
  }
  addQueryOptions(cmd, op);
  if (op.hasBody) addBodyOptions(cmd);
  cmd.option("--columns <list>", "Comma-separated columns to display");

  cmd.action(async (...args: unknown[]) => {
    // Commander passes: ...positionals, options, command
    const command = args[args.length - 1] as Command;
    const opts = args[args.length - 2] as Record<string, unknown>;
    const positionals = args.slice(0, op.pathParams.length) as string[];

    try {
      const config = resolveConfig(command);

      const pathParams: Record<string, string> = {};
      op.pathParams.forEach((param, index) => {
        pathParams[param.name] = positionals[index];
      });

      const query: Record<string, unknown> = {};
      for (const param of op.query) {
        const value = opts[param.name];
        if (value !== undefined) query[param.name] = value;
      }

      let body: Record<string, unknown> | undefined;
      if (op.hasBody) {
        body = buildBody({
          data: opts.data as string | undefined,
          set: opts.set as string[] | undefined,
          extrafield: opts.extrafield as string[] | undefined,
        });
        if (op.method === "post") checkRequired(module, body, REQUIRED);
      }

      const rootOpts = rootOf(command).opts();
      const result = await request(config, {
        method: op.method,
        path: op.path,
        pathParams,
        query,
        body,
        module,
        timeoutMs: rootOpts.timeout ? Number(rootOpts.timeout) * 1000 : undefined,
      });

      const columns = typeof opts.columns === "string" ? opts.columns.split(",") : undefined;
      const page = query.page !== undefined ? Number(query.page) : 0;
      formatResult(result, command, { hints: COLUMNS[module], columns, page });
    } catch (err) {
      handleError(err, Boolean((command.parent?.parent ?? command).opts().json));
    }
  });

  return cmd;
}

/**
 * Register one command group per module in the manifest.
 *
 * `claimed` holds module names already provided by hand-crafted commands; those
 * are skipped so a crafted module fully replaces its generated counterpart.
 */
export function registerGeneratedCommands(
  program: Command,
  manifest: Manifest,
  claimed: Set<string>,
): void {
  for (const [module, { operations }] of Object.entries(manifest.modules)) {
    if (claimed.has(module)) continue;
    const group = new Command(module).description(`${operations.length} operations`);
    for (const op of operations) group.addCommand(buildOperationCommand(module, op));
    program.addCommand(group);
  }
}
