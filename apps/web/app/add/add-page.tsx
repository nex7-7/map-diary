"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { AddForm, type AddInitial } from "@/app/_entries/add-form";
import styles from "@/app/_entries/entries.module.css";
import { parseCoordinates } from "@/lib/entries/parse-input";
import { DeviceGate, type Diary } from "@/lib/device";
import { getPendingQueue, type PendingItem } from "@/lib/pending";

/**
 * `/add`, optionally with what to add in the fragment, which the browser never sends to the
 * server: `#text=<shared text or link>`, `#pin=<lat>,<lng>` (a pin dropped on the map) or
 * `#pending=<id>` (an Inbox item to place by hand).
 */
function readFragment(): AddInitial & { pendingId?: string } {
  const params = new URLSearchParams(location.hash.slice(1));
  const initial: AddInitial & { pendingId?: string } = {};
  const text = params.get("text");
  if (text) initial.text = text;
  const pin = parseCoordinates(params.get("pin") ?? "");
  if (pin) initial.location = pin;
  const pendingId = params.get("pending");
  if (pendingId) initial.pendingId = pendingId;
  return initial;
}

export function AddPage() {
  const router = useRouter();
  const [initial, setInitial] = useState<(AddInitial & { pendingId?: string }) | null>(null);
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
            <WithPending diary={diary} pendingId={initial.pendingId}>
              {(pending) => (
                <AddForm
                  diary={diary}
                  initial={{ ...initial, ...(pending ? { pending } : {}) }}
                  onSaved={(id) => router.push(`/place#${id}`)}
                  onQueued={() => router.push("/inbox")}
                  onCancel={() => router.push(pending ? "/inbox" : "/")}
                />
              )}
            </WithPending>
          )}
        </DeviceGate>
      )}
    </main>
  );
}

/** Loads the Inbox item named in the fragment before the form starts, so it can prefill. */
function WithPending({ diary, pendingId, children }: { diary: Diary; pendingId: string | undefined; children: (p: PendingItem | null) => ReactNode }) {
  const [item, setItem] = useState<PendingItem | null | undefined>(pendingId ? undefined : null);
  useEffect(() => {
    if (!pendingId) return;
    let live = true;
    void getPendingQueue(diary)
      .then((q) => q.list())
      .then((list) => live && setItem(list.find((i) => i.id === pendingId) ?? null));
    return () => {
      live = false;
    };
  }, [diary, pendingId]);
  return item === undefined ? null : <>{children(item)}</>;
}
