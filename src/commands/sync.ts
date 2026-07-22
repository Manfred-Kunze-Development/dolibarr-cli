// src/commands/sync.ts
import { Command } from "commander";
import { readFileSync } from "node:fs";
import chalk from "chalk";
import ora from "ora";
import { resolveConfig, getActiveContextName, isJsonOutput, type ResolvedConfig } from "../lib/config.js";
import { buildManifest } from "../manifest.js";
import { saveManifest } from "../lib/manifest-store.js";
import { handleError } from "../lib/errors.js";
import { request } from "../lib/client.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type RawSpec = Record<string, any>;

export function specUrlFor(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/explorer/swagger.json`;
}

/**
 * Fetch the instance's Swagger 2.0 document.
 *
 * Deliberately not converted to OpenAPI 3: a command tree needs only paths,
 * methods, tags and parameters, all of which Swagger 2.0 already carries.
 *
 * Slow against a cold instance — the explorer scans every enabled module — so
 * callers should show a spinner and allow a generous timeout.
 */
export async function fetchSpec(config: ResolvedConfig): Promise<RawSpec> {
  const url = specUrlFor(config.baseUrl);
  const response = await fetch(url, {
    headers: { DOLAPIKEY: config.apiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(180_000),
  }).catch(() => {
    throw new Error(`Cannot reach ${url}. Is the instance running and the base URL correct?`);
  });

  const text = await response.text();

  if (!response.ok) {
    if (/api\/temp not writable/i.test(text)) {
      throw new Error(
        "The instance cannot write to api/temp, so it cannot generate its API description.\n" +
          "This usually means the API module was enabled by writing MAIN_MODULE_API straight to the\n" +
          "database rather than through activateModule(), which creates that directory.\n" +
          "Re-enable the API module from the Dolibarr UI, then retry.",
      );
    }
    if (response.status === 403 || response.status === 404) {
      throw new Error(
        `The API explorer is unavailable (HTTP ${response.status}). It may be turned off via\n` +
          "API_EXPLORER_DISABLED. Supply a spec file instead: dolibarr sync --spec <file>",
      );
    }
    throw new Error(`Failed to fetch the API description: HTTP ${response.status}`);
  }

  try {
    return JSON.parse(text) as RawSpec;
  } catch {
    throw new Error(`The API description at ${url} was not valid JSON.`);
  }
}

async function fetchVersion(config: ResolvedConfig): Promise<string | null> {
  try {
    const status = (await request(config, { method: "get", path: "/status" })) as any;
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
        const spinner = isJsonOutput(command) ? null : ora("Fetching API description…").start();

        let spec: RawSpec;
        try {
          spec = opts.spec
            ? (JSON.parse(readFileSync(opts.spec, "utf8")) as RawSpec)
            : await fetchSpec(config);
        } catch (err) {
          spinner?.fail();
          throw err;
        }

        const version = opts.spec ? null : await fetchVersion(config);
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
            manifest: path,
          }, null, 2));
        } else {
          console.log(chalk.green(`Synced ${moduleCount} modules, ${opCount} operations.`));
          if (manifest.dolibarrVersion) console.log(chalk.dim(`Dolibarr ${manifest.dolibarrVersion}`));
          console.log(chalk.dim(`Manifest: ${path}`));
        }
      } catch (err) {
        handleError(err, isJsonOutput(command));
      }
    });
}
