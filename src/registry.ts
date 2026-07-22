// src/registry.ts
import { Command, Option } from "commander";
import type { Manifest, OperationSpec } from "./manifest.js";
import { sanitizeCommand } from "./naming.js";
import { resolveConfig, rootOf, isJsonOutput, timeoutMsFrom } from "./lib/config.js";
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

/**
 * Long flags declared on the root program.
 *
 * Commander binds a duplicated long flag to the ROOT command, so a generated
 * option with one of these names would be unreachable from its own action.
 * Dolibarr really does have a query parameter called `entity` (on
 * `GET /login` and `GET /users/{id}/setGroup/{group}`), which collides with the
 * global multi-company selector. Those get a `--query-` prefix instead.
 */
const RESERVED_FLAGS = new Set(["api-key", "base-url", "entity", "timeout", "json", "color", "version", "help"]);

/** The flag name to expose for a query parameter, avoiding root collisions. */
export function flagNameFor(paramName: string): string {
  return RESERVED_FLAGS.has(paramName) ? `query-${paramName}` : paramName;
}

/** Commander camelCases on hyphens only. */
function optionKeyFor(flagName: string): string {
  return flagName.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
}

/**
 * True for the module's own create endpoint — POST to a single-segment path
 * with no path parameters, e.g. POST /thirdparties.
 *
 * Dolibarr's `static $FIELDS` lists what `_validate()` demands when creating
 * the entity itself. Sub-resource and action POSTs (POST /invoices/{id}/lines,
 * POST /invoices/{id}/settopaid) take entirely different payloads.
 */
export function isRootCreate(op: OperationSpec): boolean {
  return (
    op.method === "post" &&
    op.pathParams.length === 0 &&
    op.path.split("/").filter(Boolean).length === 1
  );
}

function addQueryOptions(cmd: Command, op: OperationSpec): void {
  for (const param of op.query) {
    const flagName = flagNameFor(param.name);
    const renamed = flagName !== param.name ? ` (API parameter "${param.name}")` : "";
    const description = (param.description?.replace(/\s+/g, " ").slice(0, 110) ?? "") + renamed;
    cmd.addOption(new Option(`--${flagName} <value>`, description));
  }
}

function addBodyOptions(cmd: Command): void {
  cmd
    .option("--data <json>", "Request body as JSON, or @file.json to read from disk")
    .option("--set <key=value...>", "Set a body field; dot paths supported. Applied over --data")
    .option("--extrafield <key=value...>", "Set a custom field (maps to array_options)");
}

function buildOperationCommand(
  module: string,
  op: OperationSpec,
  availableModules: string[],
): Command {
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
        // Read under the exposed flag's key, which differs from the API
        // parameter name when it had to be renamed to dodge a root global.
        // Commander camelCases on hyphens only, so underscore and camelCase
        // names (sqlfilters, contact_list, withLines) land under their literal
        // key; a hyphenated one would not.
        const key = optionKeyFor(flagNameFor(param.name));
        const value = opts[key] ?? opts[param.name];
        if (value !== undefined) query[param.name] = value;
      }

      let body: Record<string, unknown> | undefined;
      if (op.hasBody) {
        body = buildBody({
          data: opts.data as string | undefined,
          set: opts.set as string[] | undefined,
          extrafield: opts.extrafield as string[] | undefined,
        });
        // Only the module's root create takes the entity's mandatory fields.
        // Applying this to every POST blocked 61 endpoints on a live instance —
        // validating an invoice, adding a line, recording a payment — and told
        // the user to inject a field that does not belong in those payloads.
        if (isRootCreate(op)) checkRequired(module, body, REQUIRED);
      }

      const result = await request(config, {
        method: op.method,
        path: op.path,
        pathParams,
        query,
        body,
        module,
        timeoutMs: timeoutMsFrom(command),
      });

      const columns = typeof opts.columns === "string" ? opts.columns.split(",") : undefined;
      const page = query.page !== undefined ? Number(query.page) : 0;
      formatResult(result, command, { hints: COLUMNS[module], columns, page });
    } catch (err) {
      // isJsonOutput walks to the root rather than assuming a fixed depth, and
      // matches what the success path uses. availableModules must be passed:
      // without it every 404 claims the module is disabled, because
      // ![].includes(x) is always true.
      handleError(err, isJsonOutput(command), availableModules);
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
  const availableModules = Object.keys(manifest.modules);

  // Names the program already owns. Commander THROWS on a duplicate command, and
  // this runs before parseAsync, so a module tagged e.g. `api` would take down
  // every invocation including --help and sync, leaving no way to recover except
  // deleting the manifest by hand. Custom modules choose their own tag, so this
  // is reachable in the field.
  const taken = new Set(program.commands.map((c) => c.name()));

  for (const [module, { operations }] of Object.entries(manifest.modules)) {
    if (claimed.has(module)) continue;

    let name = sanitizeCommand(module) || "module";
    if (taken.has(name)) {
      const alternative = `${name}-module`;
      process.stderr.write(
        `[warning] The instance exposes a module named "${module}", which clashes with a built-in ` +
          `command. Exposing it as "${alternative}".
`,
      );
      name = alternative;
      let suffix = 2;
      while (taken.has(name)) name = `${alternative}-${suffix++}`;
    }
    taken.add(name);

    const group = new Command(name).description(`${operations.length} operations`);
    for (const op of operations) {
      group.addCommand(buildOperationCommand(module, op, availableModules));
    }
    program.addCommand(group);
  }
}
