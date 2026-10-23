"use client";

import Link from "next/link";
import { useState } from "react";
import { useItems } from "@/app/_entries/use-items";
import styles from "@/app/_entries/entries.module.css";
import { DeviceGate, type Diary } from "@/lib/device";
import { defineTag, editTag } from "@/lib/entries/actions";
import { oneEmoji } from "@/lib/entries/emoji";
import type { TagDefPayload } from "@/lib/places/payloads";
import type { TagDefinition } from "@/lib/places/types";

/** `/tags`: create custom tags and edit their names, emoji and descriptions. */
export function TagsPage() {
  return (
    <main>
      <Link href="/" className={styles.back}>
        ← Diary
      </Link>
      <h1 className={styles.title} style={{ margin: "12px 0 16px" }}>
        Tags
      </h1>
      <DeviceGate>{(diary) => <TagList diary={diary} />}</DeviceGate>
    </main>
  );
}

function TagList({ diary }: { diary: Diary }) {
  const { loaded, snapshot } = useItems(diary);
  const [error, setError] = useState<string | null>(null);
  const run = (write: () => Promise<unknown>) => {
    setError(null);
    write().catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not save"));
  };
  if (!loaded) return <p className="muted">Opening…</p>;

  const mine = snapshot.tags.filter((t) => t.authorId === diary.device.accountId).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className={styles.page}>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {mine.length === 0 && <p className={styles.note}>No tags yet. Make one here or while adding a place.</p>}
      <ul className={styles.list}>
        {mine.map((t) => (
          <TagRow key={t.id} tag={t} onSave={(def) => run(() => editTag(diary, t.id, def))} />
        ))}
      </ul>
      <section className={styles.section}>
        <h2>New tag</h2>
        <TagForm submitLabel="Add tag" onSubmit={(def) => run(() => defineTag(diary, def))} />
      </section>
    </div>
  );
}

function TagRow({ tag, onSave }: { tag: TagDefinition; onSave: (def: TagDefPayload) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <li className={styles.item}>
        <TagForm
          initial={tag}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
          onSubmit={(def) => {
            onSave(def);
            setEditing(false);
          }}
        />
      </li>
    );
  }
  return (
    <li className={styles.item}>
      <div className={styles.row}>
        <strong className={styles.grow}>
          {tag.emoji} {tag.name}
        </strong>
        <button type="button" className={styles.textbutton} onClick={() => setEditing(true)}>
          Edit
        </button>
      </div>
      {tag.description && <p className={styles.note}>{tag.description}</p>}
    </li>
  );
}

function TagForm(props: { initial?: TagDefPayload; submitLabel: string; onSubmit: (def: TagDefPayload) => void; onCancel?: () => void }) {
  const empty = { name: "", emoji: "", description: "" };
  const [def, setDef] = useState<TagDefPayload>(props.initial ?? empty);
  return (
    <form
      className={styles.newtag}
      onSubmit={(e) => {
        e.preventDefault();
        if (!def.name.trim()) return;
        props.onSubmit(def);
        if (!props.initial) setDef(empty);
      }}
    >
      <input className={styles.input} aria-label="Emoji (optional)" placeholder="Emoji" style={{ textAlign: "center" }} value={def.emoji} onChange={(e) => setDef({ ...def, emoji: oneEmoji(e.target.value) })} />
      <input className={styles.input} aria-label="Tag name" placeholder="Name" value={def.name} onChange={(e) => setDef({ ...def, name: e.target.value })} />
      <input
        className={`${styles.input} ${styles.full}`}
        aria-label="What the tag means"
        placeholder="What it means (optional)"
        value={def.description}
        onChange={(e) => setDef({ ...def, description: e.target.value })}
      />
      <div className={`${styles.row} ${styles.full}`}>
        {props.onCancel && (
          <button type="button" className={styles.secondary} onClick={props.onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className={`${styles.primary} ${styles.grow}`} disabled={!def.name.trim()}>
          {props.submitLabel}
        </button>
      </div>
    </form>
  );
}
