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
 * disk, so building this at module scope meant merely *importing* this module
 * wrote to the user's real profile — polluting their config on every test run,
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
