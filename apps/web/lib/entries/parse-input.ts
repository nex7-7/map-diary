import type { LngLat } from "../places/types";

/**
 * Reads what was typed, pasted or shared into the Add sheet: a place name, a link, share
 * text with a link in it, coordinates or a `geo:` URI. Runs on the device only; nothing
 * here makes a request.
 */

export type LinkSource = "google-maps" | "zomato" | "district" | "other";

export interface ParsedEntry {
  /** A best guess at the place's name, to prefill the name field. */
  name?: string;
  /** Exact coordinates, when the input carries them. */
  location?: LngLat;
  /** The link as given, kept as the place's source link. */
  link?: string;
  source?: LinkSource;
  /**
   * A short Google Maps link (maps.app.goo.gl): its coordinates are only in the redirect
   * target, which a web page cannot read. The place waits for a location.
   */
  shortLink: boolean;
}

const URL_IN_TEXT = /\b(?:https?:\/\/|geo:)[^\s<>"]+/i;

export function parseEntry(input: string): ParsedEntry {
  const text = input.trim();
  if (!text) return { shortLink: false };

  const coords = parseCoordinates(text);
  if (coords) return { location: coords, shortLink: false };

  const match = URL_IN_TEXT.exec(text);
  if (!match) return { name: cleanName(text), shortLink: false };

  const raw = trimTrailing(match[0]);
  // Share text from the Google Maps app is the name (and maybe the address) above the link.
  const around = (text.slice(0, match.index) + " " + text.slice(match.index + match[0].length)).trim();
  const sharedName = around ? cleanName(around.split(/\n|·|\|/)[0] ?? "") : undefined;

  const parsed = parseLink(raw);
  const name = sharedName || parsed.name;
  return { ...parsed, ...(name ? { name } : {}) };
}

/** Drops sentence punctuation after a link, but keeps a closing bracket the link opened. */
function trimTrailing(link: string): string {
  let out = link.replace(/[.,;!?]+$/, "");
  while (/[)\]]$/.test(out)) {
    const close = out.at(-1) === ")" ? ")" : "]";
    const open = close === ")" ? "(" : "[";
    if (out.split(open).length >= out.split(close).length) break;
    out = out.slice(0, -1).replace(/[.,;!?]+$/, "");
  }
  return out;
}

export function parseLink(raw: string): ParsedEntry {
  if (/^geo:/i.test(raw)) return { ...parseGeoUri(raw), link: raw, source: "other", shortLink: false };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { name: cleanName(raw), shortLink: false };
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  if (isShortGoogleMapsLink(host, url.pathname)) {
    return { link: raw, source: "google-maps", shortLink: true };
  }
  if (isGoogleMapsUrl(host, url.pathname)) {
    return { ...parseGoogleMapsUrl(url), link: raw, source: "google-maps", shortLink: false };
  }
  if (host === "zomato.com" || host.endsWith(".zomato.com")) {
    const name = nameFromSlug(zomatoSlug(url.pathname));
    return { link: raw, source: "zomato", shortLink: false, ...(name ? { name } : {}) };
  }
  if (host === "district.in" || host.endsWith(".district.in")) {
    const name = nameFromSlug(lastSlug(url.pathname));
    return { link: raw, source: "district", shortLink: false, ...(name ? { name } : {}) };
  }
  return { link: raw, source: "other", shortLink: false };
}

function isShortGoogleMapsLink(host: string, path: string): boolean {
  return host === "maps.app.goo.gl" || (host === "goo.gl" && path.startsWith("/maps")) || host === "g.co";
}

function isGoogleMapsUrl(host: string, path: string): boolean {
  // google.com, google.co.in, maps.google.com, …
  if (/^maps\.google\.[a-z.]+$/.test(host)) return true;
  return /^google\.[a-z.]+$/.test(host) && path.startsWith("/maps");
}

/**
 * Coordinates in a full Google Maps URL, best first: the place's own pin (`!3d…!4d…` in the
 * data part), then an explicit query, then the viewport centre (`@lat,lng,zoom`), which is
 * only where the map was looking.
 */
export function parseGoogleMapsUrl(url: URL): Pick<ParsedEntry, "name" | "location"> {
  const href = decodeURIComponent(url.href);
  const out: Pick<ParsedEntry, "name" | "location"> = {};

  const placeName = /\/maps\/place\/([^/@]+)/.exec(url.pathname)?.[1];
  if (placeName) {
    const name = cleanName(decodePlus(placeName));
    if (name && !parseCoordinates(name)) out.name = name;
  }

  const pins = [...href.matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g)];
  const pin = pins.at(-1);
  const fromPin = pin ? toLngLat(pin[1], pin[2]) : undefined;
  if (fromPin) return { ...out, location: fromPin };

  for (const key of ["q", "query", "destination", "ll", "center", "daddr"]) {
    const value = url.searchParams.get(key);
    if (!value) continue;
    const coords = parseCoordinates(value);
    if (coords) return { ...out, location: coords };
    if ((key === "q" || key === "query") && !out.name) {
      const name = cleanName(value);
      if (name) out.name = name;
    }
  }

  const searched = /\/maps\/search\/([^/@]+)/.exec(url.pathname)?.[1];
  if (searched) {
    const term = decodePlus(searched);
    const coords = parseCoordinates(term);
    if (coords) return { ...out, location: coords };
    if (!out.name && cleanName(term)) out.name = cleanName(term);
  }

  const view = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(url.pathname);
  const fromView = view ? toLngLat(view[1], view[2]) : undefined;
  if (fromView) out.location = fromView;
  return out;
}

function parseGeoUri(raw: string): Pick<ParsedEntry, "name" | "location"> {
  // geo:19.07,72.87?q=19.07,72.87(Name)  or  geo:0,0?q=Some+Place
  const body = raw.slice(4);
  const [path = "", query = ""] = body.split("?");
  const q = new URLSearchParams(query).get("q") ?? "";
  const label = /\(([^)]+)\)\s*$/.exec(q)?.[1];
  const out: Pick<ParsedEntry, "name" | "location"> = {};
  if (label && cleanName(label)) out.name = cleanName(label);
  const location = parseCoordinates(q.replace(/\(.*$/, "")) ?? parseCoordinates(path.split(";")[0] ?? "");
  if (location) out.location = location;
  else if (!out.name && q && cleanName(q)) out.name = cleanName(q);
  return out;
}

/**
 * "19.0760, 72.8777", "19.0760 72.8777" or "19.0760° N, 72.8777° E". Latitude comes first,
 * as Google Maps writes it.
 */
export function parseCoordinates(text: string): LngLat | undefined {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])?\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])?\s*$/i.exec(text);
  if (!m) return undefined;
  let lat = Number(m[1]);
  let lng = Number(m[3]);
  if (m[2]?.toUpperCase() === "S") lat = -Math.abs(lat);
  if (m[4]?.toUpperCase() === "W") lng = -Math.abs(lng);
  return validLngLat(lat, lng);
}

function toLngLat(lat: string | undefined, lng: string | undefined): LngLat | undefined {
  return validLngLat(Number(lat), Number(lng));
}

function validLngLat(lat: number, lng: number): LngLat | undefined {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return undefined;
  // 0,0 is what a link without a location carries.
  if (lat === 0 && lng === 0) return undefined;
  return { lng, lat };
}

function decodePlus(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s.replace(/\+/g, " ");
  }
}

function zomatoSlug(path: string): string | undefined {
  // /mumbai/britannia-co-fort/info → britannia-co-fort
  const parts = path.split("/").filter(Boolean);
  return parts.length >= 2 ? parts[1] : undefined;
}

function lastSlug(path: string): string | undefined {
  const parts = path.split("/").filter((p) => p && !/^(info|order|menu|reviews|photos|book)$/i.test(p));
  return parts.at(-1);
}

/** "britannia-co-fort" → "Britannia Co Fort": a starting point the person can edit. */
function nameFromSlug(slug: string | undefined): string | undefined {
  if (!slug) return undefined;
  const words = decodePlus(slug)
    .replace(/-\d+$/, "")
    .split(/[-_]+/)
    .filter((w) => w && !/^[0-9a-f]{6,}$/i.test(w));
  if (words.length === 0) return undefined;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function cleanName(s: string): string {
  return s.replace(/\s+/g, " ").replace(/^[\s"'“”‘’]+|[\s"'“”‘’,:-]+$/g, "").slice(0, 120);
}

const TRACKING = /^(utm_.*|g_st|g_ep|entry|shorturl|fbclid|gclid|si|ref|ref_)$/i;

/**
 * A link reduced to what identifies the place, so pasting the same place twice can be
 * caught: no scheme, `www.`, tracking parameters, fragment or trailing slash.
 */
export function normaliseLink(raw: string): string {
  try {
    const url = new URL(raw.trim());
    const params = [...url.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
    const query = params.length ? "?" + new URLSearchParams(params).toString() : "";
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return `${host}${url.pathname.replace(/\/+$/, "")}${query}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}
