import { getSodium } from "./sodium";
import { CryptoError } from "./errors";
import { canonicalBytes, fromBase64, fromUtf8, randomId, toBase64, utf8 } from "./encoding";
import type { BoardKey } from "./keys";

export const ENVELOPE_VERSION = 1;

export const ENVELOPE_TYPES = [
  "place",
  "private_place",
  "status",
  "tag_def",
  "tag",
  "comment",
] as const;

export type EnvelopeType = (typeof ENVELOPE_TYPES)[number];

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** The content key for this envelope, wrapped with one board's key. */
export interface WrappedContentKey {
  boardId: string;
  keyVersion: number;
  /** base64url */
  nonce: string;
  /** base64url */
  wrappedKey: string;
}

/**
 * What the server stores and sees. Everything except `ciphertext` (and the wrapped keys)
 * is plaintext metadata, as accepted in the architecture's privacy ledger.
 */
export interface Envelope {
  v: typeof ENVELOPE_VERSION;
  id: string;
  type: EnvelopeType;
  /** The person who wrote the item. */
  authorId: string;
  /** The device that signed it (each device has its own signing key). */
  deviceId: string;
  placeId: string | null;
  /** Unix milliseconds. */
  createdAt: number;
  /** Unix milliseconds; sync is last-write-wins on this per envelope id. */
  updatedAt: number;
  boards: WrappedContentKey[];
  /** base64url */
  nonce: string;
  /** base64url, XChaCha20-Poly1305 of the JSON payload. */
  ciphertext: string;
  /** base64url, Ed25519 detached signature over every other field. */
  signature: string;
}

export interface SealInput {
  type: EnvelopeType;
  authorId: string;
  deviceId: string;
  placeId: string | null;
  payload: JsonValue;
  /** One or more boards the item is posted to. */
  boards: readonly BoardKey[];
  signSecretKey: Uint8Array;
  /** Reuse to write a new version of an existing item. Defaults to a fresh id. */
  id?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface OpenOptions {
  /** Returns the key for a board version this device holds, if any. */
  boardKey: (boardId: string, version: number) => Uint8Array | undefined;
  /** The Ed25519 public key registered for `envelope.deviceId`. */
  signerPublicKey: Uint8Array;
}

export interface OpenedEnvelope {
  envelope: Envelope;
  payload: JsonValue;
  /** The board whose key was used to open it. */
  boardId: string;
}

// Content AAD binds only fields that never change for an id, so boards can be
// re-wrapped and re-signed later without re-encrypting the payload.
function contentAad(e: Pick<Envelope, "v" | "id" | "type" | "authorId" | "placeId" | "createdAt">): Uint8Array {
  return canonicalBytes(["map-diary/content", e.v, e.id, e.type, e.authorId, e.placeId, e.createdAt]);
}

function wrapAad(envelopeId: string, boardId: string, keyVersion: number): Uint8Array {
  return canonicalBytes(["map-diary/wrap", ENVELOPE_VERSION, envelopeId, boardId, keyVersion]);
}

function sortedBoards(boards: readonly WrappedContentKey[]): WrappedContentKey[] {
  return [...boards].sort((a, b) =>
    a.boardId === b.boardId ? a.keyVersion - b.keyVersion : a.boardId < b.boardId ? -1 : 1,
  );
}

/** The exact bytes the signature covers. */
export function signedBytes(e: Omit<Envelope, "signature">): Uint8Array {
  return canonicalBytes([
    "map-diary/envelope",
    e.v,
    e.id,
    e.type,
    e.authorId,
    e.deviceId,
    e.placeId,
    e.createdAt,
    e.updatedAt,
    sortedBoards(e.boards).map((b) => [b.boardId, b.keyVersion, b.nonce, b.wrappedKey]),
    e.nonce,
    e.ciphertext,
  ]);
}

function assertTimestamp(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CryptoError("invalid_input", `${name} must be a non-negative integer (ms)`);
  }
}

/** Encrypts a payload once with a random content key and wraps that key for each board. */
export function sealEnvelope(input: SealInput): Envelope {
  const sodium = getSodium();
  if (input.boards.length === 0) {
    throw new CryptoError("invalid_input", "An envelope needs at least one board");
  }
  const boardIds = new Set(input.boards.map((b) => b.boardId));
  if (boardIds.size !== input.boards.length) {
    throw new CryptoError("invalid_input", "Each board may appear only once");
  }

  const now = Date.now();
  const createdAt = input.createdAt ?? now;
  const updatedAt = input.updatedAt ?? Math.max(now, createdAt);
  assertTimestamp("createdAt", createdAt);
  assertTimestamp("updatedAt", updatedAt);

  const header = {
    v: ENVELOPE_VERSION,
    id: input.id ?? randomId(),
    type: input.type,
    authorId: input.authorId,
    deviceId: input.deviceId,
    placeId: input.placeId,
    createdAt,
    updatedAt,
  } as const;

  const contentKey = sodium.crypto_aead_xchacha20poly1305_ietf_keygen();
  try {
    const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      utf8(JSON.stringify(input.payload)),
      contentAad(header),
      null,
      nonce,
      contentKey,
    );

    const boards = input.boards.map((board): WrappedContentKey => {
      const wrapNonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
      const wrapped = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
        contentKey,
        wrapAad(header.id, board.boardId, board.version),
        null,
        wrapNonce,
        board.key,
      );
      return {
        boardId: board.boardId,
        keyVersion: board.version,
        nonce: toBase64(wrapNonce),
        wrappedKey: toBase64(wrapped),
      };
    });

    const unsigned: Omit<Envelope, "signature"> = {
      ...header,
      boards: sortedBoards(boards),
      nonce: toBase64(nonce),
      ciphertext: toBase64(ciphertext),
    };
    const signature = sodium.crypto_sign_detached(signedBytes(unsigned), input.signSecretKey);
    return { ...unsigned, signature: toBase64(signature) };
  } finally {
    sodium.memzero(contentKey);
  }
}

/** Checks the author device's signature. Needs no board keys, so the server can run it too. */
export function verifyEnvelope(envelope: Envelope, signerPublicKey: Uint8Array): boolean {
  if (envelope.v !== ENVELOPE_VERSION) return false;
  const { signature, ...unsigned } = envelope;
  try {
    return getSodium().crypto_sign_verify_detached(
      fromBase64(signature),
      signedBytes(unsigned),
      signerPublicKey,
    );
  } catch {
    return false;
  }
}

/** Verifies, then decrypts with the first board key this device holds. */
export function openEnvelope(envelope: Envelope, options: OpenOptions): OpenedEnvelope {
  const sodium = getSodium();
  if (envelope.v !== ENVELOPE_VERSION) {
    throw new CryptoError("unsupported_version", `Unsupported envelope version ${String(envelope.v)}`);
  }
  if (!verifyEnvelope(envelope, options.signerPublicKey)) {
    throw new CryptoError("bad_signature", "Envelope signature is invalid");
  }

  let triedAKey = false;
  for (const board of envelope.boards) {
    const boardKey = options.boardKey(board.boardId, board.keyVersion);
    if (!boardKey) continue;
    triedAKey = true;

    let contentKey: Uint8Array;
    try {
      contentKey = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        fromBase64(board.wrappedKey),
        wrapAad(envelope.id, board.boardId, board.keyVersion),
        fromBase64(board.nonce),
        boardKey,
      );
    } catch {
      // A wrong or stale key for this board; another board may still work.
      continue;
    }

    let plaintext: Uint8Array;
    try {
      plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        fromBase64(envelope.ciphertext),
        contentAad(envelope),
        fromBase64(envelope.nonce),
        contentKey,
      );
    } catch {
      throw new CryptoError("decrypt_failed", "Could not decrypt the envelope payload");
    } finally {
      sodium.memzero(contentKey);
    }

    let payload: JsonValue;
    try {
      payload = JSON.parse(fromUtf8(plaintext)) as JsonValue;
    } catch {
      throw new CryptoError("bad_payload", "Envelope payload is not valid JSON");
    }
    return { envelope, payload, boardId: board.boardId };
  }

  if (triedAKey) {
    throw new CryptoError("decrypt_failed", "Could not unwrap the content key with any held board key");
  }
  throw new CryptoError("no_board_key", "This device holds no key for any of the envelope's boards");
}
