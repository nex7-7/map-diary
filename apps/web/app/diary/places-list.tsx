"use client";

import { useRef, useState, type PointerEvent } from "react";
import { categoryStyle, STATUS_LABELS } from "@/lib/places/categories";
import { formatDistance, type ListedPlace } from "@/lib/places/filter";
import type { Status } from "@/lib/places/types";

interface Props {
  listed: readonly ListedPlace[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSetStatus: (id: string, status: Status) => void;
}

export function PlacesList({ listed, selectedId, onSelect, onSetStatus }: Props) {
  if (listed.length === 0) return <p className="empty muted">No places match these filters.</p>;
  return (
    <ul className="places" aria-label="Places">
      {listed.map((l) => (
        <PlaceRow key={l.place.id} item={l} selected={l.place.id === selectedId} onSelect={onSelect} onSetStatus={onSetStatus} />
      ))}
    </ul>
  );
}

const SWIPE_PX = 80;

/** A row; swipe right to mark it visited. */
function PlaceRow({ item, selected, onSelect, onSetStatus }: { item: ListedPlace; selected: boolean } & Omit<Props, "listed" | "selectedId">) {
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

  return (
    <li className="place-row" aria-current={selected || undefined}>
      <div className="swipe-hint" aria-hidden style={{ opacity: Math.min(1, dx / SWIPE_PX) }}>
        ✓ Visited
      </div>
      <div
        className="place-row-body"
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, borderInlineStartColor: style.color }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <button type="button" className="place-main" onClick={() => onSelect(place.id)}>
          <span className="place-name">
            <span aria-hidden>{style.emoji}</span> {place.name}
            {place.isPrivate && <span className="badge">Pin</span>}
          </span>
          <span className="place-meta muted">
            <span className={`dot dot-${status}`} aria-hidden /> {STATUS_LABELS[status]}
            {!mine && " (friends)"}
            {" · "}
            {style.label}
            {place.cuisine && ` · ${place.cuisine}`}
            {distanceM !== undefined && ` · ${formatDistance(distanceM)}`}
          </span>
          {place.signatureDish && (
            <span className="place-dish">
              {place.signatureDish.name} <strong>₹{place.signatureDish.priceInr.toLocaleString("en-IN")}</strong>
            </span>
          )}
        </button>
        {!visitedByMe && (
          <button type="button" className="mark-visited" onClick={() => onSetStatus(place.id, "visited")} aria-label={`Mark ${place.name} visited`}>
            ✓
          </button>
        )}
      </div>
    </li>
  );
}
