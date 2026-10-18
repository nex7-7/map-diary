import { layers, namedFlavor } from "@protomaps/basemaps";
import type { FeatureCollection, Point } from "geojson";
import type { ExpressionSpecification, LayerSpecification, LngLatBoundsLike, StyleSpecification } from "maplibre-gl";
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
    layers: [...layers("protomaps", namedFlavor(flavor), { lang: "en" }), ...pinLayers(dark)],
  };
}

const isVisited: ExpressionSpecification = ["==", ["get", "status"], "visited"];

/**
 * Pins: colour is the category. Visited is a solid dot; Want to is a ring.
 * Someone else's status (not mine) is drawn smaller.
 */
function pinLayers(dark: boolean): LayerSpecification[] {
  const surface = dark ? "#1f1f1c" : "#ffffff";
  // "zoom" may only sit at the top of an expression, so the halo gets its own curve.
  const radius = (extra: number): ExpressionSpecification => [
    "interpolate", ["linear"], ["zoom"],
    10, ["case", ["get", "mine"], 5 + extra, 4 + extra],
    15, ["case", ["get", "mine"], 9 + extra, 7 + extra],
  ];
  return [
    {
      id: "pins-selected",
      type: "circle",
      source: PINS_SOURCE,
      filter: ["==", ["get", "selected"], true],
      paint: { "circle-radius": radius(6), "circle-color": ["get", "color"], "circle-opacity": 0.25 },
    },
    {
      id: PIN_LAYER,
      type: "circle",
      source: PINS_SOURCE,
      paint: {
        "circle-radius": radius(0),
        "circle-color": ["case", isVisited, ["get", "color"], surface],
        "circle-stroke-color": ["case", isVisited, surface, ["get", "color"]],
        "circle-stroke-width": ["case", isVisited, 1.5, 3],
      },
    },
    {
      id: "pins-label",
      type: "symbol",
      source: PINS_SOURCE,
      minzoom: 13,
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Medium"],
        "text-size": 12,
        "text-offset": [0, 1.1],
        "text-anchor": "top",
        "text-optional": true,
      },
      paint: {
        "text-color": ["get", "color"],
        "text-halo-color": surface,
        "text-halo-width": 1.5,
      },
    },
    {
      id: "here-halo",
      type: "circle",
      source: HERE_SOURCE,
      paint: { "circle-radius": 18, "circle-color": "#228be6", "circle-opacity": 0.18 },
    },
    {
      id: "here",
      type: "circle",
      source: HERE_SOURCE,
      paint: {
        "circle-radius": 7,
        "circle-color": "#228be6",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2.5,
      },
    },
  ];
}

export interface PinProps {
  id: string;
  name: string;
  status: string;
  color: string;
  mine: boolean;
  selected: boolean;
}

export function pinsCollection(listed: readonly ListedPlace[], selectedId: string | null): FeatureCollection<Point, PinProps> {
  return {
    type: "FeatureCollection",
    features: listed.map(({ place, status, mine }) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [place.location.lng, place.location.lat] },
      properties: {
        id: place.id,
        name: place.name,
        status,
        color: categoryStyle(place.category).color,
        mine,
        selected: place.id === selectedId,
      },
    })),
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
