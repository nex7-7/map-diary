/**
 * What the map and list see: decrypted places and opinions, already limited to
 * what this device may read. Envelopes, keys and sync live elsewhere; a
 * `DiarySource` hands the UI this shape.
 */

export type Status = "visited" | "want";

export const BUILTIN_CATEGORIES = ["restaurant", "cafe-bar", "movies", "recreation", "beach"] as const;
export type BuiltinCategory = (typeof BUILTIN_CATEGORIES)[number];
/** A built-in category, or the id of a custom one (`custom:<slug>`). */
export type Category = BuiltinCategory | `custom:${string}`;

export type BoardKind = "master" | "group" | "personal";

export interface Board {
  /** `master`, `personal`, or `group:<groupId>`. */
  id: string;
  kind: BoardKind;
  name: string;
}

export interface Person {
  id: string;
  name: string;
}

export interface LngLat {
  lng: number;
  lat: number;
}

export interface SignatureDish {
  name: string;
  /** Menu price in rupees. */
  priceInr: number;
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
}

interface OpinionBase {
  id: string;
  authorId: string;
  /** Board ids this opinion is wrapped to. */
  boards: string[];
  createdAt: string;
  updatedAt: string;
}

export interface StatusOpinion extends OpinionBase {
  kind: "status";
  status: Status;
}

export interface TagOpinion extends OpinionBase {
  kind: "tag";
  tagId: string;
}

export interface CommentOpinion extends OpinionBase {
  kind: "comment";
  text: string;
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

export interface PlaceView extends PlaceFacts {
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
 * The UI's only door to diary data. The fixture source implements it in memory;
 * the real one will read IndexedDB and write sealed envelopes.
 */
export interface DiarySource {
  load(): Promise<DiarySnapshot>;
  /** Sets the device owner's status on a place, keeping its boards (Personal if new). */
  setStatus(placeId: string, status: Status): Promise<DiarySnapshot>;
}
