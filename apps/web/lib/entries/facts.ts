import type { JsonValue } from "@map-diary/crypto";
import { readPayload, type PlacePayload } from "../places/payloads";
import type { Category, LngLat } from "../places/types";

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
}

export type FactsResult = { ok: true; facts: PlacePayload } | { ok: false; message: string };

/** Turns the form into a place payload, checked by the same reader every device uses. */
export function buildFacts(form: FactsForm): FactsResult {
  const name = form.name.trim();
  if (!name) return { ok: false, message: "Give the place a name" };
  if (!form.location) return { ok: false, message: "Put the place on the map" };

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
