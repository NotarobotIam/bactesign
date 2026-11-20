// Builds Bactesign and deploys it to the Cloudflare account Wrangler is logged in to.
// Bindings come from deploy/cloudflare.json (resource names/IDs are not secrets).
// "publicUrl": false deploys with the workers.dev address switched off, so nothing is
// reachable until Cloudflare Access protects the hostname and the flag is set to true.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const cfg = JSON.parse(readFileSync(path.join(root, "deploy/cloudflare.json"), "utf8"));
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
