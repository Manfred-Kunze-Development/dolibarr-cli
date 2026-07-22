// tests/contract/setup.ts
export const LIVE_BASE_URL = process.env.DOLIBARR_BASE_URL ?? "http://localhost:8023/api/index.php";
export const LIVE_API_KEY = process.env.DOLIBARR_API_KEY ?? "dolibarrclidevkey000000000000000";

export const liveConfig = { baseUrl: LIVE_BASE_URL, apiKey: LIVE_API_KEY };

/** Probe the instance so the suite can skip instead of failing when it is down. */
export async function instanceAvailable(): Promise<boolean> {
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
