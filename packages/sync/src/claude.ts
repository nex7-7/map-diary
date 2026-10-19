import {
  authorizeDevice,
  connectorSecretHash,
  generateConnectorSecret,
  generateIdentity,
  randomId,
  ready,
  sealClaudeDeviceKeys,
  toBase64,
  wrapKeyForMember,
  fromBase64,
  type BoardKey,
} from "@map-diary/crypto";
import { ApiError, NetworkError, type Api, type MeResponse, type Signer, type WrappedBoardKey } from "./api";
import type { DeviceState } from "./device";

/**
 * The Claude assistant is a device of kind `claude` on the owner's account. It never gets
 * the account key (that opens every board the person is in, groups included); instead this
 * device wraps the master and Personal board keys, every version, straight to the Claude
 * device's own key, so group boards stay out of its reach.
 */

export type ClaudeErrorCode = "already_connected" | "stale" | "offline" | "server";

/** A Connect Claude failure the Devices screen can explain. Never carries the secret. */
export class ClaudeError extends Error {
  readonly code: ClaudeErrorCode;

  constructor(code: ClaudeErrorCode) {
    super(code);
    this.name = "ClaudeError";
    this.code = code;
  }
}

function signerOf(device: DeviceState): Signer {
  return { deviceId: device.deviceId, signSecretKey: device.identity.signSecretKey };
}

/** The keys a Claude device may hold: the master and Personal boards' only. */
function claudeKeysOf(device: DeviceState): BoardKey[] {
  const allowed = new Set(
    (device.boards ?? []).filter((b) => b.kind === "master" || b.kind === "personal").map((b) => b.id),
  );
  allowed.add(device.personalBoardId);
  return device.boardKeys.filter((k) => allowed.has(k.boardId));
}

function wrapFor(keys: readonly BoardKey[], boxPublicKey: Uint8Array): WrappedBoardKey[] {
  return keys.map((k) => ({ boardId: k.boardId, keyVersion: k.version, wrappedKey: toBase64(wrapKeyForMember(k.key, boxPublicKey)) }));
}

/** A freshly connected Claude device and the secret the connector needs. */
export interface ConnectedClaude {
  deviceId: string;
  /** Shown once and pasted into the Claude connector; nothing keeps it. */
  connectorSecret: string;
}

/**
 * Connects Claude from this device: makes the Claude device's keys, authorises them with
 * this device's key, seals them under a new connector secret and wraps every master and
 * Personal key version to the Claude device. The Worker gets the sealed keys and a hash of
 * the secret; the secret is returned once for the person to copy into the connector. Pass a
 * device whose key ring is up to date (after a sync), or the Worker answers `stale`.
 */
export async function connectClaude(api: Api, device: DeviceState): Promise<ConnectedClaude> {
  await ready();
  const deviceId = randomId();
  const identity = generateIdentity();
  const connectorSecret = generateConnectorSecret();
  const sealed = sealClaudeDeviceKeys(deviceId, identity, connectorSecret);
  const authorization = authorizeDevice(
    {
      accountId: device.accountId,
      deviceId,
      kind: "claude",
      signPublicKey: identity.signPublicKey,
      boxPublicKey: identity.boxPublicKey,
    },
    device.identity.signSecretKey,
  );
  try {
    await api.connectClaude(
      {
        device: {
          id: deviceId,
          signPublicKey: toBase64(identity.signPublicKey),
          boxPublicKey: toBase64(identity.boxPublicKey),
          authorization,
        },
        connector: { secretHash: toBase64(connectorSecretHash(connectorSecret)), ...sealed },
        boardKeys: wrapFor(claudeKeysOf(device), identity.boxPublicKey),
      },
      signerOf(device),
    );
  } catch (err) {
    if (err instanceof NetworkError) throw new ClaudeError("offline");
    if (err instanceof ApiError && err.code === "claude_connected") throw new ClaudeError("already_connected");
    if (err instanceof ApiError && err.code === "stale") throw new ClaudeError("stale");
    throw new ClaudeError("server");
  }
  return { deviceId, connectorSecret };
}

/**
 * Wraps to each of the account's Claude devices the master and Personal key versions it does
 * not hold yet (a revocation or a member removal rotated them). Runs whenever this device
 * refreshes its key ring; does nothing when Claude is up to date or not connected.
 */
export async function topUpClaudeKeys(api: Api, device: DeviceState, me: MeResponse): Promise<void> {
  const keys = claudeKeysOf(device);
  for (const d of me.devices) {
    if (d.kind !== "claude" || d.revokedAt !== null || d.id === device.deviceId) continue;
    const held = new Set((d.boardKeys ?? []).map((k) => `${k.boardId}\u0000${k.keyVersion}`));
    const missing = keys.filter((k) => !held.has(`${k.boardId}\u0000${k.version}`));
    if (missing.length === 0) continue;
    await api.putClaudeBoardKeys(d.id, wrapFor(missing, fromBase64(d.boxPublicKey)), signerOf(device));
  }
}
