import { getSodium } from "./sodium";
import { CryptoError } from "./errors";

/** A person's (or device's) long-term keys, generated on the device. */
export interface IdentityKeys {
  /** X25519, receives wrapped board keys. */
  boxPublicKey: Uint8Array;
  boxSecretKey: Uint8Array;
  /** Ed25519, signs envelopes. */
  signPublicKey: Uint8Array;
  signSecretKey: Uint8Array;
}

/** Public half of an identity, safe to store on the server. */
export interface PublicIdentity {
  boxPublicKey: Uint8Array;
  signPublicKey: Uint8Array;
}

/** A board's symmetric key (master, group or personal) at one version. */
export interface BoardKey {
  boardId: string;
  version: number;
  key: Uint8Array;
}

export function generateIdentity(): IdentityKeys {
  const sodium = getSodium();
  const box = sodium.crypto_box_keypair();
  const sign = sodium.crypto_sign_keypair();
  return {
    boxPublicKey: box.publicKey,
    boxSecretKey: box.privateKey,
    signPublicKey: sign.publicKey,
    signSecretKey: sign.privateKey,
  };
}

export function publicIdentity(identity: IdentityKeys): PublicIdentity {
  return { boxPublicKey: identity.boxPublicKey, signPublicKey: identity.signPublicKey };
}

/** A fresh XChaCha20-Poly1305 key for a board. */
export function generateBoardKey(boardId: string, version = 1): BoardKey {
  if (!Number.isInteger(version) || version < 1) {
    throw new CryptoError("invalid_input", "Board key version must be a positive integer");
  }
  return { boardId, version, key: getSodium().crypto_aead_xchacha20poly1305_ietf_keygen() };
}

/**
 * Wraps a board key to one member's X25519 public key (sealed box), so only that
 * member's device can recover it. The server stores the result.
 */
export function wrapKeyForMember(key: Uint8Array, memberBoxPublicKey: Uint8Array): Uint8Array {
  return getSodium().crypto_box_seal(key, memberBoxPublicKey);
}

/** Opens a key wrapped by `wrapKeyForMember`, with a device's or an account's box keypair. */
export function unwrapKeyFromMember(
  wrapped: Uint8Array,
  identity: Pick<IdentityKeys, "boxPublicKey" | "boxSecretKey">,
): Uint8Array {
  try {
    return getSodium().crypto_box_seal_open(wrapped, identity.boxPublicKey, identity.boxSecretKey);
  } catch {
    throw new CryptoError("decrypt_failed", "Could not unwrap key for this identity");
  }
}
