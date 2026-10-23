"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { MeLink } from "@/app/_shell/me-link";
import { cuisinesOf, EMPTY_FILTERS, filterPlaces, sortPlaces, type PlaceFilters, type SortKey } from "@/lib/places/filter";
import type { DiarySnapshot, DiarySource, LngLat, Status } from "@/lib/places/types";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/errors";
import { boardTint, Icon, Notebook, Picker, type NotebookTab } from "@/lib/ui";
import { FilterPanel, QuickChips, SearchField } from "./filter-bar";
import { PlaceCard } from "./place-card";
import { PlacesList } from "./places-list";

// MapLibre needs the browser (WebGL, workers); never render it on the server.
const PlacesMap = dynamic(() => import("./places-map").then((m) => m.PlacesMap), {
  ssr: false,
  loading: () => <div className="size-full" />,
});

/** Where the list and map sit side by side. */
const WIDE = "(min-width: 900px)";

export type DiaryViewMode = "map" | "list";
type Locate = { kind: "off" } | { kind: "locating" } | { kind: "on"; here: LngLat } | { kind: "failed"; message: string };

/**
 * The places screen. Phones show the map or the notebook (`view`, from the tab bar); from
 * 900px up the notebook and the map sit side by side.
 */
export function DiaryView({ source, view }: { source: DiarySource; view: DiaryViewMode }) {
  const [snapshot, setSnapshot] = useState<DiarySnapshot | null>(null);
  const [filters, setFilters] = useState<PlaceFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortKey>("added");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [locate, setLocate] = useState<Locate>({ kind: "off" });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [justStamped, setJustStamped] = useState<ReadonlySet<string>>(new Set());
  /** Bumped by the replay button, so the heading and rows play their entrance again. */
  const [take, setTake] = useState(0);
  const here = locate.kind === "on" ? locate.here : undefined;
  const router = useRouter();
  const stampTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

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
  useEffect(() => () => stampTimers.current.forEach(clearTimeout), []);

  const listed = useMemo(() => (snapshot ? sortPlaces(filterPlaces(snapshot.places, filters, snapshot.me.id, here), sort) : []), [snapshot, filters, here, sort]);
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
    source.setStatus(id, status).then(setSnapshot, toastError);
    if (status !== "visited") return;
    setJustStamped((s) => new Set(s).add(id));
    stampTimers.current.push(
      setTimeout(() => {
        setJustStamped((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
      }, 2400),
    );
  };

  if (!snapshot) return <p className="hand p-6 text-[18px] text-ink-3">Opening your diary…</p>;

  const { query, statuses, categories, tagIds, cuisines: picked, maxPriceInr, authorIds } = filters;
  const filtered = query.trim() !== "" || maxPriceInr !== null || [statuses, categories, tagIds, picked, authorIds].some((f) => f.length > 0);
  const empty = snapshot.places.length === 0 ? "diary" : filtered ? "filters" : "board";
  // Friends see others' places here too, so it's only "Your" places when every one is theirs.
  const whose = listed.every((l) => l.mine) ? "Your" : "Our";
  const want = mine.filter((l) => l.status === "want").length;
  const stamped = mine.length - want;
  const board = filters.boards[0] ?? "all";
  let groupN = 0;
  const tabs: NotebookTab[] = [
    { id: "all", label: "All", tint: boardTint("all") },
    ...[...snapshot.boards]
      .sort((a, b) => ORDER[a.kind] - ORDER[b.kind])
      .map((b) => ({ id: b.id, label: b.name, tint: boardTint(b.kind, b.kind === "group" ? groupN++ : 0) })),
  ].map((t) => (t.id === board ? { ...t, count: listed.length } : t));

  const nearMeChip = (
    <button type="button" className="chip h-9 bg-page" aria-pressed={locate.kind === "on"} onClick={nearMe} disabled={locate.kind === "locating"}>
      <Icon name="locate" size="s" />
      {locate.kind === "locating" ? "Finding you…" : "Near me"}
    </button>
  );
  const locateNotice = locate.kind === "failed" && (
    <p className="hand m-0 text-[15px] text-seal-deep" role="alert">
      {locate.message}
    </p>
  );

  return (
    <div className="relative flex h-[calc(100dvh-var(--tabbar-h)-env(safe-area-inset-bottom))] min-[900px]:h-dvh" data-view={view}>
      {/* The notebook */}
      <section className={cn("flex min-h-0 w-full flex-col min-[900px]:flex min-[900px]:w-[440px] min-[900px]:shrink-0", view === "list" ? "flex" : "hidden")} aria-label={`${whose} places`}>
        <header className="flex flex-col gap-3 px-4 pt-[max(16px,env(safe-area-inset-top))] pb-3.5">
          <div className="flex items-center justify-between gap-2">
            <p className="kicker rise">{snapshot.me.name && snapshot.me.name !== "Me" ? `${snapshot.me.name}'s diary · Mumbai` : "Your diary · Mumbai"}</p>
            <div className="flex items-center gap-2">
              <button type="button" className="chip soft size-8 justify-center p-0" onClick={() => setTake((n) => n + 1)} aria-label="Replay the animations">
                <Icon name="refresh" size="s" />
              </button>
              <MeLink me={snapshot.me} />
            </div>
          </div>
          <div key={take} className="relative">
            <h1 className="display flip-wrap flex items-baseline gap-3 text-[46px]">
              <span className="flip" style={{ animationDelay: "0.05s" }}>
                {whose}
              </span>
              <span className="relative inline-block">
                <span className="flip italic" style={{ animationDelay: "0.16s" }}>
                  places
                </span>
                <svg viewBox="0 0 140 16" width="132" height="15" aria-hidden className="absolute -bottom-2.5 -left-1">
                  <path d="M3 10c22-6 50-8 76-5 18 2 36 4 58-3" className="draw-path" fill="none" stroke="var(--seal)" strokeWidth="3" strokeLinecap="round" style={{ animationDelay: "0.55s" }} />
                </svg>
              </span>
            </h1>
            <div className="pop absolute top-[-2px] right-0 flex flex-col items-end [--r:4deg]" style={{ animationDelay: "0.9s" }}>
              <span className="hand text-right text-[16px] leading-[1.1] text-ink-2">
                {stamped} stamped,
                <br />
                {want} to go
              </span>
              <svg viewBox="0 0 40 30" width="34" height="26" aria-hidden className="mr-[30px]">
                <path d="M34 2c-4 12-14 20-28 22M6 24l7-6M6 24l8 3" fill="none" stroke="var(--ink-2)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
          <div className="mt-1 flex gap-2">
            <SearchField filters={filters} onChange={setFilters} open={filtersOpen} onToggle={() => setFiltersOpen(!filtersOpen)} />
            <Picker
              label="Sort"
              className="h-[42px] rounded-[12px]"
              align="right"
              value={sort}
              options={[
                { value: "added", label: "Newest" },
                { value: "distance", label: here ? "Nearest" : "Nearest (tap Near me)", disabled: !here },
                { value: "price", label: "Cheapest dish" },
              ]}
              onChange={setSort}
            />
          </div>
          {filtersOpen && <FilterPanel snapshot={snapshot} cuisines={cuisines} filters={filters} onChange={setFilters} />}
          <div className="flex items-center gap-2 min-[900px]:hidden">{locate.kind !== "off" && locateNotice}</div>
        </header>
        <Notebook
          label="Boards"
          tabs={tabs}
          value={board}
          onValueChange={(id) => setFilters({ ...filters, boards: id === "all" ? [] : [id] })}
          className="flex-1"
        >
          <div key={`${board}-${take}`} className="min-h-0 flex-1 overflow-y-auto pt-2">
            <PlacesList
              listed={listed}
              snapshot={snapshot}
              selectedId={selectedId}
              justStamped={justStamped}
              onSelect={(id) => {
                // Beside the map a row selects its pin; on a phone it opens the place.
                if (window.matchMedia(WIDE).matches) setSelectedId(id === selectedId ? null : id);
                else router.push(`/place#${encodeURIComponent(id)}`);
              }}
              onSetStatus={setStatus}
              empty={empty}
            />
          </div>
        </Notebook>
      </section>

      {/* The map */}
      <section className={cn("relative min-h-0 flex-1 min-[900px]:block", view === "map" ? "block" : "hidden")} aria-label="Map">
        <PlacesMap
          listed={listed}
          here={here}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onLongPress={({ lat, lng }) => router.push(`/add#pin=${lat.toFixed(6)},${lng.toFixed(6)}`)}
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-2 px-3 pt-[max(12px,env(safe-area-inset-top))]">
          <div className="pointer-events-auto flex items-center gap-2">
            <p className="page flex h-9 items-center gap-1.5 rounded-full border-[1.5px] border-ink px-3.5 shadow-[0_2px_0_var(--ink)] min-[900px]:hidden">
              <span className="kicker text-ink">Mumbai</span>
              <span className="hand text-[15px] text-ink-2">· {stamped} stamped</span>
            </p>
            <span className="flex-1" />
            {nearMeChip}
            <MeLink me={snapshot.me} />
          </div>
          <div className="pointer-events-auto min-[900px]:hidden">
            <QuickChips snapshot={snapshot} filters={filters} onChange={setFilters} />
          </div>
          <div className="pointer-events-auto">{locateNotice}</div>
        </div>
        {selected && (
          <div className="absolute inset-x-2.5 bottom-3 z-20 min-[900px]:right-auto min-[900px]:bottom-6 min-[900px]:left-6 min-[900px]:w-[380px]">
            <PlaceCard key={selected.place.id} item={selected} snapshot={snapshot} onClose={() => setSelectedId(null)} onSetStatus={setStatus} />
          </div>
        )}
      </section>
    </div>
  );
}

const ORDER = { personal: 0, master: 1, group: 2 } as const;
