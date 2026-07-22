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
