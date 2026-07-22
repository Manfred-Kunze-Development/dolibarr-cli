// src/manifest.ts
import { assignCommandNames } from "./naming.js";

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
  return {
    name: String(raw.name),
    in: raw.in === "path" ? "path" : "query",
    type: typeof raw.type === "string" ? raw.type : "string",
    required: Boolean(raw.required),
    description: typeof raw.description === "string" ? raw.description : undefined,
  };
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
    for (const method of METHODS) {
      const op = item?.[method];
      if (!op) continue;
      const tag = String(op.tags?.[0] ?? "misc");
      (byTag[tag] ??= []).push({
        operationId: String(op.operationId ?? `${method}${path}`),
        method,
        path,
        summary: typeof op.summary === "string" ? op.summary : undefined,
        parameters: Array.isArray(op.parameters) ? op.parameters : [],
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
          pathParams: op.parameters.filter((p: any) => p.in === "path").map(toParam),
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
