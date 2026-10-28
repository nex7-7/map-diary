"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { ResolvedPlace } from "@map-diary/crypto";
import styles from "@/app/_entries/entries.module.css";
import { useItems } from "@/app/_entries/use-items";
import { Avatar } from "@/app/_account/parts";
import { sealDate } from "@/app/diary/places-list";
import { MeLink } from "@/app/_shell/me-link";
import { DiaryShell } from "@/app/_shell/diary-shell";
import { BoardBadge, Button, Glyph, Icon } from "@/lib/ui";
import { toastError } from "@/lib/errors";
import b from "./inbox.module.css";
import { DeviceGate, type Diary } from "@/lib/device";
import { choicesOf, usePending, type FailReason, type PendingItem, type PendingQueue } from "@/lib/pending";
import { canChangeFacts } from "@/lib/entries/actions";
import { categoryStyle, STATUS_LABELS } from "@/lib/places/categories";
import { statusOf } from "@/lib/places/chains";
import type { CommentOpinion, DiarySnapshot, Status, StatusOpinion } from "@/lib/places/types";

/** While the Inbox is open it checks for results this often. */
const INBOX_POLL_MS = 15_000;

/** `/inbox`: post for you. Places being looked up, matches to choose between, and what friends did. */
export function InboxPage() {
  return (
    <DeviceGate>
      {(diary) => (
        <DiaryShell diary={diary} current="inbox">
          <Inbox diary={diary} />
        </DiaryShell>
      )}
    </DeviceGate>
  );
}

function Inbox({ diary }: { diary: Diary }) {
  const { queue, items } = usePending(diary, INBOX_POLL_MS);
  const { snapshot, items: diaryItems } = useItems(diary);
  const friends = useFriendNews(snapshot, diary.device.accountId);
  const me = snapshot.people.find((p) => p.id === diary.device.accountId);

  const run = (action: () => Promise<unknown>) => {
    action().catch(toastError);
  };
  const group = (kinds: PendingItem["state"]["kind"][]) => items.filter((i) => kinds.includes(i.state.kind));
  const choose = group(["choose", "branch"]);
  const failed = group(["failed"]);
  const waiting = group(["unsent", "waiting"]);
  const added = group(["added"]);
  // The same count as the Inbox badge: only what needs the person. Friends' news is counted apart.
  const left = choose.length + failed.length;
  const news = friends.news.length;
  let n = 0;
  const delay = () => ({ animationDelay: `${0.15 + n++ * 0.1}s` });

  return (
    <div className={b.page}>
      <header className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <p className="kicker rise">{me?.name && me.name !== "Me" ? `Post for ${me.name}` : "Your post"}</p>
          {me && <MeLink me={me} />}
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="display flip-wrap text-[46px]">
            <span className="flip">Inbox</span>
          </h1>
          {left > 0 ? (
            <span className="hand pop text-[17px] text-seal [--r:-3deg]" style={{ animationDelay: "0.5s" }}>
              {left} to check
            </span>
          ) : news > 0 ? (
            <span className="hand pop text-[17px] text-ink-2 [--r:-3deg]" style={{ animationDelay: "0.5s" }}>
              {news} new from friends
            </span>
          ) : null}
        </div>
      </header>

      {!queue && <p className="hand text-[17px] text-ink-3">Opening…</p>}
      {queue && items.length === 0 && friends.news.length === 0 && (
        <p className={b.empty}>Nothing in the post. Add a place by name or a Zomato or District link and it waits here until it&apos;s found.</p>
      )}

      {queue && waiting.length > 0 && (
        <Section title="Being looked up">
          {waiting.map((i) => (
            <Letter key={i.id} style={delay()} postage={<span className="seal size-[26px] border-[1.5px] shadow-none" />}>
              <div className="flex items-center gap-3 pr-12">
                {i.draft.category ? (
                  <Glyph category={i.draft.category} />
                ) : (
                  <span className="grid size-9 shrink-0 place-items-center rounded-full border-[1.5px] border-dashed border-ink-3 text-ink-2">
                    <Icon name="search" size="s" />
                  </span>
                )}
                <ItemHead item={i} />
              </div>
              <div className="flex items-center gap-2">
                <span className={b.dots} aria-hidden>
                  <span />
                  <span />
                  <span />
                </span>
                <span className="hand text-[15px] text-ink-2">
                  {i.state.kind === "unsent" ? "Not sent yet. It goes when you're back online." : `Looking it up. Only the ${i.draft.link ? "link" : "name"} was sent.`}
                </span>
              </div>
              <div className={styles.row}>
                {!i.draft.refreshPlaceId && (
                  <Link href={`/add#pending=${encodeURIComponent(i.id)}`} className={styles.textbutton}>
                    Drop a pin instead
                  </Link>
                )}
                <button type="button" className={styles.textbutton} onClick={() => run(() => queue.dismiss(i.id))}>
                  Remove
                </button>
              </div>
            </Letter>
          ))}
        </Section>
      )}

      {queue && choose.length > 0 && (
        <Section title="Pick one">
          {choose.map((i) =>
            i.state.kind === "branch" ? (
              <BranchLetter key={i.id} item={i} queue={queue} run={run} style={delay()} />
            ) : i.state.kind === "choose" && i.state.chain ? (
              <ChainLetter key={i.id} item={i} queue={queue} run={run} style={delay()} />
            ) : (
              <ChooseLetter key={i.id} item={i} queue={queue} run={run} style={delay()} />
            ),
          )}
        </Section>
      )}

      {queue && failed.length > 0 && (
        <Section title="Returned to sender">
          {failed.map((i) => (
            <Letter key={i.id} style={delay()} postage={<span className="worn text-[18px] text-seal">?</span>}>
              <div className="pr-12">
                <ItemHead item={i} />
              </div>
              <p className="hand m-0 text-[15px] text-seal-deep">{failText(i.state.kind === "failed" ? i.state.reason : "not_found")}</p>
              <Correct
                start={i.query}
                onLookUp={(q) => run(() => queue.requery(i.id, q))}
                fillHref={`/fill#pending=${encodeURIComponent(i.id)}`}
              />
              <div className={styles.row}>
                <Button variant="secondary" size="m" onClick={() => run(() => queue.retry(i.id))}>
                  Try again
                </Button>
                {!i.draft.refreshPlaceId && (
                  <Link href={`/add#pending=${encodeURIComponent(i.id)}`} className="chip soft">
                    <Icon name="pin" size="s" />
                    Drop a pin
                  </Link>
                )}
                <button type="button" className={styles.textbutton} onClick={() => run(() => queue.dismiss(i.id))}>
                  Remove
                </button>
              </div>
            </Letter>
          ))}
        </Section>
      )}

      {queue && added.length > 0 && (
        <Section title="Found">
          {added.map((i) =>
            i.state.kind === "added" ? (
              <FoundRow
                key={i.id}
                item={i}
                placeId={i.state.placeId}
                name={i.state.name}
                existing={i.state.existing === true}
                status={i.state.existing ? statusOf(diaryItems, i.state.placeId, diary.device.accountId) : undefined}
                canFix={!i.draft.refreshPlaceId && canChangeFacts(diaryItems, i.state.placeId, diary.device.accountId, diary.device.isAdmin === true)}
                queue={queue}
                run={run}
                style={delay()}
              />
            ) : null,
          )}
        </Section>
      )}

      {friends.news.length > 0 && (
        <Section
          title="From friends"
          action={
            <button type="button" className="chip soft h-7 px-2.5 text-[11.5px]" onClick={friends.markRead}>
              Mark all read
            </button>
          }
        >
          {friends.news.map((x, i) => (
            <FriendNote key={x.opinion.id} news={x} snapshot={snapshot} index={i} />
          ))}
        </Section>
      )}
      {friends.cleared && friends.news.length === 0 && <p className="hand pop m-0 py-5 text-center text-[17px] text-ink-3">All caught up. Go eat something.</p>}
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <h2 className="kicker">{title}</h2>
        {action}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

/** An envelope: the flap folded down over the top, and a postage stamp in the corner. */
function Letter({ postage, style, children }: { postage?: ReactNode; style?: CSSProperties; children: ReactNode }) {
  return (
    <div className={`rise ${b.letter}`} style={style}>
      <svg className={b.flap} viewBox="0 0 100 22" preserveAspectRatio="none" aria-hidden>
        <path d="M0 0L50 20L100 0" fill="none" stroke="var(--rule-ink)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
      </svg>
      {children}
      {postage && (
        <span className={b.postage} aria-hidden>
          {postage}
        </span>
      )}
    </div>
  );
}

function ItemHead({ item }: { item: PendingItem }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="font-serif text-[21px] leading-tight">{item.draft.label || item.query}</span>
      <span className="text-[12px] text-ink-3">{item.draft.refreshPlaceId ? "New details for a place" : STATUS_LABELS[item.draft.status]}</span>
      {item.draft.link && item.draft.link !== item.draft.label && <span className={`text-[12px] text-ink-3 ${b.link}`}>{item.draft.link}</span>}
    </div>
  );
}

type LetterProps = { item: PendingItem; queue: PendingQueue; run: (a: () => Promise<unknown>) => void; style: CSSProperties };

function ChooseLetter({ item, queue, run, style }: LetterProps) {
  if (item.state.kind !== "choose") return null;
  const n = item.state.candidates.length;
  const refresh = item.draft.refreshPlaceId !== undefined;
  return (
    <Letter style={style}>
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] text-ink-2">{refresh ? "New details for" : "You typed"}</span>
        <span className="font-serif text-[21px]">“{item.draft.label || item.query}”</span>
        <span className="hand text-[15px] text-ink-2">
          {refresh
            ? item.draft.correcting
              ? "Pick the right place. Its details and links are replaced; everyone's notes stay."
              : "Pick the match to replace its details with. Its links, chain and everyone's notes stay."
            : n === 1
              ? "One place came back. Is this it?"
              : `${n} places came back. Which one did you mean?`}
        </span>
      </div>
      <ul className={b.candidates}>
        {item.state.candidates.map((c, i) => (
          <li key={i}>
            <button type="button" className={b.cand} onClick={() => run(() => queue.choose(item.id, i))}>
              <Candidate place={c} />
            </button>
          </li>
        ))}
      </ul>
      <Correct
        prompt="None of these?"
        start={item.query}
        onLookUp={(q) => run(() => queue.requery(item.id, q))}
        fillHref={`/fill#pending=${encodeURIComponent(item.id)}`}
      />
      <div className={styles.row}>
        {!refresh && (
          <Link href={`/add#pending=${encodeURIComponent(item.id)}`} className={styles.textbutton}>
            Drop a private pin instead
          </Link>
        )}
        <button type="button" className={styles.textbutton} onClick={() => run(() => queue.dismiss(item.id))}>
          Remove
        </button>
      </div>
    </Letter>
  );
}

/** A match that is one outlet of a chain: add every outlet, or only one. */
function ChainLetter({ item, queue, run, style }: LetterProps) {
  if (item.state.kind !== "choose" || !item.state.chain) return null;
  const { chain } = item.state;
  const choices = choicesOf(item.state);
  const matches = item.state.candidates.length;
  return (
    <Letter style={style} postage={<span className="worn text-[11px] text-seal">×{choices.length}</span>}>
      <div className="flex flex-col gap-1 pr-12">
        <span className="font-serif text-[21px]">{chain.name}</span>
        <span className="hand text-[15px] leading-snug text-ink-2">It has {choices.length} outlets in Mumbai. Add every outlet, or just one?</span>
      </div>
      <Button size="m" onClick={() => run(() => queue.addAll(item.id))}>
        Every outlet ({choices.length})
      </Button>
      <ul className={b.candidates}>
        {choices.map((c, n) => (
          <li key={n}>
            <button type="button" className={b.cand} onClick={() => run(() => queue.choose(item.id, n))}>
              <Candidate place={c} note={n < matches ? (item.draft.link ? "The one you linked" : "Best match") : undefined} />
            </button>
          </li>
        ))}
      </ul>
      <div className={styles.row}>
        <button type="button" className={styles.textbutton} onClick={() => run(() => queue.dismiss(item.id))}>
          Remove
        </button>
      </div>
    </Letter>
  );
}

/** A match with the name of a place already on the map elsewhere: another branch of it, or not? */
function BranchLetter({ item, queue, run, style }: LetterProps) {
  if (item.state.kind !== "branch") return null;
  const { candidate, chain, area } = item.state;
  return (
    <Letter style={style}>
      <div className="flex flex-col gap-1">
        <span className="font-serif text-[21px]">Another branch of {chain.name}?</span>
        <span className="hand text-[15px] leading-snug text-ink-2">
          {chain.name} is already on the map{area ? ` in ${area}` : ""}. If this is the same restaurant, they show as one place with a row per location, and
          your notes stay on this branch.
        </span>
      </div>
      <div className={b.cand}>
        <Candidate place={candidate} />
      </div>
      <div className={styles.row}>
        <Button size="m" onClick={() => run(() => queue.answerBranch(item.id, true))}>
          Yes, same restaurant
        </Button>
        <Button variant="secondary" size="m" onClick={() => run(() => queue.answerBranch(item.id, false))}>
          No, a different place
        </Button>
      </div>
    </Letter>
  );
}

/**
 * Puts a lookup right by hand: a better link or name to look up instead, or the details typed
 * in by the person themselves.
 */
function Correct({
  prompt,
  start,
  onLookUp,
  fillHref,
  onCancel,
}: {
  prompt?: string;
  start: string;
  onLookUp: (query: string) => void;
  fillHref: string;
  /** Given when the form starts open; Cancel then closes it from outside. */
  onCancel?: () => void;
}) {
  const [open, setOpen] = useState(onCancel !== undefined);
  const [query, setQuery] = useState(start);
  if (!open) {
    return (
      <div className={styles.row}>
        <button type="button" className={styles.textbutton} onClick={() => setOpen(true)}>
          {prompt ? `${prompt} Look up something else` : "Look up something else"}
        </button>
        <Link href={fillHref} className={styles.textbutton}>
          Fill it in yourself
        </Link>
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (query.trim()) onLookUp(query);
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-[12px] text-ink-2">The right Zomato or Google Maps link, or the name and area</span>
        <input className={styles.input} value={query} onChange={(e) => setQuery(e.target.value)} autoFocus inputMode="url" />
      </label>
      <div className={styles.row}>
        <Button size="m" type="submit" disabled={!query.trim()}>
          Look it up
        </Button>
        <Link href={fillHref} className="chip soft">
          <Icon name="pencil" size="s" />
          Fill it in yourself
        </Link>
        <button type="button" className={styles.textbutton} onClick={() => (onCancel ? onCancel() : setOpen(false))}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** A place the resolver found and the diary added; while it is still the person's to correct, it can be put right. */
function FoundRow({
  item,
  placeId,
  name,
  existing,
  status,
  canFix,
  queue,
  run,
  style,
}: LetterProps & { placeId: string; name: string; existing: boolean; status: Status | undefined; canFix: boolean }) {
  const [fixing, setFixing] = useState(false);
  return (
    <div className="rise flex flex-col gap-2" style={style}>
      <div className={b.found}>
        <span className="seal size-[44px] shrink-0 text-[7px] tracking-[0.12em] [transform:rotate(-8deg)]">Added</span>
        <Link href={`/place#${encodeURIComponent(placeId)}`} className="sketch-link min-w-0 flex-1 font-serif text-[19px] no-underline">
          {name}
        </Link>
        {canFix && !fixing && (
          <button type="button" className={styles.textbutton} onClick={() => setFixing(true)}>
            Wrong place?
          </button>
        )}
        <button type="button" className={styles.textbutton} onClick={() => run(() => queue.dismiss(item.id))}>
          Clear
        </button>
      </div>
      {existing && !fixing && (
        <p className="text-[12.5px] text-ink-3">
          {status ? `Already on your list as ${STATUS_LABELS[status]}` : "Already on the map"}, so your notes went onto it.
        </p>
      )}
      {fixing && (
        <Correct
          start={item.query}
          onCancel={() => setFixing(false)}
          onLookUp={(q) =>
            run(async () => {
              await queue.lookUpAgain(placeId, q, name, true);
              await queue.dismiss(item.id);
            })
          }
          fillHref={`/fill#place=${encodeURIComponent(placeId)}`}
        />
      )}
    </div>
  );
}

function Candidate({ place, note }: { place: ResolvedPlace; note?: string | undefined }) {
  const style = categoryStyle(place.category);
  return (
    <>
      <span className="kicker text-[9.5px]">{[style.label, place.cuisine].filter(Boolean).join(" · ")}</span>
      <span className="font-serif text-[17px] leading-tight">{place.name}</span>
      {note && <span className="hand text-[14px] text-seal">{note}</span>}
      {place.address && <span className="text-[11.5px] text-ink-3">{place.address}</span>}
      {place.signatureDish && (
        <span className="text-[11.5px] text-ink-2">
          {place.signatureDish.name} <span className="worn">₹{place.signatureDish.priceInr.toLocaleString("en-IN")}</span>
        </span>
      )}
    </>
  );
}

interface FriendNews {
  opinion: StatusOpinion | CommentOpinion;
  placeId: string;
  placeName: string;
}

/** When this device last marked friends' news read; kept on the device only. */
const SEEN_KEY = "inbox-friends-seen";
/** Before anything is marked read, show the last two weeks. */
const FIRST_LOOK_MS = 14 * 24 * 60 * 60 * 1000;

/** Friends' statuses and comments newer than the last "Mark all read", newest first. */
function useFriendNews(snapshot: DiarySnapshot, me: string) {
  const [seen, setSeen] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);
  useEffect(() => {
    try {
      setSeen(localStorage.getItem(SEEN_KEY) ?? new Date(Date.now() - FIRST_LOOK_MS).toISOString());
    } catch {
      setSeen(new Date(Date.now() - FIRST_LOOK_MS).toISOString());
    }
  }, []);
  const news = useMemo(() => {
    if (seen === null) return [];
    const out: FriendNews[] = [];
    for (const place of snapshot.places) {
      for (const o of place.opinions) {
        if (o.authorId === me || o.kind === "tag" || o.updatedAt <= seen) continue;
        out.push({ opinion: o, placeId: place.id, placeName: place.name });
      }
    }
    return out.sort((a, b) => b.opinion.updatedAt.localeCompare(a.opinion.updatedAt)).slice(0, 30);
  }, [snapshot, me, seen]);
  const markRead = () => {
    const now = new Date().toISOString();
    try {
      localStorage.setItem(SEEN_KEY, now);
    } catch {
      // Private mode: read for this visit only.
    }
    setSeen(now);
    setCleared(true);
  };
  return { news, markRead, cleared };
}

const NOTE_TILTS = ["-0.6deg", "0.5deg", "-0.3deg", "0.7deg"];

function FriendNote({ news, snapshot, index }: { news: FriendNews; snapshot: DiarySnapshot; index: number }) {
  const { opinion: o } = news;
  const person = snapshot.people.find((p) => p.id === o.authorId);
  const who = `${person?.name ?? "A friend"}${o.viaClaude ? " via Claude" : ""}`;
  const what = o.kind === "comment" ? "wrote about" : o.status === "visited" ? "went to" : "wants to go to";
  const board = o.boards.map((id) => snapshot.boards.find((x) => x.id === id)).find(Boolean);
  return (
    <Link
      href={`/place#${encodeURIComponent(news.placeId)}`}
      className={`rise ${b.note}`}
      style={{ transform: `rotate(${NOTE_TILTS[index % NOTE_TILTS.length]})`, animationDelay: `${300 + index * 90}ms` }}
    >
      <Avatar small id={o.authorId} name={person?.name ?? "?"} avatar={person?.avatar} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[13.5px] leading-snug">
          <b>{who}</b> {what} <span className="font-serif text-[15px]">{news.placeName}</span>
        </span>
        {o.kind === "comment" && <span className="hand text-[16px] text-plum">“{o.text}”</span>}
        <span className="flex items-center gap-2 text-[11.5px] text-ink-3">
          {board && <BoardBadge kind={board.kind} name={board.name} />}
          {new Date(o.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
        </span>
      </span>
      {o.kind === "status" && o.status === "visited" && (
        <span className="seal size-10 shrink-0 gap-px text-[6px] tracking-[0.12em] [transform:rotate(10deg)]">
          <span>Visited</span>
          <span className="text-[9.5px] tracking-normal">{sealDate(o.updatedAt)}</span>
        </span>
      )}
    </Link>
  );
}

function failText(reason: FailReason): string {
  switch (reason) {
    case "expired":
      return "The lookup timed out before anyone answered.";
    case "bad_result":
      return "The answer that came back didn't check out.";
    case "rejected":
      return "The lookup wouldn't take this. Try just the link or the name.";
    default:
      return "Couldn't find this place.";
  }
}
