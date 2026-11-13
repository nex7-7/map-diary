import { DISH_RULES, MAX_DISHES, type DishRule, type EnvelopeType, type JsonValue } from "@map-diary/crypto";
import { oneEmoji } from "../entries/emoji";
import { BUILTIN_CATEGORIES, type Category, type LngLat, type PlaceChain, type SignatureDish, type Status } from "./types";

/**
 * The decrypted payload of each envelope type, and strict readers for them.
 * Payloads arrive from other devices, so every field is checked; a payload that
 * does not fit is dropped rather than shown half-read.
 */

export interface PlacePayload {
  name: string;
  category: Category;
  location: LngLat;
  address?: string;
  cuisine?: string;
  signatureDish?: SignatureDish;
  sourceLinks: string[];
  /** Set when the place is one outlet of a chain; outlets with the same chain id are one place page. */
  chain?: PlaceChain;
  /** Set by the admin on a duplicate: the place it was merged into, where its opinions now show. */
  mergedInto?: string;
  /** Set by the admin on the place kept by a merge: the duplicates merged into it. */
  mergedFrom?: string[];
}

/** Most duplicates one place records as merged into it. */
export const MERGED_FROM_MAX = 50;
const PLACE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const CHAIN_NAME_MAX = 200;

export interface StatusPayload {
  status: Status;
  /**
   * Visited only: the day of the visit, in milliseconds since the epoch, when it is not the
   * time the status was written (the person changed it, or the place was found later).
   */
  visitedAt?: number;
  /**
   * Visited on a chain: the outlets (place ids) the person has been to. Missing means the one
   * the status is attached to. The other outlets show as not visited yet.
   */
  outlets?: string[];
}

/** Most outlets a status can name as visited. */
export const VISITED_OUTLETS_MAX = 60;

export interface TagDefPayload {
  name: string;
  emoji: string;
  description: string;
}

export interface TagPayload {
  tagId: string;
}

export interface CommentPayload {
  text: string;
  /** On a chain: about every outlet, not just the one the comment is attached to. */
  allOutlets?: true;
  /** When it was first written (ms), kept when it moves to another outlet of the chain. */
  writtenAt?: number;
}

export interface ProfilePayload {
  /** How the person appears to everyone on the app. */
  name: string;
  /** Their picture; without one they show as their initial. */
  avatar?: AvatarPayload;
}

export const DISPLAY_NAME_MAX = 40;

/** One of the four soft colours an initial or emoji sits on. */
export type AvatarTone = 0 | 1 | 2 | 3;

/**
 * A photo, shrunk on the device to a small square and kept inline as a data URL, or an emoji
 * on a colour. Both travel inside the encrypted profile item.
 */
export type AvatarPayload = { kind: "photo"; dataUrl: string } | { kind: "emoji"; emoji: string; tone: AvatarTone };

/** Longest photo data URL accepted, so a profile stays well inside one envelope. */
export const AVATAR_PHOTO_MAX = 24_000;
const PHOTO_URL = /^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/]+={0,2}$/;

/** A group's name, on the group's own board; the newest one from a member wins. */
export interface GroupPayload {
  name: string;
}

/** What the person calls one of their devices, on their Personal board. */
export interface DeviceNamePayload {
  deviceId: string;
  name: string;
}

export const DEVICE_NAME_MAX = 40;

export interface PayloadByType {
  place: PlacePayload;
  private_place: PlacePayload;
  status: StatusPayload;
  tag_def: TagDefPayload;
  tag: TagPayload;
  comment: CommentPayload;
  profile: ProfilePayload;
  group: GroupPayload;
  device_name: DeviceNamePayload;
  /** Read and checked by lib/pending (see `readPendingItem`). */
  pending: JsonObject;
}

export type JsonObject = { [key: string]: JsonValue };

const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: JsonValue | undefined): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: JsonValue | undefined): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function readCategory(v: JsonValue | undefined): Category | undefined {
  const s = str(v);
  if (s === undefined) return undefined;
  if ((BUILTIN_CATEGORIES as readonly string[]).includes(s)) return s as Category;
  return s.startsWith("custom:") && s.length > "custom:".length ? (s as Category) : undefined;
}

/** How a wallet bleeder was picked, when the payload says so; anything malformed is dropped. */
function readDishDetails(d: JsonObject, dish: SignatureDish): SignatureDish {
  const rule = str(d.rule);
  if (!rule || !(DISH_RULES as readonly string[]).includes(rule)) return dish;
  const out: SignatureDish = { ...dish, rule: rule as DishRule };
  const section = str(d.section);
  if (section) out.section = section;
  if (typeof d.chicken === "boolean") out.chicken = d.chicken;
  if (Array.isArray(d.dishes)) {
    const dishes = d.dishes.flatMap((x) => {
      if (!isObject(x)) return [];
      const name = str(x.name);
      const priceInr = num(x.priceInr);
      return name && priceInr !== undefined && priceInr >= 0 ? [{ name, priceInr }] : [];
    });
    if (dishes.length > 0) out.dishes = dishes.slice(0, MAX_DISHES);
  }
  return out;
}

function readPlace(p: JsonObject): PlacePayload | undefined {
  const name = str(p.name)?.trim();
  const category = readCategory(p.category);
  const loc = isObject(p.location) ? p.location : undefined;
  const lng = num(loc?.lng);
  const lat = num(loc?.lat);
  if (!name || !category || lng === undefined || lat === undefined) return undefined;
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return undefined;

  const place: PlacePayload = {
    name,
    category,
    location: { lng, lat },
    sourceLinks: Array.isArray(p.sourceLinks) ? p.sourceLinks.flatMap((l) => (typeof l === "string" && /^https?:\/\//.test(l) ? [l] : [])) : [],
  };
  const address = str(p.address);
  if (address) place.address = address;
  const cuisine = str(p.cuisine);
  if (cuisine) place.cuisine = cuisine;
  if (isObject(p.signatureDish)) {
    const dish = str(p.signatureDish.name);
    const priceInr = num(p.signatureDish.priceInr);
    if (dish && priceInr !== undefined && priceInr >= 0) place.signatureDish = readDishDetails(p.signatureDish, { name: dish, priceInr });
  }
  if (isObject(p.chain)) {
    const id = str(p.chain.id);
    const chainName = str(p.chain.name)?.trim();
    if (id && /^[A-Za-z0-9_-]{1,64}$/.test(id) && chainName && chainName.length <= CHAIN_NAME_MAX) place.chain = { id, name: chainName };
  }
  const mergedInto = str(p.mergedInto);
  if (mergedInto && PLACE_ID.test(mergedInto)) place.mergedInto = mergedInto;
  if (Array.isArray(p.mergedFrom)) {
    const from = p.mergedFrom.flatMap((v) => (typeof v === "string" && PLACE_ID.test(v) ? [v] : [])).slice(0, MERGED_FROM_MAX);
    if (from.length > 0) place.mergedFrom = from;
  }
  return place;
}

const readers: { [T in EnvelopeType]: (p: JsonObject) => PayloadByType[T] | undefined } = {
  place: readPlace,
  private_place: readPlace,
  status: (p) => {
    if (p.status === "want") return { status: "want" };
    if (p.status !== "visited") return undefined;
    const at = num(p.visitedAt);
    const out: StatusPayload = at !== undefined && at > 0 ? { status: "visited", visitedAt: Math.round(at) } : { status: "visited" };
    if (Array.isArray(p.outlets)) {
      const ids = [...new Set(p.outlets.flatMap((v) => (typeof v === "string" && PLACE_ID.test(v) ? [v] : [])))].slice(0, VISITED_OUTLETS_MAX);
      if (ids.length > 0) out.outlets = ids;
    }
    return out;
  },
  tag_def: (p) => {
    const name = str(p.name)?.trim();
    return name ? { name, emoji: str(p.emoji) ?? "", description: str(p.description) ?? "" } : undefined;
  },
  tag: (p) => {
    const tagId = str(p.tagId);
    return tagId ? { tagId } : undefined;
  },
  comment: (p) => {
    const text = str(p.text)?.trim();
    if (!text) return undefined;
    const writtenAt = typeof p.writtenAt === "number" && Number.isFinite(p.writtenAt) && p.writtenAt > 0 ? Math.floor(p.writtenAt) : undefined;
    return { text, ...(p.allOutlets === true ? { allOutlets: true as const } : {}), ...(writtenAt !== undefined ? { writtenAt } : {}) };
  },
  profile: (p) => {
    const name = cleanDisplayName(str(p.name) ?? "");
    if (!name) return undefined;
    const avatar = readAvatar(p.avatar);
    return avatar ? { name, avatar } : { name };
  },
  group: (p) => {
    const name = str(p.name)?.trim();
    return name ? { name } : undefined;
  },
  device_name: (p) => {
    const deviceId = str(p.deviceId);
    const name = cleanDeviceName(str(p.name) ?? "");
    return deviceId && name ? { deviceId, name } : undefined;
  },
  pending: (p) => p,
};

/** Trims a display name, drops control characters and caps its length. */
/** A photo only as a small raster data URL (never SVG), an emoji only as one short emoji. */
export function readAvatar(p: JsonValue | undefined): AvatarPayload | undefined {
  if (!isObject(p)) return undefined;
  if (p.kind === "photo") {
    const dataUrl = str(p.dataUrl);
    return dataUrl && dataUrl.length <= AVATAR_PHOTO_MAX && PHOTO_URL.test(dataUrl) ? { kind: "photo", dataUrl } : undefined;
  }
  if (p.kind === "emoji") {
    const emoji = oneEmoji((str(p.emoji) ?? "").slice(0, 32));
    const tone = p.tone === 0 || p.tone === 1 || p.tone === 2 || p.tone === 3 ? p.tone : 0;
    return emoji ? { kind: "emoji", emoji, tone } : undefined;
  }
  return undefined;
}

export function cleanDisplayName(name: string): string {
  return [...name.replace(/[\p{Cc}\p{Cf}]/gu, "").trim()].slice(0, DISPLAY_NAME_MAX).join("").trim();
}

/** Trims a device name, drops control characters and caps its length. */
export function cleanDeviceName(name: string): string {
  return [...name.replace(/[\p{Cc}\p{Cf}]/gu, "").trim()].slice(0, DEVICE_NAME_MAX).join("").trim();
}

export function readPayload<T extends EnvelopeType>(type: T, payload: JsonValue): PayloadByType[T] | undefined {
  return isObject(payload) ? readers[type](payload) : undefined;
}
