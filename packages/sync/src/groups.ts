import {
  CryptoError,
  fromBase64,
  generateBoardKey,
  generateGroupInviteSecret,
  groupInviteId,
  groupInviteToken,
  groupInviteTokenHash,
  isGroupInviteSecret,
  openGroupInvite,
  randomId,
  ready,
  sealGroupInvite,
  toBase64,
  wrapKeyForMember,
  type BoardKey,
} from "@map-diary/crypto";
import { ApiError, NetworkError, type Api, type GroupView, type MemberKeyBody, type Signer } from "./api";
import type { DeviceState } from "./device";
import type { Diary } from "./sync";

/** The path a group invite link opens; the secret follows the `#`. */
export const JOIN_PATH = "/join";
/** Members per group; rotating its key re-wraps it once per member. */
export const MAX_GROUP_MEMBERS = 10;
export const GROUP_NAME_MAX = 60;

export type GroupErrorCode =
  | "invalid_link"
  | "invite_not_found"
  | "already_member"
  | "group_full"
  | "stale"
  | "offline"
  | "server";

/** A group failure the screens can explain. Never carries a secret. */
export class GroupError extends Error {
  readonly code: GroupErrorCode;

  constructor(code: GroupErrorCode) {
    super(code);
    this.name = "GroupError";
    this.code = code;
  }
}

function asGroupError(err: unknown): GroupError {
  if (err instanceof GroupError) return err;
  if (err instanceof NetworkError) return new GroupError("offline");
  if (err instanceof CryptoError) return new GroupError("invalid_link");
  if (err instanceof ApiError) {
    if (err.status === 404) return new GroupError("invite_not_found");
    if (err.code === "already_member" || err.code === "group_full" || err.code === "stale") return new GroupError(err.code);
  }
  return new GroupError("server");
}

function signerOf(device: DeviceState): Signer {
  return { deviceId: device.deviceId, signSecretKey: device.identity.signSecretKey };
}

function cleanName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) throw new Error("A group needs a name");
  return [...trimmed].slice(0, GROUP_NAME_MAX).join("");
}

/** The groups the account is in, with members, as the Worker sees them (no names). */
export async function listGroups(api: Api, device: DeviceState): Promise<GroupView[]> {
  return (await api.listGroups(signerOf(device))).groups;
}

/**
 * Creates a group with this account as its only member. Its key is made here and wrapped to
 * the account; its name goes in a 'group' envelope on the new board. Returns the group's id.
 */
export async function createGroup(diary: Diary, api: Api, name: string): Promise<string> {
  await ready();
  const groupName = cleanName(name);
  const device = diary.device;
  const boardId = randomId();
  const key = generateBoardKey(boardId, 1);
  try {
    await api.createGroup(
      { boardId, wrappedKey: toBase64(wrapKeyForMember(key.key, device.accountBox.publicKey)) },
      signerOf(device),
    );
  } catch (err) {
    throw asGroupError(err);
  }
  await diary.adoptBoardKeys([key]);
  await diary.write({ type: "group", placeId: null, payload: { name: groupName }, boards: [boardId] });
  return boardId;
}

/** Renames a group: a new 'group' envelope from this member; the newest one is the name. */
export async function renameGroup(diary: Diary, groupId: string, name: string, existingId?: string): Promise<void> {
  const groupName = cleanName(name);
  const own = existingId === undefined ? undefined : await diary.getItem(existingId);
  const id = own && own.authorId === diary.device.accountId && own.type === "group" ? own.id : undefined;
  await diary.write({
    type: "group",
    placeId: null,
    payload: { name: groupName },
    boards: [groupId],
    ...(id === undefined ? {} : { id }),
  });
}

/**
 * Makes a one-time invite link for a group. Every key version this device holds for it is
 * sealed under the link's secret, so a new member can read the group's past items too.
 * Returns the secret, which goes after the `#` of the link.
 */
export async function createGroupInvite(
  api: Api,
  device: DeviceState,
  groupId: string,
  groupName: string,
): Promise<{ secret: string; expiresAt: number }> {
  await ready();
  const keys = device.boardKeys.filter((k) => k.boardId === groupId).sort((a, b) => a.version - b.version);
  if (keys.length === 0) throw new Error("This device has no key for the group");
  const secret = generateGroupInviteSecret();
  const sealed = sealGroupInvite(secret, {
    boardId: groupId,
    groupName,
    keys: keys.map((k) => ({ version: k.version, key: k.key })),
  });
  try {
    const { expiresAt } = await api.createInvite(
      groupId,
      { id: groupInviteId(secret), tokenHash: toBase64(groupInviteTokenHash(groupInviteToken(secret))), ...sealed },
      signerOf(device),
    );
    return { secret, expiresAt };
  } catch (err) {
    throw asGroupError(err);
  }
}

/** Reads the secret out of a pasted link or the bare secret. */
export function inviteSecretFrom(text: string): string | null {
  const hash = text.indexOf("#");
  const candidate = (hash >= 0 ? text.slice(hash + 1) : text).trim();
  return isGroupInviteSecret(candidate) ? candidate : null;
}

/** `inviteSecretFrom` for a page that may run before libsodium has loaded, such as a freshly opened `/join` link. */
export async function readInviteSecret(text: string): Promise<string | null> {
  await ready();
  return inviteSecretFrom(text);
}

export interface OpenedInvite {
  groupId: string;
  groupName: string;
  members: number;
  isMember: boolean;
  expiresAt: number;
  keys: BoardKey[];
}

/** Opens an invite link to show which group it is, without joining. */
export async function readGroupInvite(api: Api, device: DeviceState, secret: string): Promise<OpenedInvite> {
  await ready();
  if (!isGroupInviteSecret(secret)) throw new GroupError("invalid_link");
  try {
    const view = await api.readInvite(groupInviteId(secret), signerOf(device));
    const invite = openGroupInvite(secret, view);
    // The Worker files the invite under a board; the sealed keys must be for that board.
    if (invite.boardId !== view.boardId) throw new GroupError("invalid_link");
    return {
      groupId: view.boardId,
      groupName: invite.groupName,
      members: view.members,
      isMember: view.isMember,
      expiresAt: view.expiresAt,
      keys: invite.keys.map((k) => ({ boardId: view.boardId, version: k.version, key: k.key })),
    };
  } catch (err) {
    throw asGroupError(err);
  }
}

/** Joins the group in an invite: stores its keys wrapped to this account, then syncs its board. */
export async function acceptGroupInvite(diary: Diary, api: Api, secret: string): Promise<OpenedInvite> {
  const device = diary.device;
  const invite = await readGroupInvite(api, device, secret);
  if (invite.isMember) throw new GroupError("already_member");
  try {
    await api.acceptInvite(
      groupInviteId(secret),
      {
        token: groupInviteToken(secret),
        keys: invite.keys.map((k) => ({
          keyVersion: k.version,
          wrappedKey: toBase64(wrapKeyForMember(k.key, device.accountBox.publicKey)),
        })),
      },
      signerOf(device),
    );
  } catch (err) {
    throw asGroupError(err);
  }
  await diary.adoptBoardKeys(invite.keys);
  void diary.sync();
  return invite;
}

/** The next key of a group, wrapped for every member in `members`. */
function nextKey(group: GroupView, members: GroupView["members"]): { key: BoardKey; memberKeys: MemberKeyBody[] } {
  const key = generateBoardKey(group.id, group.keyVersion + 1);
  const memberKeys = members.map((m) => {
    if (m.boxPublicKey === null) throw new GroupError("server");
    return {
      accountId: m.accountId,
      accountKeyVersion: m.boxKeyVersion,
      wrappedKey: toBase64(wrapKeyForMember(key.key, fromBase64(m.boxPublicKey))),
    };
  });
  return { key, memberKeys };
}

async function findGroup(api: Api, device: DeviceState, groupId: string): Promise<GroupView> {
  const group = (await listGroups(api, device)).find((g) => g.id === groupId);
  if (!group) throw new GroupError("stale");
  return group;
}

/**
 * Moves a group to a new key wrapped for its current members. Used when a member has left,
 * since the leaver must not choose the next key. Returns the new key for this device to keep.
 */
export async function rotateGroupKey(api: Api, device: DeviceState, groupId: string): Promise<BoardKey> {
  await ready();
  const group = await findGroup(api, device, groupId);
  const { key, memberKeys } = nextKey(group, group.members);
  await api.rotateGroup(groupId, { keyVersion: key.version, memberKeys }, signerOf(device));
  return key;
}

/**
 * Removes another member. Their items leave the group's board for everyone, and the group
 * moves to a new key that only the remaining members get.
 */
export async function removeGroupMember(diary: Diary, api: Api, groupId: string, accountId: string): Promise<void> {
  await ready();
  const device = diary.device;
  try {
    const group = await findGroup(api, device, groupId);
    const { key, memberKeys } = nextKey(
      group,
      group.members.filter((m) => m.accountId !== accountId),
    );
    await api.removeGroupMember(groupId, accountId, { keyVersion: key.version, memberKeys }, signerOf(device));
    await diary.adoptBoardKeys([key]);
  } catch (err) {
    throw asGroupError(err);
  }
  void diary.sync();
}

/**
 * Leaves a group. This account's items leave its board for everyone, this device forgets the
 * group's keys and items, and a remaining member's device moves the group to a new key.
 */
export async function leaveGroup(diary: Diary, api: Api, groupId: string): Promise<void> {
  try {
    await api.leaveGroup(groupId, signerOf(diary.device));
  } catch (err) {
    throw asGroupError(err);
  }
  await diary.forgetBoards([groupId]);
  void diary.sync();
}
