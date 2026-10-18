import { describe, expect, it } from "vitest";
import { distanceMetres, EMPTY_FILTERS, filterPlaces, formatDistance, sortPlaces, type PlaceFilters } from "../lib/places/filter";
import { fixtureSnapshot } from "../lib/places/fixtures";
import { createFixtureSource } from "../lib/places/source";
import type { PlaceView } from "../lib/places/types";

const { me, places } = fixtureSnapshot();
const ids = (xs: { place: PlaceView }[]) => xs.map((x) => x.place.id);
const filter = (f: Partial<PlaceFilters>, here?: { lng: number; lat: number }) =>
  filterPlaces(places, { ...EMPTY_FILTERS, ...f }, me.id, here);

describe("filterPlaces", () => {
  it("lists only places with a status opinion", () => {
    const listed = filter({});
    expect(listed).toHaveLength(places.length);
    const bare: PlaceView = { ...places[0]!, id: "p-bare", opinions: places[0]!.opinions.filter((o) => o.kind !== "status") };
    expect(filterPlaces([bare], EMPTY_FILTERS, me.id)).toEqual([]);
  });

  it("prefers my own status over others'", () => {
    const bademiya = filter({}).find((l) => l.place.id === "p-bademiya")!;
    expect(bademiya).toMatchObject({ status: "want", mine: true });
    const sgnp = filter({}).find((l) => l.place.id === "p-sgnp")!;
    expect(sgnp).toMatchObject({ status: "visited", mine: false });
  });

  it("filters by board using only status opinions on that board", () => {
    const duo = ids(filter({ boards: ["group:duo"] }));
    expect(duo.sort()).toEqual(["p-board-games", "p-prithvi", "p-swati"]);
  });

  it("uses the status that passes the board filter", () => {
    // My status on Bademiya is Personal; Kabir's Visited is on the college board.
    const bademiya = filter({ boards: ["group:college"] }).find((l) => l.place.id === "p-bademiya")!;
    expect(bademiya).toMatchObject({ status: "visited", mine: false });
  });

  it("filters by status, author, category, cuisine and tag", () => {
    expect(ids(filter({ statuses: ["visited"], authorIds: [me.id], categories: ["beach"] }))).toEqual(["p-chowpatty"]);
    expect(ids(filter({ cuisines: ["Irani"] }))).toEqual(["p-kyani"]);
    expect(ids(filter({ tagIds: ["t-spicy"] })).sort()).toEqual(["p-aaswad", "p-bademiya"]);
    // A tag on another board does not count when a board is chosen.
    expect(ids(filter({ tagIds: ["t-spicy"], boards: ["group:college"] }))).toEqual([]);
  });

  it("filters by signature-dish price, dropping unpriced places", () => {
    const cheap = filter({ maxPriceInr: 200 });
    expect(ids(cheap).sort()).toEqual(["p-aaswad", "p-kyani", "p-madras"]);
  });

  it("matches the search query against name, cuisine and dish", () => {
    expect(ids(filter({ query: "dosa" }))).toEqual(["p-madras"]);
    expect(ids(filter({ query: "  JUHU " })).sort()).toEqual(["p-juhu", "p-prithvi"]); // Prithvi is on Juhu Church Road
  });
});

describe("sortPlaces", () => {
  it("sorts by distance from a given position", () => {
    const colaba = { lng: 72.8316, lat: 18.9225 };
    const sorted = sortPlaces(filter({}, colaba), "distance");
    expect(ids(sorted).slice(0, 3)).toEqual(["p-leopold", "p-bademiya", "p-regal"]);
    expect(sorted.at(-1)!.place.id).toBe("p-sgnp");
  });

  it("falls back to newest first without a position", () => {
    const sorted = sortPlaces(filter({}), "distance");
    expect(sorted[0]!.place.id).toBe("p-rooftop");
  });

  it("sorts by price with unpriced places last", () => {
    const sorted = sortPlaces(filter({}), "price");
    expect(sorted[0]!.place.id).toBe("p-kyani");
    expect(sorted.at(-1)!.place.signatureDish).toBeUndefined();
  });
});

describe("distance", () => {
  it("measures Colaba to Juhu at about 20 km", () => {
    const d = distanceMetres({ lng: 72.8316, lat: 18.9225 }, { lng: 72.8264, lat: 19.0988 });
    expect(d).toBeGreaterThan(19_000);
    expect(d).toBeLessThan(20_500);
    expect(formatDistance(d)).toMatch(/^\d+ km$/);
    expect(formatDistance(437)).toBe("440 m");
    expect(formatDistance(2345)).toBe("2.3 km");
  });
});

describe("fixture source", () => {
  it("adds a Personal status when I have none, and updates mine otherwise", async () => {
    const source = createFixtureSource(() => new Date("2026-10-18T00:00:00Z"));
    let snap = await source.setStatus("p-sgnp", "want");
    const mine = snap.places.find((p) => p.id === "p-sgnp")!.opinions.find((o) => o.authorId === me.id);
    expect(mine).toMatchObject({ kind: "status", status: "want", boards: ["personal"] });

    snap = await source.setStatus("p-juhu", "visited");
    const juhu = snap.places.find((p) => p.id === "p-juhu")!.opinions;
    expect(juhu).toHaveLength(1);
    expect(juhu[0]).toMatchObject({ status: "visited", boards: ["personal"] });
  });
});
