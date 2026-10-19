"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  JOIN_PATH,
  acceptGroupInvite,
  createGroup,
  createGroupInvite,
  leaveGroup,
  listGroups,
  readGroupInvite,
  removeGroupMember,
  renameGroup,
  type Diary,
  type DiaryItem,
  type GroupView,
  type OpenedInvite,
} from "@map-diary/sync";
import { api } from "@/lib/device/session";
import { useDiaryItems } from "@/lib/device/hooks";
import { readPayload } from "@/lib/places/payloads";

export { GroupError, inviteSecretFrom, GROUP_NAME_MAX, MAX_GROUP_MEMBERS, type OpenedInvite } from "@map-diary/sync";

export interface Group {
  id: string;
  /** The newest name a member posted; empty until the name has synced. */
  name: string;
  /** This member's own name item, if they set the current name; renaming rewrites it. */
  ownNameItemId: string | undefined;
  members: GroupView["members"];
  keyVersion: number;
}

/** Group names by group id, from the 'group' items on each group's board. */
export function groupNames(items: readonly DiaryItem[]): Map<string, { name: string; item: DiaryItem }> {
  const names = new Map<string, { name: string; item: DiaryItem }>();
  for (const item of items) {
    if (item.type !== "group") continue;
    const name = readPayload("group", item.payload)?.name;
    const groupId = item.boardIds[0];
    if (!name || !groupId) continue;
    const prior = names.get(groupId);
    if (!prior || item.updatedAt > prior.item.updatedAt) names.set(groupId, { name, item });
  }
  return names;
}

/**
 * The groups this account is in: members from the Worker, names from the decrypted items.
 * `reload` fetches members again, for example after an invite was accepted elsewhere.
 */
export function useGroups(diary: Diary): { groups: Group[] | null; failed: boolean; reload: () => void } {
  const items = useDiaryItems(diary);
  const [views, setViews] = useState<GroupView[] | null>(null);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(() => {
    listGroups(api, diary.device).then(
      (list) => {
        setViews(list);
        setFailed(false);
      },
      () => {
        setViews((v) => v ?? []);
        setFailed(true);
      },
    );
  }, [diary]);
  useEffect(reload, [reload]);

  const groups = useMemo(() => {
    if (views === null) return null;
    const names = groupNames(items);
    return views.map((v): Group => {
      const named = names.get(v.id);
      return {
        id: v.id,
        name: named?.name ?? "",
        ownNameItemId: named?.item.authorId === diary.device.accountId ? named.item.id : undefined,
        members: v.members,
        keyVersion: v.keyVersion,
      };
    });
  }, [views, items, diary]);

  return { groups, failed, reload };
}

export function newGroup(diary: Diary, name: string): Promise<string> {
  return createGroup(diary, api, name);
}

export function renameGroupTo(diary: Diary, group: Group, name: string): Promise<void> {
  return renameGroup(diary, group.id, name, group.ownNameItemId);
}

/** A one-time invite link for WhatsApp; the secret after the `#` never reaches the server. */
export async function inviteLink(diary: Diary, group: Group): Promise<{ link: string; expiresAt: number }> {
  const { secret, expiresAt } = await createGroupInvite(api, diary.device, group.id, group.name);
  return { link: `${window.location.origin}${JOIN_PATH}#${secret}`, expiresAt };
}

export function previewInvite(diary: Diary, secret: string): Promise<OpenedInvite> {
  return readGroupInvite(api, diary.device, secret);
}

export function joinGroup(diary: Diary, secret: string): Promise<OpenedInvite> {
  return acceptGroupInvite(diary, api, secret);
}

export function removeMember(diary: Diary, groupId: string, accountId: string): Promise<void> {
  return removeGroupMember(diary, api, groupId, accountId);
}

export function leave(diary: Diary, groupId: string): Promise<void> {
  return leaveGroup(diary, api, groupId);
}
