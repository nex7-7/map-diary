import type { JsonValue } from "@map-diary/crypto";
import { describe, expect, it } from "vitest";
import { audienceWithin, opinionBoards, tagFit } from "../lib/places/boards";
import { EMPTY_FILTERS, filterPlaces } from "../lib/places/filter";
import { boardsOf, snapshotFromItems, type StoredItem } from "../lib/places/items-source";
import type { Board } from "../lib/places/types";

// Two accounts that share the master board and one group, plus a third who is only on master.
const ME = "acct-me";
const FRIEND = "acct-friend";
const OUTSIDER = "acct-outsider";
const PERSONAL = "board-personal";
const boards: Board[] = [
  { id: PERSONAL, kind: "personal", name: "Personal", memberIds: [ME] },
  { id: "board-master", kind: "master", name: "Public", memberIds: null },
  { id: "board-duo", kind: "group", name: "Duo", memberIds: [ME, FRIEND] },
];

let n = 0;
const item = (type: StoredItem["type"], authorId: string, boardIds: string[], payload: JsonValue, placeId: string | null = null): StoredItem => ({
  id: `i-${++n}`,
  type,
  authorId,
  placeId,
  createdAt: 1_760_000_000_000 + n,
  updatedAt: 1_760_000_000_000 + n,
  boardIds,
  payload,
});

const facts = { name: "Kyani & Co.", category: "cafe-bar", location: { lng: 72.827, lat: 18.9433 } };
const kyani = item("place", FRIEND, ["board-master"], facts);
const pin = item("private_place", FRIEND, ["board-duo"], { ...facts, name: "Secret rooftop" });
const friendTag = item("tag_def", FRIEND, ["board-duo"], { name: "Date spot", emoji: "🌹", description: "" });
const myTag = item("tag_def", ME, [PERSONAL], { name: "Spicy", emoji: "🌶️", description: "" });

const items = [
  kyani,
  pin,
  friendTag,
  myTag,
  item("profile", FRIEND, ["board-master"], { name: "  Riya‮ " }),
  item("profile", FRIEND, ["board-master"], { name: "Riya" }),
  item("status", FRIEND, ["board-master"], { status: "visited" }, kyani.id),
  item("comment", FRIEND, ["board-duo"], { text: "Ask for the berry soda" }, kyani.id),
  item("status", OUTSIDER, ["board-master"], { status: "want" }, kyani.id),
  // Posted to the duo board by someone who is not in it (left, not yet cleaned up): never shown.
  item("comment", OUTSIDER, ["board-duo"], { text: "Still here" }, kyani.id),
  // Wrapped to a board this device cannot read as well as one it can: only the readable badge shows.
  item("comment", FRIEND, ["board-duo", "board-other-group"], { text: "Both groups" }, kyani.id),
  item("status", ME, [PERSONAL], { status: "want" }, kyani.id),
];
const snap = snapshotFromItems(items, ME, PERSONAL, boards);
const place = snap.places.find((p) => p.id === kyani.id)!;

describe("board rules", () => {
  it("names people from their latest profile and numbers the rest", () => {
    expect(snap.people).toEqual([
      { id: ME, name: "Me" },
      { id: FRIEND, name: "Riya" },
      { id: OUTSIDER, name: "Friend 1" },
    ]);
  });

  it("drops opinions posted to a board their author is not a member of", () => {
    const texts = place.opinions.flatMap((o) => (o.kind === "comment" ? [o.text] : []));
    expect(texts.sort()).toEqual(["Ask for the berry soda", "Both groups"]);
  });

  it("badges only boards this device can read", () => {
    const both = place.opinions.find((o) => o.kind === "comment" && o.text === "Both groups")!;
    expect(both.boards).toEqual(["board-duo"]);
  });

  it("shows a member's master opinion on their groups, and a non-member's only on master", () => {
    const friendStatus = place.opinions.find((o) => o.kind === "status" && o.authorId === FRIEND)!;
    const outsiderStatus = place.opinions.find((o) => o.kind === "status" && o.authorId === OUTSIDER)!;
    expect(friendStatus.shownOn.sort()).toEqual(["board-duo", "board-master"]);
    expect(outsiderStatus.shownOn).toEqual(["board-master"]);

    const onDuo = filterPlaces(snap.places, { ...EMPTY_FILTERS, boards: ["board-duo"] }, ME);
    expect(onDuo.map((l) => l.place.id)).toEqual([kyani.id]);
    expect(onDuo[0]).toMatchObject({ status: "visited", mine: false });
    const byOutsider = filterPlaces(snap.places, { ...EMPTY_FILTERS, boards: ["board-duo"], authorIds: [OUTSIDER] }, ME);
    expect(byOutsider).toEqual([]);
  });

  it("lists the boards the device can read, Personal first", async () => {
    const store = { device: { accountId: ME, personalBoardId: PERSONAL, boardKeys: [{ boardId: PERSONAL }, { boardId: "b2" }] } };
    expect((await boardsOf(store)).map((b) => [b.id, b.kind])).toEqual([
      [PERSONAL, "personal"],
      ["b2", "group"],
    ]);
    const synced = { device: { ...store.device, boards: [
      { id: PERSONAL, kind: "personal" as const },
      { id: "board-master", kind: "master" as const },
      { id: "board-duo", kind: "group" as const, memberIds: [ME, FRIEND] },
    ] } };
    expect((await boardsOf(synced)).map((b) => b.memberIds)).toEqual([[ME], null, [ME, FRIEND]]);
    expect((await boardsOf({ ...store, boards: synced.device.boards })).map((b) => b.kind)).toEqual(["personal", "master", "group"]);
    const listed = { ...store, listBoards: async () => boards.slice(1) };
    expect((await boardsOf(listed)).map((b) => b.id)).toEqual(boards.map((b) => b.id));
  });
});

describe("posting on someone else's place", () => {
  it("offers every board I am in for a catalogue place", () => {
    expect(opinionBoards(snap, place).map((b) => b.id)).toEqual([PERSONAL, "board-duo", "board-master"]);
  });

  it("never offers a board wider than the place's own audience", () => {
    const rooftop = snap.places.find((p) => p.id === pin.id)!;
    expect(opinionBoards(snap, rooftop).map((b) => b.id)).toEqual([PERSONAL, "board-duo"]);
    expect(audienceWithin(boards[1]!, ["board-duo"], boards)).toBe(false);
  });

  it("fits a tag only on boards where its definition is visible", () => {
    const date = snap.tags.find((t) => t.id === friendTag.id)!;
    expect(tagFit(date, [PERSONAL, "board-duo", "board-master"], snap)).toEqual({
      fits: [PERSONAL, "board-duo"],
      outside: ["board-master"],
      canWiden: false,
    });
    const spicy = snap.tags.find((t) => t.id === myTag.id)!;
    expect(tagFit(spicy, ["board-duo"], snap)).toEqual({ fits: [], outside: ["board-duo"], canWiden: true });
  });
});
