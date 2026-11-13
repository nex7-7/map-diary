"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { accountStyles as s, day } from "@/app/_account/parts";
import { attachNotes, lookUpAgain, mergePlaces, useDiaryItems, type Diary } from "@/lib/device";
import { deletePlace } from "@/lib/entries/actions";
import { userMessage } from "@/lib/errors";
import { categoryStyle } from "@/lib/places/categories";
import { addressArea, normaliseChainName } from "@/lib/places/chains";
import { profilesOf } from "@/lib/places/items-source";
import { mergeTargets, orphanedOpinions, withMerged } from "@/lib/places/merges";
import { readPayload, type PlacePayload } from "@/lib/places/payloads";
import { Badge, Button, CloseButton, Glyph, MoreMenu, Sheet, useConfirm } from "@/lib/ui";

/** Every word of the query is in one of the fields, ignoring case, accents and punctuation. */
function matches(query: string, fields: (string | undefined)[]): boolean {
  const hay = normaliseChainName(fields.filter(Boolean).join(" "));
  return normaliseChainName(query).split(" ").filter(Boolean).every((w) => hay.includes(w));
}

interface Row {
  id: string;
  facts: PlacePayload;
  authorId: string;
  createdAt: number;
  /** Opinions anyone left on it (or on a duplicate merged into it) that this device can read. */
  opinions: number;
}

/** Notes still saved on a place that was deleted, which the admin can attach to a live place. */
interface Orphan {
  goneId: string;
  authors: string[];
  statuses: number;
  tags: number;
  comments: string[];
  latest: number;
}

/**
 * Every catalogue place, with the admin's tools: open it to edit its details, look it up
 * again, merge a duplicate into the right one, or delete it. Nobody's opinions are touched.
 */
export function AdminPlaces({ diary }: { diary: Diary }) {
  const items = useDiaryItems(diary);
  const [query, setQuery] = useState("");
  const [merging, setMerging] = useState<Row | null>(null);
  const [attaching, setAttaching] = useState<Orphan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ask, confirmSheet] = useConfirm();

  const profiles = useMemo(() => profilesOf(items), [items]);
  const rows = useMemo(() => {
    const targets = mergeTargets(items);
    const counts = new Map<string, number>();
    for (const i of items) {
      if (i.placeId && (i.type === "status" || i.type === "tag" || i.type === "comment")) counts.set(i.placeId, (counts.get(i.placeId) ?? 0) + 1);
    }
    return items
      .flatMap((i): Row[] => {
        if (i.type !== "place" || targets.has(i.id)) return [];
        const facts = readPayload("place", i.payload);
        if (!facts) return [];
        const opinions = withMerged(targets, i.id).reduce((n, id) => n + (counts.get(id) ?? 0), 0);
        return [{ id: i.id, facts, authorId: i.authorId, createdAt: i.createdAt, opinions }];
      })
      .sort((a, b) => a.facts.name.localeCompare(b.facts.name));
  }, [items]);

  const orphans = useMemo(
    () =>
      [...orphanedOpinions(items)].map(([goneId, ops]): Orphan => ({
        goneId,
        authors: [...new Set(ops.map((o) => o.authorId))],
        statuses: ops.filter((o) => o.type === "status").length,
        tags: ops.filter((o) => o.type === "tag").length,
        comments: ops.flatMap((o) => (o.type === "comment" ? [readPayload("comment", o.payload)?.text ?? ""] : [])).filter(Boolean),
        latest: Math.max(...ops.map((o) => o.updatedAt)),
      })),
    [items],
  );

  // Same name, not outlets of one chain: probably added twice.
  const duplicates = useMemo(() => {
    const byName = new Map<string, Row[]>();
    for (const r of rows) {
      const key = normaliseChainName(r.facts.name);
      byName.set(key, [...(byName.get(key) ?? []), r]);
    }
    return [...byName.values()].filter((g) => g.length > 1 && new Set(g.map((r) => r.facts.chain?.id ?? r.id)).size > 1);
  }, [rows]);

  const shown = rows.filter((r) => matches(query, [r.facts.name, r.facts.address, r.facts.cuisine, r.facts.chain?.name]));
  const nameOf = (accountId: string) => (accountId === diary.device.accountId ? "you" : (profiles.get(accountId)?.name ?? "a friend"));

  const run = (action: () => Promise<unknown>, done?: string) => {
    setError(null);
    setNotice(null);
    action().then(
      () => done && setNotice(done),
      (err: unknown) => setError(userMessage(err)),
    );
  };

  const remove = async (r: Row) => {
    const others = r.opinions > 0 ? ` ${r.opinions} ${r.opinions === 1 ? "note" : "notes"} on it stay saved but stop showing until you attach them to a place again.` : "";
    const ok = await ask({
      title: `Delete ${r.facts.name}?`,
      body: `It leaves everyone's diary.${others} If it's a duplicate, merge it instead so the notes move to the right place. To drop only your own notes, use Take off my list on the place.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) run(() => deletePlace(diary, r.id), `${r.facts.name} deleted.`);
  };

  const menu = (r: Row) => (
    <MoreMenu
      label={`More for ${r.facts.name}`}
      items={[
        { label: "Look up again", icon: "search", onSelect: () => run(() => lookUpAgain(diary, r.id), `Looking up ${r.facts.name}. Pick the new details in your Inbox.`) },
        { label: "Merge into…", icon: "pin", onSelect: () => setMerging(r) },
        { label: "Delete…", icon: "trash", danger: true, onSelect: () => void remove(r) },
      ]}
    />
  );

  return (
    <div className={s.stackCol}>
      {error && <p className={s.error}>{error}</p>}
      {notice && (
        <p className={s.okText} role="status">
          {notice}
        </p>
      )}

      {orphans.length > 0 && (
        <section className={s.card}>
          <h2 className="heading-s">Notes on deleted places · {orphans.length}</h2>
          <p className="sub" style={{ margin: 0 }}>
            These notes hang on a place that was deleted, so nobody sees them. Add the place again if it&apos;s gone, then attach them to it.
          </p>
          <ul className={s.list}>
            {orphans.map((o) => (
              <li key={o.goneId} className={s.row} style={{ padding: "10px 0" }}>
                <span className={s.rowText}>
                  <span className={s.rowTitle}>{o.authors.map(nameOf).join(", ")}</span>
                  <span className="sub">
                    {[
                      o.statuses > 0 ? `${o.statuses} ${o.statuses === 1 ? "stamp" : "stamps"}` : "",
                      o.tags > 0 ? `${o.tags} ${o.tags === 1 ? "tag" : "tags"}` : "",
                      o.comments.length > 0 ? `${o.comments.length} ${o.comments.length === 1 ? "comment" : "comments"}` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}{" "}
                    · last {day(o.latest)}
                  </span>
                  {o.comments.slice(0, 2).map((c, i) => (
                    <span key={i} className="sub">
                      “{c.length > 80 ? `${c.slice(0, 80)}…` : c}”
                    </span>
                  ))}
                </span>
                <Button size="m" variant="ghost" onClick={() => setAttaching(o)}>
                  Attach to…
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {duplicates.length > 0 && (
        <section className={s.card}>
          <h2 className="heading-s">Possible duplicates · {duplicates.length}</h2>
          <p className="sub" style={{ margin: 0 }}>
            Same name, not one chain. Merge the extra one into the place to keep: everyone&apos;s notes on it move across.
          </p>
          <ul className={s.list}>
            {duplicates.flat().map((r) => (
              <PlaceRow key={r.id} row={r} by={nameOf(r.authorId)} menu={menu(r)} />
            ))}
          </ul>
        </section>
      )}

      <section className={s.card}>
        <h2 className="heading-s">Places · {rows.length}</h2>
        <input
          className={s.input}
          type="search"
          aria-label="Find a place"
          placeholder="Find by name, area or cuisine"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {rows.length === 0 ? (
          <p className="sub">No places in the catalogue yet.</p>
        ) : (
          <ul className={s.list}>
            {groupChains(shown).map((g) =>
              g.length === 1 ? (
                <PlaceRow key={g[0]!.id} row={g[0]!} by={nameOf(g[0]!.authorId)} menu={menu(g[0]!)} />
              ) : (
                <ChainRow key={g[0]!.facts.chain?.id ?? g[0]!.id} rows={g} nameOf={nameOf} menu={menu} />
              ),
            )}
          </ul>
        )}
        <p className={s.hint}>Open a place to edit its details. Places only on someone&apos;s Personal board or a group you&apos;re not in aren&apos;t in the catalogue, so they aren&apos;t here.</p>
      </section>

      <Sheet open={merging !== null} onClose={() => setMerging(null)} label="Merge a duplicate">
        {merging && (
          <MergeInto
            duplicate={merging}
            rows={rows}
            onCancel={() => setMerging(null)}
            onPick={(kept) => {
              const dup = merging;
              setMerging(null);
              run(() => mergePlaces(diary, kept.id, dup.id), `${dup.facts.name} merged into ${kept.facts.name}.`);
            }}
          />
        )}
      </Sheet>
      <Sheet open={attaching !== null} onClose={() => setAttaching(null)} label="Attach notes to a place">
        {attaching && (
          <PickPlace
            title="Attach these notes to…"
            body={`They show on the place you pick, as if they were left there. Nobody's notes are changed.`}
            start=""
            rows={rows}
            action="Attach to"
            onCancel={() => setAttaching(null)}
            onPick={(kept) => {
              const gone = attaching;
              setAttaching(null);
              run(() => attachNotes(diary, kept.id, gone.goneId), `Notes attached to ${kept.facts.name}.`);
            }}
          />
        )}
      </Sheet>
      {confirmSheet}
    </div>
  );
}

/** The rows in order, with a chain's outlets together in one group where it first appears. */
function groupChains(rows: Row[]): Row[][] {
  const groups: Row[][] = [];
  const byChain = new Map<string, Row[]>();
  for (const r of rows) {
    const id = r.facts.chain?.id;
    const group = id ? byChain.get(id) : undefined;
    if (group) group.push(r);
    else {
      const next = [r];
      if (id) byChain.set(id, next);
      groups.push(next);
    }
  }
  return groups;
}

const notes = (n: number) => `${n} ${n === 1 ? "note" : "notes"}`;

/** A chain as one row, its outlets nested under it, each with its own tools. */
function ChainRow({ rows, nameOf, menu }: { rows: Row[]; nameOf: (id: string) => string; menu: (r: Row) => React.ReactNode }) {
  const first = rows[0]!;
  const name = first.facts.chain?.name ?? first.facts.name;
  const total = rows.reduce((n, r) => n + r.opinions, 0);
  return (
    <li className={s.row} style={{ padding: "10px 0", flexWrap: "wrap" }}>
      <Glyph category={first.facts.category} />
      <span className={s.rowText}>
        <span className={s.rowTitle}>
          <Link href={`/place#${encodeURIComponent(first.id)}`} className={s.plainName}>
            {name}
          </Link>
          <span className="sub"> · chain of {rows.length}</span>
        </span>
        <span className="sub">
          {categoryStyle(first.facts.category).label} · {nameOf(first.authorId)} · {notes(total)}
        </span>
      </span>
      <ul className={s.outletList}>
        {rows.map((r) => (
          <li key={r.id} title={`Added by ${nameOf(r.authorId)} ${day(r.createdAt)}`}>
            <span className={r.opinions > 0 ? `${s.outletDot} ${s.outletDotOn}` : s.outletDot} aria-hidden="true" />
            <Link href={`/place#${encodeURIComponent(r.id)}`} className={s.plainName}>
              {addressArea(r.facts.address) ?? r.facts.name}
            </Link>
            <span className="sub">{[r.opinions > 0 ? notes(r.opinions) : "", r.facts.sourceLinks.length === 0 ? "no links" : ""].filter(Boolean).join(" · ")}</span>
            {menu(r)}
          </li>
        ))}
      </ul>
    </li>
  );
}

function PlaceRow({ row: r, by, menu }: { row: Row; by: string; menu: React.ReactNode }) {
  const style = categoryStyle(r.facts.category);
  const detail = [style.label, r.facts.chain ? `${r.facts.chain.name} outlet` : undefined, addressArea(r.facts.address), by, notes(r.opinions), r.facts.sourceLinks.length === 0 ? "no links" : undefined]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className={s.row} style={{ padding: "10px 0" }} title={`Added by ${by} ${day(r.createdAt)}`}>
      <Glyph category={r.facts.category} />
      <span className={s.rowText}>
        <span className={s.rowTitle}>
          <Link href={`/place#${encodeURIComponent(r.id)}`} className={s.plainName}>
            {r.facts.name}
          </Link>
          {r.facts.mergedFrom && r.facts.mergedFrom.length > 0 && <Badge tone="personal">+{r.facts.mergedFrom.length} merged</Badge>}
        </span>
        <span className="sub">{detail}</span>
      </span>
      {menu}
    </li>
  );
}

/** Picks the place a duplicate merges into. */
function MergeInto({ duplicate, rows, onCancel, onPick }: { duplicate: Row; rows: Row[]; onCancel: () => void; onPick: (kept: Row) => void }) {
  return (
    <PickPlace
      title={`Merge ${duplicate.facts.name} into…`}
      body={`${duplicate.facts.name} disappears and its ${duplicate.opinions} ${duplicate.opinions === 1 ? "note shows" : "notes show"} on the place you pick, which also gets its links. Nobody's notes are changed.`}
      start={duplicate.facts.name}
      rows={rows.filter((r) => r.id !== duplicate.id)}
      action="Merge into"
      onCancel={onCancel}
      onPick={onPick}
    />
  );
}

interface PickPlaceProps {
  title: string;
  body: string;
  start: string;
  rows: Row[];
  action: string;
  onCancel: () => void;
  onPick: (kept: Row) => void;
}

/** Picks one catalogue place, found by name or address. */
function PickPlace({ title, body, start, rows, action, onCancel, onPick }: PickPlaceProps) {
  const [query, setQuery] = useState(start);
  const [picked, setPicked] = useState<Row | null>(null);
  const options = rows.filter((r) => matches(query, [r.facts.name, r.facts.address])).slice(0, 20);
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className={s.sheetTop}>
        <h2 className="heading-m">{title}</h2>
        <CloseButton onClick={onCancel} />
      </div>
      <p className="sub" style={{ margin: 0 }}>
        {body}
      </p>
      <input className={s.input} type="search" aria-label="Find the place" placeholder="Find by name or area" value={query} onChange={(e) => setQuery(e.target.value)} />
      <ul className={s.list}>
        {options.map((r) => (
          <li key={r.id} className={s.row}>
            <label className={s.rowText} style={{ cursor: "pointer" }}>
              <span className={s.rowTitle}>
                <input type="radio" name="kept" checked={picked?.id === r.id} onChange={() => setPicked(r)} />
                <span className={s.plainName}>{r.facts.name}</span>
              </span>
              <span className="sub">{[categoryStyle(r.facts.category).label, r.facts.address].filter(Boolean).join(" · ")}</span>
            </label>
          </li>
        ))}
        {options.length === 0 && <li className="sub">No place matches.</li>}
      </ul>
      <Button block disabled={!picked} onClick={() => picked && onPick(picked)}>
        {picked ? `${action} ${picked.facts.name}` : "Pick the place"}
      </Button>
      <Button variant="ghost" block onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
