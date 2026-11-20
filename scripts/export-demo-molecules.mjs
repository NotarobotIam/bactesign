// Exports the reference molecule library (ChEMBL, DRAMP, PubChem records) from the local
// D1 database into demo/data/molecules.json for the public GitHub Pages demo.
// Only records with source references are exported: saved results, uploaded images and
// molecules created from your own analyses are never included.
import { DatabaseSync } from "node:sqlite";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dir = path.join(root, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
const file = readdirSync(dir).filter(f => f.endsWith(".sqlite")).map(f => path.join(dir, f)).sort((a, b) => statSync(b).size - statSync(a).size)[0];
if (!file) throw Error("No local D1 database found. Run the app locally first.");
const db = new DatabaseSync(file, { readOnly: true });
const rows = db.prepare("SELECT id, created, updated, payload, pubchem_cid FROM molecules ORDER BY updated DESC, id").all();
const out = [];
for (const r of rows) {
  const p = JSON.parse(r.payload);
  if (!(p.sources?.length || p.pubchem)) continue; // reference records only
  out.push({ ...p, id: r.id, created: r.created, updated: r.updated });
}
writeFileSync(path.join(root, "demo/data/molecules.json"), JSON.stringify(out));
console.log(`Exported ${out.length} reference molecules (of ${rows.length}) to demo/data/molecules.json`);
