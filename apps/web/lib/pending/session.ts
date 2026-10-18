"use client";

import { useEffect, useState } from "react";
import type { Diary } from "@map-diary/sync";
import { api } from "../device/session";
import { PendingQueue } from "./queue";
import { IdbPendingStore, type PendingItem } from "./store";

/** How often the queue checks for results while the app is open. The Inbox checks more often. */
const POLL_INTERVAL_MS = 60_000;

let store: Promise<IdbPendingStore> | null = null;
let current: { diary: Diary; queue: Promise<PendingQueue>; stop: () => void } | null = null;

function openStore(): Promise<IdbPendingStore> {
  store ??= IdbPendingStore.open();
  return store;
}

/** The pending queue for this device's diary, polling in the background while the app is open. */
export function getPendingQueue(diary: Diary): Promise<PendingQueue> {
  if (current?.diary === diary) return current.queue;
  current?.stop();
  const queue = openStore().then((s) => new PendingQueue(s, api, diary));
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

/** Drops every pending item and its one-time keys; used when the device is forgotten. */
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
