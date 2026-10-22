import type { ReactNode } from "react";
import { Badge as Stamp } from "@/components/ui/badge";
import { STATUS_LABELS, categoryStyle } from "@/lib/places/categories";
import type { BoardKind, Category, Status } from "@/lib/places/types";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";

/** What a pin or dot stands for: my status, a friend's, or a place still being looked up. */
export type PinKind = Status | "friend" | "pending";

const DOT: Record<PinKind, string> = {
  visited: "bg-seal",
  want: "border-[1.5px] border-dashed border-graphite",
  friend: "bg-plum",
  pending: "border-[1.5px] border-dashed border-ink-3",
};

/** A tiny stamp: a red seal for Visited, a dashed slot for Want to, plum for a friend's. */
export function StatusDot({ kind, small = false }: { kind: PinKind; small?: boolean }) {
  return <span className={cn("inline-block shrink-0 rounded-full", small ? "size-2" : "size-2.5", DOT[kind])} aria-hidden />;
}

/** One toggle in a filter row. */
export function FilterChip({ on, onClick, title, children }: { on: boolean; onClick: () => void; title?: string; children: ReactNode }) {
  return (
    <button type="button" className="chip" aria-pressed={on} onClick={onClick} title={title}>
      {children}
    </button>
  );
}

/**
 * Want to or Visited, as a stamp you press. Visited is pressed on as a vermilion seal;
 * Want to inks in like any chosen chip.
 */
export function StatusChip({ status, on, onClick, disabled }: { status: Status; on: boolean; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "chip h-10 gap-2 px-4 text-[14px]",
        status === "visited" && on && "slam border-ink bg-seal text-cream [box-shadow:2px_3px_0_var(--ink)] [--r:-2deg]",
      )}
      aria-pressed={on}
      onClick={onClick}
      disabled={disabled}
    >
      {status === "visited" ? (
        <span className={cn("grid size-4 place-items-center rounded-full border-[1.5px]", on ? "border-cream" : "border-seal text-seal")} aria-hidden>
          <Icon name="check" size="s" />
        </span>
      ) : (
        <span className={cn("size-4 rounded-full border-[1.5px] border-dashed", on ? "border-page" : "border-graphite")} aria-hidden />
      )}
      {STATUS_LABELS[status]}
    </button>
  );
}

/** The Want to / Visited pair; `value` is the person's current status, if any. */
export function StatusChips({ value, onChange, label = "Your status" }: { value: Status | undefined; onChange: (s: Status) => void; label?: string }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
      {(["want", "visited"] as const).map((st) => (
        <StatusChip key={st} status={st} on={value === st} onClick={() => onChange(st)} />
      ))}
    </div>
  );
}

const BOARD_ICONS = { personal: "lock", master: "globe", group: "users" } as const;
const BOARD_STAMPS = { personal: "personal", master: "public", group: "group" } as const;

/** Which board an item is on, as a rubber stamp: graphite Personal, indigo Public, plum groups. */
export function BoardBadge({ kind, name }: { kind: BoardKind; name: string }) {
  return (
    <Stamp variant={BOARD_STAMPS[kind]}>
      <Icon name={BOARD_ICONS[kind]} size="s" />
      {name}
    </Stamp>
  );
}

/** A stamp that isn't a board: "This device", "Admin", "Snehil via Claude". */
export function Badge({ tone, children }: { tone: "ok" | "claude" | "warn" | "personal"; children: ReactNode }) {
  return <Stamp variant={tone}>{children}</Stamp>;
}

/** A small marker for a status: a seal or a slot around the category glyph. */
export function Pin({ kind, category, large = false }: { kind: PinKind; category: Category; large?: boolean }) {
  const glyph = categoryStyle(category).glyph;
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full",
        large ? "size-11" : "size-8",
        kind === "visited" && "bg-seal text-cream shadow-[0_0_0_2.5px_var(--page)]",
        kind === "friend" && "bg-plum text-cream shadow-[0_0_0_2.5px_var(--page)]",
        (kind === "want" || kind === "pending") && "border-[1.8px] border-dashed border-graphite bg-page text-graphite",
      )}
      aria-hidden
    >
      <Icon name={glyph} size={large ? "base" : "m"} />
    </span>
  );
}

/** A place's category as a pencil glyph in an inked circle. */
export function Glyph({ category }: { category: Category }) {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-full border-[1.5px] border-ink bg-page text-ink" aria-hidden>
      <Icon name={categoryStyle(category).glyph} size="m" />
    </span>
  );
}

/** An inked circle holding an emoji, such as a device kind. */
export function Tile({ children }: { children: ReactNode }) {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-full border-[1.5px] border-ink bg-page text-[15px]" aria-hidden>
      {children}
    </span>
  );
}
