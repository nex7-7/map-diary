import type { JsonValue } from "@map-diary/crypto";
import { chainsOf, outletIds } from "../places/chains";
import { readPayload, type PlacePayload } from "../places/payloads";
import type { LngLat, PlaceChain } from "../places/types";
import { EntryError, findCataloguePlace, setOutletVisited, type DiaryWriter } from "./actions";
import { buildFacts, isFood } from "./facts";

/**
 * "Add a location" on a place page: another outlet of the place's chain, from a link. A Google
 * Maps link carries the pin, so the outlet is written here; anything else goes to the resolver
 * (PendingQueue.addOutlet) and joins the chain once found. The new outlet gets no opinions of
 * its own: the chain's status, tags and notes cover it. `been` marks it as an outlet the person
 * went to.
 */

/**
 * The chain a new location of this catalogue place joins: the place's own chain, or, for a
 * place not in one yet, a chain named after it with its id (as a new branch does). The admin's
 * device then writes that chain into the place's facts.
 */
export function chainToJoin(items: Parameters<typeof chainsOf>[0], placeId: string): { chain: PlaceChain; lead: PlacePayload } | undefined {
  const item = items.find((i) => i.id === placeId && i.type === "place");
  const lead = item && readPayload("place", item.payload);
  if (!lead || lead.mergedInto) return undefined;
  return { chain: chainsOf(items).get(placeId) ?? { id: placeId, name: lead.name }, lead };
}

export interface OutletForm {
  location: LngLat;
  /** The link as pasted, and the full Google Maps URL behind a short one. */
  links: string[];
  /** Typed by the person; the outlet is labelled by its area. */
  address: string;
}

/** The new outlet's facts: the chain's name, category, cuisine and wallet bleeder, at its own pin. */
export function outletFacts(lead: PlacePayload, chain: PlaceChain, form: OutletForm): PlacePayload {
  const built = buildFacts({
    name: chain.name,
    category: lead.category,
    location: form.location,
    address: form.address,
    cuisine: lead.cuisine ?? "",
    dishName: "",
    dishPrice: "",
    sourceLinks: form.links,
    chain,
  });
  if (!built.ok) throw new EntryError(built.message);
  const facts = built.facts;
  if (lead.signatureDish && isFood(lead.category)) facts.signatureDish = structuredClone(lead.signatureDish);
  return facts;
}

export type OutletAdded =
  /** Written as a new outlet of the chain. */
  | { kind: "added"; placeId: string }
  /** The link is for a location the chain has already. */
  | { kind: "there"; placeId: string }
  /** The link is for a place already in the diary on its own (or in another chain); only the admin can join it. */
  | { kind: "elsewhere"; placeId: string };

/** Writes a new outlet of the chain, unless the diary has the place under one of its links already. */
export async function addOutlet(w: DiaryWriter, chainPlaceId: string, facts: PlacePayload, been: boolean): Promise<OutletAdded> {
  const existing = await findCataloguePlace(w, facts.sourceLinks);
  if (existing) {
    const inChain = outletIds(await w.listItems(), chainPlaceId).includes(existing);
    if (!inChain) return { kind: "elsewhere", placeId: existing };
    if (been) await setOutletVisited(w, chainPlaceId, existing, true);
    return { kind: "there", placeId: existing };
  }
  const placeId = (await w.write({ type: "place", placeId: null, payload: facts as unknown as JsonValue })).id;
  if (been) await setOutletVisited(w, placeId, placeId, true);
  return { kind: "added", placeId };
}
