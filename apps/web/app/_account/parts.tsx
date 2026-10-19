"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { DiaryShell } from "@/app/_shell/diary-shell";
import { DeviceGate, type Diary } from "@/lib/device";
import { Icon, type IconName, type NavKey } from "@/lib/ui";
import s from "./account.module.css";

export { s as accountStyles };

/**
 * A signed-in account screen: the app frame, a back link to You on phones, the page title and
 * its one-line explanation, then `children(diary)`.
 */
export function AccountPage({
  current,
  title,
  sub,
  wide = false,
  back = true,
  children,
}: {
  current: NavKey;
  title: string;
  sub?: string;
  wide?: boolean;
  back?: boolean;
  children: (diary: Diary) => ReactNode;
}) {
  return (
    <DeviceGate>
      {(diary) => (
        <DiaryShell diary={diary} current={current}>
          <main className={`${s.page} ${wide ? s.wide : ""}`}>
            {back && (
              <Link href="/profile" className={s.back}>
                <Icon name="chevronLeft" size="m" />
                You
              </Link>
            )}
            {title && <PageHead title={title} sub={sub} />}
            {children(diary)}
          </main>
        </DiaryShell>
      )}
    </DeviceGate>
  );
}

export function PageHead({ title, sub }: { title: string; sub?: string | undefined }) {
  return (
    <header className={s.head}>
      <h1 className="display">{title}</h1>
      {sub && <p className="sub" style={{ margin: 0 }}>{sub}</p>}
    </header>
  );
}

export function IconTile({ name, tone, large = false }: { name: IconName; tone?: "claude" | "danger"; large?: boolean }) {
  return (
    <span className={[s.iconTile, tone && s[tone], large && s.large].filter(Boolean).join(" ")} aria-hidden>
      <Icon name={name} size={large ? "base" : "m"} />
    </span>
  );
}

/** A round initial in one of four soft colours, picked from the id so a person keeps theirs. */
export function Avatar({ name, id, big = false }: { name: string; id: string; big?: boolean }) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const initial = [...name.trim()][0]?.toUpperCase() ?? "?";
  return (
    <span className={[s.avatar, s[`tone${h % 4}`], big && s.big].filter(Boolean).join(" ")} aria-hidden>
      {initial}
    </span>
  );
}

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
              className={it.danger ? s.dangerText : undefined}
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

/** "18 Oct", or "18 Oct 2025" outside this year. */
export function day(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
  });
}

/** "active now", "seen 2 h ago", "seen yesterday", "seen 12 Oct". */
export function seen(ms: number | null, now = Date.now()): string {
  if (ms === null) return "not used yet";
  const mins = Math.round((now - ms) / 60_000);
  if (mins < 5) return "active now";
  if (mins < 60) return `seen ${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `seen ${hours} h ago`;
  if (hours < 48) return "seen yesterday";
  return `seen ${day(ms)}`;
}
