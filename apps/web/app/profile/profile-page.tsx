"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useItems } from "@/app/_entries/use-items";
import { AccountPage, Avatar, IconTile, accountStyles as s } from "@/app/_account/parts";
import { ProfileEditor } from "@/app/_account/profile-editor";
import { listDevices, type Diary } from "@/lib/device";
import { useGroups } from "@/lib/groups";
import { profilesOf } from "@/lib/places/items-source";
import { Badge, Icon, type IconName } from "@/lib/ui";

/** `/profile`, the You tab: your name and picture, and the screens about your account. */
export function ProfilePage() {
  return (
    <AccountPage current="you" title="" back={false}>
      {(diary) => <You diary={diary} />}
    </AccountPage>
  );
}

function You({ diary }: { diary: Diary }) {
  const { loaded, items, snapshot, canChooseBoards } = useItems(diary);
  const profiles = useMemo(() => profilesOf(items), [items]);
  const mine = profiles.get(diary.device.accountId);
  const taken = [...profiles].filter(([id]) => id !== diary.device.accountId).map(([, p]) => p.name);
  const { groups } = useGroups(diary);
  const [devices, setDevices] = useState<{ count: number; claude: boolean } | null>(null);
  useEffect(() => {
    listDevices(diary).then(
      (o) => setDevices({ count: o.devices.length, claude: o.devices.some((d) => d.kind === "claude") }),
      () => undefined,
    );
  }, [diary]);

  const isAdmin = diary.device.isAdmin === true;
  const name = snapshot.me.name === "Me" ? "" : snapshot.me.name;
  const mineTags = snapshot.tags.filter((t) => t.authorId === diary.device.accountId).length;
  const master = canChooseBoards ? snapshot.boards.find((b) => b.kind === "master") : undefined;

  const links: { href: string; icon: IconName; title: string; sub: string }[] = [
    {
      href: "/devices",
      icon: "phone",
      title: "Devices",
      sub: devices ? `${devices.count} ${devices.count === 1 ? "device" : "devices"}${devices.claude ? ", including Claude" : ""}` : "Your phones, computers and Claude",
    },
    {
      href: "/groups",
      icon: "users",
      title: "Groups",
      sub: groups && groups.length > 0 ? groups.map((g) => g.name || "Unnamed group").join(", ") : "Make a group or join one",
    },
    { href: "/tags", icon: "tag", title: "Tags", sub: loaded ? `${mineTags} ${mineTags === 1 ? "tag" : "tags"}` : "Your tags and what they mean" },
    ...(isAdmin ? [{ href: "/admin", icon: "shield" as const, title: "Admin", sub: "Invites and members" }] : []),
  ];

  return (
    <>
      <div className={s.rowTitle} style={{ gap: 14, flexWrap: "nowrap" }}>
        <Avatar big id={diary.device.accountId} name={name || "You"} avatar={mine?.avatar} />
        <div className={s.rowText}>
          <h1 className="display">{name || "You"}</h1>
          {isAdmin && (
            <span>
              <Badge tone="ok">
                <Icon name="shield" size="s" />
                Admin
              </Badge>
            </span>
          )}
        </div>
      </div>

      <nav className={`${s.card} ${s.flush}`} aria-label="Your account">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className={s.linkRow}>
            <IconTile name={l.icon} />
            <span className={s.rowText}>
              <span className={s.name}>{l.title}</span>
              <span className="sub" style={{ overflowWrap: "anywhere" }}>
                {l.sub}
              </span>
            </span>
            <Icon name="chevronRight" size="m" />
          </Link>
        ))}
      </nav>

      {loaded &&
        (master ? (
          <section className={s.card}>
            <h2 className="heading-s">Name and picture</h2>
            <ProfileEditor diary={diary} masterId={master.id} current={mine} takenNames={taken} />
          </section>
        ) : (
          <p className="sub" style={{ margin: 0 }}>
            You can set a name and picture once the Public board is ready. Until then friends see you as “Friend”.
          </p>
        ))}
    </>
  );
}
