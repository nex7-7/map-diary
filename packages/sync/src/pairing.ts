import {
  authorizeDevice,
  fromBase64,
  generateIdentity,
  generatePairingSecret,
  normalisePairingSecret,
  openAccountTransfer,
  pairingCode,
  pairingId,
  pairingJoinMac,
  randomId,
  ready,
  sealAccountTransfer,
  toBase64,
  unwrapKeyFromMember,
  verifyPairingJoinMac,
  type BoardKey,
  type DeviceKind,
  type IdentityKeys,
  type PairingJoin,
} from "@map-diary/crypto";
import { ApiError, NetworkError, type Api, type MeResponse, type Signer } from "./api";
import type { DeviceState, StoredAccountBoxKeys } from "./device";

/** The path the old device's link opens; the secret follows the `#`. */
export const LINK_PATH = "/link";

export type PairingErrorCode = "bad_code" | "expired" | "tampered" | "offline" | "server";

/** A pairing failure the screens can explain. Never carries the secret. */
export class PairingError extends Error {
  readonly code: PairingErrorCode;

  constructor(code: PairingErrorCode) {
    super(code);
    this.name = "PairingError";
    this.code = code;
  }
}

function asPairingError(err: unknown): PairingError {
  if (err instanceof PairingError) return err;
  if (err instanceof NetworkError) return new PairingError("offline");
  if (err instanceof ApiError && err.status === 404) return new PairingError("expired");
  return new PairingError("server");
}

function signerOf(device: { deviceId: string; identity: IdentityKeys }): Signer {
  return { deviceId: device.deviceId, signSecretKey: device.identity.signSecretKey };
}

/** What the old device sees while it waits. */
export type PairingCheck =
  | { state: "waiting" }
  | { state: "joined"; code: string; kind: DeviceKind }
  | { state: "approved" };

/** A pairing opened on a signed-in device, waiting for the new device to scan its link. */
export interface OpenPairing {
  /** The link to show as a QR code; the secret is after the `#`. */
  link: string;
  /** The same secret for typing on the new device, for example `7K3QM-9XT2B`. */
  secret: string;
  expiresAt: number;
  /** Polls the Worker. Once joined, `code` is what the new device should be showing. */
  check(): Promise<PairingCheck>;
  /** Registers the new device and hands it the account keys. Only after the codes match. */
  approve(): Promise<void>;
  /** Withdraws the pairing; does nothing once approved. */
  cancel(): Promise<void>;
}

/** Opens a pairing on this (signed-in) device. `origin` is the site the link points at. */
export async function startPairing(api: Api, device: DeviceState, origin: string): Promise<OpenPairing> {
  await ready();
  const secret = generatePairingSecret();
  const id = pairingId(secret);
  const signer = signerOf(device);
  let expiresAt: number;
  try {
    ({ expiresAt } = await api.openPairing(id, signer));
  } catch (err) {
    throw asPairingError(err);
  }
  let joined: PairingJoin | null = null;
  let approved = false;

  return {
    link: `${origin.replace(/\/$/, "")}${LINK_PATH}#${secret}`,
    secret,
    expiresAt,
    async check() {
      let view;
      try {
        view = await api.readPairing(id, signer);
      } catch (err) {
        throw asPairingError(err);
      }
      if (view.state === "waiting" || !view.device || !view.mac) return { state: "waiting" };
      const join: PairingJoin = {
        deviceId: view.device.id,
        kind: view.device.kind,
        signPublicKey: fromBase64(view.device.signPublicKey),
        boxPublicKey: fromBase64(view.device.boxPublicKey),
      };
      // Keys the link holder did not send (for example swapped in by the server) are refused.
      if (!verifyPairingJoinMac(secret, join, view.mac)) {
        await api.cancelPairing(id, signer).catch(() => undefined);
        throw new PairingError("tampered");
      }
      joined = join;
      if (view.state === "approved") return { state: "approved" };
      return { state: "joined", code: pairingCode(secret, join), kind: join.kind };
    },
    async approve() {
      if (!joined) throw new PairingError("server");
      const authorization = authorizeDevice(
        {
          accountId: device.accountId,
          deviceId: joined.deviceId,
          kind: joined.kind,
          signPublicKey: joined.signPublicKey,
          boxPublicKey: joined.boxPublicKey,
        },
        device.identity.signSecretKey,
      );
      const sealedTransfer = sealAccountTransfer(
        { accountId: device.accountId, personalBoardId: device.personalBoardId, accountBox: device.accountBox },
        joined.boxPublicKey,
      );
      try {
        await api.approvePairing(id, { authorization, sealedTransfer }, signer);
      } catch (err) {
        throw asPairingError(err);
      }
      approved = true;
    },
    async cancel() {
      // Once approved, the new device still has to collect its keys; the Worker removes the pairing then.
      if (approved) return;
      await api.cancelPairing(id, signer).catch(() => undefined);
    },
  };
}

/** A new device that has offered its keys and waits for the old device's approval. */
export interface JoiningDevice {
  /** Show this; the person checks it matches the old device's screen. */
  code: string;
  /** Polls until approved, then returns the signed-in device state to store; null while waiting. */
  check(): Promise<DeviceState | null>;
}

/** Joins a pairing from the secret, typed or taken from the link (everything after the `#`). */
export async function joinPairing(api: Api, typed: string, kind: DeviceKind = "web"): Promise<JoiningDevice> {
  await ready();
  const secret = normalisePairingSecret(typed);
  if (!secret) throw new PairingError("bad_code");
  const id = pairingId(secret);
  const identity = generateIdentity();
  const deviceId = randomId();
  const join: PairingJoin = { deviceId, kind, signPublicKey: identity.signPublicKey, boxPublicKey: identity.boxPublicKey };
  try {
    await api.joinPairing(id, {
      device: { id: deviceId, kind, signPublicKey: toBase64(identity.signPublicKey), boxPublicKey: toBase64(identity.boxPublicKey) },
      mac: pairingJoinMac(secret, join),
    });
  } catch (err) {
    throw asPairingError(err);
  }

  return {
    code: pairingCode(secret, join),
    async check() {
      try {
        const { state } = await api.pairingStatus(id);
        if (state !== "approved") return null;
        const signer = { deviceId, signSecretKey: identity.signSecretKey };
        const { sealedTransfer } = await api.collectPairing(id, signer);
        const transfer = openAccountTransfer(sealedTransfer, identity);
        const me = await api.me(signer);
        return {
          v: 2,
          accountId: transfer.accountId,
          deviceId,
          kind,
          identity,
          accountBox: transfer.accountBox,
          personalBoardId: transfer.personalBoardId,
          boardKeys: openBoardKeys(me, transfer.accountBox),
          createdAt: Date.now(),
        };
      } catch (err) {
        throw asPairingError(err);
      }
    },
  };
}

/**
 * Opens the board keys wrapped to this account box key. Wraps made under an older account
 * key version need the recovery seed, which a linked device does not hold; it skips them.
 */
function openBoardKeys(me: MeResponse, box: StoredAccountBoxKeys): BoardKey[] {
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
