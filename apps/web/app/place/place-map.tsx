"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MapLibre, type GeoJSONSource } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { addAttribution } from "@/lib/map/attribution";
import { loadMapFile } from "@/lib/map/map-file";
import { registerProtocol } from "@/lib/map/protocol";
import { basemapStyle, drawMapImage, PINS_SOURCE, pinsCollection, type PinKind } from "@/lib/map/style";
import type { LngLat, PlaceView } from "@/lib/places/types";

/**
 * A still map around one place, from the map file on this device. It only shows where the
 * place is; panning and zooming happen on the main map. A chain shows every location's pin,
 * centred on `focus`.
 */
export function PlaceMap({ place, focus, kind, className }: { place: PlaceView; focus?: LngLat; kind: PinKind; className?: string | undefined }) {
  const container = useRef<HTMLDivElement>(null);
  const latest = useRef(place);
  latest.current = place;
  const { id } = place;
  const at = focus ?? place.location;

  useEffect(() => {
    const abort = new AbortController();
    let map: MapLibre | undefined;
    const center: [number, number] = [at.lng, at.lat];
    const show = () => {
      const place = latest.current;
      // A pending pin draws in the friends' colour slot; the status decides the rest.
      const status = kind === "want" || kind === "visited" ? kind : "want";
      const listed = [{ place, status, mine: kind !== "friend", addedAt: "" }] as const;
      map?.getSource<GeoJSONSource>(PINS_SOURCE)?.setData(pinsCollection(listed, place.id));
    };

    // The same on-device copy the main map reads (downloaded once, if it isn't saved yet).
    loadMapFile(() => {}, abort.signal)
      .then((file) => {
        if (abort.signal.aborted || !container.current) return;
        registerProtocol(file);
        map = new MapLibre({
          container: container.current,
          style: basemapStyle(location.origin),
          center,
          zoom: 15,
          interactive: false,
          attributionControl: false,
        });
        addAttribution(map);
        map.setMissingStyleImageResolver((id) => {
          const ratio = window.devicePixelRatio || 1;
          const image = drawMapImage(id, ratio);
          if (image && map && !map.hasImage(id)) map.addImage(id, image, { pixelRatio: ratio });
        });
        map.on("style.load", show);
      })
      .catch(() => {
        // No map file yet: the paper background stands in.
      });
    return () => {
      abort.abort();
      map?.remove();
    };
    // Rebuilt only when the place or its pin changes, not on every sync.
  }, [id, at.lng, at.lat, kind]);

  return <div ref={container} className={className} role="img" aria-label={`Map around ${place.name}`} />;
}
