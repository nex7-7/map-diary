import type { JsonValue } from "@map-diary/crypto";
import { describe, expect, it } from "vitest";
import { createItemsSource, snapshotFromItems, type ItemStore, type StoredItem } from "../lib/places/items-source";
import { readPayload } from "../lib/places/payloads";

const ME = "acct-me";
const PERSONAL = "board-personal";
let n = 0;
const item = (type: StoredItem["type"], payload: JsonValue, extra: Partial<StoredItem> = {}): StoredItem => ({
  id: `i-${++n}`,
  type,
  authorId: ME,
  placeId: null,
  createdAt: 1_760_000_000_000 + n,
  updatedAt: 1_760_000_000_000 + n,
  boardIds: [PERSONAL],
  payload,
  ...extra,
});

const kyani = item("place", {
  name: "Kyani & Co.",
  category: "cafe-bar",
  location: { lng: 72.827, lat: 18.9433 },
  cuisine: "Irani",
  signatureDish: { name: "Bun maska", priceInr: 90 },
  sourceLinks: ["https://maps.app.goo.gl/x", "javascript:alert(1)"],
});
const pin = item("private_place", { name: "Rooftop", category: "custom:viewpoint", location: { lng: 72.84, lat: 19.05 } });
const spicy = item("tag_def", { name: "Spicy", emoji: "🌶️", description: "Hot" });

describe("readPayload", () => {
  it("keeps valid fields and drops unsafe links", () => {
    expect(readPayload("place", kyani.payload)).toMatchObject({ name: "Kyani & Co.", sourceLinks: ["https://maps.app.goo.gl/x"] });
  });

  it("rejects payloads that do not fit", () => {
    expect(readPayload("place", { name: "No location", category: "beach" })).toBeUndefined();
    expect(readPayload("place", { name: "X", category: "nightclub", location: { lng: 72, lat: 19 } })).toBeUndefined();
    expect(readPayload("status", { status: "maybe" })).toBeUndefined();
    expect(readPayload("comment", "just a string")).toBeUndefined();
  });
});

describe("snapshotFromItems", () => {
  it("builds places with their opinions and drops opinions on unknown places", () => {
    const items = [
      kyani,
      pin,
      spicy,
      item("status", { status: "visited" }, { placeId: kyani.id }),
      item("tag", { tagId: spicy.id }, { placeId: kyani.id }),
      item("comment", { text: "Cash only" }, { placeId: kyani.id }),
      item("status", { status: "want" }, { placeId: pin.id }),
      item("status", { status: "want" }, { placeId: "missing-place" }),
    ];
    const snap = snapshotFromItems(items, ME, PERSONAL);

    expect(snap.me).toEqual({ id: ME, name: "Me" });
    expect(snap.boards).toEqual([{ id: PERSONAL, kind: "personal", name: "Personal", memberIds: [ME] }]);
    expect(snap.tags.map((t) => t.name)).toEqual(["Spicy"]);
    const k = snap.places.find((p) => p.id === kyani.id)!;
    expect(k.opinions.map((o) => o.kind).sort()).toEqual(["comment", "status", "tag"]);
    expect(k.isPrivate).toBe(false);
    expect(snap.places.find((p) => p.id === pin.id)).toMatchObject({ isPrivate: true, category: "custom:viewpoint" });
  });

  it("keeps only the latest status per person per place", () => {
    const older = item("status", { status: "want" }, { placeId: kyani.id, updatedAt: 1 });
    const newer = item("status", { status: "visited" }, { placeId: kyani.id, updatedAt: 2 });
    const friend = item("status", { status: "want" }, { placeId: kyani.id, authorId: "acct-friend", boardIds: ["board-g"] });
    const boards = [
      { id: PERSONAL, kind: "personal" as const, name: "Personal", memberIds: [ME] },
      { id: "board-g", kind: "group" as const, name: "Shared board", memberIds: null },
    ];
    const snap = snapshotFromItems([kyani, newer, older, friend], ME, PERSONAL, boards);
    const statuses = snap.places[0]!.opinions.filter((o) => o.kind === "status");
    expect(statuses.map((o) => o.id).sort()).toEqual([newer.id, friend.id].sort());
    expect(snap.people.map((p) => p.name)).toEqual(["Me", "Friend 1"]);
    expect(snap.boards.map((b) => b.name)).toEqual(["Personal", "Shared board"]);
  });
});

describe("via Claude", () => {
  it("marks opinions the author's Claude assistant wrote", () => {
    const byClaude = item("comment", { text: "Try the bun maska" }, { placeId: kyani.id, viaClaude: true });
    const byHand = item("comment", { text: "Cash only" }, { placeId: kyani.id });
    const opinions = snapshotFromItems([kyani, byClaude, byHand], ME, PERSONAL).places[0]!.opinions;
    expect(opinions.find((o) => o.id === byClaude.id)?.viaClaude).toBe(true);
    expect(opinions.find((o) => o.id === byHand.id)?.viaClaude).toBeUndefined();
  });
});

describe("createItemsSource", () => {
  function fakeStore(initial: StoredItem[]) {
    const items = [...initial];
    const writes: Parameters<ItemStore["write"]>[0][] = [];
    const listeners = new Set<() => void>();
    const store: ItemStore = {
      device: { accountId: ME, personalBoardId: PERSONAL },
      listItems: async () => items,
      subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
      write: async (input) => {
        writes.push(input);
        const existing = items.findIndex((i) => i.id === input.id);
        const next = item(input.type, input.payload, { placeId: input.placeId, ...(input.id ? { id: input.id } : {}) });
        if (existing >= 0) items[existing] = next;
        else items.push(next);
        listeners.forEach((l) => l());
      },
    };
    return { store, writes };
  }

  it("creates my status, then edits the same item", async () => {
    const { store, writes } = fakeStore([kyani]);
    const source = createItemsSource(store);
    let snap = await source.setStatus(kyani.id, "want");
    expect(writes[0]).toEqual({ type: "status", placeId: kyani.id, payload: { status: "want" } });

    snap = await source.setStatus(kyani.id, "visited");
    const statusId = snap.places[0]!.opinions[0]!.id;
    expect(writes[1]).toEqual({ type: "status", placeId: kyani.id, payload: { status: "visited" }, id: statusId });
    expect(snap.places[0]!.opinions).toHaveLength(1);
    expect(snap.places[0]!.opinions[0]).toMatchObject({ kind: "status", status: "visited" });
  });

  it("passes store changes to subscribers", async () => {
    const { store } = fakeStore([kyani]);
    const source = createItemsSource(store);
    let calls = 0;
    const off = source.subscribe(() => calls++);
    await source.setStatus(kyani.id, "want");
    off();
    await source.setStatus(kyani.id, "visited");
    expect(calls).toBe(1);
  });
});
