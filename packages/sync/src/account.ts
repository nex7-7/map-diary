import {
  CryptoError,
  authorizeDevice,
  backupLookupId,
  createKeyBackup,
  defaultKdfParams,
  deriveAccount,
  generateIdentity,
  generateRecoveryPhrase,
  openKeyBackup,
  parseRecoveryPhrase,
  randomId,
  ready,
  fromBase64,
  toBase64,
  unwrapKeyFromMember,
  wrapKeyForMember,
  type AccountKeys,
  type BoardKey,
  type DeviceKind,
  type RecoveredAccount,
  type IdentityKeys,
  type KdfParams,
} from "@map-diary/crypto";
import { ApiError, NetworkError, type Api, type DeviceBody, type KeyBackupBody, type Signer } from "./api";
import { ensureMasterBoard } from "./boards";
import { boardsFrom, decodeKeyBundle, encodeKeyBundle, type DeviceState, type KeyBundle, type StoredAccountBoxKeys } from "./device";

export const PASSPHRASE_MIN_LENGTH = 12;

export type SetupErrorCode =
  | "passphrase_too_short"
  | "wrong_passphrase"
  | "invalid_recovery_phrase"
  | "unknown_recovery_phrase"
  | "registration_closed"
  | "passphrase_in_use"
  | "offline"
  | "server";

/** A setup or sign-in failure the screens can explain. Never carries the passphrase. */
export class SetupError extends Error {
  readonly code: SetupErrorCode;

  constructor(code: SetupErrorCode) {
    super(code);
    this.name = "SetupError";
    this.code = code;
  }
}

function asSetupError(err: unknown, notFound: SetupErrorCode = "server"): SetupError {
  if (err instanceof SetupError) return err;
  if (err instanceof NetworkError) return new SetupError("offline");
  if (err instanceof ApiError) {
    if (err.code === "registration_closed") return new SetupError("registration_closed");
    if (err.code === "lookup_taken") return new SetupError("passphrase_in_use");
    if (err.status === 404 || err.status === 403) return new SetupError(notFound);
  }
  return new SetupError("server");
}

export function checkPassphrase(passphrase: string): void {
  if ([...passphrase.normalize("NFKC")].length < PASSPHRASE_MIN_LENGTH) {
    throw new SetupError("passphrase_too_short");
  }
}

function signerOf(deviceId: string, identity: IdentityKeys): Signer {
  return { deviceId, signSecretKey: identity.signSecretKey };
}

function deviceBody(
  accountId: string,
  deviceId: string,
  kind: DeviceKind,
  identity: IdentityKeys,
  account: AccountKeys,
): DeviceBody {
  return {
    id: deviceId,
    kind,
    signPublicKey: toBase64(identity.signPublicKey),
    boxPublicKey: toBase64(identity.boxPublicKey),
    authorization: authorizeDevice(
      { accountId, deviceId, kind, signPublicKey: identity.signPublicKey, boxPublicKey: identity.boxPublicKey },
      account.signSecretKey,
    ),
  };
}

function backupBody(bundle: KeyBundle, passphrase: string, kdf: KdfParams): KeyBackupBody {
  return {
    lookup: backupLookupId(passphrase),
    backup: createKeyBackup(encodeKeyBundle(bundle), passphrase, kdf),
  };
}

export interface SetupOptions {
  passphrase: string;
  /** What this device is; defaults to `web`. */
  kind?: DeviceKind;
  /** Argon2id cost; only tests lower it. */
  kdf?: KdfParams;
}

/** A first-run setup with all keys made, waiting for the person to note the recovery phrase. */
export interface PreparedSetup {
  /** Shown once. It signs a new device in if the passphrase is forgotten. */
  recoveryPhrase: string;
  /** Creates the account on the server and returns this device's state to store. */
  complete(api: Api): Promise<DeviceState>;
}

/**
 * First-run setup, part one: generates the recovery seed and every key, and seals the key
 * backup under the passphrase. Nothing is sent until `complete`, so the phrase can be shown
 * and confirmed first.
 */
export async function prepareSetup(options: SetupOptions): Promise<PreparedSetup> {
  await ready();
  checkPassphrase(options.passphrase);
  const kdf = options.kdf ?? defaultKdfParams();
  const { seed, phrase } = generateRecoveryPhrase();
  const account = deriveAccount(seed);
  const accountBox = account.accountBoxKeys(1);
  const personal = account.personalBoardKey(1);
  const identity = generateIdentity();
  const deviceId = randomId();
  const kind = options.kind ?? "web";

  const body = {
    account: {
      id: account.accountId,
      signPublicKey: toBase64(account.accountKeys.signPublicKey),
      boxPublicKey: toBase64(accountBox.publicKey),
    },
    device: deviceBody(account.accountId, deviceId, kind, identity, account.accountKeys),
    personalBoard: { id: personal.boardId, wrappedKey: toBase64(wrapKeyForMember(personal.key, accountBox.publicKey)) },
    keyBackup: backupBody(
      { v: 2, recoverySeed: seed, accountId: account.accountId, personalBoardId: personal.boardId },
      options.passphrase,
      kdf,
    ),
  };

  return {
    recoveryPhrase: phrase,
    async complete(api) {
      try {
        await api.createAccount(body, signerOf(deviceId, identity));
      } catch (err) {
        throw asSetupError(err);
      }
      // The first account is the admin: it creates the master board straight away. If that
      // call fails, the diary's first sync tries again.
      const device: DeviceState = {
        v: 2,
        accountId: account.accountId,
        deviceId,
        kind,
        identity,
        accountBox,
        personalBoardId: personal.boardId,
        boardKeys: [personal],
        boards: [{ id: personal.boardId, kind: "personal", keyVersion: 1 }],
        isAdmin: true,
        createdAt: Date.now(),
      };
      return ensureMasterBoard(api, device).catch(() => device);
    },
  };
}

/**
 * Registers a fresh device on the account, then opens every board key the account holds.
 * Board keys are wrapped to the account's box key, which the recovery seed derives at every
 * version, so the device needs nothing but the seed.
 */
async function registerDevice(
  api: Api,
  account: RecoveredAccount,
  kind: DeviceKind,
  notFound: SetupErrorCode,
): Promise<DeviceState> {
  const identity = generateIdentity();
  const deviceId = randomId();
  const signer = signerOf(deviceId, identity);
  try {
    const device = deviceBody(account.accountId, deviceId, kind, identity, account.accountKeys);
    await api.registerDevice({ accountId: account.accountId, device }, signer);
  } catch (err) {
    throw asSetupError(err, notFound);
  }

  let accountBox: StoredAccountBoxKeys;
  const boardKeys: BoardKey[] = [];
  let me: Awaited<ReturnType<Api["me"]>>;
  try {
    me = await api.me(signer);
    accountBox = account.accountBoxKeys(me.account.boxKeyVersion);
    const boxes = new Map<number, StoredAccountBoxKeys>([[accountBox.version, accountBox]]);
    for (const board of me.boards) {
      for (const k of board.keys) {
        let box = boxes.get(k.accountKeyVersion);
        if (!box) {
          box = account.accountBoxKeys(k.accountKeyVersion);
          boxes.set(box.version, box);
        }
        const key = unwrapKeyFromMember(fromBase64(k.wrappedKey), { boxPublicKey: box.publicKey, boxSecretKey: box.secretKey });
        boardKeys.push({ boardId: board.id, version: k.keyVersion, key });
      }
    }
  } catch (err) {
    throw asSetupError(err);
  }
  // The personal board key is also derivable, in case its wrapped copy is missing.
  if (!boardKeys.some((k) => k.boardId === account.personalBoardId)) boardKeys.push(account.personalBoardKey(1));
  return {
    v: 2,
    accountId: account.accountId,
    deviceId,
    kind,
    identity,
    accountBox,
    personalBoardId: account.personalBoardId,
    boardKeys,
    boards: boardsFrom(me.boards),
    isAdmin: me.account.isAdmin,
    createdAt: Date.now(),
  };
}

/** Signs this device in with the passphrase, from the key backup on the server. */
export async function signInWithPassphrase(api: Api, passphrase: string, kind: DeviceKind = "web"): Promise<DeviceState> {
  await ready();
  if (passphrase.length === 0) throw new SetupError("wrong_passphrase");
  let bundle: KeyBundle;
  try {
    const { backup } = await api.fetchKeyBackup(backupLookupId(passphrase));
    bundle = decodeKeyBundle(openKeyBackup(backup, passphrase));
  } catch (err) {
    if (err instanceof CryptoError && err.code === "bad_backup") throw new SetupError("wrong_passphrase");
    throw asSetupError(err, "wrong_passphrase");
  }
  return registerDevice(api, deriveAccount(bundle.recoverySeed), kind, "wrong_passphrase");
}

export interface RecoveryOptions {
  recoveryPhrase: string;
  /** Replaces the forgotten passphrase. */
  newPassphrase: string;
  /** What this device is; defaults to `web`. */
  kind?: DeviceKind;
  kdf?: KdfParams;
}

/**
 * Signs this device in with the recovery phrase and replaces the key backup under a new
 * passphrase. The phrase derives the account box key, so every board comes back.
 */
export async function signInWithRecoveryPhrase(api: Api, options: RecoveryOptions): Promise<DeviceState> {
  await ready();
  checkPassphrase(options.newPassphrase);
  let seed: Uint8Array;
  try {
    seed = parseRecoveryPhrase(options.recoveryPhrase);
  } catch {
    throw new SetupError("invalid_recovery_phrase");
  }
  const account = deriveAccount(seed);
  const device = await registerDevice(api, account, options.kind ?? "web", "unknown_recovery_phrase");

  const bundle: KeyBundle = { v: 2, recoverySeed: seed, accountId: account.accountId, personalBoardId: account.personalBoardId };
  try {
    await api.putKeyBackup(
      backupBody(bundle, options.newPassphrase, options.kdf ?? defaultKdfParams()),
      signerOf(device.deviceId, device.identity),
    );
  } catch (err) {
    throw asSetupError(err);
  }
  return device;
}
