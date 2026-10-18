"use client";

import "./diary.css";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { cuisinesOf, EMPTY_FILTERS, filterPlaces, sortPlaces, type PlaceFilters, type SortKey } from "@/lib/places/filter";
import type { DiarySnapshot, DiarySource, LngLat, Status } from "@/lib/places/types";
import { FilterBar } from "./filter-bar";
import { PlaceCard } from "./place-card";
import { PlacesList } from "./places-list";

// MapLibre needs the browser (WebGL, workers); never render it on the server.
const PlacesMap = dynamic(() => import("./places-map").then((m) => m.PlacesMap), {
  ssr: false,
  loading: () => <div className="map-wrap" />,
});

type View = "map" | "list";
type Locate = { kind: "off" } | { kind: "locating" } | { kind: "on"; here: LngLat } | { kind: "failed"; message: string };

export function DiaryView({ source }: { source: DiarySource }) {
  const [snapshot, setSnapshot] = useState<DiarySnapshot | null>(null);
  const [filters, setFilters] = useState<PlaceFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortKey>("added");
  const [view, setView] = useState<View>("map");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [locate, setLocate] = useState<Locate>({ kind: "off" });
  const here = locate.kind === "on" ? locate.here : undefined;
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const load = () => void source.load().then((s) => !cancelled && setSnapshot(s));
    load();
    const off = source.subscribe(load);
    return () => {
      cancelled = true;
      off();
    };
  }, [source]);

  const listed = useMemo(
    () => (snapshot ? sortPlaces(filterPlaces(snapshot.places, filters, snapshot.me.id, here), sort) : []),
    [snapshot, filters, here, sort],
  );
  const cuisines = useMemo(() => (snapshot ? cuisinesOf(snapshot.places) : []), [snapshot]);
  const selected = listed.find((l) => l.place.id === selectedId);

  /** Asks for the position only on tap. It stays in this tab's memory. */
  const nearMe = () => {
    if (locate.kind === "on") {
      setLocate({ kind: "off" });
      if (sort === "distance") setSort("added");
      return;
    }
    if (!("geolocation" in navigator)) {
      setLocate({ kind: "failed", message: "This browser cannot share a location." });
      return;
    }
    setLocate({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocate({ kind: "on", here: { lng: coords.longitude, lat: coords.latitude } });
        setSort("distance");
      },
      (err) => setLocate({ kind: "failed", message: err.code === err.PERMISSION_DENIED ? "Location permission was denied." : "Could not find your location." }),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  };

  const setStatus = (id: string, status: Status) => {
    void source.setStatus(id, status).then(setSnapshot);
  };

  if (!snapshot) return <p className="muted pad">Opening your diary…</p>;

  return (
    <div className="diary" data-view={view}>
      <div className="toolbar">
        <div className="segmented" role="tablist" aria-label="View">
          {(["map", "list"] as View[]).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}>
              {v === "map" ? "Map" : "List"}
            </button>
          ))}
        </div>
        <span className="count muted">
          {listed.length} {listed.length === 1 ? "place" : "places"}
        </span>
        <label className="sort">
          <span className="visually-hidden">Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="added">Newest</option>
            <option value="distance" disabled={!here}>
              Nearest
            </option>
            <option value="price">Cheapest dish</option>
          </select>
        </label>
        <button type="button" className="near-me" aria-pressed={locate.kind === "on"} onClick={nearMe} disabled={locate.kind === "locating"}>
          {locate.kind === "locating" ? "Locating…" : "Near me"}
        </button>
      </div>
      {locate.kind === "failed" && (
        <p className="notice" role="alert">
          {locate.message}
        </p>
      )}

      <FilterBar snapshot={snapshot} cuisines={cuisines} filters={filters} onChange={setFilters} />

      <div className="panes">
        <div className="pane pane-map">
          <PlacesMap
            listed={listed}
            here={here}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onLongPress={({ lat, lng }) => router.push(`/add#pin=${lat.toFixed(6)},${lng.toFixed(6)}`)}
          />
        </div>
        <div className="pane pane-list">
          <PlacesList
            listed={listed}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId(id === selectedId ? null : id)}
            onSetStatus={setStatus}
          />
        </div>
        {!selected && (
          <Link href="/add" className="add-fab" aria-label="Add a place">
            +
          </Link>
        )}
        {selected && (
          <PlaceCard item={selected} snapshot={snapshot} onClose={() => setSelectedId(null)} onSetStatus={setStatus} />
        )}
      </div>
    </div>
  );
}
