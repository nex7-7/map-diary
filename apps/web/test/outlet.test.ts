import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "@map-diary/crypto";
import { setStatus } from "../lib/entries/actions";
import { addOutlet, chainToJoin, outletFacts } from "../lib/entries/outlet";
import { unwrittenChains } from "../lib/places/chains";
import { readPayload } from "../lib/places/payloads";
import { FakeDiary } from "./fake-diary";

beforeAll(ready);

const MAPS = "https://www.google.com/maps/place/Loyka/@19.149,72.835,17z/data=!3d19.149!4d72.835";
const borivali = {
  name: "Loyka",
  category: "desserts" as const,
  location: { lat: 19.2313, lng: 72.8534 },
  address: "Borivali West, Mumbai",
  cuisine: "Desserts, Bakery",
  signatureDish: { name: "Tres leches", priceInr: 350 },
  sourceLinks: ["https://www.zomato.com/mumbai/loyka-borivali-west"],
};

describe("Add a location from a Google Maps link", () => {
  it("starts a chain on a single place, named after it, and adds the new location at its pin", async () => {
    const diary = new FakeDiary();
    const lead = await diary.write({ type: "place", placeId: null, payload: borivali });
    const join = chainToJoin([...diary.items.values()], lead.id)!;
    expect(join.chain).toEqual({ id: lead.id, name: "Loyka" });
    const facts = outletFacts(join.lead, join.chain, { location: { lat: 19.149, lng: 72.835 }, links: [MAPS], address: "Oshiwara, Andheri West, Mumbai" });
    expect(facts).toMatchObject({ name: "Loyka", category: "desserts", cuisine: "Desserts, Bakery", signatureDish: { priceInr: 350 }, address: "Oshiwara, Andheri West, Mumbai" });

    const done = await addOutlet(diary, lead.id, facts, false);
    expect(done.kind).toBe("added");
    const view = diary.snapshot().places;
    expect(view).toHaveLength(1);
    expect(view[0]!.outlets?.map((o) => o.id)).toEqual([lead.id, done.placeId]);
    // The admin's device writes the chain into the first place's facts.
    expect(unwrittenChains([...diary.items.values()]).map((u) => u.item.id)).toEqual([lead.id]);
  });

  it("marks the new location visited on the person's stamp", async () => {
    const diary = new FakeDiary();
    const lead = await diary.write({ type: "place", placeId: null, payload: borivali });
    await setStatus(diary, lead.id, "visited");
    const join = chainToJoin([...diary.items.values()], lead.id)!;
    const done = await addOutlet(diary, lead.id, outletFacts(join.lead, join.chain, { location: { lat: 19.149, lng: 72.835 }, links: [MAPS], address: "" }), true);
    expect(diary.snapshot().places[0]!.opinions.filter((o) => o.kind === "status")).toMatchObject([{ status: "visited", outlets: [lead.id, done.placeId] }]);
  });

  it("refuses a pin outside Mumbai", async () => {
    const diary = new FakeDiary();
    const lead = await diary.write({ type: "place", placeId: null, payload: borivali });
    const join = chainToJoin([...diary.items.values()], lead.id)!;
    expect(() => outletFacts(join.lead, join.chain, { location: { lat: 18.52, lng: 73.85 }, links: [MAPS], address: "" })).toThrow(/outside Mumbai/);
  });

  it("doesn't add a place the diary already has, and says whether it is in the chain", async () => {
    const diary = new FakeDiary();
    const lead = await diary.write({ type: "place", placeId: null, payload: borivali });
    const alone = await diary.write({ type: "place", placeId: null, payload: { name: "Loyka", category: "desserts", location: { lat: 19.149, lng: 72.835 }, sourceLinks: [MAPS] } });
    const join = chainToJoin([...diary.items.values()], lead.id)!;
    const facts = outletFacts(join.lead, join.chain, { location: { lat: 19.149, lng: 72.835 }, links: [MAPS], address: "" });
    expect(await addOutlet(diary, lead.id, facts, false)).toEqual({ kind: "elsewhere", placeId: alone.id });
    expect(await addOutlet(diary, lead.id, { ...facts, sourceLinks: borivali.sourceLinks }, false)).toEqual({ kind: "there", placeId: lead.id });
    expect([...diary.items.values()].filter((i) => i.type === "place")).toHaveLength(2);
    expect(readPayload("place", diary.items.get(alone.id)!.payload)!.chain).toBeUndefined();
  });
});
