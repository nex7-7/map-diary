import type sodiumType from "libsodium-wrappers-sumo";

let readyPromise: Promise<void> | null = null;
let instance: typeof sodiumType | null = null;

/**
 * Loads libsodium. Call once (and await it) before any other function in this package.
 * The library is imported here, not at module load, because libsodium draws random bytes
 * while it initialises and Workers forbid that in global scope.
 */
export function ready(): Promise<void> {
  readyPromise ??= import("libsodium-wrappers-sumo").then(async (m) => {
    await m.default.ready;
    instance = m.default;
  });
  return readyPromise;
}

/** Internal: the initialised libsodium instance. Throws if `ready()` has not resolved. */
export function getSodium(): typeof sodiumType {
  if (!instance) {
    throw new Error("@map-diary/crypto: call and await ready() before using crypto functions");
  }
  return instance;
}
