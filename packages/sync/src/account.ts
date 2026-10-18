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
  toBase64,
  wrapKeyForMember,
  type AccountKeys,
  type BoardKey,
  type IdentityKeys,
  type KdfParams,
} from "@map-diary/crypto";
import { ApiError, NetworkError, type Api, type DeviceBody, type KeyBackupBody, type Signer } from "./api";
import { decodeKeyBundle, encodeKeyBundle, type DeviceState, type KeyBundle } from "./device";

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

function deviceBody(accountId: string, deviceId: string, identity: IdentityKeys, account: AccountKeys): DeviceBody {
  const kind = "web" as const;
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
  const personal = account.personalBoardKey(1);
  const identity = generateIdentity();
  const deviceId = randomId();

  const body = {
    account: { id: account.accountId, signPublicKey: toBase64(account.accountKeys.signPublicKey) },
    device: deviceBody(account.accountId, deviceId, identity, account.accountKeys),
    personalBoard: { id: personal.boardId, wrappedKey: toBase64(wrapKeyForMember(personal.key, identity.boxPublicKey)) },
    keyBackup: backupBody(
      { v: 1, recoverySeed: seed, accountId: account.accountId, personalBoardId: personal.boardId, boardKeys: [personal] },
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
      return {
        v: 1,
        accountId: account.accountId,
        deviceId,
        kind: "web",
        identity,
        personalBoardId: personal.boardId,
        boardKeys: [personal],
        createdAt: Date.now(),
      };
    },
  };
}

/**
 * Registers a fresh device on the account, then gives it every board key it can: the server
 * says which boards and versions are current, and `keyFor` supplies the key.
 */
async function registerDevice(
  api: Api,
  accountId: string,
  personalBoardId: string,
  account: AccountKeys,
  keyFor: (boardId: string, version: number) => BoardKey | undefined,
  notFound: SetupErrorCode,
): Promise<DeviceState> {
  const identity = generateIdentity();
  const deviceId = randomId();
  const signer = signerOf(deviceId, identity);
  try {
    await api.registerDevice({ accountId, device: deviceBody(accountId, deviceId, identity, account), boardKeys: [] }, signer);
  } catch (err) {
    throw asSetupError(err, notFound);
  }

  const boardKeys: BoardKey[] = [];
  try {
    const me = await api.me(signer);
    for (const board of me.boards) {
      const key = keyFor(board.id, board.keyVersion);
      if (key) boardKeys.push(key);
    }
    if (boardKeys.length > 0) {
      await api.putBoardKeys(
        boardKeys.map((k) => ({
          boardId: k.boardId,
          keyVersion: k.version,
          wrappedKey: toBase64(wrapKeyForMember(k.key, identity.boxPublicKey)),
        })),
        signer,
      );
    }
  } catch (err) {
    throw asSetupError(err);
  }
  return { v: 1, accountId, deviceId, kind: "web", identity, personalBoardId, boardKeys, createdAt: Date.now() };
}

/** Signs this device in with the passphrase, from the key backup on the server. */
export async function signInWithPassphrase(api: Api, passphrase: string): Promise<DeviceState> {
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
  const account = deriveAccount(bundle.recoverySeed);
  const keyFor = (boardId: string, version: number) =>
    bundle.boardKeys.find((k) => k.boardId === boardId && k.version === version) ??
    (boardId === account.personalBoardId ? account.personalBoardKey(version) : undefined);
  return registerDevice(api, bundle.accountId, bundle.personalBoardId, account.accountKeys, keyFor, "wrong_passphrase");
}

export interface RecoveryOptions {
  recoveryPhrase: string;
  /** Replaces the forgotten passphrase. */
  newPassphrase: string;
  kdf?: KdfParams;
}

/**
 * Signs this device in with the recovery phrase and replaces the key backup under a new
 * passphrase. The new backup holds only what the phrase can derive (the account and the
 * personal board); keys for shared boards are granted again by their members.
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
  const keyFor = (boardId: string, version: number) =>
    boardId === account.personalBoardId ? account.personalBoardKey(version) : undefined;
  const device = await registerDevice(
    api,
    account.accountId,
    account.personalBoardId,
    account.accountKeys,
    keyFor,
    "unknown_recovery_phrase",
  );

  const bundle: KeyBundle = {
    v: 1,
    recoverySeed: seed,
    accountId: account.accountId,
    personalBoardId: account.personalBoardId,
    boardKeys: device.boardKeys,
  };
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
