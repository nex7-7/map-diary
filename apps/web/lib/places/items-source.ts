import type { EnvelopeType, JsonValue } from "@map-diary/crypto";
import { applyBoardRules } from "./boards";
import { foldChains, outletIds } from "./chains";
import { readPayload, type ProfilePayload } from "./payloads";
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
  /** Written by the author's Claude assistant. */
  viaClaude?: boolean;
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
  /**
   * The boards this account is in, refreshed on each sync (arrives with groups in
   * `@map-diary/sync`). `memberIds` is set for groups only; absent means everyone.
   */
  readonly boards?: readonly { readonly id: string; readonly kind: BoardKind; readonly memberIds?: readonly string[] }[];
}

/**
 * Where the device learns each board's kind, name and members: `listBoards` if the diary
 * has one, else the device's board list from sync, else (before sharing) its keys.
 */
export interface BoardDirectory {
  listBoards?(): Promise<Board[]>;
  /** The diary's board ring, if it exposes one (same shape as `DeviceBoards.boards`). */
  readonly boards?: DeviceBoards["boards"];
}

const BOARD_NAMES: Record<BoardKind, string> = { personal: "Personal", master: "Public", group: "Group" };

/** True once the diary can post to boards other than Personal. */
export function canChooseBoards(store: BoardDirectory & { readonly device: DeviceBoards }): boolean {
  return typeof store.listBoards === "function" || (store.boards ?? store.device.boards) !== undefined;
}

/** The boards this device can read. The Personal board is always there, with only its owner. */
export async function boardsOf(store: BoardDirectory & { readonly device: DeviceBoards }): Promise<Board[]> {
  const { accountId, personalBoardId, boardKeys = [] } = store.device;
  const boards = store.boards ?? store.device.boards;
  const personal: Board = { id: personalBoardId, kind: "personal", name: "Personal", memberIds: [accountId] };
  const listed: Board[] = store.listBoards
    ? await store.listBoards()
    : boards
      ? boards.map((b) => ({ id: b.id, kind: b.kind, name: BOARD_NAMES[b.kind], memberIds: b.kind === "personal" ? [accountId] : b.memberIds ? [...b.memberIds] : null }))
      : [...new Set(boardKeys.map((k) => k.boardId))].map((id): Board => ({ id, kind: "group", name: "Shared board", memberIds: null }));
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
      // A chain has one status per person, on whichever outlet it was first set.
      const outlets = outletIds(items, placeId);
      const own = latestStatus(items.filter((i) => i.type === "status" && i.placeId !== null && outlets.includes(i.placeId) && i.authorId === accountId));
      // The store posts new items to the Personal board; an edit keeps the item's id and place.
      await store.write({ type: "status", placeId: own?.placeId ?? placeId, payload: { status }, ...(own ? { id: own.id } : {}) });
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
  const created = new Map<string, number>();
  const tags: TagDefinition[] = [];
  const opinions: { placeId: string; opinion: Opinion }[] = [];
  const authors = new Set<string>([accountId]);
  const profiles = profilesOf(items);
  const groups = groupNames(items);

  for (const item of items) {
    const base = {
      id: item.id,
      authorId: item.authorId,
      ...(item.placeId ? { placeId: item.placeId } : {}),
      boards: item.boardIds,
      shownOn: [],
      ...(item.viaClaude ? { viaClaude: true } : {}),
      createdAt: iso(item.createdAt),
      updatedAt: iso(item.updatedAt),
    };
    switch (item.type) {
      case "place":
      case "private_place": {
        const p = readPayload(item.type, item.payload);
        if (p) places.set(item.id, { ...p, id: item.id, isPrivate: item.type === "private_place", boards: item.boardIds, opinions: [] });
        created.set(item.id, item.createdAt);
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
        if (c && item.placeId) opinions.push({ placeId: item.placeId, opinion: { ...base, kind: "comment", text: c.text, ...(c.allOutlets ? { allOutlets: true } : {}) } });
        break;
      }
    }
  }

  for (const { placeId, opinion } of opinions) {
    const place = places.get(placeId);
    if (!place) continue;
    place.opinions.push(opinion);
  }
  // A chain's outlets show as one place.
  const folded = foldChains([...places.values()], (id) => created.get(id) ?? 0);
  // One status per person per place (or chain): keep the latest if a sync race left two.
  for (const place of folded) {
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
    // A group's board takes the name its members gave it.
    boards: boards.map((b) => (b.kind === "group" && groups.has(b.id) ? { ...b, name: groups.get(b.id)!.name } : b)),
    tags,
    places: folded,
  });
  // People are the authors of what this device can see, named by their profiles.
  for (const p of snapshot.places) for (const o of p.opinions) authors.add(o.authorId);
  let unnamed = 0;
  const people = [...authors].map((id): Person => {
    const profile = profiles.get(id);
    const avatar = profile?.avatar ? { avatar: profile.avatar } : {};
    if (id === accountId) return { id, name: profile?.name ?? "Me", ...avatar };
    return { id, name: profile?.name ?? `Friend ${++unnamed}`, ...avatar };
  });
  return { ...snapshot, me: people[0]!, people };
}

/** Each account's profile (name and avatar): the newest valid `profile` item it wrote. */
export function profilesOf(items: readonly StoredItem[]): Map<string, ProfilePayload> {
  const latest = new Map<string, { profile: ProfilePayload; updatedAt: number }>();
  for (const item of items) {
    if (item.type !== "profile") continue;
    const p = readPayload("profile", item.payload);
    const prior = latest.get(item.authorId);
    if (p && (!prior || item.updatedAt > prior.updatedAt)) latest.set(item.authorId, { profile: p, updatedAt: item.updatedAt });
  }
  return new Map([...latest].map(([id, v]) => [id, v.profile]));
}

/** Each account's display name, from `profilesOf`. */
export function displayNames(items: readonly StoredItem[]): Map<string, string> {
  return new Map([...profilesOf(items)].map(([id, p]) => [id, p.name]));
}

/** Each group's name by board id: the newest valid `group` item posted to that board. */
export function groupNames<T extends StoredItem>(items: readonly T[]): Map<string, { name: string; item: T }> {
  const names = new Map<string, { name: string; item: T }>();
  for (const item of items) {
    if (item.type !== "group") continue;
    const name = readPayload("group", item.payload)?.name;
    const groupId = item.boardIds[0];
    if (!name || !groupId) continue;
    const prior = names.get(groupId);
    if (!prior || item.updatedAt > prior.item.updatedAt) names.set(groupId, { name, item });
  }
  return names;
}

function latestStatus(items: readonly StoredItem[]): StoredItem | undefined {
  return items.reduce<StoredItem | undefined>((a, b) => (!a || b.updatedAt > a.updatedAt ? b : a), undefined);
}
