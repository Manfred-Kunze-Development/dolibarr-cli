// src/commands/sync.ts
import { Command } from "commander";
import { readFileSync } from "node:fs";
import chalk from "chalk";
import ora from "ora";
import { resolveConfig, getActiveContextName, isJsonOutput, rootOf, type ResolvedConfig } from "../lib/config.js";
import { buildManifest } from "../manifest.js";
import { saveManifest } from "../lib/manifest-store.js";
import { handleError, DolibarrApiError } from "../lib/errors.js";
import { request } from "../lib/client.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type RawSpec = Record<string, any>;

export function specUrlFor(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/explorer/swagger.json`;
}

/**
 * Generous by default: the explorer scans every enabled module, and a cold
 * remote instance with many modules is far slower than the ~0.6s a warm local
 * one takes. Overridable via --timeout.
 */
export const DEFAULT_SPEC_TIMEOUT_MS = 180_000;

/**
 * Fetch the instance's Swagger 2.0 document.
 *
 * Deliberately not converted to OpenAPI 3: a command tree needs only paths,
 * methods, tags and parameters, all of which Swagger 2.0 already carries.
 *
 * Slow against a cold instance — the explorer scans every enabled module — so
 * callers should show a spinner and allow a generous timeout.
 */

export async function fetchSpec(
  config: ResolvedConfig,
  opts: { timeoutMs?: number } = {},
): Promise<RawSpec> {
  const url = specUrlFor(config.baseUrl);

  let spec: unknown;
  try {
    // Routed through request() rather than a bare fetch so this inherits
    // DOLAPIENTITY, timeout handling that also covers the ~900KB body read, and
    // connection errors that name their cause. Sending the entity matters:
    // the explorer document is entity-scoped, so syncing without it builds the
    // entity-1 tree while every generated command targets the configured
    // entity — and an unknown entity answers 200 with a near-empty spec rather
    // than failing.
    spec = await request(config, {
      method: "get",
      path: "/explorer/swagger.json",
      timeoutMs: opts.timeoutMs ?? DEFAULT_SPEC_TIMEOUT_MS,
    });
  } catch (err) {
    if (err instanceof DolibarrApiError) {
      if (/api\/temp not writable/i.test(err.message)) {
        throw new Error(
          "The instance cannot write to api/temp, so it cannot generate its API description.\n" +
            "This usually means the API module was enabled by writing MAIN_MODULE_API straight to the\n" +
            "database rather than through activateModule(), which creates that directory.\n" +
            "Re-enable the API module from the Dolibarr UI, then retry.",
        );
      }
      if (err.status === 403 || err.status === 404) {
        throw new Error(
          `The API explorer is unavailable (HTTP ${err.status}). It may be turned off via\n` +
            "API_EXPLORER_DISABLED. Supply a spec file instead: dolibarr sync --spec <file>",
        );
      }
      throw new Error(`Failed to fetch the API description: HTTP ${err.status}: ${err.message}`);
    }
    throw err; // connection and timeout errors already carry their cause
  }

  if (!spec || typeof spec !== "object" || typeof (spec as RawSpec).paths !== "object") {
    throw new Error(`The API description at ${url} was not a usable Swagger document.`);
  }
  return spec as RawSpec;
}

async function fetchVersion(config: ResolvedConfig, timeoutMs?: number): Promise<string | null> {
  try {
    const status = (await request(config, { method: "get", path: "/status", timeoutMs })) as any;
    return status?.success?.dolibarr_version ?? null;
  } catch {
    return null;
  }
}

export function makeSyncCommand(): Command {
  return new Command("sync")
    .description("Fetch the instance's API description and rebuild the command tree")
    .option("--spec <file>", "Read the spec from a local file instead of the instance")
    .action(async (opts, command: Command) => {
      try {
        const config = resolveConfig(command);
        const rootTimeout = rootOf(command).opts().timeout;
        const timeoutMs = rootTimeout ? Number(rootTimeout) * 1000 : undefined;
        const spinner = isJsonOutput(command) ? null : ora("Fetching API description…").start();

        let spec: RawSpec;
        try {
          spec = opts.spec
            ? (JSON.parse(readFileSync(opts.spec, "utf8")) as RawSpec)
            : await fetchSpec(config, { timeoutMs });
        } catch (err) {
          spinner?.fail();
          throw err;
        }

        const version = opts.spec ? null : await fetchVersion(config, timeoutMs);
        spinner?.succeed("Fetched API description");

        const manifest = buildManifest(spec, {
          fetchedAt: new Date().toISOString(),
          dolibarrVersion: version,
        });
        const path = saveManifest(manifest);

        const moduleCount = Object.keys(manifest.modules).length;
        const opCount = Object.values(manifest.modules).reduce((n, m) => n + m.operations.length, 0);

        if (isJsonOutput(command)) {
          console.log(JSON.stringify({
            context: getActiveContextName(),
            dolibarrVersion: manifest.dolibarrVersion,
            modules: moduleCount,
            operations: opCount,
            entity: config.entity ?? null,
            manifest: path,
          }, null, 2));
        } else {
          console.log(chalk.green(`Synced ${moduleCount} modules, ${opCount} operations.`));
          if (manifest.dolibarrVersion) console.log(chalk.dim(`Dolibarr ${manifest.dolibarrVersion}`));
          // The spec is entity-scoped, so say which entity this tree describes.
          if (config.entity) console.log(chalk.dim(`Entity ${config.entity}`));
          console.log(chalk.dim(`Manifest: ${path}`));
        }
      } catch (err) {
        handleError(err, isJsonOutput(command));
      }
    });
}
