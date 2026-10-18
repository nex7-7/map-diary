"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { addProtocol, AttributionControl, getVersion, Map as MapLibre, setWorkerUrl } from "maplibre-gl";
import { FileSource, PMTiles, Protocol } from "pmtiles";
import { useEffect, useRef, useState } from "react";
import { loadMapFile } from "@/lib/map/map-file";
import { basemapStyle, MUMBAI_CENTER } from "@/lib/map/style";
import type { LngLat } from "@/lib/places/types";
import styles from "./entries.module.css";

let protocol: Protocol | undefined;

function registerProtocol(file: File): void {
  if (!protocol) {
    setWorkerUrl(`/map/maplibre/${getVersion()}/maplibre-gl-worker.mjs`);
    protocol = new Protocol();
    addProtocol("pmtiles", protocol.tile);
  }
  protocol.add(new PMTiles(new FileSource(file)));
}

type LoadState = { kind: "loading"; loaded: number; total: number | undefined } | { kind: "ready" } | { kind: "failed"; message: string };

interface Props {
  value: LngLat | null;
  /** Called when the person moves the map; the pin is the map's centre. */
  onChange: (location: LngLat) => void;
}

/**
 * Drop a pin by moving the map under a fixed pin. Reads the Mumbai map file on the device,
 * so where the person looks is never sent anywhere.
 */
export function PinPicker({ value, onChange }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const [state, setState] = useState<LoadState>({ kind: "loading", loaded: 0, total: undefined });
  const [locating, setLocating] = useState(false);
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };

  useEffect(() => {
    const abort = new AbortController();
    let map: MapLibre | undefined;
    const dark = window.matchMedia("(prefers-color-scheme: dark)");

    loadMapFile((loaded, total) => setState({ kind: "loading", loaded, total }), abort.signal)
      .then((file) => {
        if (abort.signal.aborted || !container.current) return;
        registerProtocol(file);
        const start = latest.current.value;
        map = new MapLibre({
          container: container.current,
          style: basemapStyle(location.origin, dark.matches),
          center: start ? [start.lng, start.lat] : MUMBAI_CENTER,
          zoom: start ? 16 : 11,
          minZoom: 9,
          maxZoom: 19,
          attributionControl: false,
        });
        map.addControl(new AttributionControl({ compact: true }), "bottom-right");
        map.on("moveend", (e) => {
          // Only the person's own moves drop the pin, not programmatic jumps.
          if (!map || !("originalEvent" in e) || !e.originalEvent) return;
          const c = map.getCenter();
          latest.current.onChange({ lng: c.lng, lat: c.lat });
        });
        mapRef.current = map;
        setState({ kind: "ready" });
      })
      .catch((err: unknown) => {
        if (!abort.signal.aborted) setState({ kind: "failed", message: err instanceof Error ? err.message : "The map could not load" });
      });

    return () => {
      abort.abort();
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // Follow a location set from outside (a pasted link, or "Here").
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !value) return;
    const c = map.getCenter();
    if (Math.abs(c.lng - value.lng) > 1e-6 || Math.abs(c.lat - value.lat) > 1e-6) {
      map.jumpTo({ center: [value.lng, value.lat], zoom: Math.max(map.getZoom(), 16) });
    }
  }, [value, state.kind]);

  /** The position is used here, on the device, to centre the map; it is never sent. */
  const here = () => {
    if (!("geolocation" in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(false);
        latest.current.onChange({ lng: coords.longitude, lat: coords.latitude });
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  };

  return (
    <div className={styles.picker}>
      <div ref={container} className={styles.pickermap} role="region" aria-label="Move the map to put the pin on the place" />
      {state.kind === "ready" && (
        <>
          <span className={styles.crosshair} aria-hidden>
            📍
          </span>
          <button type="button" className={styles.pickerhere} onClick={here} disabled={locating}>
            {locating ? "Locating…" : "I'm here"}
          </button>
        </>
      )}
      {state.kind === "loading" && (
        <div className={styles.pickeroverlay} role="status">
          <span>Saving the Mumbai map to this device…</span>
          {state.total !== undefined && <progress value={state.loaded} max={state.total} />}
        </div>
      )}
      {state.kind === "failed" && (
        <div className={styles.pickeroverlay} role="alert">
          <span>{state.message}</span>
        </div>
      )}
    </div>
  );
}
