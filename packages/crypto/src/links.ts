import { getSodium } from "./sodium";
import { CryptoError } from "./errors";
import { utf8 } from "./encoding";

/**
 * Duplicate places are blocked by a keyed hash of each normalised source link. The key is
 * derived from the first master key, which every member holds (an invite grants every
 * version), so any member can compute and check a hash while the server, which never sees
 * the key, cannot test a guessed link against the table.
 */
export const LINK_HASH_BYTES = 32;

// crypto_kdf contexts are exactly 8 bytes.
const CTX_LINK_HASH = "mdlinkhs";

/** The link hash key, from the master board key at version 1. */
export function linkHashKey(masterKeyV1: Uint8Array): Uint8Array {
  const sodium = getSodium();
  if (masterKeyV1.length !== sodium.crypto_kdf_KEYBYTES) {
    throw new CryptoError("invalid_input", "The master key has the wrong length");
  }
  return sodium.crypto_kdf_derive_from_key(sodium.crypto_generichash_KEYBYTES, 1, CTX_LINK_HASH, masterKeyV1);
}

/** The keyed BLAKE2b hash of one normalised source link. */
export function linkHash(key: Uint8Array, normalisedLink: string): Uint8Array {
  if (normalisedLink.length === 0) throw new CryptoError("invalid_input", "An empty link has no hash");
  return getSodium().crypto_generichash(LINK_HASH_BYTES, utf8(normalisedLink), key);
}
