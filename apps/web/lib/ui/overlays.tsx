"use client";

import { useState, type ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";
import type { IconName } from "./icon-paths";

/**
 * The last few elements focused outside a sheet, newest last. A sheet is often opened from a
 * menu item that is gone by the time it closes, so closing hands focus back to the newest one
 * still on the page (usually the menu's button) rather than letting it fall to the page top.
 */
const focusTrail: HTMLElement[] = [];
if (typeof document !== "undefined") {
  document.addEventListener(
    "focusin",
    (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || el.closest('[role="dialog"]')) return;
      const i = focusTrail.indexOf(el);
      if (i >= 0) focusTrail.splice(i, 1);
      focusTrail.push(el);
      if (focusTrail.length > 12) focusTrail.shift();
    },
    true,
  );
}

function returnFocus(e: Event) {
  for (let i = focusTrail.length - 1; i >= 0; i--) {
    const el = focusTrail[i];
    if (el?.isConnected && el.getClientRects().length > 0) {
      e.preventDefault();
      el.focus({ preventScroll: true });
      return;
    }
  }
}

/**
 * A modal sheet of paper: it slides up from the bottom on phones with a scalloped top edge,
 * and is a centred card on desktop. Focus stays inside; Escape or the backdrop closes it, and
 * focus goes back to what opened it.
 */
export function Sheet({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/40 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onCloseAutoFocus={returnFocus}
          className={cn(
            "lift fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] outline-none",
            "data-[state=open]:animate-[sheetUp_0.55s_var(--ease-page)_both] data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom",
            "min-[900px]:inset-x-auto min-[900px]:bottom-auto min-[900px]:top-1/2 min-[900px]:left-1/2 min-[900px]:w-[min(34rem,calc(100vw-4rem))] min-[900px]:-translate-x-1/2 min-[900px]:-translate-y-1/2",
            "min-[900px]:data-[state=open]:animate-in min-[900px]:data-[state=open]:fade-in-0 min-[900px]:data-[state=open]:zoom-in-95",
          )}
        >
          <DialogPrimitive.Title className="visually-hidden">{label}</DialogPrimitive.Title>
          <div className="page scalloped flex max-h-[92dvh] flex-col gap-4 overflow-y-auto px-5 pb-[max(24px,env(safe-area-inset-bottom))] [--pad-top:14px] min-[900px]:rounded-b-[22px]">
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** A close button for the top of a sheet. */
export function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="grid size-10 shrink-0 place-items-center rounded-full border-[1.5px] border-ink bg-page shadow-[0_2px_0_var(--ink)] transition-transform active:translate-y-0.5"
      onClick={onClick}
      aria-label="Close"
    >
      <Icon name="x" size="m" />
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
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="grid size-9 shrink-0 place-items-center rounded-full border-[1.5px] border-rule-ink bg-page text-ink-2 hover:border-ink hover:text-ink data-[state=open]:border-ink"
        aria-label={label}
      >
        <Icon name="more" size="m" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((it) => (
          <DropdownMenuItem key={it.label} variant={it.danger ? "destructive" : "default"} onSelect={it.onSelect}>
            <Icon name={it.icon} size="m" />
            {it.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface PickOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

/**
 * A select drawn in the app's own style: the trigger looks like whatever `className` makes
 * it (a chip, a text link) and the choices open in a small paper menu.
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
  const current = options.find((o) => o.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn("chip", className)} aria-label={`${label}: ${current?.label ?? ""}`}>
        {current?.label}
        <Icon name="chevronDown" size="s" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align === "left" ? "start" : "end"} aria-label={label}>
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => v !== value && onChange(v as T)}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A secret or link on an inked slip; tapping copies it. */
export function CopyCode({ value, shown, label }: { value: string; shown?: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-[12px] border-[1.5px] border-ink bg-ink px-3.5 py-3 text-left font-mono text-[13px] break-all text-page shadow-[0_3px_0_var(--seal)] active:translate-y-0.5"
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      onClick={() =>
        void navigator.clipboard?.writeText(value).then(
          () => setCopied(true),
          () => undefined,
        )
      }
    >
      <span className="min-w-0 flex-1">{shown ?? value}</span>
      <Icon name={copied ? "check" : "copy"} size="m" />
    </button>
  );
}

/** Two or three options as chips; one is always chosen. */
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
    <ToggleGroup type="single" aria-label={label} value={value} onValueChange={(v) => v && onChange(v as T)}>
      {options.map(([v, text]) => (
        <ToggleGroupItem key={v} value={v}>
          {text}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
