// Builds the static public demo into dist-demo/ for GitHub Pages:
// the app page (Vite), the service worker that answers /api requests in the browser,
// and the reference molecule library exported by scripts/export-demo-molecules.mjs.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const out = path.join(root, "dist-demo");
const run = (args) => { const r = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" }); if (r.status !== 0) process.exit(r.status ?? 1); };

run(["node_modules/vite/bin/vite.js", "build", "--config", "vite.demo.config.ts"]);
const { build } = await import("vite");
await build({
  configFile: false, root, logLevel: "warn",
  build: { outDir: out, emptyOutDir: false, target: "es2022", minify: true, copyPublicDir: false,
    lib: { entry: path.join(root, "demo/sw.ts"), formats: ["iife"], name: "BactesignDemoSW", fileName: () => "sw.js" } },
});
if (!existsSync(path.join(root, "demo/data/molecules.json"))) throw Error("demo/data/molecules.json is missing; run npm run demo:export");
mkdirSync(path.join(out, "demo-data"), { recursive: true });
copyFileSync(path.join(root, "demo/data/molecules.json"), path.join(out, "demo-data/molecules.json"));
copyFileSync(path.join(out, "index.html"), path.join(out, "404.html"));
writeFileSync(path.join(out, ".nojekyll"), "");
console.log("Public demo built in dist-demo/");
