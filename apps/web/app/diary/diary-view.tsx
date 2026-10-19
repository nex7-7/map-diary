"use client";

import "./diary.css";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { cuisinesOf, EMPTY_FILTERS, filterPlaces, sortPlaces, type PlaceFilters, type SortKey } from "@/lib/places/filter";
import type { DiarySnapshot, DiarySource, LngLat, Status } from "@/lib/places/types";
import { FilterBar } from "./filter-bar";
import { PlaceCard } from "./place-card";
import { PlacesList } from "./places-list";
import { Icon } from "@/lib/ui";

// MapLibre needs the browser (WebGL, workers); never render it on the server.
const PlacesMap = dynamic(() => import("./places-map").then((m) => m.PlacesMap), {
  ssr: false,
  loading: () => <div className="map-wrap" />,
});

/** Where the list and map sit side by side; matches diary.css. */
const WIDE = "(min-width: 900px)";

export type DiaryViewMode = "map" | "list";
type Locate = { kind: "off" } | { kind: "locating" } | { kind: "on"; here: LngLat } | { kind: "failed"; message: string };

/**
 * The places screen. Phones show the map or the list (`view`, from the tab bar); from 900px
 * up the list and map sit side by side.
 */
export function DiaryView({ source, view }: { source: DiarySource; view: DiaryViewMode }) {
  const [snapshot, setSnapshot] = useState<DiarySnapshot | null>(null);
  const [filters, setFilters] = useState<PlaceFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortKey>("added");
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
  const mine = useMemo(() => (snapshot ? filterPlaces(snapshot.places, EMPTY_FILTERS, snapshot.me.id).filter((l) => l.mine) : []), [snapshot]);
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

  if (!snapshot) return <p className="sub pad">Opening your diary…</p>;

  const want = mine.filter((l) => l.status === "want").length;
  const nearMeButton = (
    <button type="button" className="near-me" aria-pressed={locate.kind === "on"} onClick={nearMe} disabled={locate.kind === "locating"}>
      <Icon name="locate" size="s" />
      {locate.kind === "locating" ? "Locating…" : "Near me"}
    </button>
  );

  return (
    <div className="diary" data-view={view} data-selected={selected ? "true" : undefined}>
      <div className="listpane">
        <div className="list-head">
          <div className="list-title">
            <div>
              <h1 className="display">Your places</h1>
              <p className="sub">
                {mine.length} {mine.length === 1 ? "place" : "places"} · {want} want to · {mine.length - want} visited
              </p>
            </div>
            {nearMeButton}
          </div>
          <FilterBar snapshot={snapshot} cuisines={cuisines} filters={filters} onChange={setFilters} />
          {locate.kind === "failed" && (
            <p className="notice" role="alert">
              {locate.message}
            </p>
          )}
          <div className="sort-row">
            <span className="sub">
              {listed.length} {listed.length === 1 ? "place" : "places"} · sorted by
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
              <Icon name="chevronDown" size="s" />
            </label>
          </div>
        </div>
        <div className="list-items">
          <PlacesList
            listed={listed}
            snapshot={snapshot}
            selectedId={selectedId}
            onSelect={(id) => {
              // Beside the map a row selects its pin; on a phone it opens the place.
              if (window.matchMedia(WIDE).matches) setSelectedId(id === selectedId ? null : id);
              else router.push(`/place#${encodeURIComponent(id)}`);
            }}
            onSetStatus={setStatus}
          />
        </div>
      </div>

      <div className="mappane">
        <PlacesMap
          listed={listed}
          here={here}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onLongPress={({ lat, lng }) => router.push(`/add#pin=${lat.toFixed(6)},${lng.toFixed(6)}`)}
        />
        <div className="map-tools">
          <button type="button" className="fab" aria-pressed={locate.kind === "on"} onClick={nearMe} disabled={locate.kind === "locating"} aria-label="Near me">
            <Icon name="locate" size="m" />
          </button>
        </div>
        {selected && (
          <div className="peek">
            <PlaceCard item={selected} snapshot={snapshot} onClose={() => setSelectedId(null)} onSetStatus={setStatus} />
          </div>
        )}
      </div>
    </div>
  );
}
