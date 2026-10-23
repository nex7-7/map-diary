import {
  appInviteBoxKeys,
  appInviteId,
  fromBase64,
  generateBoardKey,
  generateInviteCode,
  normaliseInviteCode,
  ready,
  toBase64,
  wrapKeyForMember,
  type IdentityKeys,
} from "@map-diary/crypto";
import { ApiError, NetworkError, type Api, type AppInviteState, type AppInviteView, type MemberView, type Signer } from "./api";
import { masterKeysOf } from "./boards";
import type { DeviceState } from "./device";

/** The path an app invite link opens; the code follows the `#`. */
export const INVITE_PATH = "/invite";

export type InviteErrorCode = "too_many" | "no_master" | "stale" | "not_found" | "forbidden" | "offline" | "server";

/** An admin invite or member action that failed, in terms the screens can explain. */
export class InviteError extends Error {
  readonly code: InviteErrorCode;

  constructor(code: InviteErrorCode) {
    super(code);
    this.name = "InviteError";
    this.code = code;
  }
}

function asInviteError(err: unknown): InviteError {
  if (err instanceof InviteError) return err;
  if (err instanceof NetworkError) return new InviteError("offline");
  if (err instanceof ApiError) {
    if (err.code === "too_many_invites") return new InviteError("too_many");
    if (err.code === "no_master_board") return new InviteError("no_master");
    if (err.code === "stale") return new InviteError("stale");
    if (err.status === 404) return new InviteError("not_found");
    if (err.status === 403) return new InviteError("forbidden");
  }
  return new InviteError("server");
}

function signerOf(device: { deviceId: string; identity: IdentityKeys }): Signer {
  return { deviceId: device.deviceId, signSecretKey: device.identity.signSecretKey };
}

async function attempt<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw asInviteError(err);
  }
}

/** Runs an admin call, with failures as an `InviteError` the admin screens already explain. */
export const attemptAdmin = attempt;

export interface NewAppInvite {
  /** The Worker's handle on the invite; it cannot be turned back into the code. */
  id: string;
  /** For typing into the installed app, for example `7K3QM-9XT2B-QW4RT-ZP0HK`. */
  code: string;
  /** The link to send; the code is after the `#`, so it never reaches the server. */
  link: string;
  expiresAt: number;
}

/**
 * Makes a one-time app invite on the admin's device. Every master key version goes in it,
 * wrapped to a keypair derived from the code, so the friend joins the Public board with its
 * whole history. `origin` is the site the link opens.
 */
export async function createAppInvite(api: Api, device: DeviceState, origin: string): Promise<NewAppInvite> {
  await ready();
  const keys = masterKeysOf(device);
  if (keys.length === 0) throw new InviteError("no_master");
  const code = generateInviteCode();
  const id = appInviteId(code);
  const { boxPublicKey } = appInviteBoxKeys(code);
  const masterKeys = keys.map((k) => ({ keyVersion: k.version, wrappedKey: toBase64(wrapKeyForMember(k.key, boxPublicKey)) }));
  const { expiresAt } = await attempt(() => api.createAppInvite(id, masterKeys, signerOf(device)));
  return { id, code, link: `${origin.replace(/\/$/, "")}${INVITE_PATH}#${code}`, expiresAt };
}

/** Invites not yet used or expired. */
export async function listAppInvites(api: Api, device: DeviceState): Promise<AppInviteView[]> {
  return (await attempt(() => api.listAppInvites(signerOf(device)))).invites;
}

export function cancelAppInvite(api: Api, device: DeviceState, id: string): Promise<void> {
  return attempt(() => api.cancelAppInvite(id, signerOf(device)));
}

export async function listMembers(api: Api, device: DeviceState): Promise<MemberView[]> {
  return (await attempt(() => api.listMembers(signerOf(device)))).members;
}

/**
 * Removes someone from the app; every device of theirs is refused from then on. In the same
 * call the master (Public) board moves to a fresh key, made here and wrapped for every member
 * who stays (this admin included), so the removed person's keys open nothing posted later.
 * The admin's diary picks its copy up on the next sync.
 */
export async function removeMember(api: Api, device: DeviceState, accountId: string): Promise<void> {
  await ready();
  const signer = signerOf(device);
  await attempt(async () => {
    const me = await api.me(signer);
    const master = me.boards.find((b) => b.kind === "master");
    if (!master) return api.removeMember(accountId, undefined, signer);
    const next = generateBoardKey(master.id, master.keyVersion + 1);
    const { members } = await api.boardMembers(master.id, signer);
    const masterKeys = members
      .filter((m) => m.accountId !== accountId)
      .map((m) => ({
        accountId: m.accountId,
        accountKeyVersion: m.boxKeyVersion,
        wrappedKey: toBase64(wrapKeyForMember(next.key, fromBase64(m.boxPublicKey))),
      }));
    return api.removeMember(accountId, { masterKeyVersion: next.version, masterKeys }, signer);
  });
}

export type InviteCheck = { state: AppInviteState | "bad_code" | "unknown"; expiresAt?: number };

/**
 * Checks an invite code before the friend makes their keys: `bad_code` for a typo, `unknown`
 * for a code no invite was made for (or one cancelled or long expired).
 */
export async function checkAppInvite(api: Api, codeText: string): Promise<InviteCheck> {
  await ready();
  const code = normaliseInviteCode(codeText);
  if (!code) return { state: "bad_code" };
  try {
    const { state, expiresAt } = await api.appInviteStatus(appInviteId(code));
    return { state, expiresAt };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return { state: "unknown" };
    throw asInviteError(err);
  }
}
