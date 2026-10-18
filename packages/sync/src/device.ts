import { fromBase64, toBase64, type BoardKey, type DeviceKind, type IdentityKeys } from "@map-diary/crypto";

/** An account box keypair as a device stores it. */
export interface StoredAccountBoxKeys {
  version: number;
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/**
 * What a signed-in device keeps on itself. The account signing key is not here: it lives
 * only in the passphrase backup and is needed again only to authorise another device. The
 * account box key is here, because every board key is wrapped to it.
 */
export interface DeviceState {
  v: 2;
  accountId: string;
  deviceId: string;
  kind: DeviceKind;
  identity: IdentityKeys;
  /** The account's box keypair, current version; board keys are wrapped to its public half. */
  accountBox: StoredAccountBoxKeys;
  personalBoardId: string;
  /** Every board key version this device holds. */
  boardKeys: BoardKey[];
  createdAt: number;
}

/** A stored device from an older format (before board keys were wrapped per account) is not usable. */
export function isCurrentDeviceState(value: unknown): value is DeviceState {
  return typeof value === "object" && value !== null && (value as { v?: unknown }).v === 2;
}

/** The newest key this device holds for a board, used for new writes. */
export function currentBoardKey(device: DeviceState, boardId: string): BoardKey | undefined {
  let best: BoardKey | undefined;
  for (const k of device.boardKeys) {
    if (k.boardId === boardId && (!best || k.version > best.version)) best = k;
  }
  return best;
}

export function boardKeyLookup(device: DeviceState): (boardId: string, version: number) => Uint8Array | undefined {
  return (boardId, version) => device.boardKeys.find((k) => k.boardId === boardId && k.version === version)?.key;
}

/**
 * The secret inside the passphrase backup. The recovery seed derives everything else: the
 * account keys, and through the account box key every board key stored on the server.
 */
export interface KeyBundle {
  v: 2;
  recoverySeed: Uint8Array;
  accountId: string;
  personalBoardId: string;
}

interface KeyBundleJson {
  v: 2;
  recoverySeed: string;
  accountId: string;
  personalBoardId: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

export function encodeKeyBundle(bundle: KeyBundle): Uint8Array {
  const json: KeyBundleJson = {
    v: 2,
    recoverySeed: toBase64(bundle.recoverySeed),
    accountId: bundle.accountId,
    personalBoardId: bundle.personalBoardId,
  };
  return encoder.encode(JSON.stringify(json));
}

function isString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** Parses a decrypted bundle; throws on anything that is not exactly a v2 bundle. */
export function decodeKeyBundle(bytes: Uint8Array): KeyBundle {
  const bad = () => new Error("Key backup holds an unrecognised bundle");
  let raw: unknown;
  try {
    raw = JSON.parse(decoder.decode(bytes));
  } catch {
    throw bad();
  }
  if (typeof raw !== "object" || raw === null) throw bad();
  const { v, recoverySeed, accountId, personalBoardId } = raw as Record<string, unknown>;
  if (v !== 2 || !isString(recoverySeed) || !isString(accountId) || !isString(personalBoardId)) throw bad();
  return { v: 2, recoverySeed: fromBase64(recoverySeed), accountId, personalBoardId };
}
