"use client";

import {
  connectClaude,
  revokeDevice,
  setPassphrase,
  startPairing,
  type AccountSecret,
  type ConnectedClaude,
  type Diary,
  type OpenPairing,
} from "@map-diary/sync";
import { deviceNames, forgetDeviceName, guessDeviceName, nameDevice } from "./names";
import { adoptDevice, api } from "./session";

export interface ListedDevice {
  id: string;
  kind: string;
  /** The name the person gave it; for this device, a guess from its browser until then. */
  name: string | null;
  createdAt: number;
  lastSeenAt: number | null;
  current: boolean;
}

function signerOf(diary: Diary) {
  return { deviceId: diary.device.deviceId, signSecretKey: diary.device.identity.signSecretKey };
}

export interface AccountOverview {
  /** Devices still signed in. */
  devices: ListedDevice[];
  isAdmin: boolean;
  /** Whether a passphrase backup exists for signing in without another device. */
  hasPassphrase: boolean;
}

/** The account's devices that are still signed in, and what the account has set up. */
export async function listDevices(diary: Diary): Promise<AccountOverview> {
  const [me, names] = await Promise.all([api.me(signerOf(diary)), deviceNames(diary)]);
  const self = diary.device.deviceId;
  // This device names itself once, from its browser, so the others can tell it apart.
  if (!names.has(self)) {
    const guess = guessDeviceName(navigator.userAgent, diary.device.kind);
    names.set(self, guess);
    void nameDevice(diary, self, guess).catch(() => undefined);
  }
  return {
    devices: me.devices
      .filter((d) => d.revokedAt === null)
      .map((d) => ({
        id: d.id,
        kind: d.kind,
        name: names.get(d.id) ?? null,
        createdAt: d.createdAt,
        lastSeenAt: d.lastSeenAt,
        current: d.id === self,
      })),
    isAdmin: me.account.isAdmin,
    hasPassphrase: me.account.hasPassphrase,
  };
}

/** Sets or replaces the passphrase, proven with the recovery phrase. */
export function choosePassphrase(diary: Diary, recoveryPhrase: string, newPassphrase: string): Promise<void> {
  return setPassphrase(api, diary.device, { recoveryPhrase, newPassphrase });
}

/** Opens a pairing so a new device can sign in from this one. */
export function addDevice(diary: Diary): Promise<OpenPairing> {
  return startPairing(api, diary.device, window.location.origin);
}

/**
 * Removes another device from the account. This device moves the account to new keys (from
 * the passphrase or recovery phrase), so the removed one cannot read anything new.
 */
export async function removeDevice(diary: Diary, deviceId: string, secret: AccountSecret): Promise<void> {
  const next = await revokeDevice(api, diary.device, deviceId, secret);
  await adoptDevice(next);
  await forgetDeviceName(diary, deviceId).catch(() => undefined);
}

/** Renames one of the account's devices. Returns the name as saved. */
export function renameDevice(diary: Diary, deviceId: string, name: string): Promise<string> {
  return nameDevice(diary, deviceId, name);
}

/**
 * Connects Claude: a device on this account that holds only the master and Personal keys.
 * Syncs first so the keys it wraps for Claude are the current ones. The returned secret is
 * shown once for the Claude connector; nothing on this device keeps it.
 */
export async function connectClaudeDevice(diary: Diary): Promise<ConnectedClaude> {
  await diary.sync();
  return connectClaude(api, diary.device);
}
