// Writes libsodium's WebAssembly binary to a file, for runtimes that refuse to compile
// Wasm from bytes at run time (Cloudflare Workers). libsodium embeds the binary in its
// JavaScript; this captures exactly those bytes as the installed version loads them, so
// the file can never drift from the library. Usage: node extract-wasm.mjs <out.wasm>
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const out = process.argv[2];
if (!out) {
  console.error("usage: extract-wasm.mjs <out.wasm>");
  process.exit(1);
}

let captured = null;
const original = WebAssembly.instantiate;
WebAssembly.instantiate = (source, imports) => {
  if (captured === null && !(source instanceof WebAssembly.Module)) {
    captured = new Uint8Array(source instanceof ArrayBuffer ? source : source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
  }
  return original(source, imports);
};

const sodium = (await import("libsodium-wrappers-sumo")).default;
await sodium.ready;
WebAssembly.instantiate = original;

if (captured === null) {
  console.error("libsodium did not instantiate WebAssembly from bytes; nothing to extract");
  process.exit(1);
}
const target = resolve(out);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, captured);
console.log(`wrote ${captured.byteLength} bytes to ${out}`);
