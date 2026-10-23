// Writes public/sw.js from scripts/service-worker.js with a fresh version (so every build
// installs again and drops the last one's cache) and the static files to keep offline: the
// map's label fonts and sprites, MapLibre's worker, icons and paper textures.
// Run after copy-maplibre-worker.mjs, whose output it lists.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "public");

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const kept = ["map/fonts", "map/sprites", "map/maplibre", "icons", "paper", "cursors"]
  .flatMap((dir) => files(join(pub, dir)))
  .filter((path) => !path.endsWith(".md") && !/[\\/]dark(@2x)?\.(json|png)$/.test(path))
  .map((path) => "/" + relative(pub, path).split(sep).map(encodeURIComponent).join("/"))
  .sort();

const version = `${Date.now().toString(36)}`;
const source = readFileSync(join(root, "scripts", "service-worker.js"), "utf8")
  .replace("__VERSION__", version)
  .replace("__STATIC_FILES__", JSON.stringify(kept));
writeFileSync(join(pub, "sw.js"), source);
console.log(`Service worker ${version} written to public/sw.js, keeping ${kept.length} static files`);
