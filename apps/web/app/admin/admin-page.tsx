"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AccountPage, Avatar, IconTile, accountStyles as s, day, seen } from "@/app/_account/parts";
import { userMessage } from "@/lib/errors";
import {
  cancelInvite,
  inviteFriend,
  inviteNotes,
  members as listMembers,
  openInvites,
  removeFromApp,
  saveInviteNote,
  useDiaryItems,
  type AppInviteView,
  type Diary,
  type MemberView,
  type NewAppInvite,
} from "@/lib/device";
import { profilesOf } from "@/lib/places/items-source";
import { Badge, Button, ChipRow, CloseButton, CopyCode, FilterChip, Icon, Sheet } from "@/lib/ui";
import { AdminData } from "./admin-data";
import { AdminDevices } from "./admin-devices";
import { AdminPlaces } from "./admin-places";
import { AdminResolver } from "./admin-resolver";

/**
 * `/admin`: members and invites, places, the resolver queue, every device, and the database.
 * The Worker refuses everyone but the admin.
 */
export function AdminPage() {
  return (
    <AccountPage current="admin" title="Admin" sub="You can change shared facts and membership. You still can’t read other people’s boards." wide>
      {(diary) => <AdminTabs diary={diary} />}
    </AccountPage>
  );
}

const TABS = [
  ["members", "Members"],
  ["places", "Places"],
  ["resolver", "Resolver"],
  ["devices", "Devices"],
  ["data", "Data"],
] as const;
type Tab = (typeof TABS)[number][0];

/** The section in the address (`/admin#places`), so a link can open one. */
function tabFromHash(): Tab {
  const hash = typeof window === "undefined" ? "" : window.location.hash.slice(1);
  return TABS.find(([t]) => t === hash)?.[0] ?? "members";
}

function AdminTabs({ diary }: { diary: Diary }) {
  const [tab, setTab] = useState<Tab>("members");
  useEffect(() => {
    setTab(tabFromHash());
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const pick = (t: Tab) => {
    setTab(t);
    history.replaceState(null, "", t === "members" ? window.location.pathname : `#${t}`);
  };
  return (
    <>
      <ChipRow label="Admin sections">
        {TABS.map(([t, label]) => (
          <FilterChip key={t} on={tab === t} onClick={() => pick(t)}>
            {label}
          </FilterChip>
        ))}
      </ChipRow>
      {tab === "members" && <Admin diary={diary} />}
      {tab === "places" && <AdminPlaces diary={diary} />}
      {tab === "resolver" && <AdminResolver diary={diary} />}
      {tab === "devices" && <AdminDevices diary={diary} />}
      {tab === "data" && <AdminData diary={diary} />}
    </>
  );
}

interface AdminData {
  invites: AppInviteView[];
  members: MemberView[];
}

export function Admin({ diary }: { diary: Diary }) {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<{ member: MemberView; name: string } | null>(null);
  const items = useDiaryItems(diary);
  const profiles = useMemo(() => profilesOf(items), [items]);
  const names = useMemo(() => new Map([...profiles].map(([id, p]) => [id, p.name])), [profiles]);

  const load = useCallback(() => {
    setNotes(inviteNotes());
    Promise.all([openInvites(diary), listMembers(diary)]).then(
      ([invites, members]) => {
        setData({ invites, members });
        setError(null);
      },
      (err: unknown) => setError(userMessage(err)),
    );
  }, [diary]);
  useEffect(load, [load]);

  if (error && !data) return <p className={s.error}>{error}</p>;
  if (!data) return <p className="sub">Loading…</p>;

  const me = diary.device.accountId;
  // The name they chose on the app, else who the invite was for, else when they joined.
  const nameOf = (m: MemberView) =>
    m.id === me ? (names.get(m.id) ?? "You") : (names.get(m.id) ?? (m.inviteId ? notes[m.inviteId] : undefined) ?? `Joined ${day(m.createdAt)}`);
  const active = data.members.filter((m) => m.removedAt === null);
  const removed = data.members.filter((m) => m.removedAt !== null);

  return (
    <div className={s.grid2}>
      <div className={s.stackCol}>
        <Invite diary={diary} onMade={load} />
        {data.invites.length > 0 && (
          <section className={s.card}>
            <h2 className="heading-s">Open invites</h2>
            <ul className={s.list}>
              {data.invites.map((i) => (
                <OpenInvite key={i.id} diary={diary} invite={i} note={notes[i.id]} onDone={load} />
              ))}
            </ul>
          </section>
        )}
      </div>
      <section className={s.card}>
        <h2 className="heading-s">Members · {active.length}</h2>
        <ul className={s.list}>
          {active.map((m) => {
            const you = m.id === me;
            const name = nameOf(m);
            return (
              <li key={m.id} className={s.row} style={{ padding: "10px 0" }}>
                <Avatar id={m.id} name={name} avatar={profiles.get(m.id)?.avatar} />
                <span className={s.rowText}>
                  <span className={s.rowTitle}>
                    <span className={s.plainName}>{name}</span>
                    {m.isAdmin && <Badge tone="ok">Admin</Badge>}
                  </span>
                  <span className="sub">
                    {you ? "You · " : `Joined ${day(m.createdAt)} · `}
                    {m.devices} {m.devices === 1 ? "device" : "devices"} · {seen(m.lastSeenAt)}
                  </span>
                </span>
                {!you && !m.isAdmin && (
                  <Button variant="ghost" size="m" className={s.dangerText} onClick={() => setRemoving({ member: m, name })}>
                    Remove
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        {removed.length > 0 && (
          <p className={s.hint}>
            Removed: {removed.map((m) => `${nameOf(m)} (${day(m.removedAt!)})`).join(", ")}
          </p>
        )}
        <p className={s.hint}>Removing someone gives everyone a new Public key. You still can’t read their Personal board or groups you’re not in.</p>
      </section>

      <Sheet open={removing !== null} onClose={() => setRemoving(null)} label="Remove a member">
        {removing && (
          <RemoveMember
            diary={diary}
            member={removing.member}
            name={removing.name}
            onCancel={() => setRemoving(null)}
            onDone={() => {
              setRemoving(null);
              load();
            }}
          />
        )}
      </Sheet>
    </div>
  );
}

/** Makes a one-time invite and shows its link and code to send. */
function Invite({ diary, onMade }: { diary: Diary; onMade: () => void }) {
  const [note, setNote] = useState("");
  const [made, setMade] = useState<(NewAppInvite & { note: string }) | null>(null);
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
      setMade({ ...invite, note: note.trim() });
      setNote("");
      setCopied(false);
      onMade();
    } catch (err) {
      setError(userMessage(err));
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

  return (
    <>
      {made && (
        <section className={`${s.card} ${s.ready}`}>
          <div className={s.buttons}>
            <Badge tone="ok">
              <Icon name="check" size="s" />
              Invite ready
            </Badge>
            <span className="sub">
              {made.note ? `for ${made.note} · ` : ""}until {day(made.expiresAt)}
            </span>
          </div>
          <CopyCode label="invite link" value={made.link} />
          <div className={s.field}>
            <span className={s.label}>Code for an iPhone</span>
            <p className={s.bigCode} style={{ fontSize: 18 }}>
              {made.code}
            </p>
          </div>
          <p className="sub" style={{ margin: 0 }}>
            The code is shown only now. If you lose it, cancel this invite and make another.
          </p>
          {error && <p className={s.error}>{error}</p>}
          <div className={s.buttons}>
            <Button size="m" onClick={() => void share()}>
              <Icon name="share" size="s" />
              {copied ? "Copied" : "Share or copy"}
            </Button>
            <Button variant="ghost" size="m" onClick={() => setMade(null)}>
              Done
            </Button>
          </div>
        </section>
      )}
      <form className={s.card} onSubmit={(e) => void make(e)}>
        <h2 className="heading-s">Invite a friend</h2>
        <label className={s.field}>
          <span className={s.label}>Who is it for? (optional)</span>
          <input className={s.input} value={note} maxLength={60} placeholder="Meera" onChange={(e) => setNote(e.target.value)} />
          <span className={s.hint}>Kept only on this device, so you can tell members apart.</span>
        </label>
        {!made && error && <p className={s.error}>{error}</p>}
        <div>
          <Button type="submit" size="m" disabled={busy}>
            {busy ? "Making…" : "Make an invite link"}
          </Button>
        </div>
      </form>
    </>
  );
}

function OpenInvite({ diary, invite, note, onDone }: { diary: Diary; invite: AppInviteView; note: string | undefined; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function cancel() {
    setBusy(true);
    try {
      await cancelInvite(diary, invite.id);
      saveInviteNote(invite.id, "");
      onDone();
    } catch (err) {
      setError(userMessage(err));
      setBusy(false);
    }
  }
  return (
    <li className={s.row} style={{ padding: "10px 0" }}>
      <span className={s.rowText}>
        <span className={s.plainName}>{note ? `For ${note}` : "Invite"}</span>
        <span className="sub">
          Made {day(invite.createdAt)} · expires {day(invite.expiresAt)}
        </span>
        {error && <span className={s.error}>{error}</span>}
      </span>
      <Button variant="ghost" size="m" disabled={busy} onClick={() => void cancel()}>
        {busy ? "Cancelling…" : "Cancel invite"}
      </Button>
    </li>
  );
}

function RemoveMember({ diary, member, name, onCancel, onDone }: { diary: Diary; member: MemberView; name: string; onCancel: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await removeFromApp(diary, member.id);
      onDone();
    } catch (err) {
      setError(userMessage(err));
      setBusy(false);
    }
  }

  return (
    <>
      <div className={s.sheetTop}>
        <IconTile name="user" tone="danger" large />
        <CloseButton onClick={onCancel} />
      </div>
      <h2 className="heading-m">Remove {name} from the app?</h2>
      <p style={{ margin: 0, color: "var(--ink-2)" }}>
        Every device of theirs is signed out at once and they can’t sign back in. Everyone gets a new Public key. This can’t be
        undone; to have them back, send a new invite.
      </p>
      {error && <p className={s.error}>{error}</p>}
      <Button variant="danger" block disabled={busy} onClick={() => void remove()}>
        {busy ? "Removing…" : "Remove from the app"}
      </Button>
      <Button variant="ghost" block disabled={busy} onClick={onCancel}>
        Keep them
      </Button>
    </>
  );
}
