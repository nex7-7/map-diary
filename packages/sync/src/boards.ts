import {
  generateBoardKey,
  linkHashKey,
  randomId,
  ready,
  toBase64,
  wrapKeyForMember,
  type BoardKey,
} from "@map-diary/crypto";
import { ApiError, type Api, type BoardSummary, type Signer, type WrappedBoardKey } from "./api";
import { boardsFrom, currentBoardKey, mergeBoardKeys, openBoardKeys, type BoardInfo, type DeviceState } from "./device";

/**
 * The board key ring: which boards the account is in, every key version this device holds
 * for each, and which version new writes use. The Personal board's keys are derived from the
 * recovery seed; every other board (master now, groups later) has random keys wrapped to each
 * member's account box key on the server, which the ring fetches and unwraps.
 */

function signerOf(device: DeviceState): Signer {
  return { deviceId: device.deviceId, signSecretKey: device.identity.signSecretKey };
}

/**
 * Fetches the account's boards and opens every board key wrapped to this device's current
 * account box key. Collecting a newer account key (after a revocation) is the sync loop's job.
 */
export async function refreshKeyRing(api: Api, device: DeviceState): Promise<DeviceState> {
  await ready();
  const me = await api.me(signerOf(device));
  return {
    ...device,
    boards: boardsFrom(me.boards),
    isAdmin: me.account.isAdmin,
    boardKeys: mergeBoardKeys(device.boardKeys, openBoardKeys(me, device.accountBox)),
  };
}

/** The account's board of a kind (the first, for groups). */
export function boardOfKind(device: DeviceState, kind: BoardInfo["kind"]): BoardInfo | undefined {
  return device.boards?.find((b) => b.kind === kind);
}

/** The master board, once this device has fetched it and holds a key for it. */
export function masterBoardOf(device: DeviceState): BoardInfo | undefined {
  const master = boardOfKind(device, "master");
  return master && writeKey(device, master.id) ? master : undefined;
}

/**
 * The key new writes to a board use: the board's current version. Until this device has
 * collected that version (another device just rotated it), the newest one it holds; the
 * Worker refuses that write as `stale_key` and the sync loop re-seals it once the key is in.
 */
export function writeKey(device: DeviceState, boardId: string): BoardKey | undefined {
  const info = device.boards?.find((b) => b.id === boardId);
  const exact = info && device.boardKeys.find((k) => k.boardId === boardId && k.version === info.keyVersion);
  return exact ?? currentBoardKey(device, boardId);
}

/** Every key version this device holds for a board, oldest first. */
export function boardKeysOf(device: DeviceState, boardId: string): BoardKey[] {
  return device.boardKeys.filter((k) => k.boardId === boardId).sort((a, b) => a.version - b.version);
}

/**
 * True when the Worker reports a board this device has not seen or a key version it does not
 * hold: someone rotated a key, or the account joined a board.
 */
export function keysBehind(device: DeviceState, boards: readonly BoardSummary[]): boolean {
  return boardsFrom(boards).some((b) => {
    const known = device.boards?.find((d) => d.id === b.id);
    return known?.keyVersion !== b.keyVersion || !device.boardKeys.some((k) => k.boardId === b.id && k.version === b.keyVersion);
  });
}

/**
 * Wraps every key version this device holds for a board to another account's box public
 * key, so that person can read the board's whole history. App invites grant the master board
 * this way; group invites will do the same for a group.
 */
export function wrapBoardKeysForAccount(device: DeviceState, boardId: string, accountBoxPublicKey: Uint8Array): WrappedBoardKey[] {
  return boardKeysOf(device, boardId).map((k) => ({
    boardId,
    keyVersion: k.version,
    wrappedKey: toBase64(wrapKeyForMember(k.key, accountBoxPublicKey)),
  }));
}

/** Every master key version, wrapped to a new account's box public key. Throws without the master board. */
export function wrapMasterKeysForAccount(device: DeviceState, accountBoxPublicKey: Uint8Array): WrappedBoardKey[] {
  const master = masterBoardOf(device);
  if (!master) throw new Error("This device has no master board key");
  return wrapBoardKeysForAccount(device, master.id, accountBoxPublicKey);
}

/** Every master key version this device holds, for sealing into an invite. Empty without the master board. */
export function masterKeysOf(device: DeviceState): BoardKey[] {
  const master = boardOfKind(device, "master");
  return master ? boardKeysOf(device, master.id) : [];
}

/** The key for duplicate-link hashes, from the first master key. */
export function linkHashKeyOf(device: DeviceState): Uint8Array | undefined {
  const first = masterKeysOf(device).find((k) => k.version === 1);
  return first ? linkHashKey(first.key) : undefined;
}

/**
 * Creates the master board from the admin's device if it does not exist yet: a random first
 * key, wrapped to the admin's account. Anyone else, or an admin whose account already has it,
 * gets the device back unchanged.
 */
export async function ensureMasterBoard(api: Api, device: DeviceState): Promise<DeviceState> {
  await ready();
  if (!device.isAdmin || boardOfKind(device, "master")) return device;
  const key = generateBoardKey(randomId(), 1);
  try {
    await api.createMasterBoard(
      { id: key.boardId, wrappedKey: toBase64(wrapKeyForMember(key.key, device.accountBox.publicKey)) },
      signerOf(device),
    );
  } catch (err) {
    // Another of the admin's devices created it first: take that one.
    if (err instanceof ApiError && err.code === "master_exists") return refreshKeyRing(api, device);
    throw err;
  }
  return {
    ...device,
    boards: [...(device.boards ?? []), { id: key.boardId, kind: "master", keyVersion: 1 }],
    boardKeys: [...device.boardKeys, key],
  };
}
