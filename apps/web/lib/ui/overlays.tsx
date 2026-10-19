"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "./icon";
import type { IconName } from "./icon-paths";
import s from "./overlays.module.css";

/**
 * A modal sheet: slides up from the bottom on phones, a centred dialog on desktop. Uses the
 * native dialog, so focus stays inside and Escape closes it.
 */
export function Sheet({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={s.sheet}
      aria-label={label}
      onClose={onClose}
      onClick={(e) => {
        // A tap on the backdrop lands on the dialog itself.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <div className={s.sheetBody}>
          <span className={s.grab} aria-hidden />
          {children}
        </div>
      )}
    </dialog>
  );
}

/** A close button for the top of a sheet. */
export function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className={s.iconButton} onClick={onClick} aria-label="Close">
      <Icon name="x" size="l" />
    </button>
  );
}

export interface MenuItem {
  label: string;
  icon: IconName;
  danger?: boolean;
  onSelect: () => void;
}

/** A ⋯ button that opens a short list of actions. */
export function MoreMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    wrap.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className={s.menuWrap} ref={wrap}>
      <button
        type="button"
        className={s.roundButton}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="more" size="m" />
      </button>
      {open && (
        <div className={s.menu} role="menu" id={id}>
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={it.danger ? s.danger : undefined}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
            >
              <Icon name={it.icon} size="m" />
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A secret or link in a dark box; tapping copies it. */
export function CopyCode({ value, shown, label }: { value: string; shown?: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={s.code}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      onClick={() =>
        void navigator.clipboard?.writeText(value).then(
          () => setCopied(true),
          () => undefined,
        )
      }
    >
      <span>{shown ?? value}</span>
      <Icon name={copied ? "check" : "copy"} size="m" />
    </button>
  );
}

/** Two or three options in one pill. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className={s.seg} role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}
