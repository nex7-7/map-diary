"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FactsEditor } from "@/app/_entries/facts-editor";
import { BoardPicker, boardChoices, StatusToggle, TagPicker } from "@/app/_entries/fields";
import { useItems } from "@/app/_entries/use-items";
import styles from "@/app/_entries/entries.module.css";
import type { Diary } from "@/lib/device";
import {
  addComment,
  applyTag,
  defineTag,
  deletePlace,
  editComment,
  EntryError,
  removeOpinion,
  setStatus,
  unapplyTag,
  updateFacts,
} from "@/lib/entries/actions";
import { boardName, opinionBoards, tagFit } from "@/lib/places/boards";
import { categoryStyle } from "@/lib/places/categories";
import { readPayload } from "@/lib/places/payloads";
import type { CommentOpinion, DiarySnapshot, Opinion, Status, StatusOpinion, TagOpinion } from "@/lib/places/types";

/**
 * One place: its facts, every opinion this device can read with author and board, and the
 * owner's own status, tags and comments.
 */
export function PlaceView({ diary, placeId }: { diary: Diary; placeId: string }) {
  const router = useRouter();
  const { loaded, items, snapshot } = useItems(diary);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [boardEdit, setBoardEdit] = useState<string[] | null>(null);

  const me = diary.device.accountId;
  const place = snapshot.places.find((p) => p.id === placeId);
  const item = items.find((i) => i.id === placeId);

  if (!loaded) return <p className="muted">Opening…</p>;
  if (!place || !item || (item.type !== "place" && item.type !== "private_place")) {
    return (
      <div className={styles.page}>
        <p>This place isn&apos;t on this device. It may have been deleted, or not synced yet.</p>
        <Link href="/" className={styles.secondary}>
          Back to the diary
        </Link>
      </div>
    );
  }
  const facts = readPayload(item.type, item.payload);
  if (!facts) return <p className="muted">This place could not be read.</p>;

  /** Runs a write and shows a refusal instead of throwing. */
  const run = (write: () => Promise<unknown>) => {
    setError(null);
    setNotice(null);
    write().catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not save"));
  };

  const style = categoryStyle(place.category);
  const isAuthor = item.authorId === me;
  // A catalogue place's facts are the admin's to change once written; a dropped pin is its owner's.
  const canEdit = isAuthor && (item.type === "private_place" || diary.device.isAdmin === true);
  const of = <K extends Opinion["kind"]>(kind: K) => place.opinions.filter((o): o is Extract<Opinion, { kind: K }> => o.kind === kind);
  const myStatusOpinion = of("status").find((o) => o.authorId === me);
  const myStatus = myStatusOpinion?.status ?? null;
  // Only boards the person is in whose readers can all see this place (a dropped pin never goes Public).
  const choices = boardChoices(opinionBoards(snapshot, place).filter((b) => diary.boards.some((k) => k.id === b.id)));
  // New opinions here go where the person's status is, unless they pick otherwise.
  const picked = (boardEdit ?? myStatusOpinion?.boards ?? [diary.device.personalBoardId]).filter((id) => choices.some((b) => b.id === id));
  const onBoards = picked.filter((id) => !place.isPrivate || choices.find((b) => b.id === id)?.kind !== "master");
  const boards = onBoards.length > 0 ? onBoards : [diary.device.personalBoardId];

  /** Applies a tag where its definition is visible, offering to widen the person's own definition. */
  const tag = async (tagId: string) => {
    const def = snapshot.tags.find((t) => t.id === tagId);
    if (!def) return applyTag(diary, place.id, tagId, boards);
    const fit = tagFit(def, boards, snapshot);
    const visibleOn = (id: string) => fit.fits.includes(id);
    if (fit.outside.length === 0) return applyTag(diary, place.id, tagId, boards, visibleOn);
    const where = fit.outside.map((id) => boardName(snapshot, id)).join(", ");
    // Applying one's own tag to the wider boards widens its definition to match.
    if (fit.canWiden && confirm(`“${def.name}” isn't visible on ${where}. Show the tag on ${where} too?`)) {
      return applyTag(diary, place.id, tagId, boards, visibleOn);
    }
    if (fit.fits.length === 0) throw new EntryError(`“${def.name}” isn't visible on ${where}, so it can't be applied there.`);
    await applyTag(diary, place.id, tagId, fit.fits, visibleOn);
    setNotice(`Tagged on ${fit.fits.map((id) => boardName(snapshot, id)).join(", ")} only: “${def.name}” isn't visible on ${where}.`);
  };
  const myTagIds = new Set(of("tag").filter((o) => o.authorId === me).map((o) => o.tagId));
  const othersTags = of("tag").filter((o) => o.authorId !== me);
  const comments = of("comment").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${place.location.lat},${place.location.lng}`;

  if (editing) {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>Edit details</h1>
        <FactsEditor
          facts={facts}
          onCancel={() => setEditing(false)}
          onSave={async (next) => {
            await updateFacts(diary, item, next);
            setEditing(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>
          <span aria-hidden>{style.emoji}</span> {place.name}
        </h1>
        <p className={`${styles.meta} muted`}>
          {style.label}
          {place.cuisine && ` · ${place.cuisine}`}
          {place.address && ` · ${place.address}`}
          {place.isPrivate && " · Dropped pin"}
        </p>
      </header>

      {place.signatureDish && (
        <p className={styles.dish}>
          Wallet bleeder: {place.signatureDish.name} <strong>₹{place.signatureDish.priceInr.toLocaleString("en-IN")}</strong>
        </p>
      )}

      <div className={styles.links}>
        <a href={mapsUrl} target="_blank" rel="noreferrer noopener">
          Open in Google Maps
        </a>
        {place.sourceLinks.map((url) => (
          <a key={url} href={url} target="_blank" rel="noreferrer noopener">
            {hostOf(url)}
          </a>
        ))}
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={styles.note} role="status">
          {notice}
        </p>
      )}

      <section className={styles.section}>
        <h2>Your status</h2>
        <BoardPicker
          boards={choices}
          value={boards}
          noPublic={place.isPrivate}
          onChange={(next) => {
            setBoardEdit(next);
            // Moving the status moves the place on the person's list for those boards too.
            if (myStatus !== null) run(() => setStatus(diary, place.id, myStatus, next));
          }}
        />
        <StatusToggle value={myStatus} onChange={(s: Status) => run(() => setStatus(diary, place.id, s, boards))} />
        {myStatus === null && <p className={styles.note}>Mark it Want to or Visited to put it on your list.</p>}
        <Others snapshot={snapshot} me={me} opinions={of("status").filter((o) => o.authorId !== me)} render={(o: StatusOpinion) => (o.status === "visited" ? "visited" : "wants to go")} />
      </section>

      <section className={styles.section}>
        <h2>Tags</h2>
        <TagPicker
          tags={snapshot.tags}
          selected={myTagIds}
          disabled={myStatus === null}
          onToggle={(tagId) => run(() => (myTagIds.has(tagId) ? unapplyTag(diary, place.id, tagId) : tag(tagId)))}
          onCreate={(def) => run(async () => applyTag(diary, place.id, await defineTag(diary, def, boards), boards))}
        />
        <Others
          snapshot={snapshot}
          me={me}
          opinions={othersTags}
          render={(o: TagOpinion) => {
            const t = snapshot.tags.find((x) => x.id === o.tagId);
            return t ? `${t.emoji} ${t.name}` : "a tag you can't see";
          }}
        />
      </section>

      <section className={styles.section}>
        <h2>Comments</h2>
        {comments.length > 0 && (
          <ul className={styles.list}>
            {comments.map((c) => (
              <CommentRow
                key={c.id}
                comment={c}
                snapshot={snapshot}
                mine={c.authorId === me}
                onEdit={(text) => run(() => editComment(diary, c.id, place.id, text))}
                onDelete={() => run(() => removeOpinion(diary, c.id))}
              />
            ))}
          </ul>
        )}
        <form
          className={styles.section}
          onSubmit={(e) => {
            e.preventDefault();
            const text = draft;
            run(async () => {
              await addComment(diary, place.id, text, boards);
              setDraft("");
            });
          }}
        >
          <textarea
            className={styles.textarea}
            aria-label="New comment"
            placeholder={myStatus === null ? "Set a status first" : "Add a comment"}
            disabled={myStatus === null}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className={styles.secondary} disabled={myStatus === null || !draft.trim()}>
            Add comment
          </button>
        </form>
      </section>

      {canEdit && (
        <section className={styles.section}>
          <h2>Place</h2>
          <div className={styles.row}>
            <button type="button" className={styles.secondary} onClick={() => setEditing(true)}>
              Edit details
            </button>
            <button
              type="button"
              className={styles.danger}
              onClick={() => {
                if (!confirm(`Delete ${place.name} and your notes on it?`)) return;
                run(async () => {
                  await deletePlace(diary, place.id);
                  router.push("/");
                });
              }}
            >
              Delete place
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function personName(snapshot: DiarySnapshot, me: string, id: string): string {
  return id === me ? "You" : (snapshot.people.find((p) => p.id === id)?.name ?? "Someone");
}

function Others<O extends Opinion>({ snapshot, me, opinions, render }: { snapshot: DiarySnapshot; me: string; opinions: O[]; render: (o: O) => string }) {
  if (opinions.length === 0) return null;
  return (
    <ul className={styles.list}>
      {opinions.map((o) => (
        <li key={o.id} className={styles.note}>
          <strong>{personName(snapshot, me, o.authorId)}</strong> {render(o)}{" "}
          {o.boards.map((b) => (
            <span key={b} className={styles.badge}>
              {boardName(snapshot, b)}
            </span>
          ))}
        </li>
      ))}
    </ul>
  );
}

interface CommentRowProps {
  comment: CommentOpinion;
  snapshot: DiarySnapshot;
  mine: boolean;
  onEdit: (text: string) => void;
  onDelete: () => void;
}

function CommentRow({ comment, snapshot, mine, onEdit, onDelete }: CommentRowProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(comment.text);
  const me = mine ? comment.authorId : "";

  return (
    <li className={styles.item}>
      {editing ? (
        <>
          <textarea className={styles.textarea} aria-label="Edit comment" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          <div className={styles.row}>
            <button type="button" className={styles.textbutton} onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button
              type="button"
              className={styles.textbutton}
              disabled={!text.trim()}
              onClick={() => {
                onEdit(text);
                setEditing(false);
              }}
            >
              Save
            </button>
          </div>
        </>
      ) : (
        <>
          <p className={styles.itemtext}>{comment.text}</p>
          <div className={styles.row}>
            <span className={styles.note}>
              {personName(snapshot, me, comment.authorId)} · {new Date(comment.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
            </span>
            {comment.boards.map((b) => (
              <span key={b} className={styles.badge}>
                {boardName(snapshot, b)}
              </span>
            ))}
            {mine && (
              <>
                <button type="button" className={styles.textbutton} onClick={() => setEditing(true)}>
                  Edit
                </button>
                <button
                  type="button"
                  className={styles.textbutton}
                  onClick={() => {
                    if (confirm("Delete this comment?")) onDelete();
                  }}
                >
                  Delete
                </button>
              </>
            )}
          </div>
        </>
      )}
    </li>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
