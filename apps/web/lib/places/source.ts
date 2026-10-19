import { fixtureSnapshot } from "./fixtures";
import type { DiarySnapshot, DiarySource, Status, StatusOpinion } from "./types";

/** In-memory source over the sample diary. Changes last until the page reloads. */
export function createFixtureSource(now: () => Date = () => new Date()): DiarySource {
  const snapshot = fixtureSnapshot();
  const current = () => structuredClone(snapshot);
  const listeners = new Set<() => void>();

  return {
    load: async () => current(),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setStatus: async (placeId: string, status: Status) => {
      const place = snapshot.places.find((p) => p.id === placeId);
      if (!place) throw new Error(`Unknown place ${placeId}`);
      const stamp = now().toISOString();
      const own = place.opinions.find((o): o is StatusOpinion => o.kind === "status" && o.authorId === snapshot.me.id);
      if (own) {
        own.status = status;
        own.updatedAt = stamp;
      } else {
        // New opinions default to the Personal board.
        place.opinions.push({
          id: `o-local-${placeId}`, kind: "status", status, authorId: snapshot.me.id,
          boards: ["personal"], shownOn: ["personal"], createdAt: stamp, updatedAt: stamp,
        });
      }
      listeners.forEach((l) => l());
      return current();
    },
  };
}

export type { DiarySnapshot };
