"use client";

import type { ReactNode } from "react";
import { BUILTIN_CATEGORIES, type Category, type DiarySnapshot, type Status } from "@/lib/places/types";
import { categoryStyle, STATUS_LABELS } from "@/lib/places/categories";
import { EMPTY_FILTERS, type PlaceFilters } from "@/lib/places/filter";
import { ChipRow, FilterChip, Icon, StatusDot } from "@/lib/ui";

interface Props {
  snapshot: DiarySnapshot;
  filters: PlaceFilters;
  onChange: (next: PlaceFilters) => void;
}

/** Quick picks for the wallet-bleeder filter, in rupees; any other amount can be typed. */
const PRICE_STEPS = [200, 500, 1000, 2000];

const toggle = <T,>(list: readonly T[], value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

/** The filters beyond search and board: how many are on, for the badge on the filter button. */
export function extraFilterCount(f: PlaceFilters): number {
  return f.statuses.length + f.categories.length + f.tagIds.length + f.cuisines.length + f.authorIds.length + (f.maxPriceInr === null ? 0 : 1);
}

function categoriesOf(snapshot: DiarySnapshot): Category[] {
  return [...BUILTIN_CATEGORIES, ...new Set(snapshot.places.map((p) => p.category).filter((c) => c.startsWith("custom:")))];
}

/** The search field, inked like a label, with the filter button inside it. */
export function SearchField({
  filters,
  onChange,
  open,
  onToggle,
}: {
  filters: PlaceFilters;
  onChange: (next: PlaceFilters) => void;
  open: boolean;
  onToggle: () => void;
}) {
  const extra = extraFilterCount(filters);
  return (
    <label className="flex h-[42px] min-w-0 flex-1 items-center gap-2 rounded-[12px] border-[1.5px] border-ink bg-page pr-1 pl-3 text-ink shadow-[0_3px_0_var(--ink)] has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-indigo">
      <Icon name="search" size="m" />
      <input
        type="search"
        placeholder="Search places, dishes, cuisines"
        aria-label="Search"
        value={filters.query}
        onChange={(e) => onChange({ ...filters, query: e.target.value })}
        // 16px keeps iOS Safari from zooming in.
        className="min-w-0 flex-1 border-0 bg-transparent text-[16px] outline-none placeholder:text-ink-3"
      />
      <button
        type="button"
        className="relative grid size-8 place-items-center rounded-[9px] aria-expanded:bg-ink aria-expanded:text-page"
        aria-label={`Filters${extra ? `, ${extra} on` : ""}`}
        aria-expanded={open}
        onClick={onToggle}
      >
        <Icon name="filter" size="m" />
        {extra > 0 && (
          <span className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-seal px-1 text-[10px] font-bold text-cream">{extra}</span>
        )}
      </button>
    </label>
  );
}

/** Status and category chips, for floating over the map. */
export function QuickChips({ snapshot, filters, onChange }: Props) {
  const set = (patch: Partial<PlaceFilters>) => onChange({ ...filters, ...patch });
  return (
    <ChipRow label="Status and category">
      <StatusChipsRow filters={filters} set={set} />
      {categoriesOf(snapshot).map((c) => (
        <FilterChip key={c} on={filters.categories.includes(c)} onClick={() => set({ categories: toggle(filters.categories, c) })}>
          <Icon name={categoryStyle(c).glyph} size="s" />
          {categoryStyle(c).label}
        </FilterChip>
      ))}
    </ChipRow>
  );
}

function StatusChipsRow({ filters, set }: { filters: PlaceFilters; set: (p: Partial<PlaceFilters>) => void }) {
  return (
    <>
      {(["want", "visited"] as Status[]).map((s) => (
        <FilterChip key={s} on={filters.statuses.includes(s)} onClick={() => set({ statuses: toggle(filters.statuses, s) })}>
          <StatusDot kind={s} small />
          {STATUS_LABELS[s]}
        </FilterChip>
      ))}
    </>
  );
}

function Group({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="m-0 grid gap-2 border-0 p-0">
      <legend className="hand mb-1 text-[16px] text-ink-2">{legend}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

/** Every filter but search and board, on an index card under the search field. */
export function FilterPanel({ snapshot, cuisines, filters, onChange }: Props & { cuisines: string[] }) {
  const set = (patch: Partial<PlaceFilters>) => onChange({ ...filters, ...patch });
  const active = extraFilterCount(filters) > 0;
  return (
    <div className="page pop grid max-h-[45dvh] gap-4 overflow-y-auto rounded-[14px] border-[1.5px] border-ink p-4 shadow-[0_4px_0_var(--ink)] [--r:-0.6deg]">
      <Group legend="Status">
        <StatusChipsRow filters={filters} set={set} />
      </Group>
      <Group legend="Category">
        {categoriesOf(snapshot).map((c) => (
          <FilterChip key={c} on={filters.categories.includes(c)} onClick={() => set({ categories: toggle(filters.categories, c) })}>
            <Icon name={categoryStyle(c).glyph} size="s" />
            {categoryStyle(c).label}
          </FilterChip>
        ))}
      </Group>
      <Group legend="Tags">
        {snapshot.tags.length === 0 && <span className="sub">No tags yet.</span>}
        {snapshot.tags.map((t) => (
          <FilterChip key={t.id} on={filters.tagIds.includes(t.id)} onClick={() => set({ tagIds: toggle(filters.tagIds, t.id) })} title={t.description}>
            {t.emoji} {t.name}
          </FilterChip>
        ))}
      </Group>
      {cuisines.length > 0 && (
        <Group legend="Cuisine">
          {cuisines.map((c) => (
            <FilterChip key={c} on={filters.cuisines.includes(c)} onClick={() => set({ cuisines: toggle(filters.cuisines, c) })}>
              {c}
            </FilterChip>
          ))}
        </Group>
      )}
      <Group legend="Added by">
        {snapshot.people.map((p) => (
          <FilterChip key={p.id} on={filters.authorIds.includes(p.id)} onClick={() => set({ authorIds: toggle(filters.authorIds, p.id) })}>
            {p.id === snapshot.me.id ? "Me" : p.name}
          </FilterChip>
        ))}
      </Group>
      <Group legend="Signature dish up to">
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
          className="chip soft w-[7.5em]"
          aria-label="Signature dish up to, in rupees"
          placeholder="₹ other"
          value={filters.maxPriceInr !== null && !PRICE_STEPS.includes(filters.maxPriceInr) ? filters.maxPriceInr : ""}
          onChange={(e) => {
            const n = Number(e.target.value);
            set({ maxPriceInr: e.target.value && Number.isFinite(n) && n >= 0 ? Math.round(n) : null });
          }}
        />
      </Group>
      {active && (
        <div>
          <button
            type="button"
            className="sketch-link text-[14px] font-semibold"
            onClick={() => onChange({ ...EMPTY_FILTERS, query: filters.query, boards: filters.boards })}
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
