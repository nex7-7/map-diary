"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, type Diary } from "@/lib/device";
import { addOpinions, addPlace, findCataloguePlace, findLocalPlace } from "@/lib/entries/actions";
import { buildFacts } from "@/lib/entries/facts";
import { categoryStyle, STATUS_LABELS } from "@/lib/places/categories";
import { branchOf, knownByName, nearestArea, outletAreas, statusOf } from "@/lib/places/chains";
import { userMessage } from "@/lib/errors";
import { parseEntry, parseLink, type LinkSource, type ParsedEntry } from "@/lib/entries/parse-input";
import { getPendingQueue, MAX_QUERY_LENGTH, type PendingItem } from "@/lib/pending";
import { readPayload, type TagDefPayload } from "@/lib/places/payloads";
import type { Category, LngLat, Status } from "@/lib/places/types";
import { BoardPicker, boardChoices, CategoryPicker, FollowBoards, StatusToggle, TagPicker, type TagChoice } from "./fields";
import { Icon, Slip } from "@/lib/ui";
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
  onSaved: (placeId: string, saved: { name: string; status: Status }) => void;
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
  // Null while the tags or the note follow the status's boards.
  const [tagBoardsEdit, setTagBoards] = useState<string[] | null>(draft?.tagBoards ?? null);
  const [noteBoardsEdit, setNoteBoards] = useState<string[] | null>(draft?.commentBoards ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typed = useMemo(() => parseEntry(text), [text]);
  const expansion = useExpandedLink(typed);
  // A short Maps link the Worker expanded reads like the full link, but keeps the link as shared.
  const parsed: ParsedEntry =
    expansion.kind === "done"
      ? { ...typed, location: expansion.location, source: "google-maps", shortLink: false, ...(typed.name || expansion.name ? { name: typed.name ?? expansion.name } : {}) }
      : expansion.kind === "partial" && !typed.name && expansion.name
        ? { ...typed, name: expansion.name }
        : typed;
  const expandedUrl = expansion.kind === "done" || expansion.kind === "partial" ? expansion.url : undefined;
  // The link may be for a place already in the diary: the same link, or another link to the same
  // Google place (a friend's own share link). Then it needs no lookup, wherever the pin came from.
  const duplicate = useMemo(() => findLocalPlace(items, [parsed.link, expandedUrl]), [items, parsed.link, expandedUrl]);
  const duplicateFacts = duplicate && (duplicate.type === "place" || duplicate.type === "private_place") ? readPayload(duplicate.type, duplicate.payload) : undefined;
  // Saved onto the place already there, with no pin of its own and nothing to look up, even when
  // the link carries a pin: it is that place's pin.
  const onto = !pinned && duplicate && duplicateFacts ? { id: duplicate.id, name: duplicateFacts.name, isPrivate: duplicate.type === "private_place" } : undefined;
  const location = pinned ?? parsed.location ?? null;
  // No location yet, but something the resolver can look up: save now, find it later.
  const findLater = location === null && !onto && expansion.kind !== "loading" && (parsed.link !== undefined || !!parsed.name);
  // A place is catalogue-bound only when a Google Maps link located it; anything placed by
  // hand is a dropped pin, which stays private.
  const fromLink = !pinned && parsed.location !== undefined && parsed.source === "google-maps";
  const kind = fromLink ? "place" : "private_place";
  const choices = boardChoices(snapshot.boards.filter((b) => diary.boards.some((k) => k.id === b.id)));
  const noPublic = onto ? onto.isPrivate : kind === "private_place" && !findLater;
  // A dropped pin's opinions stay off the Public board, as the pin itself does.
  const usable = (ids: readonly string[]) => {
    const kept = noPublic ? ids.filter((id) => choices.find((b) => b.id === id)?.kind !== "master") : [...ids];
    return kept.length > 0 ? kept : [diary.device.personalBoardId];
  };
  const pickedBoards = usable(boards);
  const tagBoards = tagBoardsEdit ? usable(tagBoardsEdit) : undefined;
  const noteBoards = noteBoardsEdit ? usable(noteBoardsEdit) : undefined;
  const ownBoards = { ...(tagBoards ? { tagBoards } : {}), ...(noteBoards ? { commentBoards: noteBoards } : {}) };
  // A typed name is already the name; links and coordinates get a name field to fill or fix.
  const hasLinkOrCoords = parsed.link !== undefined || (parsed.location !== undefined && !parsed.name) || (pinned !== null && !parsed.name);
  const name = nameEdit ?? parsed.name ?? "";
  // The same name elsewhere on the map is probably another branch; here, the same place.
  const match = useMemo(
    () => (kind === "place" && location && name.trim() && !duplicate ? branchOf(items, { name, location }) : undefined),
    [items, kind, location, name, duplicate],
  );
  // A name sent to be looked up may be a place already in the diary, maybe already on the list.
  const known = useMemo(
    () =>
      findLater && !duplicate && name.trim()
        ? (knownByName(items, name, diary.device.accountId) ?? (name.includes(",") ? knownByName(items, name.split(",")[0]!, diary.device.accountId) : undefined))
        : undefined,
    [items, findLater, duplicate, name, diary.device.accountId],
  );
  const [joinBranch, setJoinBranch] = useState(true);
  // A new branch takes the chain's category, cuisine and wallet bleeder, as the resolver's outlets do.
  const branchFacts = useMemo(() => {
    if (match?.kind !== "branch" || !joinBranch) return undefined;
    const item = items.find((i) => i.id === match.placeId);
    return item ? readPayload("place", item.payload) : undefined;
  }, [items, match, joinBranch]);
  const branchAreas = useMemo(() => (match?.kind === "branch" ? (outletAreas(items, match.placeId) ?? match.area) : undefined), [items, match]);
  const category = categoryEdit ?? branchFacts?.category ?? guessCategory(parsed);
  const duplicateStatus = duplicate ? statusOf(items, duplicate.id, diary.device.accountId) : undefined;
  const near = useMemo(() => (location ? nearestArea(items, location) : undefined), [items, location]);
  const showPicker = adjusting || (location === null && !findLater && !onto && expansion.kind !== "loading");

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
        ...(expansion.kind === "partial" ? { expandedUrl: expansion.url } : {}),
        ...(categoryEdit ? { category: categoryEdit } : {}),
        status,
        tagIds: [...selected],
        newTags,
        comment,
        boards: pickedBoards,
        ...ownBoards,
      });
      onQueued();
    } catch (err) {
      setError(userMessage(err));
      setSaving(false);
    }
  };

  /** Puts the status, tags and note on a place already in the diary, with no lookup. */
  const saveOnto = async (placeId: string, placeName: string, isPrivate: boolean) => {
    setError(null);
    setSaving(true);
    try {
      const addedAt = initial?.pending && status === "visited" ? { visitedAt: initial.pending.createdAt } : {};
      // Notes on a dropped pin stay off the Public board, as the pin does.
      const keep = (ids: readonly string[]) => (isPrivate ? usableOff(ids) : [...ids]);
      await addOpinions(diary, placeId, {
        status,
        ...addedAt,
        tagIds: [...selected],
        newTags,
        comment,
        boards: keep(pickedBoards),
        ...(tagBoards ? { tagBoards: keep(tagBoards) } : {}),
        ...(noteBoards ? { commentBoards: keep(noteBoards) } : {}),
      });
      if (initial?.pending) await (await getPendingQueue(diary)).dismiss(initial.pending.id);
      onSaved(placeId, { name: placeName, status });
    } catch (err) {
      setError(userMessage(err));
      setSaving(false);
    }
  };
  const usableOff = (ids: readonly string[]) => {
    const kept = ids.filter((id) => choices.find((b) => b.id === id)?.kind !== "master");
    return kept.length > 0 ? kept : [diary.device.personalBoardId];
  };

  const save = async () => {
    setError(null);
    if (onto) return saveOnto(onto.id, onto.name, onto.isPrivate);
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
      // An Inbox item placed by hand keeps the day it was added as its Visited day.
      const addedAt = initial?.pending && status === "visited" ? { visitedAt: initial.pending.createdAt } : {};
      const opinions = { status, ...addedAt, tagIds: [...selected], newTags, comment, boards: pickedBoards, ...ownBoards };
      // Someone may have put it in the catalogue already: add to theirs rather than a copy.
      const existing =
        kind === "place" ? ((await findCataloguePlace(diary, result.facts.sourceLinks)) ?? (match?.kind === "same" ? match.placeId : undefined)) : undefined;
      if (match?.kind === "branch" && joinBranch) {
        result.facts.chain = { ...match.chain };
        if (branchFacts?.cuisine && !result.facts.cuisine) result.facts.cuisine = branchFacts.cuisine;
        if (branchFacts?.signatureDish && !result.facts.signatureDish && categoryEdit === null) result.facts.signatureDish = { ...branchFacts.signatureDish };
      }
      let id: string;
      if (existing) {
        await addOpinions(diary, existing, opinions);
        id = existing;
      } else {
        id = await addPlace(diary, { kind, facts: result.facts, ...opinions });
      }
      if (initial?.pending) await (await getPendingQueue(diary)).dismiss(initial.pending.id);
      onSaved(id, { name: result.facts.name, status });
    } catch (err) {
      setError(userMessage(err));
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
        {parsed.link ? <span className={styles.label}>Name, link or pin</span> : (
          <label className={styles.label} htmlFor="add-input">
            Name, link or pin
          </label>
        )}
        {parsed.link ? (
          <div className={styles.linkchip}>
            <span className={styles.linkicon} aria-hidden="true">
              <Icon name="link" size="m" />
            </span>
            <span className={styles.linktext}>
              <b>{parsed.name ?? `${SOURCE_NAMES[parsed.source ?? "other"]} link`}</b>
              <span>
                {parsed.name ? `${SOURCE_NAMES[parsed.source ?? "other"]} · ` : ""}
                {shortUrl(parsed.link)}
              </span>
            </span>
            <button
              type="button"
              className={styles.linkclear}
              aria-label="Clear the link"
              onClick={() => {
                setText("");
                setNameEdit(null);
                setTimeout(() => document.getElementById("add-input")?.focus(), 0);
              }}
            >
              <Icon name="x" size="s" />
            </button>
          </div>
        ) : (
          <>
            <textarea
              id="add-input"
              className={styles.headline}
              rows={text.includes("\n") ? 3 : 1}
              autoFocus={!initial?.text && !initial?.location}
              placeholder="A name or a link"
              aria-describedby="add-input-help"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void save();
                }
              }}
            />
            {!text.trim() && (
              <p id="add-input-help" className={styles.note}>
                Like Bastian Worli, or paste a Google Maps, Zomato or District link.
              </p>
            )}
          </>
        )}
        <InputSummary parsed={parsed} pinned={pinned} expansion={expansion.kind} findLater={findLater && !adjusting} />
        {duplicate && (
          <Slip kicker="Already in your diary">
            <p className={styles.slipline}>
              <b>{duplicateFacts?.name ?? "This place"}</b>
              {duplicateStatus ? ` · ${STATUS_LABELS[duplicateStatus]}` : ""}. Saving adds your notes to it. Nothing is looked up.
            </p>
            <div className={styles.slipactions}>
              <Link href={`/place#${duplicate.id}`} className={styles.textbutton}>
                Open it instead
              </Link>
            </div>
          </Slip>
        )}
        {match?.kind === "same" && (
          <Slip kicker="Already in your diary">
            <p className={styles.slipline}>
              <b>{match.name}</b> is already on the map here. Saving adds your notes to it.
            </p>
            <div className={styles.slipactions}>
              <Link href={`/place#${match.placeId}`} className={styles.textbutton}>
                Open it instead
              </Link>
            </div>
          </Slip>
        )}
        {known && (
          <Slip kicker="Already in your diary">
            <p className={styles.slipline}>
              <b>{known.name}</b>
              {known.status ? ` · ${STATUS_LABELS[known.status]}` : " is on the map"}. Is it this one? If the lookup finds it, your notes go onto it anyway.
            </p>
            <div className={styles.slipactions}>
              <button
                type="button"
                className={styles.textbutton}
                disabled={saving}
                onClick={() => void saveOnto(known.placeId, known.name, items.find((i) => i.id === known.placeId)?.type === "private_place")}
              >
                Yes, add my notes
              </button>
              <Link href={`/place#${known.placeId}`} className={styles.textbutton}>
                Open it
              </Link>
            </div>
          </Slip>
        )}
        {match?.kind === "branch" && (
          <Slip kicker="Another branch?">
            <p className={styles.slipline}>
              <b>{match.chain.name}</b> is already on the map{branchAreas ? ` in ${branchAreas}` : ""}.
            </p>
            <label className={styles.tickline}>
              <input type="checkbox" checked={joinBranch} onChange={(e) => setJoinBranch(e.target.checked)} /> Show them as one place
            </label>
          </Slip>
        )}
      </div>

      {hasLinkOrCoords && !onto && (
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
          {location && !showPicker && !onto && (
            <button type="button" className={styles.textbutton} onClick={() => setAdjusting(true)}>
              Adjust pin
            </button>
          )}
          {findLater && !showPicker && (
            <button type="button" className={styles.textbutton} onClick={() => setAdjusting(true)}>
              Drop a pin
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
        ) : onto ? (
          <p className={styles.note}>On the map already, at {onto.name}&apos;s pin. Its name and category come from the diary.</p>
        ) : findLater ? (
          <p className={styles.note}>It waits in your Inbox until it&apos;s found. Only the {parsed.link ? (nameEdit?.trim() ? "name and link" : "link") : "name"} is sent to look it up.</p>
        ) : (
          location && (
            <>
              <PinPicker value={location} onChange={() => undefined} still />
              <p className={styles.note}>
                {fromLink ? "Pin from the link" : "Dropped pin, stays private"}
                {near ? ` · near ${near}` : ""}
              </p>
            </>
          )
        )}
      </div>

      <div className={styles.section}>
        <span className={styles.label}>Status</span>
        <StatusToggle value={status} onChange={setStatus} />
      </div>

      <div className={styles.section}>
        <span className={styles.label}>Who sees this</span>
        <BoardPicker boards={choices} value={pickedBoards} onChange={setBoards} noPublic={noPublic} />
      </div>

      {onto ? null : branchFacts && categoryEdit === null ? (
        <div className={styles.section}>
          <span className={styles.label}>Category</span>
          <p className={styles.note}>
            Category, cuisine and wallet bleeder come from {match?.kind === "branch" ? match.chain.name : branchFacts.name} (
            {[categoryStyle(branchFacts.category).label, branchFacts.signatureDish ? `${branchFacts.signatureDish.name} ₹${branchFacts.signatureDish.priceInr}` : ""]
              .filter(Boolean)
              .join(" · ")}
            ).{" "}
            <button type="button" className={styles.textbutton} onClick={() => setCategoryEdit(branchFacts.category)}>
              Change
            </button>
          </p>
        </div>
      ) : (
        <div className={styles.section}>
          <span className={styles.label}>Category</span>
          <CategoryPicker value={category} onChange={setCategoryEdit} />
        </div>
      )}

      <div className={styles.section}>
        <span className={styles.label}>Tags</span>
        <TagPicker
          tags={tagChoices}
          selected={selectedAll}
          onToggle={toggleTag}
          onCreate={(def) => setNewTags([...newTags, def])}
        />
        {selectedAll.size > 0 && <FollowBoards what="Tags" boards={choices} statusBoards={pickedBoards} value={tagBoards ?? null} onChange={setTagBoards} noPublic={noPublic} />}
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
        {comment.trim() && <FollowBoards what="Note" boards={choices} statusBoards={pickedBoards} value={noteBoards ?? null} onChange={setNoteBoards} noPublic={noPublic} />}
      </div>

      <div className={styles.savebar}>
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
          <button type="submit" className={`${styles.primary} ${styles.grow}`} disabled={saving || (!location && !findLater && !onto)}>
            {saving ? "Saving…" : onto ? "Add my notes to it" : location ? "Save it" : findLater ? "Save and find it" : expansion.kind === "loading" ? "Opening the link…" : "Drop a pin to save"}
            {!saving && (location || findLater || onto) && <Icon name="check" size="m" />}
          </button>
        </div>
      </div>
    </form>
  );
}

const SOURCE_NAMES: Record<LinkSource, string> = { "google-maps": "Google Maps", zomato: "Zomato", district: "District", other: "Web" };

/** A link without its scheme and www, for a one-line label. */
function shortUrl(link: string): string {
  return link.replace(/^[a-z]+:\/\//i, "").replace(/^www\./, "");
}

interface SummaryProps {
  parsed: ParsedEntry;
  pinned: LngLat | null;
  expansion: Expansion["kind"];
  findLater: boolean;
}

function InputSummary({ parsed, pinned, expansion, findLater }: SummaryProps) {
  if (expansion === "loading") return <p className={styles.note}>Opening the short link…</p>;
  if (pinned || !findLater) return null;
  if (expansion === "partial") return <p className={styles.note}>The link doesn&apos;t carry a pin, so it will be looked up.</p>;
  if (parsed.shortLink) return <p className={styles.note}>Couldn&apos;t open the short link here, so it will be looked up.</p>;
  if (parsed.source === "zomato" || parsed.source === "district") {
    return <p className={styles.note}>Saved as a source link. The place and its signature dish get looked up.</p>;
  }
  return null;
}

export type Expansion =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "failed" }
  /** Expanded, but the full link has no pin (Google's share links often don't): kept to match the place by. */
  | { kind: "partial"; url: string; name?: string }
  | { kind: "done"; url: string; location: LngLat; name?: string };

/**
 * Short Google Maps links carry the place only in their redirect, which a web page can't
 * follow, so the Worker expands them. Only the link is sent; the coordinates are read here.
 */
export function useExpandedLink(parsed: ParsedEntry): Expansion {
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
          : { kind: "partial", url, ...(full.name ? { name: full.name } : {}) };
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

