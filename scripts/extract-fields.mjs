// scripts/extract-fields.mjs
//
// Regenerate src/data/required-fields.json from a Dolibarr source checkout.
//
//   node scripts/extract-fields.mjs /path/to/dolibarr
//
// Each REST API class declares `public static $FIELDS` listing the fields its
// _validate() requires on create. This is absent from the swagger spec at every
// level, which is why it is extracted from source.
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2];
if (!root) {
  console.error("Usage: node scripts/extract-fields.mjs /path/to/dolibarr");
  process.exit(1);
}

// Spec tag names differ from PHP class filenames for the supplier modules.
const TAG_ALIASES = {
  supplier_invoices: "supplierinvoices",
  supplier_orders: "supplierorders",
  supplier_proposals: "supplierproposals",
};

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/^api_.*\.class\.php$/.test(entry.name)) out.push(p);
  }
  return out;
}

const result = {};
for (const file of walk(path.join(root, "htdocs"))) {
  const src = fs.readFileSync(file, "utf8");
  const match = src.match(/static\s+\$FIELDS\s*=\s*array\(([\s\S]*?)\)\s*;/);
  if (!match) continue;
  const raw = path.basename(file).replace(/^api_/, "").replace(/\.class\.php$/, "");
  const name = TAG_ALIASES[raw] ?? raw;
  const fields = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (fields.length === 0) continue;
  result[name] = fields;
}

const sorted = Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
const out = path.join("src", "data", "required-fields.json");
fs.writeFileSync(out, JSON.stringify(sorted, null, 2) + "\n");
console.log(`Wrote ${Object.keys(sorted).length} modules to ${out}`);
