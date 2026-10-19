import type { EnvelopeType, JsonValue } from "@map-diary/crypto";
import { describe, expect, it } from "vitest";
import {
  addComment,
  addPlace,
  applyTag,
  deletePlace,
  EntryError,
  findDuplicate,
  defineTag,
  setDisplayName,
  setStatus,
  unapplyTag,
  widenTag,
  type DiaryWriter,
} from "../lib/entries/actions";
import { buildFacts, customCategory, type FactsForm } from "../lib/entries/facts";
import { normaliseLink, parseCoordinates, parseEntry } from "../lib/entries/parse-input";
import { snapshotFromItems, type StoredItem } from "../lib/places/items-source";
import { FakeDiary } from "./fake-diary";

describe("parseEntry", () => {
  it("takes the place pin from a full Google Maps link over the viewport", () => {
    const url =
      "https://www.google.com/maps/place/Britannia+%26+Co./@18.9340,72.8390,17z/data=!3m1!4b1!4m6!3m5!1s0x3be7d1c0b2b7f0a5:0x8c0b!8m2!3d18.9343126!4d72.8401684!16s%2Fg%2F1tf2k3hk";
    expect(parseEntry(url)).toEqual({
      name: "Britannia & Co.",
      location: { lat: 18.9343126, lng: 72.8401684 },
      link: url,
      source: "google-maps",
      shortLink: false,
    });
  });

  it("falls back to the viewport centre, and reads query links", () => {
    expect(parseEntry("https://www.google.co.in/maps/@19.0544,72.8402,15z").location).toEqual({ lat: 19.0544, lng: 72.8402 });
    expect(parseEntry("https://maps.google.com/?q=19.0760,72.8777").location).toEqual({ lat: 19.076, lng: 72.8777 });
    expect(parseEntry("https://www.google.com/maps/search/?api=1&query=19.1,72.9").location).toEqual({ lat: 19.1, lng: 72.9 });
    expect(parseEntry("https://www.google.com/maps/search/19.07,+72.87").location).toEqual({ lat: 19.07, lng: 72.87 });
    const named = parseEntry("https://www.google.com/maps/search/?api=1&query=Kyani+and+Co");
    expect(named).toMatchObject({ name: "Kyani and Co", source: "google-maps" });
    expect(named.location).toBeUndefined();
  });

  it("marks short links, which a web page cannot expand", () => {
    expect(parseEntry("https://maps.app.goo.gl/AbCdEf123")).toEqual({
      link: "https://maps.app.goo.gl/AbCdEf123",
      source: "google-maps",
      shortLink: true,
    });
    expect(parseEntry("https://goo.gl/maps/xyz").shortLink).toBe(true);
  });

  it("takes the name from Google Maps share text", () => {
    const shared = "Kyani & Co. · Jer Mahal Estate, Marine Lines\nhttps://maps.app.goo.gl/AbC";
    expect(parseEntry(shared)).toMatchObject({ name: "Kyani & Co.", link: "https://maps.app.goo.gl/AbC", shortLink: true });
  });

  it("guesses a name from Zomato and District links", () => {
    expect(parseEntry("https://www.zomato.com/mumbai/britannia-co-fort/info")).toMatchObject({
      name: "Britannia Co Fort",
      source: "zomato",
    });
    expect(parseEntry("https://www.district.in/movies/pvr-icon-andheri").source).toBe("district");
  });

  it("reads coordinates and geo URIs as a dropped pin", () => {
    expect(parseEntry("19.0760, 72.8777")).toEqual({ location: { lat: 19.076, lng: 72.8777 }, shortLink: false });
    expect(parseEntry("19.0760° N, 72.8777° E").location).toEqual({ lat: 19.076, lng: 72.8777 });
    expect(parseEntry("geo:19.07,72.87?q=19.07,72.87(Bandstand)")).toMatchObject({
      name: "Bandstand",
      location: { lat: 19.07, lng: 72.87 },
    });
  });

  it("treats anything else as a name", () => {
    expect(parseEntry("  Bastian, Worli ")).toEqual({ name: "Bastian, Worli", shortLink: false });
    expect(parseEntry("")).toEqual({ shortLink: false });
  });

  it("rejects impossible coordinates", () => {
    expect(parseCoordinates("119, 72")).toBeUndefined();
    expect(parseCoordinates("0, 0")).toBeUndefined();
    expect(parseEntry("https://www.google.com/maps/@0,0,3z").location).toBeUndefined();
  });
});

describe("normaliseLink", () => {
  it("ignores scheme, www, tracking parameters and trailing slashes", () => {
    expect(normaliseLink("https://www.zomato.com/mumbai/x/info/?utm_source=share")).toBe(
      normaliseLink("http://zomato.com/mumbai/x/info"),
    );
    expect(normaliseLink("https://maps.app.goo.gl/AbC?g_st=iw")).toBe("maps.app.goo.gl/AbC");
  });
});

const form = (patch: Partial<FactsForm> = {}): FactsForm => ({
  name: "Kyani & Co.",
  category: "cafe-bar",
  location: { lng: 72.82712345678, lat: 18.9433 },
  address: "",
  cuisine: "",
  dishName: "",
  dishPrice: "",
  sourceLinks: [],
  ...patch,
});

describe("buildFacts", () => {
  it("builds a payload the shared reader accepts", () => {
    const r = buildFacts(form({ dishName: "Bun maska", dishPrice: "₹1,090", sourceLinks: ["https://x.in/a", "javascript:x", "https://x.in/a"] }));
    expect(r).toEqual({
      ok: true,
      facts: {
        name: "Kyani & Co.",
        category: "cafe-bar",
        location: { lng: 72.827123, lat: 18.9433 },
        sourceLinks: ["https://x.in/a"],
        signatureDish: { name: "Bun maska", priceInr: 1090 },
      },
    });
  });

  it("needs a name and a location", () => {
    expect(buildFacts(form({ name: " " }))).toMatchObject({ ok: false });
    expect(buildFacts(form({ location: null }))).toMatchObject({ ok: false });
  });

  it("keeps the wallet bleeder to food and drink, and needs both halves", () => {
    expect(buildFacts(form({ dishName: "Bun maska" }))).toMatchObject({ ok: false });
    const beach = buildFacts(form({ category: "beach", dishName: "Bhel", dishPrice: "60" }));
    expect(beach.ok && beach.facts.signatureDish).toBe(undefined);
  });

  it("slugs custom categories", () => {
    expect(customCategory("Rooftop Café!")).toBe("custom:rooftop-cafe");
    expect(customCategory("  ")).toBeNull();
  });
});

const facts = () => {
  const r = buildFacts(form({ sourceLinks: ["https://www.zomato.com/mumbai/kyani/info"] }));
  if (!r.ok) throw new Error(r.message);
  return r.facts;
};

describe("addPlace", () => {
  it("writes the place, status, new and existing tags, and comment, all readable by the map", async () => {
    const d = new FakeDiary();
    await d.write({ type: "tag_def", placeId: null, payload: { name: "Irani", emoji: "🫖", description: "" } });
    const id = await addPlace(d, {
      kind: "place",
      facts: facts(),
      status: "visited",
      tagIds: ["i-1"],
      newTags: [{ name: "Cheap", emoji: "🪙", description: "Under ₹200" }],
      comment: "  Go early  ",
    });
    const snap = d.snapshot();
    const place = snap.places.find((p) => p.id === id);
    expect(place?.name).toBe("Kyani & Co.");
    expect(snap.tags.map((t) => t.name).sort()).toEqual(["Cheap", "Irani"]);
    expect(place?.opinions.map((o) => o.kind).sort()).toEqual(["comment", "status", "tag", "tag"]);
    expect(place?.opinions.find((o) => o.kind === "comment")).toMatchObject({ text: "Go early" });
    expect(place?.opinions.every((o) => o.boards.join() === "board-personal")).toBe(true);
  });

  it("finds a place already saved from the same link", async () => {
    const d = new FakeDiary();
    const id = await addPlace(d, { kind: "place", facts: facts(), status: "want", tagIds: [], newTags: [], comment: "" });
    expect(findDuplicate(await d.listItems(), "https://zomato.com/mumbai/kyani/info?utm_medium=x")?.id).toBe(id);
    expect(findDuplicate(await d.listItems(), "https://zomato.com/mumbai/other/info")).toBeUndefined();
  });
});

describe("opinions", () => {
  it("needs a status before tags and comments", async () => {
    const d = new FakeDiary();
    const place = await d.write({ type: "private_place", placeId: null, payload: facts() as unknown as JsonValue });
    await expect(addComment(d, place.id, "Nice")).rejects.toBeInstanceOf(EntryError);
    await expect(applyTag(d, place.id, "t")).rejects.toBeInstanceOf(EntryError);
    await setStatus(d, place.id, "want");
    await addComment(d, place.id, "Nice");
    await applyTag(d, place.id, "t");
    await applyTag(d, place.id, "t");
    expect([...d.items.values()].filter((i) => i.type === "tag")).toHaveLength(1);
    await unapplyTag(d, place.id, "t");
    expect([...d.items.values()].filter((i) => i.type === "tag")).toHaveLength(0);
  });

  it("edits the one status in place", async () => {
    const d = new FakeDiary();
    const place = await d.write({ type: "place", placeId: null, payload: facts() as unknown as JsonValue });
    await setStatus(d, place.id, "want");
    await setStatus(d, place.id, "visited");
    const statuses = [...d.items.values()].filter((i) => i.type === "status");
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.payload).toEqual({ status: "visited" });
  });

  it("deletes a place with its author's opinions", async () => {
    const d = new FakeDiary();
    const id = await addPlace(d, { kind: "place", facts: facts(), status: "want", tagIds: [], newTags: [], comment: "Hi" });
    await deletePlace(d, id);
    expect(d.items.size).toBe(0);
  });
});

describe("opinions on someone else's place", () => {
  const friendsPlace = (d: FakeDiary) => {
    const place: StoredItem = {
      id: "p-friend", type: "place", authorId: "acct-friend", placeId: null, createdAt: 1, updatedAt: 1,
      boardIds: ["board-master"], payload: facts() as unknown as JsonValue,
    };
    d.items.set(place.id, place);
    return place;
  };

  it("posts tags and comments to the boards chosen, and moves an applied tag", async () => {
    const d = new FakeDiary();
    const place = friendsPlace(d);
    await setStatus(d, place.id, "want");
    await addComment(d, place.id, "Going Saturday", ["board-master", "board-duo"]);
    const tagId = await defineTag(d, { name: "Spicy", emoji: "", description: "" }, ["board-duo"]);
    await applyTag(d, place.id, tagId, ["board-duo"]);
    await applyTag(d, place.id, tagId, ["board-personal"]);

    const all = [...d.items.values()];
    expect(all.find((i) => i.type === "comment")?.boardIds).toEqual(["board-master", "board-duo"]);
    expect(all.filter((i) => i.type === "tag").map((i) => i.boardIds)).toEqual([["board-personal"]]);
    // The friend's place is untouched.
    expect(d.items.get(place.id)?.authorId).toBe("acct-friend");
  });

  it("widens only the person's own tag definitions", async () => {
    const d = new FakeDiary();
    const mine = await defineTag(d, { name: "Spicy", emoji: "", description: "" });
    await widenTag(d, mine, ["board-duo"]);
    expect(d.items.get(mine)?.boardIds).toEqual(["board-personal", "board-duo"]);

    d.items.set("t-friend", { ...d.items.get(mine)!, id: "t-friend", authorId: "acct-friend" });
    await expect(widenTag(d, "t-friend", ["board-master"])).rejects.toBeInstanceOf(EntryError);
  });

  it("keeps one display name on the master board", async () => {
    const d = new FakeDiary();
    await expect(setDisplayName(d, "  \u200b ", "board-master")).rejects.toBeInstanceOf(EntryError);
    await setDisplayName(d, "Snehil", "board-master");
    expect(await setDisplayName(d, "  Snehil S.  ", "board-master")).toBe("Snehil S.");
    const profiles = [...d.items.values()].filter((i) => i.type === "profile");
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ boardIds: ["board-master"], payload: { name: "Snehil S." } });
  });
});
