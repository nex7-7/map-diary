import { fromBase64, toBase64, type BoardKey, type IdentityKeys } from "@map-diary/crypto";

/**
 * What a signed-in device keeps on itself. The account key is not here: it lives only in
 * the passphrase backup and is needed again only to authorise another device.
 */
export interface DeviceState {
  v: 1;
  accountId: string;
  deviceId: string;
  kind: "web";
  identity: IdentityKeys;
  personalBoardId: string;
  /** Every board key version this device holds. */
  boardKeys: BoardKey[];
  createdAt: number;
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
 * The secret inside the passphrase backup. The recovery seed derives the account key and the
 * personal board key; `boardKeys` also carries keys that cannot be derived (master and group
 * keys, from Phase 4).
 */
export interface KeyBundle {
  v: 1;
  recoverySeed: Uint8Array;
  accountId: string;
  personalBoardId: string;
  boardKeys: BoardKey[];
}

interface KeyBundleJson {
  v: 1;
  recoverySeed: string;
  accountId: string;
  personalBoardId: string;
  boardKeys: { boardId: string; version: number; key: string }[];
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

export function encodeKeyBundle(bundle: KeyBundle): Uint8Array {
  const json: KeyBundleJson = {
    v: 1,
    recoverySeed: toBase64(bundle.recoverySeed),
    accountId: bundle.accountId,
    personalBoardId: bundle.personalBoardId,
    boardKeys: bundle.boardKeys.map((k) => ({ boardId: k.boardId, version: k.version, key: toBase64(k.key) })),
  };
  return encoder.encode(JSON.stringify(json));
}

function isString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** Parses a decrypted bundle; throws on anything that is not exactly a v1 bundle. */
export function decodeKeyBundle(bytes: Uint8Array): KeyBundle {
  const bad = () => new Error("Key backup holds an unrecognised bundle");
  let raw: unknown;
  try {
    raw = JSON.parse(decoder.decode(bytes));
  } catch {
    throw bad();
  }
  if (typeof raw !== "object" || raw === null) throw bad();
  const { v, recoverySeed, accountId, personalBoardId, boardKeys } = raw as Record<string, unknown>;
  if (v !== 1 || !isString(recoverySeed) || !isString(accountId) || !isString(personalBoardId)) throw bad();
  if (!Array.isArray(boardKeys)) throw bad();
  const keys: BoardKey[] = boardKeys.map((k: unknown) => {
    if (typeof k !== "object" || k === null) throw bad();
    const { boardId, version, key } = k as Record<string, unknown>;
    if (!isString(boardId) || typeof version !== "number" || !Number.isSafeInteger(version) || version < 1 || !isString(key)) {
      throw bad();
    }
    return { boardId, version, key: fromBase64(key) };
  });
  return { v: 1, recoverySeed: fromBase64(recoverySeed), accountId, personalBoardId, boardKeys: keys };
}
