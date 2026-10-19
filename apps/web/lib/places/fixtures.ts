import { applyBoardRules } from "./boards";
import type { Board, DiarySnapshot, Opinion, Person, PlaceView, TagDefinition } from "./types";

/**
 * Sample diary for building the map and list before keys and sync land.
 * People and groups are made up; places are real Mumbai spots with approximate
 * coordinates and prices.
 */

const me: Person = { id: "u-snehil", name: "Snehil" };
const people: Person[] = [
  me,
  { id: "u-aarav", name: "Aarav" },
  { id: "u-meera", name: "Meera" },
  { id: "u-kabir", name: "Kabir" },
  { id: "u-riya", name: "Riya" },
];

const boards: Board[] = [
  { id: "personal", kind: "personal", name: "Personal", memberIds: [me.id] },
  { id: "master", kind: "master", name: "Public", memberIds: null },
  { id: "group:college", kind: "group", name: "College lot", memberIds: [me.id, "u-aarav", "u-meera", "u-kabir"] },
  { id: "group:duo", kind: "group", name: "Riya & me", memberIds: [me.id, "u-riya"] },
];

const tags: TagDefinition[] = [
  { id: "t-spicy", authorId: me.id, name: "Spicy", emoji: "🌶️", description: "Brings tears, in a good way.", boards: ["personal", "master"] },
  { id: "t-splurge", authorId: me.id, name: "Splurge", emoji: "💸", description: "Payday only.", boards: ["personal", "group:college", "group:duo"] },
  { id: "t-sunset", authorId: "u-meera", name: "Sunset spot", emoji: "🌅", description: "Go an hour before sunset.", boards: ["group:college"] },
  { id: "t-irani", authorId: me.id, name: "Irani café", emoji: "🫖", description: "Bun maska, chai, bentwood chairs.", boards: ["master"] },
];

let seq = 0;
const at = (day: number) => new Date(Date.UTC(2026, 8, day, 12)).toISOString();
const status = (authorId: string, s: "visited" | "want", boards: string[], day: number): Opinion => ({
  id: `o-${++seq}`, kind: "status", status: s, authorId, boards, shownOn: [], createdAt: at(day), updatedAt: at(day),
});
const tag = (authorId: string, tagId: string, boards: string[], day: number): Opinion => ({
  id: `o-${++seq}`, kind: "tag", tagId, authorId, boards, shownOn: [], createdAt: at(day), updatedAt: at(day),
});
const comment = (authorId: string, text: string, boards: string[], day: number): Opinion => ({
  id: `o-${++seq}`, kind: "comment", text, authorId, boards, shownOn: [], createdAt: at(day), updatedAt: at(day),
});

const place = (
  p: Omit<PlaceView, "sourceLinks" | "isPrivate" | "boards"> & Partial<Pick<PlaceView, "sourceLinks" | "isPrivate" | "boards">>,
): PlaceView => ({
  sourceLinks: [],
  isPrivate: false,
  // Catalogue places live on the master board; dropped pins on the boards their owner picks.
  boards: p.isPrivate ? ["personal"] : ["master"],
  ...p,
});

const places: PlaceView[] = [
  place({
    id: "p-britannia", name: "Britannia & Co.", category: "restaurant", cuisine: "Parsi",
    location: { lng: 72.8402, lat: 18.9343 }, address: "Ballard Estate, Fort",
    signatureDish: { name: "Berry pulav", priceInr: 650 },
    opinions: [
      status(me.id, "visited", ["master"], 2),
      tag(me.id, "t-splurge", ["personal"], 2),
      comment(me.id, "Closed on Sundays. Go before 1 pm.", ["master"], 2),
      status("u-aarav", "want", ["group:college"], 10),
    ],
  }),
  place({
    id: "p-kyani", name: "Kyani & Co.", category: "cafe-bar", cuisine: "Irani",
    location: { lng: 72.827, lat: 18.9433 }, address: "Jer Mahal, Dhobi Talao",
    signatureDish: { name: "Bun maska and chai", priceInr: 90 },
    opinions: [status(me.id, "visited", ["master", "group:college"], 4), tag(me.id, "t-irani", ["master"], 4)],
  }),
  place({
    id: "p-bademiya", name: "Bademiya", category: "restaurant", cuisine: "Mughlai",
    location: { lng: 72.8323, lat: 18.9224 }, address: "Tulloch Road, Colaba",
    signatureDish: { name: "Chicken baida roti", priceInr: 220 },
    opinions: [
      status(me.id, "want", ["personal"], 20),
      status("u-kabir", "visited", ["group:college"], 6),
      tag("u-kabir", "t-spicy", ["master"], 6),
      comment("u-kabir", "Only after 10 pm, trust me.", ["group:college"], 6),
    ],
  }),
  place({
    id: "p-swati", name: "Swati Snacks", category: "restaurant", cuisine: "Gujarati",
    location: { lng: 72.8115, lat: 18.9688 }, address: "Tardeo Road",
    signatureDish: { name: "Panki", priceInr: 310 },
    opinions: [status(me.id, "want", ["personal", "group:duo"], 15), status("u-riya", "visited", ["group:duo"], 3)],
  }),
  place({
    id: "p-madras", name: "Café Madras", category: "restaurant", cuisine: "South Indian",
    location: { lng: 72.8553, lat: 19.0275 }, address: "King's Circle, Matunga",
    signatureDish: { name: "Ragi dosa", priceInr: 160 },
    opinions: [status(me.id, "visited", ["personal"], 8), comment(me.id, "Queue moves fast on weekdays.", ["personal"], 8)],
  }),
  place({
    id: "p-aaswad", name: "Aaswad", category: "restaurant", cuisine: "Maharashtrian",
    location: { lng: 72.8406, lat: 19.0216 }, address: "Gokhale Road, Dadar",
    signatureDish: { name: "Misal pav", priceInr: 140 },
    opinions: [status(me.id, "want", ["master"], 22), tag(me.id, "t-spicy", ["master"], 22)],
  }),
  place({
    id: "p-leopold", name: "Leopold Café", category: "cafe-bar", cuisine: "Continental",
    location: { lng: 72.8317, lat: 18.9227 }, address: "Colaba Causeway",
    signatureDish: { name: "Pitcher of beer", priceInr: 900 },
    opinions: [status("u-meera", "visited", ["group:college"], 1), status(me.id, "want", ["group:college"], 25)],
  }),
  place({
    id: "p-regal", name: "Regal Cinema", category: "movies",
    location: { lng: 72.8318, lat: 18.9244 }, address: "Colaba Causeway",
    opinions: [status(me.id, "visited", ["personal"], 12)],
  }),
  place({
    id: "p-prithvi", name: "Prithvi Theatre", category: "recreation",
    location: { lng: 72.8256, lat: 19.1059 }, address: "Juhu Church Road",
    opinions: [status(me.id, "want", ["personal", "master"], 18), status("u-riya", "want", ["group:duo"], 19)],
  }),
  place({
    id: "p-sgnp", name: "Sanjay Gandhi National Park", category: "recreation",
    location: { lng: 72.9106, lat: 19.2147 }, address: "Borivali East",
    opinions: [
      status("u-aarav", "visited", ["master"], 5),
      comment("u-aarav", "Kanheri caves trail opens at 9.", ["master"], 5),
      // Riya is not in the college group: this shows on Public only, never on College lot.
      comment("u-riya", "Hire a cycle at the gate.", ["master"], 7),
    ],
  }),
  place({
    id: "p-chowpatty", name: "Girgaon Chowpatty", category: "beach",
    location: { lng: 72.8139, lat: 18.9548 }, address: "Marine Drive",
    opinions: [
      status(me.id, "visited", ["master"], 9),
      status("u-meera", "visited", ["group:college"], 9),
      tag("u-meera", "t-sunset", ["group:college"], 9),
    ],
  }),
  place({
    id: "p-juhu", name: "Juhu Beach", category: "beach",
    location: { lng: 72.8264, lat: 19.0988 }, address: "Juhu Tara Road",
    opinions: [status(me.id, "want", ["personal"], 27)],
  }),
  place({
    id: "p-board-games", name: "Board game café", category: "custom:games",
    location: { lng: 72.8347, lat: 19.0596 }, address: "Bandra West",
    opinions: [status("u-riya", "want", ["group:duo"], 14)],
  }),
  place({
    id: "p-rooftop", name: "Rooftop near the station", category: "custom:viewpoint", isPrivate: true,
    location: { lng: 72.8402, lat: 19.0544 },
    opinions: [status(me.id, "want", ["personal"], 28)],
  }),
];

export function fixtureSnapshot(): DiarySnapshot {
  return applyBoardRules(structuredClone({ me, people, boards, tags, places }));
}
