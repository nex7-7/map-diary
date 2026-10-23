import type { DiaryWriter } from "../entries/actions";
import type { StoredItem } from "../places/items-source";
import { cleanDeviceName, readPayload } from "../places/payloads";

/**
 * Names for the account's devices. Each name is an item on the Personal board, so the server
 * only sees that one exists; the newest name for a device wins.
 */

/** The parts of the diary these need: reading the person's items, writing and removing them. */
export type NameStore = Pick<DiaryWriter, "device" | "listItems" | "write" | "remove">;

function nameItems(items: readonly StoredItem[], accountId: string): Map<string, StoredItem[]> {
  const byDevice = new Map<string, StoredItem[]>();
  for (const item of items) {
    if (item.type !== "device_name" || item.authorId !== accountId) continue;
    const p = readPayload("device_name", item.payload);
    if (!p) continue;
    byDevice.set(p.deviceId, [...(byDevice.get(p.deviceId) ?? []), item]);
  }
  for (const list of byDevice.values()) list.sort((a, b) => b.updatedAt - a.updatedAt);
  return byDevice;
}

/** Device id → the name the person gave it. */
export async function deviceNames(store: NameStore): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const [id, [latest]] of nameItems(await store.listItems(), store.device.accountId)) {
    const name = latest && readPayload("device_name", latest.payload)?.name;
    if (name) names.set(id, name);
  }
  return names;
}

/** Names a device, replacing any name it had. Returns the cleaned name. */
export async function nameDevice(store: NameStore, deviceId: string, name: string): Promise<string> {
  const clean = cleanDeviceName(name);
  if (!clean) throw new Error("A device name needs at least one letter");
  const [latest, ...extra] = nameItems(await store.listItems(), store.device.accountId).get(deviceId) ?? [];
  await store.write({ type: "device_name", placeId: null, payload: { deviceId, name: clean }, ...(latest ? { id: latest.id } : {}) });
  for (const item of extra) await store.remove(item.id);
  return clean;
}

/**
 * Gives this device its first name, guessed from its browser, unless it already has one. Runs
 * whenever the diary opens, so the account's other devices can tell it apart without this
 * device ever visiting the Devices screen.
 */
export async function nameThisDevice(store: NameStore & { readonly device: { readonly deviceId: string; readonly kind: string } }, userAgent: string): Promise<string | null> {
  const { deviceId, kind } = store.device;
  if ((await deviceNames(store)).has(deviceId)) return null;
  return nameDevice(store, deviceId, guessDeviceName(userAgent, kind));
}

/** Drops a removed device's name. */
export async function forgetDeviceName(store: NameStore, deviceId: string): Promise<void> {
  for (const item of nameItems(await store.listItems(), store.device.accountId).get(deviceId) ?? []) await store.remove(item.id);
}

/**
 * A first name for this device from its browser, like "iPhone · Safari" or "Mac · Firefox",
 * so two browsers can be told apart before anyone renames them.
 */
export function guessDeviceName(userAgent: string, kind: string): string {
  if (kind === "android") return "Android app";
  const ua = userAgent;
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile\//.test(ua))
      ? "iPad"
      : /Android/.test(ua)
        ? "Android phone"
        : /Macintosh|Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /CrOS/.test(ua)
              ? "Chromebook"
              : /Linux/.test(ua)
                ? "Linux"
                : null;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\/|FxiOS/.test(ua)
      ? "Firefox"
      : /OPR\//.test(ua)
        ? "Opera"
        : /SamsungBrowser/.test(ua)
          ? "Samsung Internet"
          : /Chrome\/|CriOS/.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : null;
  return [os, browser].filter(Boolean).join(" · ") || "Browser";
}
