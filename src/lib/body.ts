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
