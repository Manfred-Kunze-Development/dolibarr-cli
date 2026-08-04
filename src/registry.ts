// src/registry.ts
import { Command, Option } from "commander";
import type { Manifest, OperationSpec } from "./manifest.js";
import { sanitizeCommand } from "./naming.js";
import { resolveConfig, rootOf, isJsonOutput, isVerbose, timeoutMsFrom } from "./lib/config.js";
import { request } from "./lib/client.js";
import { buildBody, checkRequired, checkConditional, type ConditionalRule } from "./lib/body.js";
import { resolveDataArg } from "./lib/data-file.js";
import { formatResult } from "./lib/output.js";
import { handleError, DolibarrApiError } from "./lib/errors.js";
import { confirm } from "./lib/prompt.js";
import { createRequire } from "node:module";

// Loaded via createRequire rather than an ESM JSON import: import attributes
// behave differently across Node/TS versions, and this resolves relative to the
// emitted file, so it works the same from src (vitest) and dist (installed).
const require = createRequire(import.meta.url);
const REQUIRED: Record<string, string[]> = require("./data/required-fields.json");
// Separate from required-fields.json because that file is rewritten wholesale
// by extract-fields.mjs; these rules are hand-curated. See lib/body.ts.
const CONDITIONAL: Record<string, ConditionalRule[]> = require("./data/conditional-fields.json");
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
/**
 * True for list-shaped reads — a GET offering the pagination parameters.
 *
 * Dolibarr answers an empty result set with 404 "No third parties found", so
 * without this a filter that matches nothing is reported as an error with a
 * "verify the ID" hint, and a script gets a non-zero exit instead of [].
 */
export function isListOperation(op: OperationSpec): boolean {
  return op.method === "get" && op.query.some((p) => p.name === "limit");
}

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
    const raw = param.description?.replace(/\s+/g, " ") ?? "";
    // Truncate on a word boundary with an ellipsis rather than mid-word.
    const trimmed =
      raw.length > 110 ? raw.slice(0, raw.lastIndexOf(" ", 110) > 40 ? raw.lastIndexOf(" ", 110) : 110) + "…" : raw;
    const option = new Option(`--${flagName} <value>`, trimmed + renamed);
    // The spec marks 20 query parameters required; without this the server
    // answers 400 for a request the CLI could have rejected locally.
    if (param.required) option.makeOptionMandatory();
    cmd.addOption(option);
  }
}

/**
 * Reject a repeated --data rather than silently taking the last.
 *
 * Commander's non-variadic options let the last occurrence win, which for a
 * whole request body means quietly discarding the one the user probably meant.
 */
export function onceOnly(flag: string) {
  return (value: string, previous: string | undefined): string => {
    if (previous !== undefined) throw new Error(`${flag} may only be given once.`);
    return value;
  };
}

function addBodyOptions(cmd: Command): void {
  cmd
    .option("--data <json>", "Request body as JSON, or @file.json to read from disk", onceOnly("--data"))
    .option("--set <key=value...>", "Set a body field; dot paths supported. Applied over --data")
    .option("--extrafield <key=value...>", "Set a custom field (maps to array_options)");
}

function buildOperationCommand(
  module: string,
  op: OperationSpec,
  availableModules: string[],
): Command {
  const cmd = new Command(op.command);
  if (op.summary) cmd.description(op.summary.replace(/\s*[🔐🔓]\s*$/u, "").trim());

  for (const param of op.pathParams) {
    cmd.argument(`<${param.name}>`, param.description ?? `${param.name} path parameter`);
  }
  addQueryOptions(cmd, op);
  if (op.hasBody) addBodyOptions(cmd);
  cmd.option("--columns <list>", "Comma-separated columns to display");
  if (op.method === "delete") {
    cmd.option("--yes", "Skip the confirmation prompt");
  }

  cmd.action(async (...args: unknown[]) => {
    // Commander passes: ...positionals, options, command
    const command = args[args.length - 1] as Command;
    const opts = args[args.length - 2] as Record<string, unknown>;
    const positionals = args.slice(0, op.pathParams.length) as string[];

    try {
      const config = resolveConfig(command);

      // Deletions against a live ERP are irreversible and the CLI takes
      // positional ids, so consent is required rather than assumed.
      if (op.method === "delete" && opts.yes !== true) {
        const target = (args.slice(0, op.pathParams.length) as string[]).join("/");
        const confirmed = await confirm(
          `Delete ${module} ${target} on ${config.baseUrl}? This cannot be undone.`,
        );
        if (!confirmed) {
          console.error("Aborted.");
          process.exitCode = 1;
          return;
        }
      }

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
          data: resolveDataArg(opts.data as string | undefined),
          set: opts.set as string[] | undefined,
          extrafield: opts.extrafield as string[] | undefined,
        });
        // Only the module's root create takes the entity's mandatory fields.
        // Applying this to every POST blocked 61 endpoints on a live instance —
        // validating an invoice, adding a line, recording a payment — and told
        // the user to inject a field that does not belong in those payloads.
        // Create only, for both guards. On update the record may already hold
        // the conditionally-required value — a thirdparty created as a supplier
        // last year already has code_fournisseur — and the CLI cannot know that
        // without a round trip, so enforcing it here would reject valid calls.
        if (isRootCreate(op)) {
          checkRequired(module, body, REQUIRED);
          checkConditional(module, body, CONDITIONAL);
        }
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
      formatResult(result, command, {
        hints: COLUMNS[module],
        columns,
        page,
        scalarLabel: isRootCreate(op) ? "Created id" : undefined,
      });
    } catch (err) {
      // An empty result set is not an error. Dolibarr signals it with 404.
      if (
        isListOperation(op) &&
        err instanceof DolibarrApiError &&
        err.status === 404
      ) {
        const columns = typeof opts.columns === "string" ? opts.columns.split(",") : undefined;
        formatResult([], command, { hints: COLUMNS[module], columns });
        return;
      }
      // isJsonOutput walks to the root rather than assuming a fixed depth, and
      // matches what the success path uses. availableModules must be passed:
      // without it every 404 claims the module is disabled, because
      // ![].includes(x) is always true.
      handleError(err, isJsonOutput(command), availableModules, isVerbose(command));
    }
  });

  return cmd;
}

/** Command names the program owns before any module is registered. */
export const BUILTIN_COMMANDS = ["auth", "context", "config", "sync", "modules", "api", "help"];

/**
 * Resolve every module tag to the command name actually exposed.
 *
 * Deterministic and shared, so `dolibarr modules` reports the name a user must
 * type rather than the raw tag. Commander throws on a duplicate command and
 * registration happens before parseAsync, so an unresolved clash takes down
 * every invocation including --help.
 */
export function commandNamesFor(
  manifest: Manifest,
  reserved: Iterable<string> = BUILTIN_COMMANDS,
): Map<string, string> {
  const taken = new Set(reserved);
  const names = new Map<string, string>();
  for (const module of Object.keys(manifest.modules)) {
    let name = sanitizeCommand(module) || "module";
    if (taken.has(name)) {
      const base = `${name}-module`;
      name = base;
      let suffix = 2;
      while (taken.has(name)) name = `${base}-${suffix++}`;
    }
    taken.add(name);
    names.set(module, name);
  }
  return names;
}

/** Stable identity of an operation: operationId is NOT unique. */
export function operationKey(op: OperationSpec): string {
  return `${op.method.toUpperCase()} ${op.path}`;
}

/**
 * Register one command group per module in the manifest.
 *
 * `claimed` holds `METHOD /path` keys already provided by hand-crafted
 * commands. Keyed on method+path rather than module or operationId, because
 * operationId is not unique in real Dolibarr specs and a crafted module may
 * replace only part of a group.
 */
export function registerGeneratedCommands(
  program: Command,
  manifest: Manifest,
  claimed: Set<string>,
): void {
  const availableModules = Object.keys(manifest.modules);
  const exposed = commandNamesFor(manifest, program.commands.map((c) => c.name()).concat("help"));

  for (const [module, { operations }] of Object.entries(manifest.modules)) {
    const remaining = operations.filter((op) => !claimed.has(operationKey(op)));
    if (remaining.length === 0) continue;

    const name = exposed.get(module) ?? module;
    if (name !== module) {
      process.stderr.write(
        `[warning] Module "${module}" clashes with another command; exposing it as "${name}".
`,
      );
    }

    const group = new Command(name).description(`${remaining.length} operations`);
    for (const op of remaining) {
      group.addCommand(buildOperationCommand(module, op, availableModules));
    }
    program.addCommand(group);
  }
}
