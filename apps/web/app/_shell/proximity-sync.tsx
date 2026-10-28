"use client";

import { useEffect, useMemo, useRef } from "react";
import { useItems } from "@/app/_entries/use-items";
import type { Diary } from "@/lib/device";
import { proximity } from "@/lib/android/bridge";
import { alertPlaces } from "@/lib/android/proximity";

/**
 * In the Android app, keeps the phone's copy of my Want to places current, so nearby alerts
 * work while the app is closed. Elsewhere it renders nothing and reads nothing.
 */
export function ProximitySync({ diary }: { diary: Diary }) {
  return proximity() ? <Sync diary={diary} /> : null;
}

function Sync({ diary }: { diary: Diary }) {
  const { loaded, snapshot } = useItems(diary);
  const places = useMemo(() => alertPlaces(snapshot, diary.device.accountId), [snapshot, diary]);
  const sent = useRef<string | null>(null);
  useEffect(() => {
    const plugin = proximity();
    if (!plugin || !loaded) return;
    const key = JSON.stringify(places);
    if (key === sent.current) return;
    sent.current = key;
    // A failure leaves the phone's last list in place; the next change or app start tries again.
    plugin.setPlaces({ places }).catch(() => {
      sent.current = null;
    });
  }, [loaded, places]);
  return null;
}
