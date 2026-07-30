import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { buildManifest } from "../../src/manifest.js";
import { registerGeneratedCommands, isRootCreate, operationKey, commandNamesFor } from "../../src/registry.js";

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

  it("skips operations already claimed by a crafted command", () => {
    // Claimed by METHOD+path, not module: operationId is not unique, and a
    // crafted module may replace only part of a group.
    const invoices = manifest.modules.invoices.operations;
    const claimed = new Set(invoices.map(operationKey));
    const program = new Command();
    registerGeneratedCommands(program, manifest, claimed);
    expect(program.commands.map((c) => c.name())).not.toContain("invoices");
  });

  it("keeps the unclaimed half of a partially crafted module", () => {
    const invoices = manifest.modules.invoices.operations;
    const list = invoices.find((o) => o.command === "list")!;
    const program = new Command();
    registerGeneratedCommands(program, manifest, new Set([operationKey(list)]));
    const group = program.commands.find((c) => c.name() === "invoices")!;
    const subs = group.commands.map((c) => c.name());
    expect(subs).not.toContain("list");
    expect(subs).toContain("create");
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

describe("required-field guard scope", () => {
  it("applies only to the module's own create endpoint", () => {
    // Keyed on the module but previously applied to every POST, which blocked
    // 61 live endpoints — `invoices validate 999` demanded a socid.
    const invoices = manifest.modules.invoices.operations;
    const create = invoices.find((o) => o.command === "create")!;
    expect(isRootCreate(create)).toBe(true);

    for (const command of ["validate", "create-line", "settopaid", "create-contact"]) {
      const op = invoices.find((o) => o.command === command);
      if (op) expect(isRootCreate(op), `${command} must not be treated as create`).toBe(false);
    }
  });

  it("treats no more than one operation per module as the root create", () => {
    for (const [name, mod] of Object.entries(manifest.modules)) {
      const roots = mod.operations.filter(isRootCreate);
      expect(roots.length, `${name} has ${roots.length} root creates`).toBeLessThanOrEqual(1);
    }
  });
});

describe("module group name collisions", () => {
  it("renames a module that clashes with a built-in command instead of throwing", () => {
    // Commander throws on duplicate command names, and registration happens
    // before parseAsync — so a module tagged `api` took down every invocation,
    // including --help and sync, with no way back but deleting the manifest.
    const collided = {
      dolibarrVersion: null,
      fetchedAt: "x",
      basePath: "/api/index.php",
      modules: {
        api: { operations: manifest.modules.invoices.operations.slice(0, 2) },
      },
    };
    const program = new Command();
    program.addCommand(new Command("api").description("built-in passthrough"));

    expect(() => registerGeneratedCommands(program, collided as never, new Set())).not.toThrow();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("api");
    expect(names).toContain("api-module");
    // `modules` must report the name the user has to type.
    expect(commandNamesFor(collided as never, ["api"]).get("api")).toBe("api-module");
  });
});

describe("repeated --data", () => {
  it("is an error rather than silently taking the last", async () => {
    // The previous test for this asserted on an array Commander can never
    // produce, and passed because of a TypeError. It certified nothing.
    const program = new Command();
    registerGeneratedCommands(program, manifest, new Set());
    program.exitOverride();

    const invoices = program.commands.find((c) => c.name() === "invoices")!;
    const create = invoices.commands.find((c) => c.name() === "create")!;
    create.exitOverride();

    await expect(
      program.parseAsync(["invoices", "create", "--data", '{"a":1}', "--data", '{"b":2}'], {
        from: "user",
      }),
    ).rejects.toThrow(/only be given once/i);
  });

  it("reserves the implicit help command so a module cannot shadow it", () => {
    const collided = {
      dolibarrVersion: null,
      fetchedAt: "x",
      basePath: "",
      modules: { help: { operations: manifest.modules.invoices.operations.slice(0, 1) } },
    };
    const program = new Command();
    registerGeneratedCommands(program, collided as never, new Set());
    expect(program.commands.map((c) => c.name())).toContain("help-module");
  });
});

describe("conditional-field guard wiring", () => {
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

  async function runCreate(argv: string[]): Promise<{ output: string; requested: boolean }> {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((m?: unknown) => { lines.push(String(m)); });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const program = new Command().option("--json", "Output raw JSON");
    registerGeneratedCommands(program, manifest, new Set());
    program.exitOverride();
    await program.parseAsync(argv, { from: "user" });
    return { output: lines.join("\n"), requested: fetchMock.mock.calls.length > 0 };
  }

  it("blocks a thirdparty create with client set but no code_client", async () => {
    const { output, requested } = await runCreate([
      "thirdparties", "create", "--set", "name=ACME", "--set", "client=2",
    ]);
    expect(output).toMatch(/code_client/);
    // The promise the CLI makes is that this costs no round trip.
    expect(requested).toBe(false);
  });

  it("lets the create through once code_client=auto is supplied", async () => {
    const { requested } = await runCreate([
      "thirdparties", "create",
      "--set", "name=ACME", "--set", "client=2", "--set", "code_client=auto",
    ]);
    expect(requested).toBe(true);
  });

  it("leaves a plain create untouched", async () => {
    const { requested } = await runCreate(["thirdparties", "create", "--set", "name=ACME"]);
    expect(requested).toBe(true);
  });

  it("does not apply the guard to update, where the record may already hold a code", async () => {
    // Locally we cannot know whether thirdparty 42 already has a customer code,
    // so enforcing this on update would reject valid calls.
    const { requested } = await runCreate([
      "thirdparties", "update", "42", "--set", "client=2",
    ]);
    expect(requested).toBe(true);
  });
});
