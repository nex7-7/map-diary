"use client";

import { useState } from "react";
import { customCategory } from "@/lib/entries/facts";
import { CATEGORY_STYLES, categoryStyle } from "@/lib/places/categories";
import type { TagDefPayload } from "@/lib/places/payloads";
import { BUILTIN_CATEGORIES, type Category, type Status } from "@/lib/places/types";
import { Icon, StatusChip } from "@/lib/ui";
import styles from "./entries.module.css";

export function StatusToggle({ value, onChange, disabled }: { value: Status | null; onChange: (s: Status) => void; disabled?: boolean }) {
  return (
    <div className={styles.row} role="group" aria-label="Status">
      {(["want", "visited"] as const).map((s) => (
        <StatusChip key={s} status={s} on={value === s} onClick={() => onChange(s)} disabled={disabled === true} />
      ))}
    </div>
  );
}

export function CategoryPicker({ value, onChange }: { value: Category; onChange: (c: Category) => void }) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const isCustom = value.startsWith("custom:");

  const addCustom = () => {
    const c = customCategory(label);
    if (c) onChange(c);
    setAdding(false);
    setLabel("");
  };

  return (
    <div className={styles.chips} role="group" aria-label="Category">
      {BUILTIN_CATEGORIES.map((c) => (
        <button key={c} type="button" className={styles.chip} aria-pressed={value === c} onClick={() => onChange(c)}>
          {CATEGORY_STYLES[c].emoji} {CATEGORY_STYLES[c].label}
        </button>
      ))}
      {isCustom && (
        <button type="button" className={styles.chip} aria-pressed onClick={() => setAdding(true)}>
          {categoryStyle(value).emoji} {categoryStyle(value).label}
        </button>
      )}
      {adding ? (
        <span className={styles.row}>
          <input
            className={styles.input}
            style={{ width: "11rem", padding: "6px 10px" }}
            autoFocus
            placeholder="New category"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustom();
              }
              if (e.key === "Escape") setAdding(false);
            }}
          />
          <button type="button" className={styles.textbutton} onClick={addCustom}>
            Add
          </button>
        </span>
      ) : (
        !isCustom && (
          <button type="button" className={styles.chip} onClick={() => setAdding(true)}>
            <Icon name="plus" size="s" />
            Other
          </button>
        )
      )}
    </div>
  );
}

export interface TagChoice extends TagDefPayload {
  id: string;
}

interface TagPickerProps {
  tags: readonly TagChoice[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onCreate: (def: TagDefPayload) => void;
  disabled?: boolean;
}

/** Tag chips (the description shows on hover and long-press) and a form for a new tag. */
export function TagPicker({ tags, selected, onToggle, onCreate, disabled }: TagPickerProps) {
  const [creating, setCreating] = useState(false);
  const [def, setDef] = useState<TagDefPayload>({ name: "", emoji: "", description: "" });

  const create = () => {
    if (!def.name.trim()) return;
    onCreate(def);
    setDef({ name: "", emoji: "", description: "" });
    setCreating(false);
  };

  return (
    <div className={styles.section}>
      <div className={styles.chips} role="group" aria-label="Tags">
        {tags.map((t) => (
          <button
            key={t.id}
            type="button"
            className={styles.chip}
            aria-pressed={selected.has(t.id)}
            title={t.description || undefined}
            onClick={() => onToggle(t.id)}
            disabled={disabled}
          >
            {t.emoji ? `${t.emoji} ` : ""}
            {t.name}
          </button>
        ))}
        {!creating && (
          <button type="button" className={styles.chip} onClick={() => setCreating(true)} disabled={disabled}>
            <Icon name="plus" size="s" />
            New tag
          </button>
        )}
      </div>
      {creating && (
        <div className={styles.newtag}>
          <input
            className={styles.input}
            aria-label="Emoji"
            placeholder="🌶️"
            value={def.emoji}
            onChange={(e) => setDef({ ...def, emoji: e.target.value })}
          />
          <input
            className={styles.input}
            aria-label="Tag name"
            placeholder="Name"
            autoFocus
            value={def.name}
            onChange={(e) => setDef({ ...def, name: e.target.value })}
          />
          <input
            className={`${styles.input} ${styles.full}`}
            aria-label="What the tag means"
            placeholder="What it means (optional)"
            value={def.description}
            onChange={(e) => setDef({ ...def, description: e.target.value })}
          />
          <div className={`${styles.row} ${styles.full}`}>
            <button type="button" className={styles.secondary} onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button type="button" className={styles.primary} onClick={create} disabled={!def.name.trim()}>
              Add tag
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export interface BoardChoice {
  id: string;
  name: string;
  kind: "master" | "group" | "personal";
}

const BOARD_ICONS = { personal: "lock", master: "globe", group: "users" } as const;
const BOARD_SHORT: Record<BoardChoice["kind"], string> = { personal: "Only you", master: "Everyone", group: "This group" };

const BOARD_HINTS: Record<BoardChoice["kind"], string> = {
  personal: "Only you can read it.",
  master: "Everyone on the app can read it.",
  group: "Only that group can read it.",
};

/**
 * Where an opinion goes: one or more boards, Personal unless the person picks otherwise.
 * `noPublic` greys out the Public board, for a dropped pin, which never leaves its owner's
 * boards.
 */
export function BoardPicker({
  boards,
  value,
  onChange,
  noPublic,
}: {
  boards: readonly BoardChoice[];
  value: readonly string[];
  onChange: (ids: string[]) => void;
  noPublic?: boolean;
}) {
  const picked = boards.filter((b) => value.includes(b.id));
  const toggle = (id: string) => {
    const next = value.includes(id) ? value.filter((v) => v !== id) : [...value, id];
    // Something always stays picked.
    if (next.length > 0) onChange(next);
  };
  return (
    <div className={styles.section}>
      <div className={styles.chips} role="group" aria-label="Who can read it">
        {boards.map((b) => {
          const on = value.includes(b.id);
          return (
            <button
              key={b.id}
              type="button"
              className={styles.bopt}
              aria-pressed={on}
              disabled={noPublic && b.kind === "master"}
              onClick={() => toggle(b.id)}
            >
              <Icon name={BOARD_ICONS[b.kind]} size="m" />
              <span>
                {b.name}
                <small>{BOARD_SHORT[b.kind]}</small>
              </span>
              {on && <Icon name="check" size="m" />}
            </button>
          );
        })}
      </div>
      <p className={styles.note}>
        {noPublic && boards.some((b) => b.kind === "master")
          ? "A dropped pin stays off the Public board. "
          : ""}
        {picked.map((b) => BOARD_HINTS[b.kind]).join(" ")}
      </p>
    </div>
  );
}

/** The boards an opinion can go to, Personal first. */
export function boardChoices(boards: readonly { id: string; kind: BoardChoice["kind"]; name: string }[]): BoardChoice[] {
  const order = { personal: 0, master: 1, group: 2 } as const;
  return [...boards].sort((a, b) => order[a.kind] - order[b.kind]);
}
