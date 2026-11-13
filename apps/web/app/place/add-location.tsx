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
import { nearestArea } from "@/lib/places/chains";
import type { StoredItem } from "@/lib/places/items-source";
import { Icon } from "@/lib/ui";
import p from "./place.module.css";

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
  const near = useMemo(() => (location ? nearestArea(items, location) : undefined), [items, location]);

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
      <button type="button" className={p.addOutlet} onClick={() => setOpen(true)}>
        <span className={p.addOutletPlus} aria-hidden>
          <Icon name="plus" size="s" />
        </span>
        <span>
          <strong>Add a location</strong>
          <span className="sub"> · from a link</span>
        </span>
      </button>
    );
  }

  return (
    <form
      className={p.addOutletForm}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className={p.addOutletTitle}>
        <span className={p.addOutletPlus} aria-hidden>
          <Icon name="plus" size="s" />
        </span>
        <strong>New location of {chain.name}</strong>
      </div>
      <label className={p.field} htmlFor="add-location">
        <span>Link</span>
        <input
          id="add-location"
          className={styles.input}
          inputMode="url"
          autoComplete="off"
          autoFocus
          placeholder="Paste a link"
          aria-describedby="add-location-help"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <small id="add-location-help">Google Maps, Zomato or District</small>
      </label>
      <Summary parsed={typed} expansion={expansion.kind} located={location !== undefined} near={near} chain={chain.name} />
      {location && (
        <label className={p.field}>
          <span>
            Area <small>(how this location is labelled)</small>
          </span>
          <input className={styles.input} placeholder={`e.g. ${near ?? "Oshiwara"}`} value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>
      )}
      <label className={p.addOutletCheck}>
        <input type="checkbox" checked={been} onChange={(e) => setBeen(e.target.checked)} /> I&apos;ve been to this one
      </label>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={p.addOutletActions}>
        <button type="submit" className={`${styles.primary} ${p.addOutletSave}`} disabled={saving || !ready}>
          {saving ? "Saving…" : expansion.kind === "loading" ? "Opening the link…" : location || !ready ? "Add location" : "Add and look it up"}
        </button>
        <button type="button" className={styles.textbutton} onClick={reset}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Summary({ parsed, expansion, located, near, chain }: { parsed: ParsedEntry; expansion: string; located: boolean; near: string | undefined; chain: string }) {
  if (expansion === "loading") return <p className={styles.note}>Opening the short link…</p>;
  if (located) {
    return (
      <p className={p.found} role="status">
        <Icon name="pin" size="s" />
        <span>
          <b>Pin found</b>
          {near ? ` near ${near}` : ""}. Nothing to look up.
        </span>
      </p>
    );
  }
  if (parsed.source === "zomato" || parsed.source === "district" || parsed.link) {
    return (
      <p className={p.found} role="status">
        <Icon name="search" size="s" />
        <span>
          We&apos;ll look it up and add it to {chain}. Only the link is sent; follow it in your <Link href="/inbox">Inbox</Link>.
        </span>
      </p>
    );
  }
  return null;
}
