import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const dist = path.join(root, "dist");
const verification = spawnSync(process.execPath, ["scripts/verify-site.mjs"], { cwd: root, stdio: "inherit" });
if (verification.status !== 0) process.exit(verification.status ?? 1);

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const rootFiles = await readdir(root);
const publishable = rootFiles.filter((name) => /\.(?:html|css|js|xml|txt)$/i.test(name) || name === "_headers" || name === "_redirects");
for (const name of publishable) await cp(path.join(root, name), path.join(dist, name));
const unusedSourceAssets = new Set([
  "assets/copier-workplace-v1.png",
  "assets/epson-am-c4000-product.png",
  "assets/label-application-v1.png",
  "assets/visual-operations-v1.png"
]);
for (const directory of ["assets", "resources"]) {
  await cp(path.join(root, directory), path.join(dist, directory), {
    recursive: true,
    filter: (source) => !unusedSourceAssets.has(path.relative(root, source).replaceAll("\\", "/"))
  });
}

console.log(`Built ${publishable.length} root files plus assets and resources into dist/.`);
