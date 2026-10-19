import type { JsonValue } from "@map-diary/crypto";
import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, filterPlaces } from "../lib/places/filter";
import { snapshotFromItems, type BoardMembership, type StoredItem } from "../lib/places/items-source";

const ME = "acct-me";
const ASHA = "acct-asha";
const RAVI = "acct-ravi";
const PERSONAL = "board-personal";
const MASTER = "board-master";
const GROUP = "board-group";
let n = 0;
const item = (type: StoredItem["type"], payload: JsonValue, extra: Partial<StoredItem> = {}): StoredItem => ({
  id: `i-${++n}`,
  type,
  authorId: ME,
  placeId: null,
  createdAt: 1_760_000_000_000 + n,
  updatedAt: 1_760_000_000_000 + n,
  boardIds: [MASTER],
  payload,
  ...extra,
});
const place = (name: string) => item("place", { name, category: "restaurant", location: { lng: 72.83, lat: 18.95 } });

const memberships: BoardMembership[] = [
  { id: PERSONAL, kind: "personal" },
  { id: MASTER, kind: "master" },
  { id: GROUP, kind: "group", memberIds: [ME, ASHA] },
];

describe("a group's board", () => {
  const onGroup = place("On the group");
  const onMaster = place("A member's public place");
  const outsider = place("A non-member's public place");
  const personal = place("Only in my personal board");
  const items = [
    onGroup,
    onMaster,
    outsider,
    personal,
    item("status", { status: "want" }, { placeId: onGroup.id, authorId: ASHA, boardIds: [GROUP] }),
    item("status", { status: "visited" }, { placeId: onMaster.id, authorId: ASHA, boardIds: [MASTER] }),
    item("status", { status: "visited" }, { placeId: outsider.id, authorId: RAVI, boardIds: [MASTER] }),
    item("status", { status: "want" }, { placeId: personal.id, boardIds: [PERSONAL] }),
    item("group", { name: "Old name" }, { boardIds: [GROUP], updatedAt: 1 }),
    item("group", { name: "Bandra lot" }, { boardIds: [GROUP], authorId: ASHA }),
  ];
  const snap = snapshotFromItems(items, ME, PERSONAL, memberships);

  it("is named by the newest group item and carries its members", () => {
    expect(snap.boards.find((b) => b.id === GROUP)).toEqual({ id: GROUP, kind: "group", name: "Bandra lot", memberIds: [ME, ASHA] });
    expect(snap.boards.find((b) => b.id === MASTER)).toMatchObject({ kind: "master", name: "Public" });
  });

  it("lists places where a member has a status on the group or the master board", () => {
    const listed = filterPlaces(snap.places, { ...EMPTY_FILTERS, boards: [GROUP] }, ME, undefined, snap.boards);
    expect(listed.map((l) => l.place.name).sort()).toEqual(["A member's public place", "On the group"]);
  });

  it("leaves the master board showing everyone's public places", () => {
    const listed = filterPlaces(snap.places, { ...EMPTY_FILTERS, boards: [MASTER] }, ME, undefined, snap.boards);
    expect(listed.map((l) => l.place.name).sort()).toEqual(["A member's public place", "A non-member's public place"]);
  });
});
