import Link from "next/link";
import type { Person } from "@/lib/places/types";

/** The way to You on a phone: your initial (or picture) stamped in the top corner. */
export function MeLink({ me }: { me: Person }) {
  const avatar = me.avatar;
  const name = me.name === "Me" ? "" : me.name;
  return (
    <Link href="/profile" className="me min-[900px]:hidden" aria-label="You">
      {avatar?.kind === "photo" ? (
        <img src={avatar.dataUrl} alt="" className="size-full object-cover" />
      ) : avatar?.kind === "emoji" ? (
        <span className="text-[18px]">{avatar.emoji}</span>
      ) : (
        ([...name.trim()][0]?.toUpperCase() ?? "Y")
      )}
    </Link>
  );
}
