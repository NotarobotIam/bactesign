// Builds Bactesign and deploys it to the Cloudflare account Wrangler is logged in to.
// Bindings come from deploy/cloudflare.local.json, which is kept off GitHub
// (copy deploy/cloudflare.example.json and fill in your own resource IDs).
// "publicUrl": false deploys with the workers.dev address switched off, so nothing is
// reachable until Cloudflare Access protects the hostname and the flag is set to true.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const cfgFile = path.join(root, "deploy/cloudflare.local.json");
if (!existsSync(cfgFile)) { console.error("Missing deploy/cloudflare.local.json: copy deploy/cloudflare.example.json and fill in your IDs."); process.exit(1); }
const cfg = JSON.parse(readFileSync(cfgFile, "utf8"));
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (!process.argv.includes("--skip-build")) run("npm", ["run", "build"]);

const built = JSON.parse(readFileSync(path.join(root, "dist/server/wrangler.json"), "utf8"));
const deploy = {
  ...built,
  name: cfg.worker,
  topLevelName: cfg.worker,
  workers_dev: cfg.publicUrl === true,
  preview_urls: false,
  d1_databases: built.d1_databases.map(d => ({ ...d, database_name: cfg.d1.name, database_id: cfg.d1.id })),
  r2_buckets: built.r2_buckets.map(b => ({ ...b, bucket_name: cfg.r2.bucket })),
};
delete deploy.dev;
const out = path.join(root, "dist/server/wrangler.deploy.json");
writeFileSync(out, JSON.stringify(deploy, null, 2));
console.log(`Deploying worker "${cfg.worker}" (public workers.dev URL: ${deploy.workers_dev ? "ON" : "OFF"})`);
run(process.execPath, ["./node_modules/wrangler/bin/wrangler.js", "deploy", "--config", out]);
