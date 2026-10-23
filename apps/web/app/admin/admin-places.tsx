"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { accountStyles as s, day } from "@/app/_account/parts";
import { lookUpAgain, mergePlaces, useDiaryItems, type Diary } from "@/lib/device";
import { deletePlace } from "@/lib/entries/actions";
import { userMessage } from "@/lib/errors";
import { categoryStyle } from "@/lib/places/categories";
import { normaliseChainName } from "@/lib/places/chains";
import { profilesOf } from "@/lib/places/items-source";
import { mergeTargets, withMerged } from "@/lib/places/merges";
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

/**
 * Every catalogue place, with the admin's tools: open it to edit its details, look it up
 * again, merge a duplicate into the right one, or delete it. Nobody's opinions are touched.
 */
export function AdminPlaces({ diary }: { diary: Diary }) {
  const items = useDiaryItems(diary);
  const [query, setQuery] = useState("");
  const [merging, setMerging] = useState<Row | null>(null);
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
    const others = r.opinions > 0 ? ` ${r.opinions} ${r.opinions === 1 ? "note" : "notes"} on it stay saved but stop showing.` : "";
    const ok = await ask({
      title: `Delete ${r.facts.name}?`,
      body: `It leaves everyone's diary.${others} If it's a duplicate, merge it instead so the notes move to the right place.`,
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
        { label: "Delete…", icon: "x", danger: true, onSelect: () => void remove(r) },
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
            {shown.map((r) => (
              <PlaceRow key={r.id} row={r} by={nameOf(r.authorId)} menu={menu(r)} />
            ))}
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
      {confirmSheet}
    </div>
  );
}

function PlaceRow({ row: r, by, menu }: { row: Row; by: string; menu: React.ReactNode }) {
  const style = categoryStyle(r.facts.category);
  const detail = [style.label, r.facts.chain ? `${r.facts.chain.name} outlet` : undefined, r.facts.address].filter(Boolean).join(" · ");
  return (
    <li className={s.row} style={{ padding: "10px 0" }}>
      <Glyph category={r.facts.category} />
      <span className={s.rowText}>
        <span className={s.rowTitle}>
          <Link href={`/place#${encodeURIComponent(r.id)}`} className={s.plainName}>
            {r.facts.name}
          </Link>
          {r.facts.mergedFrom && r.facts.mergedFrom.length > 0 && <Badge tone="personal">+{r.facts.mergedFrom.length} merged</Badge>}
        </span>
        <span className="sub">{detail}</span>
        <span className="sub">
          Added by {by} {day(r.createdAt)} · {r.opinions} {r.opinions === 1 ? "note" : "notes"}
          {r.facts.sourceLinks.length === 0 ? " · no links" : ""}
        </span>
      </span>
      {menu}
    </li>
  );
}

/** Picks the place a duplicate merges into. */
function MergeInto({ duplicate, rows, onCancel, onPick }: { duplicate: Row; rows: Row[]; onCancel: () => void; onPick: (kept: Row) => void }) {
  const [query, setQuery] = useState(duplicate.facts.name);
  const [picked, setPicked] = useState<Row | null>(null);
  const options = rows
    .filter((r) => r.id !== duplicate.id)
    .filter((r) => matches(query, [r.facts.name, r.facts.address]))
    .slice(0, 20);
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className={s.sheetTop}>
        <h2 className="heading-m">Merge {duplicate.facts.name} into…</h2>
        <CloseButton onClick={onCancel} />
      </div>
      <p className="sub" style={{ margin: 0 }}>
        {duplicate.facts.name} disappears and its {duplicate.opinions} {duplicate.opinions === 1 ? "note shows" : "notes show"} on the place you pick, which also gets
        its links. Nobody&apos;s notes are changed.
      </p>
      <input className={s.input} type="search" aria-label="Find the place to keep" value={query} onChange={(e) => setQuery(e.target.value)} />
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
        {options.length === 0 && <li className="sub">No other place matches.</li>}
      </ul>
      <Button block disabled={!picked} onClick={() => picked && onPick(picked)}>
        {picked ? `Merge into ${picked.facts.name}` : "Pick the place to keep"}
      </Button>
      <Button variant="ghost" block onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
