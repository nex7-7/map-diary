"use client";

import { Api, Diary, IdbStorage, type DeviceState } from "@map-diary/sync";
import { clearPending } from "../pending/session";

/**
 * The API Worker's origin. In production the web app and the API share
 * map.snehilsinha.com, so this is empty; for local development set
 * NEXT_PUBLIC_API_ORIGIN=http://localhost:8787 (wrangler dev).
 */
export const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? "";

/** How often the diary syncs while the app is open, besides on focus and on reconnect. */
const SYNC_INTERVAL_MS = 60_000;

export type Session = { state: "signed-out" } | { state: "ready"; diary: Diary };

let storage: Promise<IdbStorage> | null = null;
let current: Promise<Session> | null = null;
let stopTriggers: (() => void) | null = null;

export const api = new Api({ origin: API_ORIGIN });

function openStorage(): Promise<IdbStorage> {
  storage ??= IdbStorage.open();
  return storage;
}

/** Set when this device found out it was removed, so the sign-in screen can say why. */
const REMOVED_KEY = "map-diary:device-removed";

export function wasRemoved(): boolean {
  try {
    return sessionStorage.getItem(REMOVED_KEY) === "1";
  } catch {
    return false;
  }
}

function startDiary(diary: Diary): void {
  // Another device removed this one: its keys are useless now, so forget them and the items.
  const offRevoked = diary.subscribe(() => {
    if (diary.getStatus().error !== "device_revoked") return;
    offRevoked();
    try {
      sessionStorage.setItem(REMOVED_KEY, "1");
    } catch {
      // Private mode: the sign-in screen just won't explain.
    }
    void forgetDevice();
  });
  diary.start(SYNC_INTERVAL_MS);
  const sync = () => void diary.sync();
  const onVisible = () => document.visibilityState === "visible" && sync();
  window.addEventListener("online", sync);
  document.addEventListener("visibilitychange", onVisible);
  stopTriggers = () => {
    offRevoked();
    diary.stop();
    window.removeEventListener("online", sync);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

/** The device's session, loaded once from IndexedDB. Sync starts when a device is found. */
export function getSession(): Promise<Session> {
  current ??= (async (): Promise<Session> => {
    const s = await openStorage();
    const device = await s.loadDevice();
    if (!device) return { state: "signed-out" };
    const diary = new Diary(device, s, api);
    startDiary(diary);
    return { state: "ready", diary };
  })();
  return current;
}

/** Stores a newly set up or signed-in device and starts syncing. */
export async function adoptDevice(device: DeviceState): Promise<Diary> {
  try {
    sessionStorage.removeItem(REMOVED_KEY);
  } catch {
    // Nothing to clear.
  }
  const s = await openStorage();
  await s.saveDevice(device);
  // Ask the browser not to evict keys and items under storage pressure.
  await navigator.storage?.persist?.().catch(() => false);
  stopTriggers?.();
  const diary = new Diary(device, s, api);
  startDiary(diary);
  current = Promise.resolve({ state: "ready", diary });
  notify();
  return diary;
}

/** Forgets this device: its keys and every local item. The account and other devices are unaffected. */
export async function forgetDevice(): Promise<void> {
  stopTriggers?.();
  stopTriggers = null;
  const s = await openStorage();
  await s.clear();
  await clearPending();
  current = Promise.resolve({ state: "signed-out" });
  notify();
}

const sessionListeners = new Set<() => void>();

function notify(): void {
  for (const l of sessionListeners) l();
}

export function onSessionChange(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}
