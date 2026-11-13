"use client";

import { useEffect, useState } from "react";
import type { Diary } from "@map-diary/sync";
import { api } from "../device/session";
import { PendingQueue } from "./queue";
import { IdbPendingStore, type PendingItem } from "./store";
import { DiaryPendingStore } from "./synced";

/** How often the queue checks for results while the app is open. The Inbox checks more often. */
const POLL_INTERVAL_MS = 60_000;

/** Where items saved before they synced were kept; emptied into the diary as the queue starts. */
let store: Promise<IdbPendingStore> | null = null;
let current: { diary: Diary; queue: Promise<PendingQueue>; stop: () => void } | null = null;

function openStore(): Promise<IdbPendingStore> {
  store ??= IdbPendingStore.open();
  return store;
}

/**
 * Moves items this device kept to itself (before pending places synced) into the diary, so the
 * person's other devices get them too. Each is written before its local copy goes.
 */
async function moveLocalItems(synced: DiaryPendingStore): Promise<void> {
  const local = await openStore().catch(() => null);
  if (!local) return;
  for (const { id, ...item } of await local.list()) {
    await synced.create(item);
    await local.delete(id);
  }
}

/** The pending queue for this device's diary, polling in the background while the app is open. */
export function getPendingQueue(diary: Diary): Promise<PendingQueue> {
  if (current?.diary === diary) return current.queue;
  current?.stop();
  const synced = new DiaryPendingStore(diary);
  const queue = moveLocalItems(synced)
    .catch(() => undefined)
    .then(() => new PendingQueue(synced, api, diary));
  const poll = () => void queue.then((q) => q.poll()).catch(() => undefined);
  const onVisible = () => document.visibilityState === "visible" && poll();
  const timer = setInterval(poll, POLL_INTERVAL_MS);
  window.addEventListener("online", poll);
  document.addEventListener("visibilitychange", onVisible);
  poll();
  current = {
    diary,
    queue,
    stop: () => {
      clearInterval(timer);
      window.removeEventListener("online", poll);
      document.removeEventListener("visibilitychange", onVisible);
    },
  };
  return queue;
}

/**
 * Drops the pending items this device still keeps to itself; used when the device is forgotten.
 * Synced items go with the diary store, and stay on the person's other devices.
 */
export async function clearPending(): Promise<void> {
  current?.stop();
  current = null;
  await (await openStore()).clear();
}

export interface Pending {
  queue: PendingQueue | null;
  items: PendingItem[];
}

/** The pending items, kept current. Pass `pollMs` to check for results more often while mounted. */
export function usePending(diary: Diary, pollMs?: number): Pending {
  const [state, setState] = useState<Pending>({ queue: null, items: [] });
  useEffect(() => {
    let live = true;
    let off = () => {};
    let timer: ReturnType<typeof setInterval> | undefined;
    void getPendingQueue(diary).then((queue) => {
      if (!live) return;
      const load = () => void queue.list().then((items) => live && setState({ queue, items }));
      load();
      off = queue.subscribe(load);
      if (pollMs) {
        const poll = () => void queue.poll().catch(() => undefined);
        poll();
        timer = setInterval(poll, pollMs);
      }
    });
    return () => {
      live = false;
      off();
      if (timer) clearInterval(timer);
    };
  }, [diary, pollMs]);
  return state;
}
