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

/** A board the account is in, as the sync loop last saw it. */
export interface BoardMembership {
  id: string;
  kind: string;
  memberIds?: string[];
}

/** The parts of the device's `Diary` this source needs. */
export interface ItemStore {
  readonly device: {
    readonly accountId: string;
    readonly personalBoardId: string;
    readonly boards?: readonly BoardMembership[];
  };
  listItems(): Promise<StoredItem[]>;
  write(input: { type: EnvelopeType; placeId: string | null; payload: JsonValue; id?: string }): Promise<unknown>;
  subscribe(listener: () => void): () => void;
}

/** A `DiarySource` over the device's decrypted items. */
export function createItemsSource(store: ItemStore): DiarySource {
  const { accountId, personalBoardId } = store.device;
  // Boards change as groups are joined and left, so read them from the device on each load.
  const load = async () => snapshotFromItems(await store.listItems(), accountId, personalBoardId, store.device.boards);

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

export function snapshotFromItems(
  items: readonly StoredItem[],
  accountId: string,
  personalBoardId: string,
  memberships: readonly BoardMembership[] = [],
): DiarySnapshot {
  const iso = (ms: number) => new Date(ms).toISOString();
  const places = new Map<string, PlaceView>();
  const tags: TagDefinition[] = [];
  const opinions: { placeId: string; opinion: Opinion }[] = [];
  const authors = new Set<string>([accountId]);
  const boardIds = new Set<string>([personalBoardId, ...memberships.map((b) => b.id)]);
  const groupNames = new Map<string, { name: string; updatedAt: number }>();

  for (const item of items) {
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
      case "group": {
        // The newest name posted to a group's board names it.
        const g = readPayload("group", item.payload);
        const groupId = item.boardIds[0];
        const prior = groupId === undefined ? undefined : groupNames.get(groupId);
        if (g && groupId !== undefined && (!prior || item.updatedAt > prior.updatedAt)) {
          groupNames.set(groupId, { name: g.name, updatedAt: item.updatedAt });
        }
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
  const known = new Map(memberships.map((b) => [b.id, b]));
  const boards = [...boardIds].map((id): Board => {
    if (id === personalBoardId) return { id, kind: "personal", name: "Personal" };
    const m = known.get(id);
    const kind: BoardKind = m?.kind === "master" ? "master" : m?.kind === "personal" ? "personal" : "group";
    if (kind === "master") return { id, kind, name: "Public" };
    const board: Board = { id, kind, name: groupNames.get(id)?.name ?? "Shared board" };
    if (m?.memberIds) board.memberIds = [...m.memberIds];
    return board;
  });

  return { me, people: [me, ...others], boards, tags, places: [...places.values()] };
}

function latestStatus(items: readonly StoredItem[]): StoredItem | undefined {
  return items.reduce<StoredItem | undefined>((a, b) => (!a || b.updatedAt > a.updatedAt ? b : a), undefined);
}
