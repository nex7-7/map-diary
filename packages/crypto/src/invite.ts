import { getSodium } from "./sodium";
import { CryptoError } from "./errors";
import { toBase64, utf8 } from "./encoding";

/**
 * App invites: the admin's device makes a random code and shares it as a link (after the
 * `#`, so it never reaches the server) and as text a friend can type into the installed app
 * (on iPhone a tapped link opens in Safari, whose storage the Home Screen app does not share).
 *
 * The Worker files the invite under an id derived from the code, so it never sees the code
 * itself. The code is 100 bits: an invite lasts seven days and will also carry keys sealed
 * under a key derived from it, so it must hold up to offline guessing, not just online.
 */
const GROUPS = 4;
const GROUP_CHARS = 5;
const CHARS = GROUPS * GROUP_CHARS;
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CTX_INVITE = "mdinvite";

function grouped(text: string): string {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += GROUP_CHARS) parts.push(text.slice(i, i + GROUP_CHARS));
  return parts.join("-");
}

/** A new invite code, for example `7K3QM-9XT2B-QW4RT-ZP0HK`. */
export function generateInviteCode(): string {
  // 13 random bytes give 104 bits; 20 Crockford characters use 100 of them.
  let bits = 0n;
  for (const byte of getSodium().randombytes_buf(13)) bits = (bits << 8n) | BigInt(byte);
  let text = "";
  for (let i = 0; i < CHARS; i++) {
    text += ALPHABET[Number(bits & 31n)];
    bits >>= 5n;
  }
  return grouped(text);
}

/**
 * Reads a code as typed or as found in a link: case, spaces and dashes don't matter, and
 * I, L and O read as 1, 1 and 0. Returns the canonical form, or null if it cannot be one.
 */
export function normaliseInviteCode(text: string): string | null {
  const clean = text
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  if (clean.length !== CHARS || [...clean].some((ch) => !ALPHABET.includes(ch))) return null;
  return grouped(clean);
}

function subkey(code: string, id: number): Uint8Array {
  const sodium = getSodium();
  const canonical = normaliseInviteCode(code);
  if (!canonical) throw new CryptoError("invalid_input", "Not an invite code");
  const master = sodium.crypto_generichash(sodium.crypto_kdf_KEYBYTES, utf8(canonical), utf8("map-diary/invite/v1"));
  return sodium.crypto_kdf_derive_from_key(32, id, CTX_INVITE, master);
}

/** The id the Worker files the invite under. Knowing it does not reveal the code. */
export function appInviteId(code: string): string {
  return toBase64(subkey(code, 1).subarray(0, 16));
}

/**
 * A symmetric key only holders of the code can derive, for sealing keys into the invite
 * (the master key, once sharing exists).
 */
export function appInviteKey(code: string): Uint8Array {
  return subkey(code, 2);
}
