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
