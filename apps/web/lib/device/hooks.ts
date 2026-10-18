"use client";

import { useEffect, useState } from "react";
import type { Diary, DiaryItem, SyncStatus } from "@map-diary/sync";
import { getSession, onSessionChange, type Session } from "./session";

export type SessionState = { state: "loading" } | Session;

/** Whether this device is signed in, and its diary once it is. */
export function useSession(): SessionState {
  const [session, setSession] = useState<SessionState>({ state: "loading" });
  useEffect(() => {
    let live = true;
    const load = () => {
      getSession().then(
        (s) => live && setSession(s),
        () => live && setSession({ state: "signed-out" }),
      );
    };
    load();
    const off = onSessionChange(load);
    return () => {
      live = false;
      off();
    };
  }, []);
  return session;
}

/** The diary's decrypted items, kept current as local writes land and sync pulls changes. */
export function useDiaryItems(diary: Diary | null): DiaryItem[] {
  const [items, setItems] = useState<DiaryItem[]>([]);
  useEffect(() => {
    if (!diary) {
      setItems([]);
      return;
    }
    let live = true;
    const load = () => void diary.listItems().then((list) => live && setItems(list));
    load();
    const off = diary.subscribe(load);
    return () => {
      live = false;
      off();
    };
  }, [diary]);
  return items;
}

export function useSyncStatus(diary: Diary | null): SyncStatus | null {
  const [status, setStatus] = useState<SyncStatus | null>(diary?.getStatus() ?? null);
  useEffect(() => {
    if (!diary) {
      setStatus(null);
      return;
    }
    setStatus(diary.getStatus());
    return diary.subscribe(() => setStatus(diary.getStatus()));
  }, [diary]);
  return status;
}
