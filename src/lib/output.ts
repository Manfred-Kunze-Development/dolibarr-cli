// src/lib/output.ts
import chalk from "chalk";
import Table from "cli-table3";
import type { Command } from "commander";
import { isJsonOutput } from "./config.js";

type Row = Record<string, unknown>;

const MAX_FALLBACK_COLUMNS = 6;

/** Terminal width to lay tables out against, with a sane floor for pipes. */
export function terminalWidth(): number {
  const columns = process.stdout.columns;
  return Number.isFinite(columns) && (columns as number) > 40 ? (columns as number) : 120;
}

/**
 * Distribute the available width across columns.
 *
 * cli-table3's wordWrap only takes effect when a column has a width to wrap
 * against; without colWidths a long value (a user's `rights` blob, or a
 * --pagination_data envelope) renders as one enormous unbroken line.
 */
export function columnWidths(count: number, total = terminalWidth()): number[] {
  if (count === 0) return [];
  const usable = Math.max(total - (count + 1), count * 6);
  const each = Math.max(6, Math.floor(usable / count));
  return new Array(count).fill(each);
}

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
  if (override && override.length > 0) {
    // Trimmed so `--columns "id, name"` works, and unknown names are called out
    // rather than rendering as a silent column of dashes.
    const wanted = override.map((c) => c.trim()).filter(Boolean);
    const known = new Set(rows.flatMap((r) => Object.keys(r)));
    const unknown = wanted.filter((c) => !known.has(c));
    if (unknown.length > 0 && rows.length > 0) {
      process.stderr.write(
        `[warning] No such field(s): ${unknown.join(", ")}. Available: ${[...known].sort().join(", ")}
`,
      );
    }
    return wanted;
  }
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
  const table = new Table({
    head: columns.map((c) => chalk.cyan(c)),
    wordWrap: true,
    colWidths: columnWidths(columns.length),
  });
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
  const keyWidth = Math.min(
    32,
    Math.max(8, ...Object.keys(record).map((k) => k.length + 2)),
  );
  const table = new Table({
    wordWrap: true,
    colWidths: [keyWidth, Math.max(20, terminalWidth() - keyWidth - 3)],
  });
  for (const [key, value] of Object.entries(record)) {
    table.push({ [chalk.cyan(key)]: renderValue(value) });
  }
  console.log(table.toString());
}

export function formatResult(
  result: unknown,
  command: Command,
  opts: { hints?: string[]; columns?: string[]; page?: number; scalarLabel?: string } = {},
): void {
  if (Array.isArray(result)) formatList(result as Row[], command, opts);
  else if (result && typeof result === "object") formatDetail(result as Row, command);
  else if (isJsonOutput(command)) console.log(JSON.stringify(result));
  else if (opts.scalarLabel) {
    // A bare `18` on stdout gives no clue it is the new record's id.
    console.log(chalk.green(`${opts.scalarLabel}: ${renderValue(result)}`));
  } else console.log(renderValue(result));
}


