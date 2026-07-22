import { defineConfig } from "vitest/config";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 120000,
    env: {
      // Safety net: keep the config store out of the real user profile. Without
      // this, anything touching the store writes to %APPDATA%/~/.config during
      // tests and leaks state between runs.
      DOLIBARR_CONFIG_DIR: join(tmpdir(), "dolibarr-cli-test-config"),
    },
  },
});
