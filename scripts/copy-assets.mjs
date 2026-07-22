// scripts/copy-assets.mjs
import { mkdirSync, copyFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const from = join("src", "data");
const to = join("dist", "data");

if (!existsSync(from)) {
  console.log("No src/data to copy.");
  process.exit(0);
}

mkdirSync(to, { recursive: true });
let count = 0;
for (const file of readdirSync(from)) {
  if (!file.endsWith(".json")) continue;
  copyFileSync(join(from, file), join(to, file));
  count++;
}
console.log(`Copied ${count} data file(s) to ${to}`);
