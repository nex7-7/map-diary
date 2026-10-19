"use client";

import { DiaryShell } from "@/app/_shell/diary-shell";
import { useHashId } from "@/app/_entries/use-items";
import { DeviceGate } from "@/lib/device";
import { PlaceView } from "./place-view";

/** `/place#<id>`: the id stays in the fragment, so the server never learns which place is open. */
export function PlacePage() {
  const id = useHashId();
  return id ? (
    <DeviceGate>
      {(diary) => (
        <DiaryShell diary={diary} current="list">
          <PlaceView key={id} diary={diary} placeId={id} />
        </DiaryShell>
      )}
    </DeviceGate>
  ) : null;
}
