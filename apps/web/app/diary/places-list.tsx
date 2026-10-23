"use client";

import { useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { categoryStyle, STATUS_LABELS } from "@/lib/places/categories";
import { formatDistance, type ListedPlace } from "@/lib/places/filter";
import type { DiarySnapshot, Status } from "@/lib/places/types";
import { MarkVisited, PlaceRow, Seal, StatusDot } from "@/lib/ui";

interface Props {
  listed: readonly ListedPlace[];
  snapshot: DiarySnapshot;
  selectedId: string | null;
  /** Places stamped Visited a moment ago, which get a handwritten "stamped!". */
  justStamped: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onSetStatus: (id: string, status: Status) => void;
  /** Why the list could be empty: a new diary, a quiet board, or filters that rule everything out. */
  empty: "diary" | "board" | "filters";
}

const EMPTY_TEXT: Record<Props["empty"], string> = {
  diary: "Your diary is empty. Add your first place with the red Add button, or long-press the map to drop a pin.",
  board: "Nothing on this board yet.",
  filters: "Nothing here matches. Try clearing the search or a filter.",
};

export function PlacesList({ listed, snapshot, selectedId, justStamped, onSelect, onSetStatus, empty }: Props) {
  if (listed.length === 0) {
    return <p className="hand py-10 pr-6 pl-12 text-[18px] text-ink-3">{EMPTY_TEXT[empty]}</p>;
  }
  return (
    <ul className="m-0 list-none p-0 pb-6" aria-label="Places">
      {listed.map((l, i) => (
        <SwipeRow
          key={l.place.id}
          index={i}
          item={l}
          snapshot={snapshot}
          selected={l.place.id === selectedId}
          stamped={justStamped.has(l.place.id)}
          onSelect={onSelect}
          onSetStatus={onSetStatus}
        />
      ))}
    </ul>
  );
}

const SWIPE_PX = 80;

/** Who else has it on their list, when it isn't on mine: "Aarav wants to go". */
export function friendLine(item: ListedPlace, snapshot: DiarySnapshot): string | undefined {
  if (item.mine) return undefined;
  const o = item.place.opinions.find((x) => x.kind === "status" && x.authorId !== snapshot.me.id && x.status === item.status);
  const name = o ? (snapshot.people.find((p) => p.id === o.authorId)?.name ?? "A friend") : "A friend";
  return item.status === "visited" ? `${name} has been` : `${name} wants to go`;
}

/** "12 OCT", the date on a Visited seal. */
export function sealDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]}`;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** A place row; swipe it right to stamp it Visited. */
function SwipeRow({
  item,
  index,
  snapshot,
  selected,
  stamped,
  onSelect,
  onSetStatus,
}: { item: ListedPlace; index: number; selected: boolean; stamped: boolean } & Omit<Props, "listed" | "selectedId" | "justStamped" | "empty">) {
  const { place, status, mine, distanceM } = item;
  const style = categoryStyle(place.category);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const [dx, setDx] = useState(0);
  const visitedByMe = mine && status === "visited";
  const myStatus = place.opinions.find((o) => o.kind === "status" && o.authorId === snapshot.me.id);

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse") return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onPointerMove = (e: PointerEvent) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const x = e.clientX - s.x;
    // Leave vertical scrolling alone.
    if (Math.abs(e.clientY - s.y) > Math.abs(x)) return;
    setDx(Math.max(0, Math.min(x, SWIPE_PX * 1.5)));
  };
  const onPointerEnd = () => {
    if (dx >= SWIPE_PX && !visitedByMe) onSetStatus(place.id, "visited");
    start.current = null;
    setDx(0);
  };

  const outlets = place.outlets && place.outlets.length > 1 ? `${place.outlets.length} locations` : undefined;
  const meta = [friendLine(item, snapshot), place.cuisine ?? style.label, outlets, distanceM !== undefined ? formatDistance(distanceM) : undefined]
    .filter(Boolean)
    .join(" · ");
  // A few rows deal in one after another; the rest are already there.
  const delay = index < 10 ? 80 + index * 60 : 0;

  return (
    <li className="deal relative overflow-hidden border-t border-ink/[0.07] first:border-t-0" style={{ animationDelay: `${delay}ms` } as CSSProperties}>
      <div className="absolute inset-0 flex items-center gap-2 bg-seal pl-12 font-worn text-[15px] tracking-[0.12em] text-cream uppercase" aria-hidden style={{ opacity: Math.min(1, dx / SWIPE_PX) }}>
        Stamp it visited
      </div>
      <div
        className="relative touch-pan-y bg-transparent transition-transform duration-150 ease-out"
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, background: dx ? "var(--page)" : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <PlaceRow
          category={place.category}
          name={
            <>
              {place.isPrivate && <span className="label-ink mr-2 align-[2px] text-[9px] font-bold tracking-[0.1em] [font-family:var(--sans)]">PIN</span>}
              {place.name}
            </>
          }
          meta={
            <span className="inline-flex items-center gap-1.5">
              {!mine && <StatusDot kind="friend" small />}
              {mine && <span className="visually-hidden">{STATUS_LABELS[status]}. </span>}
              {meta}
            </span>
          }
          dish={place.signatureDish}
          current={selected}
          onOpen={() => onSelect(place.id)}
          action={
            visitedByMe ? (
              <Seal date={sealDate(myStatus?.updatedAt ?? item.addedAt)} tilt={TILTS[index % TILTS.length] ?? "-8deg"} />
            ) : (
              <MarkVisited placeName={place.name} onClick={() => onSetStatus(place.id, "visited")} />
            )
          }
        />
        {stamped && (
          <span className="hand pop pointer-events-none absolute top-1.5 right-16 text-[15px] text-seal [--r:-6deg]" aria-hidden>
            stamped!
          </span>
        )}
      </div>
    </li>
  );
}

/** Seals go on by hand, so each one sits at its own angle. */
const TILTS = ["-9deg", "6deg", "-4deg", "10deg", "-12deg"];
