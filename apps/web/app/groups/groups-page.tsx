"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import entries from "@/app/_entries/entries.module.css";
import { DeviceGate, type Diary } from "@/lib/device";
import styles from "@/lib/device/device.module.css";
import {
  GROUP_NAME_MAX,
  MAX_GROUP_MEMBERS,
  inviteLink,
  inviteSecretFrom,
  leave,
  newGroup,
  removeMember,
  renameGroupTo,
  useGroups,
  type Group,
} from "@/lib/groups";
import { groupErrorMessage } from "./messages";

/** `/groups`: the groups this account is in, their members, invites, and leaving. */
export function GroupsPage() {
  return (
    <main>
      <Link href="/" className={entries.back}>
        ← Diary
      </Link>
      <h1 style={{ margin: "12px 0 16px" }}>Groups</h1>
      <DeviceGate>{(diary) => <Groups diary={diary} />}</DeviceGate>
    </main>
  );
}

function Groups({ diary }: { diary: Diary }) {
  const { groups, failed, reload } = useGroups(diary);
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {failed && <p className={styles.error}>Couldn&apos;t load your groups. Check your connection and reload.</p>}
      {groups === null ? (
        <p className="muted">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="muted">You&apos;re not in any group yet. Make one, or open an invite link a friend sent you.</p>
      ) : (
        groups.map((g) => <GroupCard key={g.id} diary={diary} group={g} onChange={reload} />)
      )}
      <CreateGroup diary={diary} onDone={reload} />
      <PasteInvite />
    </div>
  );
}

function GroupCard({ diary, group, onChange }: { diary: Diary; group: Group; onChange: () => void }) {
  const me = diary.device.accountId;
  const [invite, setInvite] = useState<{ link: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "remove"; accountId: string } | { kind: "leave" } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const full = group.members.length >= MAX_GROUP_MEMBERS;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setConfirm(null);
      onChange();
    } catch (err) {
      setError(groupErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const whatsapp = invite
    ? `https://wa.me/?text=${encodeURIComponent(`Join "${group.name}" on our Mumbai map: ${invite.link}`)}`
    : null;

  return (
    <section className={styles.card}>
      {renaming ? (
        <RenameGroup
          initial={group.name}
          onCancel={() => setRenaming(false)}
          onSave={(name) => run(() => renameGroupTo(diary, group, name)).then(() => setRenaming(false))}
        />
      ) : (
        <h2 style={{ margin: 0 }}>
          {group.name || "Unnamed group"}{" "}
          <button className={entries.secondary} type="button" onClick={() => setRenaming(true)}>
            Rename
          </button>
        </h2>
      )}

      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
        {group.members.map((m) => (
          <li key={m.accountId}>
            {m.name}
            {m.accountId !== me &&
              (confirm?.kind === "remove" && confirm.accountId === m.accountId ? (
                <>
                  <p>
                    Remove {m.name}? Everything they posted to this group disappears for
                    everyone, and they won&apos;t see anything new here.
                  </p>
                  <button
                    className={entries.danger}
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => removeMember(diary, group.id, m.accountId))}
                  >
                    {busy ? "Removing…" : "Remove"}
                  </button>
                  <button className={entries.secondary} type="button" disabled={busy} onClick={() => setConfirm(null)}>
                    Keep
                  </button>
                </>
              ) : (
                <>
                  {" "}
                  <button
                    className={entries.secondary}
                    type="button"
                    onClick={() => setConfirm({ kind: "remove", accountId: m.accountId })}
                  >
                    Remove
                  </button>
                </>
              ))}
          </li>
        ))}
      </ul>

      {invite ? (
        <>
          <p>
            Send this link to one friend. It works once and expires on{" "}
            {new Date(invite.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}. They need to be
            on the app already.
          </p>
          <input className={entries.input} readOnly value={invite.link} onFocus={(e) => e.currentTarget.select()} />
          {whatsapp && (
            <a className={styles.button} href={whatsapp} target="_blank" rel="noreferrer">
              Send on WhatsApp
            </a>
          )}
          <button
            className={styles.secondary}
            type="button"
            onClick={() => void navigator.clipboard?.writeText(invite.link).catch(() => undefined)}
          >
            Copy link
          </button>
        </>
      ) : (
        <button
          className={styles.button}
          type="button"
          disabled={busy || full || !group.name}
          onClick={() => void run(async () => setInvite(await inviteLink(diary, group)))}
        >
          {full ? `Full (${MAX_GROUP_MEMBERS} people)` : "Invite someone"}
        </button>
      )}

      {confirm?.kind === "leave" ? (
        <>
          <p>Leave {group.name || "this group"}? Everything you posted to it disappears for everyone in it.</p>
          <button className={entries.danger} type="button" disabled={busy} onClick={() => void run(() => leave(diary, group.id))}>
            {busy ? "Leaving…" : "Leave"}
          </button>
          <button className={entries.secondary} type="button" disabled={busy} onClick={() => setConfirm(null)}>
            Stay
          </button>
        </>
      ) : (
        <button className={styles.secondary} type="button" onClick={() => setConfirm({ kind: "leave" })}>
          Leave group
        </button>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}

function RenameGroup({ initial, onSave, onCancel }: { initial: string; onSave: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSave(name);
      }}
    >
      <input className={entries.input} value={name} maxLength={GROUP_NAME_MAX} onChange={(e) => setName(e.target.value)} autoFocus />
      <button className={entries.primary} type="submit" disabled={!name.trim()}>
        Save
      </button>
      <button className={entries.secondary} type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

function CreateGroup({ diary, onDone }: { diary: Diary; onDone: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await newGroup(diary, name);
      setName("");
      onDone();
    } catch (err) {
      setError(groupErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.card} onSubmit={(e) => void submit(e)}>
      <label className={entries.label} htmlFor="group-name">
        New group
      </label>
      <input
        id="group-name"
        className={entries.input}
        value={name}
        maxLength={GROUP_NAME_MAX}
        placeholder="Name, like Bandra lot"
        onChange={(e) => setName(e.target.value)}
      />
      <button className={styles.button} type="submit" disabled={busy || !name.trim()}>
        {busy ? "Making…" : "Make group"}
      </button>
      {error && <p className={styles.error}>{error}</p>}
    </form>
  );
}

/** On iPhone an invite link opens in Safari, not the installed app, so it can be pasted here. */
function PasteInvite() {
  const [text, setText] = useState("");
  const secret = inviteSecretFrom(text);
  return (
    <form
      className={styles.card}
      onSubmit={(e) => {
        e.preventDefault();
        if (secret) window.location.assign(`/join#${secret}`);
      }}
    >
      <label className={entries.label} htmlFor="invite-link">
        Got an invite link?
      </label>
      <input
        id="invite-link"
        className={entries.input}
        value={text}
        placeholder="Paste it here"
        onChange={(e) => setText(e.target.value)}
      />
      <button className={styles.button} type="submit" disabled={!secret}>
        Open invite
      </button>
    </form>
  );
}
