// src/lib/errors.ts
import chalk from "chalk";

export class DolibarrApiError extends Error {
  readonly status: number;
  readonly module?: string;

  constructor(status: number, message: string, opts: { module?: string } = {}) {
    super(message);
    this.name = "DolibarrApiError";
    this.status = status;
    this.module = opts.module;
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseErrorBody(body: any): string {
  if (body === null || body === undefined) return "";
  if (typeof body === "string") return body;
  if (typeof body?.error?.message === "string") return body.error.message;
  if (typeof body?.error === "string") return body.error;
  if (typeof body?.message === "string") return body.message;
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

const STATUS_HINTS: Record<number, string> = {
  400: "Bad request. Check required fields and value types.",
  401: "Invalid or missing API key. Run \"dolibarr auth login\" to reconfigure.",
  403: "Permission denied. The API user lacks rights for this operation.",
  405: "Method not allowed on this path for your Dolibarr version.",
  500: "The Dolibarr server errored. Check its logs for detail.",
};

/**
 * Build a hint for an API error.
 *
 * `availableModules` comes from the manifest, which lets a 404 against a module
 * the instance does not expose be reported as such instead of "check the ID".
 */
export function hintFor(err: DolibarrApiError, availableModules: string[]): string {
  if (err.status === 500 && /api\/temp not writable/i.test(err.message)) {
    return (
      "The instance's api/temp directory is missing or unwritable. This usually means the API " +
      "module was enabled by writing MAIN_MODULE_API directly to the database instead of through " +
      "activateModule(), which creates that directory. Re-enable the module from the Dolibarr UI."
    );
  }

  if (err.status === 404 && err.module && !availableModules.includes(err.module)) {
    const list = availableModules.length > 0 ? availableModules.join(", ") : "(none — run \"dolibarr sync\")";
    return `Module "${err.module}" is not enabled on this instance.\nEnabled modules: ${list}`;
  }

  if (err.status === 404) return "Not found. Verify the ID or reference is correct.";
  return STATUS_HINTS[err.status] ?? "";
}

export function handleError(err: unknown, json: boolean, availableModules: string[] = []): void {
  if (err instanceof DolibarrApiError) {
    if (json) {
      console.error(JSON.stringify({ error: err.name, status: err.status, message: err.message }));
    } else {
      console.error(chalk.red(`Error ${err.status}: ${err.message}`));
      const hint = hintFor(err, availableModules);
      if (hint) console.error(chalk.yellow(`Hint: ${hint}`));
    }
  } else if (err instanceof Error) {
    if (json) console.error(JSON.stringify({ error: err.name, message: err.message }));
    else console.error(chalk.red(`Error: ${err.message}`));
  } else if (json) {
    console.error(JSON.stringify({ error: "UnknownError", message: String(err) }));
  } else {
    console.error(chalk.red(`Unknown error: ${String(err)}`));
  }
  process.exitCode = 1;
}
