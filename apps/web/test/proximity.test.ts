import { describe, expect, it } from "vitest";
import { alertPlaces, clampSettings, DEFAULT_ALERT_SETTINGS, formatMinutes, parseMinutes } from "../lib/android/proximity";
import type { DiarySnapshot, PlaceView, Status } from "../lib/places/types";

const ME = "me";

function place(id: string, statuses: [author: string, status: Status][], extra: Partial<PlaceView> = {}): PlaceView {
  return {
    id, name: `Place ${id}`, category: "restaurant", location: { lat: 19.07, lng: 72.88 }, sourceLinks: [], isPrivate: false, boards: ["personal"],
    opinions: statuses.map(([authorId, status], i) => ({
      id: `${id}-s${i}`, kind: "status" as const, status, authorId, boards: ["personal"], shownOn: ["personal"],
      createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
    })),
    ...extra,
  };
}

function snapshot(places: PlaceView[]): DiarySnapshot {
  return { me: { id: ME, name: "Me" }, people: [], boards: [{ id: "personal", kind: "personal", name: "Personal", memberIds: [ME] }], tags: [], places };
}

describe("alertPlaces", () => {
  it("keeps only my own Want to places", () => {
    const got = alertPlaces(snapshot([place("a", [[ME, "want"]]), place("b", [[ME, "visited"]]), place("c", [["friend", "want"]])]), ME);
    expect(got).toEqual([{ id: "a", name: "Place a", lat: 19.07, lng: 72.88 }]);
  });

  it("gives each outlet of a chain its own fence under the chain's name", () => {
    const chain = place("o1", [[ME, "want"]], {
      name: "Chain",
      outlets: [
        { id: "o1", name: "Chain Bandra", location: { lat: 19.06, lng: 72.83 }, sourceLinks: [] },
        { id: "o2", name: "Chain Fort", location: { lat: 18.93, lng: 72.83 }, sourceLinks: [] },
      ],
    });
    expect(alertPlaces(snapshot([chain]), ME).map((p) => [p.id, p.name])).toEqual([["o1", "Chain"], ["o2", "Chain"]]);
  });

  it("skips places outside Mumbai, which have no pin", () => {
    expect(alertPlaces(snapshot([place("far", [[ME, "want"]], { location: { lat: 15.5, lng: 73.8 } })]), ME)).toEqual([]);
  });
});

describe("alert settings", () => {
  it("keeps the defaults as they are", () => {
    expect(clampSettings(DEFAULT_ALERT_SETTINGS)).toEqual(DEFAULT_ALERT_SETTINGS);
  });

  it("brings values into range", () => {
    const got = clampSettings({ enabled: false, radiusM: 5, dwellSeconds: Number.NaN, cooldownDays: 99, quietStartMin: -60, quietEndMin: 1500 });
    expect(got).toEqual({ enabled: false, radiusM: 100, dwellSeconds: 0, cooldownDays: 30, quietStartMin: 1380, quietEndMin: 60 });
  });

  it("reads and writes quiet hours as HH:MM", () => {
    expect(formatMinutes(23 * 60)).toBe("23:00");
    expect(formatMinutes(8 * 60 + 5)).toBe("08:05");
    expect(parseMinutes("7:30")).toBe(450);
    expect(parseMinutes("24:00")).toBeNull();
    expect(parseMinutes("soon")).toBeNull();
  });
});
