"use client";

import type { ReactNode } from "react";
import type { Diary } from "@/lib/device";
import { usePending } from "@/lib/pending";
import { AppShell, type NavKey } from "@/lib/ui";

/**
 * The app frame for a signed-in screen: sidebar on desktop, tab bar on phones, with the
 * Inbox count read from this device's pending lookups.
 */
export function DiaryShell({ diary, current, who, children }: { diary: Diary; current: NavKey; who?: string | undefined; children: ReactNode }) {
  const { items } = usePending(diary);
  // Matches to pick and lookups that failed need the person; waiting ones don't.
  const needsMe = items.filter((i) => i.state.kind === "choose" || i.state.kind === "branch" || i.state.kind === "failed").length;
  const waiting = items.filter((i) => i.state.kind === "unsent" || i.state.kind === "waiting").length;
  const isAdmin = diary.device.isAdmin === true;
  return (
    <AppShell
      current={current}
      inboxCount={needsMe}
      inboxWaiting={waiting}
      isAdmin={isAdmin}
      who={who ? `${who}${isAdmin ? " · admin" : ""}` : isAdmin ? "Admin" : undefined}
    >
      {children}
    </AppShell>
  );
}
