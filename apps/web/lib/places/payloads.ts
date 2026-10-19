import type { EnvelopeType, JsonValue } from "@map-diary/crypto";
import { BUILTIN_CATEGORIES, type Category, type LngLat, type SignatureDish, type Status } from "./types";

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
}

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
}

export interface ProfilePayload {
  /** How the person appears to everyone on the app. */
  name: string;
}

export const DISPLAY_NAME_MAX = 40;

export interface PayloadByType {
  place: PlacePayload;
  private_place: PlacePayload;
  status: StatusPayload;
  tag_def: TagDefPayload;
  tag: TagPayload;
  comment: CommentPayload;
  profile: ProfilePayload;
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
    return text ? { text } : undefined;
  },
  profile: (p) => {
    const name = cleanDisplayName(str(p.name) ?? "");
    return name ? { name } : undefined;
  },
};

/** Trims a display name, drops control characters and caps its length. */
export function cleanDisplayName(name: string): string {
  return [...name.replace(/[\p{Cc}\p{Cf}]/gu, "").trim()].slice(0, DISPLAY_NAME_MAX).join("").trim();
}

export function readPayload<T extends EnvelopeType>(type: T, payload: JsonValue): PayloadByType[T] | undefined {
  return isObject(payload) ? readers[type](payload) : undefined;
}
