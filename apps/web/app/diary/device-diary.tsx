"use client";

import Link from "next/link";
import { useMemo } from "react";
import { DeviceGate, type Diary } from "@/lib/device";
import { usePending } from "@/lib/pending";
import { createItemsSource } from "@/lib/places/items-source";
import { DiaryView } from "./diary-view";

/** The diary over this device's decrypted items, once it is signed in. */
export function DeviceDiary() {
  return (
    <DeviceGate>
      {(diary) => <SignedIn diary={diary} />}
    </DeviceGate>
  );
}

function SignedIn({ diary }: { diary: Diary }) {
  const source = useMemo(() => createItemsSource(diary), [diary]);
  const { items } = usePending(diary);
  // Matches to pick and lookups that failed need the person; waiting ones don't.
  const needsMe = items.filter((i) => i.state.kind === "choose" || i.state.kind === "failed").length;
  const waiting = items.filter((i) => i.state.kind === "unsent" || i.state.kind === "waiting").length;
  return (
    <DiaryView
      source={source}
      toolbarExtra={
        <Link href="/inbox" className="inbox-link" aria-label={`Inbox${needsMe ? `, ${needsMe} to check` : waiting ? `, ${waiting} being looked up` : ""}`}>
          <span aria-hidden>📥</span>
          <span className="inbox-label">Inbox</span>
          {needsMe > 0 ? <span className="inbox-count">{needsMe}</span> : waiting > 0 ? <span className="inbox-count quiet">{waiting}</span> : null}
        </Link>
      }
    />
  );
}
