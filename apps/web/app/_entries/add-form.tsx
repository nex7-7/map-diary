"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, type Diary } from "@/lib/device";
import { addOpinions, addPlace, findCataloguePlace, findDuplicate } from "@/lib/entries/actions";
import { buildFacts } from "@/lib/entries/facts";
import { parseEntry, parseLink, type ParsedEntry } from "@/lib/entries/parse-input";
import { getPendingQueue, MAX_QUERY_LENGTH, type PendingItem } from "@/lib/pending";
import type { TagDefPayload } from "@/lib/places/payloads";
import type { Category, LngLat, Status } from "@/lib/places/types";
import { BoardPicker, boardChoices, CategoryPicker, StatusToggle, TagPicker, type TagChoice } from "./fields";
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
  /** An Inbox item the resolver couldn't find, to place by hand instead. */
  pending?: PendingItem;
}

interface Props {
  diary: Diary;
  initial?: AddInitial;
  onSaved: (placeId: string) => void;
  /** Saved without a location: it waits in the Inbox for the resolver. */
  onQueued: () => void;
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
 * encrypted on the device. The status, tags and note go to the boards picked (Personal
 * unless changed); a place from a link joins the shared catalogue, a dropped pin never does.
 */
export function AddForm({ diary, initial, onSaved, onQueued, onCancel }: Props) {
  const { items, snapshot } = useItems(diary);
  const draft = initial?.pending?.draft;
  const [text, setText] = useState(initial?.text ?? draft?.link ?? draft?.label ?? "");
  const [nameEdit, setNameEdit] = useState<string | null>(draft?.link ? draft.label : null);
  const [pinned, setPinned] = useState<LngLat | null>(initial?.location ?? null);
  const [adjusting, setAdjusting] = useState(draft !== undefined);
  const [categoryEdit, setCategoryEdit] = useState<Category | null>(draft?.category ?? null);
  const [status, setStatus] = useState<Status>(draft?.status ?? "want");
  const [selected, setSelected] = useState<Set<string>>(new Set(draft?.tagIds));
  const [newTags, setNewTags] = useState<TagDefPayload[]>(draft?.newTags ?? []);
  const [comment, setComment] = useState(draft?.comment ?? "");
  const [boards, setBoards] = useState<string[]>(draft?.boards ?? [diary.device.personalBoardId]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typed = useMemo(() => parseEntry(text), [text]);
  const expansion = useExpandedLink(typed);
  // A short Maps link the Worker expanded reads like the full link, but keeps the link as shared.
  const parsed: ParsedEntry =
    expansion.kind === "done"
      ? { ...typed, location: expansion.location, source: "google-maps", shortLink: false, ...(typed.name || expansion.name ? { name: typed.name ?? expansion.name } : {}) }
      : typed;
  const location = pinned ?? parsed.location ?? null;
  // No location yet, but something the resolver can look up: save now, find it later.
  const findLater = location === null && expansion.kind !== "loading" && (parsed.link !== undefined || !!parsed.name);
  // A place is catalogue-bound only when a Google Maps link located it; anything placed by
  // hand is a dropped pin, which stays private.
  const fromLink = !pinned && parsed.location !== undefined && parsed.source === "google-maps";
  const kind = fromLink ? "place" : "private_place";
  const choices = boardChoices(snapshot.boards.filter((b) => diary.boards.some((k) => k.id === b.id)));
  const noPublic = kind === "private_place" && !findLater;
  // A dropped pin's opinions stay off the Public board, as the pin itself does.
  const opinionBoards = noPublic ? boards.filter((id) => choices.find((b) => b.id === id)?.kind !== "master") : boards;
  const pickedBoards = opinionBoards.length > 0 ? opinionBoards : [diary.device.personalBoardId];
  // A typed name is already the name; links and coordinates get a name field to fill or fix.
  const hasLinkOrCoords = parsed.link !== undefined || (parsed.location !== undefined && !parsed.name) || (pinned !== null && !parsed.name);
  const name = nameEdit ?? parsed.name ?? "";
  const category = categoryEdit ?? guessCategory(parsed);
  const duplicate = useMemo(() => (parsed.link ? findDuplicate(items, parsed.link) : undefined), [items, parsed.link]);
  const showPicker = adjusting || (location === null && !findLater && expansion.kind !== "loading");

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

  const queue = async () => {
    const label = (nameEdit ?? parsed.name ?? "").trim() || parsed.link || "";
    // The resolver sees only this: the link as shared, or the name. Never a location.
    const query = parsed.link ? (nameEdit?.trim() ? `${nameEdit.trim()} ${parsed.link}` : parsed.link) : label;
    if (query.length > MAX_QUERY_LENGTH) {
      setError("That's too long to look up. Paste just the link or the name.");
      return;
    }
    setSaving(true);
    try {
      const q = await getPendingQueue(diary);
      await q.add(query, {
        label,
        ...(parsed.link ? { link: parsed.link } : {}),
        ...(categoryEdit ? { category: categoryEdit } : {}),
        status,
        tagIds: [...selected],
        newTags,
        comment,
        boards: pickedBoards,
      });
      onQueued();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the place");
      setSaving(false);
    }
  };

  const save = async () => {
    setError(null);
    if (findLater) return queue();
    const result = buildFacts({
      name: name || (location && !parsed.link ? "Dropped pin" : ""),
      category,
      location,
      address: "",
      cuisine: "",
      dishName: "",
      dishPrice: "",
      sourceLinks: [parsed.link, expansion.kind === "done" ? expansion.url : undefined].filter((l): l is string => !!l),
    });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSaving(true);
    try {
      const opinions = { status, tagIds: [...selected], newTags, comment, boards: pickedBoards };
      // Someone may have put it in the catalogue already: add to theirs rather than a copy.
      const existing = kind === "place" ? await findCataloguePlace(diary, result.facts.sourceLinks) : undefined;
      let id: string;
      if (existing) {
        await addOpinions(diary, existing, opinions);
        id = existing;
      } else {
        id = await addPlace(diary, { kind, facts: result.facts, ...opinions });
      }
      if (initial?.pending) await (await getPendingQueue(diary)).dismiss(initial.pending.id);
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
        <InputSummary parsed={parsed} pinned={pinned} expansion={expansion.kind} findLater={findLater && !adjusting} />
        {duplicate && (
          <p className={styles.found}>
            Already on the map. Saving adds your notes to it.{" "}
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
          {findLater && !showPicker && (
            <button type="button" className={styles.textbutton} onClick={() => setAdjusting(true)}>
              Drop a pin instead
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
        ) : findLater ? (
          <p className={styles.note}>⏳ It goes in the Inbox until it&apos;s found. Only the {parsed.link ? (nameEdit?.trim() ? "name and link" : "link") : "name"} is sent to look it up.</p>
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
        <BoardPicker boards={choices} value={pickedBoards} onChange={setBoards} noPublic={noPublic} />
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
          <button type="submit" className={`${styles.primary} ${styles.grow}`} disabled={saving || (!location && !findLater)}>
            {saving ? "Saving…" : location ? "Save" : findLater ? "Save and find it" : expansion.kind === "loading" ? "Opening the link…" : "Drop a pin to save"}
          </button>
        </div>
      </div>
    </form>
  );
}

interface SummaryProps {
  parsed: ParsedEntry;
  pinned: LngLat | null;
  expansion: Expansion["kind"];
  findLater: boolean;
}

function InputSummary({ parsed, pinned, expansion, findLater }: SummaryProps) {
  if (expansion === "loading") return <p className={styles.note}>Opening the short link…</p>;
  if (parsed.source === "google-maps" && parsed.location) return <p className={styles.note}>Found the place on the link.</p>;
  if (pinned || !findLater) return null;
  if (parsed.shortLink) return <p className={styles.note}>Couldn&apos;t open the short link here, so it will be looked up.</p>;
  if (parsed.source === "zomato" || parsed.source === "district") {
    return <p className={styles.note}>Saved as a source link. The place and its signature dish get looked up.</p>;
  }
  return null;
}

type Expansion = { kind: "none" } | { kind: "loading" } | { kind: "failed" } | { kind: "done"; url: string; location: LngLat; name?: string };

/**
 * Short Google Maps links carry the place only in their redirect, which a web page can't
 * follow, so the Worker expands them. Only the link is sent; the coordinates are read here.
 */
function useExpandedLink(parsed: ParsedEntry): Expansion {
  const link = parsed.shortLink ? parsed.link : undefined;
  const [result, setResult] = useState<{ link: string; expansion: Expansion } | null>(null);
  useEffect(() => {
    if (!link) return;
    let live = true;
    api.expandMapsLink(link).then(
      ({ url }) => {
        const full = parseLink(url);
        const expansion: Expansion = full.location
          ? { kind: "done", url, location: full.location, ...(full.name ? { name: full.name } : {}) }
          : { kind: "failed" };
        if (live) setResult({ link, expansion });
      },
      () => {
        if (live) setResult({ link, expansion: { kind: "failed" } });
      },
    );
    return () => {
      live = false;
    };
  }, [link]);
  if (!link) return { kind: "none" };
  return result?.link === link ? result.expansion : { kind: "loading" };
}

