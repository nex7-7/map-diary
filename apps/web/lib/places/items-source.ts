import type { EnvelopeType, JsonValue } from "@map-diary/crypto";
import { applyBoardRules } from "./boards";
import { readPayload } from "./payloads";
import type { Board, DiarySnapshot, DiarySource, Opinion, Person, PlaceView, Status, StatusOpinion, TagDefinition } from "./types";

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
export interface ItemStore extends BoardDirectory {
  readonly device: DeviceBoards;
  listItems(): Promise<StoredItem[]>;
  write(input: { type: EnvelopeType; placeId: string | null; payload: JsonValue; id?: string }): Promise<unknown>;
  subscribe(listener: () => void): () => void;
}

export interface DeviceBoards {
  readonly accountId: string;
  readonly personalBoardId: string;
  /** The board keys the device holds; the boards it can read. */
  readonly boardKeys?: readonly { readonly boardId: string }[];
}

/**
 * Where the device learns each board's kind, name and members. `listBoards` arrives with the
 * master board and groups in `@map-diary/sync`; until then the boards come from the device's keys.
 */
export interface BoardDirectory {
  listBoards?(): Promise<Board[]>;
}

/** The boards this device can read. The Personal board is always there, with only its owner. */
export async function boardsOf(store: BoardDirectory & { readonly device: DeviceBoards }): Promise<Board[]> {
  const { accountId, personalBoardId, boardKeys = [] } = store.device;
  const personal: Board = { id: personalBoardId, kind: "personal", name: "Personal", memberIds: [accountId] };
  const listed = store.listBoards
    ? await store.listBoards()
    : [...new Set(boardKeys.map((k) => k.boardId))].map(
        (id): Board => ({ id, kind: "group", name: "Shared board", memberIds: null }),
      );
  return [personal, ...listed.filter((b) => b.id !== personalBoardId)];
}

/** A `DiarySource` over the device's decrypted items. */
export function createItemsSource(store: ItemStore): DiarySource {
  const load = async () => {
    const { accountId, personalBoardId } = store.device;
    const [items, boards] = await Promise.all([store.listItems(), boardsOf(store)]);
    return snapshotFromItems(items, accountId, personalBoardId, boards);
  };

  return {
    load,
    subscribe: (listener) => store.subscribe(listener),
    setStatus: async (placeId: string, status: Status) => {
      const items = await store.listItems();
      const { accountId } = store.device;
      const own = latestStatus(items.filter((i) => i.type === "status" && i.placeId === placeId && i.authorId === accountId));
      // The store posts new items to the Personal board; an edit keeps the item's id.
      await store.write({ type: "status", placeId, payload: { status }, ...(own ? { id: own.id } : {}) });
      return load();
    },
  };
}

/**
 * Builds the map's view of the device's items. `boards` are the boards this device can read
 * (see `boardsOf`); items are shown only where the board rules allow.
 */
export function snapshotFromItems(
  items: readonly StoredItem[],
  accountId: string,
  personalBoardId: string,
  boards: readonly Board[] = [{ id: personalBoardId, kind: "personal", name: "Personal", memberIds: [accountId] }],
): DiarySnapshot {
  const iso = (ms: number) => new Date(ms).toISOString();
  const places = new Map<string, PlaceView>();
  const tags: TagDefinition[] = [];
  const opinions: { placeId: string; opinion: Opinion }[] = [];
  const authors = new Set<string>([accountId]);
  const profiles = displayNames(items);

  for (const item of items) {
    const base = {
      id: item.id,
      authorId: item.authorId,
      boards: item.boardIds,
      shownOn: [],
      createdAt: iso(item.createdAt),
      updatedAt: iso(item.updatedAt),
    };
    switch (item.type) {
      case "place":
      case "private_place": {
        const p = readPayload(item.type, item.payload);
        if (p) places.set(item.id, { ...p, id: item.id, isPrivate: item.type === "private_place", boards: item.boardIds, opinions: [] });
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

  const snapshot = applyBoardRules({
    me: { id: accountId, name: "Me" },
    people: [],
    boards: [...boards],
    tags,
    places: [...places.values()],
  });
  // People are the authors of what this device can see, named by their profiles.
  for (const p of snapshot.places) for (const o of p.opinions) authors.add(o.authorId);
  let unnamed = 0;
  const people = [...authors].map((id): Person => {
    const name = profiles.get(id);
    if (id === accountId) return { id, name: name ?? "Me" };
    return { id, name: name ?? `Friend ${++unnamed}` };
  });
  return { ...snapshot, me: people[0]!, people };
}

/** Each account's display name: the newest valid `profile` item it wrote. */
export function displayNames(items: readonly StoredItem[]): Map<string, string> {
  const latest = new Map<string, { name: string; updatedAt: number }>();
  for (const item of items) {
    if (item.type !== "profile") continue;
    const p = readPayload("profile", item.payload);
    const prior = latest.get(item.authorId);
    if (p && (!prior || item.updatedAt > prior.updatedAt)) latest.set(item.authorId, { name: p.name, updatedAt: item.updatedAt });
  }
  return new Map([...latest].map(([id, v]) => [id, v.name]));
}

function latestStatus(items: readonly StoredItem[]): StoredItem | undefined {
  return items.reduce<StoredItem | undefined>((a, b) => (!a || b.updatedAt > a.updatedAt ? b : a), undefined);
}
