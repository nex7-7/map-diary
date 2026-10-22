"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FactsEditor } from "@/app/_entries/facts-editor";
import { BoardPicker, boardChoices, FollowBoards, StatusToggle, TagPicker } from "@/app/_entries/fields";
import { useItems } from "@/app/_entries/use-items";
import styles from "@/app/_entries/entries.module.css";
import { Avatar } from "@/app/_account/parts";
import { BoardBadge, buttonClass, Icon } from "@/lib/ui";
import { PlaceMap } from "./place-map";
import p from "./place.module.css";
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
import { chainFor, outletLabel, outletOf, viewOf } from "@/lib/places/chains";
import { categoryStyle } from "@/lib/places/categories";
import { readPayload } from "@/lib/places/payloads";
import type { CommentOpinion, DiarySnapshot, Opinion, Outlet, PlaceView as Place, Status, StatusOpinion, TagOpinion } from "@/lib/places/types";

/**
 * One place: its facts, every opinion this device can read with author and board, and the
 * owner's own status, tags and comments. A chain is one page with a row per location; its
 * status and tags count for every location, and each comment says which one it is about.
 */
export function PlaceView({ diary, placeId }: { diary: Diary; placeId: string }) {
  const router = useRouter();
  const { loaded, items, snapshot } = useItems(diary);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [boardEdit, setBoardEdit] = useState<string[] | null>(null);
  const [tagBoardEdit, setTagBoardEdit] = useState<string[] | null>(null);
  const [commentBoardEdit, setCommentBoardEdit] = useState<string[] | null>(null);
  /** The location in focus on a chain: the map centres on it and its details are the ones edited. */
  const [focusId, setFocusId] = useState(placeId);
  /** On a chain: "all", or the location a new comment is about. */
  const [commentScope, setCommentScope] = useState<string>("all");

  const me = diary.device.accountId;
  const place = viewOf(snapshot.places, placeId);
  const outlets = place?.outlets && place.outlets.length > 1 ? place.outlets : undefined;
  const focus = (place && outlets && (outletOf(place, focusId) ?? outlets[0])) || undefined;
  const item = items.find((i) => i.id === (focus?.id ?? place?.id));

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
  // Tags and comments go with the status unless the person picks their own boards for them.
  const usable = (ids: readonly string[] | null) => {
    const kept = (ids ?? []).filter((id) => choices.some((b) => b.id === id && !(place.isPrivate && b.kind === "master")));
    return kept.length > 0 ? kept : boards;
  };
  const tagBoards = usable(tagBoardEdit);
  const commentBoards = usable(commentBoardEdit);

  /** Applies a tag where its definition is visible, offering to widen the person's own definition. */
  const tag = async (tagId: string) => {
    const def = snapshot.tags.find((t) => t.id === tagId);
    if (!def) return applyTag(diary, place.id, tagId, tagBoards);
    const fit = tagFit(def, tagBoards, snapshot);
    const visibleOn = (id: string) => fit.fits.includes(id);
    if (fit.outside.length === 0) return applyTag(diary, place.id, tagId, tagBoards, visibleOn);
    const where = fit.outside.map((id) => boardName(snapshot, id)).join(", ");
    // Applying one's own tag to the wider boards widens its definition to match.
    if (fit.canWiden && confirm(`“${def.name}” isn't visible on ${where}. Show the tag on ${where} too?`)) {
      return applyTag(diary, place.id, tagId, tagBoards, visibleOn);
    }
    if (fit.fits.length === 0) throw new EntryError(`“${def.name}” isn't visible on ${where}, so it can't be applied there.`);
    await applyTag(diary, place.id, tagId, fit.fits, visibleOn);
    setNotice(`Tagged on ${fit.fits.map((id) => boardName(snapshot, id)).join(", ")} only: “${def.name}” isn't visible on ${where}.`);
  };
  const myTagIds = new Set(of("tag").filter((o) => o.authorId === me).map((o) => o.tagId));
  const othersTags = of("tag").filter((o) => o.authorId !== me);
  const comments = of("comment").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const at = focus ?? place;
  const mapsUrl = mapsLink(at);
  const scopeOf = (c: CommentOpinion): string | undefined => {
    if (!outlets) return undefined;
    const outlet = c.allOutlets ? undefined : outlets.find((o) => o.id === c.placeId);
    return outlet ? outletLabel(place, outlet) : "All locations";
  };

  const board = (id: string) => snapshot.boards.find((b) => b.id === id);
  const bleeder = place.signatureDish && (
    <div className={p.bleeder}>
      <div>
        <p className="kicker">Wallet bleeder</p>
        <p className="heading-m">{place.signatureDish.name}</p>
        <p className="sub">Their signature dish, one serving</p>
      </div>
      <span className={p.price}>₹{place.signatureDish.priceInr.toLocaleString("en-IN")}</span>
    </div>
  );

  if (editing) {
    return (
      <div className={p.plain}>
        <div className={styles.page}>
          <h1 className={styles.title}>Edit details</h1>
          <FactsEditor
            facts={facts}
            onCancel={() => setEditing(false)}
            {...(item.type === "place" ? { chainFor: (name: string) => chainFor(items, name) } : {})}
            onSave={async (next) => {
              await updateFacts(diary, item, next);
              setEditing(false);
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={p.place}>
      <aside className={p.side}>
        <div className={p.hero}>
          <PlaceMap place={place} focus={at.location} kind={myStatus ?? (of("status").length > 0 ? "friend" : "pending")} className={p.map} />
          <Link href="/?view=list" className={`${p.fab} ${p.backFab}`} aria-label="Back to your places">
            <Icon name="chevronLeft" />
          </Link>
        </div>
        <div className={p.wideOnly}>{bleeder}</div>
      </aside>

      <div className={p.main}>
        <Link href="/" className={`${styles.back} ${p.wideOnly}`}>
          <Icon name="chevronLeft" size="m" />
          Places
        </Link>
        <header className={p.head}>
          <p className="kicker">
            <span aria-hidden>{style.emoji}</span>&nbsp; {[style.label, place.cuisine].filter(Boolean).join(" · ")}
          </p>
          <h1 className="display-xl">{place.name}</h1>
          {outlets ? (
            <p className="sub">{outlets.length} locations</p>
          ) : (
            (place.address || place.isPrivate) && (
              <p className="sub">
                {[place.address, place.isPrivate ? "Dropped pin, only on your boards" : undefined].filter(Boolean).join(" · ")}
              </p>
            )
          )}
          {!outlets && (
          <div className={styles.row}>
            <a href={mapsUrl} target="_blank" rel="noreferrer noopener" className={buttonClass({ variant: "secondary", size: "m" })}>
              <Icon name="external" size="s" />
              Open in Google Maps
            </a>
            {place.sourceLinks.map((url) => (
              <a key={url} href={url} target="_blank" rel="noreferrer noopener" className={buttonClass({ variant: "secondary", size: "m" })}>
                <Icon name="link" size="s" />
                {hostOf(url)}
              </a>
            ))}
          </div>
          )}
        </header>

        {outlets && (
          <section className={styles.section}>
            <h2>Locations</h2>
            <ul className={p.outlets}>
              {outlets.map((o) => (
                <li key={o.id} className={o.id === at.id ? `${p.outlet} ${p.outletFocus}` : p.outlet}>
                  <button type="button" className={p.outletName} onClick={() => setFocusId(o.id)} aria-pressed={o.id === at.id}>
                    <Icon name="pin" size="s" />
                    <span>
                      <strong>{outletLabel(place, o)}</strong>
                      {o.address && <span className="sub"> · {o.address}</span>}
                    </span>
                  </button>
                  <div className={styles.row}>
                    <a href={mapsLink(o)} target="_blank" rel="noreferrer noopener" className={buttonClass({ variant: "secondary", size: "m" })}>
                      <Icon name="external" size="s" />
                      Google Maps
                    </a>
                    {o.sourceLinks.map((url) => (
                      <a key={url} href={url} target="_blank" rel="noreferrer noopener" className={buttonClass({ variant: "secondary", size: "m" })}>
                        <Icon name="link" size="s" />
                        {hostOf(url)}
                      </a>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className={p.narrowOnly}>{bleeder}</div>

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
          <StatusToggle value={myStatus} onChange={(s: Status) => run(() => setStatus(diary, place.id, s, boards))} />
          {myStatus === null && <p className={styles.note}>Mark it Want to or Visited to put it on your list.</p>}
          <span className={styles.label}>Shown on</span>
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
          <Others snapshot={snapshot} me={me} opinions={of("status").filter((o) => o.authorId !== me)} render={(o: StatusOpinion) => (o.status === "visited" ? "visited" : "wants to go")} />
        </section>

        <section className={styles.section}>
          <h2>Tags</h2>
          {othersTags.length > 0 && (
            <div className={styles.chips}>
              {othersTags.map((o) => {
                const t = snapshot.tags.find((x) => x.id === o.tagId);
                return (
                  <span key={o.id} className={p.tagChip} title={t?.description || undefined}>
                    {t ? `${t.emoji ? `${t.emoji} ` : ""}${t.name}` : "A tag you can't see"}
                    <span className="sub">{personName(snapshot, me, o)}</span>
                    {o.boards.map((id) => {
                      const b = board(id);
                      return b ? <BoardBadge key={id} kind={b.kind} name={b.name} /> : null;
                    })}
                  </span>
                );
              })}
            </div>
          )}
          <TagPicker
            tags={snapshot.tags}
            selected={myTagIds}
            disabled={myStatus === null}
            onToggle={(tagId) => run(() => (myTagIds.has(tagId) ? unapplyTag(diary, place.id, tagId) : tag(tagId)))}
            onCreate={(def) => run(async () => applyTag(diary, place.id, await defineTag(diary, def, tagBoards), tagBoards))}
          />
          {myStatus !== null && (
            <FollowBoards what="Tags" boards={choices} statusBoards={boards} value={tagBoardEdit && tagBoards} onChange={setTagBoardEdit} noPublic={place.isPrivate} />
          )}
        </section>

        <section className={styles.section}>
          <h2>Comments</h2>
          {comments.length === 0 && <p className={styles.note}>No comments yet.</p>}
          {comments.length > 0 && (
            <ul className={p.comments}>
              {comments.map((c) => (
                <CommentRow
                  key={c.id}
                  comment={c}
                  snapshot={snapshot}
                  mine={c.authorId === me}
                  scope={scopeOf(c)}
                  onEdit={(text) => run(() => editComment(diary, c.id, c.placeId ?? place.id, text))}
                  onDelete={() => run(() => removeOpinion(diary, c.id))}
                />
              ))}
            </ul>
          )}
          <form
            className={p.composer}
            onSubmit={(e) => {
              e.preventDefault();
              const text = draft;
              const about = outlets && commentScope !== "all" && outlets.some((o) => o.id === commentScope) ? commentScope : undefined;
              run(async () => {
                await addComment(diary, about ?? place.id, text, commentBoards, outlets !== undefined && about === undefined);
                setDraft("");
              });
            }}
          >
            <textarea
              className={styles.textarea}
              aria-label="New comment"
              placeholder={myStatus === null ? "Set a status first" : "Add a comment"}
              disabled={myStatus === null}
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            {outlets && myStatus !== null && (
              <label className={styles.row}>
                <span className={styles.label}>About</span>
                <select className={styles.input} value={commentScope} onChange={(e) => setCommentScope(e.target.value)}>
                  <option value="all">All locations</option>
                  {outlets.map((o) => (
                    <option key={o.id} value={o.id}>
                      {outletLabel(place, o)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {myStatus !== null && (
              <FollowBoards what="Comment" boards={choices} statusBoards={boards} value={commentBoardEdit && commentBoards} onChange={setCommentBoardEdit} noPublic={place.isPrivate} />
            )}
            <div className={styles.row}>
              <button type="submit" className={buttonClass({ size: "m" })} disabled={myStatus === null || !draft.trim()}>
                Add comment
              </button>
            </div>
          </form>
        </section>

        {canEdit && (
          <section className={styles.section}>
            <h2>Place</h2>
            <div className={styles.row}>
              <button type="button" className={buttonClass({ variant: "secondary", size: "m" })} onClick={() => setEditing(true)}>
                <Icon name="pencil" size="s" />
                {focus ? `Edit ${outletLabel(place, focus)}` : "Edit details"}
              </button>
              <button
                type="button"
                className={buttonClass({ variant: "danger", size: "m" })}
                onClick={() => {
                  const what = focus ? `the ${outletLabel(place, focus)} location of ${place.name}` : place.name;
                  if (!confirm(`Delete ${what} and your notes on it?`)) return;
                  run(async () => {
                    await deletePlace(diary, item.id);
                    router.push("/");
                  });
                }}
              >
                {focus ? "Delete this location" : "Delete place"}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function personName(snapshot: DiarySnapshot, me: string, o: Opinion): string {
  const name = o.authorId === me ? "You" : (snapshot.people.find((p) => p.id === o.authorId)?.name ?? "Someone");
  return o.viaClaude ? `${name} via Claude` : name;
}

function Others<O extends Opinion>({ snapshot, me, opinions, render }: { snapshot: DiarySnapshot; me: string; opinions: O[]; render: (o: O) => string }) {
  if (opinions.length === 0) return null;
  return (
    <ul className={p.others}>
      {opinions.map((o) => (
        <li key={o.id}>
          <Author snapshot={snapshot} id={o.authorId} />
          <span>
            <strong>{personName(snapshot, me, o)}</strong> {render(o)}
          </span>
          <Badges snapshot={snapshot} ids={o.boards} />
        </li>
      ))}
    </ul>
  );
}

interface CommentRowProps {
  comment: CommentOpinion;
  snapshot: DiarySnapshot;
  mine: boolean;
  /** On a chain: which location the comment is about, or "All locations". */
  scope: string | undefined;
  onEdit: (text: string) => void;
  onDelete: () => void;
}

function CommentRow({ comment, snapshot, mine, scope, onEdit, onDelete }: CommentRowProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(comment.text);
  const me = mine ? comment.authorId : "";

  return (
    <li className={p.comment}>
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
          <p className={`quote ${p.commentText}`}>“{comment.text}”</p>
          <div className={p.byline}>
            <Author snapshot={snapshot} id={comment.authorId} />
            {comment.viaClaude && (
              <span className={p.claude}>
                <Icon name="sparkles" size="s" />
              </span>
            )}
            <strong className={comment.viaClaude ? p.claude : undefined}>{personName(snapshot, me, comment)}</strong>
            <span className="sub">· {new Date(comment.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
            {scope && <span className="sub">· {scope}</span>}
            <Badges snapshot={snapshot} ids={comment.boards} />
            {mine && (
              <span className={p.commentActions}>
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
              </span>
            )}
          </div>
        </>
      )}
    </li>
  );
}

function Author({ snapshot, id }: { snapshot: DiarySnapshot; id: string }) {
  const person = snapshot.people.find((x) => x.id === id);
  return <Avatar small id={id} name={person?.name ?? "?"} avatar={person?.avatar} />;
}

function Badges({ snapshot, ids }: { snapshot: DiarySnapshot; ids: string[] }) {
  return (
    <>
      {ids.map((id) => {
        const b = snapshot.boards.find((x) => x.id === id);
        return b ? <BoardBadge key={id} kind={b.kind} name={b.name} /> : null;
      })}
    </>
  );
}

function mapsLink(at: Place | Outlet): string {
  return `https://www.google.com/maps/search/?api=1&query=${at.location.lat},${at.location.lng}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
