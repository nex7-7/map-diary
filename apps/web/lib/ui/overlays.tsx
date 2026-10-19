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

export interface PickOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

/**
 * A select drawn in the app's own style: the trigger looks like whatever `className` makes
 * it (a chip, a text link) and the choices open in a small menu, not the browser's list.
 * The menu is fixed to the screen so a scrolling chip row can't clip it.
 */
export function Picker<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
  align = "left",
}: {
  label: string;
  value: T;
  options: readonly PickOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  align?: "left" | "right";
}) {
  const [at, setAt] = useState<{ top: number; left?: number; right?: number } | null>(null);
  const open = at !== null;
  const wrap = useRef<HTMLDivElement>(null);
  const id = useId();
  const toggle = () => {
    const r = wrap.current?.getBoundingClientRect();
    if (open || !r) return setAt(null);
    setAt(align === "left" ? { top: r.bottom + 6, left: r.left } : { top: r.bottom + 6, right: window.innerWidth - r.right });
  };
  useEffect(() => {
    if (!open) return;
    const close = () => setAt(null);
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close();
      wrap.current?.querySelector<HTMLButtonElement>("button")?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    // The menu is pinned where it opened, so it closes rather than drift when things move.
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    wrap.current?.querySelector<HTMLButtonElement>("[role=option][aria-selected=true]")?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);
  const current = options.find((o) => o.value === value);
  return (
    <div className={s.menuWrap} ref={wrap}>
      <button
        type="button"
        className={`${s.pickButton}${className ? ` ${className}` : ""}`}
        aria-label={`${label}: ${current?.label ?? ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={toggle}
      >
        {current?.label}
        <Icon name="chevronDown" size="s" />
      </button>
      {open && (
        <div
          className={`${s.menu} ${s.pickMenu}`}
          style={at}
          role="listbox"
          id={id}
          aria-label={label}
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const items = [...(wrap.current?.querySelectorAll<HTMLButtonElement>("[role=option]:not(:disabled)") ?? [])];
            const i = items.indexOf(document.activeElement as HTMLButtonElement);
            items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus({ preventScroll: true });
          }}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              disabled={o.disabled}
              onClick={() => {
                setAt(null);
                if (o.value !== value) onChange(o.value);
              }}
            >
              <span>{o.label}</span>
              {o.value === value && <Icon name="check" size="m" />}
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
