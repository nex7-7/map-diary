import type { ReactNode } from "react";
import { STATUS_LABELS } from "@/lib/places/categories";
import type { BoardKind, Status } from "@/lib/places/types";
import { Icon } from "./icon";
import s from "./ui.module.css";

/** What a pin or dot stands for: my status, a friend's, or a place still being looked up. */
export type PinKind = Status | "friend" | "pending";

export function StatusDot({ kind, small = false }: { kind: PinKind; small?: boolean }) {
  return <span className={[s.dot, s[kind], small && s.small].filter(Boolean).join(" ")} aria-hidden />;
}

/** One toggle in a filter row. */
export function FilterChip({
  on,
  onClick,
  title,
  children,
}: {
  on: boolean;
  onClick: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button type="button" className={s.chip} aria-pressed={on} onClick={onClick} title={title}>
      {children}
    </button>
  );
}

/** A horizontally scrolling row of chips. */
export function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={s.chips} role="group" aria-label={label}>
      {children}
    </div>
  );
}

/** Want to or Visited, as a pressable pill. */
export function StatusChip({ status, on, onClick, disabled }: { status: Status; on: boolean; onClick?: () => void; disabled?: boolean }) {
  return (
    <button type="button" className={`${s.status} ${s[status]}`} aria-pressed={on} onClick={onClick} disabled={disabled}>
      <StatusDot kind={status} />
      {STATUS_LABELS[status]}
    </button>
  );
}

/** The Want to / Visited pair; `value` is the person's current status, if any. */
export function StatusChips({ value, onChange, label = "Your status" }: { value: Status | undefined; onChange: (s: Status) => void; label?: string }) {
  return (
    <div className={s.statusGroup} role="group" aria-label={label}>
      {(["want", "visited"] as const).map((st) => (
        <StatusChip key={st} status={st} on={value === st} onClick={() => onChange(st)} />
      ))}
    </div>
  );
}

const BOARD_ICONS = { personal: "lock", master: "globe", group: "users" } as const;
const BOARD_CLASS = { personal: s.personal, master: s.public, group: s.group } as const;

/** Which board an item is on: grey Personal, sea-blue Public, plum for groups. */
export function BoardBadge({ kind, name }: { kind: BoardKind; name: string }) {
  return (
    <span className={`${s.badge} ${BOARD_CLASS[kind]}`}>
      <Icon name={BOARD_ICONS[kind]} size="s" />
      {name}
    </span>
  );
}

/** A small coloured label that isn't a board: "This device", "Admin", "Snehil via Claude". */
export function Badge({ tone, children }: { tone: "ok" | "claude" | "warn" | "personal"; children: ReactNode }) {
  return <span className={`${s.badge} ${s[tone]}`}>{children}</span>;
}

/** The map marker: a status-coloured disc around the category emoji. */
export function Pin({ kind, emoji, large = false }: { kind: PinKind; emoji: string; large?: boolean }) {
  return (
    <span className={[s.pin, s[kind], large && s.large].filter(Boolean).join(" ")} aria-hidden>
      {emoji}
    </span>
  );
}

/** A rounded square holding an emoji: a place's category, or a device kind. */
export function Tile({ children }: { children: ReactNode }) {
  return (
    <span className={s.tile} aria-hidden>
      {children}
    </span>
  );
}
