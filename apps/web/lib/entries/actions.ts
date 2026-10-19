import type { EnvelopeType, JsonValue } from "@map-diary/crypto";
import type { StoredItem } from "../places/items-source";
import { cleanDisplayName, readPayload, type CommentPayload, type PlacePayload, type ProfilePayload, type TagDefPayload } from "../places/payloads";
import type { Status } from "../places/types";
import { oneEmoji } from "./emoji";
import { normaliseLink } from "./parse-input";

/**
 * Writes for the Add sheet and the place page, over the device's diary. Each opinion goes to
 * the boards the person picks (Personal when they pick none). The diary puts a catalogue
 * place on the master board itself and keeps dropped pins off it.
 */

/** The parts of the device's `Diary` these writes need. */
export interface DiaryWriter {
  readonly device: { readonly accountId: string };
  listItems(): Promise<StoredItem[]>;
  write(input: {
    type: EnvelopeType;
    placeId: string | null;
    payload: JsonValue;
    id?: string;
    boards?: readonly string[];
  }): Promise<{ id: string }>;
  remove(id: string): Promise<void>;
  /** The catalogue place that already has one of these normalised links, asked of the Worker. */
  findCataloguePlace?(links: readonly string[]): Promise<string | null>;
}

/** Board ids for an opinion; undefined lets the diary choose (Personal, or an edit's own). */
export type Boards = readonly string[] | undefined;

export interface NewPlace {
  /** A dropped pin is a private place and never enters the shared catalogue. */
  kind: "place" | "private_place";
  facts: PlacePayload;
  status: Status;
  /** Existing tag definitions to apply. */
  tagIds: string[];
  /** Tags made in the sheet: defined, then applied. */
  newTags: TagDefPayload[];
  comment: string;
  /** Where the status goes, and the tags and note unless they pick their own. The place itself goes where the diary puts it. */
  boards?: readonly string[];
  /** Where the tags (and any tags made here) go; the status's boards if missing. */
  tagBoards?: readonly string[];
  /** Where the note goes; the status's boards if missing. */
  commentBoards?: readonly string[];
}

// Payload types are plain JSON, but TypeScript cannot see an interface as an index signature.
const json = (v: object): JsonValue => v as JsonValue;

/** Saves a place with its status, tags and comment. Returns the place's id. */
export async function addPlace(w: DiaryWriter, input: NewPlace): Promise<string> {
  const { boards, tagBoards = boards, commentBoards = boards } = input;
  const defined: string[] = [];
  for (const def of input.newTags) defined.push(await defineTag(w, def, tagBoards));

  const place = await w.write({ type: input.kind, placeId: null, payload: json(input.facts) });
  // The status goes first: tags and comments need one.
  await w.write({ type: "status", placeId: place.id, payload: { status: input.status }, ...on(boards) });
  for (const tagId of new Set([...input.tagIds, ...defined])) await applyTag(w, place.id, tagId, tagBoards);
  const text = input.comment.trim();
  if (text) await w.write({ type: "comment", placeId: place.id, payload: { text }, ...on(commentBoards) });
  return place.id;
}

/**
 * Puts this person's status, tags and note on a place that is already there (the catalogue
 * has it), instead of adding a second copy. A status they already have is kept.
 */
export async function addOpinions(w: DiaryWriter, placeId: string, input: Omit<NewPlace, "kind" | "facts">): Promise<void> {
  const { boards, tagBoards = boards, commentBoards = boards } = input;
  const items = await w.listItems();
  const hasStatus = items.some((i) => i.type === "status" && i.placeId === placeId && i.authorId === w.device.accountId);
  if (!hasStatus) await setStatus(w, placeId, input.status, boards);
  const defined: string[] = [];
  for (const def of input.newTags) defined.push(await defineTag(w, def, tagBoards));
  for (const tagId of new Set([...input.tagIds, ...defined])) await applyTag(w, placeId, tagId, tagBoards);
  if (input.comment.trim()) await addComment(w, placeId, input.comment, commentBoards);
}

const on = (boards: Boards) => (boards && boards.length > 0 ? { boards } : {});

/** A place's source links as the catalogue's duplicate check compares them. */
export function placeLinks(payload: JsonValue): string[] {
  return readPayload("place", payload)?.sourceLinks.map(normaliseLink) ?? [];
}

/**
 * The catalogue place with one of these links: one on this device first, then one the Worker
 * knows by its keyed link hash but this device has not synced yet. Offline, only the first.
 */
export async function findCataloguePlace(w: DiaryWriter, links: readonly string[]): Promise<string | undefined> {
  const items = await w.listItems();
  const local = links.map((l) => findDuplicate(items, l)).find((d) => d !== undefined);
  if (local) return local.id;
  if (!w.findCataloguePlace || links.length === 0) return undefined;
  return (await w.findCataloguePlace(links.map(normaliseLink)).catch(() => null)) ?? undefined;
}

/** A place already in the diary with the same source link, if any. */
export function findDuplicate(items: readonly StoredItem[], link: string): StoredItem | undefined {
  const key = normaliseLink(link);
  return items.find((i) => {
    if (i.type !== "place" && i.type !== "private_place") return false;
    const p = readPayload(i.type, i.payload);
    return p?.sourceLinks.some((l) => normaliseLink(l) === key) ?? false;
  });
}

function own(w: DiaryWriter, items: readonly StoredItem[], type: EnvelopeType, placeId: string): StoredItem[] {
  return items.filter((i) => i.type === type && i.placeId === placeId && i.authorId === w.device.accountId);
}

async function requireStatus(w: DiaryWriter, placeId: string): Promise<StoredItem[]> {
  const items = await w.listItems();
  if (own(w, items, "status", placeId).length === 0) {
    throw new EntryError("Mark it Want to or Visited before tagging or commenting");
  }
  return items;
}

/**
 * Sets this person's status, editing their existing status item if there is one. Given
 * boards, the status moves to them; otherwise it keeps its own (Personal if new).
 */
export async function setStatus(w: DiaryWriter, placeId: string, status: Status, boards?: Boards): Promise<void> {
  const mine = own(w, await w.listItems(), "status", placeId);
  const latest = mine.reduce<StoredItem | undefined>((a, b) => (!a || b.updatedAt > a.updatedAt ? b : a), undefined);
  await w.write({ type: "status", placeId, payload: { status }, ...(latest ? { id: latest.id } : {}), ...on(boards) });
  // A sync race can leave two; keep one.
  for (const extra of mine) if (extra !== latest) await w.remove(extra.id);
}

/**
 * Applies a tag. A tag opinion only goes where its definition can be read, so applying one of
 * this person's own tags somewhere new widens the definition to match; someone else's tag
 * cannot be widened, and is refused.
 */
export async function applyTag(
  w: DiaryWriter,
  placeId: string,
  tagId: string,
  boards?: Boards,
  /** Whether the definition can be read on a board; defaults to "is posted there". See `tagFit`. */
  visibleOn?: (boardId: string) => boolean,
): Promise<void> {
  const items = await requireStatus(w, placeId);
  const def = items.find((i) => i.id === tagId && i.type === "tag_def");
  const wanted = boards && boards.length > 0 ? boards : undefined;
  if (def && wanted) {
    const missing = wanted.filter((b) => !(visibleOn ? visibleOn(b) : def.boardIds.includes(b)));
    if (missing.length > 0) {
      if (def.authorId !== w.device.accountId) throw new EntryError("That tag isn't shared on the boards you picked");
      await w.write({ type: "tag_def", placeId: null, payload: def.payload, id: def.id, boards: [...def.boardIds, ...missing] });
    }
  }
  const already = own(w, items, "tag", placeId).some((i) => readPayload("tag", i.payload)?.tagId === tagId);
  if (!already) await w.write({ type: "tag", placeId, payload: { tagId }, ...on(wanted) });
}

/** Removes every tag opinion of this person applying `tagId` to the place. */
export async function unapplyTag(w: DiaryWriter, placeId: string, tagId: string): Promise<void> {
  for (const i of own(w, await w.listItems(), "tag", placeId)) {
    if (readPayload("tag", i.payload)?.tagId === tagId) await w.remove(i.id);
  }
}

/** Defines a tag on the given boards (Personal by default). Returns its id. */
export async function defineTag(w: DiaryWriter, def: TagDefPayload, boards?: Boards): Promise<string> {
  const clean = cleanTag(def);
  if (!clean.name) throw new EntryError("A tag needs a name");
  return (await w.write({ type: "tag_def", placeId: null, payload: json(clean), ...on(boards) })).id;
}

export async function editTag(w: DiaryWriter, id: string, def: TagDefPayload): Promise<void> {
  const clean = cleanTag(def);
  if (!clean.name) throw new EntryError("A tag needs a name");
  await w.write({ type: "tag_def", placeId: null, payload: json(clean), id });
}

export async function addComment(w: DiaryWriter, placeId: string, text: string, boards?: Boards): Promise<void> {
  const payload: CommentPayload = { text: text.trim() };
  if (!payload.text) throw new EntryError("A comment needs some text");
  await requireStatus(w, placeId);
  await w.write({ type: "comment", placeId, payload: json(payload), ...on(boards) });
}

export async function editComment(w: DiaryWriter, id: string, placeId: string, text: string): Promise<void> {
  const payload: CommentPayload = { text: text.trim() };
  if (!payload.text) throw new EntryError("A comment needs some text");
  await w.write({ type: "comment", placeId, payload: json(payload), id });
}

/** Removes one of this person's own opinions. Nobody can remove someone else's. */
export async function removeOpinion(w: DiaryWriter, id: string): Promise<void> {
  await w.remove(id);
}

/**
 * Rewrites a place's facts. Only its author can, and a place never changes kind. Once a
 * catalogue place is written, the Worker accepts new facts only from the admin.
 */
export async function updateFacts(w: DiaryWriter, place: StoredItem, facts: PlacePayload): Promise<void> {
  if (place.type !== "place" && place.type !== "private_place") throw new EntryError("Not a place");
  await w.write({ type: place.type, placeId: place.placeId, payload: json(facts), id: place.id });
}

/**
 * Deletes a place this person wrote, with their own opinions on it. Other people's opinions
 * are never touched: there is no moderation.
 */
export async function deletePlace(w: DiaryWriter, placeId: string): Promise<void> {
  const items = await w.listItems();
  for (const i of items) {
    if (i.placeId === placeId && i.authorId === w.device.accountId) await w.remove(i.id);
  }
  await w.remove(placeId);
}

/**
 * Sets how this person appears to everyone: one profile item on the master board, edited in
 * place. Returns the name as saved.
 */
export async function setDisplayName(w: DiaryWriter, name: string, masterBoardId: string): Promise<string> {
  const payload: ProfilePayload = { name: cleanDisplayName(name) };
  if (!payload.name) throw new EntryError("A name needs at least one letter");
  const mine = (await w.listItems()).filter((i) => i.type === "profile" && i.authorId === w.device.accountId);
  const latest = mine.reduce<StoredItem | undefined>((a, b) => (!a || b.updatedAt > a.updatedAt ? b : a), undefined);
  await w.write({ type: "profile", placeId: null, payload: json(payload), boards: [masterBoardId], ...(latest ? { id: latest.id } : {}) });
  for (const extra of mine) if (extra !== latest) await w.remove(extra.id);
  return payload.name;
}

function cleanTag(def: TagDefPayload): TagDefPayload {
  return { name: def.name.trim().slice(0, 40), emoji: oneEmoji(def.emoji), description: def.description.trim().slice(0, 280) };
}

/** A write refused for a reason the person can fix; the message is shown as is. */
export class EntryError extends Error {
  override name = "EntryError";
}
