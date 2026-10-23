"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MapLibre, NavigationControl, type GeoJSONSource, type MapMouseEvent, type MapTouchEvent } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { addAttribution } from "@/lib/map/attribution";
import { loadMapFile } from "@/lib/map/map-file";
import { registerProtocol } from "@/lib/map/protocol";
import {
  basemapStyle,
  drawMapImage,
  HERE_SOURCE,
  hereCollection,
  MUMBAI_BOUNDS,
  MUMBAI_CENTER,
  PIN_LAYER,
  PINS_SOURCE,
  onMap,
  pinsCollection,
  type PinProps,
} from "@/lib/map/style";
import type { ListedPlace } from "@/lib/places/filter";
import type { LngLat } from "@/lib/places/types";
import { Button } from "@/lib/ui";
import { mapLoadMessage } from "@/lib/errors";

const LONG_PRESS_MS = 600;

type LoadState = { kind: "loading"; loaded: number; total: number | undefined } | { kind: "ready" } | { kind: "failed"; message: string };

interface Props {
  listed: readonly ListedPlace[];
  here: LngLat | undefined;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** A long press (or right-click) on the map, to drop a pin there. */
  onLongPress?: (at: LngLat) => void;
}

export function PlacesMap({ listed, here, selectedId, onSelect, onLongPress }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const [state, setState] = useState<LoadState>({ kind: "loading", loaded: 0, total: undefined });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef({ listed, here, selectedId, onSelect, onLongPress });
  latest.current = { listed, here, selectedId, onSelect, onLongPress };

  useEffect(() => {
    const abort = new AbortController();
    let map: MapLibre | undefined;
    // Runs when the style loads.
    const syncData = () => {
      if (!map) return;
      const { listed, here, selectedId } = latest.current;
      map.getSource<GeoJSONSource>(PINS_SOURCE)?.setData(pinsCollection(listed, selectedId));
      map.getSource<GeoJSONSource>(HERE_SOURCE)?.setData(hereCollection(here));
    };

    loadMapFile((loaded, total) => setState({ kind: "loading", loaded, total }), abort.signal)
      .then((file) => {
        if (abort.signal.aborted || !container.current) return;
        registerProtocol(file);
        map = new MapLibre({
          container: container.current,
          style: basemapStyle(location.origin),
          center: MUMBAI_CENTER,
          zoom: 11,
          minZoom: 9,
          maxZoom: 18,
          maxBounds: padBounds(MUMBAI_BOUNDS as [number, number, number, number], 0.15),
          attributionControl: false,
        });
        map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
        // Pin images are drawn the first time each status, emoji and size is needed.
        map.setMissingStyleImageResolver((id) => {
          const ratio = window.devicePixelRatio || 1;
          const image = drawMapImage(id, ratio);
          if (image && map && !map.hasImage(id)) map.addImage(id, image, { pixelRatio: ratio });
        });
        addAttribution(map);
        map.on("style.load", syncData);
        map.on("click", PIN_LAYER, (e) => {
          const props = e.features?.[0]?.properties as PinProps | undefined;
          if (props) latest.current.onSelect(props.id);
        });
        map.on("click", (e) => {
          if (map?.queryRenderedFeatures(e.point, { layers: [PIN_LAYER] }).length === 0) latest.current.onSelect(null);
        });
        addLongPress(map, (at) => latest.current.onLongPress?.(at));
        map.on("mouseenter", PIN_LAYER, () => map && (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", PIN_LAYER, () => map && (map.getCanvas().style.cursor = ""));
        mapRef.current = map;
        setState({ kind: "ready" });
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        setState({ kind: "failed", message: mapLoadMessage(err) });
      });

    return () => {
      abort.abort();
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
    if (!map || !place || !onMap(place.location)) return;
    // A chain is in view when any of its outlets is.
    const bounds = map.getBounds();
    if (!(place.outlets ?? [place]).some((o) => bounds.contains([o.location.lng, o.location.lat]))) {
      map.easeTo({ center: [place.location.lng, place.location.lat], zoom: Math.max(map.getZoom(), 14) });
    }
    // Only when the selection changes, not on every filter change.
  }, [selectedId]);

  return (
    <div className="paper relative size-full">
      <div ref={container} className="ink-map size-full" role="region" aria-label="Map of places" />
      {state.kind === "loading" && (
        <div className="absolute inset-0 grid place-items-center p-6" role="status">
          <div className="page pop flex w-full max-w-[300px] flex-col gap-2 rounded-[16px] border-[1.5px] border-ink p-5 text-center shadow-[0_4px_0_var(--ink)] [--r:-1deg]">
            <p className="font-serif text-[20px] leading-tight">Inking the Mumbai map onto this device…</p>
            <p className="hand text-[15px] text-ink-3">{progressLabel(state.loaded, state.total)}</p>
            {state.total !== undefined && (
              <span className="h-2 overflow-hidden rounded-full border border-ink bg-paper-deep">
                <span className="block h-full bg-seal transition-[width]" style={{ width: `${Math.round((state.loaded / state.total) * 100)}%` }} />
              </span>
            )}
          </div>
        </div>
      )}
      {state.kind === "failed" && (
        <div className="absolute inset-0 grid place-items-center p-6" role="alert">
          <div className="page flex max-w-[300px] flex-col items-center gap-3 rounded-[16px] border-[1.5px] border-ink p-5 text-center shadow-[0_4px_0_var(--ink)]">
            <p className="font-serif text-[19px] leading-tight">{state.message}</p>
            <Button size="m" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Long press on touch screens; right-click (contextmenu) elsewhere. Android
 * Chrome fires both for one press, so a press reports once.
 */
function addLongPress(map: MapLibre, fire: (at: LngLat) => void): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastFired = 0;
  const report = ({ lng, lat }: { lng: number; lat: number }) => {
    if (Date.now() - lastFired < 1000) return;
    lastFired = Date.now();
    fire({ lng, lat });
  };
  const cancel = () => clearTimeout(timer);

  map.on("touchstart", (e: MapTouchEvent) => {
    cancel();
    if (e.originalEvent.touches.length !== 1) return;
    const at = e.lngLat;
    timer = setTimeout(() => report(at), LONG_PRESS_MS);
  });
  map.on("touchend", cancel);
  map.on("touchcancel", cancel);
  map.on("movestart", cancel);
  map.on("contextmenu", (e: MapMouseEvent) => {
    e.preventDefault();
    report(e.lngLat);
  });
}

function padBounds([w, s, e, n]: [number, number, number, number], pad: number): [number, number, number, number] {
  return [w - pad, s - pad, e + pad, n + pad];
}

function progressLabel(loaded: number, total: number | undefined): string {
  const mb = (b: number) => (b / 1_048_576).toFixed(1);
  return total ? `${mb(loaded)} of ${mb(total)} MB, once only` : loaded > 0 ? `${mb(loaded)} MB` : "Starting";
}
