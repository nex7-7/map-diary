"use client";

import { useEffect, useMemo, useState } from "react";
import type { Diary, DiaryItem } from "@/lib/device";
import { snapshotFromItems } from "@/lib/places/items-source";
import type { DiarySnapshot } from "@/lib/places/types";

export interface Items {
  /** False until the first read from the device store finishes. */
  loaded: boolean;
  items: DiaryItem[];
  snapshot: DiarySnapshot;
}

/** The diary's decrypted items and the map's view of them, kept current as writes and syncs land. */
export function useItems(diary: Diary): Items {
  const [state, setState] = useState<{ loaded: boolean; items: DiaryItem[] }>({ loaded: false, items: [] });
  useEffect(() => {
    let live = true;
    const load = () => void diary.listItems().then((items) => live && setState({ loaded: true, items }));
    load();
    const off = diary.subscribe(load);
    return () => {
      live = false;
      off();
    };
  }, [diary]);
  const snapshot = useMemo(
    () => snapshotFromItems(state.items, diary.device.accountId, diary.device.personalBoardId, diary.device.boards),
    [state.items, diary],
  );
  return { ...state, snapshot };
}

/** The place id in the page's fragment (`/place#<id>`), which the browser never sends to the server. */
export function useHashId(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setId(decodeURIComponent(location.hash.slice(1)) || null);
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  return id;
}
