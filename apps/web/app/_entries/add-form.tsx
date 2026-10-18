"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { Diary } from "@/lib/device";
import { addPlace, findDuplicate } from "@/lib/entries/actions";
import { buildFacts } from "@/lib/entries/facts";
import { parseEntry, type ParsedEntry } from "@/lib/entries/parse-input";
import type { TagDefPayload } from "@/lib/places/payloads";
import type { Category, LngLat, Status } from "@/lib/places/types";
import { BoardNote, CategoryPicker, StatusToggle, TagPicker, type TagChoice } from "./fields";
import { useItems } from "./use-items";
import styles from "./entries.module.css";

// MapLibre needs the browser; never render it on the server.
const PinPicker = dynamic(() => import("./pin-picker").then((m) => m.PinPicker), {
  ssr: false,
  loading: () => <div className={styles.picker} />,
});

export interface AddInitial {
  /** Shared or pasted text: a name, a link, or share text with a link in it. */
  text?: string;
  /** A pin dropped on the main map. */
  location?: LngLat;
}

interface Props {
  diary: Diary;
  initial?: AddInitial;
  onSaved: (placeId: string) => void;
  onCancel?: () => void;
}

const NEW = "new:";

function guessCategory(parsed: ParsedEntry): Category {
  if (parsed.source === "district") return "movies";
  return "restaurant";
}

/**
 * The Add sheet: paste a link or type a name, set category, status, tags and a note, and
 * save. Only the save tap is required once the place has a location. Everything is
 * encrypted on the device and goes to the Personal board.
 */
export function AddForm({ diary, initial, onSaved, onCancel }: Props) {
  const { items, snapshot } = useItems(diary);
  const [text, setText] = useState(initial?.text ?? "");
  const [nameEdit, setNameEdit] = useState<string | null>(null);
  const [pinned, setPinned] = useState<LngLat | null>(initial?.location ?? null);
  const [adjusting, setAdjusting] = useState(false);
  const [categoryEdit, setCategoryEdit] = useState<Category | null>(null);
  const [status, setStatus] = useState<Status>("want");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newTags, setNewTags] = useState<TagDefPayload[]>([]);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseEntry(text), [text]);
  const location = pinned ?? parsed.location ?? null;
  // A place is catalogue-bound only when a Google Maps link located it; anything placed by
  // hand is a dropped pin, which stays private.
  const fromLink = !pinned && parsed.location !== undefined && parsed.source === "google-maps";
  const kind = fromLink ? "place" : "private_place";
  // A typed name is already the name; links and coordinates get a name field to fill or fix.
  const hasLinkOrCoords = parsed.link !== undefined || (parsed.location !== undefined && !parsed.name) || (pinned !== null && !parsed.name);
  const name = nameEdit ?? parsed.name ?? "";
  const category = categoryEdit ?? guessCategory(parsed);
  const duplicate = useMemo(() => (parsed.link ? findDuplicate(items, parsed.link) : undefined), [items, parsed.link]);
  const showPicker = adjusting || location === null;

  const tagChoices: TagChoice[] = [
    ...snapshot.tags.map((t) => ({ id: t.id, name: t.name, emoji: t.emoji, description: t.description })),
    ...newTags.map((t, i) => ({ ...t, id: `${NEW}${i}` })),
  ];
  const selectedAll = new Set([...selected, ...newTags.map((_, i) => `${NEW}${i}`)]);

  const toggleTag = (id: string) => {
    if (id.startsWith(NEW)) {
      const i = Number(id.slice(NEW.length));
      setNewTags(newTags.filter((_, j) => j !== i));
      return;
    }
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const save = async () => {
    setError(null);
    const result = buildFacts({
      name: name || (location && !parsed.link ? "Dropped pin" : ""),
      category,
      location,
      address: "",
      cuisine: "",
      dishName: "",
      dishPrice: "",
      sourceLinks: parsed.link ? [parsed.link] : [],
    });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSaving(true);
    try {
      const id = await addPlace(diary, { kind, facts: result.facts, status, tagIds: [...selected], newTags, comment });
      onSaved(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the place");
      setSaving(false);
    }
  };

  return (
    <form
      className={styles.page}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className={styles.section}>
        <label className={styles.label} htmlFor="add-input">
          Name, link or pin
        </label>
        <textarea
          id="add-input"
          className={styles.textarea}
          style={{ minHeight: "3em" }}
          rows={text.includes("\n") ? 3 : 1}
          autoFocus={!initial?.text && !initial?.location}
          placeholder="Bastian Worli, or paste a Google Maps link"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void save();
            }
          }}
        />
        <InputSummary parsed={parsed} pinned={pinned} />
        {duplicate && (
          <p className={styles.found}>
            Already in your diary.{" "}
            <Link href={`/place#${duplicate.id}`} className={styles.textbutton}>
              Open it
            </Link>
          </p>
        )}
      </div>

      {hasLinkOrCoords && (
        <div className={styles.section}>
          <label className={styles.label} htmlFor="add-name">
            Name
          </label>
          <input
            id="add-name"
            className={styles.input}
            placeholder={location && !parsed.link ? "Dropped pin" : "What is it called?"}
            value={name}
            onChange={(e) => setNameEdit(e.target.value)}
          />
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.row}>
          <span className={styles.label}>On the map</span>
          {location && !showPicker && (
            <button type="button" className={styles.textbutton} onClick={() => setAdjusting(true)}>
              Adjust pin
            </button>
          )}
        </div>
        {showPicker ? (
          <>
            <PinPicker
              value={location}
              onChange={(l) => {
                setPinned(l);
                setAdjusting(true);
              }}
            />
            <p className={styles.note}>
              {location ? "Pin dropped. A pin you place stays private." : "Move the map until the pin sits on the place."}
            </p>
          </>
        ) : (
          location && (
            <p className={styles.note}>
              📍 {location.lat.toFixed(5)}, {location.lng.toFixed(5)} {fromLink ? "from the link" : "· dropped pin, stays private"}
            </p>
          )
        )}
      </div>

      <div className={styles.section}>
        <span className={styles.label}>Category</span>
        <CategoryPicker value={category} onChange={setCategoryEdit} />
      </div>

      <div className={styles.section}>
        <span className={styles.label}>Status</span>
        <StatusToggle value={status} onChange={setStatus} />
      </div>

      <div className={styles.section}>
        <span className={styles.label}>Tags</span>
        <TagPicker
          tags={tagChoices}
          selected={selectedAll}
          onToggle={toggleTag}
          onCreate={(def) => setNewTags([...newTags, def])}
        />
      </div>

      <div className={styles.section}>
        <label className={styles.label} htmlFor="add-comment">
          Note
        </label>
        <textarea
          id="add-comment"
          className={styles.textarea}
          placeholder="Why it's on the list (optional)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>

      <div className={styles.savebar}>
        <BoardNote />
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.row}>
          {onCancel && (
            <button type="button" className={styles.secondary} onClick={onCancel}>
              Cancel
            </button>
          )}
          <button type="submit" className={`${styles.primary} ${styles.grow}`} disabled={saving || !location}>
            {saving ? "Saving…" : location ? "Save" : "Drop a pin to save"}
          </button>
        </div>
      </div>
    </form>
  );
}

function InputSummary({ parsed, pinned }: { parsed: ParsedEntry; pinned: LngLat | null }) {
  if (parsed.shortLink && !pinned) {
    return (
      <p className={styles.note}>
        Short Google Maps links can&apos;t be opened from a web page. Drop the pin below, or paste the full link from the
        address bar of Google Maps in a browser.
      </p>
    );
  }
  if (parsed.source === "google-maps" && parsed.location) return <p className={styles.note}>Found the place on the link.</p>;
  if ((parsed.source === "zomato" || parsed.source === "district") && !pinned) {
    return <p className={styles.note}>Saved as a source link. Check the name, then drop the pin below.</p>;
  }
  if (parsed.name && !parsed.link && !parsed.location && !pinned) {
    return <p className={styles.note}>Drop the pin below to put it on the map.</p>;
  }
  return null;
}
