"use client";

import Link from "next/link";
import { useState } from "react";
import { useItems } from "@/app/_entries/use-items";
import styles from "@/app/_entries/entries.module.css";
import { DeviceGate, type Diary } from "@/lib/device";
import { setDisplayName } from "@/lib/entries/actions";
import { DISPLAY_NAME_MAX } from "@/lib/places/payloads";
import { DiaryShell } from "@/app/_shell/diary-shell";

/** The other screens under You on a phone, until You gets its own design. */
function YourScreens({ isAdmin }: { isAdmin: boolean }) {
  const links: [string, string][] = [
    ["/devices", "Devices"],
    ["/groups", "Groups"],
    ["/tags", "Tags"],
    ...(isAdmin ? ([["/admin", "Admin"]] as [string, string][]) : []),
  ];
  return (
    <nav className={styles.section} aria-label="More" style={{ marginTop: 32 }}>
      {links.map(([href, label]) => (
        <Link key={href} href={href} className={styles.secondary}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

/** `/profile`: the name everyone on the app sees next to your opinions. */
export function ProfilePage() {
  return (
    <DeviceGate>
      {(diary) => (
        <DiaryShell diary={diary} current="you">
          <main>
            <h1 className={styles.title} style={{ margin: "12px 0 16px" }}>
              Your name
            </h1>
            <NameForm diary={diary} />
            <YourScreens isAdmin={diary.device.isAdmin === true} />
          </main>
        </DiaryShell>
      )}
    </DeviceGate>
  );
}

function NameForm({ diary }: { diary: Diary }) {
  const { loaded, snapshot, canChooseBoards } = useItems(diary);
  const [draft, setDraft] = useState<string | null>(null);
  const [state, setState] = useState<{ kind: "idle" } | { kind: "saved"; name: string } | { kind: "error"; message: string }>({ kind: "idle" });
  if (!loaded) return <p className="muted">Opening…</p>;

  const master = canChooseBoards ? snapshot.boards.find((b) => b.kind === "master") : undefined;
  const current = snapshot.me.name === "Me" ? "" : snapshot.me.name;
  const value = draft ?? current;

  if (!master) {
    return <p className={styles.note}>You can set a name once the Public board is ready. Until then friends see you as “Friend”.</p>;
  }
  return (
    <form
      className={styles.page}
      onSubmit={(e) => {
        e.preventDefault();
        setState({ kind: "idle" });
        setDisplayName(diary, value, master.id)
          .then((name) => {
            setDraft(null);
            setState({ kind: "saved", name });
          })
          .catch((err: unknown) => setState({ kind: "error", message: err instanceof Error ? err.message : "Could not save" }));
      }}
    >
      <p className={styles.note}>
        Everyone on the app sees this name next to your opinions. It is encrypted on the <span className={styles.badge}>{master.name}</span> board like
        everything else.
      </p>
      <input
        className={styles.input}
        aria-label="Your name"
        autoComplete="nickname"
        maxLength={DISPLAY_NAME_MAX}
        value={value}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button type="submit" className={styles.secondary} disabled={!value.trim() || value.trim() === current}>
        Save
      </button>
      {state.kind === "saved" && <p className={styles.note} role="status">Saved. Friends see you as {state.name}.</p>}
      {state.kind === "error" && (
        <p className={styles.error} role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}
