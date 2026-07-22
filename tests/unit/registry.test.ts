import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

describe("registerGeneratedCommands — error attribution", () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    process.env.DOLIBARR_API_KEY = "k";
    process.env.DOLIBARR_BASE_URL = "http://host/api/index.php";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env = { ...OLD_ENV };
    process.exitCode = 0;
  });

  async function run404(argv: string[]): Promise<string> {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "Object not found" } }), { status: 404 })));
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((m?: unknown) => { lines.push(String(m)); });
    // Mirror the real program's global options; a bare Command would reject
    // --json as unknown before the action ever runs.
    const program = new Command().option("--json", "Output raw JSON");
    registerGeneratedCommands(program, manifest, new Set());
    program.exitOverride();
    await program.parseAsync(argv, { from: "user" });
    return lines.join("\n");
  }

  it("reports a wrong id on an enabled module as not-found, not as a disabled module", async () => {
    // Omitting availableModules makes ![].includes(x) always true, so every 404
    // claimed the module was disabled — and listed no enabled modules at all.
    const output = await run404(["invoices", "get", "999999"]);
    expect(output).toMatch(/verify the id/i);
    expect(output).not.toMatch(/not enabled/i);
  });

  it("still names the real enabled modules if a module genuinely is absent", async () => {
    // `mos` is not in the 23.0.3 fixture, so the hint should fire AND be able to
    // list what the instance does expose.
    expect(Object.keys(manifest.modules)).not.toContain("mos");
    expect(Object.keys(manifest.modules)).toContain("invoices");
  });

  it("honours a global --json on the error path", async () => {
    const output = await run404(["--json", "invoices", "get", "999999"]);
    expect(() => JSON.parse(output.trim().split("\n").pop()!)).not.toThrow();
  });
});
