import { describe, expect, it } from "vitest";
import { EntryError, addPlace, setStatus, setVisitedDate } from "../lib/entries/actions";
import { readPayload } from "../lib/places/payloads";
import { dayToMs, msToDay, visitedOn } from "../lib/places/visited";
import { FakeDiary } from "./fake-diary";

const facts = { name: "Kyani & Co.", category: "restaurant" as const, location: { lat: 18.9447, lng: 72.8277 }, sourceLinks: [] };
const add = (d: FakeDiary, status: "want" | "visited" = "visited", visitedAt?: number) =>
  addPlace(d, { kind: "place", facts, status, tagIds: [], newTags: [], comment: "", ...(visitedAt !== undefined ? { visitedAt } : {}) });
const statusItem = (d: FakeDiary) => [...d.items.values()].find((i) => i.type === "status")!;
const DAY = 24 * 3_600_000;

describe("status payload", () => {
  it("reads a visit date on Visited only, and drops a bad one", () => {
    expect(readPayload("status", { status: "visited", visitedAt: 1_700_000_000_000 })).toEqual({ status: "visited", visitedAt: 1_700_000_000_000 });
    expect(readPayload("status", { status: "visited", visitedAt: "yesterday" })).toEqual({ status: "visited" });
    expect(readPayload("status", { status: "visited", visitedAt: -5 })).toEqual({ status: "visited" });
    expect(readPayload("status", { status: "want", visitedAt: 1_700_000_000_000 })).toEqual({ status: "want" });
  });

  it("shows the visit date when there is one, else when it was stamped", () => {
    expect(visitedOn({ updatedAt: "2026-10-30T00:00:00.000Z" })).toBe("2026-10-30T00:00:00.000Z");
    expect(visitedOn({ updatedAt: "2026-10-30T00:00:00.000Z", visitedAt: "2026-10-01T00:00:00.000Z" })).toBe("2026-10-01T00:00:00.000Z");
  });

  it("turns a date input's day into a time on that day and back", () => {
    const ms = dayToMs("2026-10-05")!;
    expect(msToDay(ms)).toBe("2026-10-05");
    expect(dayToMs("2026-02-30")).toBeUndefined();
    expect(dayToMs("")).toBeUndefined();
  });
});

describe("visit date", () => {
  it("keeps the day a place was stamped Visited when the status is written again", async () => {
    const d = new FakeDiary();
    const id = await add(d);
    const stamped = statusItem(d).updatedAt;
    await setStatus(d, id, "visited", ["board-master"]);
    expect(statusItem(d).updatedAt).not.toBe(stamped);
    expect(readPayload("status", statusItem(d).payload)).toEqual({ status: "visited", visitedAt: stamped });
  });

  it("drops the date on Want to, and a new Visited is dated by its stamp", async () => {
    const d = new FakeDiary();
    const id = await add(d, "visited", 1_700_000_000_000);
    await setStatus(d, id, "want");
    expect(statusItem(d).payload).toEqual({ status: "want" });
    await setStatus(d, id, "visited");
    expect(statusItem(d).payload).toEqual({ status: "visited" });
  });

  it("changes the visit day and keeps the status's boards", async () => {
    const d = new FakeDiary();
    const id = await add(d);
    await setStatus(d, id, "visited", ["board-group"]);
    const now = 1_760_000_000_000;
    await setVisitedDate(d, id, now - 10 * DAY, now);
    expect(readPayload("status", statusItem(d).payload)).toEqual({ status: "visited", visitedAt: now - 10 * DAY });
    expect(statusItem(d).boardIds).toEqual(["board-group"]);
  });

  it("refuses a day in the future, or a place not marked Visited", async () => {
    const d = new FakeDiary();
    const id = await add(d);
    const now = 1_760_000_000_000;
    await expect(setVisitedDate(d, id, now + 2 * DAY, now)).rejects.toThrow(EntryError);
    await setStatus(d, id, "want");
    await expect(setVisitedDate(d, id, now - DAY, now)).rejects.toThrow("Mark it Visited first.");
  });
});
