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
