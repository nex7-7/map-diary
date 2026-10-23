"use client";

import { useEffect, type RefObject } from "react";

/**
 * Marks a sideways-scrolling row with `data-more="start" | "end" | "both"` while some of it is
 * out of view, so `.scroll-hint` in ink.css can fade that edge. Phones hide the scrollbar, and
 * without the fade nothing says there is more to swipe to.
 */
export function useScrollHint(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      const start = el.scrollLeft > 1;
      const end = max > 1 && el.scrollLeft < max - 1;
      const more = start && end ? "both" : start ? "start" : end ? "end" : "";
      if (more) el.dataset.more = more;
      else delete el.dataset.more;
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    // The row changes width with the window, and its content with what's in it.
    const resized = new ResizeObserver(update);
    resized.observe(el);
    const changed = new MutationObserver(update);
    changed.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      el.removeEventListener("scroll", update);
      resized.disconnect();
      changed.disconnect();
    };
  }, [ref]);
}
