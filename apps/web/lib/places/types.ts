import type { DishRule, PricedDish } from "@map-diary/crypto";
import type { AvatarPayload } from "./payloads";
/**
 * What the map and list see: decrypted places and opinions, already limited to
 * what this device may read. Envelopes, keys and sync live elsewhere; a
 * `DiarySource` hands the UI this shape.
 */

export type Status = "visited" | "want";

export const BUILTIN_CATEGORIES = ["restaurant", "one-hit-wonder", "cafe-bar", "roadside-stall", "desserts", "movies", "recreation", "beach"] as const;
export type BuiltinCategory = (typeof BUILTIN_CATEGORIES)[number];
/** A built-in category, or the id of a custom one (`custom:<slug>`). */
export type Category = BuiltinCategory | `custom:${string}`;

export type BoardKind = "master" | "group" | "personal";

export interface Board {
  id: string;
  kind: BoardKind;
  name: string;
  /** Account ids of the board's members; `null` means everyone on the app (the master board). */
  memberIds: string[] | null;
}

export interface Person {
  id: string;
  name: string;
  avatar?: AvatarPayload;
}

export interface LngLat {
  lng: number;
  lat: number;
}

/**
 * The wallet bleeder: a price to judge a food place by. Newer ones say how it was picked
 * (`rule`, see DISH_RULES in @map-diary/crypto) and list the dishes; for `starters` and
 * `focused` the price is their median and `name` says what they are ("Chicken appetizers").
 */
export interface SignatureDish {
  name: string;
  /** Menu price in rupees. */
  priceInr: number;
  rule?: DishRule;
  section?: string;
  chicken?: boolean;
  dishes?: PricedDish[];
}

/** A chain of outlets, named by the resolver; every outlet carries the same id. */
export interface PlaceChain {
  id: string;
  name: string;
}

/** One outlet of a chain: its own pin, address and links. */
export interface Outlet {
  id: string;
  name: string;
  location: LngLat;
  address?: string;
  sourceLinks: string[];
  signatureDish?: SignatureDish;
}

/** Shared facts about a place (catalogue entry or a private dropped pin). */
export interface PlaceFacts {
  id: string;
  name: string;
  category: Category;
  location: LngLat;
  address?: string;
  cuisine?: string;
  /** Food and drink places only. */
  signatureDish?: SignatureDish;
  sourceLinks: string[];
  /** A dropped pin: never in the shared catalogue. */
  isPrivate: boolean;
  /** The chain this place is an outlet of. */
  chain?: PlaceChain;
}

interface OpinionBase {
  id: string;
  authorId: string;
  /** The place (for a chain, the outlet) the opinion is attached to. */
  placeId?: string;
  /** Boards this device knows that the opinion is posted to and its author belongs to: its badges. */
  boards: string[];
  /**
   * Boards whose view shows it: its own boards, plus each group the author is in when it is
   * posted to master. Filled in by `applyBoardRules`.
   */
  shownOn: string[];
  /** Written by the author's Claude assistant: shown as "<name> via Claude". */
  viaClaude?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StatusOpinion extends OpinionBase {
  kind: "status";
  status: Status;
  /** Visited only: the day of the visit when it is not `updatedAt`. Read it with `visitedOn`. */
  visitedAt?: string;
  /**
   * Visited on a chain: the outlets the person has been to. Missing means the one the status
   * is attached to (`placeId`). Read it with `visitedOutlets`.
   */
  outlets?: string[];
}

export interface TagOpinion extends OpinionBase {
  kind: "tag";
  tagId: string;
}

export interface CommentOpinion extends OpinionBase {
  kind: "comment";
  text: string;
  /** On a chain: about every outlet rather than the one it is attached to. */
  allOutlets?: boolean;
}

export type Opinion = StatusOpinion | TagOpinion | CommentOpinion;

export interface TagDefinition {
  id: string;
  authorId: string;
  name: string;
  emoji: string;
  description: string;
  boards: string[];
}

/**
 * One place page. For a chain, `id` and the facts are its first outlet's, `name` is the
 * chain's, `outlets` lists every outlet, and `opinions` gathers them all: status and tags
 * count for the whole chain, comments say which outlet they are about.
 */
export interface PlaceView extends PlaceFacts {
  /** Every outlet of the chain, first one first; absent for a place that is not a chain. */
  outlets?: Outlet[];
  /** Boards this device knows that the place itself is posted to. */
  boards: string[];
  /** Every opinion on this place this device can read. */
  opinions: Opinion[];
}

export interface DiarySnapshot {
  me: Person;
  people: Person[];
  boards: Board[];
  tags: TagDefinition[];
  places: PlaceView[];
}

/**
 * The UI's only door to diary data. `createFixtureSource` serves sample data in
 * memory; `createItemsSource` serves the device's decrypted items.
 */
export interface DiarySource {
  load(): Promise<DiarySnapshot>;
  /** Calls `listener` whenever the data may have changed (local writes, sync pulls). */
  subscribe(listener: () => void): () => void;
  /** Sets the device owner's status on a place, keeping its boards (Personal if new). */
  setStatus(placeId: string, status: Status): Promise<DiarySnapshot>;
}
