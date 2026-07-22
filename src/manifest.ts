// src/manifest.ts
import { assignCommandNames, pathParamNames } from "./naming.js";

export interface ParamSpec {
  name: string;
  in: "path" | "query";
  type: string;
  required: boolean;
  description?: string;
}

export interface OperationSpec {
  operationId: string;
  command: string;
  method: string;
  path: string;
  summary?: string;
  pathParams: ParamSpec[];
  query: ParamSpec[];
  hasBody: boolean;
}

export interface Manifest {
  dolibarrVersion: string | null;
  fetchedAt: string;
  basePath: string;
  modules: Record<string, { operations: OperationSpec[] }>;
}

/**
 * HTTP methods to harvest from the spec.
 *
 * `patch` matters: the reference capture contains exactly one PATCH operation
 * (thirdpartiesModifySocieteAccount on /thirdparties/{id}/accounts/{site}).
 * Omitting it silently drops an endpoint while claiming complete coverage.
 * The live 23.0.3 capture has no PATCH at all, so only the reference fixture
 * catches a regression here.
 */
const METHODS = ["get", "post", "put", "delete", "patch"] as const;

/* eslint-disable @typescript-eslint/no-explicit-any */
type RawSpec = Record<string, any>;

function toParam(raw: any): ParamSpec {
  const location = raw.in === "path" ? "path" : "query";
  return {
    name: String(raw.name),
    in: location,
    type: typeof raw.type === "string" ? raw.type : "string",
    // A path parameter is structurally mandatory — the URL cannot be formed
    // without it — so the spec's own `required` is ignored for those. Both
    // committed fixtures really do mark some path params required:false, e.g.
    // GET /thirdparties/{id}/generateBankAccountDocument/{companybankid}/{model}.
    required: location === "path" ? true : Boolean(raw.required),
    description: typeof raw.description === "string" ? raw.description : undefined,
  };
}

/** Sort path parameters into the order they appear in the URL template. */
function orderByPath(path: string, params: ParamSpec[]): ParamSpec[] {
  const order = pathParamNames(path);
  const known = new Map(params.map((p) => [p.name, p]));
  const sorted = order.map((name) => known.get(name)).filter((p): p is ParamSpec => Boolean(p));
  // Keep anything declared but not present in the template rather than dropping it.
  for (const p of params) if (!order.includes(p.name)) sorted.push(p);
  return sorted;
}

/**
 * Merge parameters shared across a path item with an operation's own.
 *
 * Swagger 2.0 allows parameters to be declared once on the PathItem and
 * inherited by every method on it. Reading only the operation's list loses
 * them, and a lost path parameter means the URL cannot be built at runtime.
 * Operation-level entries win, matched on name + location.
 */
function mergeParameters(shared: any[], own: any[]): any[] {
  const keyOf = (p: any) => `${p?.in}:${p?.name}`;
  const merged = new Map<string, any>();
  for (const param of shared) merged.set(keyOf(param), param);
  for (const param of own) merged.set(keyOf(param), param);
  return [...merged.values()];
}

/**
 * Reduce a Dolibarr Swagger 2.0 document to the slim manifest the registry needs.
 *
 * Only paths, methods, tags and parameters are read. Response and body schemas
 * are deliberately ignored: Dolibarr declares them as placeholders (Obj, string,
 * string[], {request_data: string[]}) that do not describe the real payloads.
 */
export function buildManifest(
  spec: RawSpec,
  opts: { fetchedAt: string; dolibarrVersion?: string | null },
): Manifest {
  const byTag: Record<string, Array<{ operationId: string; method: string; path: string; summary?: string; parameters: any[] }>> = {};

  for (const [path, item] of Object.entries<any>(spec.paths ?? {})) {
    const sharedParams = Array.isArray(item?.parameters) ? item.parameters : [];
    for (const method of METHODS) {
      const op = item?.[method];
      if (!op) continue;
      const tag = String(Array.isArray(op.tags) ? op.tags[0] ?? "misc" : "misc");
      // `||` not `??`: an empty-string operationId must fall back too, or the
      // command name derived from it comes out empty and Commander dies on parse.
      const operationId = String(op.operationId || `${method} ${path}`);
      (byTag[tag] ??= []).push({
        operationId,
        method,
        path,
        summary: typeof op.summary === "string" ? op.summary : undefined,
        parameters: mergeParameters(sharedParams, Array.isArray(op.parameters) ? op.parameters : []),
      });
    }
  }

  const modules: Manifest["modules"] = {};
  for (const [tag, ops] of Object.entries(byTag)) {
    const named = assignCommandNames(ops, tag);
    modules[tag] = {
      operations: named
        .map((op) => ({
          operationId: op.operationId,
          command: op.command,
          method: op.method,
          path: op.path,
          summary: op.summary,
          // Ordered by their appearance in the PATH, not by the spec's
          // parameter array. Five live endpoints declare them in a different
          // order, and positional CLI arguments follow the path.
          pathParams: orderByPath(op.path, op.parameters.filter((p: any) => p.in === "path").map(toParam)),
          query: op.parameters.filter((p: any) => p.in === "query").map(toParam),
          hasBody: op.parameters.some((p: any) => p.in === "body" || p.in === "formData"),
        }))
        .sort((a, b) => a.command.localeCompare(b.command)),
    };
  }

  return {
    dolibarrVersion: opts.dolibarrVersion ?? null,
    fetchedAt: opts.fetchedAt,
    basePath: typeof spec.basePath === "string" ? spec.basePath : "",
    modules,
  };
}
