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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method.toUpperCase(),
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Request to ${url} timed out. Use --timeout to allow longer.`);
    }
    throw new Error(
      `Cannot reach ${config.baseUrl}. Check the instance is running and the base URL is correct ` +
        `(it must end in /api/index.php).`,
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
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
}
