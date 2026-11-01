"use client";

import { useState, type KeyboardEvent } from "react";
import { buttonClass, CloseButton, Icon, Sheet } from "@/lib/ui";
import d from "./redate.module.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FIRST_YEAR = 1950;

interface Day {
  y: number;
  m: number;
  d: number;
}

const daysIn = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
const toDay = (ms: number): Day => {
  const t = new Date(ms);
  return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
};
const key = (x: Day) => x.y * 10000 + x.m * 100 + x.d;
/** Noon of the day on this device, so it reads as the same day here. */
const noon = (x: Day) => new Date(x.y, x.m, x.d, 12).getTime();

/** Keeps a day real (no 31 Feb) and not after today. */
function fit(x: Day, today: Day): Day {
  const y = Math.min(Math.max(x.y, FIRST_YEAR), today.y);
  const m = y === today.y ? Math.min(x.m, today.m) : x.m;
  const last = y === today.y && m === today.m ? today.d : daysIn(y, m);
  return { y, m, d: Math.min(x.d, last) };
}

/**
 * The Visited seal's date, changed like an office dater: three rubber bands (day, month,
 * year) rolled up or down, then stamped back onto the page.
 */
export function RedateSheet({ open, at, onClose, onSave }: { open: boolean; at: string; onClose: () => void; onSave: (ms: number) => void }) {
  return (
    <Sheet open={open} onClose={onClose} label="Change the day you went">
      {open && <Dater at={at} onClose={onClose} onSave={onSave} />}
    </Sheet>
  );
}

function Dater({ at, onClose, onSave }: { at: string; onClose: () => void; onSave: (ms: number) => void }) {
  const today = toDay(Date.now());
  const start = fit(toDay(Date.parse(at)), today);
  const [day, setDay] = useState(start);
  const [stamping, setStamping] = useState(false);
  const set = (next: Day) => setDay(fit(next, today));

  const roll = (part: keyof Day, by: number) => {
    if (part === "d") {
      const n = daysIn(day.y, day.m);
      set({ ...day, d: ((day.d - 1 + by + n) % n) + 1 });
    } else if (part === "m") {
      set({ ...day, m: (day.m + by + 12) % 12 });
    } else {
      set({ ...day, y: day.y + by });
    }
  };

  const stamp = () => {
    if (key(day) === key(start)) return onClose();
    setStamping(true);
    // Let the seal land before the sheet goes.
    window.setTimeout(() => onSave(noon(day)), 520);
  };

  const yesterday = toDay(Date.now() - 86_400_000);
  const quick = [
    { label: "Today", day: today },
    { label: "Yesterday", day: yesterday },
  ];

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="kicker">Re-ink the stamp</p>
          <h2 className="display text-[30px] leading-none">When did you go?</h2>
        </div>
        <CloseButton onClick={onClose} />
      </div>

      <div className={d.stage}>
        <div
          key={stamping ? "stamped" : "inked"}
          className={`seal ${stamping ? "slam" : ""} ${d.preview} flex-col gap-[4px] [--r:-10deg]`}
          aria-live="polite"
          aria-label={`Visited ${day.d} ${MONTHS[day.m]} ${day.y}`}
        >
          <span className="text-[11px] tracking-[0.18em]">Visited</span>
          <span className="text-[30px]">
            {day.d} {MONTHS[day.m]}
          </span>
          <span className="text-[11px] tracking-[0.18em]">{day.y}</span>
        </div>
        {stamping && <span className={d.splat} aria-hidden />}
      </div>

      <div className={d.dater} role="group" aria-label="Day of the visit">
        <Band label="Day" value={String(day.d)} now={day.d} onRoll={(by) => roll("d", by)} disabled={stamping} />
        <Band label="Month" value={MONTHS[day.m]!} now={day.m + 1} onRoll={(by) => roll("m", by)} disabled={stamping} />
        <Band label="Year" value={String(day.y)} now={day.y} onRoll={(by) => roll("y", by)} disabled={stamping} wide />
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        {quick.map((q) => (
          <button key={q.label} type="button" className={d.chip} aria-pressed={key(q.day) === key(day)} onClick={() => set(q.day)} disabled={stamping}>
            {q.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <button type="button" className={buttonClass({ variant: "ghost" }, "flex-1")} onClick={onClose} disabled={stamping}>
          Cancel
        </button>
        <button type="button" className={buttonClass({}, "flex-[2]")} onClick={stamp} disabled={stamping}>
          {stamping ? "Stamping…" : "Stamp it"}
        </button>
      </div>
    </>
  );
}

/** One rubber band of the dater: roll it up or down, or use the arrow keys on it. */
function Band({ label, value, now, onRoll, disabled, wide }: { label: string; value: string; now: number; onRoll: (by: number) => void; disabled: boolean; wide?: boolean }) {
  const [dir, setDir] = useState<"up" | "down">("up");
  const go = (by: number) => {
    setDir(by > 0 ? "up" : "down");
    onRoll(by);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowUp") go(1);
    else if (e.key === "ArrowDown") go(-1);
    else return;
    e.preventDefault();
  };
  return (
    <div className={`${d.band} ${wide ? d.wide : ""}`}>
      <button type="button" className={d.roll} onClick={() => go(1)} disabled={disabled} aria-label={`Next ${label.toLowerCase()}`}>
        <span className="rotate-180">
          <Icon name="chevronDown" size="m" />
        </span>
      </button>
      <div
        className={d.window}
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuenow={now}
        aria-valuetext={value}
        onKeyDown={onKey}
      >
        <span key={value} className={dir === "up" ? d.rollUp : d.rollDown}>
          {value}
        </span>
      </div>
      <button type="button" className={d.roll} onClick={() => go(-1)} disabled={disabled} aria-label={`Previous ${label.toLowerCase()}`}>
        <Icon name="chevronDown" size="m" />
      </button>
      <span className={d.bandLabel}>{label}</span>
    </div>
  );
}
