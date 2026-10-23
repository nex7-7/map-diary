"use client";

import { useEffect, useMemo, useState } from "react";
import { day } from "@/app/_account/parts";
import { inviteNotes, useDiaryItems, type Diary, type MemberView } from "@/lib/device";
import { profilesOf } from "@/lib/places/items-source";

/** What to call each member: the name they chose, else who their invite was for, else when they joined. */
export function useMemberNames(diary: Diary): (m: MemberView) => string {
  const items = useDiaryItems(diary);
  const profiles = useMemo(() => profilesOf(items), [items]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  useEffect(() => setNotes(inviteNotes()), []);
  const me = diary.device.accountId;
  return (m: MemberView) => {
    const name = profiles.get(m.id)?.name;
    if (m.id === me) return name ?? "You";
    return name ?? (m.inviteId ? notes[m.inviteId] : undefined) ?? `Joined ${day(m.createdAt)}`;
  };
}
