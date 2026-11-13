"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useExpandedLink } from "@/app/_entries/add-form";
import styles from "@/app/_entries/entries.module.css";
import type { Diary } from "@/lib/device";
import { userMessage } from "@/lib/errors";
import { addOutlet, chainToJoin, outletFacts } from "@/lib/entries/outlet";
import { parseEntry, type ParsedEntry } from "@/lib/entries/parse-input";
import { getPendingQueue, MAX_QUERY_LENGTH } from "@/lib/pending";
import type { StoredItem } from "@/lib/places/items-source";
import { Icon } from "@/lib/ui";

interface Props {
  diary: Diary;
  items: readonly StoredItem[];
  /** The place (on a chain, its first outlet) the new location joins. */
  placeId: string;
  /** Says what happened, under the locations. */
  onDone: (notice: string) => void;
}

/**
 * "Add a location" on a place page: paste a link to another outlet and it joins the place as a
 * new location. A Google Maps link carries the pin, so it is added straight away; a Zomato or
 * District link (or a name) is looked up like anything else and joins once found.
 */
export function AddLocation({ diary, items, placeId, onDone }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [address, setAddress] = useState("");
  const [been, setBeen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const join = useMemo(() => chainToJoin(items, placeId), [items, placeId]);

  const typed = useMemo(() => parseEntry(text), [text]);
  const expansion = useExpandedLink(typed);
  const location = expansion.kind === "done" ? expansion.location : typed.source === "google-maps" ? typed.location : undefined;
  const expandedUrl = expansion.kind === "done" || expansion.kind === "partial" ? expansion.url : undefined;
  const query = typed.link ?? text.trim();
  const ready = expansion.kind !== "loading" && query.length > 0;

  if (!join) return null;
  const { chain, lead } = join;

  const reset = () => {
    setOpen(false);
    setText("");
    setAddress("");
    setBeen(false);
    setError(null);
    setSaving(false);
  };

  const save = async () => {
    setError(null);
    if (!ready) return;
    setSaving(true);
    try {
      if (location) {
        const links = [typed.link, expandedUrl].filter((l): l is string => !!l);
        const done = await addOutlet(diary, placeId, outletFacts(lead, chain, { location, links, address }), been);
        reset();
        onDone(
          done.kind === "added"
            ? `New location added to ${chain.name}.`
            : done.kind === "there"
              ? `That location is already part of ${chain.name}.`
              : "That link is for a place already on the map on its own. Only the admin can join it to this one, from Edit details.",
        );
        return;
      }
      if (query.length > MAX_QUERY_LENGTH) {
        setError("That's too long to look up. Paste just the link.");
        setSaving(false);
        return;
      }
      await (await getPendingQueue(diary)).addOutlet(query, chain, lead.category, been);
      reset();
      onDone(`Looking it up. The new location joins ${chain.name} once it's found; until then it waits in your Inbox.`);
    } catch (err) {
      setError(userMessage(err));
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className={`${styles.textbutton} self-start`} onClick={() => setOpen(true)}>
        <Icon name="plus" size="s" /> Add a location
      </button>
    );
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className={styles.label} htmlFor="add-location">
        Another location of {chain.name}
      </label>
      <textarea
        id="add-location"
        className={styles.input}
        rows={1}
        autoFocus
        placeholder="Paste a Google Maps, Zomato or District link"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Summary parsed={typed} expansion={expansion.kind} located={location !== undefined} />
      {location && (
        <input
          className={styles.input}
          placeholder="Area, e.g. Oshiwara, Andheri West, Mumbai (optional)"
          aria-label="Area or address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
      )}
      <label className="flex items-center gap-2 text-[15px]">
        <input type="checkbox" checked={been} onChange={(e) => setBeen(e.target.checked)} /> I&apos;ve been to this one
      </label>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.row}>
        <button type="button" className={styles.secondary} onClick={reset}>
          Cancel
        </button>
        <button type="submit" className={`${styles.primary} ${styles.grow}`} disabled={saving || !ready}>
          {saving ? "Saving…" : expansion.kind === "loading" ? "Opening the link…" : location ? "Add it" : "Add and look it up"}
        </button>
      </div>
      {!location && ready && (
        <p className={styles.note}>
          Only the {typed.link ? "link" : "name"} is sent to look it up. You can follow it in your <Link href="/inbox">Inbox</Link>.
        </p>
      )}
    </form>
  );
}

function Summary({ parsed, expansion, located }: { parsed: ParsedEntry; expansion: string; located: boolean }) {
  if (expansion === "loading") return <p className={styles.note}>Opening the short link…</p>;
  if (located) return <p className={styles.note}>Found the pin on the link. It&apos;s added straight away.</p>;
  if (parsed.source === "zomato" || parsed.source === "district") return <p className={styles.note}>The address and pin get looked up.</p>;
  return null;
}
