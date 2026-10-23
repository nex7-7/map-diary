"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { buildFacts, formFromFacts, isFood, type FactsForm } from "@/lib/entries/facts";
import { userMessage } from "@/lib/errors";
import type { PlacePayload } from "@/lib/places/payloads";
import type { PlaceChain } from "@/lib/places/types";
import { CategoryPicker } from "./fields";
import styles from "./entries.module.css";

const PinPicker = dynamic(() => import("./pin-picker").then((m) => m.PinPicker), {
  ssr: false,
  loading: () => <div className={styles.picker} />,
});

interface Props {
  facts: PlacePayload;
  onSave: (facts: PlacePayload) => Promise<void>;
  onCancel: () => void;
  /** For a catalogue place: finds or makes the chain for a typed chain name, and shows the field. */
  chainFor?: (name: string) => PlaceChain;
}

/** Edits a place's facts: name, category, pin, address, cuisine, wallet bleeder and links. */
export function FactsEditor({ facts, onSave, onCancel, chainFor }: Props) {
  const [form, setForm] = useState<FactsForm>(() => formFromFacts(facts));
  const [newLink, setNewLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<FactsForm>) => setForm({ ...form, ...patch });

  const save = async () => {
    const links = newLink.trim() ? [...form.sourceLinks, newLink.trim()] : form.sourceLinks;
    const result = buildFacts({ ...form, sourceLinks: links }, chainFor);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSaving(true);
    try {
      await onSave(result.facts);
    } catch (err) {
      setError(userMessage(err));
      setSaving(false);
    }
  };

  return (
    <form
      className={styles.page}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Field label="Name">
        <input className={styles.input} value={form.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <div className={styles.section}>
        <span className={styles.label}>Category</span>
        <CategoryPicker value={form.category} onChange={(category) => set({ category })} />
      </div>
      <div className={styles.section}>
        <span className={styles.label}>On the map</span>
        <PinPicker value={form.location} onChange={(location) => set({ location })} />
      </div>
      <Field label="Address">
        <input className={styles.input} value={form.address} onChange={(e) => set({ address: e.target.value })} placeholder="Optional" />
      </Field>
      <Field label="Cuisine">
        <input className={styles.input} value={form.cuisine} onChange={(e) => set({ cuisine: e.target.value })} placeholder="Optional" />
      </Field>
      {isFood(form.category) && (
        <div className={styles.section}>
          <span className={styles.label}>Wallet bleeder</span>
          <div className={styles.row}>
            <input
              className={`${styles.input} ${styles.grow}`}
              aria-label="Signature dish"
              placeholder="Signature dish"
              value={form.dishName}
              onChange={(e) => set({ dishName: e.target.value })}
            />
            <input
              className={styles.input}
              style={{ width: "8rem" }}
              aria-label="Menu price in rupees"
              placeholder="₹ price"
              inputMode="numeric"
              value={form.dishPrice}
              onChange={(e) => set({ dishPrice: e.target.value })}
            />
          </div>
        </div>
      )}
      {chainFor && (
        <Field label="Part of a chain">
          <input
            className={styles.input}
            value={form.chainName ?? ""}
            onChange={(e) => set({ chainName: e.target.value })}
            placeholder="Chain name, if it has other outlets (optional)"
          />
        </Field>
      )}
      <div className={styles.section}>
        <span className={styles.label}>Links</span>
        {form.sourceLinks.map((l) => (
          <div key={l} className={styles.row}>
            <span className={styles.grow} style={{ overflowWrap: "anywhere" }}>
              {l}
            </span>
            <button type="button" className={styles.textbutton} onClick={() => set({ sourceLinks: form.sourceLinks.filter((x) => x !== l) })}>
              Remove
            </button>
          </div>
        ))}
        <input className={styles.input} value={newLink} onChange={(e) => setNewLink(e.target.value)} placeholder="Add a link (optional)" inputMode="url" />
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.row}>
        <button type="button" className={styles.secondary} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className={`${styles.primary} ${styles.grow}`} disabled={saving}>
          {saving ? "Saving…" : "Save details"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className={styles.section}>
      <span className={styles.label}>{label}</span>
      {children}
    </label>
  );
}
