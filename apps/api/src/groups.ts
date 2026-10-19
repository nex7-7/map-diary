import { Hono } from "hono";
import { fromBase64, inviteTokenHash, toBase64 } from "@map-diary/crypto";
import { readBody, requireDevice, type AuthedEnv } from "./auth";
import { bytes, fail, isB64, isId, isObject, isPositiveInt } from "./http";

/** Rotating a group key re-wraps it for each member, so groups stay small. */
export const MAX_GROUP_MEMBERS = 10;
/** Groups an account may be in; more than this is a stuck or abusive client. */
const MAX_GROUPS = 20;
/** A group invite works once, for a week. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_OPEN_INVITES = 20;
/** crypto_box_seal of a 32-byte board key: 32 + 48 bytes. */
const MAX_WRAPPED_KEY_B64 = 200;
/** Every key version of the group, sealed under the invite secret. */
const MAX_SEALED_INVITE_B64 = 16 * 1024;
/** A 32-byte hash or token in base64url. */
const HASH_B64 = 43;
/** Key versions a joining member may store; one per rotation the group has had. */
const MAX_KEY_VERSIONS = 200;

/** A new group key wrapped to one member's account box key at that account's key version. */
interface MemberKey {
  accountId: string;
  accountKeyVersion: number;
  wrappedKey: Uint8Array;
}

function parseMemberKeys(value: unknown): MemberKey[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_GROUP_MEMBERS) return null;
  const out: MemberKey[] = [];
  for (const v of value) {
    if (!isObject(v)) return null;
    const { accountId, accountKeyVersion, wrappedKey } = v;
    if (!isId(accountId) || !isPositiveInt(accountKeyVersion) || !isB64(wrappedKey, MAX_WRAPPED_KEY_B64)) return null;
    out.push({ accountId, accountKeyVersion, wrappedKey: fromBase64(wrappedKey) });
  }
  return new Set(out.map((k) => k.accountId)).size === out.length ? out : null;
}

interface GroupRow {
  id: string;
  key_version: number;
  rotation_due_at: number | null;
}

interface MemberRow {
  account_id: string;
  joined_at: number;
  box_public_key: unknown;
  box_key_version: number;
}

interface Group {
  board: GroupRow;
  members: MemberRow[];
}

/** The group and its members, if the board is a group the account is in. */
async function loadGroup(db: D1Database, boardId: string, accountId: string): Promise<Group | null> {
  const [boardRes, membersRes] = await db.batch([
    db
      .prepare(
        `SELECT b.id, b.key_version, b.rotation_due_at FROM boards b
           JOIN board_members m ON m.board_id = b.id AND m.account_id = ?
          WHERE b.id = ? AND b.kind = 'group'`,
      )
      .bind(accountId, boardId),
    db
      .prepare(
        `SELECT m.account_id, m.joined_at, a.box_public_key, a.box_key_version FROM board_members m
           JOIN accounts a ON a.id = m.account_id
          WHERE m.board_id = ? ORDER BY m.joined_at, m.account_id`,
      )
      .bind(boardId),
  ]);
  const board = (boardRes?.results?.[0] ?? null) as GroupRow | null;
  if (!board) return null;
  return { board, members: (membersRes?.results ?? []) as MemberRow[] };
}

function memberJson(m: MemberRow) {
  return {
    accountId: m.account_id,
    joinedAt: m.joined_at,
    boxPublicKey: m.box_public_key === null ? null : toBase64(bytes(m.box_public_key)),
    boxKeyVersion: m.box_key_version,
  };
}

/** Each remaining member gets the next key, wrapped to their current account box key. */
function keysMatchMembers(keys: readonly MemberKey[], members: readonly MemberRow[]): boolean {
  if (keys.length !== members.length) return false;
  const current = new Map(members.map((m) => [m.account_id, m.box_key_version]));
  return keys.every((k) => current.get(k.accountId) === k.accountKeyVersion);
}

/**
 * Moves the group to the next key version. The key rows are plain inserts: if another
 * rotation to the same version got there first, the batch fails as a whole, so two
 * rotations can never mix.
 */
function rotateStatements(db: D1Database, board: GroupRow, version: number, keys: readonly MemberKey[], now: number) {
  return [
    ...keys.map((k) =>
      db
        .prepare(
          `INSERT INTO board_keys (board_id, key_version, account_id, account_key_version, wrapped_key, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(board.id, version, k.accountId, k.accountKeyVersion, k.wrappedKey, now),
    ),
    db
      .prepare("UPDATE boards SET key_version = ?, rotation_due_at = NULL WHERE id = ? AND key_version = ?")
      .bind(version, board.id, version - 1),
    // Open invites carry the old key; whoever invited can send a new link.
    db.prepare("DELETE FROM invites WHERE board_id = ? AND used_at IS NULL").bind(board.id),
  ];
}

/**
 * Takes a person's envelopes off a group's board. One posted only there is deleted for
 * everyone; one also on other boards keeps those and has its row for this board marked
 * removed. Either way it gets a new change number, so every device sees the change on its
 * next sync. The group's own name envelope stays, so the group keeps its name.
 */
function leaveBoardStatements(db: D1Database, boardId: string, accountId: string, now: number) {
  return [
    db
      .prepare(
        `UPDATE envelope_boards SET removed_at = ?
          WHERE board_id = ? AND removed_at IS NULL AND envelope_id IN (
            SELECT id FROM envelopes WHERE author_id = ? AND deleted_at IS NULL AND type != 'group')`,
      )
      .bind(now, boardId, accountId),
    db
      .prepare(
        `UPDATE envelopes SET nonce = NULL, ciphertext = NULL, deleted_at = ?
          WHERE author_id = ? AND deleted_at IS NULL
            AND id IN (SELECT envelope_id FROM envelope_boards WHERE board_id = ? AND removed_at = ?)
            AND NOT EXISTS (
              SELECT 1 FROM envelope_boards eb WHERE eb.envelope_id = envelopes.id AND eb.removed_at IS NULL)`,
      )
      .bind(now, accountId, boardId, now),
    // One new change number each, above every existing one.
    db
      .prepare(
        `UPDATE envelopes SET seq = t.base + t.rn, server_updated_at = ?
           FROM (SELECT e.id AS id, (SELECT MAX(seq) FROM envelopes) AS base,
                        ROW_NUMBER() OVER (ORDER BY e.id) AS rn
                   FROM envelopes e JOIN envelope_boards eb ON eb.envelope_id = e.id
                  WHERE e.author_id = ? AND eb.board_id = ? AND eb.removed_at = ?) AS t
          WHERE envelopes.id = t.id`,
      )
      .bind(now, accountId, boardId, now),
    db
      .prepare(
        `UPDATE envelope_boards SET seq = (SELECT seq FROM envelopes WHERE id = envelope_boards.envelope_id)
          WHERE envelope_id IN (SELECT envelope_id FROM envelope_boards WHERE board_id = ? AND removed_at = ?)`,
      )
      .bind(boardId, now),
    db.prepare("DELETE FROM board_members WHERE board_id = ? AND account_id = ?").bind(boardId, accountId),
    db.prepare("DELETE FROM board_keys WHERE board_id = ? AND account_id = ?").bind(boardId, accountId),
  ];
}

export const groups = new Hono<AuthedEnv>();

/** The groups the account is in, with each member's account box key for re-wrapping. */
groups.get("/groups", readBody, requireDevice, async (c) => {
  const db = c.env.DB;
  const { accountId } = c.var.device;
  const [boardsRes, membersRes] = await db.batch([
    db
      .prepare(
        `SELECT b.id, b.key_version, b.rotation_due_at FROM boards b
           JOIN board_members m ON m.board_id = b.id AND m.account_id = ?
          WHERE b.kind = 'group' ORDER BY b.created_at`,
      )
      .bind(accountId),
    db
      .prepare(
        `SELECT m.board_id, m.account_id, m.joined_at, a.box_public_key, a.box_key_version FROM board_members m
           JOIN accounts a ON a.id = m.account_id
          WHERE m.board_id IN (SELECT board_id FROM board_members WHERE account_id = ?)
          ORDER BY m.joined_at, m.account_id`,
      )
      .bind(accountId),
  ]);
  const members = (membersRes?.results ?? []) as (MemberRow & { board_id: string })[];
  return c.json({
    groups: ((boardsRes?.results ?? []) as GroupRow[]).map((b) => ({
      id: b.id,
      keyVersion: b.key_version,
      rotationDue: b.rotation_due_at !== null,
      members: members.filter((m) => m.board_id === b.id).map(memberJson),
    })),
  });
});

/**
 * Creates a group: a new board, the caller as its first member, and its first key wrapped
 * to the caller's account. The device then posts the group's name in a 'group' envelope.
 */
groups.post("/groups", readBody, requireDevice, async (c) => {
  const body = c.var.body;
  if (!isObject(body)) return fail(c, 400, "bad_request");
  const { boardId, wrappedKey } = body;
  if (!isId(boardId) || !isB64(wrappedKey, MAX_WRAPPED_KEY_B64)) return fail(c, 400, "bad_request");
  const { accountId } = c.var.device;
  const db = c.env.DB;
  const count = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM board_members m JOIN boards b ON b.id = m.board_id
        WHERE m.account_id = ? AND b.kind = 'group'`,
    )
    .bind(accountId)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_GROUPS) return fail(c, 429, "too_many_groups");

  const now = Date.now();
  try {
    await db.batch([
      db.prepare("INSERT INTO boards (id, kind, key_version, created_at) VALUES (?, 'group', 1, ?)").bind(boardId, now),
      db.prepare("INSERT INTO board_members (board_id, account_id, joined_at) VALUES (?, ?, ?)").bind(boardId, accountId, now),
      db
        .prepare(
          `INSERT INTO board_keys (board_id, key_version, account_id, account_key_version, wrapped_key, created_at)
           SELECT ?, 1, id, box_key_version, ?, ? FROM accounts WHERE id = ?`,
        )
        .bind(boardId, fromBase64(wrappedKey), now, accountId),
    ]);
  } catch {
    return fail(c, 409, "conflict");
  }
  return c.json({ id: boardId, keyVersion: 1 }, 201);
});

/**
 * Files a group invite. Any member may invite. The id and the token hash are derived from
 * the link secret on the device; the keys are sealed under it, so the Worker learns nothing.
 */
groups.post("/groups/:id/invites", readBody, requireDevice, async (c) => {
  const body = c.var.body;
  if (!isObject(body)) return fail(c, 400, "bad_request");
  const { id, tokenHash, nonce, sealedKeys } = body;
  if (
    !isId(id) ||
    !isB64(tokenHash, HASH_B64) ||
    tokenHash.length !== HASH_B64 ||
    !isB64(nonce, 32) ||
    !isB64(sealedKeys, MAX_SEALED_INVITE_B64)
  ) {
    return fail(c, 400, "bad_request");
  }
  const db = c.env.DB;
  const { id: deviceId, accountId } = c.var.device;
  const group = await loadGroup(db, c.req.param("id"), accountId);
  if (!group) return fail(c, 404, "not_found");
  if (group.members.length >= MAX_GROUP_MEMBERS) return fail(c, 409, "group_full");

  const now = Date.now();
  const open = await db
    .prepare("SELECT COUNT(*) AS n FROM invites WHERE board_id = ? AND used_at IS NULL AND expires_at > ?")
    .bind(group.board.id, now)
    .first<{ n: number }>();
  if ((open?.n ?? 0) >= MAX_OPEN_INVITES) return fail(c, 429, "too_many_invites");
  try {
    await db
      .prepare(
        `INSERT INTO invites (id, board_id, created_by_device_id, secret_hash, nonce, sealed_keys, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, group.board.id, deviceId, fromBase64(tokenHash), fromBase64(nonce), fromBase64(sealedKeys), now, now + INVITE_TTL_MS)
      .run();
  } catch {
    return fail(c, 409, "conflict");
  }
  return c.json({ id, expiresAt: now + INVITE_TTL_MS }, 201);
});

interface InviteRow {
  id: string;
  board_id: string;
  secret_hash: unknown;
  nonce: unknown;
  sealed_keys: unknown;
  expires_at: number;
  used_at: number | null;
  key_version: number;
  members: number;
  is_member: number;
}

async function liveInvite(db: D1Database, id: string, accountId: string, now: number): Promise<InviteRow | null> {
  return db
    .prepare(
      `SELECT i.id, i.board_id, i.secret_hash, i.nonce, i.sealed_keys, i.expires_at, i.used_at, b.key_version,
              (SELECT COUNT(*) FROM board_members WHERE board_id = b.id) AS members,
              EXISTS (SELECT 1 FROM board_members WHERE board_id = b.id AND account_id = ?) AS is_member
         FROM invites i JOIN boards b ON b.id = i.board_id AND b.kind = 'group'
        WHERE i.id = ? AND i.used_at IS NULL AND i.expires_at > ?`,
    )
    .bind(accountId, id, now)
    .first<InviteRow>();
}

/** Someone with the link reads the sealed invite to show which group it is. */
groups.get("/invites/:id", readBody, requireDevice, async (c) => {
  const row = await liveInvite(c.env.DB, c.req.param("id"), c.var.device.accountId, Date.now());
  if (!row) return fail(c, 404, "not_found");
  return c.json({
    boardId: row.board_id,
    nonce: toBase64(bytes(row.nonce)),
    sealedKeys: toBase64(bytes(row.sealed_keys)),
    expiresAt: row.expires_at,
    keyVersion: row.key_version,
    members: row.members,
    isMember: row.is_member === 1,
  });
});

/**
 * Joins the group. The device proves it holds the link with the token, and stores every
 * group key version from the invite wrapped to its own account box key.
 */
groups.post("/invites/:id/accept", readBody, requireDevice, async (c) => {
  const body = c.var.body;
  if (!isObject(body)) return fail(c, 400, "bad_request");
  const { token } = body;
  const raw = body.keys;
  if (!isB64(token, HASH_B64) || token.length !== HASH_B64) return fail(c, 400, "bad_request");
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_KEY_VERSIONS) return fail(c, 400, "bad_request");
  const keys: { keyVersion: number; wrappedKey: Uint8Array }[] = [];
  for (const k of raw as unknown[]) {
    if (!isObject(k) || !isPositiveInt(k.keyVersion) || !isB64(k.wrappedKey, MAX_WRAPPED_KEY_B64)) {
      return fail(c, 400, "bad_request");
    }
    keys.push({ keyVersion: k.keyVersion, wrappedKey: fromBase64(k.wrappedKey) });
  }
  if (new Set(keys.map((k) => k.keyVersion)).size !== keys.length) return fail(c, 400, "bad_request");

  const db = c.env.DB;
  const { accountId } = c.var.device;
  const now = Date.now();
  const row = await liveInvite(db, c.req.param("id"), accountId, now);
  // A wrong token looks the same as no invite.
  const tokenHash = inviteTokenHash(token);
  if (!row || toBase64(bytes(row.secret_hash)) !== toBase64(tokenHash)) return fail(c, 404, "not_found");
  if (row.is_member === 1) return fail(c, 409, "already_member");
  if (row.members >= MAX_GROUP_MEMBERS) return fail(c, 409, "group_full");
  // The joiner must be able to read and write at the group's current key version.
  if (!keys.some((k) => k.keyVersion === row.key_version) || keys.some((k) => k.keyVersion > row.key_version)) {
    return fail(c, 409, "stale");
  }

  const used = "EXISTS (SELECT 1 FROM invites WHERE id = ? AND used_by_account_id = ? AND used_at = ?)";
  const guard = [row.id, accountId, now] as const;
  const results = await db.batch([
    db
      .prepare(
        `UPDATE invites SET used_at = ?, used_by_account_id = ?
          WHERE id = ? AND used_at IS NULL AND expires_at > ? AND secret_hash = ?
            AND (SELECT key_version FROM boards WHERE id = ?) = ?`,
      )
      .bind(now, accountId, row.id, now, tokenHash, row.board_id, row.key_version),
    db
      .prepare(`INSERT INTO board_members (board_id, account_id, joined_at) SELECT ?, ?, ? WHERE ${used}`)
      .bind(row.board_id, accountId, now, ...guard),
    ...keys.map((k) =>
      db
        .prepare(
          `INSERT INTO board_keys (board_id, key_version, account_id, account_key_version, wrapped_key, created_at)
           SELECT ?, ?, id, box_key_version, ?, ? FROM accounts WHERE id = ? AND ${used}`,
        )
        .bind(row.board_id, k.keyVersion, k.wrappedKey, now, accountId, ...guard),
    ),
  ]);
  if (results[0]?.meta.changes !== 1) return fail(c, 409, "stale");
  return c.json({ boardId: row.board_id, keyVersion: row.key_version });
});

/** Moves the group to a new key, for example after a member left. Any member may do it. */
groups.post("/groups/:id/rotate", readBody, requireDevice, async (c) => {
  const body = c.var.body;
  if (!isObject(body)) return fail(c, 400, "bad_request");
  const { keyVersion } = body;
  const keys = parseMemberKeys(body.memberKeys);
  if (!isPositiveInt(keyVersion) || !keys) return fail(c, 400, "bad_request");
  const db = c.env.DB;
  const group = await loadGroup(db, c.req.param("id"), c.var.device.accountId);
  if (!group) return fail(c, 404, "not_found");
  if (keyVersion !== group.board.key_version + 1 || !keysMatchMembers(keys, group.members)) {
    return fail(c, 409, "stale");
  }
  try {
    await db.batch(rotateStatements(db, group.board, keyVersion, keys, Date.now()));
  } catch {
    return fail(c, 409, "stale");
  }
  return c.json({ id: group.board.id, keyVersion });
});

/**
 * Removes another member. Their envelopes leave the group's board and the group moves to
 * a new key, wrapped for the remaining members, in one step. Any member may remove another.
 */
groups.post("/groups/:id/members/:accountId/remove", readBody, requireDevice, async (c) => {
  const body = c.var.body;
  if (!isObject(body)) return fail(c, 400, "bad_request");
  const { keyVersion } = body;
  const keys = parseMemberKeys(body.memberKeys);
  if (!isPositiveInt(keyVersion) || !keys) return fail(c, 400, "bad_request");
  const target = c.req.param("accountId");
  const { accountId } = c.var.device;
  if (target === accountId) return fail(c, 400, "use_leave");
  const db = c.env.DB;
  const group = await loadGroup(db, c.req.param("id"), accountId);
  if (!group) return fail(c, 404, "not_found");
  if (!group.members.some((m) => m.account_id === target)) return fail(c, 404, "not_member");
  const remaining = group.members.filter((m) => m.account_id !== target);
  if (keyVersion !== group.board.key_version + 1 || !keysMatchMembers(keys, remaining)) {
    return fail(c, 409, "stale");
  }
  const now = Date.now();
  try {
    await db.batch([
      ...rotateStatements(db, group.board, keyVersion, keys, now),
      ...leaveBoardStatements(db, group.board.id, target, now),
    ]);
  } catch {
    return fail(c, 409, "stale");
  }
  return c.json({ id: group.board.id, keyVersion, removed: target });
});

/**
 * Leaves a group. The caller's envelopes leave its board at once. The caller must not pick
 * the next key, so the group is marked for rotation and a remaining member's device rotates
 * it on its next sync.
 */
groups.post("/groups/:id/leave", readBody, requireDevice, async (c) => {
  const db = c.env.DB;
  const { accountId } = c.var.device;
  const group = await loadGroup(db, c.req.param("id"), accountId);
  if (!group) return fail(c, 404, "not_found");
  const now = Date.now();
  const others = group.members.length - 1;
  await db.batch([
    ...leaveBoardStatements(db, group.board.id, accountId, now),
    db.prepare("DELETE FROM invites WHERE board_id = ? AND used_at IS NULL").bind(group.board.id),
    db
      .prepare("UPDATE boards SET rotation_due_at = ? WHERE id = ? AND ? > 0")
      .bind(now, group.board.id, others),
  ]);
  return c.json({ id: group.board.id, left: true });
});
