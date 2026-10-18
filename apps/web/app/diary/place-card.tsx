"use client";

import Link from "next/link";
import { categoryStyle, STATUS_LABELS } from "@/lib/places/categories";
import { formatDistance, type ListedPlace } from "@/lib/places/filter";
import type { DiarySnapshot, Opinion, Status } from "@/lib/places/types";

interface Props {
  item: ListedPlace;
  snapshot: DiarySnapshot;
  onClose: () => void;
  onSetStatus: (id: string, status: Status) => void;
}

/** The selected place: facts, everyone's visible opinions, and quick status buttons. */
export function PlaceCard({ item, snapshot, onClose, onSetStatus }: Props) {
  const { place, distanceM } = item;
  const style = categoryStyle(place.category);
  const person = (id: string) => (id === snapshot.me.id ? "You" : snapshot.people.find((p) => p.id === id)?.name ?? "Someone");
  const board = (id: string) => snapshot.boards.find((b) => b.id === id)?.name ?? id;
  const tag = (id: string) => snapshot.tags.find((t) => t.id === id);
  const myStatus = place.opinions.find((o) => o.kind === "status" && o.authorId === snapshot.me.id);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${place.location.lat},${place.location.lng}`;

  const byKind = <K extends Opinion["kind"]>(kind: K) => place.opinions.filter((o): o is Extract<Opinion, { kind: K }> => o.kind === kind);

  return (
    <section className="place-card" aria-label={place.name}>
      <header>
        <h2>
          <span aria-hidden>{style.emoji}</span> {place.name}
        </h2>
        <button type="button" className="icon" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      <p className="muted">
        {style.label}
        {place.cuisine && ` · ${place.cuisine}`}
        {place.address && ` · ${place.address}`}
        {distanceM !== undefined && ` · ${formatDistance(distanceM)} away`}
      </p>
      {place.signatureDish && (
        <p className="place-dish">
          Wallet bleeder: {place.signatureDish.name} <strong>₹{place.signatureDish.priceInr.toLocaleString("en-IN")}</strong>
        </p>
      )}

      <div className="status-buttons" role="group" aria-label="Your status">
        {(["want", "visited"] as Status[]).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={myStatus?.kind === "status" && myStatus.status === s}
            onClick={() => onSetStatus(place.id, s)}
          >
            <span className={`dot dot-${s}`} aria-hidden /> {STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      <ul className="opinions">
        {byKind("status").map((o) => (
          <li key={o.id}>
            <strong>{person(o.authorId)}</strong> {o.status === "visited" ? "visited" : o.authorId === snapshot.me.id ? "want to go" : "wants to go"} <Boards ids={o.boards} name={board} />
          </li>
        ))}
        {byKind("tag").map((o) => {
          const t = tag(o.tagId);
          return t ? (
            <li key={o.id}>
              <span title={t.description}>
                {t.emoji} {t.name}
              </span>{" "}
              <span className="muted">by {person(o.authorId)}</span> <Boards ids={o.boards} name={board} />
            </li>
          ) : null;
        })}
        {byKind("comment").map((o) => (
          <li key={o.id}>
            “{o.text}” <span className="muted">by {person(o.authorId)}</span> <Boards ids={o.boards} name={board} />
          </li>
        ))}
      </ul>

      <p className="links">
        <Link href={`/place#${encodeURIComponent(place.id)}`}>Place page</Link>
        <a href={mapsUrl} target="_blank" rel="noreferrer noopener">
          Open in Google Maps
        </a>
        {place.sourceLinks.map((url) => (
          <a key={url} href={url} target="_blank" rel="noreferrer noopener">
            {hostOf(url)}
          </a>
        ))}
      </p>
    </section>
  );
}

function Boards({ ids, name }: { ids: string[]; name: (id: string) => string }) {
  return (
    <>
      {ids.map((id) => (
        <span key={id} className="badge">
          {name(id)}
        </span>
      ))}
    </>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
