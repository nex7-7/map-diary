"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import {
  addProtocol,
  AttributionControl,
  getVersion,
  Map as MapLibre,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
} from "maplibre-gl";
import { FileSource, PMTiles, Protocol } from "pmtiles";
import { useEffect, useRef, useState } from "react";
import { loadMapFile } from "@/lib/map/map-file";
import {
  basemapStyle,
  HERE_SOURCE,
  hereCollection,
  MUMBAI_BOUNDS,
  MUMBAI_CENTER,
  PIN_LAYER,
  PINS_SOURCE,
  pinsCollection,
  type PinProps,
} from "@/lib/map/style";
import type { ListedPlace } from "@/lib/places/filter";
import type { LngLat } from "@/lib/places/types";

let protocol: Protocol | undefined;

function registerProtocol(file: File): void {
  if (!protocol) {
    // Copied into public/ by scripts/copy-maplibre-worker.mjs.
    setWorkerUrl(`/map/maplibre/${getVersion()}/maplibre-gl-worker.mjs`);
    protocol = new Protocol();
    addProtocol("pmtiles", protocol.tile);
  }
  protocol.add(new PMTiles(new FileSource(file)));
}

type LoadState = { kind: "loading"; loaded: number; total: number | undefined } | { kind: "ready" } | { kind: "failed"; message: string };

interface Props {
  listed: readonly ListedPlace[];
  here: LngLat | undefined;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function PlacesMap({ listed, here, selectedId, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const [state, setState] = useState<LoadState>({ kind: "loading", loaded: 0, total: undefined });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef({ listed, here, selectedId, onSelect });
  latest.current = { listed, here, selectedId, onSelect };

  useEffect(() => {
    const abort = new AbortController();
    let map: MapLibre | undefined;
    const dark = window.matchMedia("(prefers-color-scheme: dark)");

    // Runs on every style load (first load and light/dark switches).
    const syncData = () => {
      if (!map) return;
      const { listed, here, selectedId } = latest.current;
      map.getSource<GeoJSONSource>(PINS_SOURCE)?.setData(pinsCollection(listed, selectedId));
      map.getSource<GeoJSONSource>(HERE_SOURCE)?.setData(hereCollection(here));
    };
    const onScheme = () => map?.setStyle(basemapStyle(location.origin, dark.matches));

    loadMapFile((loaded, total) => setState({ kind: "loading", loaded, total }), abort.signal)
      .then((file) => {
        if (abort.signal.aborted || !container.current) return;
        registerProtocol(file);
        map = new MapLibre({
          container: container.current,
          style: basemapStyle(location.origin, dark.matches),
          center: MUMBAI_CENTER,
          zoom: 11,
          minZoom: 9,
          maxZoom: 18,
          maxBounds: padBounds(MUMBAI_BOUNDS as [number, number, number, number], 0.15),
          attributionControl: false,
        });
        map.addControl(new NavigationControl({ showCompass: false }), "top-right");
        map.addControl(new AttributionControl({ compact: true }), "bottom-right");
        map.on("style.load", syncData);
        map.on("click", PIN_LAYER, (e) => {
          const props = e.features?.[0]?.properties as PinProps | undefined;
          if (props) latest.current.onSelect(props.id);
        });
        map.on("click", (e) => {
          if (map?.queryRenderedFeatures(e.point, { layers: [PIN_LAYER] }).length === 0) latest.current.onSelect(null);
        });
        map.on("mouseenter", PIN_LAYER, () => map && (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", PIN_LAYER, () => map && (map.getCanvas().style.cursor = ""));
        dark.addEventListener("change", onScheme);
        mapRef.current = map;
        setState({ kind: "ready" });
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        setState({ kind: "failed", message: err instanceof Error ? err.message : "The map could not load" });
      });

    return () => {
      abort.abort();
      dark.removeEventListener("change", onScheme);
      map?.remove();
      mapRef.current = null;
    };
  }, [attempt]);

  // Keep pins and the position dot in step with the filters.
  useEffect(() => {
    // Before the style loads the source is missing; syncData fills it then.
    mapRef.current?.getSource<GeoJSONSource>(PINS_SOURCE)?.setData(pinsCollection(listed, selectedId));
  }, [listed, selectedId, state.kind]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getSource<GeoJSONSource>(HERE_SOURCE)?.setData(hereCollection(here));
    if (here) map.easeTo({ center: [here.lng, here.lat], zoom: Math.max(map.getZoom(), 14) });
  }, [here, state.kind]);

  // Bring the selected place into view.
  useEffect(() => {
    const map = mapRef.current;
    const place = listed.find((l) => l.place.id === selectedId)?.place;
    if (!map || !place) return;
    if (!map.getBounds().contains([place.location.lng, place.location.lat])) {
      map.easeTo({ center: [place.location.lng, place.location.lat], zoom: Math.max(map.getZoom(), 14) });
    }
    // Only when the selection changes, not on every filter change.
  }, [selectedId]);

  return (
    <div className="map-wrap">
      <div ref={container} className="map" role="region" aria-label="Map of places" />
      {state.kind === "loading" && (
        <div className="map-overlay" role="status">
          <p>Saving the Mumbai map to this device…</p>
          <p className="muted">{progressLabel(state.loaded, state.total)}</p>
          {state.total !== undefined && <progress value={state.loaded} max={state.total} />}
        </div>
      )}
      {state.kind === "failed" && (
        <div className="map-overlay" role="alert">
          <p>{state.message}</p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

function padBounds([w, s, e, n]: [number, number, number, number], pad: number): [number, number, number, number] {
  return [w - pad, s - pad, e + pad, n + pad];
}

function progressLabel(loaded: number, total: number | undefined): string {
  const mb = (b: number) => (b / 1_048_576).toFixed(1);
  return total ? `${mb(loaded)} of ${mb(total)} MB, once only` : loaded > 0 ? `${mb(loaded)} MB` : "Starting";
}
