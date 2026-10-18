import { getSodium } from "./sodium";
import { CryptoError } from "./errors";

/** Base64url without padding: the only binary-to-text encoding used on the wire. */
export function toBase64(bytes: Uint8Array): string {
  const sodium = getSodium();
  return sodium.to_base64(bytes, sodium.base64_variants.URLSAFE_NO_PADDING);
}

export function fromBase64(text: string): Uint8Array {
  const sodium = getSodium();
  try {
    return sodium.from_base64(text, sodium.base64_variants.URLSAFE_NO_PADDING);
  } catch {
    throw new CryptoError("invalid_input", "Invalid base64url string");
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

export function fromUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** Random identifier: 16 random bytes, base64url. Used for envelope, board and device ids. */
export function randomId(): string {
  return toBase64(getSodium().randombytes_buf(16));
}

/**
 * Deterministic bytes for signing / AAD. Every caller passes a fixed-order array of
 * strings, numbers and nulls (never objects), so JSON.stringify output is canonical.
 */
export type CanonicalValue = string | number | null | readonly CanonicalValue[];

export function canonicalBytes(parts: readonly CanonicalValue[]): Uint8Array {
  return utf8(JSON.stringify(parts));
}
