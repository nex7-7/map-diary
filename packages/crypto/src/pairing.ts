import { getSodium } from "./sodium";
import { CryptoError } from "./errors";
import { canonicalBytes, fromBase64, fromUtf8, toBase64, utf8 } from "./encoding";
import type { DeviceKind } from "./auth";
import type { IdentityKeys } from "./keys";

/**
 * Linking a new device from one already signed in. The old device makes a short random
 * secret and shows it as a QR link (after the `#`, so it never reaches the server) and as
 * text the person can type. Everything the two devices exchange through the Worker is tied
 * to that secret:
 *
 * - the pairing id the Worker files the exchange under is derived from it,
 * - the new device's public keys carry a MAC under a key derived from it, so nobody without
 *   the secret can swap in their own keys,
 * - both screens show a short code derived from it and the new keys, so the person can tell
 *   that the device they approve is the one in their hand (this also covers anyone who
 *   guessed or saw the secret),
 * - and the account keys travel sealed to the new device's own X25519 key.
 *
 * The secret is 50 bits so it can be typed: a pairing lasts ten minutes, takes one join, and
 * the code comparison stops a device that is not the person's own.
 */
const SECRET_CHARS = 10;

const CTX_PAIRING = "mdpair__";
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_CHARS = 6;

function crockford(bits: bigint, chars: number): string {
  let out = "";
  for (let i = 0; i < chars; i++) {
    out += ALPHABET[Number(bits & 31n)];
    bits >>= 5n;
  }
  return out;
}

/** A new pairing secret, for example `7K3QM-9XT2B`. It goes after the `#` in the link. */
export function generatePairingSecret(): string {
  let bits = 0n;
  for (const byte of getSodium().randombytes_buf(8)) bits = (bits << 8n) | BigInt(byte);
  const text = crockford(bits, SECRET_CHARS);
  return `${text.slice(0, 5)}-${text.slice(5)}`;
}

/**
 * Reads a secret as typed or as found in a link: case, spaces and dashes don't matter, and
 * I, L and O read as 1, 1 and 0. Returns the canonical form, or null if it cannot be one.
 */
export function normalisePairingSecret(text: string): string | null {
  const clean = text
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  if (clean.length !== SECRET_CHARS || [...clean].some((ch) => !ALPHABET.includes(ch))) return null;
  return `${clean.slice(0, 5)}-${clean.slice(5)}`;
}

function subkey(secret: string, id: number): Uint8Array {
  const sodium = getSodium();
  const canonical = normalisePairingSecret(secret);
  if (!canonical) throw new CryptoError("invalid_input", "Not a pairing secret");
  const master = sodium.crypto_generichash(sodium.crypto_kdf_KEYBYTES, utf8(canonical), utf8("map-diary/pairing/v1"));
  return sodium.crypto_kdf_derive_from_key(32, id, CTX_PAIRING, master);
}

/** The id the Worker files the pairing under. Knowing it does not reveal the secret. */
export function pairingId(secret: string): string {
  return toBase64(subkey(secret, 1).subarray(0, 16));
}

/** The new device's public half, as it asks to join. */
export interface PairingJoin {
  deviceId: string;
  kind: DeviceKind;
  signPublicKey: Uint8Array;
  boxPublicKey: Uint8Array;
}

function joinBytes(j: PairingJoin): Uint8Array {
  return canonicalBytes([
    "map-diary/pairing-join",
    1,
    j.deviceId,
    j.kind,
    toBase64(j.signPublicKey),
    toBase64(j.boxPublicKey),
  ]);
}

/** Proves the join request came from someone holding the link. */
export function pairingJoinMac(secret: string, join: PairingJoin): string {
  return toBase64(getSodium().crypto_auth(joinBytes(join), subkey(secret, 2)));
}

export function verifyPairingJoinMac(secret: string, join: PairingJoin, mac: string): boolean {
  try {
    return getSodium().crypto_auth_verify(fromBase64(mac), joinBytes(join), subkey(secret, 2));
  } catch {
    return false;
  }
}

/** The 6-character code both screens show, for example `7K3Q-9M`. */
export function pairingCode(secret: string, join: PairingJoin): string {
  const h = getSodium().crypto_generichash(8, joinBytes(join), subkey(secret, 3));
  let bits = 0n;
  for (const byte of h) bits = (bits << 8n) | BigInt(byte);
  const code = crockford(bits, CODE_CHARS);
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

/** What the old device hands the new one: enough to open every board, nothing more. */
export interface AccountTransfer {
  accountId: string;
  personalBoardId: string;
  accountBox: { version: number; publicKey: Uint8Array; secretKey: Uint8Array };
}

/** Seals the account transfer to the new device's X25519 public key. */
export function sealAccountTransfer(transfer: AccountTransfer, recipientBoxPublicKey: Uint8Array): string {
  const json = JSON.stringify({
    v: 1,
    accountId: transfer.accountId,
    personalBoardId: transfer.personalBoardId,
    accountBox: {
      version: transfer.accountBox.version,
      publicKey: toBase64(transfer.accountBox.publicKey),
      secretKey: toBase64(transfer.accountBox.secretKey),
    },
  });
  return toBase64(getSodium().crypto_box_seal(utf8(json), recipientBoxPublicKey));
}

export function openAccountTransfer(sealed: string, identity: Pick<IdentityKeys, "boxPublicKey" | "boxSecretKey">): AccountTransfer {
  const bad = () => new CryptoError("decrypt_failed", "Could not open the account transfer");
  let raw: unknown;
  try {
    const opened = getSodium().crypto_box_seal_open(fromBase64(sealed), identity.boxPublicKey, identity.boxSecretKey);
    raw = JSON.parse(fromUtf8(opened));
  } catch {
    throw bad();
  }
  if (typeof raw !== "object" || raw === null) throw bad();
  const { v, accountId, personalBoardId, accountBox } = raw as Record<string, unknown>;
  if (v !== 1 || typeof accountId !== "string" || typeof personalBoardId !== "string") throw bad();
  if (typeof accountBox !== "object" || accountBox === null) throw bad();
  const { version, publicKey, secretKey } = accountBox as Record<string, unknown>;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) throw bad();
  if (typeof publicKey !== "string" || typeof secretKey !== "string") throw bad();
  return {
    accountId,
    personalBoardId,
    accountBox: { version, publicKey: fromBase64(publicKey), secretKey: fromBase64(secretKey) },
  };
}
