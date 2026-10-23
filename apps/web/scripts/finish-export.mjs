// Runs after `next build`: writes out/_headers, which Cloudflare applies to every static asset
// response (the site has no Worker code of its own), and drops the local dev map copy.
import { rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { securityHeaders } from "../security-headers.mjs";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "out");

const all = securityHeaders(process.env.NEXT_PUBLIC_API_ORIGIN ?? "")
  .map(({ key, value }) => `  ${key}: ${value}`)
  .join("\n");
const headers = `/*\n${all}\n\n# Hashed file names: a changed file gets a new name.\n/_next/static/*\n  Cache-Control: public, max-age=31536000, immutable\n`;
writeFileSync(join(out, "_headers"), headers);

// public/dev holds the map file copied by scripts/dev-map-file.sh, for `next dev` only.
rmSync(join(out, "dev"), { recursive: true, force: true });
console.log("Wrote out/_headers");
