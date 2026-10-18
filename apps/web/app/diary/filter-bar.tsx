"use client";

import type { ReactNode } from "react";
import { BUILTIN_CATEGORIES, type Category, type DiarySnapshot, type Status } from "@/lib/places/types";
import { categoryStyle, STATUS_LABELS } from "@/lib/places/categories";
import { EMPTY_FILTERS, type PlaceFilters } from "@/lib/places/filter";

interface Props {
  snapshot: DiarySnapshot;
  cuisines: string[];
  filters: PlaceFilters;
  onChange: (next: PlaceFilters) => void;
}

const toggle = <T,>(list: readonly T[], value: T): T[] =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

export function FilterBar({ snapshot, cuisines, filters, onChange }: Props) {
  const set = (patch: Partial<PlaceFilters>) => onChange({ ...filters, ...patch });
  const categories: Category[] = [
    ...BUILTIN_CATEGORIES,
    ...new Set(snapshot.places.map((p) => p.category).filter((c) => c.startsWith("custom:"))),
  ];
  const extraCount =
    filters.tagIds.length + filters.cuisines.length + filters.authorIds.length + (filters.maxPriceInr === null ? 0 : 1);
  const active = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);

  return (
    <div className="filters">
      <div className="filter-row">
        <input
          type="search"
          placeholder="Search places, dishes, cuisines"
          aria-label="Search"
          value={filters.query}
          onChange={(e) => set({ query: e.target.value })}
        />
        <select
          aria-label="Board"
          value={filters.boards[0] ?? ""}
          onChange={(e) => set({ boards: e.target.value ? [e.target.value] : [] })}
        >
          <option value="">All boards</option>
          {snapshot.boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      <div className="chips" role="group" aria-label="Status and category">
        {(["visited", "want"] as Status[]).map((s) => (
          <Chip key={s} on={filters.statuses.includes(s)} onClick={() => set({ statuses: toggle(filters.statuses, s) })}>
            <span className={`dot dot-${s}`} aria-hidden /> {STATUS_LABELS[s]}
          </Chip>
        ))}
        <span className="chip-sep" aria-hidden />
        {categories.map((c) => {
          const style = categoryStyle(c);
          return (
            <Chip key={c} on={filters.categories.includes(c)} onClick={() => set({ categories: toggle(filters.categories, c) })}>
              <span aria-hidden>{style.emoji}</span> {style.label}
            </Chip>
          );
        })}
      </div>

      <details className="more-filters">
        <summary>
          More filters{extraCount > 0 ? ` (${extraCount})` : ""}
          {active && (
            <button type="button" className="link" onClick={(e) => (e.preventDefault(), onChange(EMPTY_FILTERS))}>
              Clear all
            </button>
          )}
        </summary>
        <fieldset>
          <legend>Tags</legend>
          <div className="chips">
            {snapshot.tags.map((t) => (
              <Chip key={t.id} on={filters.tagIds.includes(t.id)} onClick={() => set({ tagIds: toggle(filters.tagIds, t.id) })} title={t.description}>
                {t.emoji} {t.name}
              </Chip>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Cuisine</legend>
          <div className="chips">
            {cuisines.map((c) => (
              <Chip key={c} on={filters.cuisines.includes(c)} onClick={() => set({ cuisines: toggle(filters.cuisines, c) })}>
                {c}
              </Chip>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Added by</legend>
          <div className="chips">
            {snapshot.people.map((p) => (
              <Chip key={p.id} on={filters.authorIds.includes(p.id)} onClick={() => set({ authorIds: toggle(filters.authorIds, p.id) })}>
                {p.id === snapshot.me.id ? "Me" : p.name}
              </Chip>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Signature dish up to</legend>
          <div className="chips">
            {[200, 500, 1000].map((max) => (
              <Chip key={max} on={filters.maxPriceInr === max} onClick={() => set({ maxPriceInr: filters.maxPriceInr === max ? null : max })}>
                ₹{max.toLocaleString("en-IN")}
              </Chip>
            ))}
          </div>
        </fieldset>
      </details>
    </div>
  );
}

function Chip({ on, onClick, title, children }: { on: boolean; onClick: () => void; title?: string; children: ReactNode }) {
  return (
    <button type="button" className="chip" aria-pressed={on} onClick={onClick} title={title}>
      {children}
    </button>
  );
}
