"use client";

import Link from "next/link";
import { categoryStyle } from "@/lib/places/categories";
import { formatDistance, type ListedPlace } from "@/lib/places/filter";
import type { DiarySnapshot, Status } from "@/lib/places/types";
import { BoardBadge, CloseButton, Icon, StatusChips } from "@/lib/ui";
import { sealDate } from "./places-list";

interface Props {
  item: ListedPlace;
  snapshot: DiarySnapshot;
  onClose: () => void;
  onSetStatus: (id: string, status: Status) => void;
}

/**
 * The selected place over the map, on a sheet with a scalloped top: facts, the wallet
 * bleeder as a ticket stub, my status as stamps, and the way into the place page.
 */
export function PlaceCard({ item, snapshot, onClose, onSetStatus }: Props) {
  const { place, distanceM } = item;
  const style = categoryStyle(place.category);
  const me = snapshot.me.id;
  const myStatus = place.opinions.find((o) => o.kind === "status" && o.authorId === me);
  const outlets = place.outlets?.length ?? 1;
  const area = outlets > 1 ? `${outlets} locations` : place.address?.split(",").pop()?.trim();
  const notes = place.opinions.filter((o) => o.kind !== "status");
  const authors = [...new Set(notes.map((o) => o.authorId))].map((id) => (id === me ? "you" : (snapshot.people.find((p) => p.id === id)?.name ?? "someone")));
  const href = `/place#${encodeURIComponent(place.id)}`;

  return (
    <section className="lift sheet-up" aria-label={place.name}>
      <div className="page scalloped flex flex-col gap-3 rounded-b-[18px] px-4 pb-3.5 [--pad-top:10px]">
        <div className="flex items-start gap-3">
          <Link href={href} className="flex min-w-0 flex-1 flex-col gap-1.5 no-underline">
            <p className="kicker">{[style.label, place.cuisine].filter(Boolean).join(" · ")}</p>
            <h2 className="display text-[29px]">{place.name}</h2>
            <span className="text-[12.5px] text-ink-3">{[area, distanceM !== undefined ? formatDistance(distanceM) : undefined].filter(Boolean).join(" · ")}</span>
          </Link>
          {myStatus?.kind === "status" && myStatus.status === "visited" && (
            <span key={myStatus.updatedAt} className="seal slam mt-1 size-[54px] shrink-0 flex-col gap-px [--r:-10deg]" aria-label={`Visited ${sealDate(myStatus.updatedAt)}`}>
              <span className="text-[6.5px] tracking-[0.14em]">Visited</span>
              <span className="text-[12.5px]">{sealDate(myStatus.updatedAt)}</span>
            </span>
          )}
          <CloseButton onClick={onClose} />
        </div>

        {place.signatureDish && (
          <div className="ticket self-start [--notch:var(--page)]">
            <span className="flex flex-col justify-center px-3.5 py-2">
              <span className="text-[9.5px] font-bold tracking-[0.14em] uppercase opacity-70">Wallet bleeder</span>
              <span className="font-print text-[15px] leading-tight">{place.signatureDish.name}</span>
            </span>
            <span className="stub worn grid place-items-center px-3.5 text-[19px]">₹{place.signatureDish.priceInr.toLocaleString("en-IN")}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <StatusChips value={myStatus?.kind === "status" ? myStatus.status : undefined} onChange={(s) => onSetStatus(place.id, s)} />
          <span className="flex flex-wrap gap-1.5">
            {(myStatus?.boards ?? []).map((id) => {
              const b = snapshot.boards.find((x) => x.id === id);
              return b ? <BoardBadge key={id} kind={b.kind} name={b.name} /> : null;
            })}
          </span>
        </div>

        <Link href={href} className="sketch-link inline-flex items-center gap-1 self-start text-[14px] font-semibold">
          {notes.length > 0 ? `${notes.length} ${notes.length === 1 ? "note" : "notes"} from ${joinNames(authors)}` : "Open the page"}
          <Icon name="chevronRight" size="m" />
        </Link>
      </div>
    </section>
  );
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
