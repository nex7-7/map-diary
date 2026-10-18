import sodium from "libsodium-wrappers-sumo";

let readyPromise: Promise<void> | null = null;
let isReady = false;

/** Loads libsodium. Call once (and await it) before any other function in this package. */
export function ready(): Promise<void> {
  readyPromise ??= sodium.ready.then(() => {
    isReady = true;
  });
  return readyPromise;
}

/** Internal: the initialised libsodium instance. Throws if `ready()` has not resolved. */
export function getSodium(): typeof sodium {
  if (!isReady) {
    throw new Error("@map-diary/crypto: call and await ready() before using crypto functions");
  }
  return sodium;
}
