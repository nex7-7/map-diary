import { describe, expect, it } from "vitest";
import { authorsOf } from "../lib/places/filter";
import { fixtureSnapshot } from "../lib/places/fixtures";

describe("authorsOf", () => {
  it("offers only me and people with a visible status", () => {
    const snapshot = fixtureSnapshot();
    // Someone who left the app: their profile is still known, but they have nothing on any place.
    snapshot.people.push({ id: "u-gone", name: "Gone" });
    const ids = authorsOf(snapshot, []).map((p) => p.id);
    expect(ids).toContain(snapshot.me.id);
    expect(ids).not.toContain("u-gone");
    for (const id of ids) {
      if (id === snapshot.me.id) continue;
      expect(snapshot.places.some((p) => p.opinions.some((o) => o.kind === "status" && o.authorId === id))).toBe(true);
    }
  });

  it("keeps someone already picked, so they can be unpicked", () => {
    const snapshot = fixtureSnapshot();
    snapshot.people.push({ id: "u-gone", name: "Gone" });
    expect(authorsOf(snapshot, ["u-gone"]).map((p) => p.id)).toContain("u-gone");
  });
});
