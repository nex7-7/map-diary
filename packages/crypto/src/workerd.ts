/**
 * Cloudflare Workers refuse to compile WebAssembly from bytes at run time, which is how
 * libsodium loads its embedded binary. Import this module before anything that imports
 * libsodium, and pass it libsodium's binary imported as a precompiled module (see
 * scripts/extract-wasm.mjs). The next WebAssembly.instantiate call from bytes then uses
 * that module instead; it only changes how libsodium is loaded, never what it computes.
 */
export function useCompiledSodiumWasm(module: WebAssembly.Module): void {
  const original = WebAssembly.instantiate.bind(WebAssembly);
  const patched = (source: unknown, imports?: WebAssembly.Imports): Promise<unknown> => {
    if (source instanceof WebAssembly.Module) return original(source, imports);
    WebAssembly.instantiate = original;
    return original(module, imports).then((instance) => ({ module, instance }));
  };
  WebAssembly.instantiate = patched as typeof WebAssembly.instantiate;
}
