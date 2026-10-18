"use client";

import { useState } from "react";
import { customCategory } from "@/lib/entries/facts";
import { CATEGORY_STYLES, categoryStyle, STATUS_LABELS } from "@/lib/places/categories";
import type { TagDefPayload } from "@/lib/places/payloads";
import { BUILTIN_CATEGORIES, type Category, type Status } from "@/lib/places/types";
import styles from "./entries.module.css";

export function StatusToggle({ value, onChange, disabled }: { value: Status | null; onChange: (s: Status) => void; disabled?: boolean }) {
  return (
    <div className={styles.segmented} role="group" aria-label="Status">
      {(["want", "visited"] as const).map((s) => (
        <button key={s} type="button" aria-pressed={value === s} onClick={() => onChange(s)} disabled={disabled}>
          <span className={`${styles.dot} ${s === "visited" ? styles.dotvisited : styles.dotwant}`} aria-hidden />
          {STATUS_LABELS[s]}
        </button>
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
            + Other
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
            + New tag
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

/** Where an opinion goes. Only the Personal board exists until sharing lands. */
export function BoardNote() {
  return (
    <p className={styles.note}>
      <span className={styles.badge}>Personal</span> Only you can read this. Sharing with your groups comes later.
    </p>
  );
}
