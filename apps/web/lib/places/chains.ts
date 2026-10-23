import { normaliseChainName } from "@map-diary/crypto";
import type { StoredItem } from "./items-source";
import { mergeTargets, resolvePlace, withMerged } from "./merges";
import { readPayload } from "./payloads";
import type { Opinion, Outlet, PlaceChain, PlaceView } from "./types";

/**
 * Chains: several catalogue places (outlets) that share one chain id in their facts. Each
 * outlet stays its own place, so links, pins and the duplicate check work per outlet; the
 * device folds them into one place page. Status and tags count for the whole chain;
 * comments are about one outlet or, flagged `allOutlets`, all of them.
 */

export { normaliseChainName };

/** The chain each catalogue place on this device belongs to, by place id. */
export function chainsOf(items: readonly StoredItem[]): Map<string, PlaceChain> {
  const out = new Map<string, PlaceChain>();
  for (const i of items) {
    if (i.type !== "place") continue;
    const chain = readPayload("place", i.payload)?.chain;
    if (chain) out.set(i.id, chain);
  }
  return out;
}

/** An existing chain with this name (so a new outlet joins it), or a new one. */
export function chainFor(items: readonly StoredItem[], name: string, newId: () => string = () => crypto.randomUUID()): PlaceChain {
  const key = normaliseChainName(name);
  for (const chain of chainsOf(items).values()) if (normaliseChainName(chain.name) === key) return chain;
  return { id: newId(), name: name.trim() };
}

/** Every outlet of the place's chain, itself included; just the place when it is not a chain. */
export function outletIds(items: readonly StoredItem[], placeId: string): string[] {
  // Places merged into an outlet count as that outlet, so opinions left on them are found too.
  const targets = mergeTargets(items);
  const kept = resolvePlace(targets, placeId);
  const chains = chainsOf(items);
  const chain = chains.get(kept);
  const outlets = chain ? [...chains].filter(([id, c]) => c.id === chain.id && !targets.has(id)).map(([id]) => id) : [kept];
  return outlets.flatMap((id) => withMerged(targets, id));
}

/**
 * Folds each chain's outlets into one view, keeping places that are not chains as they are.
 * The first outlet added leads: its id opens the page and its facts stand for the chain.
 */
export function foldChains(places: readonly PlaceView[], createdAt: (id: string) => number): PlaceView[] {
  const byChain = new Map<string, PlaceView[]>();
  const out: (PlaceView | string)[] = [];
  for (const p of places) {
    if (!p.chain || p.isPrivate) {
      out.push(p);
      continue;
    }
    const group = byChain.get(p.chain.id);
    if (group) group.push(p);
    else {
      byChain.set(p.chain.id, [p]);
      out.push(p.chain.id);
    }
  }
  return out.map((entry) => {
    if (typeof entry !== "string") return entry;
    const group = byChain.get(entry)!.sort((a, b) => createdAt(a.id) - createdAt(b.id) || a.id.localeCompare(b.id));
    const lead = group[0]!;
    const outlets = group.map((o): Outlet => ({
      id: o.id,
      name: o.name,
      location: o.location,
      sourceLinks: o.sourceLinks,
      ...(o.address ? { address: o.address } : {}),
      ...(o.signatureDish ? { signatureDish: o.signatureDish } : {}),
    }));
    const opinions: Opinion[] = [];
    const tagged = new Set<string>();
    for (const o of group.flatMap((g) => g.opinions)) {
      // The same tag from the same person on two outlets is one tag on the chain.
      if (o.kind === "tag") {
        const key = `${o.authorId} ${o.tagId}`;
        if (tagged.has(key)) continue;
        tagged.add(key);
      }
      opinions.push(o);
    }
    const signatureDish = lead.signatureDish ?? group.find((g) => g.signatureDish)?.signatureDish;
    const cuisine = lead.cuisine ?? group.find((g) => g.cuisine)?.cuisine;
    return {
      ...lead,
      name: lead.chain!.name,
      ...(signatureDish ? { signatureDish } : {}),
      ...(cuisine ? { cuisine } : {}),
      outlets,
      boards: [...new Set(group.flatMap((g) => g.boards))],
      opinions,
    };
  });
}

/** The outlet of a place view with this id, if the view is a chain. */
export function outletOf(place: PlaceView, id: string): Outlet | undefined {
  return place.outlets?.find((o) => o.id === id);
}

/** The place view that shows this place id: itself, or the chain it is an outlet of. */
export function viewOf(places: readonly PlaceView[], id: string): PlaceView | undefined {
  return places.find((p) => p.id === id) ?? places.find((p) => p.outlets?.some((o) => o.id === id));
}

/**
 * The neighbourhood in an address: its last part once the city, state, country and postcode
 * are dropped, so "…, Lower Parel, Mumbai, Maharashtra 400013" gives "Lower Parel".
 */
export function addressArea(address: string | undefined): string | undefined {
  return (address ?? "")
    .split(",")
    .map((p) => p.replace(/\b\d{3}\s?\d{3}\b/g, "").replace(/[\s-]+$/, "").trim())
    .filter((p) => p && !/^(mumbai|bombay|maharashtra|india)$/i.test(p))
    .at(-1);
}

/** A short name for an outlet: its area ("Lower Parel"), else its own name, else its number. */
export function outletLabel(place: PlaceView, outlet: Outlet): string {
  const area = addressArea(outlet.address);
  if (area) return area;
  if (normaliseChainName(outlet.name) !== normaliseChainName(place.name)) return outlet.name;
  return `Location ${(place.outlets?.indexOf(outlet) ?? 0) + 1}`;
}
