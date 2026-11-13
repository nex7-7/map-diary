"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type CSSProperties } from "react";
import { FactsEditor } from "@/app/_entries/facts-editor";
import { BoardPicker, boardChoices, FollowBoards, StatusToggle, TagPicker } from "@/app/_entries/fields";
import { useItems } from "@/app/_entries/use-items";
import styles from "@/app/_entries/entries.module.css";
import { Avatar } from "@/app/_account/parts";
import { sealDate } from "@/app/diary/places-list";
import { toastError } from "@/lib/errors";
import { BoardBadge, buttonClass, Icon, MoreMenu, useConfirm, type MenuItem } from "@/lib/ui";
import { onMap } from "@/lib/map/style";
import { PlaceMap } from "./place-map";
import { RedateSheet } from "./redate-sheet";
import { AddLocation } from "./add-location";
import p from "./place.module.css";
import { defaultQuery, lookUpAgain, type Diary } from "@/lib/device";
import {
  addComment,
  applyTag,
  canChangeFacts,
  defineTag,
  deletePlace,
  editComment,
  EntryError,
  moveStamp,
  removeFromList,
  removeOpinion,
  setOutletVisited,
  setStatus,
  setVisitedDate,
  unapplyTag,
  updateFacts,
} from "@/lib/entries/actions";
import { boardName, opinionBoards, tagFit } from "@/lib/places/boards";
import { addressArea, chainFor, outletLabel, outletOf, viewOf } from "@/lib/places/chains";
import { mergeTargets, resolvePlace } from "@/lib/places/merges";
import { categoryStyle } from "@/lib/places/categories";
import { readPayload, type PlacePayload } from "@/lib/places/payloads";
import { visitedOn, visitedOutlets } from "@/lib/places/visited";
import { dishBasis, dishCaption } from "@/lib/places/dish";
import type { CommentOpinion, DiarySnapshot, Opinion, Outlet, PlaceView as Place, Status, StatusOpinion, TagOpinion } from "@/lib/places/types";

/**
 * One place: its facts, every opinion this device can read with author and board, and the
 * owner's own status, tags and comments. A chain is one page with a row per location; its
 * status and tags count for every location, and each comment says which one it is about.
 */
export function PlaceView({ diary, placeId: asked }: { diary: Diary; placeId: string }) {
  const router = useRouter();
  const { loaded, items, snapshot } = useItems(diary);
  // A merged duplicate opens the place it was merged into.
  const placeId = resolvePlace(mergeTargets(items), asked);
  const [editing, setEditing] = useState(false);
  /** The Visited seal's date sheet is open; once a date is saved the new seal lands at once. */
  const [redating, setRedating] = useState(false);
  const [redated, setRedated] = useState(false);
  const [relooking, setRelooking] = useState(false);
  const [relookQuery, setRelookQuery] = useState("");
  const [ask, confirmSheet] = useConfirm();
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [boardEdit, setBoardEdit] = useState<string[] | null>(null);
  const [tagBoardEdit, setTagBoardEdit] = useState<string[] | null>(null);
  const [commentBoardEdit, setCommentBoardEdit] = useState<string[] | null>(null);
  /** The location in focus on a chain: the map centres on it and its details are the ones edited. */
  const [focusId, setFocusId] = useState(placeId);
  /** On a chain: "all", or the location a new comment is about; null until picked (the one visited). */
  const [commentScope, setCommentScope] = useState<string | null>(null);
  const [showDishes, setShowDishes] = useState(false);

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

  /** Runs a write and shows a refusal as a toast instead of throwing. */
  const run = (write: () => Promise<unknown>) => {
    setNotice(null);
    write().catch(toastError);
  };

  const style = categoryStyle(place.category);
  const isAuthor = item.authorId === me;
  const isAdmin = diary.device.isAdmin === true;
  // A catalogue place's facts are the admin's to change once written, apart from the person who
  // added it putting a wrong match right; a dropped pin is its owner's.
  const canEdit = item.type === "place" ? canChangeFacts(items, item.id, me, isAdmin) : isAuthor;
  // Deleting a catalogue place drops other people's notes with it, so that stays the admin's,
  // and only from Admin → Places once someone else has a note on it.
  const othersHere = place.opinions.some((o) => o.authorId !== me);
  const canDelete = item.type === "place" ? isAdmin && !othersHere : isAuthor;
  const of = <K extends Opinion["kind"]>(kind: K) => place.opinions.filter((o): o is Extract<Opinion, { kind: K }> => o.kind === kind);
  const myStatusOpinion = of("status").find((o) => o.authorId === me);
  const myStatus = myStatusOpinion?.status ?? null;
  // On a chain stamped Visited: the locations this person has been to.
  const been = outlets && myStatusOpinion?.status === "visited" ? visitedOutlets(place, myStatusOpinion) : undefined;
  const scope = commentScope ?? (been ? (outlets?.find((o) => been.has(o.id))?.id ?? "all") : "all");
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
    if (
      fit.canWiden &&
      (await ask({ title: `Show “${def.name}” on ${where} too?`, body: `The tag isn't visible on ${where} yet.`, confirmLabel: `Show it on ${where}` }))
    ) {
      return applyTag(diary, place.id, tagId, tagBoards, visibleOn);
    }
    if (fit.fits.length === 0) throw new EntryError(`“${def.name}” isn't visible on ${where}, so it can't be applied there.`);
    await applyTag(diary, place.id, tagId, fit.fits, visibleOn);
    setNotice(`Tagged on ${fit.fits.map((id) => boardName(snapshot, id)).join(", ")} only: “${def.name}” isn't visible on ${where}.`);
  };
  const myTags = of("tag").filter((o) => o.authorId === me);
  const myTagIds = new Set(myTags.map((o) => o.tagId));
  // Where each of the person's own tags is posted, stamped on its chip like everyone else's.
  const myTagStamps = new Map(myTags.map((o) => [o.tagId, <Badges key={o.id} snapshot={snapshot} ids={o.boards} />]));
  const othersTags = of("tag").filter((o) => o.authorId !== me);
  const comments = of("comment").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const at = focus ?? place;
  const mapsUrl = mapsLink(at);
  const scopeOf = (c: CommentOpinion): string | undefined => {
    if (!outlets) return undefined;
    const outlet = c.allOutlets ? undefined : outlets.find((o) => o.id === c.placeId);
    return outlet ? outletLabel(place, outlet) : "All locations";
  };
  const outletOptions = (outlets ?? []).map((o) => ({ id: o.id, label: outletLabel(place, o) }));
  const scopeValue = (c: CommentOpinion): string => (c.placeId && !c.allOutlets && outlets?.some((o) => o.id === c.placeId) ? c.placeId : "all");

  const board = (id: string) => snapshot.boards.find((b) => b.id === id);
  const basis = place.signatureDish ? dishBasis(place.signatureDish) : [];
  const bleeder = place.signatureDish && (
    <div className="flex flex-col gap-1.5 self-start">
      <div className="ticket pop self-start [--notch:var(--page)] [--r:-1deg]" style={{ animationDelay: "0.5s" }}>
        <span className="flex flex-col gap-px py-2.5 pr-3.5 pl-4">
          <span className="text-[9px] font-bold tracking-[0.18em] uppercase">{dishCaption(place.signatureDish)}</span>
          <span className="font-print text-[21px] leading-tight">{place.signatureDish.name}</span>
        </span>
        <span className="stub worn grid place-items-center pr-4 pl-3.5 text-[28px]">₹{place.signatureDish.priceInr.toLocaleString("en-IN")}</span>
      </div>
      {basis.length > 0 && !showDishes && (
        <button type="button" className={`${styles.textbutton} self-start text-[12.5px]`} aria-expanded={false} onClick={() => setShowDishes(true)}>
          See the {basis.length} dishes
        </button>
      )}
      {basis.length > 0 && showDishes && place.signatureDish && (
        <div className={p.receipt}>
          {place.signatureDish.section && (
            <span className="kicker text-[9.5px]">
              {[place.signatureDish.section, place.signatureDish.chicken === false ? "veg" : place.signatureDish.chicken ? "chicken" : undefined].filter(Boolean).join(" · ")}
            </span>
          )}
          <ul>
            {basis.map((d, i) => {
              const middle = d.priceInr === place.signatureDish?.priceInr;
              return (
                <li key={i} className={middle ? "font-bold" : undefined}>
                  <span className="min-w-0">
                    {d.name}
                    {middle ? " · middle price" : ""}
                  </span>
                  <span className="shrink-0 tabular-nums">₹{d.priceInr.toLocaleString("en-IN")}</span>
                </li>
              );
            })}
          </ul>
          <button type="button" className={`${styles.textbutton} self-start text-[12.5px]`} aria-expanded onClick={() => setShowDishes(false)}>
            Hide the dishes
          </button>
        </div>
      )}
    </div>
  );
  const links = (at: Place | Outlet, short?: boolean) => (
    <div className={p.links}>
      <a href={mapsLink(at)} target="_blank" rel="noreferrer noopener" className="sketch-link">
        {short ? "Google Maps" : "Open in Google Maps"}
        <Icon name="external" size="s" />
      </a>
      {at.sourceLinks.map((url) => (
        <a key={url} href={url} target="_blank" rel="noreferrer noopener" className="sketch-link">
          {hostOf(url)}
          <Icon name="external" size="s" />
        </a>
      ))}
    </div>
  );

  const takeOff = async () => {
    const body = othersHere
      ? "Your stamp, tags and comments on it are deleted. The place and everyone else's notes stay."
      : "Your stamp, tags and comments on it are deleted. The place stays in the diary.";
    if (!(await ask({ title: `Take ${place.name} off your list?`, body, confirmLabel: "Take it off", danger: true }))) return;
    run(() => removeFromList(diary, place.id));
  };
  const relook = () => {
    setRelookQuery(defaultQuery(facts as PlacePayload));
    setRelooking(true);
    // The form opens in the details card, at the foot of the page.
    setTimeout(() => document.getElementById("relook")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  };
  const editLabel = focus ? `Edit ${outletLabel(place, focus)}` : "Edit details";
  const menu: MenuItem[] = [
    ...(myStatus !== null && item.type === "place" ? [{ label: "Take off my list", icon: "trash" as const, onSelect: () => void takeOff() }] : []),
    ...(canEdit ? [{ label: editLabel, icon: "pencil" as const, onSelect: () => setEditing(true) }] : []),
    ...(canEdit && item.type === "place" ? [{ label: "Look it up again", icon: "search" as const, onSelect: relook }] : []),
  ];

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
          {onMap(at.location) ? (
            <PlaceMap place={place} focus={at.location} kind={myStatus ?? (of("status").length > 0 ? "friend" : "pending")} visited={been} className={p.map} />
          ) : (
            <div className={`${p.map} ${p.offMap}`}>
              <Icon name="mapFold" size="l" />
              <span>Outside Mumbai, so not on the map</span>
            </div>
          )}
          <Link href="/?view=list" className={p.backFab} aria-label="Back to your places">
            <Icon name="chevronLeft" />
          </Link>
          {menu.length > 0 && (
            <span className={p.moreFab}>
              <MoreMenu label={`More: ${menu.map((m) => m.label.toLowerCase()).join(", ")}`} items={menu} className={p.fab ?? ""} />
            </span>
          )}
        </div>
        <div className={p.wideOnly}>{bleeder}</div>
      </aside>

      <div className={`lift ${p.sheet}`}>
        <article className={`page scalloped ${p.main}`}>
          <Link href="/" className={`${styles.back} ${p.wideOnly}`}>
            <Icon name="chevronLeft" size="m" />
            Places
          </Link>
          <header key={myStatus ?? "none"} className={p.head}>
            <p className="kicker rise">{[style.label, place.cuisine, outlets ? undefined : addressArea(place.address)].filter(Boolean).join(" · ")}</p>
            <h1 className="display flip-wrap text-[42px] leading-[0.98]">
              <span className="flip" style={{ animationDelay: "0.05s" }}>
                {place.name}
              </span>
            </h1>
            {outlets ? (
              <p className="sub">
                {outlets.length} locations{been && been.size > 0 ? ` · you've been to ${been.size === outlets.length ? "all of them" : been.size}` : ""}
              </p>
            ) : (
              (place.address || place.isPrivate) && (
                <p className="sub">
                  {[place.address, place.isPrivate ? "Dropped pin, only on your boards" : undefined].filter(Boolean).join(" · ")}
                </p>
              )
            )}
            {myStatus === "visited" && myStatusOpinion && (
              <button
                type="button"
                key={visitedOn(myStatusOpinion)}
                className={`seal slam ${p.stamp} ${p.stampTap} flex-col gap-[3px] [--r:-12deg]`}
                style={{ animationDelay: redated ? "0s" : "0.35s" }}
                onClick={() => setRedating(true)}
                aria-label={`Visited ${sealDate(visitedOn(myStatusOpinion))} ${new Date(visitedOn(myStatusOpinion)).getFullYear()}. Change the day`}
                title="Tap to change the day"
              >
                <span className="text-[9.5px] tracking-[0.18em]">Visited</span>
                <span className="text-[24px]">{sealDate(visitedOn(myStatusOpinion))}</span>
                <span className="text-[9.5px] tracking-[0.18em]">{new Date(visitedOn(myStatusOpinion)).getFullYear()}</span>
              </button>
            )}
            {myStatus === "want" && (
              <div className={`slot pop ${p.stamp} flex-col gap-0.5 text-[10.5px] font-bold tracking-[0.14em] uppercase`}>
                Want to
                <span className="hand text-[14px] tracking-normal text-seal normal-case">not yet!</span>
              </div>
            )}
          </header>

          <StatusToggle label="Your status" value={myStatus} onChange={(s: Status) => run(() => setStatus(diary, place.id, s, boards))} />
          {myStatus === null && <p className="hand -mt-2 text-[16px] text-ink-2">Stamp it Want to or Visited to put it on your list.</p>}
          {myStatus === "visited" && myStatusOpinion && (
            <RedateSheet
              open={redating}
              at={visitedOn(myStatusOpinion)}
              onClose={() => setRedating(false)}
              onSave={(ms) => {
                setRedating(false);
                setRedated(true);
                run(() => setVisitedDate(diary, place.id, ms));
              }}
            />
          )}

          <div className={p.narrowOnly}>{bleeder}</div>
          {!outlets && links(place)}

          {outlets && (
            <section className={styles.section}>
              <h2>Locations</h2>
              <div className={p.locs}>
                <ul className={p.outlets}>
                  {outlets.map((o) => {
                    const label = outletLabel(place, o);
                    const rest = addressRest(o.address, label);
                    const on = been?.has(o.id) ?? false;
                    return (
                      <li key={o.id} className={o.id === at.id ? `${p.outlet} ${p.outletFocus}` : p.outlet}>
                        <button type="button" className={p.outletName} onClick={() => setFocusId(o.id)} aria-pressed={o.id === at.id} aria-label={`Show ${label} on the map`}>
                          <Icon name="pin" size="s" />
                        </button>
                        <div className={p.outletBody}>
                          <button type="button" className={p.outletTitle} onClick={() => setFocusId(o.id)} tabIndex={-1}>
                            {label}
                          </button>
                          {rest && <span className={p.outletSub}>{rest}</span>}
                          {links(o, true)}
                        </div>
                        {/* Which locations this person has been to: tap to mark one, or unmark it. */}
                        <button
                          type="button"
                          className={p.outletSeal}
                          aria-pressed={on}
                          aria-label={on ? `Been to ${label}. Unmark it` : `Mark ${label} as been here`}
                          onClick={() => run(() => setOutletVisited(diary, place.id, o.id, !on, boards))}
                        >
                          {on ? (
                            <span className="seal solid" aria-hidden="true">
                              <Icon name="check" size="s" />
                            </span>
                          ) : (
                            <span className={`seal ${p.sealOpen}`} aria-hidden="true" />
                          )}
                          <span className={on ? "board warn" : "board personal"}>{on ? "Been" : myStatus === "visited" ? "Not yet" : "Been here?"}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <AddLocation diary={diary} items={items} placeId={place.id} onDone={setNotice} />
              </div>
            </section>
          )}
          {/* On a single place, another location makes it a chain. */}
          {!outlets && item.type === "place" && <AddLocation diary={diary} items={items} placeId={place.id} onDone={setNotice} />}

          <hr className={p.rule} />

          {notice && (
            <p className={styles.note} role="status">
              {notice}
            </p>
          )}

          {/* Where this person's own stamp, tags and notes go, not where others posted theirs. */}
          <section className={`${styles.section} ${myStatus === null ? "opacity-60" : ""}`}>
            <h2>{myStatus === null ? "Your stamp will go on" : "Your stamp is on"}</h2>
            <p className={`${styles.note} order-last`}>Tags and comments you add here go on the same boards, unless you pick otherwise as you write.</p>
            <BoardPicker
              boards={choices}
              value={boards}
              noPublic={place.isPrivate}
              onChange={(next) => {
                setBoardEdit(next);
                // Moving the status moves the place on the person's list for those boards too,
                // and takes along their tags and comments that were with it.
                if (myStatus !== null) {
                  run(async () => {
                    const visible = (tagId: string, boardId: string) => {
                      const def = snapshot.tags.find((t) => t.id === tagId);
                      return def ? tagFit(def, [boardId], snapshot).fits.length > 0 : false;
                    };
                    const kept = await moveStamp(diary, place.id, myStatus, next, visible);
                    if (kept > 0) setNotice(`${kept === 1 ? "One tag stayed" : `${kept} tags stayed`} where ${kept === 1 ? "it was" : "they were"}: someone else's tag can't be shown on ${next.map((id) => boardName(snapshot, id)).join(", ")}.`);
                  });
                }
              }}
            />
          </section>

          {of("status").some((o) => o.authorId !== me) && (
            <section className={styles.section}>
              <h2>Who else</h2>
              <Others snapshot={snapshot} me={me} opinions={of("status").filter((o) => o.authorId !== me)} render={(o: StatusOpinion) => (o.status === "visited" ? "has been" : "wants to go")} />
            </section>
          )}

          <section className={styles.section}>
            <h2>Tags</h2>
            {othersTags.length > 0 && (
              <div className={styles.chips}>
                {othersTags.map((o, i) => {
                  const t = snapshot.tags.find((x) => x.id === o.tagId);
                  const tilt = TILTS[i % TILTS.length];
                  return (
                    <span key={o.id} className="sticker pop" style={{ "--r": tilt, transform: `rotate(${tilt})`, animationDelay: `${650 + i * 110}ms` } as CSSProperties} title={t?.description || undefined}>
                      {t ? `${t.emoji ? `${t.emoji} ` : ""}${t.name}` : "A tag you can't see"}
                      <span className="hand text-[13px] font-normal text-ink-2">{personName(snapshot, me, o)}</span>
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
              stamps={myTagStamps}
              onToggle={(tagId) => run(() => (myTagIds.has(tagId) ? unapplyTag(diary, place.id, tagId) : tag(tagId)))}
              onCreate={(def) => run(async () => applyTag(diary, place.id, await defineTag(diary, def, tagBoards), tagBoards))}
            />
            {myStatus !== null && (
              <FollowBoards compact what="New tags" boards={choices} statusBoards={boards} value={tagBoardEdit && tagBoards} onChange={setTagBoardEdit} noPublic={place.isPrivate} />
            )}
          </section>

          <section className={styles.section}>
            <h2>In the margin</h2>
            {comments.length === 0 && <p className="hand m-0 text-[16px] text-ink-3">Nothing written here yet.</p>}
            {comments.length > 0 && (
              <ul className={p.comments}>
                {comments.map((c) => (
                  <CommentRow
                    key={c.id}
                    comment={c}
                    snapshot={snapshot}
                    mine={c.authorId === me}
                    scope={scopeOf(c)}
                    {...(outlets && c.authorId === me ? { locations: { options: outletOptions, value: scopeValue(c) } } : {})}
                    onEdit={(text, about) => run(() => editComment(diary, c.id, c.placeId ?? place.id, text, about))}
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
                const about = outlets && scope !== "all" && outlets.some((o) => o.id === scope) ? scope : undefined;
                run(async () => {
                  await addComment(diary, about ?? place.id, text, commentBoards, outlets !== undefined && about === undefined);
                  setDraft("");
                });
              }}
            >
              <textarea
                className={p.lined}
                aria-label="New comment"
                placeholder={myStatus === null ? "Stamp a status first" : "Write in the margin…"}
                disabled={myStatus === null}
                rows={3}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              {outlets && myStatus !== null && <AboutChips options={outletOptions} value={scope} onChange={setCommentScope} />}
              <div className={p.send}>
                <button type="submit" className={buttonClass({ size: "m" })} disabled={myStatus === null || !draft.trim()}>
                  Add comment
                </button>
                {myStatus !== null && (
                  <FollowBoards compact what="Comment" boards={choices} statusBoards={boards} value={commentBoardEdit && commentBoards} onChange={setCommentBoardEdit} noPublic={place.isPrivate} />
                )}
              </div>
            </form>
          </section>

          {(canEdit || canDelete) && (
            <section className={styles.section}>
              <h2>{isAdmin && !isAuthor ? "Place details · admin" : "Place details"}</h2>
              <div className={p.details}>
                {canEdit && (
                  <button type="button" className={p.detailRow} onClick={() => setEditing(true)}>
                    <Icon name="pencil" size="m" />
                    <span>{editLabel}</span>
                    <Icon name="chevronRight" size="s" />
                  </button>
                )}
                {canEdit && item.type === "place" && (
                  <button type="button" className={p.detailRow} onClick={relook} aria-expanded={relooking}>
                    <Icon name="search" size="m" />
                    <span>Look it up again</span>
                    <Icon name="chevronRight" size="s" />
                  </button>
                )}
                {canDelete && (
                  <button
                    type="button"
                    className={`${p.detailRow} text-seal-deep`}
                    onClick={async () => {
                      const what = focus ? `the ${outletLabel(place, focus)} location of ${place.name}` : place.name;
                      const body =
                        item.type === "place"
                          ? "It leaves everyone's diary, and your notes on it are deleted too. To keep the place and only drop your own notes, use Take off my list."
                          : "Your notes on it are deleted too.";
                      if (!(await ask({ title: `Delete ${what}?`, body, confirmLabel: "Delete", danger: true }))) return;
                      run(async () => {
                        await deletePlace(diary, item.id);
                        router.push("/");
                      });
                    }}
                  >
                    <Icon name="trash" size="m" />
                    <span>{focus ? "Delete this location" : "Delete place"}</span>
                  </button>
                )}
              </div>
              {isAdmin && !isAuthor && <p className={styles.note}>Only you see this card, as the admin.</p>}
              {relooking && (
                <form
                  id="relook"
                  className="flex flex-col gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!relookQuery.trim()) return;
                    run(async () => {
                      await lookUpAgain(diary, item.id, relookQuery, !isAdmin || relookQuery.trim() !== defaultQuery(facts as PlacePayload));
                      setRelooking(false);
                      setNotice("Looking it up. Pick the right match in your Inbox.");
                    });
                  }}
                >
                  <label className="flex flex-col gap-1">
                    <span className="text-[12px] text-ink-2">The right Zomato or Google Maps link, or the name and area</span>
                    <input className={styles.input} value={relookQuery} onChange={(e) => setRelookQuery(e.target.value)} autoFocus inputMode="url" />
                  </label>
                  <div className={styles.row}>
                    <button type="submit" className={buttonClass({ size: "m" })} disabled={!relookQuery.trim()}>
                      Look it up
                    </button>
                    <button type="button" className={styles.textbutton} onClick={() => setRelooking(false)}>
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </section>
          )}
        </article>
      </div>
      {confirmSheet}
    </div>
  );
}

/** Tags go on by hand, so each sticker sits at its own angle. */
const TILTS = ["-3deg", "2.5deg", "-1.5deg", "3deg", "-2deg"];

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
  /** On a chain: the locations it can be about, and which it is about now ("all" or an outlet's id). */
  locations?: { options: readonly { id: string; label: string }[]; value: string };
  /** `about` is set only when the person picked another location. */
  onEdit: (text: string, about?: string) => void;
  onDelete: () => void;
}

function CommentRow({ comment, snapshot, mine, scope, locations, onEdit, onDelete }: CommentRowProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(comment.text);
  const [about, setAbout] = useState(locations?.value ?? "all");
  const [ask, confirmSheet] = useConfirm();
  const me = mine ? comment.authorId : "";
  // Screen readers list every comment's buttons together, so each names its own comment.
  const short = [...comment.text.trim()].length > 40 ? `${[...comment.text.trim()].slice(0, 40).join("")}…` : comment.text.trim();

  return (
    <li className={`rise ${p.comment}`} style={{ "--ink-note": comment.viaClaude ? "var(--clay)" : mine ? "var(--ink)" : "var(--plum)" } as CSSProperties}>
      {editing ? (
        <>
          <textarea className={styles.textarea} aria-label="Edit comment" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          {locations && <AboutChips options={locations.options} value={about} onChange={setAbout} />}
          <div className={styles.row}>
            <button
              type="button"
              className={styles.textbutton}
              onClick={() => {
                setText(comment.text);
                setAbout(locations?.value ?? "all");
                setEditing(false);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.textbutton}
              disabled={!text.trim()}
              onClick={() => {
                onEdit(text, locations && about !== locations.value ? about : undefined);
                setEditing(false);
              }}
            >
              Save
            </button>
          </div>
        </>
      ) : (
        <>
          <p className={`hand ${p.commentText}`}>{comment.text}</p>
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
                <MoreMenu
                  label={`Comment options: ${short}`}
                  items={[
                    {
                      label: locations ? "Edit or move" : "Edit",
                      icon: "pencil",
                      onSelect: () => {
                        setText(comment.text);
                        setAbout(locations?.value ?? "all");
                        setEditing(true);
                      },
                    },
                    {
                      label: "Delete",
                      icon: "trash",
                      danger: true,
                      onSelect: () =>
                        void (async () => {
                          if (await ask({ title: "Delete this comment?", confirmLabel: "Delete", danger: true })) onDelete();
                        })(),
                    },
                  ]}
                />
              </span>
            )}
          </div>
        </>
      )}
      {confirmSheet}
    </li>
  );
}

/** Which location a comment is about, as chips: All locations, then each outlet. */
function AboutChips({ options, value, onChange }: { options: readonly { id: string; label: string }[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="kicker text-[9.5px]" id="about-label">
        About
      </span>
      <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="about-label">
        {[{ id: "all", label: "All locations" }, ...options].map((o) => (
          <button key={o.id} type="button" className={`chip ${o.id === value ? "on" : "soft"} h-8 text-[12.5px]`} aria-pressed={o.id === value} onClick={() => onChange(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** An address without the part already shown as the location's name, the city or the postcode. */
function addressRest(address: string | undefined, label: string): string | undefined {
  const parts = (address ?? "")
    .split(",")
    .map((x) => x.replace(/\b\d{3}\s?\d{3}\b/g, "").trim())
    .filter((x) => x && x.toLowerCase() !== label.toLowerCase() && !/^(mumbai|bombay|maharashtra|india)$/i.test(x));
  return parts.length > 0 ? parts.join(", ") : undefined;
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
