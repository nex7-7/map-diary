"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FactsEditor } from "@/app/_entries/facts-editor";
import { useItems } from "@/app/_entries/use-items";
import styles from "@/app/_entries/entries.module.css";
import { DiaryShell } from "@/app/_shell/diary-shell";
import { DeviceGate, type Diary } from "@/lib/device";
import { canChangeFacts, updateFacts } from "@/lib/entries/actions";
import type { FactsForm } from "@/lib/entries/facts";
import { getPendingQueue, type PendingItem } from "@/lib/pending";
import { chainFor } from "@/lib/places/chains";
import { readPayload } from "@/lib/places/payloads";

/**
 * `/fill#pending=<id>` or `/fill#place=<id>`: the person types a place's details in themselves
 * when the resolver got it wrong or found nothing. An Inbox item is added to the catalogue with
 * its status, tags and note; a place they may still correct gets the details as its facts. The
 * ids stay in the fragment, which the browser never sends to the server.
 */
export function FillPage() {
  const [target, setTarget] = useState<{ pendingId?: string; placeId?: string } | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(location.hash.slice(1));
    setTarget({ ...(params.get("pending") ? { pendingId: params.get("pending")! } : {}), ...(params.get("place") ? { placeId: params.get("place")! } : {}) });
  }, []);
  return target ? (
    <DeviceGate>
      {(diary) => (
        <DiaryShell diary={diary} current="inbox">
          <div className={styles.page}>
            <h1 className={styles.title}>Fill in the details</h1>
            {target.placeId ? <FillPlace diary={diary} placeId={target.placeId} /> : <FillPending diary={diary} pendingId={target.pendingId} />}
          </div>
        </DiaryShell>
      )}
    </DeviceGate>
  ) : null;
}

function Gone({ text }: { text: string }) {
  return (
    <>
      <p>{text}</p>
      <Link href="/inbox" className={styles.secondary}>
        Back to the Inbox
      </Link>
    </>
  );
}

/** An Inbox item's place, typed in: name, pin and the rest, starting from what was looked up. */
function FillPending({ diary, pendingId }: { diary: Diary; pendingId: string | undefined }) {
  const router = useRouter();
  const { loaded, items } = useItems(diary);
  const [item, setItem] = useState<PendingItem | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void getPendingQueue(diary)
      .then((q) => q.list())
      .then((list) => live && setItem(list.find((i) => i.id === pendingId) ?? null));
    return () => {
      live = false;
    };
  }, [diary, pendingId]);
  if (item === undefined || !loaded) return <p className="muted">Opening…</p>;
  if (!item) return <Gone text="That Inbox item is gone. It may have been found or removed already." />;

  const isLink = /^https?:\/\//i.test(item.query);
  const start: FactsForm = {
    name: item.draft.label && item.draft.label !== item.query ? item.draft.label : isLink ? "" : item.query,
    category: item.draft.category ?? "restaurant",
    location: null,
    address: "",
    cuisine: "",
    dishName: "",
    dishPrice: "",
    sourceLinks: item.draft.link ? [item.draft.link] : [],
    chainName: "",
  };
  return (
    <>
      <p className="hand m-0 text-[16px] text-ink-2">
        It goes on the map for everyone on the app, with your {item.draft.status === "visited" ? "Visited" : "Want to"}, tags and note where you chose. Put the pin where the place is.
      </p>
      <FactsEditor
        start={start}
        chainFor={(name) => chainFor(items, name)}
        onCancel={() => router.push("/inbox")}
        onSave={async (facts) => {
          const placeId = await (await getPendingQueue(diary)).fillIn(item.id, facts);
          router.push(`/place#${encodeURIComponent(placeId)}`);
        }}
      />
    </>
  );
}

/** A place this person may still correct, or the admin may edit: its facts, typed over. */
function FillPlace({ diary, placeId }: { diary: Diary; placeId: string }) {
  const router = useRouter();
  const { loaded, items } = useItems(diary);
  if (!loaded) return <p className="muted">Opening…</p>;
  const item = items.find((i) => i.id === placeId && i.type === "place");
  const facts = item && readPayload("place", item.payload);
  if (!item || !facts) return <Gone text="That place isn't on this device. It may have been deleted, or not synced yet." />;
  if (!canChangeFacts(items, placeId, diary.device.accountId, diary.device.isAdmin === true)) {
    return <Gone text="Someone else has put this place on their list, so only the admin can change its details now." />;
  }
  return (
    <FactsEditor
      facts={facts}
      chainFor={(name) => chainFor(items, name)}
      onCancel={() => router.push(`/place#${encodeURIComponent(placeId)}`)}
      onSave={async (next) => {
        await updateFacts(diary, item, next);
        router.push(`/place#${encodeURIComponent(placeId)}`);
      }}
    />
  );
}
