// Copies MapLibre's worker into public/, since bundlers cannot follow its
// runtime worker URL. The folder is named by version so upgrades bust caches.
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve("maplibre-gl/package.json"));
const { version } = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const outRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "map", "maplibre");
const out = join(outRoot, version);

rmSync(outRoot, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  cpSync(join(pkgDir, "dist", file), join(out, file));
}
console.log(`MapLibre ${version} worker copied to public/map/maplibre/${version}`);
