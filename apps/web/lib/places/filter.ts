import { visitedOutlets } from "./visited";
import type { Category, DiarySnapshot, LngLat, Person, PlaceView, Status, StatusOpinion } from "./types";

export interface PlaceFilters {
  /** Matches the name, or word starts in the address, cuisine, dishes and outlets. See `searchRank`. */
  query: string;
  /** Board ids; empty means every board this device can read. A board shows only its members' opinions. */
  boards: string[];
  statuses: Status[];
  categories: Category[];
  tagIds: string[];
  cuisines: string[];
  /** Upper bound on the signature-dish price; places without one are dropped when set. */
  maxPriceInr: number | null;
  /** Whose status opinions count; empty means anyone's. */
  authorIds: string[];
}

export const EMPTY_FILTERS: PlaceFilters = {
  query: "",
  boards: [],
  statuses: [],
  categories: [],
  tagIds: [],
  cuisines: [],
  maxPriceInr: null,
  authorIds: [],
};

export type SortKey = "distance" | "added" | "price";

export interface ListedPlace {
  place: PlaceView;
  /** The owner's own status if it passes the filters, otherwise the others'. */
  status: Status;
  /** True when `status` is the device owner's own. */
  mine: boolean;
  /** Earliest matching status opinion: when the place went on the list. */
  addedAt: string;
  /** Metres from the given position, if one was given. */
  distanceM?: number;
  /** With a search: how well the place matched, 0 best. Results are ranked by it before the chosen sort. */
  searchRank?: number;
  /** On a chain the owner stamped Visited: the outlets they have been to. The others show as not been yet. */
  visitedOutlets?: ReadonlySet<string>;
}

const overlaps = (selected: readonly string[], values: readonly string[]) =>
  selected.length === 0 || values.some((v) => selected.includes(v));

/**
 * Applies the filters. A place is listed only when some status opinion passes
 * the board, status and author filters: tags and comments alone never list it.
 */
export function filterPlaces(places: readonly PlaceView[], filters: PlaceFilters, meId: string, here?: LngLat): ListedPlace[] {
  const query = normalise(filters.query);
  const out: ListedPlace[] = [];

  for (const place of places) {
    if (filters.categories.length > 0 && !filters.categories.includes(place.category)) continue;
    if (filters.cuisines.length > 0 && (place.cuisine === undefined || !filters.cuisines.includes(place.cuisine))) continue;
    if (filters.maxPriceInr !== null && (place.signatureDish === undefined || place.signatureDish.priceInr > filters.maxPriceInr)) continue;
    const rank = query ? searchRank(place, query) : undefined;
    if (rank === null) continue;

    const statuses = place.opinions.filter(
      (o): o is StatusOpinion =>
        o.kind === "status" &&
        overlaps(filters.boards, o.shownOn) &&
        (filters.statuses.length === 0 || filters.statuses.includes(o.status)) &&
        (filters.authorIds.length === 0 || filters.authorIds.includes(o.authorId)),
    );
    if (statuses.length === 0) continue;

    if (filters.tagIds.length > 0) {
      const tagged = place.opinions.some(
        (o) => o.kind === "tag" && filters.tagIds.includes(o.tagId) && overlaps(filters.boards, o.shownOn),
      );
      if (!tagged) continue;
    }

    const own = statuses.find((o) => o.authorId === meId);
    const status: Status = own?.status ?? (statuses.some((o) => o.status === "visited") ? "visited" : "want");
    const addedAt = statuses.reduce((min, o) => (o.createdAt < min ? o.createdAt : min), statuses[0]!.createdAt);
    const listed: ListedPlace = { place, status, mine: own !== undefined, addedAt };
    if (rank !== undefined) listed.searchRank = rank;
    if (own?.status === "visited" && place.outlets && place.outlets.length > 1) listed.visitedOutlets = visitedOutlets(place, own);
    // A chain is as near as its nearest outlet.
    if (here) listed.distanceM = Math.min(...(place.outlets ?? [place]).map((o) => distanceMetres(here, o.location)));
    out.push(listed);
  }
  return out;
}

/**
 * Sorts a copy. Distance falls back to date added when there is no position.
 * With a search, the best matches come first and the chosen sort orders places within each rank.
 */
export function sortPlaces(listed: readonly ListedPlace[], key: SortKey): ListedPlace[] {
  const byAdded = (a: ListedPlace, b: ListedPlace) => b.addedAt.localeCompare(a.addedAt);
  const byName = (a: ListedPlace, b: ListedPlace) => a.place.name.localeCompare(b.place.name);
  const compare = {
    added: (a: ListedPlace, b: ListedPlace) => byAdded(a, b) || byName(a, b),
    distance: (a: ListedPlace, b: ListedPlace) =>
      a.distanceM === undefined || b.distanceM === undefined ? byAdded(a, b) : a.distanceM - b.distanceM || byName(a, b),
    // Cheapest first; places without a price go last.
    price: (a: ListedPlace, b: ListedPlace) =>
      (a.place.signatureDish?.priceInr ?? Infinity) - (b.place.signatureDish?.priceInr ?? Infinity) || byName(a, b),
  }[key];
  return [...listed].sort((a, b) => (a.searchRank ?? 0) - (b.searchRank ?? 0) || compare(a, b));
}

/** Lower case, accents and apostrophes dropped, other punctuation and runs of space as one space. */
export function normalise(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’‘`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** True when `needle` appears in `hay` starting at the start of a word. Both normalised. */
const atWordStart = (hay: string, needle: string) => hay.startsWith(needle) || hay.includes(` ${needle}`);

/**
 * How well a place matches a normalised search, 0 best, or null for no match:
 * 0 the name is the search; 1 the name starts with it; 2 a word in the name starts with it;
 * 3 every search word starts a word in the name; 4 every search word starts a word in the name,
 * address, cuisine, dishes or outlets; 5 the name holds the search inside a word.
 * Other fields never match inside a word, so "era" no longer finds "Opera House" or "Mediterranean".
 */
export function searchRank(place: PlaceView, query: string): number | null {
  const names = [place.name, ...(place.outlets?.map((o) => o.name) ?? [])].map(normalise);
  const words = query.split(" ");
  if (names.some((n) => n === query)) return 0;
  if (names.some((n) => n.startsWith(query))) return 1;
  if (names.some((n) => atWordStart(n, query))) return 2;
  if (names.some((n) => words.every((w) => atWordStart(n, w)))) return 3;
  const dishes = place.signatureDish?.dishes?.map((d) => d.name) ?? [];
  const outletAddresses = place.outlets?.map((o) => o.address) ?? [];
  const other = [place.name, place.address, place.cuisine, place.signatureDish?.name, ...dishes, ...outletAddresses, ...names]
    .filter((t): t is string => Boolean(t))
    .map(normalise)
    .join(" ");
  if (words.every((w) => atWordStart(other, w))) return 4;
  if (names.some((n) => n.includes(query))) return 5;
  return null;
}

const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance (haversine). Runs on the device; positions never leave it. */
export function distanceMetres(a: LngLat, b: LngLat): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

/** Distinct cuisines across places, for the filter picker. */
export function cuisinesOf(places: readonly PlaceView[]): string[] {
  return [...new Set(places.flatMap((p) => (p.cuisine ? [p.cuisine] : [])))].sort();
}

/**
 * Who the "Added by" filter offers: me, and everyone with a status on a place this device can
 * see. People who left the app or wrote nothing visible are left out, unless already picked.
 */
export function authorsOf(snapshot: DiarySnapshot, picked: readonly string[]): Person[] {
  const ids = new Set<string>([snapshot.me.id, ...picked]);
  for (const p of snapshot.places) for (const o of p.opinions) if (o.kind === "status") ids.add(o.authorId);
  return snapshot.people.filter((p) => ids.has(p.id));
}
