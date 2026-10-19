"use client";

import { useRef, useState, type PointerEvent } from "react";
import { categoryStyle, STATUS_LABELS } from "@/lib/places/categories";
import { formatDistance, type ListedPlace } from "@/lib/places/filter";
import type { DiarySnapshot, Status } from "@/lib/places/types";
import { Icon, MarkVisited, PlaceRow } from "@/lib/ui";

interface Props {
  listed: readonly ListedPlace[];
  snapshot: DiarySnapshot;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSetStatus: (id: string, status: Status) => void;
}

export function PlacesList({ listed, snapshot, selectedId, onSelect, onSetStatus }: Props) {
  if (listed.length === 0) return <p className="empty sub">Nothing matches these filters.</p>;
  return (
    <ul className="places" aria-label="Places">
      {listed.map((l) => (
        <SwipeRow key={l.place.id} item={l} snapshot={snapshot} selected={l.place.id === selectedId} onSelect={onSelect} onSetStatus={onSetStatus} />
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

/** A place row; swipe it right to mark it visited. */
function SwipeRow({ item, snapshot, selected, onSelect, onSetStatus }: { item: ListedPlace; selected: boolean } & Omit<Props, "listed" | "selectedId">) {
  const { place, status, mine, distanceM } = item;
  const style = categoryStyle(place.category);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const [dx, setDx] = useState(0);
  const visitedByMe = mine && status === "visited";

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

  const meta = [friendLine(item, snapshot), style.label, place.cuisine, distanceM !== undefined ? formatDistance(distanceM) : undefined]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="place-row">
      <div className="swipe-hint" aria-hidden style={{ opacity: Math.min(1, dx / SWIPE_PX) }}>
        <Icon name="check" />
        Visited
      </div>
      <div
        className="place-row-body"
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <PlaceRow
          emoji={style.emoji}
          name={
            <>
              {place.name}
              {place.isPrivate && <span className="pin-badge">Pin</span>}
            </>
          }
          kind={mine ? status : "friend"}
          meta={
            <>
              {mine && <span className="visually-hidden">{STATUS_LABELS[status]}. </span>}
              {meta}
            </>
          }
          dish={place.signatureDish}
          current={selected}
          onOpen={() => onSelect(place.id)}
          action={!visitedByMe ? <MarkVisited placeName={place.name} onClick={() => onSetStatus(place.id, "visited")} /> : undefined}
        />
      </div>
    </li>
  );
}
