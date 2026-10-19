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
  id: string;
  kind: BoardKind;
  name: string;
  /** Account ids of the board's members; `null` means everyone on the app (the master board). */
  memberIds: string[] | null;
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
  /** Boards this device knows that the opinion is posted to and its author belongs to: its badges. */
  boards: string[];
  /**
   * Boards whose view shows it: its own boards, plus each group the author is in when it is
   * posted to master. Filled in by `applyBoardRules`.
   */
  shownOn: string[];
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
