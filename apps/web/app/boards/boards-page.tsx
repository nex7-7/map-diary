"use client";

import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";
import { useItems } from "@/app/_entries/use-items";
import { sealDate } from "@/app/diary/places-list";
import { MeLink } from "@/app/_shell/me-link";
import { DiaryShell } from "@/app/_shell/diary-shell";
import { DeviceGate, type Diary } from "@/lib/device";
import { EMPTY_FILTERS, filterPlaces } from "@/lib/places/filter";
import { categoryStyle } from "@/lib/places/categories";
import type { Board, DiarySnapshot, Person, PlaceView, StatusOpinion } from "@/lib/places/types";
import { boardTint, Glyph, Icon, Notebook, type NotebookTab } from "@/lib/ui";
import { cn } from "@/lib/utils";
import k from "./boards.module.css";

/** `/boards`: every board, Public, each group and Personal, as tabs of one notebook. */
export function BoardsPage() {
  return (
    <DeviceGate>
      {(diary) => (
        <DiaryShell diary={diary} current="boards">
          <Boards diary={diary} />
        </DiaryShell>
      )}
    </DeviceGate>
  );
}

function Boards({ diary }: { diary: Diary }) {
  const { loaded, snapshot } = useItems(diary);
  // Public first, then groups by name, then Personal, so a shared board opens by default.
  const all = useMemo(() => [...snapshot.boards].sort((a, b) => TAB_ORDER[a.kind] - TAB_ORDER[b.kind] || a.name.localeCompare(b.name)), [snapshot.boards]);
  const [picked, setPicked] = useState<string | null>(null);
  const board = all.find((b) => b.id === picked) ?? all[0];
  let g = 0;
  const tabs: NotebookTab[] = all.map((b) => ({ id: b.id, label: boardLabel(b), tint: boardTint(b.kind, b.kind === "group" ? g++ : 0) }));

  return (
    <div className="flex h-[calc(100dvh-var(--tabbar-h)-env(safe-area-inset-bottom))] flex-col min-[900px]:mx-auto min-[900px]:h-dvh min-[900px]:max-w-[760px] min-[900px]:pt-6">
      <header className="flex items-center justify-between px-4 pt-[max(16px,env(safe-area-inset-top))] pb-3">
        <p className="kicker rise">Boards · who went where</p>
        <MeLink me={snapshot.me} />
      </header>
      {!loaded ? (
        <p className="hand px-6 text-[17px] text-ink-3">Opening…</p>
      ) : !board ? (
        <div className="flex flex-col gap-3 px-6">
          <p className="hand m-0 text-[17px] text-ink-2">No boards on this device yet. Once you&apos;re on the Public board or in a group, it shows up here.</p>
          <Link href="/groups" className="sketch-link self-start text-[14px] font-semibold">
            Make a group or join one
          </Link>
        </div>
      ) : (
        <Notebook label="Boards" tabs={tabs} value={board.id} onValueChange={setPicked} className="flex-1">
          <div key={board.id} className="min-h-0 flex-1 overflow-y-auto pt-5 pb-10">
            <BoardPage board={board} snapshot={snapshot} me={diary.device.accountId} />
          </div>
        </Notebook>
      )}
    </div>
  );
}

const TAB_ORDER: Record<Board["kind"], number> = { master: 0, group: 1, personal: 2 };
const boardLabel = (b: Board) => (b.kind === "master" ? "Public" : b.kind === "personal" ? "Personal" : b.name);

/** Everyone gets their own ink, picked from the id so a person keeps theirs. */
const INKS = ["var(--seal)", "var(--plum)", "var(--indigo)", "var(--forest)", "var(--clay)"];
function inkOf(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return INKS[h % INKS.length] ?? "var(--ink)";
}

/** A person's face: their photo, or their initial pressed in their ink. `want` draws a dotted ring. */
function Face({ person, size = 40, want = false, className, style }: { person: Person | undefined; size?: number; want?: boolean; className?: string | undefined; style?: CSSProperties }) {
  // An account that hasn't set a name yet is "Me" on its own device.
  const name = person?.name === "Me" ? "You" : (person?.name ?? "?");
  const initial = [...name.trim()][0]?.toUpperCase() ?? "?";
  const dims = { width: size, height: size, fontSize: size * 0.44, ...style };
  if (want) {
    return (
      <span className={cn(k.face, k.ring, className)} style={dims} title={`${name} wants to go`}>
        {initial}
      </span>
    );
  }
  if (person?.avatar?.kind === "photo") return <img src={person.avatar.dataUrl} alt="" className={cn(k.face, className)} style={dims} title={name} />;
  return (
    <span className={cn(k.face, "grit", className)} style={{ background: inkOf(person?.id ?? name), ...dims }} title={name}>
      {person?.avatar?.kind === "emoji" ? person.avatar.emoji : initial}
    </span>
  );
}

const TILTS = ["-2deg", "1.5deg", "-1deg", "2.5deg", "-2.5deg"];

function BoardPage({ board, snapshot, me }: { board: Board; snapshot: DiarySnapshot; me: string }) {
  const [order, setOrder] = useState<"wanted" | "newest">("wanted");
  const listed = useMemo(() => filterPlaces(snapshot.places, { ...EMPTY_FILTERS, boards: [board.id] }, me), [snapshot.places, board.id, me]);
  const members = board.memberIds ? snapshot.people.filter((p) => board.memberIds?.includes(p.id)) : snapshot.people;
  const person = (id: string) => snapshot.people.find((p) => p.id === id);
  const statusesOn = (p: PlaceView) => p.opinions.filter((o): o is StatusOpinion => o.kind === "status" && o.shownOn.includes(board.id));
  const went = listed.filter((l) => statusesOn(l.place).some((o) => o.status === "visited")).length;

  // Friends' latest statuses on this board, newest first.
  const postcards = listed
    .flatMap((l) => statusesOn(l.place).filter((o) => o.authorId !== me).map((o) => ({ o, place: l.place })))
    .sort((a, b) => b.o.updatedAt.localeCompare(a.o.updatedAt))
    .slice(0, 8);

  const rows = listed
    .map((l) => {
      const ss = statusesOn(l.place);
      return { l, ss, wants: ss.filter((o) => o.status === "want").length, latest: ss.map((o) => o.updatedAt).sort().at(-1) ?? l.addedAt };
    })
    .sort((a, b) => (order === "wanted" ? b.wants - a.wants || b.ss.length - a.ss.length : b.latest.localeCompare(a.latest)));
  const short = boardLabel(board);

  return (
    <>
      <section className="flex flex-col gap-3.5 pr-4 pl-12">
        <div className="flip-wrap flex items-baseline justify-between gap-2.5">
          <h1 className="display flip text-[38px]">{short}</h1>
          <span className="hand pop text-[15px] whitespace-nowrap text-ink-2 [--r:3deg]" style={{ animationDelay: "0.5s" }}>
            {went} went · {listed.length - went} want
          </span>
        </div>
        <div className={cn("flex gap-3 overflow-x-auto px-0.5 pt-1 pb-0.5", k.scroll)}>
          {members.map((m, i) => (
            <div key={m.id} className="pop flex flex-none flex-col items-center gap-1" style={{ "--r": TILTS[i % TILTS.length], animationDelay: `${200 + i * 80}ms` } as CSSProperties}>
              <Face person={m} size={46} />
              <span className="text-[11.5px] font-semibold">{m.id === me ? "You" : m.name}</span>
            </div>
          ))}
          {board.kind === "group" && (
            <Link href="/groups" className="flex flex-none flex-col items-center gap-1 text-ink-2 no-underline">
              <span className={cn(k.face, k.ring)} style={{ width: 46, height: 46, fontSize: 22 }}>
                <Icon name="plus" size="m" />
              </span>
              <span className="text-[11.5px] font-semibold">Invite</span>
            </Link>
          )}
        </div>
        <p className="m-0 text-[12.5px] text-ink-3">
          {board.kind === "master"
            ? "Everyone on the app. Only what people post to Public shows here."
            : board.kind === "personal"
              ? "Only you. What you keep to yourself shows here."
              : `${members.length} ${members.length === 1 ? "member" : "members"}. Only they can read this board.`}
          {board.kind === "group" && (
            <>
              {" "}
              <Link href="/groups" className="sketch-link font-semibold">
                Manage
              </Link>
            </>
          )}
        </p>
      </section>

      {postcards.length > 0 && (
        <section className="mt-5 flex flex-col">
          <div className="flex items-baseline gap-2.5 pr-4 pl-12">
            <h2 className="kicker">Lately</h2>
            <span className="hand text-[14px] text-ink-2">postcards from your friends</span>
          </div>
          <div className={cn(k.cards, k.scroll)}>
            {postcards.map(({ o, place }, i) => {
              const who = person(o.authorId);
              return (
                <Link
                  key={o.id}
                  href={`/place#${encodeURIComponent(place.id)}`}
                  className={cn("deal", k.postcard)}
                  style={{ transform: `rotate(${TILTS[i % TILTS.length]})`, animationDelay: `${300 + i * 80}ms` }}
                >
                  <span className={k.win}>
                    <span className={o.status === "visited" ? k.pinVisited : k.pinWant}>
                      <Glyph category={place.category} />
                    </span>
                    {o.status === "visited" && (
                      <span className="seal slam absolute top-1.5 right-1.5 size-11 gap-px bg-page text-[6px] tracking-[0.12em] [--r:-12deg]" style={{ animationDelay: `${500 + i * 80}ms` }}>
                        <span>Visited</span>
                        <span className="text-[10.5px] tracking-normal">{sealDate(o.updatedAt)}</span>
                      </span>
                    )}
                  </span>
                  <span className="flex items-start gap-2 px-2.5 pt-2 pb-2.5">
                    <Face person={who} size={26} want={o.status === "want"} />
                    <span className="hand text-[14px] leading-tight">
                      {who?.name ?? "A friend"} {o.status === "visited" ? "went to" : "wants"} {place.name}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section className="mt-3 flex flex-col gap-2">
        <div className="flex items-center justify-between pr-4 pl-12">
          <h2 className="kicker">The {short} list</h2>
          <div className="flex gap-1.5" role="group" aria-label="Order">
            {(["wanted", "newest"] as const).map((x) => (
              <button key={x} type="button" className="chip soft h-7 px-2.5 text-[11.5px]" aria-pressed={order === x} onClick={() => setOrder(x)}>
                {x === "wanted" ? "Most wanted" : "Newest"}
              </button>
            ))}
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="hand m-0 pr-4 pl-12 text-[16px] text-ink-3">Nothing on this board yet.</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {rows.map(({ l, ss, wants }, i) => {
              const style = categoryStyle(l.place.category);
              const wentN = ss.length - wants;
              return (
                <li key={l.place.id} className="rise flex items-center gap-2.5 border-t border-ink/[0.07] py-3 pr-4 pl-12" style={{ animationDelay: `${Math.min(i, 10) * 50 + 200}ms` }}>
                  <Link href={`/place#${encodeURIComponent(l.place.id)}`} className="flex min-w-0 flex-1 flex-col gap-0.5 text-ink no-underline">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-serif text-[18px]">{l.place.name}</span>
                      {wants >= 3 && wentN === 0 && (
                        <span className="sticker pop flex-none bg-marker px-2 py-0.5 text-[10.5px] [--r:-4deg] [transform:rotate(-4deg)]" style={{ animationDelay: "1s" }}>
                          plan it?
                        </span>
                      )}
                    </span>
                    <span className="text-[11.5px] text-ink-3">{[l.place.cuisine ?? style.label, l.place.signatureDish ? `₹${l.place.signatureDish.priceInr.toLocaleString("en-IN")}` : undefined].filter(Boolean).join(" · ")}</span>
                  </Link>
                  <span className="flex flex-none flex-col items-end gap-1">
                    <span className="flex">
                      {ss.slice(0, 5).map((o, j) => (
                        <Face key={o.id} person={person(o.authorId)} size={24} want={o.status === "want"} className={k.mini} style={{ marginLeft: j ? -6 : 0 }} />
                      ))}
                    </span>
                    <span className="text-[10.5px] whitespace-nowrap text-ink-3">{[wentN && `${wentN} went`, wants && `${wants} want`].filter(Boolean).join(" · ")}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {rows.length > 0 && <p className="hand mx-4 mt-1.5 ml-12 text-[14px] text-ink-3">Filled faces went. Dotted faces want to go.</p>}
      </section>
    </>
  );
}
