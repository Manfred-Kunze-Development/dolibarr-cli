// src/lib/client.ts
import type { ResolvedConfig } from "./config.js";
import { DolibarrApiError, parseErrorBody } from "./errors.js";

export interface RequestOptions {
  method: string;
  path: string;
  pathParams?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  /** Spec tag, carried into errors so a 404 can be attributed to a module. */
  module?: string;
  timeoutMs?: number;
}

export function buildUrl(
  baseUrl: string,
  path: string,
  pathParams: Record<string, string>,
  query: Record<string, unknown>,
): string {
  const filled = path.replace(/\{([^}]+)\}/g, (_all, name: string) => {
    const value = pathParams[name];
    if (value === undefined) throw new Error(`Missing path parameter "${name}".`);
    return encodeURIComponent(value);
  });

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    search.append(key, String(value));
  }

  const qs = search.toString();
  return `${baseUrl.replace(/\/+$/, "")}${filled}${qs ? `?${qs}` : ""}`;
}

/** Default timeout. Generous because a cold spec fetch scans every module. */
const DEFAULT_TIMEOUT_MS = 60_000;

export async function request(config: ResolvedConfig, options: RequestOptions): Promise<unknown> {
  const url = buildUrl(config.baseUrl, options.path, options.pathParams ?? {}, options.query ?? {});

  const headers: Record<string, string> = {
    DOLAPIKEY: config.apiKey,
    Accept: "application/json",
  };
  if (config.entity) headers.DOLAPIENTITY = config.entity;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const isAbort = (err: unknown) => err instanceof Error && err.name === "AbortError";
  const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err));
  const timedOut = () =>
    new Error(
      `Request to ${url} timed out after ${Math.round(timeoutMs / 1000)}s. ` +
        `Use --timeout <seconds> to allow longer.`,
    );

  // The timer must stay armed until the body is fully read. fetch() resolves as
  // soon as headers arrive, so clearing it there leaves a slow-drip or
  // never-completing body with no protection at all — the CLI would hang forever.
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method.toUpperCase(),
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
    } catch (err) {
      if (isAbort(err)) throw timedOut();
      // Naming the cause matters: a TLS handshake failure or a refused
      // connection are both "cannot reach", but only one is fixed by checking
      // whether the instance is running.
      throw new Error(
        `Cannot reach ${config.baseUrl}: ${reasonOf(err)}\n` +
          `Check the instance is running and the base URL is correct ` +
          `(it must end in /api/index.php).`,
      );
    }

    let text: string;
    try {
      text = await response.text();
    } catch (err) {
      if (isAbort(err)) throw timedOut();
      throw new Error(
        `Connection to ${config.baseUrl} broke while reading the response: ${reasonOf(err)}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    if (!response.ok) {
      throw new DolibarrApiError(response.status, parseErrorBody(parsed) || response.statusText, {
        module: options.module,
      });
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}
