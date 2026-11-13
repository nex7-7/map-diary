import type { ReactNode } from "react";
import type { Category } from "@/lib/places/types";
import { cn } from "@/lib/utils";
import { Glyph } from "./chips";

interface Props {
  category: Category;
  name: ReactNode;
  /** Who, category, cuisine, distance. */
  meta: ReactNode;
  dish?: { name: string; priceInr: number } | undefined;
  current?: boolean | undefined;
  onOpen: () => void;
  /** The stamp at the end: a <Seal> once visited, a <MarkVisited> slot before. */
  action?: ReactNode | undefined;
}

/** One place on a notebook page: its glyph, name in Redaction, a meta line and the wallet bleeder. */
export function PlaceRow({ category, name, meta, dish, current, onOpen, action }: Props) {
  return (
    <div className={cn("flex min-h-[84px] items-center gap-2 py-2 pr-3.5 pl-12", current && "bg-marker/25")} aria-current={current || undefined}>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={onOpen}>
        <Glyph category={category} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate font-serif text-[18.5px] leading-[1.1]">{name}</span>
          <span className="truncate text-[11.5px] text-ink-3">{meta}</span>
          {dish && (
            <span className="truncate font-print text-[13px] text-ink-2">
              {dish.name} <span className="worn marker">₹{dish.priceInr.toLocaleString("en-IN")}</span>
            </span>
          )}
        </span>
      </button>
      {action}
    </div>
  );
}

/**
 * The inside of a small Visited seal: the day over the month, so a two-digit day never runs
 * past the inner ring. `date` is "13 NOV" (sealDate's form); `size` is the seal's width in px.
 */
export function SealFace({ date, size, label = true }: { date: string; size: number; label?: boolean }) {
  const [day, month] = date.split(" ");
  return (
    <span className="flex flex-col items-center leading-[0.95]" aria-hidden="true">
      {label && <span style={{ fontSize: Math.max(5.5, size * 0.12), letterSpacing: "0.14em" }}>Visited</span>}
      <span style={{ fontSize: size * 0.32 }}>{day}</span>
      <span style={{ fontSize: size * 0.16, letterSpacing: "0.06em" }}>{month}</span>
    </span>
  );
}

/** The Visited seal at the end of a row, with the day it was stamped. */
export function Seal({ date, tilt = "-8deg", size = 50 }: { date: string; tilt?: string; size?: number }) {
  return (
    <span className="seal slam shrink-0" style={{ width: size, height: size, ["--r" as string]: tilt }} role="img" aria-label={`Visited ${date}`}>
      <SealFace date={date} size={size} />
    </span>
  );
}

/** The dashed Want to slot at the end of a row; pressing it stamps the place Visited. */
export function MarkVisited({ placeName, onClick }: { placeName: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="slot size-[50px] shrink-0 bg-transparent text-[8px] leading-[1.2] font-bold tracking-[0.12em] uppercase transition-transform duration-300 ease-spring hover:rotate-[-6deg] hover:border-seal hover:text-seal active:scale-90"
      onClick={onClick}
      aria-label={`Mark ${placeName} visited`}
    >
      Want
      <br />
      to
    </button>
  );
}
