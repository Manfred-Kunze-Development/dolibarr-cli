// tests/contract/setup.ts
export const LIVE_BASE_URL = process.env.DOLIBARR_BASE_URL ?? "http://localhost:8023/api/index.php";
export const LIVE_API_KEY = process.env.DOLIBARR_API_KEY ?? "dolibarrclidevkey000000000000000";

export const liveConfig = { baseUrl: LIVE_BASE_URL, apiKey: LIVE_API_KEY };

const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "host.docker.internal",
  "dolibarr",
]);

/**
 * These tests CREATE and DELETE records, and they read DOLIBARR_BASE_URL — the
 * very variable the CLI itself uses for normal operation. A developer who
 * points the CLI at a customer's instance has it exported in their shell, and
 * `npm test` would then mutate that instance. Non-local targets therefore
 * require an explicit opt-in.
 */
export function targetIsAllowed(): boolean {
  if (process.env.DOLIBARR_ALLOW_CONTRACT_TESTS === "1") return true;
  try {
    return LOCAL_HOSTS.has(new URL(LIVE_BASE_URL).hostname);
  } catch {
    return false;
  }
}

/** Probe the instance so the suite can skip instead of failing when it is down. */
export async function instanceAvailable(): Promise<boolean> {
  if (!targetIsAllowed()) return false;
  try {
    const res = await fetch(`${LIVE_BASE_URL}/status`, {
      headers: { DOLAPIKEY: LIVE_API_KEY },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Tells the developer why the suite skipped, rather than leaving them guessing. */
export function skipReason(): string {
  if (!targetIsAllowed()) {
    return (
      `Refusing to run contract tests against a non-local target (${LIVE_BASE_URL}).\n` +
      "These tests create and delete records. Set DOLIBARR_ALLOW_CONTRACT_TESTS=1 " +
      "if that is genuinely what you want."
    );
  }
  return (
    `No Dolibarr reachable at ${LIVE_BASE_URL} — skipping contract tests.\n` +
    "Start one with: docker compose --profile current up -d"
  );
}
