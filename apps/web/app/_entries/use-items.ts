"use client";

import { useEffect, useMemo, useState } from "react";
import type { Diary, DiaryItem } from "@/lib/device";
import { boardsOf, snapshotFromItems, type BoardDirectory } from "@/lib/places/items-source";
import type { Board, DiarySnapshot } from "@/lib/places/types";

export interface Items {
  /** False until the first read from the device store finishes. */
  loaded: boolean;
  items: DiaryItem[];
  snapshot: DiarySnapshot;
  /**
   * True once the diary can post to boards other than Personal (the sync package's board
   * directory has landed). Until then every write goes to Personal, so no other board is offered.
   */
  canChooseBoards: boolean;
}

/** The diary's decrypted items and the map's view of them, kept current as writes and syncs land. */
export function useItems(diary: Diary): Items {
  const [state, setState] = useState<{ loaded: boolean; items: DiaryItem[]; boards: Board[] }>({ loaded: false, items: [], boards: [] });
  const directory = diary as Diary & BoardDirectory;
  useEffect(() => {
    let live = true;
    const load = () =>
      void Promise.all([diary.listItems(), boardsOf(directory)]).then(([items, boards]) => live && setState({ loaded: true, items, boards }));
    load();
    const off = diary.subscribe(load);
    return () => {
      live = false;
      off();
    };
  }, [diary, directory]);
  const snapshot = useMemo(
    () => snapshotFromItems(state.items, diary.device.accountId, diary.device.personalBoardId, state.loaded ? state.boards : undefined),
    [state, diary],
  );
  return { loaded: state.loaded, items: state.items, snapshot, canChooseBoards: typeof directory.listBoards === "function" };
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
