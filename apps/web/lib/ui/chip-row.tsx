"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A horizontally scrolling row of chips. A mouse wheel scrolls it sideways too, since a
 * desktop mouse has no sideways scroll; at either end the wheel scrolls the page as usual.
 */
export function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      const max = el.scrollWidth - el.clientWidth;
      const room = e.deltaY > 0 ? el.scrollLeft < max - 1 : el.scrollLeft > 0;
      if (max <= 0 || !room) return;
      e.preventDefault();
      el.scrollLeft += e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 16 : e.deltaY;
    };
    // Not passive, so the page doesn't scroll as well.
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  return (
    <div ref={row} className="flex gap-2 overflow-x-auto pt-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label={label}>
      {children}
    </div>
  );
}
