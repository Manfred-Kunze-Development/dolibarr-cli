// src/commands/api.ts
import { Command } from "commander";
import { resolveConfig, isJsonOutput, timeoutMsFrom } from "../lib/config.js";
import { request } from "../lib/client.js";
import { buildBody } from "../lib/body.js";
import { onceOnly } from "../registry.js";
import { formatResult } from "../lib/output.js";
import { handleError } from "../lib/errors.js";

// PATCH included: Dolibarr uses it for at least one real endpoint
// (PATCH /thirdparties/{id}/accounts/{site}).
const METHODS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH"]);

/**
 * Escape hatch for anything the generated tree does not cover -- an endpoint
 * added by a custom module, or a path that predates the last sync.
 */
export function makeApiCommand(): Command {
  return new Command("api")
    .description("Call any endpoint directly")
    .argument("<method>", "GET, POST, PUT, DELETE or PATCH")
    .argument("<path>", "Path relative to the API root, e.g. /thirdparties/1")
    .option("--query <key=value...>", "Query parameter")
    .option("--data <json>", "Request body as JSON, or @file.json", onceOnly("--data"))
    .option("--set <key=value...>", "Set a body field; dot paths supported")
    .option("--extrafield <key=value...>", "Set a custom field (maps to array_options)")
    .action(async (method: string, path: string, opts, command: Command) => {
      try {
        const verb = method.toUpperCase();
        if (!METHODS.has(verb)) {
          throw new Error(`Unsupported method "${method}". Use GET, POST, PUT, DELETE or PATCH.`);
        }

        // A path may already carry a query string. Appending another "?" would
        // produce .../thirdparties?limit=2?foo=bar, which the server reads as a
        // single malformed parameter.
        const [rawPath, embedded] = path.split("?", 2);
        const query: Record<string, unknown> = {};
        for (const [key, value] of new URLSearchParams(embedded ?? "")) {
          query[key] = value;
        }
        for (const pair of (opts.query as string[] | undefined) ?? []) {
          const index = pair.indexOf("=");
          if (index <= 0) throw new Error(`Invalid --query "${pair}". Expected key=value.`);
          query[pair.slice(0, index)] = pair.slice(index + 1);
        }

        const config = resolveConfig(command);
        const result = await request(config, {
          method: verb,
          path: rawPath.startsWith("/") ? rawPath : `/${rawPath}`,
          query,
          body: buildBody({ data: opts.data, set: opts.set, extrafield: opts.extrafield }),
          timeoutMs: timeoutMsFrom(command),
        });
        formatResult(result, command);
      } catch (err) {
        handleError(err, isJsonOutput(command));
      }
    });
}
