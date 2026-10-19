"use client";

import styles from "@/app/_entries/entries.module.css";
import type { Board } from "@/lib/places/types";

const AUDIENCE: Record<Board["kind"], string> = {
  personal: "only you",
  group: "this group",
  master: "everyone on the app",
};

/**
 * Where the owner's new tags and comments on this place go. `options` are only the boards
 * allowed for this place (`opinionBoards`), so nothing can be posted wider than its audience.
 */
export function OpinionBoards({ options, value, onChange }: { options: readonly Board[]; value: readonly string[]; onChange: (next: string[]) => void }) {
  if (options.length <= 1) return null;
  const toggle = (id: string) => {
    const next = value.includes(id) ? value.filter((b) => b !== id) : [...value, id];
    // An opinion always goes somewhere.
    if (next.length > 0) onChange(next);
  };
  return (
    <div className={styles.section}>
      <span className={styles.note}>New tags and comments go to</span>
      <div className={styles.chips} role="group" aria-label="Boards for new tags and comments">
        {options.map((b) => (
          <button key={b.id} type="button" className={styles.chip} aria-pressed={value.includes(b.id)} title={`Seen by ${AUDIENCE[b.kind]}`} onClick={() => toggle(b.id)}>
            {b.name}
          </button>
        ))}
      </div>
    </div>
  );
}
