import type { EnvelopeType, JsonValue } from "@map-diary/crypto";
import { readPayload } from "./payloads";
import type { Board, BoardKind, DiarySnapshot, DiarySource, Opinion, Person, PlaceView, Status, StatusOpinion, TagDefinition } from "./types";

/** A decrypted item as the device store keeps it (the shape of `DiaryItem` in `@map-diary/sync`). */
export interface StoredItem {
  id: string;
  type: EnvelopeType;
  authorId: string;
  placeId: string | null;
  /** Milliseconds since the epoch. */
  createdAt: number;
  updatedAt: number;
  boardIds: string[];
  payload: JsonValue;
}

/** The parts of the device's `Diary` this source needs. */
export interface ItemStore {
  readonly device: { readonly accountId: string; readonly personalBoardId: string };
  listItems(): Promise<StoredItem[]>;
  write(input: { type: EnvelopeType; placeId: string | null; payload: JsonValue; id?: string }): Promise<unknown>;
  subscribe(listener: () => void): () => void;
}

/** A `DiarySource` over the device's decrypted items. */
export function createItemsSource(store: ItemStore): DiarySource {
  const { accountId, personalBoardId } = store.device;
  const load = async () => snapshotFromItems(await store.listItems(), accountId, personalBoardId);

  return {
    load,
    subscribe: (listener) => store.subscribe(listener),
    setStatus: async (placeId: string, status: Status) => {
      const items = await store.listItems();
      const own = latestStatus(items.filter((i) => i.type === "status" && i.placeId === placeId && i.authorId === accountId));
      // The store posts new items to the Personal board; an edit keeps the item's id.
      await store.write({ type: "status", placeId, payload: { status }, ...(own ? { id: own.id } : {}) });
      return load();
    },
  };
}

/** A board the account is in, as the device's key ring knows it. */
export interface KnownBoard {
  id: string;
  kind: BoardKind;
}

/** What each board is called on screen. */
export function boardName(kind: BoardKind): string {
  return kind === "master" ? "Public" : kind === "personal" ? "Personal" : "Group";
}

export function snapshotFromItems(
  items: readonly StoredItem[],
  accountId: string,
  personalBoardId: string,
  known: readonly KnownBoard[] = [],
): DiarySnapshot {
  const iso = (ms: number) => new Date(ms).toISOString();
  const places = new Map<string, PlaceView>();
  const tags: TagDefinition[] = [];
  const opinions: { placeId: string; opinion: Opinion }[] = [];
  const authors = new Set<string>([accountId]);
  const boardIds = new Set<string>([personalBoardId, ...known.map((b) => b.id)]);

  for (const item of items) {
    item.boardIds.forEach((b) => boardIds.add(b));
    const base = { id: item.id, authorId: item.authorId, boards: item.boardIds, createdAt: iso(item.createdAt), updatedAt: iso(item.updatedAt) };
    switch (item.type) {
      case "place":
      case "private_place": {
        const p = readPayload(item.type, item.payload);
        if (p) places.set(item.id, { ...p, id: item.id, isPrivate: item.type === "private_place", opinions: [] });
        break;
      }
      case "tag_def": {
        const t = readPayload("tag_def", item.payload);
        if (t) tags.push({ ...t, id: item.id, authorId: item.authorId, boards: item.boardIds });
        break;
      }
      case "status": {
        const s = readPayload("status", item.payload);
        if (s && item.placeId) opinions.push({ placeId: item.placeId, opinion: { ...base, kind: "status", status: s.status } });
        break;
      }
      case "tag": {
        const t = readPayload("tag", item.payload);
        if (t && item.placeId) opinions.push({ placeId: item.placeId, opinion: { ...base, kind: "tag", tagId: t.tagId } });
        break;
      }
      case "comment": {
        const c = readPayload("comment", item.payload);
        if (c && item.placeId) opinions.push({ placeId: item.placeId, opinion: { ...base, kind: "comment", text: c.text } });
        break;
      }
    }
  }

  for (const { placeId, opinion } of opinions) {
    const place = places.get(placeId);
    if (!place) continue;
    place.opinions.push(opinion);
    authors.add(opinion.authorId);
    opinion.boards.forEach((b) => boardIds.add(b));
  }
  // One status per person per place: keep the latest if a sync race left two.
  for (const place of places.values()) {
    const latest = new Map<string, StatusOpinion>();
    for (const o of place.opinions) {
      if (o.kind !== "status") continue;
      const prev = latest.get(o.authorId);
      if (!prev || o.updatedAt > prev.updatedAt) latest.set(o.authorId, o);
    }
    place.opinions = place.opinions.filter((o) => o.kind !== "status" || latest.get(o.authorId) === o);
  }

  const me: Person = { id: accountId, name: "Me" };
  const others = [...authors].filter((id) => id !== accountId).map((id, i): Person => ({ id, name: `Friend ${i + 1}` }));
  const kindOf = (id: string): BoardKind => (id === personalBoardId ? "personal" : (known.find((b) => b.id === id)?.kind ?? "group"));
  const boards = [...boardIds].map((id): Board => {
    const kind = kindOf(id);
    // A board this device is not in (someone's Personal board never reaches it) reads as shared.
    return { id, kind, name: known.some((b) => b.id === id) || id === personalBoardId ? boardName(kind) : "Shared board" };
  });

  return { me, people: [me, ...others], boards, tags, places: [...places.values()] };
}

function latestStatus(items: readonly StoredItem[]): StoredItem | undefined {
  return items.reduce<StoredItem | undefined>((a, b) => (!a || b.updatedAt > a.updatedAt ? b : a), undefined);
}
