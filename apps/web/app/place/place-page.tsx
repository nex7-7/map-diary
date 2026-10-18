"use client";

import Link from "next/link";
import { useHashId } from "@/app/_entries/use-items";
import styles from "@/app/_entries/entries.module.css";
import { DeviceGate } from "@/lib/device";
import { PlaceView } from "./place-view";

/** `/place#<id>`: the id stays in the fragment, so the server never learns which place is open. */
export function PlacePage() {
  const id = useHashId();
  return (
    <main>
      <Link href="/" className={styles.back}>
        ← Diary
      </Link>
      <div style={{ marginTop: 12 }}>
        {id ? <DeviceGate>{(diary) => <PlaceView key={id} diary={diary} placeId={id} />}</DeviceGate> : null}
      </div>
    </main>
  );
}
