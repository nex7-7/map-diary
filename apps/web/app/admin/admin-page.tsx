"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import entries from "@/app/_entries/entries.module.css";
import { inviteErrorMessage } from "@/app/(device)/messages";
import {
  DeviceGate,
  cancelInvite,
  inviteFriend,
  inviteNotes,
  members as listMembers,
  openInvites,
  removeFromApp,
  saveInviteNote,
  type AppInviteView,
  type Diary,
  type MemberView,
  type NewAppInvite,
} from "@/lib/device";
import styles from "@/lib/device/device.module.css";

const day = (ms: number) => new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** `/admin`: app invites and members. Hidden; the Worker refuses everyone but the admin. */
export function AdminPage() {
  return (
    <main>
      <Link href="/devices" className={entries.back}>
        ← Devices
      </Link>
      <h1 style={{ margin: "12px 0 16px" }}>Invites and members</h1>
      <DeviceGate>{(diary) => <Admin diary={diary} />}</DeviceGate>
    </main>
  );
}

interface AdminData {
  invites: AppInviteView[];
  members: MemberView[];
}

function Admin({ diary }: { diary: Diary }) {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setNotes(inviteNotes());
    Promise.all([openInvites(diary), listMembers(diary)]).then(
      ([invites, members]) => {
        setData({ invites, members });
        setError(null);
      },
      (err: unknown) => setError(inviteErrorMessage(err)),
    );
  }, [diary]);
  useEffect(load, [load]);

  if (error && !data) return <p className={styles.error}>{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Invite diary={diary} onMade={load} />
      {data.invites.length > 0 && (
        <section className={styles.card}>
          <h2 style={{ margin: 0 }}>Open invites</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
            {data.invites.map((i) => (
              <li key={i.id}>
                <strong>{notes[i.id] ?? "Invite"}</strong>
                <br />
                <span className="muted">
                  Made {day(i.createdAt)} · expires {day(i.expiresAt)}
                </span>
                <CancelInvite diary={diary} id={i.id} onDone={load} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className={styles.card}>
        <h2 style={{ margin: 0 }}>Members</h2>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
          {data.members.map((m) => (
            <Member key={m.id} diary={diary} member={m} note={m.inviteId ? notes[m.inviteId] : undefined} onDone={load} />
          ))}
        </ul>
      </section>
    </div>
  );
}

/** Makes a one-time invite and shows its link and code to send. */
function Invite({ diary, onMade }: { diary: Diary; onMade: () => void }) {
  const [note, setNote] = useState("");
  const [made, setMade] = useState<NewAppInvite | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function make(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const invite = await inviteFriend(diary);
      saveInviteNote(invite.id, note.trim());
      setMade(invite);
      setNote("");
      onMade();
    } catch (err) {
      setError(inviteErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const message = made
    ? `Join my Mumbai places diary: ${made.link}\n\nOn iPhone, add the page to your Home Screen first, open it from there and type this code: ${made.code}`
    : "";

  async function share() {
    if (!made) return;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ text: message });
        return;
      } catch {
        // Cancelled, or sharing unavailable: fall back to copying.
      }
    }
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
    } catch {
      setError("Couldn't copy. Select the link and copy it by hand.");
    }
  }

  if (made) {
    return (
      <section className={styles.card}>
        <h2 style={{ margin: 0 }}>Invite ready</h2>
        <p>Send this link. It works once, until {day(made.expiresAt)}. On an iPhone they type the code in the installed app.</p>
        <p style={{ wordBreak: "break-all", margin: 0 }}>{made.link}</p>
        <p className={styles.code}>{made.code}</p>
        <p className="muted">The code is shown only now. If you lose it, cancel this invite and make another.</p>
        {error && <p className={styles.error}>{error}</p>}
        <button className={styles.button} type="button" onClick={() => void share()}>
          {copied ? "Copied" : "Share or copy"}
        </button>
        <button className={styles.secondary} type="button" onClick={() => setMade(null)}>
          Done
        </button>
      </section>
    );
  }

  return (
    <form className={styles.card} onSubmit={(e) => void make(e)}>
      <h2 style={{ margin: 0 }}>Invite a friend</h2>
      <label className={styles.field}>
        <span>Who is it for? (optional)</span>
        <input value={note} maxLength={60} onChange={(e) => setNote(e.target.value)} />
        <span className="muted">Kept only on this device, so you can tell members apart.</span>
      </label>
      {error && <p className={styles.error}>{error}</p>}
      <button className={styles.button} type="submit" disabled={busy}>
        {busy ? "Making…" : "Make an invite link"}
      </button>
    </form>
  );
}

function CancelInvite({ diary, id, onDone }: { diary: Diary; id: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function cancel() {
    setBusy(true);
    try {
      await cancelInvite(diary, id);
      saveInviteNote(id, "");
      onDone();
    } catch (err) {
      setError(inviteErrorMessage(err));
      setBusy(false);
    }
  }
  return (
    <>
      {error && <p className={styles.error}>{error}</p>}
      <button className={styles.secondary} type="button" disabled={busy} onClick={() => void cancel()}>
        {busy ? "Cancelling…" : "Cancel invite"}
      </button>
    </>
  );
}

function Member({ diary, member, note, onDone }: { diary: Diary; member: MemberView; note: string | undefined; onDone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const you = member.id === diary.device.accountId;
  const name = you ? "You" : (note ?? `Member since ${day(member.createdAt)}`);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await removeFromApp(diary, member.id);
      setConfirming(false);
      onDone();
    } catch (err) {
      setError(inviteErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li>
      <strong>{name}</strong>
      {member.isAdmin && " (admin)"}
      <br />
      <span className="muted">
        {member.removedAt !== null
          ? `Removed ${day(member.removedAt)}`
          : `Joined ${day(member.createdAt)} · ${member.devices} ${member.devices === 1 ? "device" : "devices"}` +
            (member.lastSeenAt !== null ? ` · last used ${day(member.lastSeenAt)}` : "")}
      </span>
      {error && <p className={styles.error}>{error}</p>}
      {!you && member.removedAt === null && !member.isAdmin &&
        (confirming ? (
          <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
            <p>
              Remove {note ?? "this member"} from the app? Every device of theirs is signed out at once and they can&apos;t
              sign back in. This can&apos;t be undone; to have them back, send a new invite.
            </p>
            <button className={styles.button} type="button" disabled={busy} onClick={() => void remove()}>
              {busy ? "Removing…" : "Remove from the app"}
            </button>
            <button className={styles.secondary} type="button" disabled={busy} onClick={() => setConfirming(false)}>
              Keep them
            </button>
          </div>
        ) : (
          <button className={styles.secondary} type="button" onClick={() => setConfirming(true)}>
            Remove
          </button>
        ))}
    </li>
  );
}
