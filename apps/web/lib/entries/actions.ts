import type { EnvelopeType, JsonValue } from "@map-diary/crypto";
import type { StoredItem } from "../places/items-source";
import { cleanDisplayName, readPayload, type CommentPayload, type PlacePayload, type ProfilePayload, type TagDefPayload } from "../places/payloads";
import type { Status } from "../places/types";
import { normaliseLink } from "./parse-input";

/**
 * Writes for the Add sheet and the place page, over the device's diary. A new item goes to
 * the boards given, or the Personal board; an edit keeps the item's boards unless new ones
 * are given. Callers pick boards with `lib/places/boards` so nothing is posted wider than allowed.
 */

export interface WriteRequest {
  type: EnvelopeType;
  placeId: string | null;
  payload: JsonValue;
  id?: string;
  /** Board ids to post to. */
  boards?: string[];
}

/** The parts of the device's `Diary` these writes need. */
export interface DiaryWriter {
  readonly device: { readonly accountId: string };
  listItems(): Promise<StoredItem[]>;
  write(input: WriteRequest): Promise<{ id: string }>;
  remove(id: string): Promise<void>;
}

const on = (boards: readonly string[] | undefined) => (boards && boards.length > 0 ? { boards: [...boards] } : {});

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
}

// Payload types are plain JSON, but TypeScript cannot see an interface as an index signature.
const json = (v: object): JsonValue => v as JsonValue;

/** Saves a place with its status, tags and comment. Returns the place's id. */
export async function addPlace(w: DiaryWriter, input: NewPlace): Promise<string> {
  const defined: string[] = [];
  for (const def of input.newTags) defined.push((await w.write({ type: "tag_def", placeId: null, payload: json(def) })).id);

  const place = await w.write({ type: input.kind, placeId: null, payload: json(input.facts) });
  // The status goes first: tags and comments need one.
  await w.write({ type: "status", placeId: place.id, payload: { status: input.status } });
  for (const tagId of new Set([...input.tagIds, ...defined])) {
    await w.write({ type: "tag", placeId: place.id, payload: { tagId } });
  }
  const text = input.comment.trim();
  if (text) await w.write({ type: "comment", placeId: place.id, payload: { text } });
  return place.id;
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

/** Sets this person's status, editing their existing status item if there is one. */
export async function setStatus(w: DiaryWriter, placeId: string, status: Status): Promise<void> {
  const mine = own(w, await w.listItems(), "status", placeId);
  const latest = mine.reduce<StoredItem | undefined>((a, b) => (!a || b.updatedAt > a.updatedAt ? b : a), undefined);
  await w.write({ type: "status", placeId, payload: { status }, ...(latest ? { id: latest.id } : {}) });
  // A sync race can leave two; keep one.
  for (const extra of mine) if (extra !== latest) await w.remove(extra.id);
}

/**
 * Applies a tag to a place. With `boards`, an existing application of the tag moves to them;
 * the caller checks the tag's definition is visible there (`tagFit`).
 */
export async function applyTag(w: DiaryWriter, placeId: string, tagId: string, boards?: string[]): Promise<void> {
  const items = await requireStatus(w, placeId);
  const already = own(w, items, "tag", placeId).find((i) => readPayload("tag", i.payload)?.tagId === tagId);
  if (!already) await w.write({ type: "tag", placeId, payload: { tagId }, ...on(boards) });
  else if (boards && !sameBoards(already.boardIds, boards)) {
    await w.write({ type: "tag", placeId, payload: { tagId }, id: already.id, ...on(boards) });
  }
}

/** Removes every tag opinion of this person applying `tagId` to the place. */
export async function unapplyTag(w: DiaryWriter, placeId: string, tagId: string): Promise<void> {
  for (const i of own(w, await w.listItems(), "tag", placeId)) {
    if (readPayload("tag", i.payload)?.tagId === tagId) await w.remove(i.id);
  }
}

/** Defines a tag, visible on `boards` (Personal by default). Returns its id. */
export async function defineTag(w: DiaryWriter, def: TagDefPayload, boards?: string[]): Promise<string> {
  const clean = cleanTag(def);
  if (!clean.name) throw new EntryError("A tag needs a name");
  return (await w.write({ type: "tag_def", placeId: null, payload: json(clean), ...on(boards) })).id;
}

/** Makes one of this person's tag definitions visible on more boards, keeping where it already is. */
export async function widenTag(w: DiaryWriter, tagId: string, add: readonly string[]): Promise<void> {
  const def = (await w.listItems()).find((i) => i.id === tagId && i.type === "tag_def");
  if (!def || def.authorId !== w.device.accountId) throw new EntryError("Only the person who made a tag can change where it shows");
  const boards = [...new Set([...def.boardIds, ...add])];
  if (sameBoards(def.boardIds, boards)) return;
  await w.write({ type: "tag_def", placeId: null, payload: def.payload, id: def.id, boards });
}

export async function editTag(w: DiaryWriter, id: string, def: TagDefPayload): Promise<void> {
  const clean = cleanTag(def);
  if (!clean.name) throw new EntryError("A tag needs a name");
  await w.write({ type: "tag_def", placeId: null, payload: json(clean), id });
}

export async function addComment(w: DiaryWriter, placeId: string, text: string, boards?: string[]): Promise<void> {
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

/** Rewrites a place's facts. Only its author can, and a place never changes kind. */
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

const sameBoards = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id) => b.includes(id));

function cleanTag(def: TagDefPayload): TagDefPayload {
  return { name: def.name.trim().slice(0, 40), emoji: def.emoji.trim().slice(0, 16), description: def.description.trim().slice(0, 280) };
}

/** A write refused for a reason the person can fix; the message is shown as is. */
export class EntryError extends Error {
  override name = "EntryError";
}
