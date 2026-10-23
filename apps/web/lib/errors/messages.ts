import {
  ApiError,
  ClaudeError,
  GroupError,
  InviteError,
  MAX_GROUP_MEMBERS,
  NetworkError,
  PASSPHRASE_MIN_LENGTH,
  PairingError,
  RevokeError,
  SetupError,
  WriteError,
  type ClaudeErrorCode,
  type GroupErrorCode,
  type InviteErrorCode,
  type PairingErrorCode,
  type RevokeErrorCode,
  type SetupErrorCode,
  type WriteErrorCode,
} from "@map-diary/sync";
import { CryptoError, type CryptoErrorCode } from "@map-diary/crypto";
import { EntryError } from "../entries/actions";
import { MapFileError } from "../map/map-file";

/*
 * Every error the app can meet, in the words a person sees. Each failure the code throws or the
 * API returns has a code; this file is the one place that turns a code into a sentence. The full
 * list, with where each one shows, is in docs/errors.md. Messages never echo what was typed or
 * anything decrypted.
 */

export const OFFLINE = "You're offline. Connect and try again.";
export const SERVER = "Something went wrong on the server. Try again in a moment.";
export const UNKNOWN = "Something went wrong. Try again, and reload the app if it keeps happening.";

const SETUP: Record<SetupErrorCode, string> = {
  passphrase_too_short: `Use at least ${PASSPHRASE_MIN_LENGTH} characters. A short sentence works well.`,
  passphrase_too_weak: "That passphrase is too easy to guess. Try four or five unrelated words, like a silly sentence only you would write.",
  too_many_tries: "Too many tries in a short time. Wait a minute, then try again.",
  wrong_passphrase: "That passphrase didn't match. Check it and try again.",
  invalid_recovery_phrase: "That recovery phrase has a typo. Check each group of four.",
  unknown_recovery_phrase: "No account uses that recovery phrase.",
  registration_closed: "This diary is already set up. You need an invite link to join, or sign in if you already have one.",
  passphrase_in_use: "Choose a different passphrase.",
  bad_invite: "That invite code has a typo. It is twenty letters and digits, like 7K3QM-9XT2B-QW4RT-ZP0HK.",
  invite_invalid: "That invite has expired or was already used. Ask for a new one.",
  invite_stale: "That invite is out of date because the diary's keys changed since it was made. Ask for a new one.",
  wrong_account: "That recovery phrase belongs to a different account.",
  offline: OFFLINE,
  server: SERVER,
};

const PAIRING: Record<PairingErrorCode, string> = {
  bad_code: "That code has a typo. It is ten letters and digits, like 7K3QM-9XT2B.",
  expired: "That code has expired or was already used. Make a new one on your other device.",
  tampered: "The device that answered didn't come from your code, so it wasn't added. Make a new code and try again.",
  too_many: "There are already a few codes waiting. Wait ten minutes for them to expire, then make a new one.",
  offline: OFFLINE,
  server: SERVER,
};

const REVOKE: Record<RevokeErrorCode, string> = {
  wrong_passphrase: "That passphrase didn't match. Check it and try again.",
  invalid_recovery_phrase: "That recovery phrase has a typo. Check each group of four.",
  wrong_account: "That recovery phrase belongs to a different account.",
  stale: "Your devices changed while this was open. Try again.",
  offline: OFFLINE,
  server: SERVER,
};

const INVITE: Record<InviteErrorCode, string> = {
  too_many: "There are already ten open invites. Cancel one first.",
  no_master: "The Public board isn't set up on this device yet. Open the diary, let it sync, then try again.",
  stale: "The diary's keys just changed. Open the diary, let it sync, then try again.",
  not_found: "That's already gone. Reload to see the latest.",
  forbidden: "Only the admin can do that.",
  offline: OFFLINE,
  server: SERVER,
};

const CLAUDE: Record<ClaudeErrorCode, string> = {
  already_connected: "Claude is already connected. Remove it first to connect it again with a new secret.",
  stale: "The diary's keys just changed. Try again.",
  offline: OFFLINE,
  server: SERVER,
};

const GROUP: Record<GroupErrorCode, string> = {
  invalid_link: "That isn't a whole invite link. Ask for the link again and paste all of it.",
  invite_not_found: "That invite has expired or was already used. Ask for a new link.",
  already_member: "You're already in this group.",
  group_full: `This group already has ${MAX_GROUP_MEMBERS} people, the most a group can have.`,
  empty_name: "A group needs a name.",
  too_many_groups: "You're in as many groups as the diary allows. Leave one first.",
  stale: "The group changed while this was open. Reload and try again.",
  offline: OFFLINE,
  server: SERVER,
};

const WRITE: Record<WriteErrorCode, string> = {
  not_found: "That's no longer on this device. It may have been deleted on another device.",
  not_author: "Only the person who wrote that can change it.",
  immutable: "That can't be moved to another place. Delete it and add it again.",
  no_board_key: "This device doesn't have the key for one of the boards you picked yet. Let it sync, then try again.",
};

const CRYPTO: Record<CryptoErrorCode, string> = {
  bad_signature: "Something on this device didn't check out, so it was left alone. Reload the app.",
  no_board_key: "This device doesn't have the key for that yet. Let it sync, then try again.",
  decrypt_failed: "This device couldn't open that. Let it sync, then try again.",
  bad_payload: "Something on this device didn't check out, so it was left alone. Reload the app.",
  bad_backup: "That passphrase didn't match. Check it and try again.",
  unsupported_version: "This needs a newer version of the app. Reload to update.",
  invalid_input: "That doesn't look right. Check it and try again.",
};

/**
 * The API's error codes, for a call no screen-specific error wraps. Codes the screens wrap
 * themselves (invites, groups, pairing, setup) are listed there instead.
 */
const API: Record<string, string> = {
  bad_request: "The app sent something the server didn't understand. Reload the app to update it.",
  bad_json: "The app sent something the server didn't understand. Reload the app to update it.",
  unauthenticated: "The server didn't recognise this device. Check the time on this device, then reload.",
  forbidden: "You don't have access to that.",
  not_found: "That's already gone. Reload to see the latest.",
  conflict: "That changed on another device while this was open. Reload and try again.",
  stale: "The diary's keys just changed. Let it sync, then try again.",
  too_large: "That's too big to save. Try something smaller.",
  too_many_tries: "Too many tries in a short time. Wait a minute, then try again.",
  too_many_requests: "Too many lookups in a short time. Wait a minute, then try again.",
  device_revoked: "This device was removed from your account.",
  device_unknown: "The server no longer knows this device. Sign in again.",
  claude_not_allowed: "The Claude connector can't do that.",
  own_device: "You can't remove your own device from here. Use Devices on another one.",
  cannot_revoke_self: "You can't remove the device you're using. Remove it from another device.",
  cannot_remove_self: "You can't remove yourself from the diary.",
  bad_account_signature: "That passphrase or recovery phrase didn't match this account.",
  lookup_taken: "Choose a different passphrase.",
  no_master_board: "The Public board isn't set up yet. Open the diary, let it sync, then try again.",
  resolver_not_configured: "Place lookups aren't set up on the server yet.",
  queue_full: "Too many places are waiting to be looked up. Try again in a few hours.",
  registration_closed: "This diary is already set up. You need an invite link to join.",
  invite_invalid: "That invite has expired or was already used. Ask for a new one.",
  invite_stale: "That invite is out of date because the diary's keys changed since it was made. Ask for a new one.",
  too_many_invites: "There are already ten open invites. Cancel one first.",
  already_member: "You're already in this group.",
  group_full: `This group already has ${MAX_GROUP_MEMBERS} people, the most a group can have.`,
  too_many_groups: "You're in as many groups as the diary allows. Leave one first.",
  too_many_pairings: "There are already a few codes waiting. Wait ten minutes for them to expire, then make a new one.",
  not_joined: "The other device hasn't joined yet. Wait for its code to show, then approve.",
  claude_connected: "Claude is already connected. Remove it first to connect it again with a new secret.",
  master_exists: "The Public board is already set up. Reload the app.",
  not_expanded: "That link couldn't be opened. Paste the full Google Maps link instead.",
  bad_device_authorization: "The device that tried to join wasn't approved properly. Make a new code and try again.",
  board_not_allowed: "You're not on that board any more. Reload to see the latest.",
  internal: SERVER,
};

/** Why the server refused one of this device's writes during a sync. Null hides it. */
const REJECTED: Record<string, string | null> = {
  duplicate_place: "That place is already in the diary, so yours stayed on this device only. Search for it and add your status there.",
  board_not_allowed: "You're no longer on one of the boards you picked, so that change stayed on this device only.",
  facts_locked: "Only the admin can change a place's details now, so your edit stayed on this device only.",
  private_on_master: "A dropped pin can't go on the Public board, so it stayed on this device only.",
  not_author: "Only the person who wrote that can change it, so your edit stayed on this device only.",
  immutable_field: "That change isn't allowed, so it stayed on this device only.",
  bad_signature: "The server couldn't verify a change from this device, so it stayed here only. Reload the app.",
  invalid: "The server couldn't read a change from this device, so it stayed here only. Reload the app to update it.",
  // Gone on another device or already there: nothing for the person to do.
  deleted: null,
  duplicate: null,
};

/** A failed sync round's code, for the codes worth telling the person about. Null stays quiet. */
const SYNC: Record<string, string | null> = {
  // These two sign the device out; the welcome screen explains.
  device_revoked: null,
  device_unknown: null,
  unauthenticated: "The server didn't recognise this device, so it can't sync. Check the time on this device, then reload.",
  too_large: "A change is too big to sync. Try a smaller photo or a shorter comment.",
  client_error: "This device couldn't finish syncing. Your changes are kept here; reload to try again.",
};

/** One sentence for any error, safe to show as is. */
export function userMessage(err: unknown): string {
  if (err instanceof NetworkError) return OFFLINE;
  if (err instanceof EntryError) return err.message;
  if (err instanceof SetupError) return SETUP[err.code];
  if (err instanceof PairingError) return PAIRING[err.code];
  if (err instanceof RevokeError) return REVOKE[err.code];
  if (err instanceof InviteError) return INVITE[err.code];
  if (err instanceof ClaudeError) return CLAUDE[err.code];
  if (err instanceof GroupError) return GROUP[err.code];
  if (err instanceof WriteError) return WRITE[err.code];
  if (err instanceof CryptoError) return CRYPTO[err.code];
  if (err instanceof MapFileError) return "The map couldn't download. Check your connection and try again.";
  if (err instanceof ApiError) return API[err.code] ?? (err.status === 429 ? API.too_many_tries! : err.status >= 500 ? SERVER : UNKNOWN);
  if (err instanceof DOMException) {
    if (err.name === "QuotaExceededError") return "This device is out of storage space. Free some up, then try again.";
    if (err.name === "NotAllowedError") return "The browser didn't allow that. Check its permissions and try again.";
    if (err.name === "AbortError") return "That was cancelled.";
  }
  // fetch() outside the API client (the map file) rejects with a TypeError when offline.
  if (err instanceof TypeError && typeof navigator !== "undefined" && navigator.onLine === false) return OFFLINE;
  return UNKNOWN;
}

/** Why a map didn't load, for the map's own "Try again" card. */
export function mapLoadMessage(err: unknown): string {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "You're offline, and the map isn't saved on this device yet. Connect once to download it.";
  if (err instanceof MapFileError) return "The map couldn't download. Check your connection and try again.";
  return "The map couldn't load. Try again.";
}

export function syncRejectionMessage(reason: string): string | null {
  return reason in REJECTED ? (REJECTED[reason] ?? null) : "The server refused a change from this device, so it stayed here only.";
}

export function syncErrorMessage(code: string | null): string | null {
  if (code === null) return null;
  return code in SYNC ? (SYNC[code] ?? null) : (API[code] ?? SERVER);
}

/** Every message table, for the test that checks no code is left without words. */
export const TABLES = { SETUP, PAIRING, REVOKE, INVITE, CLAUDE, GROUP, WRITE, CRYPTO, API, REJECTED, SYNC };
