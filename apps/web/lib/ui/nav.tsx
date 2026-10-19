"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./icon";
import type { IconName } from "./icon-paths";
import { buttonClass } from "./button";
import s from "./ui.module.css";

/** A top-level destination. Phones and desktops list different sets. */
export type NavKey = "map" | "list" | "inbox" | "you" | "groups" | "devices" | "admin";

interface Item {
  key: NavKey;
  href: string;
  label: string;
  icon: IconName;
}

const PHONE_TABS: Item[] = [
  { key: "map", href: "/", label: "Map", icon: "map" },
  { key: "list", href: "/?view=list", label: "List", icon: "list" },
  { key: "inbox", href: "/inbox", label: "Inbox", icon: "inbox" },
  { key: "you", href: "/profile", label: "You", icon: "user" },
];

const DESKTOP_NAV: Item[] = [
  { key: "map", href: "/", label: "Places", icon: "map" },
  { key: "inbox", href: "/inbox", label: "Inbox", icon: "inbox" },
  { key: "groups", href: "/groups", label: "Groups", icon: "users" },
  { key: "devices", href: "/devices", label: "Devices", icon: "phone" },
  { key: "admin", href: "/admin", label: "Admin", icon: "shield" },
];

/** Screens reached from You on a phone light up You there. */
const PHONE_KEY: Record<NavKey, NavKey> = { map: "map", list: "list", inbox: "inbox", you: "you", groups: "you", devices: "you", admin: "you" };
/** On a desktop the list and map are one screen, and You is Devices. */
const DESKTOP_KEY: Record<NavKey, NavKey> = { map: "map", list: "map", inbox: "inbox", you: "devices", groups: "groups", devices: "devices", admin: "admin" };

export interface NavProps {
  current: NavKey;
  /** Inbox items that need the person (picks, failed lookups). */
  inboxCount?: number | undefined;
  /** Inbox items only waiting on a lookup, shown as a quiet count. */
  inboxWaiting?: number | undefined;
  /** Shows Admin on desktop. */
  isAdmin?: boolean | undefined;
  /** The line under the wordmark, such as "Snehil · admin". */
  who?: string | undefined;
}

function Count({ count, waiting }: { count?: number | undefined; waiting?: number | undefined }) {
  if (count) return <span className={s.count}>{count}</span>;
  if (waiting) return <span className={`${s.count} ${s.quiet}`}>{waiting}</span>;
  return null;
}

function inboxLabel(count: number | undefined, waiting: number | undefined): string {
  return count ? `Inbox, ${count} to check` : waiting ? `Inbox, ${waiting} being looked up` : "Inbox";
}

/** Bottom tab bar for phones, with Add in the middle. */
export function TabBar({ current, inboxCount, inboxWaiting }: NavProps) {
  const cur = PHONE_KEY[current];
  const tab = (it: Item) => (
    <Link
      key={it.key}
      href={it.href}
      className={s.tab}
      aria-current={cur === it.key ? "page" : undefined}
      aria-label={it.key === "inbox" ? inboxLabel(inboxCount, inboxWaiting) : undefined}
    >
      <Icon name={it.icon} size="l" />
      {it.label}
      {it.key === "inbox" && <Count count={inboxCount} waiting={inboxWaiting} />}
    </Link>
  );
  return (
    <nav className={s.tabbar} aria-label="Main">
      {PHONE_TABS.slice(0, 2).map(tab)}
      <Link href="/add" className={s.add} aria-label="Add a place">
        <Icon name="plus" size="l" />
      </Link>
      {PHONE_TABS.slice(2).map(tab)}
    </nav>
  );
}

/** Left sidebar for wide screens. */
export function SideNav({ current, inboxCount, inboxWaiting, isAdmin = false, who }: NavProps) {
  const cur = DESKTOP_KEY[current];
  return (
    <aside className={s.side}>
      <div className={s.wordmark}>
        Mumbai Places Diary
        {who && <small>{who}</small>}
      </div>
      <Link href="/add" className={buttonClass({ size: "m" }, s.sideAdd)}>
        <Icon name="plus" size="m" />
        Add a place
      </Link>
      <nav aria-label="Main">
        {DESKTOP_NAV.filter((it) => it.key !== "admin" || isAdmin).map((it) => (
          <Link
            key={it.key}
            href={it.href}
            className={s.nav}
            aria-current={cur === it.key ? "page" : undefined}
            aria-label={it.key === "inbox" ? inboxLabel(inboxCount, inboxWaiting) : undefined}
          >
            <Icon name={it.icon} size="m" />
            {it.label}
            {it.key === "inbox" && <Count count={inboxCount} waiting={inboxWaiting} />}
          </Link>
        ))}
      </nav>
      <span className={s.navEnd} />
    </aside>
  );
}

/**
 * Page frame: the sidebar beside the content from 900px up, the tab bar under it below that.
 * Pages render their own heading and content as children.
 */
export function AppShell({ children, ...nav }: NavProps & { children: ReactNode }) {
  return (
    <div className={s.shell}>
      <SideNav {...nav} />
      <div className={s.shellMain}>{children}</div>
      <TabBar {...nav} />
    </div>
  );
}
