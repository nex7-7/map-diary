"use client";

import { useState, type FormEvent } from "react";
import { AccountPage, Avatar, IconTile, accountStyles as s, day } from "@/app/_account/parts";
import type { Diary } from "@/lib/device";
import {
  GROUP_NAME_MAX,
  MAX_GROUP_MEMBERS,
  inviteLink,
  inviteSecretFrom,
  leave,
  newGroup,
  renameGroupTo,
  useGroups,
  type Group,
} from "@/lib/groups";
import { Button, buttonClass, CloseButton, CopyCode, Icon, Sheet } from "@/lib/ui";
import { userMessage } from "@/lib/errors";

/** `/groups`: the groups this account is in, their members, invites, and leaving. */
export function GroupsPage() {
  return (
    <AccountPage current="groups" title="Groups" sub="Each group has its own key. Only members can read what’s posted to it." wide>
      {(diary) => <Groups diary={diary} />}
    </AccountPage>
  );
}

/** Members can only leave a group; nobody removes anyone else. */
type Confirm = { kind: "leave"; group: Group } | null;

function Groups({ diary }: { diary: Diary }) {
  const { groups, failed, reload } = useGroups(diary);
  const [confirm, setConfirm] = useState<Confirm>(null);
  return (
    <>
      {failed && <p className={s.error}>Couldn&apos;t load your groups. Check your connection and reload.</p>}
      <div className={s.grid2}>
        <div className={s.stackCol}>
          {groups === null ? (
            <p className="sub">Loading…</p>
          ) : groups.length === 0 ? (
            <p className="sub" style={{ margin: 0 }}>
              You&apos;re not in any group yet. Make one, or open an invite link a friend sent you.
            </p>
          ) : (
            groups.map((g, i) => (
              <GroupCard key={g.id} diary={diary} group={g} startOpen={i === 0} onChange={reload} onConfirm={setConfirm} />
            ))
          )}
        </div>
        <div className={s.stackCol}>
          <CreateGroup diary={diary} onDone={reload} />
          <PasteInvite />
        </div>
      </div>
      <Sheet open={confirm !== null} onClose={() => setConfirm(null)} label="Leave a group">
        {confirm && (
          <ConfirmSheet
            diary={diary}
            confirm={confirm}
            onCancel={() => setConfirm(null)}
            onDone={() => {
              setConfirm(null);
              reload();
            }}
          />
        )}
      </Sheet>
    </>
  );
}

function GroupCard({
  diary,
  group,
  startOpen,
  onChange,
  onConfirm,
}: {
  diary: Diary;
  group: Group;
  startOpen: boolean;
  onChange: () => void;
  onConfirm: (c: Confirm) => void;
}) {
  const me = diary.device.accountId;
  const [open, setOpen] = useState(startOpen);
  const [invite, setInvite] = useState<{ link: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const full = group.members.length >= MAX_GROUP_MEMBERS;
  const name = group.name || "Unnamed group";
  // You first, then everyone else as the Worker lists them.
  const members = [...group.members].sort((a, b) => Number(b.accountId === me) - Number(a.accountId === me));

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChange();
      return true;
    } catch (err) {
      setError(userMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const whatsapp = invite ? `https://wa.me/?text=${encodeURIComponent(`Join "${group.name}" on our Mumbai map: ${invite.link}`)}` : null;

  return (
    <section className={s.card}>
      {renaming ? (
        <RenameGroup
          initial={group.name}
          onCancel={() => setRenaming(false)}
          onSave={(n) => void run(() => renameGroupTo(diary, group, n)).then((ok) => ok && setRenaming(false))}
        />
      ) : (
        <div className={s.rowTitle} style={{ flexWrap: "nowrap" }}>
          <div className={s.rowText}>
            <h2 className="heading-m">{name}</h2>
            <span className="sub">
              {group.members.length} of {MAX_GROUP_MEMBERS} members
            </span>
          </div>
          <span className={s.faces}>
            {members.slice(0, 5).map((m) => (
              <Avatar key={m.accountId} id={m.accountId} name={m.name} avatar={m.avatar} />
            ))}
          </span>
        </div>
      )}

      {open ? (
        <>
          <ul className={s.list}>
            {members.map((m) => {
              const you = m.accountId === me;
              return (
                <li key={m.accountId} className={s.row} style={{ padding: "10px 0" }}>
                  <Avatar id={m.accountId} name={m.name} avatar={m.avatar} />
                  <span className={s.rowText}>
                    <span className={s.plainName}>{m.name}</span>
                  </span>
                  {you && (
                    <Button variant="ghost" size="m" className={s.dangerText} onClick={() => onConfirm({ kind: "leave", group })}>
                      Leave
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>

          {invite ? (
            <div className={s.card} style={{ background: "var(--paper)" }}>
              <p style={{ margin: 0 }}>
                Send this link to one friend who’s already on the app. It works once, until {day(invite.expiresAt)}.
              </p>
              <CopyCode label="invite link" value={invite.link} />
              <div className={s.buttons}>
                {whatsapp && (
                  <a className={buttonClass({ size: "m" })} href={whatsapp} target="_blank" rel="noreferrer">
                    <Icon name="share" size="s" />
                    Send on WhatsApp
                  </a>
                )}
                <Button variant="ghost" size="m" onClick={() => setInvite(null)}>
                  Done
                </Button>
              </div>
            </div>
          ) : (
            !renaming && (
              <div className={s.buttons}>
                <Button
                  size="m"
                  disabled={busy || full || !group.name}
                  onClick={() => void run(async () => setInvite(await inviteLink(diary, group)))}
                >
                  <Icon name="link" size="s" />
                  {full ? `Full (${MAX_GROUP_MEMBERS} people)` : busy ? "Making a link…" : "Invite someone"}
                </Button>
                <Button variant="ghost" size="m" onClick={() => setRenaming(true)}>
                  <Icon name="pencil" size="s" />
                  Rename
                </Button>
              </div>
            )
          )}
        </>
      ) : (
        <button type="button" className={s.iconButton} style={{ justifySelf: "start", color: "var(--sea)", fontWeight: 500, gap: 4, display: "inline-flex" }} onClick={() => setOpen(true)} aria-expanded={false}>
          Show members
          <Icon name="chevronDown" size="s" />
        </button>
      )}
      {error && <p className={s.error}>{error}</p>}
    </section>
  );
}

function ConfirmSheet({ diary, confirm, onCancel, onDone }: { diary: Diary; confirm: NonNullable<Confirm>; onCancel: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const group = confirm.group.name || "this group";

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await leave(diary, confirm.group.id);
      onDone();
    } catch (err) {
      setError(userMessage(err));
      setBusy(false);
    }
  }

  return (
    <>
      <div className={s.sheetTop}>
        <IconTile name="users" tone="danger" large />
        <CloseButton onClick={onCancel} />
      </div>
      <h2 className="heading-m">{`Leave ${group}?`}</h2>
      <p style={{ margin: 0, color: "var(--ink-2)" }}>
        Everything you posted to it disappears for everyone in it, and the group gets a new key.
      </p>
      {error && <p className={s.error}>{error}</p>}
      <Button variant="danger" block disabled={busy} onClick={() => void go()}>
        {busy ? "Leaving…" : "Leave group"}
      </Button>
      <Button variant="ghost" block disabled={busy} onClick={onCancel}>
        Stay
      </Button>
    </>
  );
}

function RenameGroup({ initial, onSave, onCancel }: { initial: string; onSave: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial);
  return (
    <form
      className={s.inline}
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSave(name);
      }}
    >
      <input className={s.input} aria-label="Group name" value={name} maxLength={GROUP_NAME_MAX} onChange={(e) => setName(e.target.value)} autoFocus />
      <Button type="submit" size="m" disabled={!name.trim()}>
        Save
      </Button>
      <Button variant="ghost" size="m" onClick={onCancel}>
        Cancel
      </Button>
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
      setError(userMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={s.sec} onSubmit={(e) => void submit(e)}>
      <label className="kicker" htmlFor="group-name">
        Make a group
      </label>
      <div className={s.inline}>
        <input
          id="group-name"
          className={`${s.input} ${s.onSurface}`}
          value={name}
          maxLength={GROUP_NAME_MAX}
          placeholder="Name, like Bandra lot"
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" size="m" disabled={busy || !name.trim()}>
          {busy ? "Making…" : "Make group"}
        </Button>
      </div>
      {error && <p className={s.error}>{error}</p>}
    </form>
  );
}

/** On iPhone an invite link opens in Safari, not the installed app, so it can be pasted here. */
function PasteInvite() {
  const [text, setText] = useState("");
  const secret = inviteSecretFrom(text);
  return (
    <form
      className={s.sec}
      onSubmit={(e) => {
        e.preventDefault();
        if (secret) window.location.assign(`/join#${secret}`);
      }}
    >
      <label className="kicker" htmlFor="invite-link">
        Got an invite?
      </label>
      <div className={s.inline}>
        <input
          id="invite-link"
          className={`${s.input} ${s.onSurface}`}
          value={text}
          placeholder="Paste the link here"
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" size="m" disabled={!secret}>
          Open
        </Button>
      </div>
    </form>
  );
}
