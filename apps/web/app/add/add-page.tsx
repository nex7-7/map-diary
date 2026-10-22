"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { AddForm, type AddInitial } from "@/app/_entries/add-form";
import { DiaryShell } from "@/app/_shell/diary-shell";
import { sealDate } from "@/app/diary/places-list";
import { Button, Icon } from "@/lib/ui";
import type { Status } from "@/lib/places/types";
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
  /** The place just saved, shown as a seal before going on. */
  const [saved, setSaved] = useState<{ id: string; name: string; status: Status } | null>(null);
  /** Bumped by "Add another", so the form starts over. */
  const [round, setRound] = useState(0);
  return initial ? (
    <DeviceGate>
      {(diary) => (
        <DiaryShell diary={diary} current="map">
          <div className={`lift sheet-up ${a.wrap}`}>
            <section className={`page scalloped ${a.sheet}`} aria-labelledby="add-title">
              <span className={a.marginL} aria-hidden />
              <span className={a.marginR} aria-hidden />
              {saved ? (
                <Saved
                  {...saved}
                  onAgain={() => {
                    setSaved(null);
                    setRound((n) => n + 1);
                    history.replaceState(null, "", "/add");
                    setInitial({});
                  }}
                  onDone={() => router.push(`/place#${saved.id}`)}
                />
              ) : (
                <WithPending key={round} diary={diary} pendingId={initial.pendingId}>
                  {(pending) => (
                    <>
                      <div className={a.head}>
                        <h1 id="add-title" className="display flip-wrap text-[34px]">
                          <span className="flip" style={{ animationDelay: "0.25s" }}>
                            Add a
                          </span>{" "}
                          <span className="flip italic" style={{ animationDelay: "0.34s" }}>
                            place
                          </span>
                        </h1>
                        <button type="button" className={a.close} onClick={() => close(pending !== null)} aria-label="Close">
                          <Icon name="x" size="m" />
                        </button>
                      </div>
                      <AddForm
                        diary={diary}
                        initial={{ ...initial, ...(pending ? { pending } : {}) }}
                        onSaved={(id, s) => setSaved({ id, ...s })}
                        onQueued={() => router.push("/inbox")}
                        onCancel={() => close(pending !== null)}
                      />
                    </>
                  )}
                </WithPending>
              )}
            </section>
          </div>
        </DiaryShell>
      )}
    </DeviceGate>
  ) : null;
}

/** Drops of ink thrown out when the seal lands. */
const SPLATS = [
  { size: 16, dx: -92, dy: -58 },
  { size: 10, dx: 86, dy: -74 },
  { size: 13, dx: 98, dy: 40 },
  { size: 8, dx: -70, dy: 86 },
  { size: 11, dx: 30, dy: 100 },
  { size: 7, dx: -104, dy: 14 },
  { size: 9, dx: 54, dy: -98 },
];

/** "Saved": the place pressed into the diary as a seal, Visited in red, Want to in graphite. */
function Saved({ name, status, onAgain, onDone }: { name: string; status: Status; onAgain: () => void; onDone: () => void }) {
  const ink = status === "visited" ? "var(--seal)" : "var(--graphite)";
  const now = new Date();
  return (
    <div className={a.saved} role="status">
      <div className={a.splash}>
        {SPLATS.map((s, i) => (
          <span
            key={i}
            className={`grit ${a.splat}`}
            style={{ width: s.size, height: s.size, background: ink, "--dx": `${s.dx}px`, "--dy": `${s.dy}px` } as CSSProperties}
            aria-hidden
          />
        ))}
        <div className={`seal slam ${a.bigseal} [--r:-9deg]`} style={{ color: ink }}>
          <span className="text-[11px] tracking-[0.22em]">{status === "visited" ? "Visited" : "Want to"}</span>
          <span className="text-[34px]">{sealDate(now.toISOString())}</span>
          <span className="mb-1 text-[10px] tracking-[0.2em]">Mumbai · {now.getFullYear()}</span>
        </div>
      </div>
      <div className="flip-wrap flex flex-col gap-2">
        <h2 className="display flip text-[32px]" style={{ animationDelay: "0.5s" }}>
          {name}
        </h2>
        <p className="hand rise m-0 text-[17px] text-ink-2" style={{ animationDelay: "0.7s" }}>
          {status === "visited" ? "Stamped in your diary." : "On your list. Go soon!"}
        </p>
      </div>
      <div className="rise flex gap-2.5" style={{ animationDelay: "0.85s" }}>
        <Button variant="secondary" onClick={onAgain}>
          Add another
        </Button>
        <Button onClick={onDone}>Open it</Button>
      </div>
    </div>
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
