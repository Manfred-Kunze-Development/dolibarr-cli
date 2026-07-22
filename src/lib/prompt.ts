// src/lib/prompt.ts
import { createInterface } from "node:readline/promises";

/**
 * Ask for confirmation before something irreversible.
 *
 * Without a terminal there is nobody to ask, so the caller must have passed
 * --yes. Auto-confirming instead would let a script delete records it never
 * meant to, and prompting would hang or — worse — resolve from whatever
 * happened to be piped in.
 */
export async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    throw new Error(`${question}\nRefusing without a terminal. Pass --yes to confirm.`);
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}
