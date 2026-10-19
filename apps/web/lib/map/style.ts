import { layers, namedFlavor, type Flavor } from "@protomaps/basemaps";
import type { FeatureCollection, Point } from "geojson";
import type { LayerSpecification, LngLatBoundsLike, StyleSpecification } from "maplibre-gl";
import { categoryStyle } from "../places/categories";
import type { ListedPlace } from "../places/filter";
import type { LngLat } from "../places/types";
import { MAP_FILE_NAME } from "./map-file";

/** The area covered by the map file (west, south, east, north). */
export const MUMBAI_BOUNDS: LngLatBoundsLike = [72.75, 18.85, 73.15, 19.35];
export const MUMBAI_CENTER: [number, number] = [72.86, 19.05];

export const PINS_SOURCE = "pins";
export const HERE_SOURCE = "here";
export const PIN_LAYER = "pins";

/**
 * The Protomaps basemap reading the on-device map file. Glyphs and sprites are
 * static files served with the app, so labels need no third-party request.
 */
export function basemapStyle(origin: string, dark: boolean): StyleSpecification {
  const flavor = dark ? "dark" : "light";
  return {
    version: 8,
    glyphs: `${origin}/map/fonts/{fontstack}/{range}.pbf`,
    sprite: `${origin}/map/sprites/${flavor}`,
    sources: {
      protomaps: {
        type: "vector",
        url: `pmtiles://${MAP_FILE_NAME}`,
        attribution: '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
      },
      [PINS_SOURCE]: { type: "geojson", data: emptyCollection() },
      [HERE_SOURCE]: { type: "geojson", data: emptyCollection() },
    },
    layers: [...layers("protomaps", diaryFlavor(dark), { lang: "en" }), ...pinLayers(dark)],
  };
}

/** Protomaps' light and dark flavours in the diary's paper palette (the map colours in Figma). */
function diaryFlavor(dark: boolean): Flavor {
  const base = namedFlavor(dark ? "dark" : "light");
  const land = dark ? "#29251f" : "#efe8d9";
  const park = dark ? "#25301f" : "#d5e2c3";
  const road = dark ? "#3b352c" : "#ffffff";
  const label = dark ? "#80766a" : "#9a8f7a";
  return {
    ...base,
    background: dark ? "#16130f" : "#e6dfd0",
    earth: land,
    water: dark ? "#1b3138" : "#bcd8dd",
    park_a: park,
    park_b: park,
    wood_a: park,
    wood_b: park,
    scrub_a: park,
    scrub_b: park,
    sand: dark ? "#2e2920" : "#ece2cc",
    beach: dark ? "#2e2920" : "#ece2cc",
    buildings: dark ? "#332d25" : "#e4dbc9",
    pedestrian: land,
    minor_b: road,
    link: road,
    major: road,
    highway: road,
    ocean_label: dark ? "#6db3c4" : "#24697a",
    subplace_label: label,
    subplace_label_halo: land,
    city_label: label,
    city_label_halo: land,
  };
}

/** The marker image's name: status colour, emoji and size, and the colour scheme. */
export function pinImageId(kind: PinKind, emoji: string, selected: boolean, dark: boolean): string {
  return ["pin", dark ? "dark" : "light", kind, selected ? "1" : "0", emoji].join("|");
}

/** Pins are images drawn on demand (see `drawPin`), so labels sit under them. */
function pinLayers(dark: boolean): LayerSpecification[] {
  const surface = dark ? "#201c17" : "#fffdf8";
  const ink = dark ? "#f1eadc" : "#1e1a15";
  return [
    {
      id: PIN_LAYER,
      type: "symbol",
      source: PINS_SOURCE,
      layout: {
        "icon-image": dark ? ["get", "iconDark"] : ["get", "icon"],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        // Selected on top, then my own places over friends'.
        "symbol-sort-key": ["case", ["get", "selected"], 2, ["get", "mine"], 1, 0],
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Medium"],
        "text-size": 12,
        "text-offset": [0, 1.6],
        "text-anchor": "top",
        "text-optional": true,
      },
      paint: {
        "text-color": ink,
        "text-halo-color": surface,
        "text-halo-width": 1.5,
        // Names show once zoomed in, and always for the selected place.
        "text-opacity": ["step", ["zoom"], ["case", ["get", "selected"], 1, 0], 14, 1],
      },
    },
    {
      id: "here-halo",
      type: "circle",
      source: HERE_SOURCE,
      paint: { "circle-radius": 18, "circle-color": dark ? "#6db3c4" : "#24697a", "circle-opacity": 0.18 },
    },
    {
      id: "here",
      type: "circle",
      source: HERE_SOURCE,
      paint: {
        "circle-radius": 7,
        "circle-color": dark ? "#6db3c4" : "#24697a",
        "circle-stroke-color": surface,
        "circle-stroke-width": 2.5,
      },
    },
  ];
}

const PIN_COLORS: Record<"light" | "dark", Record<PinKind, string>> = {
  light: { visited: "#2e7a51", want: "#cf5b24", friend: "#7a4a86", pending: "#8e846f" },
  dark: { visited: "#6cc28f", want: "#ee8a55", friend: "#c99dd5", pending: "#928874" },
};

/**
 * Draws a marker for `pinImageId`: a status-coloured disc with a light rim around the
 * category emoji. MapLibre asks for each one the first time it is needed.
 */
export function drawPin(id: string, pixelRatio: number): ImageData | null {
  const [prefix, scheme, kind, selected, ...rest] = id.split("|");
  const emoji = rest.join("|");
  if (prefix !== "pin" || (scheme !== "light" && scheme !== "dark") || !kind || !(kind in PIN_COLORS.light)) return null;
  const radius = selected === "1" ? 21 : 14;
  const rim = 3;
  const shadow = 3;
  const css = (radius + rim + shadow) * 2;
  const px = Math.ceil(css * pixelRatio);
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(pixelRatio, pixelRatio);
  const c = css / 2;
  ctx.shadowColor = scheme === "dark" ? "rgba(0,0,0,0.5)" : "rgba(40,28,12,0.25)";
  ctx.shadowBlur = shadow;
  ctx.shadowOffsetY = 1;
  ctx.beginPath();
  ctx.arc(c, c, radius + rim, 0, Math.PI * 2);
  ctx.fillStyle = scheme === "dark" ? "#201c17" : "#fffdf8";
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.beginPath();
  ctx.arc(c, c, radius, 0, Math.PI * 2);
  ctx.fillStyle = PIN_COLORS[scheme][kind as PinKind];
  ctx.fill();
  ctx.font = `${Math.round(radius * 1.05)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, c, c + radius * 0.08);
  return ctx.getImageData(0, 0, px, px);
}

export type PinKind = "visited" | "want" | "friend" | "pending";

export interface PinProps {
  id: string;
  name: string;
  icon: string;
  iconDark: string;
  mine: boolean;
  selected: boolean;
}

export function pinsCollection(listed: readonly ListedPlace[], selectedId: string | null): FeatureCollection<Point, PinProps> {
  return {
    type: "FeatureCollection",
    features: listed.flatMap(({ place, status, mine }) => {
      // Someone else's status, not mine: drawn in the friends' colour.
      const kind: PinKind = mine ? status : "friend";
      const selected = place.id === selectedId;
      const emoji = categoryStyle(place.category).emoji;
      // A chain gets a pin per outlet, all opening the one place page.
      return (place.outlets ?? [place]).map((at) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [at.location.lng, at.location.lat] },
        properties: {
          id: place.id,
          name: place.name,
          icon: pinImageId(kind, emoji, selected, false),
          iconDark: pinImageId(kind, emoji, selected, true),
          mine,
          selected,
        },
      }));
    }),
  };
}

export function hereCollection(here: LngLat | undefined): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: here ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [here.lng, here.lat] } }] : [],
  };
}

function emptyCollection(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}
