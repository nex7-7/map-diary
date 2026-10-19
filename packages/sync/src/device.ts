import { fromBase64, toBase64, unwrapKeyFromMember, type BoardKey, type DeviceKind, type IdentityKeys } from "@map-diary/crypto";
import type { BoardSummary, MeResponse } from "./api";

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
  /**
   * The boards the account is in, as last fetched; missing on a device stored before
   * sharing, until its first sync fills it in.
   */
  boards?: BoardInfo[];
  /** Whether the account is the admin, as last fetched. */
  isAdmin?: boolean;
  createdAt: number;
}

export type BoardKind = "master" | "group" | "personal";

/** A board the account is in, at the key version new writes must use. */
export interface BoardInfo {
  id: string;
  kind: BoardKind;
  keyVersion: number;
  /** A member left this group, so a remaining member's device moves it to a new key. */
  rotationDue?: boolean;
  /** A group's members, whose opinions its board shows. */
  memberIds?: string[];
}

const BOARD_KINDS: readonly string[] = ["master", "group", "personal"];

/** The boards in a `/me` or `/sync` response, skipping any kind this version does not know. */
export function boardsFrom(list: readonly BoardSummary[]): BoardInfo[] {
  return list
    .filter((b) => BOARD_KINDS.includes(b.kind))
    .map((b) => ({
      id: b.id,
      kind: b.kind as BoardKind,
      keyVersion: b.keyVersion,
      ...(b.rotationDue ? { rotationDue: true } : {}),
      ...(b.memberIds ? { memberIds: [...b.memberIds] } : {}),
    }));
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
 * Opens the board keys wrapped to this account box key. Wraps made under an older account
 * key version need the recovery seed, which a linked device does not hold; it skips them.
 */
export function openBoardKeys(me: MeResponse, box: StoredAccountBoxKeys): BoardKey[] {
  const keys: BoardKey[] = [];
  for (const board of me.boards) {
    for (const k of board.keys) {
      if (k.accountKeyVersion !== box.version) continue;
      const key = unwrapKeyFromMember(fromBase64(k.wrappedKey), { boxPublicKey: box.publicKey, boxSecretKey: box.secretKey });
      keys.push({ boardId: board.id, version: k.keyVersion, key });
    }
  }
  return keys;
}

/** This device's keys plus `added`, keeping one copy of each board key version. */
export function mergeBoardKeys(held: readonly BoardKey[], added: readonly BoardKey[]): BoardKey[] {
  const out = [...held];
  for (const k of added) {
    if (!out.some((h) => h.boardId === k.boardId && h.version === k.version)) out.push(k);
  }
  return out;
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
