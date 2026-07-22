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
    expect(flags).toEqual(expect.arrayContaining(["--api-key", "--base-url", "--entity", "--timeout", "--json"]));
  });
});

describe("global option shadowing", () => {
  it("no subcommand redeclares a root global option", () => {
    // Commander binds a duplicated long flag to the ROOT command, so a
    // subcommand that redeclares one sees undefined in its own opts(). This
    // broke `auth login --api-key X --base-url Y` — the primary onboarding
    // flow — and made `context create` fail its own requiredOption check.
    const program = buildProgram(manifest);
    const globals = new Set(program.options.map((o) => o.long).filter(Boolean));

    const offenders: string[] = [];
    const walk = (cmd: (typeof program)["commands"][number], path: string) => {
      for (const opt of cmd.options) {
        if (opt.long && globals.has(opt.long)) offenders.push(`${path} ${opt.long}`);
      }
      for (const sub of cmd.commands) walk(sub, `${path} ${sub.name()}`);
    };
    for (const sub of program.commands) walk(sub, sub.name());

    expect(offenders).toEqual([]);
  });
});
