// src/lib/errors.ts
import chalk from "chalk";

export interface DolibarrApiErrorOptions {
  /** Spec tag, so a 404 can be attributed to a module. */
  module?: string;
  /** Dolibarr's own diagnosis, recovered from the numeric keys beside `message`. */
  details?: string[];
  /** `debug.source` — the PHP file:line that threw. */
  source?: string;
  /** The raw parsed body, retained for --verbose. */
  body?: unknown;
}

export class DolibarrApiError extends Error {
  readonly status: number;
  readonly module?: string;
  readonly details: string[];
  readonly source?: string;
  readonly body?: unknown;

  constructor(status: number, message: string, opts: DolibarrApiErrorOptions = {}) {
    super(message);
    this.name = "DolibarrApiError";
    this.status = status;
    this.module = opts.module;
    this.details = opts.details ?? [];
    this.source = opts.source;
    this.body = opts.body;
  }
}

export interface ParsedError {
  message: string;
  /** Dolibarr's real diagnosis, e.g. ["ErrorCustomerCodeRequired"]. Often empty. */
  details: string[];
  /** `debug.source` — the PHP file:line that threw. */
  source?: string;
}

/**
 * Pull the numeric keys Restler emits alongside `message`.
 *
 * Dolibarr's API classes throw `RestException(500, 'msg', array_merge(
 * array($obj->error), $obj->errors))`. Restler flattens that array into string
 * keys "0", "1", … next to `message`, so the only statement of what actually
 * went wrong sits in keys no generic JSON error reader would look at. Key "0"
 * is `$obj->error`, which entities routinely leave empty while populating
 * `$obj->errors[]` — hence the blank filter.
 */
function collectDetails(error: unknown): string[] {
  if (typeof error !== "object" || error === null) return [];
  return Object.keys(error)
    .filter((key) => /^\d+$/.test(key))
    // Numeric-looking keys are already enumerated in ascending order by JS, but
    // sorting explicitly keeps the ordering a property of this code.
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => String((error as Record<string, unknown>)[key]).trim())
    .filter((value) => value !== "" && value !== "undefined" && value !== "null");
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Split a Dolibarr error body into its message and the detail keys around it.
 *
 * Reading only `message` is why every validation failure surfaced as an
 * undiagnosable generic 500 — see issue #7.
 */
export function parseError(body: any): ParsedError {
  if (body === null || body === undefined) return { message: "", details: [] };
  if (typeof body === "string") return { message: body, details: [] };

  const source = typeof body?.debug?.source === "string" ? body.debug.source : undefined;
  const details = collectDetails(body?.error);

  let message: string;
  if (typeof body?.error?.message === "string") message = body.error.message;
  else if (typeof body?.error === "string") message = body.error;
  else if (typeof body?.message === "string") message = body.message;
  else {
    try {
      message = JSON.stringify(body);
    } catch {
      message = String(body);
    }
  }

  return source === undefined ? { message, details } : { message, details, source };
}

export function parseErrorBody(body: any): string {
  return parseError(body).message;
}

const STATUS_HINTS: Record<number, string> = {
  400: "Bad request. Check required fields and value types.",
  401: "Invalid or missing API key. Run \"dolibarr auth login\" to reconfigure.",
  403: "Permission denied. The API user lacks rights for this operation.",
  405: "Method not allowed on this path for your Dolibarr version.",
  // No 500 entry: hintFor handles every 500 explicitly, because what is useful
  // depends on whether the server actually sent a detail.
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

  if (err.status === 500) {
    // Details are the diagnosis. Appending "check the server logs for detail"
    // underneath them contradicts the line above it.
    if (err.details.length > 0) return "";

    // A 500 with nothing attached is the worst case: Dolibarr's update
    // endpoints throw RestException(500, $obj->error) — the *singular* field,
    // which verify() leaves empty while populating $obj->errors[]. The cause
    // never reaches the wire, so say that rather than implying the CLI hid it.
    return (
      "The server returned no detail beyond this message. Dolibarr's update endpoints are " +
      "known to discard their own validation errors before sending. Re-run with --verbose to " +
      "dump the raw response body, and check the Dolibarr server log."
    );
  }

  return STATUS_HINTS[err.status] ?? "";
}

export function handleError(
  err: unknown,
  json: boolean,
  availableModules: string[] = [],
  verbose = false,
): void {
  if (err instanceof DolibarrApiError) {
    if (json) {
      console.error(JSON.stringify({
        error: err.name,
        status: err.status,
        message: err.message,
        // Omitted when absent so the common shape stays unchanged for existing
        // consumers, rather than growing null fields on every error.
        ...(err.details.length > 0 ? { details: err.details } : {}),
        ...(err.source ? { source: err.source } : {}),
        ...(verbose && err.body !== undefined ? { body: err.body } : {}),
      }));
    } else {
      console.error(chalk.red(`Error ${err.status}: ${err.message}`));
      for (const detail of err.details) console.error(chalk.red(`  ${detail}`));
      if (err.source) console.error(chalk.dim(`  (${err.source})`));
      const hint = hintFor(err, availableModules);
      if (hint) console.error(chalk.yellow(`Hint: ${hint}`));
      if (verbose && err.body !== undefined) {
        console.error(chalk.dim("Raw response body:"));
        console.error(chalk.dim(JSON.stringify(err.body, null, 2)));
      }
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
