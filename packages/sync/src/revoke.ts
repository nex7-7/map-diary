import {
  CryptoError,
  backupLookupId,
  deriveAccount,
  fromBase64,
  openKeyBackup,
  parseRecoveryPhrase,
  ready,
  generateBoardKey,
  sealAccountTransfer,
  signAccountBoxKey,
  toBase64,
  unwrapKeyFromMember,
  wrapKeyForMember,
  type BoardKey,
} from "@map-diary/crypto";
import { ApiError, NetworkError, type Api, type MeResponse, type MemberBoardKey, type WrappedBoardKey } from "./api";
import { boardsFrom, decodeKeyBundle, type DeviceState, type StoredAccountBoxKeys } from "./device";

export type RevokeErrorCode =
  | "wrong_passphrase"
  | "invalid_recovery_phrase"
  | "wrong_account"
  | "stale"
  | "offline"
  | "server";

/** A revocation failure the screens can explain. Never carries the passphrase or phrase. */
export class RevokeError extends Error {
  readonly code: RevokeErrorCode;

  constructor(code: RevokeErrorCode) {
    super(code);
    this.name = "RevokeError";
    this.code = code;
  }
}

function asRevokeError(err: unknown): RevokeError {
  if (err instanceof RevokeError) return err;
  if (err instanceof NetworkError) return new RevokeError("offline");
  if (err instanceof ApiError && err.status === 409) return new RevokeError("stale");
  return new RevokeError("server");
}

/** What proves the person is the account owner: the passphrase or the recovery phrase. */
export type AccountSecret = { passphrase: string } | { recoveryPhrase: string };

/**
 * The recovery seed, from the passphrase backup or the recovery phrase. New account keys
 * are derived from it, so a device that never held the seed (a revoked one) cannot follow.
 */
async function recoverSeed(api: Api, secret: AccountSecret): Promise<Uint8Array> {
  if ("recoveryPhrase" in secret) {
    try {
      return parseRecoveryPhrase(secret.recoveryPhrase);
    } catch {
      throw new RevokeError("invalid_recovery_phrase");
    }
  }
  if (secret.passphrase.length === 0) throw new RevokeError("wrong_passphrase");
  try {
    const { backup } = await api.fetchKeyBackup(backupLookupId(secret.passphrase));
    return decodeKeyBundle(openKeyBackup(backup, secret.passphrase)).recoverySeed;
  } catch (err) {
    if (err instanceof CryptoError && err.code === "bad_backup") throw new RevokeError("wrong_passphrase");
    if (err instanceof ApiError && err.status === 404) throw new RevokeError("wrong_passphrase");
    throw asRevokeError(err);
  }
}

/**
 * Revokes another device of this account. From the recovery seed this device derives the
 * next account box key and the next Personal board key, re-wraps every board key the account
 * holds to the new account key, and seals the new account key to each remaining device. Every
 * shared board the account is in (the master board, later groups) gets a fresh random key,
 * wrapped to the new account key and to every other member's account key, so the revoked
 * device cannot read anything shared from now on either. The Worker applies all of it with the
 * revocation in one step. Returns this device's new state to store; other devices and other
 * members collect their copies on their next sync.
 */
export async function revokeDevice(
  api: Api,
  device: DeviceState,
  targetDeviceId: string,
  secret: AccountSecret,
): Promise<DeviceState> {
  await ready();
  const seed = await recoverSeed(api, secret);
  const account = deriveAccount(seed);
  if (account.accountId !== device.accountId) throw new RevokeError("wrong_account");

  const signer = { deviceId: device.deviceId, signSecretKey: device.identity.signSecretKey };
  let me: MeResponse;
  try {
    me = await api.me(signer);
  } catch (err) {
    throw asRevokeError(err);
  }

  const version = me.account.boxKeyVersion + 1;
  const newBox: StoredAccountBoxKeys = account.accountBoxKeys(version);

  // Every board key version the account holds, opened with the account key it is wrapped to.
  const boxes = new Map<number, StoredAccountBoxKeys>();
  const boxAt = (v: number): StoredAccountBoxKeys => {
    let box = boxes.get(v);
    if (!box) {
      box = account.accountBoxKeys(v);
      boxes.set(v, box);
    }
    return box;
  };
  const boardKeys: BoardKey[] = [];
  for (const board of me.boards) {
    for (const k of board.keys) {
      const box = boxAt(k.accountKeyVersion);
      const key = unwrapKeyFromMember(fromBase64(k.wrappedKey), { boxPublicKey: box.publicKey, boxSecretKey: box.secretKey });
      boardKeys.push({ boardId: board.id, version: k.keyVersion, key });
    }
  }
  // The Personal board moves on one version, so the revoked device cannot read new items.
  const personal = me.boards.find((b) => b.id === account.personalBoardId);
  if (personal) boardKeys.push(account.personalBoardKey(personal.keyVersion + 1));

  // Shared boards move to a fresh random key that every member gets.
  const memberKeys: MemberBoardKey[] = [];
  for (const board of me.boards) {
    if (board.id === account.personalBoardId || board.kind === "personal") continue;
    const next = generateBoardKey(board.id, board.keyVersion + 1);
    boardKeys.push(next);
    let members;
    try {
      ({ members } = await api.boardMembers(board.id, signer));
    } catch (err) {
      throw asRevokeError(err);
    }
    for (const m of members) {
      if (m.accountId === account.accountId) continue;
      memberKeys.push({
        boardId: board.id,
        keyVersion: next.version,
        accountId: m.accountId,
        accountKeyVersion: m.boxKeyVersion,
        wrappedKey: toBase64(wrapKeyForMember(next.key, fromBase64(m.boxPublicKey))),
      });
    }
  }

  const wrapped: WrappedBoardKey[] = boardKeys.map((k) => ({
    boardId: k.boardId,
    keyVersion: k.version,
    wrappedKey: toBase64(wrapKeyForMember(k.key, newBox.publicKey)),
  }));
  const transfer = { accountId: account.accountId, personalBoardId: account.personalBoardId, accountBox: newBox };
  // A Claude device never holds the account key; this or another device wraps it the new
  // master and Personal keys on its next sync.
  const deviceKeys = me.devices
    .filter((d) => d.revokedAt === null && d.id !== targetDeviceId && d.kind !== "claude")
    .map((d) => ({ deviceId: d.id, sealedKey: sealAccountTransfer(transfer, fromBase64(d.boxPublicKey)) }));

  try {
    await api.revokeDevice(
      targetDeviceId,
      {
        boxPublicKey: toBase64(newBox.publicKey),
        boxKeyVersion: version,
        boxKeySignature: signAccountBoxKey(
          { accountId: account.accountId, version, boxPublicKey: newBox.publicKey },
          account.accountKeys.signSecretKey,
        ),
        boardKeys: wrapped,
        deviceKeys,
        memberKeys,
      },
      signer,
    );
  } catch (err) {
    throw asRevokeError(err);
  }
  const boards = boardsFrom(me.boards).map((b) => ({ ...b, keyVersion: b.keyVersion + 1 }));
  return { ...device, accountBox: newBox, boardKeys, boards, isAdmin: me.account.isAdmin };
}
