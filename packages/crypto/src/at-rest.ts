import { CryptoError } from "./errors";
import { fromBase64, fromUtf8, toBase64, utf8 } from "./encoding";
import { ready } from "./sodium";

/**
 * Encryption of what a device keeps in its own storage, under a key the browser makes and
 * never lets out (WebCrypto AES-GCM, extractable: false). A copy of the browser's files is
 * useless without the browser profile that holds the key; code running in the app can still
 * use it, so this guards storage at rest, not the open app. libsodium cannot make a key the
 * browser keeps out of reach, which is why this one piece uses WebCrypto.
 */
export type AtRestKey = CryptoKey;

/** A sealed value as stored: a fresh 96-bit nonce and the AES-GCM ciphertext. */
export interface AtRestSealed {
  iv: Uint8Array;
  ct: Uint8Array;
}

const ALGORITHM = "AES-GCM";

// WebCrypto wants bytes backed by a plain ArrayBuffer; a copy guarantees that.
const buf = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(bytes);
const BYTES_TAG = "$bytes";

export async function generateAtRestKey(): Promise<AtRestKey> {
  const key = await crypto.subtle.generateKey({ name: ALGORITHM, length: 256 }, false, ["encrypt", "decrypt"]);
  // A symmetric algorithm always gives one key; Workers' types also allow a pair.
  if (!isAtRestKey(key)) throw new CryptoError("invalid_input", "Expected an AES-GCM key");
  return key;
}

export function isAtRestKey(value: unknown): value is AtRestKey {
  return typeof CryptoKey !== "undefined" && value instanceof CryptoKey && value.algorithm.name === ALGORITHM;
}

export function isAtRestSealed(value: unknown): value is AtRestSealed {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.iv instanceof Uint8Array && v.ct instanceof Uint8Array;
}

// JSON with byte arrays kept as tagged base64url, so device keys survive the round trip.
function encode(value: unknown): Uint8Array {
  return utf8(
    JSON.stringify(value, (_key, v: unknown) => (v instanceof Uint8Array ? { [BYTES_TAG]: toBase64(v) } : v)),
  );
}

function decode(bytes: Uint8Array): unknown {
  return JSON.parse(fromUtf8(bytes), (_key, v: unknown) => {
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      const tagged = (v as Record<string, unknown>)[BYTES_TAG];
      if (typeof tagged === "string" && Object.keys(v).length === 1) return fromBase64(tagged);
    }
    return v;
  });
}

/**
 * Seals a value under the device's at-rest key. `context` names the record (its store and id)
 * and is bound as additional data, so a sealed value cannot be moved to another record.
 */
export async function sealAtRest(key: AtRestKey, context: string, value: unknown): Promise<AtRestSealed> {
  await ready();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv, additionalData: buf(utf8(context)) },
    key,
    buf(encode(value)),
  );
  return { iv, ct: new Uint8Array(ct) };
}

/** Opens a value sealed by `sealAtRest` with the same key and context. */
export async function openAtRest(key: AtRestKey, context: string, sealed: AtRestSealed): Promise<unknown> {
  await ready();
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      {
        name: ALGORITHM,
        iv: buf(sealed.iv),
        additionalData: buf(utf8(context)),
      },
      key,
      buf(sealed.ct),
    );
  } catch {
    throw new CryptoError("decrypt_failed", "Stored value does not open with this device's key");
  }
  return decode(new Uint8Array(plain));
}
