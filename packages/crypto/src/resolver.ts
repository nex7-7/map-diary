import { getSodium } from "./sodium";
import { CryptoError } from "./errors";
import { fromUtf8, utf8 } from "./encoding";

/**
 * The anonymous resolver queue's wire format, shared by devices, the Worker and the
 * resolver (Claude or a script).
 *
 * A device submits a link or name with a one-time X25519 public key. The resolver
 * returns candidate place facts; the Worker checks them with `parseResolution`, seals
 * them to the job's key with `sealResolverResult`, and forgets the query. Only the
 * device that made the job can open the result.
 */

export const RESOLVER_RESULT_VERSION = 1;

/** Categories a resolver may assign. Custom categories are a person's own choice. */
export const RESOLVER_CATEGORIES = [
  "restaurant",
  "cafe-bar",
  "roadside-stall",
  "desserts",
  "movies",
  "recreation",
  "beach",
] as const;
export type ResolverCategory = (typeof RESOLVER_CATEGORIES)[number];

/** Categories that may carry a signature dish (food and drink only). */
export const FOOD_CATEGORIES = ["restaurant", "cafe-bar", "roadside-stall", "desserts"] as const satisfies readonly ResolverCategory[];
const FOOD: ReadonlySet<ResolverCategory> = new Set(FOOD_CATEGORIES);

/** [west, south, east, north]: the same box the map is limited to. */
export const MUMBAI_BOUNDS = [72.75, 18.85, 73.15, 19.35] as const;

export const MAX_CANDIDATES = 5;
/** The most other outlets one chain can bring along. */
export const MAX_OUTLETS = 40;
const MAX_LINKS = 5;
/** A plausible menu price in rupees for one serving. */
const MAX_PRICE_INR = 50_000;

export interface ResolvedPlace {
  name: string;
  category: ResolverCategory;
  location: { lat: number; lng: number };
  address?: string;
  cuisine?: string;
  /** The dish the place is best known for, at its current menu price for one serving. */
  signatureDish?: { name: string; priceInr: number };
  sourceLinks: string[];
}

/**
 * A chain the match belongs to: its name and its other outlets in Mumbai (not the match
 * itself). The person picks between adding every outlet or only the one they asked for.
 */
export interface ResolvedChain {
  name: string;
  outlets: ResolvedPlace[];
}

/** What a device reads after opening a resolved job. Failed jobs carry no result. */
export interface ResolverResult {
  v: typeof RESOLVER_RESULT_VERSION;
  /** One match, or several for the person to pick from in the Inbox. */
  candidates: ResolvedPlace[];
  /** Set when the match is one outlet of a chain. Devices that predate it ignore it. */
  chain?: ResolvedChain;
}

export type ResolutionProblem =
  | "bad_shape"
  | "no_candidates"
  | "too_many_candidates"
  | "bad_name"
  | "bad_category"
  | "outside_mumbai"
  | "inside_mumbai"
  | "bad_price"
  | "dish_not_food"
  | "bad_link"
  | "bad_chain"
  | "too_many_outlets";

export type ParsedResolution = { ok: true; result: ResolverResult } | { ok: false; problem: ResolutionProblem };

type Obj = { [key: string]: unknown };
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Trims and checks a short text field; undefined if absent, null if present but invalid. */
function text(v: unknown, max: number): string | undefined | null {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  return t.length <= max ? t : null;
}

function insideMumbai(lat: unknown, lng: unknown): boolean {
  const [west, south, east, north] = MUMBAI_BOUNDS;
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lng >= west &&
    lng <= east &&
    lat >= south &&
    lat <= north
  );
}

function onEarth(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

/** `outside` checks for a place beyond Mumbai instead (the one-time import of the owner's old list). */
function parseCandidate(c: unknown, outside = false): ResolvedPlace | ResolutionProblem {
  if (!isObj(c)) return "bad_shape";
  const name = text(c.name, 200);
  if (!name) return "bad_name";
  if (!RESOLVER_CATEGORIES.includes(c.category as ResolverCategory)) return "bad_category";
  const category = c.category as ResolverCategory;
  if (!isObj(c.location)) return "outside_mumbai";
  if (outside) {
    if (!onEarth(c.location.lat, c.location.lng)) return "bad_shape";
    if (insideMumbai(c.location.lat, c.location.lng)) return "inside_mumbai";
  } else if (!insideMumbai(c.location.lat, c.location.lng)) {
    return "outside_mumbai";
  }
  const lat = Math.round((c.location.lat as number) * 1e6) / 1e6;
  const lng = Math.round((c.location.lng as number) * 1e6) / 1e6;

  const address = text(c.address, 300);
  const cuisine = text(c.cuisine, 100);
  if (address === null || cuisine === null) return "bad_shape";

  const links = c.sourceLinks ?? [];
  if (!Array.isArray(links) || links.length > MAX_LINKS) return "bad_link";
  const sourceLinks: string[] = [];
  for (const l of links) {
    if (typeof l !== "string" || l.length > 2000 || !/^https:\/\/[^\s]+$/.test(l)) return "bad_link";
    if (!sourceLinks.includes(l)) sourceLinks.push(l);
  }

  const place: ResolvedPlace = { name, category, location: { lat, lng }, sourceLinks };
  if (address) place.address = address;
  if (cuisine) place.cuisine = cuisine;

  if (c.signatureDish !== undefined && c.signatureDish !== null) {
    if (!FOOD.has(category)) return "dish_not_food";
    const d = c.signatureDish;
    if (!isObj(d)) return "bad_shape";
    const dish = text(d.name, 120);
    if (!dish) return "bad_shape";
    const price = d.priceInr;
    if (typeof price !== "number" || !Number.isInteger(price) || price < 1 || price > MAX_PRICE_INR) {
      return "bad_price";
    }
    place.signatureDish = { name: dish, priceInr: price };
  }
  return place;
}

/**
 * Checks a resolver's answer: one to five candidates, each with a name, a known
 * category, coordinates inside Mumbai and, for food and drink only, a signature dish
 * with a whole-rupee price, plus an optional chain whose outlets pass the same checks.
 * Text is trimmed and coordinates rounded to six decimals.
 */
export function parseResolution(value: unknown): ParsedResolution {
  if (!isObj(value) || !Array.isArray(value.candidates)) return { ok: false, problem: "bad_shape" };
  if (value.candidates.length === 0) return { ok: false, problem: "no_candidates" };
  if (value.candidates.length > MAX_CANDIDATES) return { ok: false, problem: "too_many_candidates" };
  const candidates: ResolvedPlace[] = [];
  for (const c of value.candidates) {
    const parsed = parseCandidate(c);
    if (typeof parsed === "string") return { ok: false, problem: parsed };
    candidates.push(parsed);
  }
  const result: ResolverResult = { v: RESOLVER_RESULT_VERSION, candidates };
  if (value.chain !== undefined && value.chain !== null) {
    const chain = parseChain(value.chain);
    if (typeof chain === "string") return { ok: false, problem: chain };
    if (chain) result.chain = chain;
  }
  return { ok: true, result };
}

/**
 * Checks one place outside Mumbai, like a candidate but with coordinates anywhere else. Only
 * the Claude assistant's one-time import uses it, and such a place never enters the catalogue.
 */
export function parseOutsidePlace(value: unknown): ResolvedPlace | ResolutionProblem {
  return parseCandidate(value, true);
}

/** A chain's name and other outlets, each checked like a candidate. No outlets means no chain. */
function parseChain(c: unknown): ResolvedChain | undefined | ResolutionProblem {
  if (!isObj(c) || !Array.isArray(c.outlets)) return "bad_chain";
  const name = text(c.name, 200);
  if (!name) return "bad_chain";
  if (c.outlets.length > MAX_OUTLETS) return "too_many_outlets";
  const outlets: ResolvedPlace[] = [];
  for (const o of c.outlets) {
    const parsed = parseCandidate(o);
    if (typeof parsed === "string") return parsed;
    outlets.push(parsed);
  }
  return outlets.length > 0 ? { name, outlets } : undefined;
}

/** A one-time keypair for one resolver job. Keep the secret key on the device until the job is done. */
export interface ReplyKeys {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export function generateReplyKeys(): ReplyKeys {
  const { publicKey, privateKey } = getSodium().crypto_box_keypair();
  return { publicKey, secretKey: privateKey };
}

export const REPLY_PUBLIC_KEY_BYTES = 32;

/** Seals a checked result to the job's one-time public key (anonymous sealed box). */
export function sealResolverResult(result: ResolverResult, replyPublicKey: Uint8Array): Uint8Array {
  if (replyPublicKey.length !== REPLY_PUBLIC_KEY_BYTES) {
    throw new CryptoError("invalid_input", "Reply public key must be 32 bytes");
  }
  return getSodium().crypto_box_seal(utf8(JSON.stringify(result)), replyPublicKey);
}

/** Opens a sealed result on the device and re-checks it, since it came through the server. */
export function openResolverResult(sealed: Uint8Array, keys: ReplyKeys): ResolverResult {
  let plain: Uint8Array;
  try {
    plain = getSodium().crypto_box_seal_open(sealed, keys.publicKey, keys.secretKey);
  } catch {
    throw new CryptoError("decrypt_failed", "Could not open the resolver result");
  }
  let value: unknown;
  try {
    value = JSON.parse(fromUtf8(plain));
  } catch {
    throw new CryptoError("bad_payload", "Resolver result is not JSON");
  }
  if (!isObj(value) || value.v !== RESOLVER_RESULT_VERSION) {
    throw new CryptoError("unsupported_version", "Unknown resolver result version");
  }
  const parsed = parseResolution(value);
  if (!parsed.ok) throw new CryptoError("bad_payload", "Resolver result failed its checks");
  return parsed.result;
}

/** "The Bombay Cartel" and "bombay cartel" are the same chain. */
export function normaliseChainName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the /, "");
}
