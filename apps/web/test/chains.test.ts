import { describe, expect, it } from "vitest";
import type { JsonValue } from "@map-diary/crypto";
import { addComment, applyTag, editComment, setStatus, unapplyTag } from "../lib/entries/actions";
import { buildFacts, formFromFacts } from "../lib/entries/facts";
import { addressArea, chainFor, normaliseChainName, outletLabel, viewOf } from "../lib/places/chains";
import { EMPTY_FILTERS, filterPlaces } from "../lib/places/filter";
import { pinsCollection } from "../lib/map/style";
import { readPayload, type PlacePayload } from "../lib/places/payloads";
import { FakeDiary } from "./fake-diary";

const chain = { id: "chain-tbc", name: "The Bombay Cartel" };
const outlet = (address: string, lat: number): PlacePayload => ({
  name: "The Bombay Cartel",
  category: "restaurant",
  location: { lat, lng: 72.83 },
  address,
  sourceLinks: [],
  chain,
});

async function twoOutlets() {
  const diary = new FakeDiary();
  const parel = await diary.write({ type: "place", placeId: null, payload: outlet("Kamala Mills, Lower Parel, Mumbai", 19.0) as unknown as JsonValue });
  const bandra = await diary.write({ type: "place", placeId: null, payload: outlet("Linking Road, Bandra", 19.06) as unknown as JsonValue });
  return { diary, parel: parel.id, bandra: bandra.id };
}

describe("chains", () => {
  it("shows a chain's outlets as one place, led by the first one added", async () => {
    const { diary, parel, bandra } = await twoOutlets();
    await setStatus(diary, bandra, "want");
    const places = diary.snapshot().places;
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({ id: parel, name: "The Bombay Cartel" });
    expect(places[0]!.outlets?.map((o) => o.id)).toEqual([parel, bandra]);
    expect(viewOf(places, bandra)?.id).toBe(parel);
    expect(outletLabel(places[0]!, places[0]!.outlets![0]!)).toBe("Lower Parel");
  });

  it("names an outlet by its neighbourhood, not its city or postcode", () => {
    expect(addressArea("Unit 1, Kamala Mills, Lower Parel, Mumbai 400013")).toBe("Lower Parel");
    expect(addressArea("Todi Mill, Lower Parel, Mumbai, Maharashtra 400013, India")).toBe("Lower Parel");
    expect(addressArea("Hill Road, Bandra West, Mumbai - 400 050")).toBe("Bandra West");
    expect(addressArea("Mumbai 400001")).toBeUndefined();
    expect(addressArea(undefined)).toBeUndefined();
  });

  it("keeps one status per person for the whole chain", async () => {
    const { diary, parel, bandra } = await twoOutlets();
    await setStatus(diary, bandra, "want");
    await setStatus(diary, parel, "visited");
    const statuses = [...diary.items.values()].filter((i) => i.type === "status");
    expect(statuses).toHaveLength(1);
    // Edited in place: still on the outlet it was first set on.
    expect(statuses[0]).toMatchObject({ placeId: bandra, payload: { status: "visited" } });
  });

  it("counts a tag on any outlet for the chain, and removes it from there", async () => {
    const { diary, parel, bandra } = await twoOutlets();
    await setStatus(diary, parel, "want");
    await applyTag(diary, bandra, "tag-cocktails");
    await applyTag(diary, parel, "tag-cocktails");
    expect([...diary.items.values()].filter((i) => i.type === "tag")).toHaveLength(1);
    await unapplyTag(diary, parel, "tag-cocktails");
    expect([...diary.items.values()].filter((i) => i.type === "tag")).toHaveLength(0);
  });

  it("keeps a comment about all locations apart from one about an outlet", async () => {
    const { diary, parel, bandra } = await twoOutlets();
    await setStatus(diary, parel, "want");
    await addComment(diary, parel, "Great cocktails everywhere", undefined, true);
    await addComment(diary, bandra, "Loud on Fridays");
    const comments = diary.snapshot().places[0]!.opinions.filter((o) => o.kind === "comment");
    expect(comments).toMatchObject([
      { text: "Great cocktails everywhere", allOutlets: true, placeId: parel },
      { text: "Loud on Fridays", placeId: bandra },
    ]);
    expect(comments[1]).not.toHaveProperty("allOutlets");

    const all = comments[0]!;
    await editComment(diary, all.id, parel, "Great cocktails at every one");
    expect(readPayload("comment", diary.items.get(all.id)!.payload)).toEqual({ text: "Great cocktails at every one", allOutlets: true });
  });

  it("lists a chain once, as near as its nearest outlet, with a pin per outlet", async () => {
    const { diary, parel } = await twoOutlets();
    await setStatus(diary, parel, "want");
    const listed = filterPlaces(diary.snapshot().places, EMPTY_FILTERS, "acct-me", { lat: 19.06, lng: 72.83 });
    expect(listed).toHaveLength(1);
    expect(listed[0]!.distanceM).toBeLessThan(1);
    expect(pinsCollection(listed, null).features).toHaveLength(2);
  });

  it("joins a chain by name, however it is written", async () => {
    const { diary } = await twoOutlets();
    const items = await diary.listItems();
    expect(normaliseChainName("The Bombay  Cartel!")).toBe("bombay cartel");
    expect(chainFor(items, "bombay cartel")).toEqual(chain);
    expect(chainFor(items, "Theobroma", () => "new-id")).toEqual({ id: "new-id", name: "Theobroma" });
  });

  it("keeps a place's chain when its details are edited, and lets the admin set or clear it", () => {
    const facts = outlet("Bandra", 19.06);
    const kept = buildFacts(formFromFacts(facts));
    expect(kept.ok && kept.facts.chain).toEqual(chain);
    const cleared = buildFacts({ ...formFromFacts(facts), chainName: "" });
    expect(cleared.ok && cleared.facts.chain).toBe(undefined);
    const moved = buildFacts({ ...formFromFacts(facts), chainName: "Theobroma" }, (name) => ({ id: "c2", name }));
    expect(moved.ok && moved.facts.chain).toEqual({ id: "c2", name: "Theobroma" });
  });
});
