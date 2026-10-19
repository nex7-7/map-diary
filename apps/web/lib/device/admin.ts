"use client";

import {
  cancelAppInvite,
  createAppInvite,
  listAppInvites,
  listMembers,
  removeMember,
  type AppInviteView,
  type Diary,
  type MemberView,
  type NewAppInvite,
} from "@map-diary/sync";
import { api } from "./session";

// Admin-only actions. The Worker checks the admin device's signature on each one; nothing
// here reads anyone's boards.

export type { AppInviteView, MemberView, NewAppInvite };

export function inviteFriend(diary: Diary): Promise<NewAppInvite> {
  return createAppInvite(api, diary.device, window.location.origin);
}

export function openInvites(diary: Diary): Promise<AppInviteView[]> {
  return listAppInvites(api, diary.device);
}

export function cancelInvite(diary: Diary, id: string): Promise<void> {
  return cancelAppInvite(api, diary.device, id);
}

export function members(diary: Diary): Promise<MemberView[]> {
  return listMembers(api, diary.device);
}

/** Removes someone, then syncs so this device collects the new Public key straight away. */
export async function removeFromApp(diary: Diary, accountId: string): Promise<void> {
  await removeMember(api, diary.device, accountId);
  void diary.sync();
}

const NOTES_KEY = "map-diary:invite-notes";

/**
 * Who each invite was for, kept only on the admin's device: the server holds no names, so
 * this is how the members list says who is who until names arrive with sharing.
 */
export function inviteNotes(): Record<string, string> {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function saveInviteNote(inviteId: string, note: string): void {
  try {
    const notes = inviteNotes();
    if (note) notes[inviteId] = note;
    else delete notes[inviteId];
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
  } catch {
    // Private mode or blocked storage: the note is a convenience only.
  }
}
