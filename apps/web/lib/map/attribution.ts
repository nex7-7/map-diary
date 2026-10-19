import { AttributionControl, type Map } from "maplibre-gl";

/**
 * The map credits (Protomaps, © OpenStreetMap), which must stay on the map, as a small ⓘ
 * button in the corner. MapLibre opens the compact credits on first load; they start
 * folded here and a tap opens them.
 */
export function addAttribution(map: Map): void {
  map.addControl(new AttributionControl({ compact: true }), "bottom-right");
  map.once("idle", () => {
    map.getContainer().querySelector(".maplibregl-ctrl-attrib.maplibregl-compact-show")?.classList.remove("maplibregl-compact-show");
  });
}
