// Builds the public demo and publishes it to the gh-pages branch, which GitHub Pages serves
// at the custom domain. Only dist-demo/ is published: no credentials, Cloudflare IDs,
// saved results or uploaded images.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const out = path.join(root, "dist-demo");
const DOMAIN = "www.bactesign.ai";
const sh = (cmd, args, cwd = root) => {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
const remote = spawnSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf8" }).stdout.trim();
const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();

sh(process.execPath, ["scripts/build-demo.mjs"]);
writeFileSync(path.join(out, "CNAME"), DOMAIN + "\n");
sh("git", ["init", "-q", "-b", "gh-pages"], out);
sh("git", ["add", "-A"], out);
sh("git", ["-c", "user.name=Bactesign publisher", "-c", "user.email=publisher@users.noreply.github.com", "commit", "-q", "-m", `Public demo built from ${commit}`], out);
sh("git", ["push", "--force", remote, "gh-pages"], out);
console.log(`Published the public demo to the gh-pages branch (${DOMAIN}).`);
