import { MUMBAI_BOUNDS, type JsonValue } from "@map-diary/crypto";
import { readPayload, type PlacePayload } from "../places/payloads";
import { normaliseChainName } from "../places/chains";
import type { Category, LngLat, PlaceChain } from "../places/types";

/** Categories that get a wallet bleeder (signature dish and price). */
const FOOD: readonly Category[] = ["restaurant", "cafe-bar"];

export function isFood(category: Category): boolean {
  return FOOD.includes(category);
}

/** The place form as typed. Empty strings mean "not given". */
export interface FactsForm {
  name: string;
  category: Category;
  location: LngLat | null;
  address: string;
  cuisine: string;
  dishName: string;
  dishPrice: string;
  sourceLinks: string[];
  /** The chain the place had; kept unless `chainName` changes it. */
  chain?: PlaceChain;
  /** The chain's name as typed; empty takes the place out of its chain. */
  chainName?: string;
}

export type FactsResult = { ok: true; facts: PlacePayload } | { ok: false; message: string };

/**
 * Turns the form into a place payload, checked by the same reader every device uses.
 * `chainFor` finds or makes the chain for a newly typed chain name.
 */
export function buildFacts(form: FactsForm, chainFor?: (name: string) => PlaceChain): FactsResult {
  const name = form.name.trim();
  if (!name) return { ok: false, message: "Give the place a name" };
  if (!form.location) return { ok: false, message: "Put the place on the map" };
  if (!inMumbai(form.location)) return { ok: false, message: "That's outside Mumbai. The diary only covers Mumbai for now." };

  const facts: PlacePayload = {
    name: name.slice(0, 120),
    category: form.category,
    location: { lng: round(form.location.lng), lat: round(form.location.lat) },
    sourceLinks: [...new Set(form.sourceLinks.map((l) => l.trim()).filter((l) => /^https?:\/\//i.test(l)))],
  };
  if (form.address.trim()) facts.address = form.address.trim().slice(0, 200);
  if (form.cuisine.trim()) facts.cuisine = form.cuisine.trim().slice(0, 60);

  const dish = form.dishName.trim();
  const price = form.dishPrice.trim().replace(/[₹,\s]/g, "");
  if (isFood(form.category) && (dish || price)) {
    const priceInr = Number(price);
    if (!dish || !price || !Number.isFinite(priceInr) || priceInr < 0) {
      return { ok: false, message: "A wallet bleeder needs both a dish and its price in ₹" };
    }
    facts.signatureDish = { name: dish.slice(0, 80), priceInr: Math.round(priceInr) };
  }

  const chainName = form.chainName?.trim();
  if (chainName === undefined) {
    if (form.chain) facts.chain = form.chain;
  } else if (chainName) {
    const same = form.chain && normaliseChainName(form.chain.name) === normaliseChainName(chainName);
    const chain = same ? form.chain : chainFor?.(chainName);
    if (chain) facts.chain = chain;
  }

  if (!readPayload("place", facts as unknown as JsonValue)) return { ok: false, message: "Those details don't fit a place" };
  return { ok: true, facts };
}

export function formFromFacts(facts: PlacePayload): FactsForm {
  return {
    name: facts.name,
    category: facts.category,
    location: facts.location,
    address: facts.address ?? "",
    cuisine: facts.cuisine ?? "",
    dishName: facts.signatureDish?.name ?? "",
    dishPrice: facts.signatureDish ? String(facts.signatureDish.priceInr) : "",
    sourceLinks: facts.sourceLinks,
    ...(facts.chain ? { chain: facts.chain } : {}),
    chainName: facts.chain?.name ?? "",
  };
}

/** Six decimals is about 10 cm: plenty, and keeps payloads short. */
function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** "Rooftop café" → "custom:rooftop-cafe". */
export function customCategory(label: string): Category | null {
  const slug = label
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug ? `custom:${slug}` : null;
}

/** The same bounds the resolver and the Claude tools check: a place outside them never enters the catalogue. */
function inMumbai({ lng, lat }: LngLat): boolean {
  const [west, south, east, north] = MUMBAI_BOUNDS;
  return lng >= west && lng <= east && lat >= south && lat <= north;
}
