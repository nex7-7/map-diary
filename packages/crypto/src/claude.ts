import { getSodium } from "./sodium";
import { CryptoError } from "./errors";
import { canonicalBytes, fromBase64, fromUtf8, toBase64, utf8 } from "./encoding";
import type { IdentityKeys } from "./keys";

/**
 * The Claude assistant is a device of kind `claude` whose keys live on the Worker, sealed
 * under a key derived from a random connector secret. The owner's browser makes the device
 * and the secret, shows the secret once (it goes into the Claude connector) and forgets it.
 * The Worker stores a hash of the secret to find the device and the sealed keys, so it can
 * open them only while a call that carries the secret runs.
 *
 * The secret is 256 bits, so a plain KDF is enough (no Argon2): every assistant call
 * re-derives the keys within the Worker's CPU limit.
 */
const SECRET_BYTES = 32;
const CTX_CONNECTOR = "mdclaude";

/** A new connector secret, base64url (43 characters, safe in a header or a URL). */
export function generateConnectorSecret(): string {
  return toBase64(getSodium().randombytes_buf(SECRET_BYTES));
}

function subkey(secret: string, id: number): Uint8Array {
  let raw: Uint8Array;
  try {
    raw = fromBase64(secret.trim());
  } catch {
    throw new CryptoError("invalid_input", "Not a connector secret");
  }
  if (raw.length !== SECRET_BYTES) throw new CryptoError("invalid_input", "Not a connector secret");
  return getSodium().crypto_kdf_derive_from_key(32, id, CTX_CONNECTOR, raw);
}

/** Whether a string can be a connector secret, before deriving anything from it. */
export function isConnectorSecret(text: string): boolean {
  try {
    subkey(text, 1);
    return true;
  } catch {
    return false;
  }
}

/** What the Worker files the Claude device's keys under. Knowing it does not give the secret. */
export function connectorSecretHash(secret: string): Uint8Array {
  return subkey(secret, 1);
}

/** The Claude device's secret keys, as the Worker stores them. */
export interface SealedClaudeKeys {
  /** base64url */
  nonce: string;
  /** base64url */
  sealedKeys: string;
}

function keysAad(deviceId: string): Uint8Array {
  return canonicalBytes(["map-diary/claude-device", 1, deviceId]);
}

/** Seals the Claude device's keypairs under a key derived from the connector secret. */
export function sealClaudeDeviceKeys(deviceId: string, identity: IdentityKeys, secret: string): SealedClaudeKeys {
  const sodium = getSodium();
  const json = JSON.stringify({
    v: 1,
    boxPublicKey: toBase64(identity.boxPublicKey),
    boxSecretKey: toBase64(identity.boxSecretKey),
    signPublicKey: toBase64(identity.signPublicKey),
    signSecretKey: toBase64(identity.signSecretKey),
  });
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const sealed = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(utf8(json), keysAad(deviceId), null, nonce, subkey(secret, 2));
  return { nonce: toBase64(nonce), sealedKeys: toBase64(sealed) };
}

/** Opens what `sealClaudeDeviceKeys` sealed. Throws `decrypt_failed` for a wrong secret or device. */
export function openClaudeDeviceKeys(deviceId: string, sealed: SealedClaudeKeys, secret: string): IdentityKeys {
  const sodium = getSodium();
  const bad = () => new CryptoError("decrypt_failed", "Could not open the Claude device keys");
  let raw: unknown;
  try {
    const opened = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      fromBase64(sealed.sealedKeys),
      keysAad(deviceId),
      fromBase64(sealed.nonce),
      subkey(secret, 2),
    );
    raw = JSON.parse(fromUtf8(opened));
  } catch {
    throw bad();
  }
  if (typeof raw !== "object" || raw === null) throw bad();
  const { v, boxPublicKey, boxSecretKey, signPublicKey, signSecretKey } = raw as Record<string, unknown>;
  if (
    v !== 1 ||
    typeof boxPublicKey !== "string" ||
    typeof boxSecretKey !== "string" ||
    typeof signPublicKey !== "string" ||
    typeof signSecretKey !== "string"
  ) {
    throw bad();
  }
  const identity: IdentityKeys = {
    boxPublicKey: fromBase64(boxPublicKey),
    boxSecretKey: fromBase64(boxSecretKey),
    signPublicKey: fromBase64(signPublicKey),
    signSecretKey: fromBase64(signSecretKey),
  };
  if (
    identity.boxPublicKey.length !== sodium.crypto_box_PUBLICKEYBYTES ||
    identity.boxSecretKey.length !== sodium.crypto_box_SECRETKEYBYTES ||
    identity.signPublicKey.length !== sodium.crypto_sign_PUBLICKEYBYTES ||
    identity.signSecretKey.length !== sodium.crypto_sign_SECRETKEYBYTES
  ) {
    throw bad();
  }
  return identity;
}
