import { getSodium } from "./sodium";
import { CryptoError } from "./errors";
import { toBase64, utf8 } from "./encoding";
import type { AccountKeys } from "./auth";
import type { BoardKey } from "./keys";

/**
 * The recovery phrase is 128 random bits shown once at setup. Every key that makes up an
 * account (the account signing key and each version of the personal board key) and the
 * account's ids are derived from it with libsodium's KDF, so the phrase alone can sign a
 * new device in after the passphrase is forgotten.
 */
export const RECOVERY_SEED_BYTES = 16;

// Crockford base32: no I, L, O or U, so the phrase survives being read aloud or retyped.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CHECK_BITS = 12;
const PHRASE_CHARS = (RECOVERY_SEED_BYTES * 8 + CHECK_BITS) / 5; // 28
const GROUP = 4;

function checksum(seed: Uint8Array): number {
  const sodium = getSodium();
  const h = sodium.crypto_generichash(16, seed, utf8("map-diary/recovery-check/v1"));
  return (((h[0] ?? 0) << 8) | (h[1] ?? 0)) >>> (16 - CHECK_BITS);
}

/** Bits of the seed followed by its checksum, most significant first. */
function toBits(seed: Uint8Array): number[] {
  const bits: number[] = [];
  for (const byte of seed) for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  const check = checksum(seed);
  for (let i = CHECK_BITS - 1; i >= 0; i--) bits.push((check >> i) & 1);
  return bits;
}

function encodePhrase(seed: Uint8Array): string {
  const bits = toBits(seed);
  let chars = "";
  for (let i = 0; i < bits.length; i += 5) {
    let v = 0;
    for (let j = 0; j < 5; j++) v = (v << 1) | (bits[i + j] ?? 0);
    chars += ALPHABET[v];
  }
  return chars.match(new RegExp(`.{1,${GROUP}}`, "g"))?.join("-") ?? chars;
}

/** A new random recovery seed and its printable phrase, for example `7K3Q-…` (7 groups of 4). */
export function generateRecoveryPhrase(): { seed: Uint8Array; phrase: string } {
  const seed = getSodium().randombytes_buf(RECOVERY_SEED_BYTES);
  return { seed, phrase: encodePhrase(seed) };
}

/** The printable phrase for a seed. */
export function recoveryPhraseFromSeed(seed: Uint8Array): string {
  if (seed.length !== RECOVERY_SEED_BYTES) {
    throw new CryptoError("invalid_input", "Recovery seed has the wrong length");
  }
  return encodePhrase(seed);
}

/**
 * Reads a phrase as typed: case, spaces and dashes don't matter, and the look-alikes
 * I, L and O read as 1, 1 and 0. Throws `invalid_input` on a typo the checksum catches.
 */
export function parseRecoveryPhrase(text: string): Uint8Array {
  const clean = text
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  if (clean.length !== PHRASE_CHARS) {
    throw new CryptoError("invalid_input", `A recovery phrase has ${PHRASE_CHARS} characters`);
  }
  const bits: number[] = [];
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new CryptoError("invalid_input", "The recovery phrase has a character it cannot contain");
    for (let i = 4; i >= 0; i--) bits.push((v >> i) & 1);
  }
  const seed = new Uint8Array(RECOVERY_SEED_BYTES);
  for (let i = 0; i < seed.length; i++) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i * 8 + j] ?? 0);
    seed[i] = byte;
  }
  let check = 0;
  for (let i = 0; i < CHECK_BITS; i++) check = (check << 1) | (bits[RECOVERY_SEED_BYTES * 8 + i] ?? 0);
  if (check !== checksum(seed)) {
    throw new CryptoError("invalid_input", "The recovery phrase has a typo");
  }
  return seed;
}

/**
 * An account's X25519 keypair at one version. Board keys are wrapped to it (once per
 * person, not per device), and each of the person's devices holds the secret half.
 * Revoking a device moves the account to the next version.
 */
export interface AccountBoxKeys {
  version: number;
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/** Everything an account is made of, derived from its recovery seed. */
export interface RecoveredAccount {
  accountId: string;
  accountKeys: AccountKeys;
  /** The account's box keypair at a given version. */
  accountBoxKeys: (version: number) => AccountBoxKeys;
  personalBoardId: string;
  /** The personal board key at a given version (rotation moves to the next version). */
  personalBoardKey: (version: number) => BoardKey;
}

// crypto_kdf contexts are exactly 8 bytes.
const CTX_ACCOUNT_KEY = "mdacckey";
const CTX_IDS = "mdids___";
const CTX_PERSONAL = "mdperson";
const CTX_ACCOUNT_BOX = "mdaccbox";

function checkVersion(version: number, what: string): void {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new CryptoError("invalid_input", `${what} version must be a positive integer`);
  }
}

export function deriveAccount(seed: Uint8Array): RecoveredAccount {
  const sodium = getSodium();
  if (seed.length !== RECOVERY_SEED_BYTES) {
    throw new CryptoError("invalid_input", "Recovery seed has the wrong length");
  }
  // Stretch the 16-byte seed to the 32-byte master key crypto_kdf needs.
  const master = sodium.crypto_generichash(sodium.crypto_kdf_KEYBYTES, seed, utf8("map-diary/recovery/v1"));

  const signSeed = sodium.crypto_kdf_derive_from_key(sodium.crypto_sign_SEEDBYTES, 1, CTX_ACCOUNT_KEY, master);
  const pair = sodium.crypto_sign_seed_keypair(signSeed);
  sodium.memzero(signSeed);

  const accountId = toBase64(sodium.crypto_kdf_derive_from_key(16, 1, CTX_IDS, master));
  const personalBoardId = toBase64(sodium.crypto_kdf_derive_from_key(16, 2, CTX_IDS, master));

  return {
    accountId,
    accountKeys: { signPublicKey: pair.publicKey, signSecretKey: pair.privateKey },
    accountBoxKeys: (version: number): AccountBoxKeys => {
      checkVersion(version, "Account key");
      const boxSeed = sodium.crypto_kdf_derive_from_key(sodium.crypto_box_SEEDBYTES, version, CTX_ACCOUNT_BOX, master);
      const box = sodium.crypto_box_seed_keypair(boxSeed);
      sodium.memzero(boxSeed);
      return { version, publicKey: box.publicKey, secretKey: box.privateKey };
    },
    personalBoardId,
    personalBoardKey: (version: number): BoardKey => {
      checkVersion(version, "Board key");
      return {
        boardId: personalBoardId,
        version,
        key: sodium.crypto_kdf_derive_from_key(sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES, version, CTX_PERSONAL, master),
      };
    },
  };
}
