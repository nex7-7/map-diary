"use client";

import Link from "next/link";
import { categoryStyle } from "@/lib/places/categories";
import { formatDistance, type ListedPlace } from "@/lib/places/filter";
import type { DiarySnapshot, Status } from "@/lib/places/types";
import { BoardBadge, Icon, StatusChips, Tile } from "@/lib/ui";

interface Props {
  item: ListedPlace;
  snapshot: DiarySnapshot;
  onClose: () => void;
  onSetStatus: (id: string, status: Status) => void;
}

/** The selected place over the map: facts, the wallet bleeder, my status, and a way into the place page. */
export function PlaceCard({ item, snapshot, onClose, onSetStatus }: Props) {
  const { place, distanceM } = item;
  const style = categoryStyle(place.category);
  const me = snapshot.me.id;
  const myStatus = place.opinions.find((o) => o.kind === "status" && o.authorId === me);
  const area = place.address?.split(",").pop()?.trim();
  const notes = place.opinions.filter((o) => o.kind !== "status");
  const authors = [...new Set(notes.map((o) => o.authorId))].map((id) =>
    id === me ? "you" : (snapshot.people.find((p) => p.id === id)?.name ?? "someone"),
  );

  return (
    <section className="place-card" aria-label={place.name}>
      <div className="place-card-head">
        <Tile>{style.emoji}</Tile>
        <Link href={`/place#${encodeURIComponent(place.id)}`} className="place-card-title">
          <h2 className="heading-m">{place.name}</h2>
          <span className="sub">
            {[style.label, place.cuisine, area, distanceM !== undefined ? formatDistance(distanceM) : undefined].filter(Boolean).join(" · ")}
          </span>
        </Link>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
          <Icon name="x" size="m" />
        </button>
      </div>

      {place.signatureDish && (
        <div className="bleeder">
          <div>
            <p className="overline">Wallet bleeder</p>
            <p className="quote">{place.signatureDish.name}</p>
          </div>
          <span className="price">₹{place.signatureDish.priceInr.toLocaleString("en-IN")}</span>
        </div>
      )}

      <div className="place-card-status">
        <StatusChips value={myStatus?.kind === "status" ? myStatus.status : undefined} onChange={(s) => onSetStatus(place.id, s)} />
        <span className="place-card-boards">
          {(myStatus?.boards ?? []).map((id) => {
            const b = snapshot.boards.find((x) => x.id === id);
            return b ? <BoardBadge key={id} kind={b.kind} name={b.name} /> : null;
          })}
        </span>
      </div>

      <Link href={`/place#${encodeURIComponent(place.id)}`} className="text-link">
        {notes.length > 0 ? `${notes.length} ${notes.length === 1 ? "note" : "notes"} from ${joinNames(authors)}` : "Open place"}
        <Icon name="chevronRight" size="m" />
      </Link>
    </section>
  );
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
