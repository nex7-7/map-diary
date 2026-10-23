import type { StoredItem } from "./items-source";
import { readPayload, type PlacePayload } from "./payloads";

/**
 * Merged duplicates. The admin merges a duplicate catalogue place into the one to keep by
 * rewriting the duplicate's facts with `mergedInto`. The duplicate stays as a pointer, never
 * shown on its own: everyone's opinions on it (which only their authors can change) show on
 * the kept place, and its links still find the kept place.
 */

/** Hops followed from a merged place; a chain of merges longer than this is ignored. */
const MAX_HOPS = 5;

/** Each merged place's id to the id of the place it now shows as. */
export function mergeTargets(items: readonly StoredItem[]): Map<string, string> {
  const into = new Map<string, string>();
  for (const i of items) {
    if (i.type !== "place") continue;
    const target = readPayload("place", i.payload)?.mergedInto;
    if (target && target !== i.id) into.set(i.id, target);
  }
  const out = new Map<string, string>();
  for (const id of into.keys()) {
    let at = id;
    for (let hop = 0; hop < MAX_HOPS && into.has(at); hop++) at = into.get(at)!;
    if (!into.has(at)) out.set(id, at);
  }
  return out;
}

/** The place an id shows as: itself unless it was merged. */
export function resolvePlace(targets: ReadonlyMap<string, string>, placeId: string): string {
  return targets.get(placeId) ?? placeId;
}

/** The place and every place merged into it. */
export function withMerged(targets: ReadonlyMap<string, string>, placeId: string): string[] {
  const kept = resolvePlace(targets, placeId);
  return [kept, ...[...targets].filter(([, to]) => to === kept).map(([from]) => from)];
}

/**
 * The kept place's facts after a merge: its own, plus the duplicate's links so either link
 * finds it, and the duplicate's id so readers that see one place at a time (the Claude
 * assistant) also find opinions left on the duplicate.
 */
export function factsAfterMerge(kept: PlacePayload, keptId: string, duplicate: PlacePayload, duplicateId: string): PlacePayload {
  const sourceLinks = [...new Set([...kept.sourceLinks, ...duplicate.sourceLinks])];
  const mergedFrom = [...new Set([...(kept.mergedFrom ?? []), duplicateId, ...(duplicate.mergedFrom ?? [])])].filter((id) => id !== keptId);
  return { ...kept, sourceLinks, mergedFrom };
}

/** The duplicate's facts once merged: unchanged, apart from where it now points. */
export function factsOfMerged(duplicate: PlacePayload, keptId: string): PlacePayload {
  const { mergedFrom: _from, ...rest } = duplicate;
  return { ...rest, mergedInto: keptId };
}
