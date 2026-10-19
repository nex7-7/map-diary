"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useItems } from "@/app/_entries/use-items";
import { AccountPage, Avatar, IconTile, accountStyles as s } from "@/app/_account/parts";
import { listDevices, type Diary } from "@/lib/device";
import { setDisplayName } from "@/lib/entries/actions";
import { useGroups } from "@/lib/groups";
import { DISPLAY_NAME_MAX } from "@/lib/places/payloads";
import { Badge, Button, Icon, type IconName } from "@/lib/ui";

/** `/profile`, the You tab: your name, and the screens about your account. */
export function ProfilePage() {
  return (
    <AccountPage current="you" title="" back={false}>
      {(diary) => <You diary={diary} />}
    </AccountPage>
  );
}

function You({ diary }: { diary: Diary }) {
  const { loaded, snapshot, canChooseBoards } = useItems(diary);
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
        <Avatar big id={diary.device.accountId} name={name || "You"} />
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

      {loaded && <NameForm diary={diary} current={name} masterId={master?.id} masterName={master?.name} />}
    </>
  );
}

function NameForm({ diary, current, masterId, masterName }: { diary: Diary; current: string; masterId: string | undefined; masterName: string | undefined }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [state, setState] = useState<{ kind: "idle" } | { kind: "saved"; name: string } | { kind: "error"; message: string }>({ kind: "idle" });
  const value = draft ?? current;

  if (!masterId) {
    return (
      <p className="sub" style={{ margin: 0 }}>
        You can set a name once the Public board is ready. Until then friends see you as “Friend”.
      </p>
    );
  }
  return (
    <form
      className={s.sec}
      onSubmit={(e) => {
        e.preventDefault();
        setState({ kind: "idle" });
        setDisplayName(diary, value, masterId)
          .then((name) => {
            setDraft(null);
            setState({ kind: "saved", name });
          })
          .catch((err: unknown) => setState({ kind: "error", message: err instanceof Error ? err.message : "Could not save" }));
      }}
    >
      <label className="overline" htmlFor="your-name">
        Your name
      </label>
      <div className={s.inline}>
        <input
          id="your-name"
          className={`${s.input} ${s.onSurface}`}
          autoComplete="nickname"
          maxLength={DISPLAY_NAME_MAX}
          value={value}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button type="submit" size="m" variant="secondary" disabled={!value.trim() || value.trim() === current}>
          Save
        </Button>
      </div>
      <p className={s.hint}>Everyone on the app sees this next to your opinions. It is encrypted on the {masterName ?? "Public"} board.</p>
      {state.kind === "saved" && (
        <p className={s.okText} role="status">
          Saved. Friends see you as {state.name}.
        </p>
      )}
      {state.kind === "error" && (
        <p className={s.error} role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}
