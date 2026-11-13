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
import { Icon } from "@/lib/ui";

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
          <div className="mx-auto max-w-[40rem] px-5 pt-[max(16px,env(safe-area-inset-top))] pb-6">
            <div className={styles.page}>
              <Link href={target.placeId ? `/place#${encodeURIComponent(target.placeId)}` : "/inbox"} className={styles.back}>
                <Icon name="chevronLeft" size="m" />
                {target.placeId ? "Place" : "Inbox"}
              </Link>
              <header className="flex flex-col gap-1.5">
                <p className="kicker">{target.placeId ? "Put a wrong match right" : "A lookup that needs you"}</p>
                <h1 className="display">
                  Fill in the <em>details</em>
                </h1>
              </header>
              {target.placeId ? <FillPlace diary={diary} placeId={target.placeId} /> : <FillPending diary={diary} pendingId={target.pendingId} />}
            </div>
          </div>
        </DiaryShell>
      )}
    </DeviceGate>
  ) : null;
}

function Gone({ title, text, back = "/inbox" }: { title: string; text: string; back?: string }) {
  return (
    <div className="mt-6 flex flex-col items-center gap-3.5 rounded-[18px] border-[1.5px] border-dashed border-rule-ink bg-page px-[18px] py-7 text-center">
      <span className="slot size-[72px] [transform:rotate(-6deg)]" aria-hidden="true">
        <Icon name="envelope" size="l" />
      </span>
      <p className="m-0 font-serif text-[22px]">{title}</p>
      <p className="m-0 max-w-[280px] text-[14px] leading-normal text-ink-2">{text}</p>
      <Link href={back} className={styles.secondary}>
        {back === "/inbox" ? "Back to the Inbox" : back === "/" ? "Back to the diary" : "Back to the place"}
      </Link>
    </div>
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
  if (!item) return <Gone title="That letter's already opened" text="This Inbox item was found or removed, maybe on another device, so there's nothing to fill in." />;

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
      <p className="m-0 text-[14px] leading-normal text-ink-2">
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
  if (!item || !facts) return <Gone title="Not on this device" text="That place isn't here. It may have been deleted, or not synced yet." back="/" />;
  if (!canChangeFacts(items, placeId, diary.device.accountId, diary.device.isAdmin === true)) {
    return <Gone
        title="Only the admin can change it now"
        text="Someone else has put this place on their list, so its details are the admin's to change."
        back={`/place#${encodeURIComponent(placeId)}`}
      />;
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
