import type { Board, Category, LngLat, Opinion, PlaceView, Status, StatusOpinion } from "./types";

export interface PlaceFilters {
  /** Matches name, address, cuisine and signature dish, case-insensitively. */
  query: string;
  /** Board ids; empty means every board this device can read. */
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
}

/**
 * Whether an opinion shows on any selected board. A group's board shows only its members'
 * opinions, posted to the group or to the master board; other boards show what is posted to them.
 */
function onBoards(selected: readonly string[], o: Opinion, boards: ReadonlyMap<string, Board>): boolean {
  if (selected.length === 0) return true;
  return selected.some((id) => {
    const board = boards.get(id);
    if (!board?.memberIds) return o.boards.includes(id);
    if (!board.memberIds.includes(o.authorId)) return false;
    return o.boards.some((b) => b === id || boards.get(b)?.kind === "master");
  });
}

/**
 * Applies the filters. A place is listed only when some status opinion passes
 * the board, status and author filters: tags and comments alone never list it.
 */
export function filterPlaces(
  places: readonly PlaceView[],
  filters: PlaceFilters,
  meId: string,
  here?: LngLat,
  boards: readonly Board[] = [],
): ListedPlace[] {
  const query = filters.query.trim().toLowerCase();
  const boardsById = new Map(boards.map((b) => [b.id, b]));
  const out: ListedPlace[] = [];

  for (const place of places) {
    if (filters.categories.length > 0 && !filters.categories.includes(place.category)) continue;
    if (filters.cuisines.length > 0 && (place.cuisine === undefined || !filters.cuisines.includes(place.cuisine))) continue;
    if (filters.maxPriceInr !== null && (place.signatureDish === undefined || place.signatureDish.priceInr > filters.maxPriceInr)) continue;
    if (query && !searchText(place).includes(query)) continue;

    const statuses = place.opinions.filter(
      (o): o is StatusOpinion =>
        o.kind === "status" &&
        onBoards(filters.boards, o, boardsById) &&
        (filters.statuses.length === 0 || filters.statuses.includes(o.status)) &&
        (filters.authorIds.length === 0 || filters.authorIds.includes(o.authorId)),
    );
    if (statuses.length === 0) continue;

    if (filters.tagIds.length > 0) {
      const tagged = place.opinions.some(
        (o) => o.kind === "tag" && filters.tagIds.includes(o.tagId) && onBoards(filters.boards, o, boardsById),
      );
      if (!tagged) continue;
    }

    const own = statuses.find((o) => o.authorId === meId);
    const status: Status = own?.status ?? (statuses.some((o) => o.status === "visited") ? "visited" : "want");
    const addedAt = statuses.reduce((min, o) => (o.createdAt < min ? o.createdAt : min), statuses[0]!.createdAt);
    const listed: ListedPlace = { place, status, mine: own !== undefined, addedAt };
    if (here) listed.distanceM = distanceMetres(here, place.location);
    out.push(listed);
  }
  return out;
}

/** Sorts a copy. Distance falls back to date added when there is no position. */
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
  return [...listed].sort(compare);
}

function searchText(place: PlaceView): string {
  return [place.name, place.address, place.cuisine, place.signatureDish?.name].filter(Boolean).join(" ").toLowerCase();
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
