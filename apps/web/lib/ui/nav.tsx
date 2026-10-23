"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";
import type { IconName } from "./icon-paths";

/** A top-level destination. Phones and desktops list different sets. */
export type NavKey = "map" | "list" | "boards" | "inbox" | "you" | "groups" | "devices" | "admin";

interface Item {
  key: NavKey;
  href: string;
  label: string;
  icon: IconName;
}

const PHONE_TABS: Item[] = [
  { key: "map", href: "/", label: "Map", icon: "mapFold" },
  { key: "list", href: "/?view=list", label: "Places", icon: "notebook" },
  { key: "boards", href: "/boards", label: "Boards", icon: "pinboard" },
  { key: "inbox", href: "/inbox", label: "Inbox", icon: "envelope" },
];

const DESKTOP_NAV: Item[] = [
  { key: "map", href: "/", label: "Places", icon: "notebook" },
  { key: "boards", href: "/boards", label: "Boards", icon: "pinboard" },
  { key: "groups", href: "/groups", label: "Groups", icon: "users" },
  { key: "inbox", href: "/inbox", label: "Inbox", icon: "envelope" },
  { key: "you", href: "/profile", label: "You", icon: "user" },
];

/** You, Devices and Admin are reached from your initial at the top, so no tab lights up for them. */
const PHONE_KEY: Record<NavKey, NavKey | undefined> = { map: "map", list: "list", boards: "boards", groups: "boards", inbox: "inbox", you: undefined, devices: undefined, admin: undefined };
/** On a desktop the list and map are one screen, and Devices and Admin sit inside You. */
const DESKTOP_KEY: Record<NavKey, NavKey> = { map: "map", list: "map", boards: "boards", groups: "groups", inbox: "inbox", you: "you", devices: "you", admin: "you" };

export interface NavProps {
  current: NavKey;
  /** Inbox items that need the person (picks, failed lookups). */
  inboxCount?: number | undefined;
  /** Inbox items only waiting on a lookup, shown as a quiet count. */
  inboxWaiting?: number | undefined;
  /** Shows the admin mark on desktop. */
  isAdmin?: boolean | undefined;
  /** The line under the wordmark, such as "Snehil · admin". */
  who?: string | undefined;
}

function Count({ count, waiting }: { count?: number | undefined; waiting?: number | undefined }) {
  if (count) return <span className="nav-badge">{count}</span>;
  if (waiting) return <span className="nav-badge quiet">{waiting}</span>;
  return null;
}

function inboxLabel(count: number | undefined, waiting: number | undefined): string {
  return count ? `Inbox, ${count} to check` : waiting ? `Inbox, ${waiting} being looked up` : "Inbox";
}

/** The pencil circle drawn round the current page's tab. */
function Ring() {
  return (
    <svg className="pencil-ring" viewBox="0 0 74 56" aria-hidden>
      <path d="M40 4C58 4 71 13 70 28 69 44 54 53 36 52 18 51 4 42 5 27 6 13 20 4 38 4c8 0 14 2 18 5" />
    </svg>
  );
}

/** The red seal that adds a place, pressed on slightly askew. */
export function AddSeal({ className }: { className?: string }) {
  return (
    <Link href="/add" className={cn("bseal", className)} aria-label="Add a place">
      <span className="imp">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
      </span>
      Add
    </Link>
  );
}

/** Phones: a paper strip at the foot of the book, with the Add seal in the middle. */
export function TabBar({ current, inboxCount, inboxWaiting }: NavProps) {
  const cur = PHONE_KEY[current];
  const tab = (it: Item) => (
    <Link
      key={it.key}
      href={it.href}
      className="bitem"
      aria-current={cur === it.key ? "page" : undefined}
      aria-label={it.key === "inbox" ? inboxLabel(inboxCount, inboxWaiting) : undefined}
    >
      {cur === it.key && <Ring key={`${it.key}-ring`} />}
      <Icon name={it.icon} size="l" />
      {it.label}
      {it.key === "inbox" && <Count count={inboxCount} waiting={inboxWaiting} />}
    </Link>
  );
  return (
    <nav className="booknav min-[900px]:hidden" aria-label="Main">
      {PHONE_TABS.slice(0, 2).map(tab)}
      <AddSeal />
      {PHONE_TABS.slice(2).map(tab)}
    </nav>
  );
}

/** Wide screens: the book's first page down the left, with the Add seal under the title. */
export function SideNav({ current, inboxCount, inboxWaiting, isAdmin = false, who }: NavProps) {
  const cur = DESKTOP_KEY[current];
  return (
    <aside className="page sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col gap-6 overflow-y-auto px-5 pt-7 pb-6 shadow-[1px_0_0_rgb(32_31_27/0.28),3px_0_0_var(--page),4px_0_0_rgb(32_31_27/0.14),6px_0_0_var(--page),7px_0_0_rgb(32_31_27/0.08)] min-[900px]:flex">
      <div>
        <p className="kicker">Mumbai</p>
        <p className="mt-1 font-serif text-[30px] leading-none tracking-[-0.02em]">
          Places <em>diary</em>
        </p>
        {who && <p className="hand mt-2 text-[15px] text-ink-2">{who}</p>}
      </div>
      <Link href="/add" className="chip h-11 w-full justify-center gap-2 border-2 bg-seal text-[15px] text-cream shadow-[0_4px_0_var(--ink)] [transform:rotate(-1.5deg)] active:translate-y-[3px] active:shadow-[0_1px_0_var(--ink)]">
        <Icon name="plus" size="m" />
        Add a place
      </Link>
      <nav aria-label="Main" className="flex flex-col gap-1">
        {DESKTOP_NAV.map((it) => {
          const on = cur === it.key;
          return (
            <Link
              key={it.key}
              href={it.href}
              className={cn(
                "relative flex items-center gap-3 rounded-[10px] px-3 py-2.5 font-serif text-[18px] text-ink-3 no-underline transition-colors hover:bg-paper-deep/60 hover:text-ink",
                on && "text-ink italic",
              )}
              aria-current={on ? "page" : undefined}
              aria-label={it.key === "inbox" ? inboxLabel(inboxCount, inboxWaiting) : undefined}
            >
              <Icon name={it.icon} size="l" />
              <span className="relative">
                {it.label}
                {on && (
                  <svg className="absolute -bottom-2 left-[-4px] h-3 w-[calc(100%+8px)] overflow-visible" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden>
                    <path d="M2 8c20-5 45-6 70-3 10 1 18 2 26-2" className="draw-path" fill="none" stroke="var(--seal)" strokeWidth="2.2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                  </svg>
                )}
              </span>
              {it.key === "inbox" && (
                <span className="ml-auto">
                  {inboxCount ? (
                    <span className="grid h-5 min-w-5 place-items-center rounded-full bg-seal px-1.5 font-sans text-[11px] font-bold text-cream not-italic">{inboxCount}</span>
                  ) : inboxWaiting ? (
                    <span className="grid h-5 min-w-5 place-items-center rounded-full bg-graphite px-1.5 font-sans text-[11px] font-bold text-cream not-italic">{inboxWaiting}</span>
                  ) : null}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

/**
 * Page frame: the first page of the book beside the content from 900px up, the paper strip
 * under it below that. Pages render their own heading and content as children.
 */
export function AppShell({ children, ...nav }: NavProps & { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <SideNav {...nav} />
      <div className="min-w-0 flex-1 pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] min-[900px]:pb-0">{children}</div>
      <TabBar {...nav} />
    </div>
  );
}
