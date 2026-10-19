import type { EnvelopeType, JsonValue } from "@map-diary/crypto";
import { describe, expect, it } from "vitest";
import {
  addComment,
  addOpinions,
  addPlace,
  applyTag,
  deletePlace,
  EntryError,
  findCataloguePlace,
  findDuplicate,
  defineTag,
  setDisplayName,
  setProfile,
  setStatus,
  unapplyTag,
  type DiaryWriter,
} from "../lib/entries/actions";
import { oneEmoji } from "../lib/entries/emoji";
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

  it("sends the tags and the note to their own boards when picked", async () => {
    const d = new FakeDiary();
    const id = await addPlace(d, {
      kind: "place",
      facts: facts(),
      status: "visited",
      tagIds: [],
      newTags: [{ name: "Cheap", emoji: "🪙", description: "" }],
      comment: "Go early",
      boards: ["board-master"],
      tagBoards: ["board-duo"],
      commentBoards: ["board-personal"],
    });
    const on = (type: string) => [...d.items.values()].find((i) => i.type === type && i.placeId === id)?.boardIds.join();
    expect(on("status")).toBe("board-master");
    expect(on("tag")).toBe("board-duo");
    expect(on("comment")).toBe("board-personal");
    expect([...d.items.values()].find((i) => i.type === "tag_def")?.boardIds).toEqual(["board-duo"]);
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

  it("posts tags and comments to the boards chosen", async () => {
    const d = new FakeDiary();
    const place = friendsPlace(d);
    await setStatus(d, place.id, "want");
    await addComment(d, place.id, "Going Saturday", ["board-master", "board-duo"]);
    const tagId = await defineTag(d, { name: "Spicy", emoji: "", description: "" }, ["board-duo"]);
    await applyTag(d, place.id, tagId, ["board-duo"]);

    const all = [...d.items.values()];
    expect(all.find((i) => i.type === "comment")?.boardIds).toEqual(["board-master", "board-duo"]);
    expect(all.filter((i) => i.type === "tag").map((i) => i.boardIds)).toEqual([["board-duo"]]);
    // The friend's place is untouched.
    expect(d.items.get(place.id)?.authorId).toBe("acct-friend");
  });

  it("counts a tag as visible where its reader says so", async () => {
    const d = new FakeDiary();
    const place = friendsPlace(d);
    d.items.set("t-friend", {
      id: "t-friend", type: "tag_def", authorId: "acct-friend", placeId: null, createdAt: 1, updatedAt: 1,
      boardIds: ["board-master"], payload: { name: "Sunset", emoji: "", description: "" },
    });
    await setStatus(d, place.id, "want");
    // Posted only to master, but every group member can read master, so it fits the group.
    await expect(applyTag(d, place.id, "t-friend", ["board-duo"])).rejects.toBeInstanceOf(EntryError);
    await applyTag(d, place.id, "t-friend", ["board-duo"], () => true);
    expect([...d.items.values()].find((i) => i.type === "tag")?.boardIds).toEqual(["board-duo"]);
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

  it("saves a picture with the name, keeps it on a rename and drops it on request", async () => {
    const d = new FakeDiary();
    const photo = { kind: "photo", dataUrl: "data:image/jpeg;base64,/9j/4AAQ" } as const;
    await setProfile(d, { name: "Riya", avatar: photo }, "board-master");
    await setDisplayName(d, "Riya K.", "board-master");
    const profile = () => [...d.items.values()].find((i) => i.type === "profile")?.payload;
    expect(profile()).toEqual({ name: "Riya K.", avatar: photo });
    await setProfile(d, { name: "Riya K.", avatar: { kind: "emoji", emoji: "🌊", tone: 2 } }, "board-master");
    expect(profile()).toEqual({ name: "Riya K.", avatar: { kind: "emoji", emoji: "🌊", tone: 2 } });
    await setProfile(d, { name: "Riya K.", avatar: null }, "board-master");
    expect(profile()).toEqual({ name: "Riya K." });
  });

  it("refuses a picture that is not a small raster photo or an emoji", async () => {
    const d = new FakeDiary();
    const svg = { kind: "photo", dataUrl: "data:image/svg+xml;base64,PHN2Zz4=" } as const;
    await expect(setProfile(d, { name: "Riya", avatar: svg }, "board-master")).rejects.toBeInstanceOf(EntryError);
    const big = { kind: "photo", dataUrl: `data:image/jpeg;base64,${"A".repeat(30_000)}` } as const;
    await expect(setProfile(d, { name: "Riya", avatar: big }, "board-master")).rejects.toBeInstanceOf(EntryError);
    await expect(setProfile(d, { name: "Riya", avatar: { kind: "emoji", emoji: "abc", tone: 0 } }, "board-master")).rejects.toBeInstanceOf(EntryError);
  });
});

describe("boards", () => {
  const MASTER = "board-master";

  it("posts the status, tags and note to the boards picked, and widens a tag of one's own", async () => {
    const d = new FakeDiary();
    const old = await d.write({ type: "tag_def", placeId: null, payload: { name: "Irani", emoji: "🫖", description: "" } });
    const id = await addPlace(d, {
      kind: "place",
      facts: facts(),
      status: "visited",
      tagIds: [old.id],
      newTags: [{ name: "Cheap", emoji: "🪙", description: "" }],
      comment: "Berry pulao",
      boards: [MASTER],
    });
    const items = [...d.items.values()];
    expect(items.filter((i) => i.placeId === id).every((i) => i.boardIds.join() === MASTER)).toBe(true);
    // The old Personal tag now reads on the Public board too, so the Public tag makes sense.
    expect(d.items.get(old.id)?.boardIds).toEqual(["board-personal", MASTER]);
    expect(items.find((i) => i.type === "tag_def" && i.id !== old.id)?.boardIds).toEqual([MASTER]);
  });

  it("refuses to apply someone else's tag where its definition is not shared", async () => {
    const d = new FakeDiary();
    const place = await d.write({ type: "place", placeId: null, payload: facts() as unknown as JsonValue });
    d.items.set("their-tag", {
      id: "their-tag",
      type: "tag_def",
      authorId: "acct-friend",
      placeId: null,
      createdAt: 1,
      updatedAt: 1,
      boardIds: ["board-group"],
      payload: { name: "Sunset", emoji: "🌅", description: "" },
    });
    await setStatus(d, place.id, "want", [MASTER]);
    await expect(applyTag(d, place.id, "their-tag", [MASTER])).rejects.toBeInstanceOf(EntryError);
    await applyTag(d, place.id, "their-tag", ["board-group"]);
    expect([...d.items.values()].find((i) => i.type === "tag")?.boardIds).toEqual(["board-group"]);
  });

  it("moves a status to new boards, and keeps its boards when none are given", async () => {
    const d = new FakeDiary();
    const place = await d.write({ type: "place", placeId: null, payload: facts() as unknown as JsonValue });
    await setStatus(d, place.id, "want");
    await setStatus(d, place.id, "want", [MASTER]);
    await setStatus(d, place.id, "visited");
    const status = [...d.items.values()].find((i) => i.type === "status");
    expect(status).toMatchObject({ boardIds: [MASTER], payload: { status: "visited" } });
  });

  it("adds notes to a place the catalogue already has instead of copying it", async () => {
    const d = new FakeDiary();
    const existing = await d.write({ type: "place", placeId: null, payload: facts() as unknown as JsonValue });
    expect(await findCataloguePlace(d, ["https://www.zomato.com/mumbai/kyani/info"])).toBe(existing.id);
    // Not on this device yet, but the Worker knows it by its link hash.
    const remote = Object.assign(new FakeDiary(), { findCataloguePlace: async (links: readonly string[]) => (links[0] === "zomato.com/mumbai/kyani/info" ? "p-remote" : null) });
    expect(await findCataloguePlace(remote, ["https://zomato.com/mumbai/kyani/info?utm_source=x"])).toBe("p-remote");
    expect(await findCataloguePlace(remote, ["https://zomato.com/mumbai/other"])).toBeUndefined();

    await addOpinions(d, existing.id, { status: "want", tagIds: [], newTags: [], comment: "Me too", boards: [MASTER] });
    const mine = [...d.items.values()].filter((i) => i.placeId === existing.id);
    expect(mine.map((i) => i.type).sort()).toEqual(["comment", "status"]);
  });

  it("names the master board Public", () => {
    const snap = snapshotFromItems([], "acct-me", "board-personal", [
      { id: "board-personal", kind: "personal", name: "Personal", memberIds: ["acct-me"] },
      { id: MASTER, kind: "master", name: "Public", memberIds: null },
    ]);
    expect(snap.boards.map((b) => b.name)).toEqual(["Personal", "Public"]);
  });
});

describe("oneEmoji", () => {
  it("keeps only the last emoji typed", () => {
    expect(oneEmoji("abc")).toBe("");
    expect(oneEmoji("🌶️")).toBe("🌶️");
    expect(oneEmoji("🌶️x")).toBe("🌶️");
    expect(oneEmoji("🌶️🍕")).toBe("🍕");
    expect(oneEmoji("👩‍🍳")).toBe("👩‍🍳");
    expect(oneEmoji("🇮🇳")).toBe("🇮🇳");
    expect(oneEmoji("12")).toBe("");
  });
});
