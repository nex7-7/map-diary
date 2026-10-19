"use client";

import { useState } from "react";
import { BUILTIN_CATEGORIES, type Category, type DiarySnapshot, type Status } from "@/lib/places/types";
import { categoryStyle, STATUS_LABELS } from "@/lib/places/categories";
import { EMPTY_FILTERS, type PlaceFilters } from "@/lib/places/filter";
import { ChipRow, FilterChip, Icon, StatusDot } from "@/lib/ui";

interface Props {
  snapshot: DiarySnapshot;
  cuisines: string[];
  filters: PlaceFilters;
  onChange: (next: PlaceFilters) => void;
}

/** Quick picks for the wallet-bleeder filter, in rupees; any other amount can be typed. */
const PRICE_STEPS = [200, 500, 1000, 2000];

const toggle = <T,>(list: readonly T[], value: T): T[] =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

/** Search, then one row of chips: board, status, category, and More for the rest. */
export function FilterBar({ snapshot, cuisines, filters, onChange }: Props) {
  const [more, setMore] = useState(false);
  const set = (patch: Partial<PlaceFilters>) => onChange({ ...filters, ...patch });
  const categories: Category[] = [
    ...BUILTIN_CATEGORIES,
    ...new Set(snapshot.places.map((p) => p.category).filter((c) => c.startsWith("custom:"))),
  ];
  const extraCount =
    filters.tagIds.length + filters.cuisines.length + filters.authorIds.length + (filters.maxPriceInr === null ? 0 : 1);
  const active = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);
  const board = filters.boards[0] ?? "";

  return (
    <div className="filters">
      <label className="search">
        <Icon name="search" size="m" />
        <input
          type="search"
          placeholder="Search places, dishes, cuisines"
          aria-label="Search"
          value={filters.query}
          onChange={(e) => set({ query: e.target.value })}
        />
        <button
          type="button"
          className="search-more"
          aria-label={`More filters${extraCount ? `, ${extraCount} on` : ""}`}
          aria-expanded={more}
          onClick={() => setMore(!more)}
        >
          <Icon name="filter" size="m" />
          {extraCount > 0 && <span className="search-count">{extraCount}</span>}
        </button>
      </label>

      <ChipRow label="Board, status and category">
        <label className={`board-chip${board ? " on" : ""}`}>
          <select aria-label="Board" value={board} onChange={(e) => set({ boards: e.target.value ? [e.target.value] : [] })}>
            <option value="">All boards</option>
            {snapshot.boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <Icon name="chevronDown" size="s" />
        </label>
        {(["want", "visited"] as Status[]).map((s) => (
          <FilterChip key={s} on={filters.statuses.includes(s)} onClick={() => set({ statuses: toggle(filters.statuses, s) })}>
            <StatusDot kind={s} small />
            {STATUS_LABELS[s]}
          </FilterChip>
        ))}
        {categories.map((c) => {
          const style = categoryStyle(c);
          return (
            <FilterChip key={c} on={filters.categories.includes(c)} onClick={() => set({ categories: toggle(filters.categories, c) })}>
              <span aria-hidden>{style.emoji}</span>
              {style.label}
            </FilterChip>
          );
        })}
        {active && (
          <FilterChip on={false} onClick={() => onChange(EMPTY_FILTERS)}>
            <Icon name="x" size="s" />
            Clear
          </FilterChip>
        )}
      </ChipRow>

      {more && (
        <div className="more-filters">
          <fieldset>
            <legend className="overline">Tags</legend>
            <div className="wrap-chips">
              {snapshot.tags.length === 0 && <span className="sub">No tags yet.</span>}
              {snapshot.tags.map((t) => (
                <FilterChip key={t.id} on={filters.tagIds.includes(t.id)} onClick={() => set({ tagIds: toggle(filters.tagIds, t.id) })} title={t.description}>
                  {t.emoji} {t.name}
                </FilterChip>
              ))}
            </div>
          </fieldset>
          {cuisines.length > 0 && (
            <fieldset>
              <legend className="overline">Cuisine</legend>
              <div className="wrap-chips">
                {cuisines.map((c) => (
                  <FilterChip key={c} on={filters.cuisines.includes(c)} onClick={() => set({ cuisines: toggle(filters.cuisines, c) })}>
                    {c}
                  </FilterChip>
                ))}
              </div>
            </fieldset>
          )}
          <fieldset>
            <legend className="overline">Added by</legend>
            <div className="wrap-chips">
              {snapshot.people.map((p) => (
                <FilterChip key={p.id} on={filters.authorIds.includes(p.id)} onClick={() => set({ authorIds: toggle(filters.authorIds, p.id) })}>
                  {p.id === snapshot.me.id ? "Me" : p.name}
                </FilterChip>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="overline">Signature dish up to</legend>
            <div className="wrap-chips">
              {PRICE_STEPS.map((max) => (
                <FilterChip key={max} on={filters.maxPriceInr === max} onClick={() => set({ maxPriceInr: filters.maxPriceInr === max ? null : max })}>
                  ₹{max.toLocaleString("en-IN")}
                </FilterChip>
              ))}
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={50}
                className="price-input"
                aria-label="Signature dish up to, in rupees"
                placeholder="₹ other"
                value={filters.maxPriceInr !== null && !PRICE_STEPS.includes(filters.maxPriceInr) ? filters.maxPriceInr : ""}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  set({ maxPriceInr: e.target.value && Number.isFinite(n) && n >= 0 ? Math.round(n) : null });
                }}
              />
            </div>
          </fieldset>
        </div>
      )}
    </div>
  );
}
