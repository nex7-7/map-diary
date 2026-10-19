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
import { adoptDevice, api } from "./session";

export interface ListedDevice {
  id: string;
  kind: string;
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
  const me = await api.me(signerOf(diary));
  return {
    devices: me.devices
      .filter((d) => d.revokedAt === null)
      .map((d) => ({ id: d.id, kind: d.kind, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt, current: d.id === diary.device.deviceId })),
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
