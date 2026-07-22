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

export function pickColumns(
  rows: Row[],
  hints: string[] | undefined,
  override: string[] | undefined,
): string[] {
  if (override && override.length > 0) return override;
  if (rows.length === 0) return [];
  const present = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) present.add(key);

  if (hints && hints.length > 0) {
    const chosen = hints.filter((h) => present.has(h) && rows.some((r) => r[h] !== undefined));
    if (chosen.length > 0) return chosen;
  }

  return Object.keys(rows[0])
    .filter((key) => {
      const value = rows[0][key];
      return value === null || typeof value !== "object";
    })
    .slice(0, MAX_FALLBACK_COLUMNS);
}

/**
 * Dolibarr list endpoints return a bare array with no total count, so the footer
 * reports only what was received. Never fabricate a total or a page count.
 */
export function formatFooter(count: number, page: number): string {
  return `${count} results (page ${page + 1})`;
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
  const table = new Table();
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
