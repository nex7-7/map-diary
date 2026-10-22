"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useItems } from "@/app/_entries/use-items";
import { AccountPage, accountStyles as s } from "@/app/_account/parts";
import { ProfileEditor } from "@/app/_account/profile-editor";
import { sealDate } from "@/app/diary/places-list";
import { listDevices, type Diary } from "@/lib/device";
import { useGroups } from "@/lib/groups";
import { profilesOf } from "@/lib/places/items-source";
import { EMPTY_FILTERS, filterPlaces } from "@/lib/places/filter";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge, Icon } from "@/lib/ui";
import y from "./you.module.css";

/** `/profile`, the You tab: the inside cover of the diary, your stamps, and its contents. */
export function ProfilePage() {
  return (
    <AccountPage current="you" title="" back={false}>
      {(diary) => <You diary={diary} />}
    </AccountPage>
  );
}

const STAMP_TILTS = ["-8deg", "6deg", "-3deg", "9deg", "-11deg", "4deg"];

function You({ diary }: { diary: Diary }) {
  const { loaded, items, snapshot, canChooseBoards } = useItems(diary);
  const me = diary.device.accountId;
  const profiles = useMemo(() => profilesOf(items), [items]);
  const mine = profiles.get(me);
  const taken = [...profiles].filter(([id]) => id !== me).map(([, p]) => p.name);
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
  const myPlaces = useMemo(() => filterPlaces(snapshot.places, EMPTY_FILTERS, me).filter((l) => l.mine), [snapshot, me]);
  const visited = myPlaces
    .filter((l) => l.status === "visited")
    .map((l) => ({ l, at: l.place.opinions.find((o) => o.kind === "status" && o.authorId === me)?.updatedAt ?? l.addedAt }))
    .sort((a, b) => b.at.localeCompare(a.at));
  const toGo = myPlaces.length - visited.length;
  const mineTags = snapshot.tags.filter((t) => t.authorId === me).length;
  const since = myPlaces.map((l) => l.addedAt).sort()[0];
  const master = canChooseBoards ? snapshot.boards.find((b) => b.kind === "master") : undefined;
  const avatar = mine?.avatar;

  const contents: { href: string; title: string; value: string; claude?: boolean }[] = [
    { href: "/boards", title: "Boards and groups", value: String(snapshot.boards.length || (groups ? groups.length + 2 : "")) },
    { href: "/tags", title: "Tags", value: loaded ? String(mineTags) : "" },
    { href: "/devices", title: "Devices", value: devices ? String(devices.count) : "" },
    { href: "/devices", title: "Claude", value: devices ? (devices.claude ? "connected" : "not connected") : "", claude: devices?.claude === true },
    ...(isAdmin ? [{ href: "/admin", title: "Admin", value: "only you" }] : []),
  ];

  return (
    <>
      <p className="kicker -mb-2 text-center">Inside the cover</p>
      <section className={y.cover}>
        <span className="tape left-1/2 -top-2.5 -ml-8 [transform:rotate(-3deg)]" aria-hidden />
        <div className="flex items-start gap-3.5">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="kicker">This diary belongs to</span>
            <span className="relative self-start">
              <span className="hand pop inline-block text-[44px] leading-[1.15] [--r:-2deg]" style={{ animationDelay: "0.1s" }}>
                {name || "You"}
              </span>
              <svg viewBox="0 0 140 12" className="absolute -bottom-1 left-0 h-2.5 w-full" preserveAspectRatio="none" aria-hidden>
                <path d="M2 8c30-5 70-6 136-2" className="draw-path" fill="none" stroke="var(--seal)" strokeWidth="2.4" strokeLinecap="round" style={{ animationDelay: "0.45s" }} />
              </svg>
            </span>
            <span className="mt-1.5 text-[13px] text-ink-2">
              Mumbai{since ? ` · keeping it since ${new Date(since).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}` : ""}
            </span>
            {isAdmin && (
              <span className="mt-1.5">
                <Badge tone="ok">
                  <Icon name="shield" size="s" />
                  Admin
                </Badge>
              </span>
            )}
          </div>
          <div className={`pop ${y.polaroid} [--r:5deg]`} style={{ animationDelay: "0.25s" }}>
            <span className="tape left-6 -top-2 h-4 w-11 [transform:rotate(4deg)]" aria-hidden />
            {avatar?.kind === "photo" ? (
              <img src={avatar.dataUrl} alt="" className="size-[78px] object-cover" />
            ) : (
              <span className="grit grid size-[78px] place-items-center bg-seal font-serif text-[44px] text-cream" aria-hidden>
                {avatar?.kind === "emoji" ? avatar.emoji : ([...(name || "Y")][0]?.toUpperCase() ?? "Y")}
              </span>
            )}
          </div>
        </div>
      </section>

      <div className={`rise ${y.stats}`} style={{ animationDelay: "0.3s" }}>
        <Stat n={visited.length} label="stamped" ink="var(--seal)" />
        <Stat n={toGo} label="to go" ink="var(--graphite)" />
        <Stat n={snapshot.boards.length} label="boards" ink="var(--plum)" />
        <Stat n={mineTags} label="tags" ink="var(--indigo)" />
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="display text-[28px]">
            Stamp <i>collection</i>
          </h2>
          {visited.length > 6 && (
            <Link href="/?view=list" className="sketch-link text-[13px] font-semibold">
              All {visited.length}
            </Link>
          )}
        </div>
        {visited.length === 0 ? (
          <p className={y.empty}>No stamps yet. Mark a place Visited and its seal lands here.</p>
        ) : (
          <div className={y.stamps}>
            {visited.slice(0, 6).map(({ l, at }, i) => (
              <Link key={l.place.id} href={`/place#${encodeURIComponent(l.place.id)}`} className="flex flex-col items-center gap-1.5 text-center text-ink no-underline">
                <span className="seal slam size-[72px] gap-0.5" style={{ "--r": STAMP_TILTS[i], animationDelay: `${400 + i * 90}ms` } as CSSProperties}>
                  <span className="text-[7px] tracking-[0.14em]">Visited</span>
                  <span className="text-[15px]">{sealDate(at)}</span>
                </span>
                <span className="text-[11.5px] leading-tight font-semibold">{l.place.name}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col">
        <h2 className="display mb-1 text-[28px]">Contents</h2>
        {contents.map((c) => (
          <Link key={c.title} href={c.href} className={y.toc}>
            <span>{c.title}</span>
            <span className={y.lead} aria-hidden />
            <span className={y.val} style={c.claude ? { color: "var(--clay)" } : undefined}>
              {c.value}
            </span>
          </Link>
        ))}
        {loaded && (
          <Collapsible>
            <CollapsibleTrigger className={y.toc}>
              <span>Name and picture</span>
              <span className={y.lead} aria-hidden />
              <span className={y.val}>{name ? "set" : "not yet"}</span>
              <span className={y.chev}>
                <Icon name="chevronRight" size="m" />
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="rise pb-3">
              {master ? (
                <div className={s.card}>
                  <ProfileEditor diary={diary} masterId={master.id} current={mine} takenNames={taken} />
                </div>
              ) : (
                <p className="hand m-0 text-[15.5px] text-ink-2">You can set a name and picture once the Public board is ready. Until then friends see you as “Friend”.</p>
              )}
            </CollapsibleContent>
          </Collapsible>
        )}
      </section>
    </>
  );
}

function Stat({ n, label, ink }: { n: number; label: string; ink: string }) {
  return (
    <div className={y.stat}>
      <span className="worn text-[28px] leading-none" style={{ color: ink }}>
        {n}
      </span>
      <span className="kicker text-[9.5px]">{label}</span>
    </div>
  );
}
