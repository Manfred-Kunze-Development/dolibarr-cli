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
 * Codepoint comparison. Deliberately not `localeCompare`: ICU orders `{`
 * relative to letters differently from codepoint order, and the sort below
 * decides which member of a collision group keeps the plain base name. Using a
 * locale-sensitive comparator would make command names depend on the host's
 * Node build and default locale.
 */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Reduce a candidate to a safe, well-formed CLI command name. */
export function sanitizeCommand(input: string): string {
  return kebab(input)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Assign a unique command name to every operation in a module.
 *
 * operationId is NOT unique in real Dolibarr specs, so collisions must be
 * resolved rather than assumed away. Sorting first keeps output deterministic.
 *
 * The `taken` set is module-wide and is seeded with every already-unambiguous
 * base name BEFORE disambiguation runs. Scoping it to a single collision group
 * is not enough: a disambiguated name such as `create-societe-account-by-site`
 * can equal another operation's natural base name, and Commander throws rather
 * than shadows on duplicate registration — which would stop the CLI starting at
 * all, with an error naming a command the user never typed.
 */
export function assignCommandNames<T extends OperationRef>(
  operations: T[],
  tag: string,
): Array<T & { command: string }> {
  const sorted = [...operations].sort(
    (a, b) => compare(a.path, b.path) || compare(a.method, b.method),
  );

  const entries = sorted.map((op) => ({ op, base: baseCommandName(op.operationId, tag) }));

  const baseCounts = new Map<string, number>();
  for (const { base } of entries) baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);

  const result = new Array<T & { command: string }>(entries.length);
  const taken = new Set<string>();
  const deferred: number[] = [];

  // Pass 1: operations whose base name is already unambiguous claim it, so a
  // disambiguated name in pass 2 can never steal a name another operation owns.
  entries.forEach(({ op, base }, index) => {
    const name = sanitizeCommand(base);
    if (baseCounts.get(base) !== 1 || !name || taken.has(name)) {
      deferred.push(index);
      return;
    }
    taken.add(name);
    result[index] = { ...op, command: name };
  });

  // Pass 2: everything else, disambiguated against the names already claimed.
  for (const index of deferred) {
    const { op, base } = entries[index];
    let candidate = base;

    if ((baseCounts.get(base) ?? 0) > 1) {
      // Disambiguate by the path parameters the longer paths add.
      const shared = Math.min(
        ...entries.filter((e) => e.base === base).map((e) => pathParamNames(e.op.path).length),
      );
      const extra = pathParamNames(op.path).slice(shared);
      if (extra.length > 0) candidate = `${base}-by-${extra.join("-")}`;
    }

    result[index] = { ...op, command: claim(candidate, op, taken) };
  }

  return result;
}

/**
 * Reserve a unique, well-formed name for an operation.
 *
 * Falls back to method+path, then to a numeric suffix, so termination and
 * uniqueness are guaranteed regardless of how pathological the spec is.
 */
function claim(candidate: string, op: OperationRef, taken: Set<string>): string {
  let name = sanitizeCommand(candidate);
  if (!name || taken.has(name)) {
    name = sanitizeCommand(`${op.method}-${op.path}`);
  }

  let unique = name;
  let suffix = 2;
  while (!unique || taken.has(unique)) {
    unique = `${name || "op"}-${suffix++}`;
  }

  taken.add(unique);
  return unique;
}
