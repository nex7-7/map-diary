"use client";

import type { JsonValue } from "@map-diary/crypto";
import {
  cancelAppInvite,
  createAppInvite,
  exportDatabase,
  listAllDevices,
  listAppInvites,
  listMembers,
  removeMember,
  resolverQueue,
  retryFailedJobs,
  retryResolverJob,
  signOutDevice,
  storageUsage,
  type AdminDeviceView,
  type AdminResolverView,
  type AdminStorageView,
  type AppInviteView,
  type Diary,
  type MemberView,
  type NewAppInvite,
} from "@map-diary/sync";
import { EntryError } from "../entries/actions";
import { getPendingQueue } from "../pending/session";
import { factsAfterMerge, factsOfMerged } from "../places/merges";
import { readPayload, type PlacePayload } from "../places/payloads";
import { api } from "./session";

// Admin-only actions. The Worker checks the admin device's signature on each one; nothing
// here reads anyone's boards.

export type { AdminDeviceView, AdminResolverView, AdminStorageView, AppInviteView, MemberView, NewAppInvite };

export function allDevices(diary: Diary): Promise<AdminDeviceView[]> {
  return listAllDevices(api, diary.device);
}

/** Signs out someone else's device at once; they finish moving to new keys on their Devices screen. */
export function signOut(diary: Diary, deviceId: string): Promise<void> {
  return signOutDevice(api, diary.device, deviceId);
}

export function resolver(diary: Diary): Promise<AdminResolverView> {
  return resolverQueue(api, diary.device);
}

export function retryJob(diary: Diary, jobId: string): Promise<void> {
  return retryResolverJob(api, diary.device, jobId);
}

export function retryAllFailed(diary: Diary): Promise<number> {
  return retryFailedJobs(api, diary.device);
}

export function storage(diary: Diary): Promise<AdminStorageView> {
  return storageUsage(api, diary.device);
}

/** The whole database as SQL text, for a backup the admin saves. */
export function exportSql(diary: Diary, onTable?: (table: string) => void): Promise<string> {
  return exportDatabase(api, diary.device, onTable);
}

/**
 * Merges a duplicate catalogue place into the one to keep. Nobody's opinions change: the
 * duplicate becomes a pointer, so its opinions show on the kept place, which gains its links.
 */
export async function mergePlaces(diary: Diary, keptId: string, duplicateId: string): Promise<void> {
  if (keptId === duplicateId) throw new EntryError("Pick two different places.");
  const items = await diary.listItems();
  const kept = items.find((i) => i.id === keptId && i.type === "place");
  const dup = items.find((i) => i.id === duplicateId && i.type === "place");
  const keptFacts = kept && readPayload("place", kept.payload);
  const dupFacts = dup && readPayload("place", dup.payload);
  if (!kept || !dup || !keptFacts || !dupFacts) throw new EntryError("Both places need to be on this device. Let it sync, then try again.");
  if (keptFacts.mergedInto || dupFacts.mergedInto) throw new EntryError("One of these was already merged.");
  await diary.write({ type: "place", placeId: null, id: duplicateId, payload: factsOfMerged(dupFacts, keptId) as unknown as JsonValue });
  // Anything merged into the duplicate before now points at the kept place too.
  for (const from of dupFacts.mergedFrom ?? []) {
    const earlier = items.find((i) => i.id === from && i.type === "place");
    const facts = earlier && readPayload("place", earlier.payload);
    if (facts) await diary.write({ type: "place", placeId: null, id: from, payload: factsOfMerged(facts, keptId) as unknown as JsonValue });
  }
  await diary.write({ type: "place", placeId: null, id: keptId, payload: factsAfterMerge(keptFacts, keptId, dupFacts, duplicateId) as unknown as JsonValue });
}

/**
 * Sends a catalogue place to the resolver again, by its first link or else its name. The
 * answer waits in this device's Inbox, where picking a match replaces the place's facts.
 */
export async function lookUpAgain(diary: Diary, placeId: string, query?: string, correcting = false): Promise<void> {
  const item = (await diary.listItems()).find((i) => i.id === placeId && i.type === "place");
  const facts = item && readPayload("place", item.payload);
  if (!facts) throw new EntryError("That place isn't on this device. Let it sync, then try again.");
  await (await getPendingQueue(diary)).lookUpAgain(placeId, query?.trim() || defaultQuery(facts), facts.name, correcting);
}

/** What a place is looked up again by when nothing better is given: its first link, or its name and address. */
export function defaultQuery(facts: PlacePayload): string {
  return facts.sourceLinks[0] ?? [facts.name, facts.address].filter(Boolean).join(", ");
}

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
