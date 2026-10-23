import type { JsonValue } from "@map-diary/crypto";
import { describe, expect, it } from "vitest";
import { outletIds } from "../lib/places/chains";
import { snapshotFromItems, type StoredItem } from "../lib/places/items-source";
import { factsAfterMerge, factsOfMerged, mergeTargets } from "../lib/places/merges";
import { readPayload, type PlacePayload } from "../lib/places/payloads";

const ME = "acct-me";
const FRIEND = "acct-friend";
const PERSONAL = "board-personal";
const MASTER = "board-master";
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
const facts = (name: string, link: string): PlacePayload => ({ name, category: "cafe-bar", location: { lng: 72.83, lat: 18.94 }, sourceLinks: [link] });

describe("merged duplicates", () => {
  const kept = item("place", facts("Kyani & Co.", "https://example.com/a") as unknown as JsonValue);
  const dupFacts = facts("Kyani", "https://example.com/b");
  const dup = item("place", factsOfMerged(dupFacts, kept.id) as unknown as JsonValue, { authorId: ME });
  const keptAfter = { ...kept, payload: factsAfterMerge(readPayload("place", kept.payload)!, kept.id, dupFacts, dup.id) as unknown as JsonValue };
  const mine = item("status", { status: "want" }, { placeId: kept.id });
  const theirs = item("comment", { text: "bun maska" }, { placeId: dup.id, authorId: FRIEND, boardIds: [MASTER] });
  const theirStatus = item("status", { status: "visited" }, { placeId: dup.id, authorId: FRIEND, boardIds: [MASTER] });
  const items = [keptAfter, dup, mine, theirs, theirStatus];

  it("shows one place with everyone's opinions, and hides the duplicate", () => {
    const snap = snapshotFromItems(items, ME, PERSONAL, [
      { id: PERSONAL, kind: "personal", name: "Personal", memberIds: [ME] },
      { id: MASTER, kind: "master", name: "Public", memberIds: null },
    ]);
    expect(snap.places.map((p) => p.id)).toEqual([kept.id]);
    expect(snap.places[0]!.opinions.map((o) => o.id).sort()).toEqual([mine.id, theirs.id, theirStatus.id].sort());
  });

  it("keeps both links on the kept place and finds opinions on either", () => {
    expect(readPayload("place", keptAfter.payload)).toMatchObject({ sourceLinks: ["https://example.com/a", "https://example.com/b"], mergedFrom: [dup.id] });
    expect(mergeTargets(items)).toEqual(new Map([[dup.id, kept.id]]));
    expect(outletIds(items, dup.id).sort()).toEqual([kept.id, dup.id].sort());
  });

  it("ignores a merge that points in a circle", () => {
    const a = item("place", { ...facts("A", "https://example.com/c"), mergedInto: "i-loop" } as unknown as JsonValue);
    const b = item("place", { ...facts("B", "https://example.com/d"), mergedInto: a.id } as unknown as JsonValue, { id: "i-loop" });
    expect(mergeTargets([a, b]).size).toBe(0);
  });
});
