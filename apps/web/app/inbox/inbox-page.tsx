"use client";

import Link from "next/link";
import { useState } from "react";
import type { ResolvedPlace } from "@map-diary/crypto";
import styles from "@/app/_entries/entries.module.css";
import { DeviceGate, type Diary } from "@/lib/device";
import { usePending, type FailReason, type PendingItem, type PendingQueue } from "@/lib/pending";
import { categoryStyle, STATUS_LABELS } from "@/lib/places/categories";

/** While the Inbox is open it checks for results this often. */
const INBOX_POLL_MS = 15_000;

/** `/inbox`: places waiting to be found, matches to choose between, and ones that weren't found. */
export function InboxPage() {
  return (
    <main>
      <Link href="/" className={styles.back}>
        ← Diary
      </Link>
      <h1 className={styles.title} style={{ margin: "12px 0 16px" }}>
        Inbox
      </h1>
      <DeviceGate>{(diary) => <Inbox diary={diary} />}</DeviceGate>
    </main>
  );
}

function Inbox({ diary }: { diary: Diary }) {
  const { queue, items } = usePending(diary, INBOX_POLL_MS);
  const [error, setError] = useState<string | null>(null);
  if (!queue) return <p className="muted">Opening…</p>;

  const run = (action: () => Promise<unknown>) => {
    setError(null);
    action().catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong"));
  };
  const group = (kinds: PendingItem["state"]["kind"][]) => items.filter((i) => kinds.includes(i.state.kind));
  const choose = group(["choose"]);
  const failed = group(["failed"]);
  const waiting = group(["unsent", "waiting"]);
  const added = group(["added"]);

  return (
    <div className={styles.page}>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {items.length === 0 && (
        <p className={styles.note}>
          Nothing waiting. Add a place by name or a Zomato or District link and it shows up here until it&apos;s found.
        </p>
      )}

      {choose.length > 0 && (
        <section className={styles.section}>
          <h2>Pick the right one</h2>
          <ul className={styles.list}>
            {choose.map((i) => (
              <ChooseRow key={i.id} item={i} queue={queue} run={run} />
            ))}
          </ul>
        </section>
      )}

      {failed.length > 0 && (
        <section className={styles.section}>
          <h2>Not found</h2>
          <ul className={styles.list}>
            {failed.map((i) => (
              <li key={i.id} className={styles.item}>
                <ItemHead item={i} />
                <p className={styles.note}>{failText(i.state.kind === "failed" ? i.state.reason : "not_found")}</p>
                <div className={styles.row}>
                  <button type="button" className={styles.secondary} onClick={() => run(() => queue.retry(i.id))}>
                    Try again
                  </button>
                  <Link href={`/add#pending=${encodeURIComponent(i.id)}`} className={styles.secondary}>
                    Drop a pin
                  </Link>
                  <button type="button" className={styles.textbutton} onClick={() => run(() => queue.dismiss(i.id))}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {waiting.length > 0 && (
        <section className={styles.section}>
          <h2>Looking up</h2>
          <ul className={styles.list}>
            {waiting.map((i) => (
              <li key={i.id} className={styles.item}>
                <ItemHead item={i} />
                <p className={styles.note}>
                  {i.state.kind === "unsent" ? "Not sent yet. It goes when you're back online." : "Waiting for the lookup. This page checks on its own."}
                </p>
                <div className={styles.row}>
                  <Link href={`/add#pending=${encodeURIComponent(i.id)}`} className={styles.textbutton}>
                    Drop a pin instead
                  </Link>
                  <button type="button" className={styles.textbutton} onClick={() => run(() => queue.dismiss(i.id))}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {added.length > 0 && (
        <section className={styles.section}>
          <h2>Found</h2>
          <ul className={styles.list}>
            {added.map((i) =>
              i.state.kind === "added" ? (
                <li key={i.id} className={styles.item}>
                  <div className={styles.row} style={{ justifyContent: "space-between" }}>
                    <Link href={`/place#${encodeURIComponent(i.state.placeId)}`}>{i.state.name}</Link>
                    <button type="button" className={styles.textbutton} onClick={() => run(() => queue.dismiss(i.id))}>
                      Clear
                    </button>
                  </div>
                </li>
              ) : null,
            )}
          </ul>
        </section>
      )}
    </div>
  );
}

function ItemHead({ item }: { item: PendingItem }) {
  return (
    <div>
      <strong>{item.draft.label || item.query}</strong>{" "}
      <span className="muted">· {STATUS_LABELS[item.draft.status]}</span>
      {item.draft.link && item.draft.link !== item.draft.label && (
        <p className={styles.note} style={{ overflowWrap: "anywhere", margin: "2px 0 0" }}>
          {item.draft.link}
        </p>
      )}
    </div>
  );
}

function ChooseRow({ item, queue, run }: { item: PendingItem; queue: PendingQueue; run: (a: () => Promise<unknown>) => void }) {
  if (item.state.kind !== "choose") return null;
  return (
    <li className={styles.item}>
      <ItemHead item={item} />
      <ul className={styles.list}>
        {item.state.candidates.map((c, n) => (
          <li key={n}>
            <button
              type="button"
              className={styles.secondary}
              style={{ width: "100%", textAlign: "left", display: "flex", flexDirection: "column", gap: 2 }}
              onClick={() => run(() => queue.choose(item.id, n))}
            >
              <Candidate place={c} />
            </button>
          </li>
        ))}
      </ul>
      <div className={styles.row}>
        <Link href={`/add#pending=${encodeURIComponent(item.id)}`} className={styles.textbutton}>
          None of these, drop a pin
        </Link>
        <button type="button" className={styles.textbutton} onClick={() => run(() => queue.dismiss(item.id))}>
          Remove
        </button>
      </div>
    </li>
  );
}

function Candidate({ place }: { place: ResolvedPlace }) {
  const style = categoryStyle(place.category);
  return (
    <>
      <span>
        <span aria-hidden>{style.emoji}</span> <strong>{place.name}</strong>
      </span>
      <span className="muted" style={{ fontSize: "0.875rem" }}>
        {[style.label, place.cuisine, place.address].filter(Boolean).join(" · ")}
      </span>
      {place.signatureDish && (
        <span style={{ fontSize: "0.875rem" }}>
          Wallet bleeder: {place.signatureDish.name} <strong>₹{place.signatureDish.priceInr.toLocaleString("en-IN")}</strong>
        </span>
      )}
    </>
  );
}

function failText(reason: FailReason): string {
  switch (reason) {
    case "expired":
      return "The lookup timed out before anyone answered.";
    case "bad_result":
      return "The answer that came back didn't check out.";
    case "rejected":
      return "The lookup wouldn't take this. Try just the link or the name.";
    default:
      return "Couldn't find this place.";
  }
}
