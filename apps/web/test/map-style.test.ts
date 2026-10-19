import { describe, expect, it } from "vitest";
import { pinImageId, pinsCollection } from "../lib/map/style";
import { EMPTY_FILTERS, filterPlaces } from "../lib/places/filter";
import { fixtureSnapshot } from "../lib/places/fixtures";

const { me, places } = fixtureSnapshot();

describe("map pins", () => {
  const listed = filterPlaces(places, EMPTY_FILTERS, me.id);

  it("colours my places by status and others' places as a friend's", () => {
    const features = pinsCollection(listed, null).features;
    for (const [i, f] of features.entries()) {
      const item = listed[i]!;
      const kind = item.mine ? item.status : "friend";
      expect(f.properties.icon).toContain(`|${kind}|`);
      expect(f.properties.iconDark.startsWith("pin|dark|")).toBe(true);
    }
    expect(listed.some((l) => !l.mine)).toBe(true);
  });

  it("draws the selected place larger", () => {
    const id = listed[0]!.place.id;
    const selected = pinsCollection(listed, id).features.find((f) => f.properties.id === id)!;
    expect(selected.properties.selected).toBe(true);
    expect(selected.properties.icon.split("|")[3]).toBe("1");
  });

  it("keeps emoji with joiners intact in the image name", () => {
    expect(pinImageId("want", "🏖️", false, false)).toBe("pin|light|want|0|🏖️");
  });
});
