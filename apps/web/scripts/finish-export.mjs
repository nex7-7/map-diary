// Runs after `next build`: writes out/_headers, which Cloudflare applies to every static asset
// response (the site has no Worker code of its own), and drops the local dev map copy.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { securityHeaders } from "../security-headers.mjs";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "out");

// public/dev holds the map file copied by scripts/dev-map-file.sh, for `next dev` only.
rmSync(join(out, "dev"), { recursive: true, force: true });

function htmlFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return htmlFiles(path);
    return name.endsWith(".html") ? [path] : [];
  });
}

// The CSP allows only the inline scripts the build wrote, by hash, so a script injected into a
// page does not run. One policy covers every page, so it lists every page's scripts.
const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
const hashes = new Set();
for (const file of htmlFiles(out)) {
  for (const [, body] of readFileSync(file, "utf8").matchAll(INLINE_SCRIPT)) {
    hashes.add(createHash("sha256").update(body, "utf8").digest("base64"));
  }
}
if (hashes.size === 0) throw new Error("No inline scripts found in out/; has the Next.js output changed?");

const lines = securityHeaders(process.env.NEXT_PUBLIC_API_ORIGIN ?? "", [...hashes].sort()).map(
  ({ key, value }) => `  ${key}: ${value}`,
);
// Cloudflare ignores a _headers line longer than this, which would drop the whole policy.
const MAX_LINE = 2000;
const long = lines.find((l) => l.length > MAX_LINE);
if (long) throw new Error(`A _headers line is ${long.length} characters, over Cloudflare's ${MAX_LINE}: ${long.slice(0, 60)}…`);

const headers = `/*\n${lines.join("\n")}\n\n# Hashed file names: a changed file gets a new name.\n/_next/static/*\n  Cache-Control: public, max-age=31536000, immutable\n`;
writeFileSync(join(out, "_headers"), headers);
console.log(`Wrote out/_headers (${hashes.size} inline script hashes)`);
