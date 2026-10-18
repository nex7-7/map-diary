import { getSodium } from "./sodium";
import { CryptoError } from "./errors";
import { canonicalBytes, fromBase64, toBase64, utf8 } from "./encoding";

export const KEY_BACKUP_VERSION = 1;

/** A secret encrypted under a passphrase-derived key (Argon2id). Safe to store on the server. */
export interface KeyBackup {
  v: typeof KEY_BACKUP_VERSION;
  kdf: "argon2id13";
  opsLimit: number;
  memLimit: number;
  /** base64url */
  salt: string;
  /** base64url */
  nonce: string;
  /** base64url */
  ciphertext: string;
}

export interface KdfParams {
  opsLimit: number;
  memLimit: number;
}

/**
 * libsodium's INTERACTIVE preset (64 MiB). MODERATE (256 MiB) is too much for Safari
 * on older iPhones, which every friend's device must run.
 */
export function defaultKdfParams(): KdfParams {
  const sodium = getSodium();
  return {
    opsLimit: sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    memLimit: sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
  };
}

function backupAad(b: Pick<KeyBackup, "v" | "kdf" | "opsLimit" | "memLimit" | "salt">): Uint8Array {
  return canonicalBytes(["map-diary/key-backup", b.v, b.kdf, b.opsLimit, b.memLimit, b.salt]);
}

function deriveKey(passphrase: string, salt: Uint8Array, params: KdfParams): Uint8Array {
  const sodium = getSodium();
  return sodium.crypto_pwhash(
    sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
    utf8(passphrase.normalize("NFKC")),
    salt,
    params.opsLimit,
    params.memLimit,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
}

/** Encrypts `secret` (for example a serialised key bundle) under `passphrase`. */
export function createKeyBackup(
  secret: Uint8Array,
  passphrase: string,
  params: KdfParams = defaultKdfParams(),
): KeyBackup {
  const sodium = getSodium();
  if (passphrase.length === 0) {
    throw new CryptoError("invalid_input", "Passphrase must not be empty");
  }
  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const header = {
    v: KEY_BACKUP_VERSION,
    kdf: "argon2id13",
    opsLimit: params.opsLimit,
    memLimit: params.memLimit,
    salt: toBase64(salt),
  } as const;

  const key = deriveKey(passphrase, salt, params);
  try {
    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      secret,
      backupAad(header),
      null,
      nonce,
      key,
    );
    return { ...header, nonce: toBase64(nonce), ciphertext: toBase64(ciphertext) };
  } finally {
    sodium.memzero(key);
  }
}

/** Recovers the secret. A wrong passphrase and a tampered backup both throw `bad_backup`. */
export function openKeyBackup(backup: KeyBackup, passphrase: string): Uint8Array {
  const sodium = getSodium();
  if (backup.v !== KEY_BACKUP_VERSION || backup.kdf !== "argon2id13") {
    throw new CryptoError("unsupported_version", "Unsupported key backup format");
  }
  const key = deriveKey(passphrase, fromBase64(backup.salt), backup);
  try {
    return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      fromBase64(backup.ciphertext),
      backupAad(backup),
      fromBase64(backup.nonce),
      key,
    );
  } catch {
    throw new CryptoError("bad_backup", "Wrong passphrase or corrupted backup");
  } finally {
    sodium.memzero(key);
  }
}
