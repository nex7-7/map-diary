"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { AddForm, type AddInitial } from "@/app/_entries/add-form";
import { DiaryShell } from "@/app/_shell/diary-shell";
import { Icon } from "@/lib/ui";
import a from "./add.module.css";
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

  const close = (pending: boolean) => router.push(pending ? "/inbox" : "/");
  return initial ? (
    <DeviceGate>
      {(diary) => (
        <DiaryShell diary={diary} current="map">
          <section className={a.sheet} aria-labelledby="add-title">
            <WithPending diary={diary} pendingId={initial.pendingId}>
              {(pending) => (
                <>
                  <div className={a.head}>
                    <h1 id="add-title" className="display">
                      Add a place
                    </h1>
                    <button type="button" className={a.close} onClick={() => close(pending !== null)} aria-label="Close">
                      <Icon name="x" size="l" />
                    </button>
                  </div>
                  <AddForm
                    diary={diary}
                    initial={{ ...initial, ...(pending ? { pending } : {}) }}
                    onSaved={(id) => router.push(`/place#${id}`)}
                    onQueued={() => router.push("/inbox")}
                    onCancel={() => close(pending !== null)}
                  />
                </>
              )}
            </WithPending>
          </section>
        </DiaryShell>
      )}
    </DeviceGate>
  ) : null;
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
