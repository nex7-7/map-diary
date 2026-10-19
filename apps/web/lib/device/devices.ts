"use client";

import { revokeDevice, startPairing, type AccountSecret, type Diary, type OpenPairing } from "@map-diary/sync";
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

/** The account's devices that are still signed in. */
export async function listDevices(diary: Diary): Promise<ListedDevice[]> {
  const me = await api.me(signerOf(diary));
  return me.devices
    .filter((d) => d.revokedAt === null)
    .map((d) => ({ id: d.id, kind: d.kind, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt, current: d.id === diary.device.deviceId }));
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
