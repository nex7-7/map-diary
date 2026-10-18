"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AddForm, type AddInitial } from "@/app/_entries/add-form";
import styles from "@/app/_entries/entries.module.css";
import { parseCoordinates } from "@/lib/entries/parse-input";
import { DeviceGate } from "@/lib/device";

/**
 * `/add`, optionally with what to add in the fragment, which the browser never sends to the
 * server: `#text=<shared text or link>` or `#pin=<lat>,<lng>` (a pin dropped on the map).
 */
function readFragment(): AddInitial {
  const params = new URLSearchParams(location.hash.slice(1));
  const initial: AddInitial = {};
  const text = params.get("text");
  if (text) initial.text = text;
  const pin = parseCoordinates(params.get("pin") ?? "");
  if (pin) initial.location = pin;
  return initial;
}

export function AddPage() {
  const router = useRouter();
  const [initial, setInitial] = useState<AddInitial | null>(null);
  useEffect(() => setInitial(readFragment()), []);

  return (
    <main>
      <div className={styles.row} style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <Link href="/" className={styles.back}>
          ← Diary
        </Link>
      </div>
      <h1 className={styles.title} style={{ marginBottom: 16 }}>
        Add a place
      </h1>
      {initial && (
        <DeviceGate>
          {(diary) => (
            <AddForm diary={diary} initial={initial} onSaved={(id) => router.push(`/place#${id}`)} onCancel={() => router.push("/")} />
          )}
        </DeviceGate>
      )}
    </main>
  );
}
