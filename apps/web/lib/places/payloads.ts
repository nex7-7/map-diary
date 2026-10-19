import type { EnvelopeType, JsonValue } from "@map-diary/crypto";
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
}

export const CHAIN_NAME_MAX = 200;

export interface StatusPayload {
  status: Status;
}

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
}

type JsonObject = { [key: string]: JsonValue };

const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: JsonValue | undefined): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: JsonValue | undefined): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function readCategory(v: JsonValue | undefined): Category | undefined {
  const s = str(v);
  if (s === undefined) return undefined;
  if ((BUILTIN_CATEGORIES as readonly string[]).includes(s)) return s as Category;
  return s.startsWith("custom:") && s.length > "custom:".length ? (s as Category) : undefined;
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
    if (dish && priceInr !== undefined && priceInr >= 0) place.signatureDish = { name: dish, priceInr };
  }
  if (isObject(p.chain)) {
    const id = str(p.chain.id);
    const chainName = str(p.chain.name)?.trim();
    if (id && /^[A-Za-z0-9_-]{1,64}$/.test(id) && chainName && chainName.length <= CHAIN_NAME_MAX) place.chain = { id, name: chainName };
  }
  return place;
}

const readers: { [T in EnvelopeType]: (p: JsonObject) => PayloadByType[T] | undefined } = {
  place: readPlace,
  private_place: readPlace,
  status: (p) => (p.status === "visited" || p.status === "want" ? { status: p.status } : undefined),
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
    return p.allOutlets === true ? { text, allOutlets: true } : { text };
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
