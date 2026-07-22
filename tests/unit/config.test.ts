import { describe, it, expect } from "vitest";
import { resolveFrom, manifestPathFor, validateContextName, getStore } from "../../src/lib/config.js";

describe("validateContextName", () => {
  it("accepts safe names", () => expect(() => validateContextName("acme-1_x")).not.toThrow());
  it("rejects path separators", () => expect(() => validateContextName("a/b")).toThrow());
});

describe("resolveFrom", () => {
  const ctx = { baseUrl: "http://ctx/api/index.php", apiKey: "ctx-key" };

  it("prefers flags over everything", () => {
    const r = resolveFrom({
      flags: { apiKey: "flag", baseUrl: "http://flag" },
      env: { DOLIBARR_API_KEY: "env", DOLIBARR_BASE_URL: "http://env" },
      local: { apiKey: "local", baseUrl: "http://local" },
      context: ctx,
    });
    expect(r).toEqual({ apiKey: "flag", baseUrl: "http://flag", entity: undefined });
  });

  it("falls back flags -> env -> local -> context", () => {
    expect(resolveFrom({ flags: {}, env: { DOLIBARR_API_KEY: "env" }, local: {}, context: ctx }).apiKey).toBe("env");
    expect(resolveFrom({ flags: {}, env: {}, local: { apiKey: "local" }, context: ctx }).apiKey).toBe("local");
    expect(resolveFrom({ flags: {}, env: {}, local: {}, context: ctx }).apiKey).toBe("ctx-key");
  });

  it("throws a directive error when no key is available", () => {
    expect(() => resolveFrom({ flags: {}, env: {}, local: {}, context: undefined }))
      .toThrow(/dolibarr auth login/);
  });

  it("throws when no base URL is available", () => {
    expect(() => resolveFrom({ flags: { apiKey: "k" }, env: {}, local: {}, context: undefined }))
      .toThrow(/base URL/i);
  });
});

describe("manifestPathFor", () => {
  it("is namespaced per context", () => {
    expect(manifestPathFor("acme")).toMatch(/acme\.json$/);
    expect(manifestPathFor("acme")).not.toBe(manifestPathFor("other"));
  });
});

describe("config store location", () => {
  it("honours DOLIBARR_CONFIG_DIR so tests never touch the real profile", () => {
    // conf's constructor eagerly creates its file on disk. Without an override
    // (and without lazy construction) merely importing this module wrote to the
    // user's real config directory on every test run.
    expect(getStore().path.split("\\").join("/")).toContain("dolibarr-cli-test-config");
  });
});
