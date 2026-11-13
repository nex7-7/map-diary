import type { JsonValue, ResolvedChain, ResolvedPlace } from "@map-diary/crypto";
import { EntryError, findDuplicate, type DiaryWriter } from "../entries/actions";
import { isFood } from "../entries/facts";
import { chainFor, outletIds, SAME_PLACE_M } from "../places/chains";
import { distanceMetres } from "../places/filter";
import { mergeTargets } from "../places/merges";
import type { StoredItem } from "../places/items-source";
import { readPayload, type PlacePayload } from "../places/payloads";
import { BUILTIN_CATEGORIES, type Category, type PlaceChain } from "../places/types";

/**
 * Filling in wallet bleeders (and missing chain outlets) for places already in the catalogue,
 * from a fresh lookup. Only the admin's device runs it, since only the admin edits facts.
 *
 * Unlike "Look up again", nothing but the category, the wallet bleeder (and the cuisine, when
 * the place had none) changes: the name, pin, address and links stay as they are.
 */

/** How far a match may be from the place and still count as the same one. */
export const WALLET_MATCH_M = 300;

/** A food category the resolver picked; custom and non-food categories are left alone. */
function isBuiltinFood(category: Category): boolean {
  return (BUILTIN_CATEGORIES as readonly string[]).includes(category) && isFood(category);
}

/** Catalogue places (live, not merged away) as id and facts. */
function cataloguePlaces(items: readonly StoredItem[]): { id: string; facts: PlacePayload }[] {
  const merged = mergeTargets(items);
  return items.flatMap((i) => {
    if (i.type !== "place" || merged.has(i.id)) return [];
    const facts = readPayload("place", i.payload);
    return facts && !facts.mergedInto ? [{ id: i.id, facts }] : [];
  });
}

/** Whether a found place is this catalogue place: a shared link, or a pin close by. */
function isSame(facts: PlacePayload, found: ResolvedPlace, metres = WALLET_MATCH_M): boolean {
  if (found.sourceLinks.some((l) => facts.sourceLinks.includes(l))) return true;
  return distanceMetres(facts.location, { lng: found.location.lng, lat: found.location.lat }) < metres;
}

/** The match a wallet refresh can apply by itself, if one is clearly the place. */
export function confidentMatch(items: readonly StoredItem[], placeId: string, candidates: readonly ResolvedPlace[]): ResolvedPlace | undefined {
  const item = items.find((i) => i.id === placeId && i.type === "place");
  const facts = item && readPayload("place", item.payload);
  if (!facts) return undefined;
  return candidates.find((c) => isSame(facts, c));
}

/** The facts with the new category and wallet bleeder; undefined when nothing changes. */
function withWallet(facts: PlacePayload, found: ResolvedPlace): PlacePayload | undefined {
  const category = isBuiltinFood(facts.category) && isBuiltinFood(found.category) ? found.category : facts.category;
  const next: PlacePayload = { ...facts, category };
  if (!isFood(category)) delete next.signatureDish;
  else if (found.signatureDish) next.signatureDish = { ...found.signatureDish };
  if (!next.cuisine && found.cuisine) next.cuisine = found.cuisine;
  return JSON.stringify(next) === JSON.stringify(facts) ? undefined : next;
}

export interface WalletOutcome {
  /** Places whose facts changed. */
  updated: number;
  /** Outlets of the chain that were not in the catalogue and were added. */
  added: number;
}

/**
 * Applies a lookup to a place and every outlet of its chain: each outlet takes the category and
 * wallet bleeder of the found outlet it matches (else the match's), and the chain's outlets the
 * catalogue lacks are added. A place not in a chain yet joins the chain the lookup found.
 */
export async function applyWallet(w: DiaryWriter, placeId: string, match: ResolvedPlace, chain?: ResolvedChain): Promise<WalletOutcome> {
  let items = await w.listItems();
  const place = cataloguePlaces(items).find((p) => p.id === placeId);
  if (!place) throw new EntryError("That place isn't on this device any more. It may have been deleted.");
  const found = [match, ...(chain?.outlets ?? [])];

  // The chain label: the place's own, else one the catalogue already has by that name, else
  // a new one named after the found chain with the place's id.
  let label: PlaceChain | undefined = place.facts.chain;
  if (!label && chain) {
    label = chainFor(items, chain.name, () => placeId);
    if (label.id !== placeId && !cataloguePlaces(items).some((p) => p.facts.chain?.id === label!.id)) label = { id: placeId, name: chain.name };
  }

  const members = new Set(outletIds(items, placeId));
  members.add(placeId);
  const outlets = cataloguePlaces(items).filter((p) => members.has(p.id) || (label !== undefined && p.facts.chain?.id === label.id));
  let updated = 0;
  const matched = new Set<ResolvedPlace>();
  for (const o of outlets) {
    const own = found.find((f) => isSame(o.facts, f, o.id === placeId ? WALLET_MATCH_M : SAME_PLACE_M)) ?? match;
    if (own !== match || o.id === placeId) matched.add(own);
    let next = withWallet(o.facts, own);
    if (o.id === placeId && label && !o.facts.chain) next = { ...(next ?? o.facts), chain: label };
    if (!next) continue;
    if (!readPayload("place", next as unknown as JsonValue)) continue;
    await w.write({ type: "place", placeId: null, id: o.id, payload: next as unknown as JsonValue });
    updated++;
  }

  let added = 0;
  if (chain && label) {
    items = await w.listItems();
    const known = cataloguePlaces(items);
    for (const f of chain.outlets) {
      if (matched.has(f)) continue;
      // Already in the catalogue: by a link, or as an outlet of this chain at that spot.
      if (f.sourceLinks.some((l) => findDuplicate(items, l))) continue;
      if (known.some((k) => k.facts.chain?.id === label.id && isSame(k.facts, f, SAME_PLACE_M))) continue;
      const facts: PlacePayload = {
        name: f.name,
        category: isBuiltinFood(f.category) ? f.category : place.facts.category,
        location: { lng: f.location.lng, lat: f.location.lat },
        sourceLinks: [...f.sourceLinks],
        chain: { ...label },
      };
      if (f.address) facts.address = f.address;
      if (f.cuisine) facts.cuisine = f.cuisine;
      if (f.signatureDish && isFood(facts.category)) facts.signatureDish = { ...f.signatureDish };
      if (!readPayload("place", facts as unknown as JsonValue)) continue;
      await w.write({ type: "place", placeId: null, payload: facts as unknown as JsonValue });
      added++;
    }
  }
  return { updated, added };
}

/**
 * The catalogue places whose wallet bleeder still needs the new rules (none, or one without a
 * `rule`), one per chain: a lookup of one outlet fills in the whole chain.
 */
export function placesNeedingWallet(items: readonly StoredItem[]): { id: string; facts: PlacePayload }[] {
  const seenChains = new Set<string>();
  const out: { id: string; facts: PlacePayload }[] = [];
  // An outlet with a link first: the resolver finds a place best by its link.
  const places = cataloguePlaces(items).sort((a, b) => Number(b.facts.sourceLinks.length > 0) - Number(a.facts.sourceLinks.length > 0) || a.id.localeCompare(b.id));
  // A chain counts as done only when every outlet is.
  const chainDone = new Map<string, boolean>();
  for (const p of places) {
    if (!p.facts.chain) continue;
    const done = isFood(p.facts.category) ? p.facts.signatureDish?.rule !== undefined : true;
    chainDone.set(p.facts.chain.id, (chainDone.get(p.facts.chain.id) ?? true) && done);
  }
  for (const p of places) {
    if (!isBuiltinFood(p.facts.category)) continue;
    if (p.facts.chain) {
      if (chainDone.get(p.facts.chain.id) || seenChains.has(p.facts.chain.id)) continue;
      seenChains.add(p.facts.chain.id);
    } else if (p.facts.signatureDish?.rule) continue;
    out.push(p);
  }
  return out;
}
