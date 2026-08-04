// src/lib/body.ts
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
  // Number.isFinite, not !isNaN: "Infinity" round-trips through String(Number())
  // but JSON.stringify emits null for it, silently sending a null field.
  if (raw !== "" && Number.isFinite(Number(raw)) && String(Number(raw)) === raw) {
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

  // Beyond this, JS stores the key as a NAMED property on the array and
  // JSON.stringify silently drops it — the same class of silent loss as the
  // array_options bug.
  const MAX_ARRAY_INDEX = 2 ** 32 - 2;
  const isIndex = (key: string) => /^\d+$/.test(key) && Number(key) <= MAX_ARRAY_INDEX;

  let cursor: Json = target;
  for (const [depth, part] of parts.slice(0, -1).entries()) {
    if (Array.isArray(cursor)) {
      // Descend INTO the array rather than replacing it. Overwriting it with a
      // fresh object silently deleted every sibling element and every other
      // field of the targeted one — on the way to a live ERP.
      if (!isIndex(part)) {
        throw new Error(
          `"${parts.slice(0, depth + 1).join(".")}" indexes an array, so "${part}" must be a number.`,
        );
      }
      const element = (cursor as unknown as unknown[])[Number(part)];
      if (typeof element !== "object" || element === null) {
        throw new Error(`"${path}" has no element at index ${part}.`);
      }
      cursor = element as Json;
      continue;
    }

    const next = cursor[part];
    if (typeof next !== "object" || next === null) {
      cursor[part] = Object.create(null) as Json;
    }
    cursor = cursor[part] as Json;
  }

  const last = parts[parts.length - 1];
  if (Array.isArray(cursor)) {
    if (!isIndex(last)) {
      throw new Error(`"${path}" indexes an array, so "${last}" must be a valid index.`);
    }
    // Bound-check like the intermediate segments do. Without this,
    // `--set lines.9=x` on a 2-element array padded it with seven nulls and
    // shipped fabricated line items to the ERP.
    const index = Number(last);
    const length = (cursor as unknown as unknown[]).length;
    if (index > length) {
      throw new Error(
        `"${path}" would leave a gap: the array has ${length} element(s), so ${index} is out of range.`,
      );
    }
  }
  cursor[last] = value;
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
    // @file resolution happens in the CLI layer (lib/data-file.ts); here data
    // is always the raw JSON text.
    const raw = data;
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
    // Dolibarr serialises an empty extrafield set as `[]`, not `{}`, so a body
    // round-tripped from the API carries an ARRAY here. Writing a named
    // property onto it produces something JSON.stringify silently discards —
    // the extrafield would never reach the server.
    const existing = body.array_options;
    const options: Json =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? (existing as Json)
        : Object.create(null);
    options[`options_${key}`] = value;
    body.array_options = options;
  }

  return body;
}

/**
 * A field Dolibarr requires only when another field holds a particular value.
 *
 * `eq` matches one value; `not` matches everything except one. Comparison is on
 * the string form, because the same field arrives as a number through
 * `--set client=2` (coerce()) and as a string through `--data '{"client":"2"}'`.
 */
export interface ConditionalRule {
  when: { field: string; eq?: unknown; not?: unknown };
  require: string;
  /** Optional note appended to the error, for rules whose reason is not obvious. */
  because?: string;
}

function ruleApplies(rule: ConditionalRule, body: Json): boolean {
  const actual = body[rule.when.field];
  // An absent trigger is never assigned by post(), so the rule cannot fire.
  // This is what keeps a plain `create --set name=X` working.
  if (actual === undefined || actual === null) return false;
  if (rule.when.eq !== undefined) return String(actual) === String(rule.when.eq);
  if (rule.when.not !== undefined) return String(actual) !== String(rule.when.not);
  return false;
}

/**
 * Check fields that are required only in combination with another field.
 *
 * These live outside `required-fields.json` on purpose: that file is rewritten
 * wholesale by `npm run extract:fields`, which runs on every roll of the
 * supported-version window, so hand-maintained entries there would be silently
 * destroyed. Rules here are curated by hand and the extractor never touches them.
 *
 * Dolibarr enforces them inside each entity's `verify()`, which is invisible to
 * both the Swagger spec and the API class's static `$FIELDS` — so neither source
 * the CLI derives validation from can see them. See issue #8.
 */
export function checkConditional(
  module: string,
  body: Json | undefined,
  table: Record<string, ConditionalRule[]>,
): void {
  const rules = table[module];
  if (!rules || rules.length === 0 || body === undefined) return;

  const unmet = rules.filter(
    (rule) => ruleApplies(rule, body) && body[rule.require] === undefined,
  );
  if (unmet.length === 0) return;

  const lines = unmet.map((rule) => {
    const trigger = `${rule.when.field}=${String(body[rule.when.field])}`;
    const why = rule.because ? ` ${rule.because}` : "";
    return `  ${rule.require} is required when ${trigger}.${why}`;
  });

  // Naming `auto` matters: Dolibarr only generates the code when the field is
  // present and set to -1 or the literal "auto". An absent field never triggers
  // generation, which is exactly how users end up with an opaque 500.
  throw new Error(
    `Missing conditionally required field(s) for ${module}:\n${lines.join("\n")}\n` +
      `Pass the literal "auto" to have Dolibarr generate one, e.g. ` +
      `--set ${unmet[0].require}=auto`,
  );
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
