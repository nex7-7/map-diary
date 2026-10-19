"use client";

import Link from "next/link";
import { useState } from "react";
import type { ResolvedPlace } from "@map-diary/crypto";
import styles from "@/app/_entries/entries.module.css";
import { DiaryShell } from "@/app/_shell/diary-shell";
import { buttonClass, Icon, Tile, type IconName } from "@/lib/ui";
import b from "./inbox.module.css";
import { DeviceGate, type Diary } from "@/lib/device";
import { usePending, type FailReason, type PendingItem, type PendingQueue } from "@/lib/pending";
import { categoryStyle, STATUS_LABELS } from "@/lib/places/categories";

/** While the Inbox is open it checks for results this often. */
const INBOX_POLL_MS = 15_000;

/** `/inbox`: places waiting to be found, matches to choose between, and ones that weren't found. */
export function InboxPage() {
  return (
    <DeviceGate>
      {(diary) => (
        <DiaryShell diary={diary} current="inbox">
          <div className={b.page}>
            <header>
              <h1 className="display">Inbox</h1>
              <p className="sub">Lookups in progress and places that need you.</p>
            </header>
            <Inbox diary={diary} />
          </div>
        </DiaryShell>
      )}
    </DeviceGate>
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
        <p className={b.empty}>
          Nothing waiting. Add a place by name or a Zomato or District link and it shows up here until it&apos;s found.
        </p>
      )}

      {choose.length > 0 && (
        <section className={styles.section}>
          <h2>Pick the right one · {choose.length}</h2>
          <ul className={styles.list}>
            {choose.map((i) => (
              <ChooseRow key={i.id} item={i} queue={queue} run={run} />
            ))}
          </ul>
        </section>
      )}

      {failed.length > 0 && (
        <section className={styles.section}>
          <h2>Not found · {failed.length}</h2>
          <ul className={b.rows}>
            {failed.map((i) => (
              <li key={i.id} className={b.row}>
                <RoundIcon icon="alert" tone="danger" />
                <div className={b.rowText}>
                  <ItemHead item={i} />
                  <p className="sub">{failText(i.state.kind === "failed" ? i.state.reason : "not_found")}</p>
                  <div className={styles.row}>
                    <button type="button" className={buttonClass({ variant: "secondary", size: "m" })} onClick={() => run(() => queue.retry(i.id))}>
                      Try again
                    </button>
                    <Link href={`/add#pending=${encodeURIComponent(i.id)}`} className={buttonClass({ variant: "ghost", size: "m" })}>
                      <Icon name="pin" size="s" />
                      Drop a pin
                    </Link>
                    <button type="button" className={styles.textbutton} onClick={() => run(() => queue.dismiss(i.id))}>
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {waiting.length > 0 && (
        <section className={styles.section}>
          <h2>Looking up · {waiting.length}</h2>
          <ul className={b.rows}>
            {waiting.map((i) => (
              <li key={i.id} className={b.row}>
                <RoundIcon icon="clock" tone="sea" />
                <div className={b.rowText}>
                  <ItemHead item={i} />
                  <p className="sub">
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
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {added.length > 0 && (
        <section className={styles.section}>
          <h2>Found · {added.length}</h2>
          <ul className={b.rows}>
            {added.map((i) =>
              i.state.kind === "added" ? (
                <li key={i.id} className={b.row}>
                  <RoundIcon icon="check" tone="visited" />
                  <Link href={`/place#${encodeURIComponent(i.state.placeId)}`} className={`${b.rowText} ${b.found}`}>
                    {i.state.name}
                    <Icon name="chevronRight" size="m" />
                  </Link>
                  <button type="button" className={styles.textbutton} onClick={() => run(() => queue.dismiss(i.id))}>
                    Clear
                  </button>
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
      <span className={b.name}>{item.draft.label || item.query}</span> <span className="sub">· {STATUS_LABELS[item.draft.status]}</span>
      {item.draft.link && item.draft.link !== item.draft.label && <p className={`sub ${b.link}`}>{item.draft.link}</p>}
    </div>
  );
}

function RoundIcon({ icon, tone }: { icon: IconName; tone: "sea" | "danger" | "visited" }) {
  return (
    <span className={`${b.round} ${b[tone]}`} aria-hidden>
      <Icon name={icon} size="m" />
    </span>
  );
}

function ChooseRow({ item, queue, run }: { item: PendingItem; queue: PendingQueue; run: (a: () => Promise<unknown>) => void }) {
  if (item.state.kind !== "choose") return null;
  return (
    <li className={`${styles.item} ${b.choose}`}>
      <p className="heading-s">
        “{item.draft.label || item.query}” matched {item.state.candidates.length} places
      </p>
      {item.draft.link && item.draft.link !== item.draft.label && <p className={`sub ${b.link}`}>{item.draft.link}</p>}
      <ul className={b.candidates}>
        {item.state.candidates.map((c, n) => (
          <li key={n}>
            <button type="button" className={b.candidate} onClick={() => run(() => queue.choose(item.id, n))}>
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
      <Tile>{style.emoji}</Tile>
      <span className={b.candidateText}>
        <span className={b.name}>{place.name}</span>
        <span className="sub">{[style.label, place.cuisine, place.address].filter(Boolean).join(" · ")}</span>
        {place.signatureDish && (
          <span className="sub">
            Wallet bleeder: {place.signatureDish.name} <strong>₹{place.signatureDish.priceInr.toLocaleString("en-IN")}</strong>
          </span>
        )}
      </span>
      <Icon name="chevronRight" size="m" />
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
