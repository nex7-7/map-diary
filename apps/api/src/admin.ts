import { Hono } from "hono";
import { fromBase64 } from "@map-diary/crypto";
import { readBody, requireAdmin, requireDevice, type AuthedEnv, type SignedEnv } from "./auth";
import { masterBoard } from "./boards";
import { leaveGroupStatements } from "./groups";
import { fail, isB64, isId, isObject, isPositiveInt } from "./http";

/** An app invite works once, for seven days. */
export const APP_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Plenty for a handful of friends; stops a stolen admin device filling D1. */
const MAX_OPEN_INVITES = 10;
/** An app invite id: 16 bytes derived from the invite code, base64url. */
export const INVITE_ID_B64 = 22;

export function isInviteId(value: unknown): value is string {
  return isB64(value, INVITE_ID_B64) && value.length === INVITE_ID_B64;
}

/** crypto_box_seal of a 32-byte board key: 32 + 48 bytes. */
const MAX_WRAPPED_KEY_B64 = 200;
/** Each revocation or removal adds a master key version; far more than a few friends make. */
const MAX_KEY_VERSIONS = 500;

/** A master key version wrapped to someone: the invite's keypair, or a new account. */
export interface VersionKey {
  keyVersion: number;
  wrappedKey: string;
}

export function parseVersionKeys(value: unknown): VersionKey[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_KEY_VERSIONS) return null;
  const out: VersionKey[] = [];
  for (const v of value) {
    if (!isObject(v) || !isPositiveInt(v.keyVersion) || !isB64(v.wrappedKey, MAX_WRAPPED_KEY_B64)) return null;
    out.push({ keyVersion: v.keyVersion, wrappedKey: v.wrappedKey });
  }
  return out;
}

/** True when the keys are exactly versions 1 to `current`, once each: the board's whole history. */
export function coversEveryVersion(keys: readonly VersionKey[], current: number): boolean {
  const versions = new Set(keys.map((k) => k.keyVersion));
  return versions.size === keys.length && keys.length === current && keys.every((k) => k.keyVersion <= current);
}

/**
 * Admin-only routes: app invites and the member list. Admin power is enforced here, by the
 * admin device's signature, not by keys: nothing here can read anyone's boards.
 */
export const admin = new Hono<AuthedEnv>();

admin.use("/app-invites", readBody, requireDevice, requireAdmin);
admin.use("/app-invites/:id", readBody, requireDevice, requireAdmin);
admin.use("/members", readBody, requireDevice, requireAdmin);
admin.use("/members/:id/remove", readBody, requireDevice, requireAdmin);

/**
 * Files a new app invite under an id the admin device derived from the invite code, with every
 * master key version wrapped to a keypair derived from the code. The code itself stays on the
 * device and in the link after the `#`.
 */
admin.post("/app-invites", async (c) => {
  const body = c.var.body;
  const id = isObject(body) ? body.id : undefined;
  const masterKeys = isObject(body) ? parseVersionKeys(body.masterKeys) : null;
  if (!isInviteId(id) || !masterKeys) return fail(c, 400, "bad_request");
  const now = Date.now();
  const db = c.env.DB;
  const master = await masterBoard(db);
  if (!master) return fail(c, 409, "no_master_board");
  if (!coversEveryVersion(masterKeys, master.key_version)) return fail(c, 409, "stale");
  const open = await db
    .prepare("SELECT COUNT(*) AS n FROM app_invites WHERE used_at IS NULL AND expires_at > ?")
    .bind(now)
    .first<{ n: number }>();
  if ((open?.n ?? 0) >= MAX_OPEN_INVITES) return fail(c, 429, "too_many_invites");
  const expiresAt = now + APP_INVITE_TTL_MS;
  try {
    await db
      .prepare(
        "INSERT INTO app_invites (id, created_by_device_id, master_keys, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(id, c.var.device.id, JSON.stringify(masterKeys), now, expiresAt)
      .run();
  } catch {
    return fail(c, 409, "conflict");
  }
  return c.json({ id, expiresAt }, 201);
});

/** Invites not yet used and not expired, newest first. */
admin.get("/app-invites", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, created_at, expires_at FROM app_invites
      WHERE used_at IS NULL AND expires_at > ? ORDER BY created_at DESC`,
  )
    .bind(Date.now())
    .all<{ id: string; created_at: number; expires_at: number }>();
  return c.json({ invites: results.map((r) => ({ id: r.id, createdAt: r.created_at, expiresAt: r.expires_at })) });
});

/** Withdraws an invite that has not been used yet. */
admin.delete("/app-invites/:id", async (c) => {
  const id = c.req.param("id");
  if (!isInviteId(id)) return fail(c, 400, "bad_request");
  const result = await c.env.DB.prepare("DELETE FROM app_invites WHERE id = ? AND used_at IS NULL").bind(id).run();
  if (result.meta.changes === 0) return fail(c, 404, "not_found");
  return c.body(null, 204);
});

/**
 * Everyone on the app, oldest first, with the invite each joined through (the admin device
 * keeps its own notes on who each invite was for; the server holds no names).
 */
admin.get("/members", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.is_admin, a.created_at, a.removed_at,
            (SELECT id FROM app_invites WHERE used_by_account_id = a.id) AS invite_id,
            (SELECT COUNT(*) FROM devices WHERE account_id = a.id AND revoked_at IS NULL) AS devices,
            (SELECT MAX(last_seen_at) FROM devices WHERE account_id = a.id) AS last_seen_at
       FROM accounts a ORDER BY a.created_at`,
  ).all<{
    id: string;
    is_admin: number;
    created_at: number;
    removed_at: number | null;
    invite_id: string | null;
    devices: number;
    last_seen_at: number | null;
  }>();
  return c.json({
    members: results.map((r) => ({
      id: r.id,
      isAdmin: r.is_admin === 1,
      createdAt: r.created_at,
      removedAt: r.removed_at,
      inviteId: r.invite_id,
      devices: r.devices,
      lastSeenAt: r.last_seen_at,
    })),
  });
});

/** The next master key wrapped to one remaining member's current account box key. */
interface MasterMemberKey {
  accountId: string;
  accountKeyVersion: number;
  wrappedKey: Uint8Array;
}

function parseMasterMemberKeys(value: unknown): MasterMemberKey[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_KEY_VERSIONS) return null;
  const out: MasterMemberKey[] = [];
  for (const v of value) {
    if (!isObject(v)) return null;
    const { accountId, accountKeyVersion, wrappedKey } = v;
    if (!isId(accountId) || !isPositiveInt(accountKeyVersion) || !isB64(wrappedKey, MAX_WRAPPED_KEY_B64)) return null;
    out.push({ accountId, accountKeyVersion, wrappedKey: fromBase64(wrappedKey) });
  }
  return new Set(out.map((k) => k.accountId)).size === out.length ? out : null;
}

/**
 * Removes someone from the app: the account is marked removed and every one of its devices is
 * refused from now on. In the same step the master (Public) board moves to a new key that the
 * admin's device made and wrapped for every remaining member, so nothing posted from now on is
 * readable with the keys the removed person held, even with the server's help. Their encrypted
 * data stays where it is (nobody can read it without their keys); a board shows only its
 * members' opinions.
 */
admin.post("/members/:id/remove", async (c) => {
  const id = c.req.param("id");
  if (!isId(id)) return fail(c, 400, "bad_request");
  if (id === c.var.device.accountId) return fail(c, 400, "cannot_remove_self");
  const now = Date.now();
  const db = c.env.DB;
  const removed = "EXISTS (SELECT 1 FROM accounts WHERE id = ? AND removed_at = ?)";
  // They leave every group they are in, as if they had left themselves: their opinions leave
  // its board and a remaining member's device moves the group to a new key.
  const target = await db
    .prepare("SELECT id FROM accounts WHERE id = ? AND removed_at IS NULL AND is_admin = 0")
    .bind(id)
    .first<{ id: string }>();
  if (!target) return fail(c, 404, "not_found");
  const { results: groups } = await db
    .prepare(
      `SELECT m.board_id, (SELECT COUNT(*) FROM board_members o WHERE o.board_id = m.board_id) AS members
         FROM board_members m JOIN boards b ON b.id = m.board_id AND b.kind = 'group' WHERE m.account_id = ?`,
    )
    .bind(id)
    .all<{ board_id: string; members: number }>();

  // The master key rotation: the next version, wrapped for exactly the members who stay.
  const master = await masterBoard(db);
  const masterStatements: D1PreparedStatement[] = [];
  if (master) {
    const body = c.var.body;
    const keyVersion = isObject(body) ? body.masterKeyVersion : undefined;
    const keys = isObject(body) ? parseMasterMemberKeys(body.masterKeys) : null;
    if (!isPositiveInt(keyVersion) || !keys) return fail(c, 400, "bad_request");
    const { results: staying } = await db
      .prepare(
        `SELECT a.id, a.box_key_version FROM board_members m
           JOIN accounts a ON a.id = m.account_id AND a.removed_at IS NULL
          WHERE m.board_id = ? AND a.id <> ?`,
      )
      .bind(master.id, id)
      .all<{ id: string; box_key_version: number }>();
    const current = new Map(staying.map((m) => [m.id, m.box_key_version]));
    if (
      keyVersion !== master.key_version + 1 ||
      keys.length !== staying.length ||
      !keys.every((k) => current.get(k.accountId) === k.accountKeyVersion)
    ) {
      return fail(c, 409, "stale");
    }
    masterStatements.push(
      db
        .prepare(`UPDATE boards SET key_version = ? WHERE id = ? AND key_version = ? AND ${removed}`)
        .bind(keyVersion, master.id, master.key_version, id, now),
      // Plain inserts: a rotation racing this one to the same version fails the whole batch.
      ...keys.map((k) =>
        db
          .prepare(
            `INSERT INTO board_keys (board_id, key_version, account_id, account_key_version, wrapped_key, created_at)
             SELECT ?, ?, ?, ?, ?, ? WHERE ${removed}`,
          )
          .bind(master.id, keyVersion, k.accountId, k.accountKeyVersion, k.wrappedKey, now, id, now),
      ),
    );
  }

  let results: D1Result[];
  try {
    results = await db.batch([
    db.prepare("UPDATE accounts SET removed_at = ? WHERE id = ? AND removed_at IS NULL AND is_admin = 0").bind(now, id),
    db
      .prepare(`UPDATE devices SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL AND ${removed}`)
      .bind(now, id, id, now),
    db
      .prepare(
        `DELETE FROM pairings WHERE created_by_device_id IN (SELECT id FROM devices WHERE account_id = ?) AND ${removed}`,
      )
      .bind(id, id, now),
    db
      .prepare(
        `DELETE FROM claude_connectors WHERE device_id IN (SELECT id FROM devices WHERE account_id = ?) AND ${removed}`,
      )
      .bind(id, id, now),
    db
      .prepare(
        `DELETE FROM device_board_keys WHERE device_id IN (SELECT id FROM devices WHERE account_id = ?) AND ${removed}`,
      )
      .bind(id, id, now),
    ...groups.flatMap((g) => leaveGroupStatements(db, g.board_id, id, g.members - 1, now)),
    ...masterStatements,
  ]);
  } catch {
    return fail(c, 409, "stale");
  }
  if (results[0]?.meta.changes !== 1) return fail(c, 404, "not_found");
  return c.json({ removed: id });
});

/**
 * Whether an invite can still be used, for the friend's screen before they make their keys,
 * and while it is open, the master keys it carries (only the code opens them). Needs the id
 * derived from the code, so only someone holding the link can ask.
 */
export const appInvitesOpen = new Hono<SignedEnv>();

appInvitesOpen.get("/app-invites/:id/status", async (c) => {
  const id = c.req.param("id");
  if (!isInviteId(id)) return fail(c, 400, "bad_request");
  const row = await c.env.DB.prepare("SELECT used_at, expires_at, master_keys FROM app_invites WHERE id = ?")
    .bind(id)
    .first<{ used_at: number | null; expires_at: number; master_keys: string }>();
  if (!row) return fail(c, 404, "not_found");
  const state = row.used_at !== null ? "used" : row.expires_at <= Date.now() ? "expired" : "open";
  const master = state === "open" ? await masterBoard(c.env.DB) : null;
  if (!master) return c.json({ state, expiresAt: row.expires_at });
  return c.json({
    state,
    expiresAt: row.expires_at,
    masterBoardId: master.id,
    masterKeys: JSON.parse(row.master_keys) as VersionKey[],
  });
});

/** Deletes invites that expired unused over a day ago. Returns how many were removed. */
export async function expireAppInvites(db: D1Database, now: number): Promise<number> {
  const result = await db
    .prepare("DELETE FROM app_invites WHERE used_at IS NULL AND expires_at <= ?")
    .bind(now - 24 * 60 * 60 * 1000)
    .run();
  return result.meta.changes;
}
