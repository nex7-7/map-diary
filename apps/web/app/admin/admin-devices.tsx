"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { IconTile, accountStyles as s, day, seen } from "@/app/_account/parts";
import { inviteErrorMessage } from "@/app/(device)/messages";
import { allDevices, members as listMembers, signOut, type AdminDeviceView, type Diary, type MemberView } from "@/lib/device";
import { deviceNames } from "@/lib/device/names";
import { Badge, Button, FilterChip, type IconName, useConfirm } from "@/lib/ui";
import { useMemberNames } from "./member-names";

const KIND_LABEL: Record<string, string> = { web: "Web app", android: "Android app", claude: "Claude" };
const KIND_ICON: Record<string, IconName> = { web: "laptop", android: "phone", claude: "sparkles" };

/**
 * Every device on the app, by person. The admin can sign out anyone else's at once; that
 * person's own Devices screen then asks them to finish, which moves their account to new keys.
 * The admin's own devices are removed from the Devices screen, which does both in one go.
 */
export function AdminDevices({ diary }: { diary: Diary }) {
  const [devices, setDevices] = useState<AdminDeviceView[] | null>(null);
  const [people, setPeople] = useState<MemberView[]>([]);
  const [ownNames, setOwnNames] = useState<Map<string, string>>(new Map());
  const [showOut, setShowOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ask, confirmSheet] = useConfirm();
  const nameOf = useMemberNames(diary);
  const me = diary.device.accountId;

  const load = useCallback(() => {
    Promise.all([allDevices(diary), listMembers(diary), deviceNames(diary)]).then(
      ([d, m, names]) => {
        setDevices(d);
        setPeople(m);
        setOwnNames(names);
        setError(null);
      },
      (err: unknown) => setError(inviteErrorMessage(err)),
    );
  }, [diary]);
  useEffect(load, [load]);

  if (error && !devices) return <p className={s.error}>{error}</p>;
  if (!devices) return <p className="sub">Loading…</p>;

  const out = devices.filter((d) => d.revokedAt !== null);
  const shown = showOut ? devices : devices.filter((d) => d.revokedAt === null);
  const byPerson = people
    .map((p) => ({ person: p, devices: shown.filter((d) => d.accountId === p.id) }))
    .filter((g) => g.devices.length > 0);

  const signOutOne = async (d: AdminDeviceView, who: string) => {
    const ok = await ask({
      title: `Sign out ${who}'s ${KIND_LABEL[d.kind] ?? "device"}?`,
      body: `It stops syncing at once. ${who} then finishes removing it on their Devices screen with their passphrase or recovery phrase, which moves their boards to new keys.`,
      confirmLabel: "Sign it out",
      danger: true,
    });
    if (!ok) return;
    setError(null);
    setNotice(null);
    try {
      await signOut(diary, d.id);
      setNotice(`Signed out. ${who} will be asked to finish on their Devices screen.`);
      load();
    } catch (err) {
      setError(inviteErrorMessage(err));
    }
  };

  return (
    <div className={s.stackCol}>
      {error && <p className={s.error}>{error}</p>}
      {notice && (
        <p className={s.okText} role="status">
          {notice}
        </p>
      )}
      <div className={s.buttons}>
        <FilterChip on={showOut} onClick={() => setShowOut((v) => !v)}>
          Show signed-out devices ({out.length})
        </FilterChip>
      </div>
      {byPerson.map(({ person, devices: list }) => {
        const who = nameOf(person);
        const mine = person.id === me;
        return (
          <section key={person.id} className={s.card}>
            <h2 className="heading-s">
              {who}
              {person.removedAt !== null ? " (removed)" : ""}
            </h2>
            <ul className={s.list}>
              {list.map((d) => {
                const claude = d.kind === "claude";
                const name = mine && !claude ? (ownNames.get(d.id) ?? KIND_LABEL[d.kind]) : (KIND_LABEL[d.kind] ?? d.kind);
                return (
                  <li key={d.id} className={s.row} style={{ padding: "10px 0" }}>
                    <IconTile name={KIND_ICON[d.kind] ?? "laptop"} {...(claude ? { tone: "claude" as const } : {})} />
                    <span className={s.rowText}>
                      <span className={s.rowTitle}>
                        <span className={s.plainName}>{name}</span>
                        {d.id === diary.device.deviceId && <Badge tone="ok">This device</Badge>}
                        {d.revokedAt !== null && <Badge tone="warn">{d.rekeyDue ? "Signed out · owner to finish" : "Removed"}</Badge>}
                      </span>
                      <span className="sub">
                        Added {day(d.createdAt)} · {d.revokedAt !== null ? `out since ${day(d.revokedAt)}` : seen(d.lastSeenAt)}
                      </span>
                    </span>
                    {d.revokedAt === null && d.id !== diary.device.deviceId && person.removedAt === null &&
                      (mine ? (
                        <Link href="/devices" className={s.plainName} style={{ fontSize: 14 }}>
                          On Devices
                        </Link>
                      ) : (
                        <Button variant="ghost" size="m" className={s.dangerText} onClick={() => void signOutOne(d, who)}>
                          Sign out
                        </Button>
                      ))}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <p className={s.hint}>Friends name their devices on their own Personal board, so you see only the kind of each one.</p>
      {confirmSheet}
    </div>
  );
}
