"use client";

import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { DiaryShell } from "@/app/_shell/diary-shell";
import { DeviceGate, type Diary } from "@/lib/device";
import { createItemsSource } from "@/lib/places/items-source";
import { DiaryView, type DiaryViewMode } from "./diary-view";

/** `?view=list` shows the list on a phone; the map is the default. */
export function useViewMode(): DiaryViewMode {
  return useSearchParams().get("view") === "list" ? "list" : "map";
}

/** The diary over this device's decrypted items, once it is signed in. */
export function DeviceDiary() {
  const view = useViewMode();
  return (
    <DeviceGate>
      {(diary) => <SignedIn diary={diary} view={view} />}
    </DeviceGate>
  );
}

function SignedIn({ diary, view }: { diary: Diary; view: DiaryViewMode }) {
  const source = useMemo(() => createItemsSource(diary), [diary]);
  return (
    <DiaryShell diary={diary} current={view}>
      <DiaryView source={source} view={view} />
    </DiaryShell>
  );
}
