// src/commands/modules.ts
import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import { getActiveContextName, isJsonOutput } from "../lib/config.js";
import { loadManifest } from "../lib/manifest-store.js";

export function makeModulesCommand(): Command {
  return new Command("modules")
    .description("List the modules the connected instance exposes")
    .action((_opts, command: Command) => {
      const manifest = loadManifest();
      if (!manifest) {
        // Exit non-zero in BOTH formats: a script doing
        // `dolibarr modules --json || handle_unsynced` must be able to branch on
        // status, and every other command signals failure regardless of format.
        process.exitCode = 1;
        if (isJsonOutput(command)) {
          console.log(JSON.stringify({ synced: false, modules: [] }, null, 2));
        } else {
          console.error(chalk.yellow("No manifest for this context."));
          console.error(chalk.dim('Run "dolibarr sync" first.'));
        }
        return;
      }

      const rows = Object.entries(manifest.modules)
        .map(([name, mod]) => ({ module: name, operations: mod.operations.length }))
        .sort((a, b) => a.module.localeCompare(b.module));

      if (isJsonOutput(command)) {
        console.log(JSON.stringify({
          synced: true,
          context: getActiveContextName(),
          dolibarrVersion: manifest.dolibarrVersion,
          fetchedAt: manifest.fetchedAt,
          modules: rows,
        }, null, 2));
        return;
      }

      const table = new Table({ head: [chalk.cyan("module"), chalk.cyan("operations")] });
      for (const row of rows) table.push([row.module, String(row.operations)]);
      console.log(table.toString());
      console.log(chalk.dim(
        `${rows.length} modules on Dolibarr ${manifest.dolibarrVersion ?? "(unknown)"} — synced ${manifest.fetchedAt}`,
      ));
    });
}
# Dolibarr CLI v1 Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a CLI where every REST operation the connected Dolibarr instance exposes is reachable as a real command, with the command tree derived from that instance's own spec.

**Architecture:** `dolibarr sync` fetches the instance's Swagger 2.0 document and reduces it to a slim per-context manifest. At startup a registry turns that manifest into Commander commands — one group per module, one command per operation. Static commands (`auth`, `context`, `config`, `sync`, `modules`, `api`) are always present and work without a manifest. Hand-crafted modules come later and override generated commands by `method + path`.

**Tech Stack:** Node ≥18, TypeScript (ESM, `module: Node16`), Commander, `conf`, chalk, cli-table3, ora, vitest.

**Design:** `docs/superpowers/specs/2026-07-22-dolibarr-cli-design.md`

**Critical invariants** (violating these causes real, verified bugs):
- Operation identity is **`method + path`**, never `operationId` — live 23.0.3 duplicates `thirdpartiesCreateSocieteAccount` across two paths.
- Response and entity-CRUD body types from the spec are **fiction**. Never type against them.
- Dolibarr list endpoints return a bare array with **no total count**. Never fabricate one.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/naming.ts` | `operationId` → command name; collision disambiguation. Pure. |
| `src/manifest.ts` | Swagger 2.0 → slim manifest. Pure. |
| `src/registry.ts` | Manifest → Commander command groups. |
| `src/lib/config.ts` | Context store; config resolution; manifest paths. |
| `src/lib/client.ts` | `request()`; auth headers; timeouts. |
| `src/lib/errors.ts` | `DolibarrApiError`; status hints; module-not-enabled. |
| `src/lib/output.ts` | Table / detail / success rendering; `--json`. |
| `src/lib/body.ts` | `--data` / `--set` / `--extrafield` → request body. |
| `src/commands/*.ts` | Static commands, one file each. |
| `src/data/required-fields.json` | Required create fields, extracted from PHP source. |
| `scripts/extract-fields.mjs` | Regenerates the above from a Dolibarr checkout. |
| `openapi/swagger-reference-38mod.json` | Fixture: 38 modules, 440 ops. Committed. |
| `openapi/swagger-23.0.3.json` | Fixture: 30 modules, 428 ops, 1 duplicate opId. Committed. |

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@manfred-kunze-dev/dolibarr-cli",
  "version": "0.1.0",
  "description": "CLI for the Dolibarr ERP/CRM REST API",
  "type": "module",
  "main": "dist/index.js",
  "bin": { "dolibarr": "dist/cli.js", "doli": "dist/cli.js" },
  "scripts": {
    "build": "tsc && node scripts/copy-assets.mjs",
    "dev": "tsc --watch",
    "typecheck": "tsc --noEmit",
    "start": "node dist/index.js",
    "test": "vitest",
    "test:run": "vitest run",
    "test:unit": "vitest run tests/unit",
    "test:contract": "vitest run tests/contract",
    "extract:fields": "node scripts/extract-fields.mjs"
  },
  "dependencies": {
    "chalk": "^5.6.2",
    "cli-table3": "^0.6.5",
    "commander": "^13.1.0",
    "conf": "^13.1.0",
    "ora": "^8.2.0"
  },
  "devDependencies": {
    "@types/node": "^22.19.17",
    "typescript": "^5.9.3",
    "vitest": "^2.1.8"
  },
  "engines": { "node": ">=18.20.8" },
  "files": ["dist/**/*.js", "dist/**/*.d.ts", "src/data/*.json"]
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 120000,
  },
});
```

- [ ] **Step 4: Create `scripts/copy-assets.mjs`**

`tsc` does not emit `.json` files to `outDir`, so the data files the CLI reads at
runtime must be copied explicitly or `dist/` will be missing them.

```js
// scripts/copy-assets.mjs
import { mkdirSync, copyFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const from = join("src", "data");
const to = join("dist", "data");

if (!existsSync(from)) {
  console.log("No src/data to copy.");
  process.exit(0);
}

mkdirSync(to, { recursive: true });
let count = 0;
for (const file of readdirSync(from)) {
  if (!file.endsWith(".json")) continue;
  copyFileSync(join(from, file), join(to, file));
  count++;
}
console.log(`Copied ${count} data file(s) to ${to}`);
```

- [ ] **Step 5: Install and verify**

Run: `npm install`
Expected: install succeeds.

Run: `npm run typecheck`
Expected: **fails** with `error TS18003: No inputs were found in config file`. This is correct
at this point — `include: ["src/**/*"]` matches nothing until Task 2 creates the first source
file, and `tsc` treats an empty input set as an error rather than a trivial success. Do **not**
add placeholder source files or weaken the tsconfig to silence it; it resolves by itself in
Task 2. Re-run `npm run typecheck` after Task 2 to confirm it goes green.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts scripts/copy-assets.mjs
git commit -m "chore: scaffold TypeScript CLI project

Build copies src/data/*.json into dist: tsc does not emit JSON to outDir, so
the runtime data files would otherwise be missing from the package."
```

---

## Task 2: Command-name derivation

Pure functions. This is where the duplicate-`operationId` bug is defused.

**Files:**
- Create: `src/naming.ts`
- Test: `tests/unit/naming.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { kebab, baseCommandName, pathParamNames, assignCommandNames } from "../../src/naming.js";

describe("kebab", () => {
  it("splits camelCase", () => expect(kebab("CreateLine")).toBe("create-line"));
  it("handles acronym runs", () => expect(kebab("GetByRefExt")).toBe("get-by-ref-ext"));
});

describe("baseCommandName", () => {
  it("maps root CRUD verbs", () => {
    expect(baseCommandName("listThirdparties", "thirdparties")).toBe("list");
    expect(baseCommandName("retrieveThirdparties", "thirdparties")).toBe("get");
    expect(baseCommandName("createThirdparties", "thirdparties")).toBe("create");
    expect(baseCommandName("updateThirdparties", "thirdparties")).toBe("update");
    expect(baseCommandName("removeThirdparties", "thirdparties")).toBe("delete");
  });

  it("strips the module prefix and normalises the leading verb", () => {
    expect(baseCommandName("thirdpartiesRetrieveByEmail", "thirdparties")).toBe("get-by-email");
    expect(baseCommandName("invoicesCreateLine", "invoices")).toBe("create-line");
    expect(baseCommandName("invoicesRemoveLine", "invoices")).toBe("delete-line");
    expect(baseCommandName("productsDelSubproducts", "products")).toBe("delete-subproducts");
    expect(baseCommandName("thirdpartiesMerge", "thirdparties")).toBe("merge");
  });
});

describe("pathParamNames", () => {
  it("extracts braces in order", () => {
    expect(pathParamNames("/thirdparties/{id}/accounts/{site}")).toEqual(["id", "site"]);
    expect(pathParamNames("/invoices")).toEqual([]);
  });
});

describe("assignCommandNames", () => {
  it("disambiguates a duplicate operationId by its extra path parameter", () => {
    // Real case from live Dolibarr 23.0.3.
    const ops = [
      { operationId: "thirdpartiesCreateSocieteAccount", method: "post", path: "/thirdparties/{id}/accounts" },
      { operationId: "thirdpartiesCreateSocieteAccount", method: "post", path: "/thirdparties/{id}/accounts/{site}" },
    ];
    const named = assignCommandNames(ops, "thirdparties");
    expect(named.map((o) => o.command).sort()).toEqual([
      "create-societe-account",
      "create-societe-account-by-site",
    ]);
  });

  it("is deterministic regardless of input order", () => {
    const a = [
      { operationId: "listInvoices", method: "get", path: "/invoices" },
      { operationId: "createInvoices", method: "post", path: "/invoices" },
    ];
    const b = [...a].reverse();
    expect(assignCommandNames(a, "invoices")).toEqual(assignCommandNames(b, "invoices"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/naming.test.ts`
Expected: FAIL — cannot resolve `../../src/naming.js`.

- [ ] **Step 3: Write the implementation**

```ts
// src/naming.ts

/** operationId shape A: <verb><Module> — maps to a canonical CLI verb. */
const ROOT_VERBS: Record<string, string> = {
  list: "list",
  retrieve: "get",
  create: "create",
  update: "update",
  remove: "delete",
};

/** Leading token of a shape-B remainder, normalised. Dolibarr mixes Remove/Del. */
const LEAD_VERBS: Record<string, string> = {
  retrieve: "get",
  get: "get",
  remove: "delete",
  del: "delete",
  delete: "delete",
};

export function kebab(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

export function pathParamNames(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
}

export function baseCommandName(operationId: string, tag: string): string {
  const t = tag.toLowerCase();
  const id = operationId.toLowerCase();

  for (const [verb, command] of Object.entries(ROOT_VERBS)) {
    if (id === verb + t) return command;
  }

  if (id.startsWith(t)) {
    const rest = operationId.slice(tag.length);
    if (rest) {
      const parts = kebab(rest).split("-").filter(Boolean);
      if (parts.length > 0 && LEAD_VERBS[parts[0]]) parts[0] = LEAD_VERBS[parts[0]];
      return parts.join("-");
    }
  }

  return kebab(operationId);
}

export interface OperationRef {
  operationId: string;
  method: string;
  path: string;
}

/**
 * Assign a unique command name to every operation in a module.
 *
 * operationId is NOT unique in real Dolibarr specs, so collisions must be
 * resolved rather than assumed away. Sorting first keeps output deterministic.
 */
export function assignCommandNames<T extends OperationRef>(
  operations: T[],
  tag: string,
): Array<T & { command: string }> {
  const sorted = [...operations].sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  );

  const groups = new Map<string, Array<T & { command: string }>>();
  for (const op of sorted) {
    const command = baseCommandName(op.operationId, tag);
    const group = groups.get(command) ?? [];
    group.push({ ...op, command });
    groups.set(command, group);
  }

  const result: Array<T & { command: string }> = [];
  for (const [base, group] of groups) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }
    // Disambiguate by the path parameters the longer paths add.
    const shared = Math.min(...group.map((op) => pathParamNames(op.path).length));
    const taken = new Set<string>();
    for (const op of group) {
      const extra = pathParamNames(op.path).slice(shared);
      let command = extra.length > 0 ? `${base}-by-${extra.map(kebab).join("-")}` : base;
      if (taken.has(command)) {
        command = kebab(`${op.method}${op.path.replace(/[/{}]/g, "-")}`).replace(/-+/g, "-");
      }
      taken.add(command);
      result.push({ ...op, command });
    }
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/naming.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/naming.ts tests/unit/naming.test.ts
git commit -m "feat: derive command names from operationId

Handles both Dolibarr operationId shapes and disambiguates duplicates by
path parameter. operationId is not unique in real specs: live 23.0.3
attaches thirdpartiesCreateSocieteAccount to two paths."
```

---

## Task 3: Manifest builder

**Files:**
- Create: `src/manifest.ts`
- Test: `tests/unit/manifest.test.ts`

- [ ] **Step 1: Write the failing test**

Both committed fixtures are exercised — the v23 one is what covers the duplicate-`operationId` path.

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildManifest } from "../../src/manifest.js";

const load = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const reference = load("openapi/swagger-reference-38mod.json");
const live23 = load("openapi/swagger-23.0.3.json");
const AT = "2026-07-22T00:00:00Z";

describe("buildManifest", () => {
  it("groups the reference spec into 38 modules and 440 operations", () => {
    const m = buildManifest(reference, { fetchedAt: AT });
    expect(Object.keys(m.modules)).toHaveLength(38);
    const total = Object.values(m.modules).reduce((n, mod) => n + mod.operations.length, 0);
    expect(total).toBe(440);
  });

  it("groups the live 23.0.3 spec into 30 modules and 428 operations", () => {
    const m = buildManifest(live23, { fetchedAt: AT });
    expect(Object.keys(m.modules)).toHaveLength(30);
    const total = Object.values(m.modules).reduce((n, mod) => n + mod.operations.length, 0);
    expect(total).toBe(428);
  });

  it("gives every operation a unique command name within its module", () => {
    for (const spec of [reference, live23]) {
      const m = buildManifest(spec, { fetchedAt: AT });
      for (const [name, mod] of Object.entries(m.modules)) {
        const commands = mod.operations.map((o) => o.command);
        expect(new Set(commands).size, `duplicate command in ${name}`).toBe(commands.length);
      }
    }
  });

  it("captures params and body presence", () => {
    const m = buildManifest(reference, { fetchedAt: AT });
    const list = m.modules.thirdparties.operations.find((o) => o.command === "list")!;
    expect(list.method).toBe("get");
    expect(list.path).toBe("/thirdparties");
    expect(list.query.map((q) => q.name)).toContain("sqlfilters");
    expect(list.hasBody).toBe(false);

    const create = m.modules.thirdparties.operations.find((o) => o.command === "create")!;
    expect(create.hasBody).toBe(true);

    const get = m.modules.thirdparties.operations.find((o) => o.command === "get")!;
    expect(get.pathParams.map((p) => p.name)).toEqual(["id"]);
  });

  it("preserves basePath", () => {
    expect(buildManifest(reference, { fetchedAt: AT }).basePath).toBe("/api/index.php");
  });

  it("harvests PATCH operations", () => {
    // The reference spec has exactly one PATCH. Dropping it would lose an
    // endpoint while still claiming complete coverage, and the live 23.0.3
    // fixture cannot catch that because it contains no PATCH at all.
    const m = buildManifest(reference, { fetchedAt: AT });
    const patched = m.modules.thirdparties.operations.filter((o) => o.method === "patch");
    expect(patched).toHaveLength(1);
    expect(patched[0].path).toBe("/thirdparties/{id}/accounts/{site}");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/manifest.test.ts`
Expected: FAIL — cannot resolve `../../src/manifest.js`.

- [ ] **Step 3: Write the implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/manifest.test.ts`
Expected: PASS — counts match both fixtures (38/440 and 30/428).

- [ ] **Step 5: Commit**

```bash
git add src/manifest.ts tests/unit/manifest.test.ts
git commit -m "feat: build a slim command manifest from a Dolibarr swagger doc

Tested against both committed fixtures, which differ in module set,
operation count and path count -- neither is a subset of the other."
```

---

## Task 4: Config and contexts

**Files:**
- Create: `src/lib/config.ts`
- Test: `tests/unit/config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { resolveFrom, manifestPathFor, validateContextName } from "../../src/lib/config.js";

describe("validateContextName", () => {
  it("accepts safe names", () => expect(() => validateContextName("acme-1_x")).not.toThrow());
  it("rejects path separators", () => expect(() => validateContextName("a/b")).toThrow());
});

describe("resolveFrom", () => {
  const ctx = { baseUrl: "http://ctx/api/index.php", apiKey: "ctx-key" };

  it("prefers flags over everything", () => {
    const r = resolveFrom({
      flags: { apiKey: "flag", baseUrl: "http://flag" },
      env: { DOLIBARR_API_KEY: "env", DOLIBARR_BASE_URL: "http://env" },
      local: { apiKey: "local", baseUrl: "http://local" },
      context: ctx,
    });
    expect(r).toEqual({ apiKey: "flag", baseUrl: "http://flag" });
  });

  it("falls back flags -> env -> local -> context", () => {
    expect(resolveFrom({ flags: {}, env: { DOLIBARR_API_KEY: "env" }, local: {}, context: ctx }).apiKey).toBe("env");
    expect(resolveFrom({ flags: {}, env: {}, local: { apiKey: "local" }, context: ctx }).apiKey).toBe("local");
    expect(resolveFrom({ flags: {}, env: {}, local: {}, context: ctx }).apiKey).toBe("ctx-key");
  });

  it("throws a directive error when no key is available", () => {
    expect(() => resolveFrom({ flags: {}, env: {}, local: {}, context: undefined }))
      .toThrow(/dolibarr auth login/);
  });

  it("throws when no base URL is available", () => {
    expect(() => resolveFrom({ flags: { apiKey: "k" }, env: {}, local: {}, context: undefined }))
      .toThrow(/base URL/i);
  });
});

describe("manifestPathFor", () => {
  it("is namespaced per context", () => {
    expect(manifestPathFor("acme")).toMatch(/acme\.json$/);
    expect(manifestPathFor("acme")).not.toBe(manifestPathFor("other"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/config.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/config.js`.

- [ ] **Step 3: Write the implementation**

There is deliberately no default base URL: unlike a SaaS backend, every Dolibarr lives somewhere different.

```ts
// src/lib/config.ts
import Conf from "conf";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Command } from "commander";

export interface ContextEntry {
  baseUrl: string;
  apiKey: string;
  entity?: string;
}

export interface ResolvedConfig {
  baseUrl: string;
  apiKey: string;
  entity?: string;
}

interface Store {
  activeContext: string;
  contexts: Record<string, ContextEntry>;
}

let cachedStore: Conf<Store> | undefined;

/**
 * The config store, constructed on first use.
 *
 * Deliberately lazy: `conf`'s constructor eagerly creates the config file on
 * disk, so building this at module scope means merely *importing* this module
 * writes to the user's real profile — polluting their config on every test run,
 * and failing wherever HOME is read-only.
 *
 * DOLIBARR_CONFIG_DIR redirects the store elsewhere; the test suite sets it so
 * tests can exercise context handling without touching the real profile.
 */
export function getStore(): Conf<Store> {
  if (!cachedStore) {
    const override = process.env.DOLIBARR_CONFIG_DIR;
    cachedStore = new Conf<Store>({
      projectName: "dolibarr",
      projectSuffix: "",
      ...(override ? { cwd: override } : {}),
      // This file holds API keys in the clear. conf defaults to 0o666, which
      // with a typical umask lands at 0644 — world-readable, so any other local
      // account on a shared host or CI runner could read the credentials.
      // Windows ignores POSIX modes and relies on profile ACLs instead.
      configFileMode: 0o600,
      defaults: { activeContext: "default", contexts: {} },
    });
  }
  return cachedStore;
}

/** Test seam: drop the cached store so a new DOLIBARR_CONFIG_DIR takes effect. */
export function resetStoreForTesting(): void {
  cachedStore = undefined;
}

const CONTEXT_NAME_RE = /^[A-Za-z0-9_-]+$/;

export function validateContextName(name: string): void {
  if (!CONTEXT_NAME_RE.test(name)) {
    throw new Error("Context name may contain only letters, numbers, hyphens and underscores.");
  }
}

export function getActiveContextName(): string {
  return getStore().get("activeContext") ?? "default";
}

export function getAllContexts(): Record<string, ContextEntry> {
  return getStore().get("contexts") ?? {};
}

export function getActiveContext(): ContextEntry | undefined {
  return getAllContexts()[getActiveContextName()];
}

export function setContext(name: string, entry: ContextEntry): void {
  validateContextName(name);
  getStore().set("contexts", { ...getAllContexts(), [name]: entry });
}

export function deleteContext(name: string): void {
  const contexts = getAllContexts();
  if (!contexts[name]) throw new Error(`Context "${name}" does not exist.`);
  delete contexts[name];
  getStore().set("contexts", contexts);
  if (getActiveContextName() === name) {
    getStore().set("activeContext", Object.keys(contexts)[0] ?? "default");
  }
}

export function setActiveContext(name: string): void {
  if (!getAllContexts()[name]) {
    throw new Error(
      `Context "${name}" does not exist. Available: ${Object.keys(getAllContexts()).join(", ") || "(none)"}`,
    );
  }
  getStore().set("activeContext", name);
}

/** Manifests live beside the config store, one file per context. */
export function manifestPathFor(contextName: string): string {
  validateContextName(contextName);
  return join(getStore().path, "..", "manifests", `${contextName}.json`);
}

export interface ResolveInputs {
  flags: { apiKey?: string; baseUrl?: string; entity?: string };
  env: Record<string, string | undefined>;
  local: Partial<ContextEntry>;
  context: ContextEntry | undefined;
}

/** Pure resolution so precedence is testable without touching disk or env. */
export function resolveFrom(inputs: ResolveInputs): ResolvedConfig {
  const { flags, env, local, context } = inputs;

  const apiKey = flags.apiKey ?? env.DOLIBARR_API_KEY ?? local.apiKey ?? context?.apiKey;
  const baseUrl = flags.baseUrl ?? env.DOLIBARR_BASE_URL ?? local.baseUrl ?? context?.baseUrl;
  const entity = flags.entity ?? env.DOLIBARR_ENTITY ?? local.entity ?? context?.entity;

  if (!apiKey) {
    throw new Error('No API key configured. Run "dolibarr auth login" or set DOLIBARR_API_KEY.');
  }
  if (!baseUrl) {
    throw new Error(
      'No base URL configured. Run "dolibarr auth login" or set DOLIBARR_BASE_URL ' +
        "(e.g. http://localhost:8023/api/index.php).",
    );
  }
  return { apiKey, baseUrl, entity };
}

function readLocalFile(): Partial<ContextEntry> {
  const path = resolve(process.cwd(), ".dolibarr");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

export function rootOf(command: Command): Command {
  let root = command;
  while (root.parent) root = root.parent;
  return root;
}

export function resolveConfig(command: Command): ResolvedConfig {
  const opts = rootOf(command).opts();
  return resolveFrom({
    flags: { apiKey: opts.apiKey, baseUrl: opts.baseUrl, entity: opts.entity },
    env: process.env,
    local: readLocalFile(),
    context: getActiveContext(),
  });
}

export function isJsonOutput(command: Command): boolean {
  return rootOf(command).opts().json === true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/config.ts tests/unit/config.test.ts
git commit -m "feat: context store and config resolution

No default base URL: every Dolibarr instance lives somewhere different, so
an unset URL is an error with a directive message rather than a guess."
```

---

## Task 5: Errors

**Files:**
- Create: `src/lib/errors.ts`
- Test: `tests/unit/errors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { DolibarrApiError, hintFor, parseErrorBody } from "../../src/lib/errors.js";

describe("parseErrorBody", () => {
  it("reads Dolibarr's nested error shape", () => {
    expect(parseErrorBody({ error: { code: 404, message: "Thirdparty not found" } }))
      .toBe("Thirdparty not found");
  });
  it("falls back to a stringified body", () => {
    expect(parseErrorBody({ weird: true })).toContain("weird");
  });
  it("tolerates null", () => expect(parseErrorBody(null)).toBe(""));
});

describe("hintFor", () => {
  it("explains an unauthorised key", () => {
    expect(hintFor(new DolibarrApiError(401, "x"), [])).toMatch(/api key/i);
  });

  it("explains a 404 on a module the instance does not expose", () => {
    const err = new DolibarrApiError(404, "not found", { module: "mos" });
    const hint = hintFor(err, ["invoices", "thirdparties"]);
    expect(hint).toMatch(/not enabled/i);
    expect(hint).toContain("mos");
  });

  it("gives the ordinary 404 hint when the module does exist", () => {
    const err = new DolibarrApiError(404, "not found", { module: "invoices" });
    expect(hintFor(err, ["invoices"])).toMatch(/id/i);
  });

  it("explains the api/temp failure", () => {
    const err = new DolibarrApiError(500, "Erreur temp dir api/temp not writable");
    expect(hintFor(err, [])).toMatch(/activateModule|api\/temp/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/errors.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/errors.js`.

- [ ] **Step 3: Write the implementation**

```ts
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
  } else {
    console.error(chalk.red(`Unknown error: ${String(err)}`));
  }
  process.exitCode = 1;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/errors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/errors.ts tests/unit/errors.test.ts
git commit -m "feat: error mapping with module-awareness

A 404 against a module the manifest does not list reports that the module is
not enabled, rather than suggesting the ID is wrong."
```

---

## Task 6: Request body assembly

**Files:**
- Create: `src/lib/body.ts`
- Test: `tests/unit/body.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildBody, checkRequired } from "../../src/lib/body.js";

describe("buildBody", () => {
  it("returns undefined when nothing is supplied", () => {
    expect(buildBody({})).toBeUndefined();
  });

  it("parses inline JSON", () => {
    expect(buildBody({ data: '{"name":"ACME"}' })).toEqual({ name: "ACME" });
  });

  it("applies --set on top of --data", () => {
    expect(buildBody({ data: '{"name":"ACME","client":1}', set: ["client=2"] }))
      .toEqual({ name: "ACME", client: 2 });
  });

  it("coerces numbers and booleans but keeps other strings", () => {
    expect(buildBody({ set: ["a=1", "b=true", "c=hello", "d=1.5"] }))
      .toEqual({ a: 1, b: true, c: "hello", d: 1.5 });
  });

  it("supports dot paths", () => {
    expect(buildBody({ set: ["a.b=1"] })).toEqual({ a: { b: 1 } });
  });

  it("routes extrafields into array_options", () => {
    expect(buildBody({ extrafield: ["colour=red"] }))
      .toEqual({ array_options: { options_colour: "red" } });
  });

  it("rejects a malformed --set", () => {
    expect(() => buildBody({ set: ["noequals"] })).toThrow(/key=value/);
  });

  it("rejects malformed JSON with a clear message", () => {
    expect(() => buildBody({ data: "{oops" })).toThrow(/not valid JSON/i);
  });
});

describe("checkRequired", () => {
  it("passes when all required fields are present", () => {
    expect(() => checkRequired("thirdparties", { name: "ACME" }, { thirdparties: ["name"] })).not.toThrow();
  });

  it("names every missing field", () => {
    expect(() => checkRequired("bankaccounts", { ref: "x" }, { bankaccounts: ["ref", "label", "type"] }))
      .toThrow(/label, type/);
  });

  it("is a no-op for modules with no known requirements", () => {
    expect(() => checkRequired("unknown", {}, {})).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/body.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/body.js`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/body.ts
import { readFileSync } from "node:fs";

export interface BodyInputs {
  data?: string;
  set?: string[];
  extrafield?: string[];
}

type Json = Record<string, unknown>;

/**
 * Interpret a CLI string value.
 *
 * Only converts to a number when the text round-trips exactly. Dolibarr has
 * real fields where a leading zero carries meaning — postal codes, account
 * refs, barcodes, phone numbers with a trunk prefix — and `Number("01234")`
 * would silently rewrite them as 1234.
 */
function coerce(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (raw !== "" && !Number.isNaN(Number(raw)) && String(Number(raw)) === raw) {
    return Number(raw);
  }
  return raw;
}

/**
 * Path segments that must never be traversed.
 *
 * `cursor["__proto__"]` resolves to Object.prototype, which satisfies a naive
 * typeof-object check, so a dotted key would walk into the real prototype and
 * assign onto it — poisoning every object in the process (CWE-1321).
 */
const UNSAFE_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

function assignPath(target: Json, path: string, value: unknown): void {
  const parts = path.split(".");
  for (const part of parts) {
    if (UNSAFE_SEGMENTS.has(part)) {
      throw new Error(`Unsafe key "${part}" in "${path}".`);
    }
  }

  let cursor: Json = target;
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      cursor[part] = Object.create(null) as Json;
    }
    cursor = cursor[part] as Json;
  }
  cursor[parts[parts.length - 1]] = value;
}

function splitPair(pair: string, flag: string): [string, string] {
  const index = pair.indexOf("=");
  if (index <= 0) throw new Error(`Invalid ${flag} "${pair}". Expected key=value.`);
  return [pair.slice(0, index), pair.slice(index + 1)];
}

/**
 * Assemble a request body from --data, --set and --extrafield.
 *
 * Dolibarr create/update endpoints accept an open field bag (post() assigns any
 * property of the entity), so the CLI never restricts the key set. --data is the
 * base; --set and --extrafield are applied on top so a file can act as a template.
 */
export function buildBody(inputs: BodyInputs): Json | undefined {
  const { data, set = [], extrafield = [] } = inputs;
  if (data === undefined && set.length === 0 && extrafield.length === 0) return undefined;

  let body: Json = {};
  if (data !== undefined) {
    let raw: string;
    if (data.startsWith("@")) {
      const file = data.slice(1);
      try {
        raw = readFileSync(file, "utf8");
      } catch (err) {
        // readFileSync's ENOENT mentions neither --data nor what to do about it.
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`--data file could not be read: ${file} (${reason})`);
      }
    } else {
      raw = data;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`--data is not valid JSON: ${raw.slice(0, 60)}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("--data must be a JSON object.");
    }
    body = parsed as Json;
  }

  for (const pair of set) {
    const [key, value] = splitPair(pair, "--set");
    assignPath(body, key, coerce(value));
  }

  for (const pair of extrafield) {
    const [key, value] = splitPair(pair, "--extrafield");
    const options = (body.array_options as Json | undefined) ?? {};
    options[`options_${key}`] = value;
    body.array_options = options;
  }

  return body;
}

/** Client-side check against fields extracted from the Dolibarr PHP source. */
export function checkRequired(
  module: string,
  body: Json | undefined,
  table: Record<string, string[]>,
): void {
  const required = table[module];
  if (!required || required.length === 0) return;
  const present = body ?? {};
  const missing = required.filter((field) => present[field] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `Missing required field(s) for ${module}: ${missing.join(", ")}. ` +
        `Supply them with --set ${missing[0]}=<value> or in --data.`,
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/body.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/body.ts tests/unit/body.test.ts
git commit -m "feat: assemble request bodies from --data/--set/--extrafield

Dolibarr create endpoints take an open field bag, so the CLI never restricts
keys; --set layers over --data so files work as templates."
```

---

## Task 7: Required-fields data and extraction script

**Files:**
- Create: `src/data/required-fields.json`, `scripts/extract-fields.mjs`
- Test: `tests/unit/required-fields.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const table = JSON.parse(readFileSync("src/data/required-fields.json", "utf8"));

describe("required-fields.json", () => {
  it("matches values extracted from the Dolibarr PHP source", () => {
    expect(table.thirdparties).toEqual(["name"]);
    expect(table.products).toEqual(["ref", "label"]);
    expect(table.orders).toEqual(["socid", "date"]);
    expect(table.bankaccounts).toEqual(["ref", "label", "type", "currency_code", "country_id"]);
    expect(table.stockmovements).toEqual(["product_id", "warehouse_id", "qty"]);
  });

  it("has no empty module keys", () => {
    for (const [module, fields] of Object.entries(table)) {
      expect(Array.isArray(fields), `${module} must map to an array`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/required-fields.test.ts`
Expected: FAIL — `src/data/required-fields.json` does not exist.

- [ ] **Step 3: Create the data file**

Extracted from each API class's `public static $FIELDS` in Dolibarr v24 source. `accountancy` is omitted because its `$FIELDS` is empty.

```json
{
  "agendaevents": ["userownerid", "type_code"],
  "bankaccounts": ["ref", "label", "type", "currency_code", "country_id"],
  "categories": ["label", "type"],
  "contacts": ["lastname"],
  "contracts": ["socid", "date_contrat"],
  "donations": ["amount"],
  "emailtemplates": ["label", "topic", "type_template"],
  "eventattendees": ["fk_project"],
  "expensereports": ["fk_user_author", "date_debut", "date_fin"],
  "holidays": ["fk_user", "date_debut", "date_fin"],
  "interventions": ["socid", "fk_project", "description"],
  "invoices": ["socid"],
  "mailings": ["title", "sujet", "body"],
  "members": ["morphy", "typeid"],
  "memberstypes": ["label"],
  "objectlinks": ["fk_source", "sourcetype", "fk_target", "targettype"],
  "orders": ["socid", "date"],
  "productlots": ["fk_product", "batch"],
  "products": ["ref", "label"],
  "projects": ["ref", "title"],
  "proposals": ["socid"],
  "receptions": ["socid", "origin_id", "origin_type"],
  "salaries": ["fk_user", "label", "amount"],
  "shipments": ["socid", "origin_id", "origin_type"],
  "stockmovements": ["product_id", "warehouse_id", "qty"],
  "subscriptions": ["fk_adherent", "dateh", "datef", "amount"],
  "supplierinvoices": ["socid"],
  "supplierorders": ["socid"],
  "supplierproposals": ["socid"],
  "tasks": ["ref", "label", "fk_project"],
  "thirdparties": ["name"],
  "tickets": ["subject", "message"],
  "users": ["login"],
  "warehouses": ["label"],
  "webhook": ["url", "trigger_codes"],
  "zapier": ["url"]
}
```

There is deliberately no `workstations` key: that API class declares no `$FIELDS`,
so it has no client-side requirements. `accountancy` is likewise omitted — its
`$FIELDS` is an empty array. `checkRequired` treats an absent key as "nothing
required", so omitting them is correct rather than an oversight.

Note the API tag names differ from the PHP class filenames: `supplier_invoices` → `supplierinvoices`, `supplier_orders` → `supplierorders`, `supplier_proposals` → `supplierproposals`, so the table is keyed by *spec tag*, which is what `checkRequired` receives.

- [ ] **Step 4: Create the regeneration script**

```js
// scripts/extract-fields.mjs
//
// Regenerate src/data/required-fields.json from a Dolibarr source checkout.
//
//   node scripts/extract-fields.mjs /path/to/dolibarr
//
// Each REST API class declares `public static $FIELDS` listing the fields its
// _validate() requires on create. This is absent from the swagger spec at every
// level, which is why it is extracted from source.
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2];
if (!root) {
  console.error("Usage: node scripts/extract-fields.mjs /path/to/dolibarr");
  process.exit(1);
}

// Spec tag names differ from PHP class filenames for the supplier modules.
const TAG_ALIASES = {
  supplier_invoices: "supplierinvoices",
  supplier_orders: "supplierorders",
  supplier_proposals: "supplierproposals",
};

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/^api_.*\.class\.php$/.test(entry.name)) out.push(p);
  }
  return out;
}

const result = {};
for (const file of walk(path.join(root, "htdocs"))) {
  const src = fs.readFileSync(file, "utf8");
  const match = src.match(/static\s+\$FIELDS\s*=\s*array\(([\s\S]*?)\)\s*;/);
  if (!match) continue;
  const raw = path.basename(file).replace(/^api_/, "").replace(/\.class\.php$/, "");
  const name = TAG_ALIASES[raw] ?? raw;
  result[name] = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const sorted = Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
const out = path.join("src", "data", "required-fields.json");
fs.writeFileSync(out, JSON.stringify(sorted, null, 2) + "\n");
console.log(`Wrote ${Object.keys(sorted).length} modules to ${out}`);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/required-fields.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/data/required-fields.json scripts/extract-fields.mjs tests/unit/required-fields.test.ts
git commit -m "feat: required create fields extracted from Dolibarr source

These appear nowhere in the swagger spec. Regenerate per supported major
with npm run extract:fields -- /path/to/dolibarr."
```

---

## Task 8: HTTP client

**Files:**
- Create: `src/lib/client.ts`
- Test: `tests/unit/client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { buildUrl, request } from "../../src/lib/client.js";
import { DolibarrApiError } from "../../src/lib/errors.js";

const cfg = { baseUrl: "http://host/api/index.php", apiKey: "k" };

describe("buildUrl", () => {
  it("substitutes path parameters", () => {
    expect(buildUrl(cfg.baseUrl, "/invoices/{id}", { id: "42" }, {}))
      .toBe("http://host/api/index.php/invoices/42");
  });

  it("url-encodes path parameters", () => {
    expect(buildUrl(cfg.baseUrl, "/thirdparties/email/{email}", { email: "a b@c.d" }, {}))
      .toContain("a%20b%40c.d");
  });

  it("appends query parameters and skips undefined", () => {
    const url = buildUrl(cfg.baseUrl, "/invoices", {}, { limit: 10, page: undefined, sortorder: "ASC" });
    expect(url).toBe("http://host/api/index.php/invoices?limit=10&sortorder=ASC");
  });

  it("strips trailing slashes from the base URL", () => {
    expect(buildUrl("http://host/api/index.php/", "/status", {}, {}))
      .toBe("http://host/api/index.php/status");
  });
});

describe("request", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the DOLAPIKEY header and returns parsed JSON", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ id: 1 }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await request(cfg, { method: "get", path: "/invoices" });
    expect(result).toEqual([{ id: 1 }]);
    expect(fetchMock.mock.calls[0][1].headers.DOLAPIKEY).toBe("k");
  });

  it("sends DOLAPIENTITY only when an entity is configured", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await request(cfg, { method: "get", path: "/status" });
    expect(fetchMock.mock.calls[0][1].headers.DOLAPIENTITY).toBeUndefined();

    await request({ ...cfg, entity: "2" }, { method: "get", path: "/status" });
    expect(fetchMock.mock.calls[1][1].headers.DOLAPIENTITY).toBe("2");
  });

  it("throws DolibarrApiError carrying the module for non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "Not Found" } }), { status: 404 })));

    await expect(request(cfg, { method: "get", path: "/mos/1", module: "mos" }))
      .rejects.toMatchObject({ status: 404, message: "Not Found", module: "mos" });
  });

  it("surfaces a non-JSON error body verbatim", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("Erreur temp dir api/temp not writable", { status: 500 })));

    await expect(request(cfg, { method: "get", path: "/explorer/swagger.json" }))
      .rejects.toThrow(/api\/temp not writable/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/client.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/client.js`.

- [ ] **Step 3: Write the implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/client.ts tests/unit/client.test.ts
git commit -m "feat: HTTP client with DOLAPIKEY auth and module-tagged errors"
```

---

## Task 9: Output rendering

**Files:**
- Create: `src/lib/output.ts`
- Test: `tests/unit/output.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { pickColumns, formatFooter, renderValue } from "../../src/lib/output.js";

describe("pickColumns", () => {
  it("prefers the configured hint list, keeping only present fields", () => {
    const rows = [{ id: 1, ref: "FA-1", nonexistent: undefined, total_ttc: 10 }];
    expect(pickColumns(rows, ["id", "ref", "missing"], undefined)).toEqual(["id", "ref"]);
  });

  it("honours an explicit override", () => {
    expect(pickColumns([{ a: 1, b: 2 }], ["a"], ["b", "a"])).toEqual(["b", "a"]);
  });

  it("falls back to the first six scalar keys", () => {
    const row: Record<string, unknown> = {};
    for (let i = 0; i < 10; i++) row[`f${i}`] = i;
    row.nested = { x: 1 };
    expect(pickColumns([row], undefined, undefined)).toEqual(["f0", "f1", "f2", "f3", "f4", "f5"]);
  });

  it("returns an empty list for no rows", () => {
    expect(pickColumns([], undefined, undefined)).toEqual([]);
  });
});

describe("formatFooter", () => {
  it("never invents a total, because Dolibarr does not return one", () => {
    expect(formatFooter(20, 0)).toBe("20 results (page 1)");
    expect(formatFooter(3, 2)).toBe("3 results (page 3)");
  });
});

describe("renderValue", () => {
  it("renders nullish as a dash", () => expect(renderValue(null)).toBe("—"));
  it("stringifies objects", () => expect(renderValue({ a: 1 })).toBe('{"a":1}'));
  it("passes scalars through", () => expect(renderValue(42)).toBe("42"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/output.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/output.js`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/output.ts
import chalk from "chalk";
import Table from "cli-table3";
import type { Command } from "commander";
import { isJsonOutput } from "./config.js";

type Row = Record<string, unknown>;

const MAX_FALLBACK_COLUMNS = 6;

export function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Fields worth showing first when a module has no configured hint list.
 *
 * Dolibarr key order is PHP property declaration order, which is close to
 * useless for display: a real 163-key thirdparty starts
 * module/id/entity/import_key/array_languages/contacts_ids — four of them null —
 * with `name` at index 46. Most modules have no hint list, so without this the
 * table would be blank columns for almost everything.
 */
const PREFERRED_FALLBACK = [
  "id", "ref", "ref_ext", "label", "name", "title", "subject", "code",
  "code_client", "login", "socid", "fk_soc", "fk_project", "email", "town",
  "date", "datec", "date_creation", "qty", "price", "total_ttc",
  "status", "statut", "active",
];

export function pickColumns(
  rows: Row[],
  hints: string[] | undefined,
  override: string[] | undefined,
): string[] {
  if (override && override.length > 0) return override;
  if (rows.length === 0) return [];

  // Union across all rows: a key missing from row 0 would otherwise be
  // invisible for the entire table.
  const scalarKeys = new Set<string>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (value === null || typeof value !== "object") scalarKeys.add(key);
    }
  }

  const hasValue = (key: string) =>
    rows.some((r) => r[key] !== undefined && r[key] !== null && r[key] !== "");

  if (hints && hints.length > 0) {
    const chosen = hints.filter((h) => scalarKeys.has(h) && rows.some((r) => r[h] !== undefined));
    if (chosen.length > 0) return chosen;
  }

  const preferred = PREFERRED_FALLBACK.filter((key) => scalarKeys.has(key) && hasValue(key));
  if (preferred.length > 0) return preferred.slice(0, MAX_FALLBACK_COLUMNS);

  // Nothing recognisable — prefer columns that at least carry data.
  const populated = [...scalarKeys].filter(hasValue);
  return (populated.length > 0 ? populated : [...scalarKeys]).slice(0, MAX_FALLBACK_COLUMNS);
}

/**
 * Dolibarr list endpoints return a bare array with no total count, so the footer
 * reports only what was received. Never fabricate a total or a page count.
 */
export function formatFooter(count: number, page: number): string {
  return `${count} ${count === 1 ? "result" : "results"} (page ${page + 1})`;
}

export function formatList(
  rows: Row[],
  command: Command,
  opts: { hints?: string[]; columns?: string[]; page?: number } = {},
): void {
  if (isJsonOutput(command)) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (rows.length === 0) {
    console.log(chalk.dim("No results."));
    return;
  }

  const columns = pickColumns(rows, opts.hints, opts.columns);
  const table = new Table({ head: columns.map((c) => chalk.cyan(c)), wordWrap: true });
  for (const row of rows) table.push(columns.map((c) => renderValue(row[c])));

  console.log(table.toString());
  console.log(chalk.dim(formatFooter(rows.length, opts.page ?? 0)));
}

export function formatDetail(record: Row, command: Command): void {
  if (isJsonOutput(command)) {
    console.log(JSON.stringify(record, null, 2));
    return;
  }
  // wordWrap matters here: real records carry nested blobs such as `rights`,
  // which stringify to long unbroken lines that would otherwise overrun the
  // terminal width instead of wrapping.
  const table = new Table({ wordWrap: true });
  for (const [key, value] of Object.entries(record)) {
    table.push({ [chalk.cyan(key)]: renderValue(value) });
  }
  console.log(table.toString());
}

export function formatResult(result: unknown, command: Command, opts: { hints?: string[]; columns?: string[]; page?: number } = {}): void {
  if (Array.isArray(result)) formatList(result as Row[], command, opts);
  else if (result && typeof result === "object") formatDetail(result as Row, command);
  else if (isJsonOutput(command)) console.log(JSON.stringify(result));
  else console.log(renderValue(result));
}

export function formatSuccess(message: string, command: Command): void {
  if (isJsonOutput(command)) console.log(JSON.stringify({ success: true, message }));
  else console.log(chalk.green(message));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/output.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/output.ts tests/unit/output.test.ts
git commit -m "feat: table/detail/json rendering

Footer reports only the received count: Dolibarr list endpoints return a bare
array with no total, so there is nothing to page against."
```

---

## Task 10: Manifest persistence

**Files:**
- Create: `src/lib/manifest-store.ts`
- Test: `tests/unit/manifest-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveManifestTo, loadManifestFrom } from "../../src/lib/manifest-store.js";
import type { Manifest } from "../../src/manifest.js";

let dir: string;
const manifest: Manifest = {
  dolibarrVersion: "23.0.3",
  fetchedAt: "2026-07-22T00:00:00Z",
  basePath: "/api/index.php",
  modules: { invoices: { operations: [] } },
};

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "doli-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("manifest store", () => {
  it("round-trips a manifest", () => {
    const path = join(dir, "nested", "acme.json");
    saveManifestTo(path, manifest);
    expect(existsSync(path)).toBe(true);
    expect(loadManifestFrom(path)).toEqual(manifest);
  });

  it("returns undefined when absent", () => {
    expect(loadManifestFrom(join(dir, "missing.json"))).toBeUndefined();
  });

  it("returns undefined for a corrupt file rather than throwing", () => {
    const path = join(dir, "bad.json");
    saveManifestTo(path, manifest);
    writeFileSync(path, "{not json");
    expect(loadManifestFrom(path)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/manifest-store.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/manifest-store.js`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/manifest-store.ts
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import type { Manifest } from "../manifest.js";
import { manifestPathFor, getActiveContextName } from "./config.js";

/**
 * Write the manifest atomically.
 *
 * A plain writeFileSync can be interrupted or interleaved by a concurrent
 * `sync`, and a truncated manifest may still parse as valid JSON with fewer
 * modules — loading silently as a complete-looking but wrong picture of the
 * instance. Writing to a temp file and renaming makes the swap atomic, so a
 * reader sees either the old manifest or the new one.
 *
 * Indented on purpose: this is a file users open when a command they expected
 * is missing after a sync.
 */
export function saveManifestTo(path: string, manifest: Manifest): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(manifest, null, 2), "utf8");
    renameSync(temp, path);
  } catch (err) {
    rmSync(temp, { force: true });
    throw err;
  }
}

/**
 * A missing or corrupt manifest is not fatal — the CLI falls back to static
 * commands. But it says so on stderr for anything other than "not synced yet",
 * because silently offering fewer commands than expected is hard to diagnose.
 */
export function loadManifestFrom(path: string): Manifest | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // Not synced yet is the normal first-run state, not a problem worth reporting.
    if (code === "ENOENT") return undefined;
    // A permissions problem is actionable, and "run sync" will NOT fix it —
    // sync would fail writing to the same place.
    process.stderr.write(
      `[warning] Could not read the command manifest at ${path}: ` +
        `${err instanceof Error ? err.message : String(err)}\n`,
    );
    return undefined;
  }

  try {
    return JSON.parse(raw) as Manifest;
  } catch {
    process.stderr.write(
      `[warning] The command manifest at ${path} is unreadable. ` +
        `Run "dolibarr sync" to rebuild it.\n`,
    );
    return undefined;
  }
}

export function saveManifest(manifest: Manifest, contextName = getActiveContextName()): string {
  const path = manifestPathFor(contextName);
  saveManifestTo(path, manifest);
  return path;
}

export function loadManifest(contextName = getActiveContextName()): Manifest | undefined {
  return loadManifestFrom(manifestPathFor(contextName));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/manifest-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/manifest-store.ts tests/unit/manifest-store.test.ts
git commit -m "feat: persist manifests per context

A corrupt manifest degrades to static-only commands rather than crashing."
```

---

## Task 11: Command registry

**Files:**
- Create: `src/registry.ts`
- Test: `tests/unit/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { buildManifest } from "../../src/manifest.js";
import { registerGeneratedCommands } from "../../src/registry.js";

const spec = JSON.parse(readFileSync("openapi/swagger-23.0.3.json", "utf8"));
const manifest = buildManifest(spec, { fetchedAt: "2026-07-22T00:00:00Z" });

function build(): Command {
  const program = new Command();
  registerGeneratedCommands(program, manifest, new Set());
  return program;
}

describe("registerGeneratedCommands", () => {
  it("creates one group per module", () => {
    const names = build().commands.map((c) => c.name());
    expect(names).toContain("invoices");
    expect(names).toContain("thirdparties");
    expect(names).toHaveLength(Object.keys(manifest.modules).length);
  });

  it("creates a subcommand per operation", () => {
    const invoices = build().commands.find((c) => c.name() === "invoices")!;
    const subs = invoices.commands.map((c) => c.name());
    expect(subs).toContain("list");
    expect(subs).toContain("create");
    expect(subs).toContain("get");
  });

  it("registers both halves of a duplicated operationId", () => {
    const tp = build().commands.find((c) => c.name() === "thirdparties")!;
    const subs = tp.commands.map((c) => c.name());
    expect(subs).toContain("create-societe-account");
    expect(subs).toContain("create-societe-account-by-site");
  });

  it("turns path params into arguments and query params into options", () => {
    const invoices = build().commands.find((c) => c.name() === "invoices")!;
    const get = invoices.commands.find((c) => c.name() === "get")!;
    expect(get.registeredArguments.map((a) => a.name())).toEqual(["id"]);

    const list = invoices.commands.find((c) => c.name() === "list")!;
    const flags = list.options.map((o) => o.long);
    expect(flags).toContain("--sqlfilters");
    expect(flags).toContain("--limit");
  });

  it("adds body options only to operations that take a body", () => {
    const invoices = build().commands.find((c) => c.name() === "invoices")!;
    const create = invoices.commands.find((c) => c.name() === "create")!;
    expect(create.options.map((o) => o.long)).toContain("--data");

    const list = invoices.commands.find((c) => c.name() === "list")!;
    expect(list.options.map((o) => o.long)).not.toContain("--data");
  });

  it("skips modules already claimed by a crafted command", () => {
    const program = new Command();
    registerGeneratedCommands(program, manifest, new Set(["invoices"]));
    expect(program.commands.map((c) => c.name())).not.toContain("invoices");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/registry.test.ts`
Expected: FAIL — cannot resolve `../../src/registry.js`.

- [ ] **Step 3: Write the implementation**

```ts
// src/registry.ts
import { Command, Option } from "commander";
import type { Manifest, OperationSpec } from "./manifest.js";
import { resolveConfig, rootOf, isJsonOutput } from "./lib/config.js";
import { request } from "./lib/client.js";
import { buildBody, checkRequired } from "./lib/body.js";
import { formatResult } from "./lib/output.js";
import { handleError } from "./lib/errors.js";
import { createRequire } from "node:module";

// Loaded via createRequire rather than an ESM JSON import: import attributes
// behave differently across Node/TS versions, and this resolves relative to the
// emitted file, so it works the same from src (vitest) and dist (installed).
const require = createRequire(import.meta.url);
const REQUIRED: Record<string, string[]> = require("./data/required-fields.json");
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

function addQueryOptions(cmd: Command, op: OperationSpec): void {
  for (const param of op.query) {
    const flagName = flagNameFor(param.name);
    const renamed = flagName !== param.name ? ` (API parameter "${param.name}")` : "";
    const description = (param.description?.replace(/\s+/g, " ").slice(0, 110) ?? "") + renamed;
    cmd.addOption(new Option(`--${flagName} <value>`, description));
  }
}

function addBodyOptions(cmd: Command): void {
  cmd
    .option("--data <json>", "Request body as JSON, or @file.json to read from disk")
    .option("--set <key=value...>", "Set a body field; dot paths supported. Applied over --data")
    .option("--extrafield <key=value...>", "Set a custom field (maps to array_options)");
}

function buildOperationCommand(
  module: string,
  op: OperationSpec,
  availableModules: string[],
): Command {
  const cmd = new Command(op.command);
  if (op.summary) cmd.description(op.summary.replace(/\s*🔐\s*$/, "").trim());

  for (const param of op.pathParams) {
    cmd.argument(`<${param.name}>`, param.description ?? `${param.name} path parameter`);
  }
  addQueryOptions(cmd, op);
  if (op.hasBody) addBodyOptions(cmd);
  cmd.option("--columns <list>", "Comma-separated columns to display");

  cmd.action(async (...args: unknown[]) => {
    // Commander passes: ...positionals, options, command
    const command = args[args.length - 1] as Command;
    const opts = args[args.length - 2] as Record<string, unknown>;
    const positionals = args.slice(0, op.pathParams.length) as string[];

    try {
      const config = resolveConfig(command);

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
          data: opts.data as string | undefined,
          set: opts.set as string[] | undefined,
          extrafield: opts.extrafield as string[] | undefined,
        });
        if (op.method === "post") checkRequired(module, body, REQUIRED);
      }

      const rootOpts = rootOf(command).opts();
      const result = await request(config, {
        method: op.method,
        path: op.path,
        pathParams,
        query,
        body,
        module,
        timeoutMs: rootOpts.timeout ? Number(rootOpts.timeout) * 1000 : undefined,
      });

      const columns = typeof opts.columns === "string" ? opts.columns.split(",") : undefined;
      const page = query.page !== undefined ? Number(query.page) : 0;
      formatResult(result, command, { hints: COLUMNS[module], columns, page });
    } catch (err) {
      // isJsonOutput walks to the root rather than assuming a fixed depth, and
      // matches what the success path uses. availableModules must be passed:
      // without it every 404 claims the module is disabled, because
      // ![].includes(x) is always true.
      handleError(err, isJsonOutput(command), availableModules);
    }
  });

  return cmd;
}

/**
 * Register one command group per module in the manifest.
 *
 * `claimed` holds module names already provided by hand-crafted commands; those
 * are skipped so a crafted module fully replaces its generated counterpart.
 */
export function registerGeneratedCommands(
  program: Command,
  manifest: Manifest,
  claimed: Set<string>,
): void {
  const availableModules = Object.keys(manifest.modules);
  for (const [module, { operations }] of Object.entries(manifest.modules)) {
    if (claimed.has(module)) continue;
    const group = new Command(module).description(`${operations.length} operations`);
    for (const op of operations) {
      group.addCommand(buildOperationCommand(module, op, availableModules));
    }
    program.addCommand(group);
  }
}
```

- [ ] **Step 4: Create `src/data/columns.json`**

Seeded from the fields `../dolibarr-mcp/src/formatters.ts` displays. Modules absent here fall back to the first six scalar keys.

```json
{
  "thirdparties": ["id", "name", "code_client", "email", "phone", "town"],
  "invoices": ["id", "ref", "socid", "date", "total_ttc", "statut"],
  "orders": ["id", "ref", "socid", "date", "total_ttc", "statut"],
  "proposals": ["id", "ref", "socid", "date", "total_ttc", "statut"],
  "products": ["id", "ref", "label", "price", "stock_reel", "status"],
  "contacts": ["id", "lastname", "firstname", "email", "phone", "socid"],
  "projects": ["id", "ref", "title", "socid", "dateo", "statut"],
  "tasks": ["id", "ref", "label", "fk_project", "progress", "duration_effective"],
  "tickets": ["id", "ref", "subject", "fk_statut", "severity_code", "datec"],
  "users": ["id", "login", "lastname", "firstname", "email", "admin"],
  "categories": ["id", "label", "type", "description"],
  "warehouses": ["id", "ref", "label", "lieu", "statut"],
  "supplierinvoices": ["id", "ref", "socid", "date", "total_ttc", "statut"],
  "supplierorders": ["id", "ref", "socid", "date", "total_ttc", "statut"]
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/registry.test.ts`
Expected: PASS — including both halves of the duplicated `operationId`.

- [ ] **Step 6: Commit**

```bash
git add src/registry.ts src/data/columns.json tests/unit/registry.test.ts
git commit -m "feat: build Commander commands from the manifest

One group per module, one command per operation; crafted modules can claim a
module name to replace the generated group wholesale."
```

---

## Task 12: `sync` and `modules` commands

**Files:**
- Create: `src/commands/sync.ts`, `src/commands/modules.ts`
- Test: `tests/unit/sync.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fetchSpec, specUrlFor } from "../../src/commands/sync.js";

const cfg = { baseUrl: "http://host/api/index.php", apiKey: "k" };

describe("specUrlFor", () => {
  it("targets the explorer document", () => {
    expect(specUrlFor(cfg.baseUrl)).toBe("http://host/api/index.php/explorer/swagger.json");
  });
});

describe("fetchSpec", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the parsed spec", async () => {
    const spec = JSON.parse(readFileSync("openapi/swagger-23.0.3.json", "utf8"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(spec), { status: 200 })));
    const result = await fetchSpec(cfg);
    expect(result.swagger).toBe("2.0");
  });

  it("explains a disabled explorer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 403 })));
    await expect(fetchSpec(cfg)).rejects.toThrow(/API_EXPLORER_DISABLED|--spec/);
  });

  it("explains the api/temp failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("Erreur temp dir api/temp not writable", { status: 500 })));
    await expect(fetchSpec(cfg)).rejects.toThrow(/api\/temp/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/sync.test.ts`
Expected: FAIL — cannot resolve `../../src/commands/sync.js`.

- [ ] **Step 3: Write `src/commands/sync.ts`**

```ts
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
```

- [ ] **Step 4: Write `src/commands/modules.ts`**

```ts
// src/commands/modules.ts
import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import { getActiveContextName, isJsonOutput } from "../lib/config.js";
import { loadManifest } from "../lib/manifest-store.js";

export function makeModulesCommand(): Command {
  return new Command("modules")
    .description("List the modules the connected instance exposes")
    .action((_opts, command: Command) => {
      const manifest = loadManifest();
      if (!manifest) {
        if (isJsonOutput(command)) {
          console.log(JSON.stringify({ synced: false, modules: [] }));
        } else {
          console.error(chalk.yellow("No manifest for this context."));
          console.error(chalk.dim('Run "dolibarr sync" first.'));
          process.exitCode = 1;
        }
        return;
      }

      const rows = Object.entries(manifest.modules)
        .map(([name, mod]) => ({ module: name, operations: mod.operations.length }))
        .sort((a, b) => a.module.localeCompare(b.module));

      if (isJsonOutput(command)) {
        console.log(JSON.stringify({
          synced: true,
          context: getActiveContextName(),
          dolibarrVersion: manifest.dolibarrVersion,
          fetchedAt: manifest.fetchedAt,
          modules: rows,
        }, null, 2));
        return;
      }

      const table = new Table({ head: [chalk.cyan("module"), chalk.cyan("operations")] });
      for (const row of rows) table.push([row.module, String(row.operations)]);
      console.log(table.toString());
      console.log(chalk.dim(
        `${rows.length} modules on Dolibarr ${manifest.dolibarrVersion ?? "(unknown)"} — synced ${manifest.fetchedAt}`,
      ));
    });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/sync.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/commands/sync.ts src/commands/modules.ts tests/unit/sync.test.ts
git commit -m "feat: sync and modules commands

sync reads Swagger 2.0 directly -- no OpenAPI 3 conversion is needed to build
a command tree -- and gives named diagnostics for the two verified failure
modes (explorer disabled, api/temp unwritable)."
```

---

## Task 13: `auth`, `context`, `config` and `api` commands

**Files:**
- Create: `src/commands/auth.ts`, `src/commands/context.ts`, `src/commands/config.ts`, `src/commands/api.ts`

- [ ] **Step 1: Write `src/commands/auth.ts`**

```ts
// src/commands/auth.ts
import { Command } from "commander";
import chalk from "chalk";
import { createInterface } from "node:readline/promises";
import {
  getStore, setContext, setActiveContext, getActiveContextName, getActiveContext,
  getAllContexts, deleteContext, resolveConfig, isJsonOutput, rootOf,
} from "../lib/config.js";
import { request } from "../lib/client.js";
import { handleError } from "../lib/errors.js";

function maskKey(key: string): string {
  return key.length <= 8 ? "****" : `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export function makeAuthCommand(): Command {
  const cmd = new Command("auth").description("Manage authentication");

  cmd
    .command("login")
    .description("Store credentials for the active context")
    .addHelpText(
      "after",
      [
        "",
        "Supply credentials non-interactively with the global options:",
        "  dolibarr auth login --base-url https://host/api/index.php --api-key <key>",
        "",
      ].join("\n"),
    )
    .action(async (_opts, command: Command) => {
      // --api-key and --base-url are declared on the ROOT program. Redeclaring
      // them here would collide: Commander binds a duplicated long flag to the
      // root, so this action's own opts() would come back empty and the flags
      // would appear to be ignored.
      const rootOpts = rootOf(command).opts();
      let apiKey: string | undefined = rootOpts.apiKey;
      let baseUrl: string | undefined = rootOpts.baseUrl;
      const current = getActiveContext();

      if ((!apiKey || !baseUrl) && !process.stdin.isTTY) {
        // Without a terminal, readline resolves the first prompt from whatever
        // is piped and then awaits forever on a closed stdin. Node sees no
        // remaining handles and exits 0 mid-await — a silent no-op that reports
        // success, which is the worst possible outcome for a CI job.
        console.error(
          chalk.red("auth login needs a terminal for prompts."),
        );
        console.error(
          chalk.dim("Pass both --api-key and --base-url when stdin is not a terminal."),
        );
        process.exitCode = 1;
        return;
      }

      if (!apiKey || !baseUrl) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        try {
          if (!baseUrl) {
            const suggestion = current?.baseUrl ?? "http://localhost:8023/api/index.php";
            baseUrl = (await rl.question(`Base URL [${suggestion}]: `)) || suggestion;
          }
          if (!apiKey) apiKey = await rl.question("API key: ");
        } finally {
          rl.close();
        }
      }

      if (!apiKey || !baseUrl) {
        console.error(chalk.red("Both an API key and a base URL are required."));
        process.exitCode = 1;
        return;
      }

      const name = getActiveContextName();
      setContext(name, { apiKey, baseUrl });
      setActiveContext(name);
      console.log(chalk.green(`Credentials saved for context "${name}".`));
      console.log(chalk.dim(`Config: ${getStore().path}`));

      // Verify rather than cheerfully accepting a typo and failing on the next
      // command. Credentials are kept either way — a temporarily unreachable
      // instance is not a reason to discard correct input — but the exit status
      // reflects that they are unproven.
      try {
        const status = (await request({ apiKey, baseUrl }, {
          method: "get",
          path: "/status",
        })) as any;
        console.log(
          chalk.green(`Verified against Dolibarr ${status?.success?.dolibarr_version ?? "(unknown version)"}.`),
        );
        console.log(chalk.dim('Run "dolibarr sync" to build the command tree.'));
      } catch (err) {
        console.error(
          chalk.yellow(
            `Warning: saved, but could not verify: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        process.exitCode = 1;
      }
    });

  cmd
    .command("status")
    .description("Verify the stored credentials against the instance")
    .action(async (_opts, command: Command) => {
      try {
        const config = resolveConfig(command);
        const status = (await request(config, { method: "get", path: "/status" })) as any;
        const version = status?.success?.dolibarr_version ?? "unknown";

        if (isJsonOutput(command)) {
          console.log(JSON.stringify({
            authenticated: true,
            context: getActiveContextName(),
            baseUrl: config.baseUrl,
            dolibarrVersion: version,
          }));
        } else {
          console.log(chalk.green("Authenticated"));
          console.log(`  Context:  ${getActiveContextName()}`);
          console.log(`  Base URL: ${config.baseUrl}`);
          console.log(`  API key:  ${maskKey(config.apiKey)}`);
          console.log(`  Dolibarr: ${version}`);
        }
      } catch (err) {
        handleError(err, isJsonOutput(command));
      }
    });

  cmd
    .command("logout")
    .description("Remove the active context's credentials")
    .action(() => {
      const name = getActiveContextName();
      if (Object.keys(getAllContexts()).length <= 1) {
        getStore().set("contexts", {});
      } else {
        deleteContext(name);
      }
      console.log(chalk.green(`Credentials cleared for "${name}".`));

      // deleteContext promotes whichever context was created earliest, which is
      // arbitrary from the user's point of view. Say so, rather than leaving
      // them pointed at a different instance without knowing it.
      const now = getActiveContextName();
      if (now !== name) {
        console.log(chalk.yellow(`Active context is now "${now}".`));
      }
    });

  return cmd;
}
```

- [ ] **Step 2: Write `src/commands/context.ts`**

```ts
// src/commands/context.ts
import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import { existsSync } from "node:fs";
import {
  getAllContexts, getActiveContextName, setActiveContext, setContext,
  deleteContext, isJsonOutput, manifestPathFor, rootOf,
} from "../lib/config.js";

export function makeContextCommand(): Command {
  const cmd = new Command("context").description("Switch between Dolibarr instances");

  cmd
    .command("list")
    .description("List configured contexts")
    .action((_opts, command: Command) => {
      const contexts = getAllContexts();
      const active = getActiveContextName();

      if (isJsonOutput(command)) {
        console.log(JSON.stringify({ activeContext: active, contexts: Object.keys(contexts) }, null, 2));
        return;
      }
      if (Object.keys(contexts).length === 0) {
        console.log(chalk.dim('No contexts. Run "dolibarr auth login".'));
        return;
      }

      const table = new Table({ head: ["", chalk.cyan("context"), chalk.cyan("base URL")] });
      for (const [name, entry] of Object.entries(contexts)) {
        table.push([name === active ? chalk.green("*") : " ", name, entry.baseUrl]);
      }
      console.log(table.toString());
    });

  cmd
    .command("use")
    .description("Switch the active context")
    .argument("<name>", "Context name")
    .action((name: string) => {
      setActiveContext(name);
      console.log(chalk.green(`Switched to "${name}".`));
      // Each context caches its own command tree, so switching to one that has
      // never been synced silently leaves only the static commands available.
      if (!existsSync(manifestPathFor(name))) {
        console.log(chalk.dim('No command tree cached yet — run "dolibarr sync".'));
      }
    });

  cmd
    .command("create")
    .description("Create a context")
    .argument("<name>", "Context name")
    .addHelpText(
      "after",
      [
        "",
        "Use the global --base-url and --api-key:",
        "  dolibarr context create acme --base-url https://host/api/index.php --api-key <key>",
        "",
      ].join("\n"),
    )
    .action((name: string, _opts: unknown, command: Command) => {
      // Read from the root: redeclaring these as local requiredOptions made
      // Commander bind the values to the root and then fail its own required
      // check, so `context create` could never succeed.
      const { baseUrl, apiKey } = rootOf(command).opts();
      if (!baseUrl || !apiKey) {
        console.error(chalk.red("Both --base-url and --api-key are required."));
        console.error(
          chalk.dim("  dolibarr context create <name> --base-url <url> --api-key <key>"),
        );
        process.exitCode = 1;
        return;
      }
      setContext(name, { baseUrl, apiKey });
      console.log(chalk.green(`Created context "${name}".`));
    });

  cmd
    .command("delete")
    .description("Delete a context")
    .argument("<name>", "Context name")
    .action((name: string) => {
      deleteContext(name);
      console.log(chalk.green(`Deleted context "${name}".`));
    });

  return cmd;
}
```

- [ ] **Step 3: Write `src/commands/config.ts`**

```ts
// src/commands/config.ts
import { Command } from "commander";
import chalk from "chalk";
import { getStore, getActiveContextName, isJsonOutput, manifestPathFor } from "../lib/config.js";

export function makeConfigCommand(): Command {
  const cmd = new Command("config").description("Inspect CLI configuration");

  cmd
    .command("path")
    .description("Show where configuration and manifests are stored")
    .action((_opts, command: Command) => {
      const payload = {
        config: getStore().path,
        manifest: manifestPathFor(getActiveContextName()),
        activeContext: getActiveContextName(),
      };
      if (isJsonOutput(command)) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.log(`Config:   ${payload.config}`);
        console.log(`Manifest: ${payload.manifest}`);
        console.log(`Context:  ${chalk.green(payload.activeContext)}`);
      }
    });

  return cmd;
}
```

- [ ] **Step 4: Write `src/commands/api.ts`**

```ts
// src/commands/api.ts
import { Command } from "commander";
import { resolveConfig, isJsonOutput } from "../lib/config.js";
import { request } from "../lib/client.js";
import { buildBody } from "../lib/body.js";
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
    .option("--data <json>", "Request body as JSON, or @file.json")
    .option("--set <key=value...>", "Set a body field; dot paths supported")
    .action(async (method: string, path: string, opts, command: Command) => {
      try {
        const verb = method.toUpperCase();
        if (!METHODS.has(verb)) {
          throw new Error(`Unsupported method "${method}". Use GET, POST, PUT, DELETE or PATCH.`);
        }

        const query: Record<string, unknown> = {};
        for (const pair of (opts.query as string[] | undefined) ?? []) {
          const index = pair.indexOf("=");
          if (index <= 0) throw new Error(`Invalid --query "${pair}". Expected key=value.`);
          query[pair.slice(0, index)] = pair.slice(index + 1);
        }

        const config = resolveConfig(command);
        const result = await request(config, {
          method: verb,
          path: path.startsWith("/") ? path : `/${path}`,
          query,
          body: buildBody({ data: opts.data, set: opts.set }),
        });
        formatResult(result, command);
      } catch (err) {
        handleError(err, isJsonOutput(command));
      }
    });
}
```

- [ ] **Step 5: Verify it compiles**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 6: Commit**

```bash
git add src/commands/auth.ts src/commands/context.ts src/commands/config.ts src/commands/api.ts
git commit -m "feat: auth, context, config and api passthrough commands"
```

---

## Task 14: Program assembly

**Files:**
- Create: `src/index.ts`
- Test: `tests/unit/index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildProgram } from "../../src/index.js";
import { buildManifest } from "../../src/manifest.js";
import { readFileSync } from "node:fs";

const manifest = buildManifest(
  JSON.parse(readFileSync("openapi/swagger-23.0.3.json", "utf8")),
  { fetchedAt: "2026-07-22T00:00:00Z" },
);

describe("buildProgram", () => {
  it("registers static commands without a manifest", () => {
    const names = buildProgram(undefined).commands.map((c) => c.name());
    expect(names).toEqual(expect.arrayContaining(["auth", "context", "config", "sync", "modules", "api"]));
  });

  it("registers no module groups without a manifest", () => {
    const names = buildProgram(undefined).commands.map((c) => c.name());
    expect(names).not.toContain("invoices");
  });

  it("adds module groups when a manifest is present", () => {
    const names = buildProgram(manifest).commands.map((c) => c.name());
    expect(names).toContain("invoices");
    expect(names).toContain("thirdparties");
  });

  it("exposes the global options", () => {
    const flags = buildProgram(undefined).options.map((o) => o.long);
    expect(flags).toEqual(expect.arrayContaining(["--api-key", "--base-url", "--entity", "--json"]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/index.test.ts`
Expected: FAIL — cannot resolve `../../src/index.js`.

- [ ] **Step 3: Write the implementation**

```ts
// src/index.ts
import { createRequire } from "node:module";
import { Command } from "commander";
import chalk from "chalk";
import type { Manifest } from "./manifest.js";
import { registerGeneratedCommands } from "./registry.js";
import { makeAuthCommand } from "./commands/auth.js";
import { makeContextCommand } from "./commands/context.js";
import { makeConfigCommand } from "./commands/config.js";
import { makeSyncCommand } from "./commands/sync.js";
import { makeModulesCommand } from "./commands/modules.js";
import { makeApiCommand } from "./commands/api.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

/**
 * Module names provided by hand-crafted commands. Generated commands for these
 * are suppressed. Empty in v1 -- the engine ships before any crafted module.
 */
const CRAFTED_MODULES = new Set<string>();

export function buildProgram(manifest: Manifest | undefined): Command {
  const program = new Command();

  // An unknown top-level name is usually a module this instance does not
  // expose, or a typo. Commander's suggestion is more useful than a bare error.
  program.showSuggestionAfterError();

  program
    .name("dolibarr")
    .description("CLI for the Dolibarr ERP/CRM REST API (also installed as `doli`)")
    .version(pkg.version)
    .option("--api-key <key>", "API key (overrides config)")
    .option("--base-url <url>", "Base URL ending in /api/index.php (overrides config)")
    .option("--entity <id>", "Entity id for multi-company instances (DOLAPIENTITY)")
    .option("--timeout <seconds>", "Request timeout in seconds (default 60)")
    .option("--json", "Output raw JSON")
    .option("--no-color", "Disable coloured output");

  program.addCommand(makeAuthCommand());
  program.addCommand(makeContextCommand());
  program.addCommand(makeConfigCommand());
  program.addCommand(makeSyncCommand());
  program.addCommand(makeModulesCommand());
  program.addCommand(makeApiCommand());

  if (manifest) {
    registerGeneratedCommands(program, manifest, CRAFTED_MODULES);
  } else {
    program.addHelpText(
      "after",
      chalk.yellow('\nNo API description cached for this context yet.\n') +
        'Run "dolibarr auth login" then "dolibarr sync" to expose this instance\'s modules.\n',
    );
  }

  return program;
}
```

`index.ts` exports only — it never runs on import, so tests can build a program
without side effects. The executable is a separate two-line entry point.

- [ ] **Step 4: Write the bin entry `src/cli.ts`**

```ts
#!/usr/bin/env node
// src/cli.ts — executable entry point. Kept separate from index.ts so importing
// the program builder in tests never parses argv or touches the manifest store.
import chalk from "chalk";
import { buildProgram } from "./index.js";
import { loadManifest } from "./lib/manifest-store.js";

buildProgram(loadManifest())
  .parseAsync()
  .catch((err: unknown) => {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exitCode = 1;
  });
```

Update `package.json` `bin` to point at the new entry:

```json
"bin": { "dolibarr": "dist/cli.js", "doli": "dist/cli.js" },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the built CLI runs**

```bash
npm run build
node dist/index.js --help
```

Expected: help lists `auth`, `context`, `config`, `sync`, `modules`, `api`, plus the "No API description cached" note.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/unit/index.test.ts
git commit -m "feat: assemble the program from static and generated commands

Without a manifest only static commands register and help explains how to
get the rest, so a fresh install never looks broken."
```

---

## Task 15: Contract tests against a live instance

**Files:**
- Create: `tests/contract/setup.ts`, `tests/contract/live.test.ts`

- [ ] **Step 1: Write the harness**

```ts
// tests/contract/setup.ts
export const LIVE_BASE_URL = process.env.DOLIBARR_BASE_URL ?? "http://localhost:8023/api/index.php";
export const LIVE_API_KEY = process.env.DOLIBARR_API_KEY ?? "dolibarrclidevkey000000000000000";

export const liveConfig = { baseUrl: LIVE_BASE_URL, apiKey: LIVE_API_KEY };

/** Probe the instance so the suite can skip instead of failing when it is down. */
export async function instanceAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${LIVE_BASE_URL}/status`, {
      headers: { DOLAPIKEY: LIVE_API_KEY },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Write the contract test**

```ts
// tests/contract/live.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { liveConfig, instanceAvailable } from "./setup.js";
import { request } from "../../src/lib/client.js";
import { fetchSpec } from "../../src/commands/sync.js";
import { buildManifest } from "../../src/manifest.js";
import { DolibarrApiError } from "../../src/lib/errors.js";

// Availability is only known once beforeAll has run, which is AFTER vitest
// collects tests. `it.skipIf` is evaluated at collection time and would
// therefore always see the initial value, so skip from inside each test.
let available = false;
beforeAll(async () => {
  available = await instanceAvailable();
  if (!available) {
    console.warn("No Dolibarr reachable — skipping contract tests. Start one with: docker compose --profile current up -d");
  }
});

const live = (name: string, fn: () => Promise<void>, timeout?: number) =>
  it(name, async (ctx) => {
    if (!available) ctx.skip();
    await fn();
  }, timeout);

describe("live Dolibarr", () => {
  live("authenticates and reports a version", async () => {
    const status = (await request(liveConfig, { method: "get", path: "/status" })) as any;
    expect(status.success.dolibarr_version).toMatch(/^\d+\.\d+/);
  });

  live("rejects a bad API key with 401", async () => {
    await expect(request({ ...liveConfig, apiKey: "wrong" }, { method: "get", path: "/status" }))
      .rejects.toBeInstanceOf(DolibarrApiError);
  });

  live("serves a spec that builds a non-empty manifest", async () => {
    const spec = await fetchSpec(liveConfig);
    const manifest = buildManifest(spec, { fetchedAt: new Date().toISOString() });
    expect(Object.keys(manifest.modules).length).toBeGreaterThan(10);
    for (const [name, mod] of Object.entries(manifest.modules)) {
      const commands = mod.operations.map((o) => o.command);
      expect(new Set(commands).size, `duplicate command in ${name}`).toBe(commands.length);
    }
  }, 240_000);

  live("returns a bare array for lists, with no total", async () => {
    const result = await request(liveConfig, {
      method: "get", path: "/thirdparties", query: { limit: 1 },
    });
    expect(Array.isArray(result)).toBe(true);
  });

  live("round-trips a thirdparty", async () => {
    const created = (await request(liveConfig, {
      method: "post", path: "/thirdparties", body: { name: "dolibarr-cli contract test" },
    })) as number;
    expect(typeof created).toBe("number");

    const fetched = (await request(liveConfig, {
      method: "get", path: "/thirdparties/{id}", pathParams: { id: String(created) },
    })) as any;
    expect(fetched.name).toBe("dolibarr-cli contract test");

    await request(liveConfig, {
      method: "delete", path: "/thirdparties/{id}", pathParams: { id: String(created) },
    });
  });
});
```

- [ ] **Step 3: Start the instance and run**

```bash
docker compose --profile current up -d
npx vitest run tests/contract/live.test.ts
```

Expected: PASS. If Docker is not running, every test reports as skipped rather than failing.

- [ ] **Step 4: Verify the whole suite is green**

Run: `npm run test:run`
Expected: all unit and contract tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/contract/setup.ts tests/contract/live.test.ts
git commit -m "test: contract tests against a live instance

Skip cleanly when no instance is reachable, so the unit suite stays green
without Docker."
```

---

## Task 16: End-to-end smoke and CI

**Files:**
- Create: `.gitlab-ci.yml`
- Modify: `README.md`

- [ ] **Step 1: Smoke-test the real binary against a real instance**

```bash
docker compose --profile current up -d
npm run build
node dist/index.js auth login --base-url http://localhost:8023/api/index.php --api-key dolibarrclidevkey000000000000000
node dist/index.js sync
node dist/index.js modules
node dist/index.js thirdparties create --set name="Smoke Test GmbH"
node dist/index.js thirdparties list --limit 5
node dist/index.js api GET /status --json
```

Expected: `sync` reports ~30 modules; `modules` tables them; `create` returns an id; `list` renders a table; `api` prints JSON.

Record the observed module and operation counts in the commit message.

- [ ] **Step 2: Verify the required-field guard fires locally**

```bash
node dist/index.js thirdparties create
```

Expected: `Missing required field(s) for thirdparties: name.` and exit code 1, with **no** HTTP request made.

- [ ] **Step 3: Verify the module-not-enabled hint**

```bash
node dist/index.js api GET /mos --json
```

Expected: a 404 error. Then confirm `mos` is absent from `node dist/index.js modules`, which is what the generated tree relies on to produce the friendlier message.

- [ ] **Step 4: Write `.gitlab-ci.yml`**

```yaml
stages:
  - test
  - build

default:
  tags:
    - docker

variables:
  DOLIBARR_API_KEY: dolibarrclidevkey000000000000000

.test-template: &test-template
  stage: test
  image: node:22
  services:
    - name: mariadb:lts
      alias: mariadb
      variables:
        MARIADB_ROOT_PASSWORD: root
        MARIADB_DATABASE: dolibarr
        MARIADB_USER: dolibarr
        MARIADB_PASSWORD: dolibarr
  script:
    - npm ci
    - npm run typecheck
    - npm run test:unit

# The unit suite is version-independent, so it runs once. Contract tests need a
# live instance per supported major; see the version support policy in CLAUDE.md.
test:unit:
  <<: *test-template

build:
  stage: build
  image: node:22
  script:
    - npm ci
    - npm run build
  artifacts:
    paths:
      - dist/
```

- [ ] **Step 5: Write `README.md`**

```markdown
# Dolibarr CLI

Surfaces the complete Dolibarr ERP/CRM REST API as a command-line tool. The command
tree is derived from *your* instance, so it shows exactly the modules that instance
exposes — nothing more, nothing less.

## Install

```bash
npm install -g @manfred-kunze-dev/dolibarr-cli
```

## Quick start

```bash
dolibarr auth login          # base URL must end in /api/index.php
dolibarr sync                # fetch this instance's API description
dolibarr modules             # what this instance exposes
dolibarr thirdparties list
```

Also installed as `doli`.

## Global options

| Flag | Description |
|---|---|
| `--api-key <key>` | Override the API key |
| `--base-url <url>` | Override the base URL |
| `--entity <id>` | Entity id for multi-company instances |
| `--timeout <seconds>` | Request timeout, default 60 |
| `--json` | Raw JSON on stdout |
| `--no-color` | Disable colour |

## Local development

```bash
docker compose --profile current up -d   # Dolibarr 23 on :8023
npm install && npm run build
npm run test:run
```

Supported Dolibarr versions: previous, current and next (currently 22, 23, 24).
```

- [ ] **Step 6: Commit**

```bash
git add .gitlab-ci.yml README.md
git commit -m "ci: run typecheck and unit tests; document usage"
```

---

## Self-Review Notes

Checked against the design spec:

- **Not implemented in v1, by design:** crafted modules and the typed client (deferred per the spec's Deferred section); `columns.json` covers only the modules `dolibarr-mcp` has formatters for, everything else falls back to scalar keys.
- **`CRAFTED_MODULES` is empty in v1.** It exists so Task 11's `claimed` parameter has a real caller and the override path is exercised by tests rather than being dead code added later.
- **Spec coverage gaps to watch:** the spec mentions caching dictionary/`setup` lookups — explicitly deferred, no task. The bundled-spec bootstrap is *not* implemented: `sync` is required before module commands appear. This is a deliberate departure from the spec, which proposed shipping the reference capture as a pre-sync default; showing another instance's 38 modules to someone connected to a 30-module instance is worse than showing none. Confirm this with the user, and update the spec if accepted.
