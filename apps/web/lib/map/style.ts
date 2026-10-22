import { layers, namedFlavor, type Flavor } from "@protomaps/basemaps";
import type { FeatureCollection, Point } from "geojson";
import type { LayerSpecification, LngLatBoundsLike, StyleSpecification } from "maplibre-gl";
import { categoryStyle } from "../places/categories";
import { CATEGORY_GLYPHS, type GlyphName } from "../ui/icon-paths";
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
 * The Protomaps basemap reading the on-device map file, drawn like a pen-and-ink map on
 * paper: ink road edges, a pale indigo sea with pencil hatching, faint buildings. Glyphs
 * and sprites are static files served with the app, so labels need no third-party request.
 */
export function basemapStyle(origin: string): StyleSpecification {
  return {
    version: 8,
    glyphs: `${origin}/map/fonts/{fontstack}/{range}.pbf`,
    sprite: `${origin}/map/sprites/light`,
    sources: {
      protomaps: {
        type: "vector",
        url: `pmtiles://${MAP_FILE_NAME}`,
        attribution: '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
      },
      [PINS_SOURCE]: { type: "geojson", data: emptyCollection() },
      [HERE_SOURCE]: { type: "geojson", data: emptyCollection() },
    },
    layers: [...inkLayers(layers("protomaps", INK_FLAVOR, { lang: "en" })), ...pinLayers()],
  };
}

const PAPER = "#f1ead9";
const INK = "#3d3934";
const SEA = "#d6e0df";
const LABEL = "#6a6356";

/** Protomaps' light flavour in ink and paper. */
const INK_FLAVOR: Flavor = (() => {
  const base = namedFlavor("light");
  const park = "#dfe3c8";
  const road = "#fbf6ea";
  return {
    ...base,
    background: "#e8e0cd",
    earth: PAPER,
    water: SEA,
    park_a: park,
    park_b: park,
    wood_a: park,
    wood_b: park,
    scrub_a: park,
    scrub_b: park,
    sand: "#efe4c8",
    beach: "#efe4c8",
    buildings: "#e7dfcc",
    pedestrian: PAPER,
    other: road,
    minor_service: road,
    minor_a: road,
    minor_b: road,
    link: road,
    major: road,
    highway: road,
    minor_service_casing: INK,
    minor_casing: INK,
    link_casing: INK,
    major_casing_early: INK,
    major_casing_late: INK,
    highway_casing_early: INK,
    highway_casing_late: INK,
    railway: "#8a8070",
    boundaries: "#8a8070",
    ocean_label: "#2e4b5a",
    roads_label_minor: LABEL,
    roads_label_minor_halo: PAPER,
    roads_label_major: LABEL,
    roads_label_major_halo: PAPER,
    subplace_label: LABEL,
    subplace_label_halo: PAPER,
    city_label: "#4f4a42",
    city_label_halo: PAPER,
  };
})();

/** The sea's pencil hatching, registered on the map as an image before the style needs it. */
export const HATCH_IMAGE = "ink-hatch";

/**
 * Pen work on top of the flavour: buildings get a faint ink outline, the shoreline an
 * indigo pen line, the sea its hatching, and the main roads' casings show from further out.
 */
function inkLayers(base: LayerSpecification[]): LayerSpecification[] {
  const out: LayerSpecification[] = [];
  for (const layer of base) {
    if (layer.id === "water" && layer.type === "fill") {
      out.push(layer, { ...layer, id: "water-hatch", paint: { "fill-pattern": HATCH_IMAGE, "fill-opacity": 0.55 } });
      out.push({ id: "water-shore", type: "line", source: "protomaps", "source-layer": "water", paint: { "line-color": "#2e4b5a", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 16, 1.6], "line-opacity": 0.75 } });
      continue;
    }
    if (layer.type === "line" && layer.id.includes("casing")) {
      // Pen edges thin out zoomed out, so the city reads as streets rather than a scribble.
      const minor = /minor|other|link|service/.test(layer.id);
      out.push({ ...layer, paint: { ...layer.paint, "line-opacity": ["interpolate", ["linear"], ["zoom"], 11, minor ? 0.18 : 0.4, 14, minor ? 0.7 : 0.9, 16, 1] } });
      continue;
    }
    if (layer.id === "pois" && layer.type === "symbol") {
      out.push({ ...layer, paint: { ...layer.paint, "text-color": "#4f4a42", "text-halo-color": PAPER, "icon-opacity": 0.7 } });
      continue;
    }
    if (layer.id === "buildings" && layer.type === "fill") {
      out.push({ ...layer, paint: { ...layer.paint, "fill-outline-color": "rgba(61,57,52,0.35)" } });
      continue;
    }
    out.push(layer);
  }
  return out;
}

/** Draws the hatching tile: thin diagonal pencil strokes on nothing. */
export function drawHatch(pixelRatio: number): ImageData | null {
  const css = 12;
  const px = Math.ceil(css * pixelRatio);
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(pixelRatio, pixelRatio);
  ctx.strokeStyle = "rgba(46,75,90,0.5)";
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  // Three strokes so the pattern tiles seamlessly corner to corner.
  for (const o of [-css, 0, css]) {
    ctx.moveTo(o, css);
    ctx.lineTo(o + css, 0);
  }
  ctx.stroke();
  return ctx.getImageData(0, 0, px, px);
}

/** Draws any image the style asks for: the sea's hatching or a pin. */
export function drawMapImage(id: string, pixelRatio: number): ImageData | null {
  return id === HATCH_IMAGE ? drawHatch(pixelRatio) : drawPin(id, pixelRatio);
}

/** The marker image's name: status, size and the category glyph. */
export function pinImageId(kind: PinKind, glyph: GlyphName, selected: boolean): string {
  return ["pin", kind, selected ? "1" : "0", glyph].join("|");
}

/** Pins are images drawn on demand (see `drawPin`), so labels sit under them. */
function pinLayers(): LayerSpecification[] {
  return [
    {
      id: PIN_LAYER,
      type: "symbol",
      source: PINS_SOURCE,
      layout: {
        "icon-image": ["get", "icon"],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        // Selected on top, then my own places over friends'.
        "symbol-sort-key": ["case", ["get", "selected"], 2, ["get", "mine"], 1, 0],
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Medium"],
        "text-size": 12,
        "text-offset": [0, 1.7],
        "text-anchor": "top",
        "text-optional": true,
      },
      paint: {
        "text-color": "#201f1b",
        "text-halo-color": "#f8f2e5",
        "text-halo-width": 1.8,
        // Names show once zoomed in, and always for the selected place.
        "text-opacity": ["step", ["zoom"], ["case", ["get", "selected"], 1, 0], 14, 1],
      },
    },
    {
      id: "here-halo",
      type: "circle",
      source: HERE_SOURCE,
      paint: { "circle-radius": 18, "circle-color": "#2e4b5a", "circle-opacity": 0.16 },
    },
    {
      id: "here",
      type: "circle",
      source: HERE_SOURCE,
      paint: {
        "circle-radius": 7,
        "circle-color": "#2e4b5a",
        "circle-stroke-color": "#f8f2e5",
        "circle-stroke-width": 2.5,
      },
    },
  ];
}

const PIN_INK: Record<PinKind, { fill: string; glyph: string; dashed: boolean }> = {
  visited: { fill: "#c63730", glyph: "#fff8ef", dashed: false },
  friend: { fill: "#6b3d61", glyph: "#fff8ef", dashed: false },
  want: { fill: "#f8f2e5", glyph: "#5f5a51", dashed: true },
  pending: { fill: "#f8f2e5", glyph: "#6a6356", dashed: true },
};

/**
 * Draws a marker for `pinImageId`: a vermilion seal for Visited (plum for a friend's), a
 * dashed graphite slot for Want to, each round the category's pencil glyph. A selected pin
 * is larger with a pencil circle round it. MapLibre asks for each the first time it is needed.
 */
export function drawPin(id: string, pixelRatio: number): ImageData | null {
  const [prefix, kind, selected, glyph] = id.split("|");
  if (prefix !== "pin" || !kind || !(kind in PIN_INK) || !glyph || !(glyph in CATEGORY_GLYPHS)) return null;
  const ink = PIN_INK[kind as PinKind];
  const big = selected === "1";
  const radius = big ? 19 : 14;
  const pad = big ? 10 : 4;
  const css = (radius + pad) * 2;
  const px = Math.ceil(css * pixelRatio);
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(pixelRatio, pixelRatio);
  const c = css / 2;

  // Paper rim and a soft shadow, then the seal or slot.
  ctx.shadowColor = "rgba(60,20,10,0.25)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;
  ctx.beginPath();
  ctx.arc(c, c, radius + 2.5, 0, Math.PI * 2);
  ctx.fillStyle = "#f8f2e5";
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.beginPath();
  ctx.arc(c, c, radius, 0, Math.PI * 2);
  ctx.fillStyle = ink.fill;
  ctx.fill();
  if (ink.dashed) {
    ctx.setLineDash([3.2, 2.4]);
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = ink.glyph;
    ctx.beginPath();
    ctx.arc(c, c, radius - 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    // The seal's inner ring.
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,248,239,0.55)";
    ctx.beginPath();
    ctx.arc(c, c, radius - 3, 0, Math.PI * 2);
    ctx.stroke();
  }

  // The glyph, drawn from its 24px path data.
  const scale = (radius * 1.15) / 24;
  ctx.save();
  ctx.translate(c - 12 * scale, c - 12 * scale);
  ctx.scale(scale, scale);
  ctx.lineWidth = 1.9;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = ink.glyph;
  for (const d of CATEGORY_GLYPHS[glyph as GlyphName]) ctx.stroke(new Path2D(d));
  ctx.restore();

  if (big) {
    // A pencil circle, not quite closed.
    ctx.lineWidth = 1.8;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#c63730";
    ctx.beginPath();
    ctx.ellipse(c, c, radius + 7, radius + 6, -0.2, 0.15, Math.PI * 2.05);
    ctx.stroke();
  }
  return ctx.getImageData(0, 0, px, px);
}

export type PinKind = "visited" | "want" | "friend" | "pending";

export interface PinProps {
  id: string;
  name: string;
  icon: string;
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
      const glyph = categoryStyle(place.category).glyph;
      // A chain gets a pin per outlet, all opening the one place page.
      return (place.outlets ?? [place]).map((at) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [at.location.lng, at.location.lat] },
        properties: {
          id: place.id,
          name: place.name,
          icon: pinImageId(kind, glyph, selected),
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
