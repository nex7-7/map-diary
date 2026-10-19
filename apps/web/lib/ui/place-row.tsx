import type { ReactNode } from "react";
import { Icon } from "./icon";
import { StatusDot, Tile, type PinKind } from "./chips";
import s from "./ui.module.css";

interface Props {
  emoji: string;
  name: ReactNode;
  /** Shown after the status dot: who, category, cuisine, distance. */
  meta: ReactNode;
  kind?: PinKind | undefined;
  dish?: { name: string; priceInr: number } | undefined;
  current?: boolean | undefined;
  onOpen: () => void;
  /** A trailing control, such as <MarkVisited>. */
  action?: ReactNode | undefined;
}

/** One place in a list: emoji tile, name, a status line and the wallet bleeder. */
export function PlaceRow({ emoji, name, meta, kind, dish, current, onOpen, action }: Props) {
  return (
    <div className={s.row} aria-current={current || undefined}>
      <button type="button" className={s.rowMain} onClick={onOpen}>
        <Tile>{emoji}</Tile>
        <span className={s.rowText}>
          <span className={s.rowName}>{name}</span>
          <span className={s.rowMeta}>
            {kind && <StatusDot kind={kind} small />}
            {meta}
          </span>
          {dish && (
            <span className={s.rowDish}>
              {dish.name} <strong>₹{dish.priceInr.toLocaleString("en-IN")}</strong>
            </span>
          )}
        </span>
      </button>
      {action && <span className={s.rowAction}>{action}</span>}
    </div>
  );
}

/** The round tick at the end of a Want to row. */
export function MarkVisited({ placeName, onClick }: { placeName: string; onClick: () => void }) {
  return (
    <button type="button" className={s.markVisited} onClick={onClick} aria-label={`Mark ${placeName} visited`}>
      <Icon name="check" size="m" />
    </button>
  );
}
