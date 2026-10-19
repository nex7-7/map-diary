import { getSodium } from "./sodium";
import { CryptoError } from "./errors";
import { canonicalBytes, fromBase64, fromUtf8, toBase64, utf8 } from "./encoding";

/**
 * Group invites. Any member makes a random secret and shares it as a link with the secret
 * after the `#`, which browsers never send to the server. Everything the Worker stores is
 * derived from that secret:
 *
 * - the invite id the Worker files it under,
 * - a hash of the accept token, so only someone holding the link can use it (the id alone
 *   does not give the token),
 * - and the group's keys, encrypted under a key derived from the secret.
 *
 * The secret is 256 bits: a link is pasted, never typed.
 */
const SECRET_BYTES = 32;
const CTX_INVITE = "mdinvite";

/** What an invite carries: the group's name as the inviter knows it, and every key version. */
export interface GroupInvite {
  boardId: string;
  groupName: string;
  keys: { version: number; key: Uint8Array }[];
}

/** A sealed invite as the Worker stores it. */
export interface SealedInvite {
  /** base64url */
  nonce: string;
  /** base64url */
  sealedKeys: string;
}

/** A new invite secret, base64url. It goes after the `#` in the link. */
export function generateInviteSecret(): string {
  return toBase64(getSodium().randombytes_buf(SECRET_BYTES));
}

function subkey(secret: string, id: number): Uint8Array {
  const sodium = getSodium();
  let raw: Uint8Array;
  try {
    raw = fromBase64(secret.trim());
  } catch {
    throw new CryptoError("invalid_input", "Not an invite secret");
  }
  if (raw.length !== SECRET_BYTES) throw new CryptoError("invalid_input", "Not an invite secret");
  return sodium.crypto_kdf_derive_from_key(32, id, CTX_INVITE, raw);
}

/** Whether a string can be an invite secret, for reading one out of a link. */
export function isInviteSecret(text: string): boolean {
  try {
    subkey(text, 1);
    return true;
  } catch {
    return false;
  }
}

/** The id the Worker files the invite under. Knowing it reveals neither the secret nor the token. */
export function inviteId(secret: string): string {
  return toBase64(subkey(secret, 1).subarray(0, 16));
}

/** Proves to the Worker, on accepting, that the device holds the link. */
export function inviteToken(secret: string): string {
  return toBase64(subkey(secret, 2));
}

/** What the Worker stores to check a token. Run by the inviting device and by the Worker. */
export function inviteTokenHash(token: string): Uint8Array {
  return getSodium().crypto_generichash(32, utf8(`map-diary/invite-token/v1:${token}`), null);
}

function inviteAad(secret: string): Uint8Array {
  return canonicalBytes(["map-diary/invite", 1, inviteId(secret)]);
}

/** Encrypts the group's keys and name under a key derived from the secret. */
export function sealGroupInvite(secret: string, invite: GroupInvite): SealedInvite {
  const sodium = getSodium();
  if (invite.keys.length === 0) throw new CryptoError("invalid_input", "An invite needs at least one key");
  const json = JSON.stringify({
    v: 1,
    boardId: invite.boardId,
    groupName: invite.groupName,
    keys: invite.keys.map((k) => ({ version: k.version, key: toBase64(k.key) })),
  });
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const sealed = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(utf8(json), inviteAad(secret), null, nonce, subkey(secret, 3));
  return { nonce: toBase64(nonce), sealedKeys: toBase64(sealed) };
}

export function openGroupInvite(secret: string, sealed: SealedInvite): GroupInvite {
  const sodium = getSodium();
  const bad = () => new CryptoError("decrypt_failed", "Could not open the invite");
  let raw: unknown;
  try {
    const opened = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      fromBase64(sealed.sealedKeys),
      inviteAad(secret),
      fromBase64(sealed.nonce),
      subkey(secret, 3),
    );
    raw = JSON.parse(fromUtf8(opened));
  } catch {
    throw bad();
  }
  if (typeof raw !== "object" || raw === null) throw bad();
  const { v, boardId, groupName, keys } = raw as Record<string, unknown>;
  if (v !== 1 || typeof boardId !== "string" || typeof groupName !== "string" || !Array.isArray(keys)) throw bad();
  const out: GroupInvite["keys"] = [];
  for (const k of keys as unknown[]) {
    if (typeof k !== "object" || k === null) throw bad();
    const { version, key } = k as Record<string, unknown>;
    if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1 || typeof key !== "string") throw bad();
    const bytes = fromBase64(key);
    if (bytes.length !== sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES) throw bad();
    out.push({ version, key: bytes });
  }
  if (out.length === 0) throw bad();
  return { boardId, groupName, keys: out };
}
