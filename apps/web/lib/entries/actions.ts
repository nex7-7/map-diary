import type { EnvelopeType, JsonValue } from "@map-diary/crypto";
import type { StoredItem } from "../places/items-source";
import { readPayload, type CommentPayload, type PlacePayload, type TagDefPayload } from "../places/payloads";
import type { Status } from "../places/types";
import { normaliseLink } from "./parse-input";

/**
 * Writes for the Add sheet and the place page, over the device's diary. Everything goes to
 * the Personal board for now (the diary picks the board); boards arrive with sharing.
 */

/** The parts of the device's `Diary` these writes need. */
export interface DiaryWriter {
  readonly device: { readonly accountId: string };
  listItems(): Promise<StoredItem[]>;
  write(input: { type: EnvelopeType; placeId: string | null; payload: JsonValue; id?: string }): Promise<{ id: string }>;
  remove(id: string): Promise<void>;
}

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

export async function applyTag(w: DiaryWriter, placeId: string, tagId: string): Promise<void> {
  const items = await requireStatus(w, placeId);
  const already = own(w, items, "tag", placeId).some((i) => readPayload("tag", i.payload)?.tagId === tagId);
  if (!already) await w.write({ type: "tag", placeId, payload: { tagId } });
}

/** Removes every tag opinion of this person applying `tagId` to the place. */
export async function unapplyTag(w: DiaryWriter, placeId: string, tagId: string): Promise<void> {
  for (const i of own(w, await w.listItems(), "tag", placeId)) {
    if (readPayload("tag", i.payload)?.tagId === tagId) await w.remove(i.id);
  }
}

/** Defines a tag. Returns its id. */
export async function defineTag(w: DiaryWriter, def: TagDefPayload): Promise<string> {
  const clean = cleanTag(def);
  if (!clean.name) throw new EntryError("A tag needs a name");
  return (await w.write({ type: "tag_def", placeId: null, payload: json(clean) })).id;
}

export async function editTag(w: DiaryWriter, id: string, def: TagDefPayload): Promise<void> {
  const clean = cleanTag(def);
  if (!clean.name) throw new EntryError("A tag needs a name");
  await w.write({ type: "tag_def", placeId: null, payload: json(clean), id });
}

export async function addComment(w: DiaryWriter, placeId: string, text: string): Promise<void> {
  const payload: CommentPayload = { text: text.trim() };
  if (!payload.text) throw new EntryError("A comment needs some text");
  await requireStatus(w, placeId);
  await w.write({ type: "comment", placeId, payload: json(payload) });
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

function cleanTag(def: TagDefPayload): TagDefPayload {
  return { name: def.name.trim().slice(0, 40), emoji: def.emoji.trim().slice(0, 16), description: def.description.trim().slice(0, 280) };
}

/** A write refused for a reason the person can fix; the message is shown as is. */
export class EntryError extends Error {
  override name = "EntryError";
}
