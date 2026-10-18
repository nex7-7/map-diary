import { getSodium } from "./sodium";
import { CryptoError } from "./errors";
import { canonicalBytes, fromBase64, toBase64, utf8 } from "./encoding";

export const REQUEST_AUTH_VERSION = 1;

/** How far a signed request's timestamp may be from the server clock. */
export const REQUEST_MAX_SKEW_MS = 5 * 60 * 1000;

/** Header names carrying a device's request signature. */
export const AUTH_HEADERS = {
  device: "X-Device-Id",
  timestamp: "X-Timestamp",
  signature: "X-Signature",
} as const;

/**
 * An account's long-term Ed25519 key. It lives only inside the passphrase key backup
 * and is used for one thing: authorising each new device on the account.
 */
export interface AccountKeys {
  signPublicKey: Uint8Array;
  signSecretKey: Uint8Array;
}

export function generateAccountKeys(): AccountKeys {
  const pair = getSodium().crypto_sign_keypair();
  return { signPublicKey: pair.publicKey, signSecretKey: pair.privateKey };
}

export interface RequestToSign {
  method: string;
  /** Path plus query string, for example `/api/sync?since=12`. */
  path: string;
  deviceId: string;
  /** Unix milliseconds. */
  timestamp: number;
  /** The exact request body bytes; empty for GET. */
  body: Uint8Array;
}

/** The exact bytes a request signature covers. The body is bound by its BLAKE2b hash. */
export function requestSignedBytes(r: RequestToSign): Uint8Array {
  const bodyHash = getSodium().crypto_generichash(32, r.body, null);
  return canonicalBytes([
    "map-diary/request",
    REQUEST_AUTH_VERSION,
    r.method.toUpperCase(),
    r.path,
    r.deviceId,
    r.timestamp,
    toBase64(bodyHash),
  ]);
}

/** Signs a request with the device's Ed25519 key and returns the headers to send. */
export function signRequest(r: RequestToSign, deviceSignSecretKey: Uint8Array): Record<string, string> {
  if (!Number.isSafeInteger(r.timestamp) || r.timestamp < 0) {
    throw new CryptoError("invalid_input", "timestamp must be a non-negative integer (ms)");
  }
  const signature = getSodium().crypto_sign_detached(requestSignedBytes(r), deviceSignSecretKey);
  return {
    [AUTH_HEADERS.device]: r.deviceId,
    [AUTH_HEADERS.timestamp]: String(r.timestamp),
    [AUTH_HEADERS.signature]: toBase64(signature),
  };
}

export function verifyRequest(
  r: RequestToSign,
  signature: string,
  deviceSignPublicKey: Uint8Array,
): boolean {
  try {
    return getSodium().crypto_sign_verify_detached(
      fromBase64(signature),
      requestSignedBytes(r),
      deviceSignPublicKey,
    );
  } catch {
    return false;
  }
}

export type DeviceKind = "web" | "android" | "claude";

/** A new device's public keys, as the account key authorises them. */
export interface DeviceToAuthorize {
  accountId: string;
  deviceId: string;
  kind: DeviceKind;
  signPublicKey: Uint8Array;
  boxPublicKey: Uint8Array;
}

function deviceAuthorizationBytes(d: DeviceToAuthorize): Uint8Array {
  return canonicalBytes([
    "map-diary/device",
    REQUEST_AUTH_VERSION,
    d.accountId,
    d.deviceId,
    d.kind,
    toBase64(d.signPublicKey),
    toBase64(d.boxPublicKey),
  ]);
}

/** The account key's signature that lets the server register this device on the account. */
export function authorizeDevice(d: DeviceToAuthorize, accountSignSecretKey: Uint8Array): string {
  return toBase64(getSodium().crypto_sign_detached(deviceAuthorizationBytes(d), accountSignSecretKey));
}

export function verifyDeviceAuthorization(
  d: DeviceToAuthorize,
  authorization: string,
  accountSignPublicKey: Uint8Array,
): boolean {
  try {
    return getSodium().crypto_sign_verify_detached(
      fromBase64(authorization),
      deviceAuthorizationBytes(d),
      accountSignPublicKey,
    );
  } catch {
    return false;
  }
}

/**
 * The id a new device uses to fetch the key backup knowing only the passphrase.
 * Argon2id with a fixed, app-wide salt, so it is deterministic; guessing it is as hard as
 * guessing the passphrase, which keeps backups from being downloadable by account id.
 */
export function backupLookupId(passphrase: string): string {
  const sodium = getSodium();
  if (passphrase.length === 0) {
    throw new CryptoError("invalid_input", "Passphrase must not be empty");
  }
  const salt = sodium.crypto_generichash(sodium.crypto_pwhash_SALTBYTES, utf8("map-diary/backup-lookup/v1"), null);
  const id = sodium.crypto_pwhash(
    32,
    utf8(passphrase.normalize("NFKC")),
    salt,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
  return toBase64(id);
}
