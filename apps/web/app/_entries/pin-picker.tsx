"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MapLibre } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { addAttribution } from "@/lib/map/attribution";
import { loadMapFile } from "@/lib/map/map-file";
import { registerProtocol } from "@/lib/map/protocol";
import { basemapStyle, drawMapImage, MUMBAI_CENTER } from "@/lib/map/style";
import type { LngLat } from "@/lib/places/types";
import styles from "./entries.module.css";
import { mapLoadMessage } from "@/lib/errors";

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

    loadMapFile((loaded, total) => setState({ kind: "loading", loaded, total }), abort.signal)
      .then((file) => {
        if (abort.signal.aborted || !container.current) return;
        registerProtocol(file);
        const start = latest.current.value;
        map = new MapLibre({
          container: container.current,
          style: basemapStyle(location.origin),
          center: start ? [start.lng, start.lat] : MUMBAI_CENTER,
          zoom: start ? 16 : 11,
          minZoom: 9,
          maxZoom: 19,
          attributionControl: false,
        });
        addAttribution(map);
        map.setMissingStyleImageResolver((id) => {
          const ratio = window.devicePixelRatio || 1;
          const image = drawMapImage(id, ratio);
          if (image && map && !map.hasImage(id)) map.addImage(id, image, { pixelRatio: ratio });
        });
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
        if (!abort.signal.aborted) setState({ kind: "failed", message: mapLoadMessage(err) });
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
          <svg className={styles.crosshair} viewBox="0 0 30 40" aria-hidden>
            <path d="M15 38C15 38 3 23.5 3 14.5a12 12 0 0 1 24 0C27 23.5 15 38 15 38Z" fill="var(--seal)" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" />
            <circle cx="15" cy="14.5" r="4.5" fill="var(--cream)" stroke="var(--ink)" strokeWidth="1.5" />
          </svg>
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
