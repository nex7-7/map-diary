"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { DiaryShell } from "@/app/_shell/diary-shell";
import { DeviceGate, type Diary } from "@/lib/device";
import type { AvatarPayload } from "@/lib/places/payloads";
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

/**
 * A person's picture: their photo, their emoji on its colour, or their initial on one of four
 * soft colours picked from the id so a person keeps theirs.
 */
export function Avatar({ name, id, avatar, big = false, small = false }: { name: string; id: string; avatar?: AvatarPayload | undefined; big?: boolean; small?: boolean }) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const tone = avatar?.kind === "emoji" ? avatar.tone : h % 4;
  const cls = [s.avatar, s[`tone${tone}`], big && s.big, small && s.small, avatar?.kind === "emoji" && s.emoji].filter(Boolean).join(" ");
  if (avatar?.kind === "photo") {
    return <img className={[s.avatar, big && s.big, small && s.small].filter(Boolean).join(" ")} src={avatar.dataUrl} alt="" aria-hidden />;
  }
  const initial = [...name.trim()][0]?.toUpperCase() ?? "?";
  return (
    <span className={cls} aria-hidden>
      {avatar?.kind === "emoji" ? avatar.emoji : initial}
    </span>
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
