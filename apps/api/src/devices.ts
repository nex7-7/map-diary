import { Hono } from "hono";
import { fromBase64, toBase64, verifyAccountBoxKey } from "@map-diary/crypto";
import { readBody, requireDevice, type AuthedEnv } from "./auth";
import { isPublicKey, parseBoardKeys, type NewBoardKey } from "./accounts";
import { bytes, fail, isB64, isId, isObject, isPositiveInt } from "./http";

/** A sealed account box key is a few hundred bytes, like a pairing transfer. */
const MAX_SEALED_KEY_B64 = 1024;
/** crypto_box_seal of a 32-byte board key: 32 + 48 bytes. */
const MAX_WRAPPED_KEY_B64 = 200;
/** Every board key version the account holds is re-wrapped on each revocation. */
const MAX_BOARD_KEYS = 500;
const MAX_DEVICES = 50;

interface SealedDeviceKey {
  deviceId: string;
  sealedKey: Uint8Array;
}

function parseDeviceKeys(value: unknown): SealedDeviceKey[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_DEVICES) return null;
  const out: SealedDeviceKey[] = [];
  for (const v of value) {
    if (!isObject(v) || !isId(v.deviceId) || !isB64(v.sealedKey, MAX_SEALED_KEY_B64)) return null;
    out.push({ deviceId: v.deviceId, sealedKey: fromBase64(v.sealedKey) });
  }
  return out;
}

/** A rotated shared-board key wrapped to another member's account box key. */
interface MemberKey {
  boardId: string;
  keyVersion: number;
  accountId: string;
  accountKeyVersion: number;
  wrappedKey: Uint8Array;
}

function parseMemberKeys(value: unknown): MemberKey[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_BOARD_KEYS) return null;
  const out: MemberKey[] = [];
  for (const v of value) {
    if (!isObject(v)) return null;
    const { boardId, keyVersion, accountId, accountKeyVersion, wrappedKey } = v;
    if (!isId(boardId) || !isPositiveInt(keyVersion) || !isId(accountId) || !isPositiveInt(accountKeyVersion)) return null;
    if (!isB64(wrappedKey, MAX_WRAPPED_KEY_B64)) return null;
    out.push({ boardId, keyVersion, accountId, accountKeyVersion, wrappedKey: fromBase64(wrappedKey) });
  }
  return out;
}

const keyOf = (boardId: string, version: number) => `${boardId}\u0000${version}`;
const memberKeyOf = (boardId: string, version: number, accountId: string, accountKeyVersion: number) =>
  `${boardId}\u0000${version}\u0000${accountId}\u0000${accountKeyVersion}`;

function sameSet(a: Iterable<string>, b: Iterable<string>): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((x) => right.has(x));
}

export const devices = new Hono<AuthedEnv>();

/**
 * Revokes another device of the caller's account and moves the account to the next box key
 * version in the same step. The caller has derived the new account box key from the recovery
 * seed, sealed it to every remaining device, re-wrapped every board key the account holds to
 * it, and added the next Personal board key. Every shared board the account is in (the master
 * board, later groups) moves to a fresh random key too, wrapped to the caller's new account key
 * and to every other member's current one. The revoked device gets none of this, so the server
 * refuses it at once and nothing written from now on is readable with its keys.
 *
 * The new box key comes with the account key's signature. Devices never hold the account key
 * (it is derived from the recovery seed), so only someone with the seed can revoke: a stolen
 * device cannot move the account to a box key of its own and lock the owner out.
 */
devices.post("/devices/:id/revoke", readBody, requireDevice, async (c) => {
  const body = c.var.body;
  if (!isObject(body)) return fail(c, 400, "bad_request");
  const { boxPublicKey, boxKeyVersion, boxKeySignature } = body;
  const boardKeys = parseBoardKeys(body.boardKeys, MAX_BOARD_KEYS);
  const deviceKeys = parseDeviceKeys(body.deviceKeys);
  const memberKeys = parseMemberKeys(body.memberKeys);
  if (
    !isPublicKey(boxPublicKey) ||
    !isPositiveInt(boxKeyVersion) ||
    !isB64(boxKeySignature, 100) ||
    !boardKeys ||
    !deviceKeys ||
    !memberKeys
  ) {
    return fail(c, 400, "bad_request");
  }

  const targetId = c.req.param("id");
  const { id: callerId, accountId } = c.var.device;
  if (targetId === callerId) return fail(c, 400, "cannot_revoke_self");
  const db = c.env.DB;

  const [accountRes, devicesRes, boardsRes, keysRes, membersRes] = await db.batch([
    db.prepare("SELECT box_key_version, sign_public_key FROM accounts WHERE id = ?").bind(accountId),
    db
      .prepare("SELECT id, kind, revoked_at FROM devices WHERE account_id = ? AND (revoked_at IS NULL OR rekey_due_at IS NOT NULL)")
      .bind(accountId),
    db
      .prepare(
        `SELECT b.id, b.kind, b.key_version FROM boards b
           JOIN board_members m ON m.board_id = b.id AND m.account_id = ?`,
      )
      .bind(accountId),
    db.prepare("SELECT board_id, key_version FROM board_keys WHERE account_id = ?").bind(accountId),
    // The other members of every shared board the account is in.
    db
      .prepare(
        `SELECT m.board_id, a.id, a.box_key_version FROM board_members m
           JOIN boards b ON b.id = m.board_id AND b.kind <> 'personal'
           JOIN accounts a ON a.id = m.account_id AND a.removed_at IS NULL AND a.id <> ?
          WHERE m.board_id IN (SELECT board_id FROM board_members WHERE account_id = ?)`,
      )
      .bind(accountId, accountId),
  ]);
  const account = (accountRes?.results?.[0] ?? null) as { box_key_version: number; sign_public_key: unknown } | null;
  // A device the admin signed out is already refused, but its account still waits to move on.
  const listed = (devicesRes?.results ?? []) as { id: string; kind: string; revoked_at: number | null }[];
  const activeRows = listed.filter((d) => d.revoked_at === null);
  const revocable = listed.map((d) => d.id);
  const boards = (boardsRes?.results ?? []) as { id: string; kind: string; key_version: number }[];
  const held = (keysRes?.results ?? []) as { board_id: string; key_version: number }[];
  const others = (membersRes?.results ?? []) as { board_id: string; id: string; box_key_version: number }[];
  if (!account || !revocable.includes(targetId)) return fail(c, 404, "not_found");

  // The account moves exactly one version on; anything else is a stale view of it.
  if (boxKeyVersion !== account.box_key_version + 1) return fail(c, 409, "stale");
  const signedBySeed =
    account.sign_public_key !== null &&
    verifyAccountBoxKey(
      { accountId, version: boxKeyVersion, boxPublicKey: fromBase64(boxPublicKey) },
      boxKeySignature,
      bytes(account.sign_public_key),
    );
  if (!signedBySeed) return fail(c, 403, "bad_account_signature");

  // Every remaining device gets the new key, so none is left unable to read. A Claude device
  // never holds the account key; one of these devices wraps it the new master and Personal
  // keys on its next sync.
  const remaining = activeRows.filter((d) => d.id !== targetId && d.kind !== "claude").map((d) => d.id);
  if (!sameSet(remaining, deviceKeys.map((k) => k.deviceId)) || deviceKeys.length !== remaining.length) {
    return fail(c, 409, "stale");
  }

  // Every board key the account holds is re-wrapped, and every board it is in moves on one
  // version: the Personal board to the next key derived from the seed, shared boards to a new
  // random key that every other member gets too.
  const rotated = boards;
  const shared = boards.filter((b) => b.kind !== "personal");
  const expected = [
    ...held.map((k) => keyOf(k.board_id, k.key_version)),
    ...rotated.map((b) => keyOf(b.id, b.key_version + 1)),
  ];
  if (!sameSet(expected, boardKeys.map((k) => keyOf(k.boardId, k.keyVersion))) || boardKeys.length !== expected.length) {
    return fail(c, 409, "stale");
  }
  const sharedVersion = new Map(shared.map((b) => [b.id, b.key_version + 1]));
  const expectedMembers = others.map((m) => memberKeyOf(m.board_id, sharedVersion.get(m.board_id) ?? 0, m.id, m.box_key_version));
  const sentMembers = memberKeys.map((k) => memberKeyOf(k.boardId, k.keyVersion, k.accountId, k.accountKeyVersion));
  if (!sameSet(expectedMembers, sentMembers) || sentMembers.length !== expectedMembers.length) {
    return fail(c, 409, "stale");
  }
  const newVersions = new Set(rotated.map((b) => keyOf(b.id, b.key_version + 1)));

  const now = Date.now();
  const newBox = fromBase64(boxPublicKey);
  // Each later statement runs only if this request is the one that moved the account on.
  const moved = "EXISTS (SELECT 1 FROM accounts WHERE id = ? AND box_key_version = ? AND box_public_key = ?)";
  const guard = [accountId, boxKeyVersion, newBox] as const;

  const statements: D1PreparedStatement[] = [
    db
      .prepare("UPDATE accounts SET box_public_key = ?, box_key_version = ? WHERE id = ? AND box_key_version = ?")
      .bind(newBox, boxKeyVersion, accountId, account.box_key_version),
    db
      .prepare(`UPDATE devices SET revoked_at = ? WHERE id = ? AND account_id = ? AND revoked_at IS NULL AND ${moved}`)
      .bind(now, targetId, accountId, ...guard),
    // Moving the account on also finishes any revoke the admin started on its devices.
    db.prepare(`UPDATE devices SET rekey_due_at = NULL WHERE account_id = ? AND ${moved}`).bind(accountId, ...guard),
    db.prepare(`DELETE FROM device_account_keys WHERE device_id = ? AND ${moved}`).bind(targetId, ...guard),
    db.prepare(`DELETE FROM pairings WHERE created_by_device_id = ? AND ${moved}`).bind(targetId, ...guard),
    // A revoked Claude device's sealed keys and board keys go too; the connector secret then
    // opens nothing.
    db.prepare(`DELETE FROM claude_connectors WHERE device_id = ? AND ${moved}`).bind(targetId, ...guard),
    db.prepare(`DELETE FROM device_board_keys WHERE device_id = ? AND ${moved}`).bind(targetId, ...guard),
    ...rotated.map((b) =>
      db
        .prepare(`UPDATE boards SET key_version = ? WHERE id = ? AND key_version = ? AND ${moved}`)
        .bind(b.key_version + 1, b.id, b.key_version, ...guard),
    ),
    // Re-wraps of keys the account already holds replace the old wrap. A new version is a plain
    // insert, so someone else rotating the same board at the same moment fails this whole batch.
    ...boardKeys.map((k: NewBoardKey) =>
      newVersions.has(keyOf(k.boardId, k.keyVersion))
        ? db
            .prepare(
              `INSERT INTO board_keys (board_id, key_version, account_id, account_key_version, wrapped_key, created_at)
               SELECT ?, ?, ?, ?, ?, ? WHERE ${moved}`,
            )
            .bind(k.boardId, k.keyVersion, accountId, boxKeyVersion, k.wrappedKey, now, ...guard)
        : db
            .prepare(
              `INSERT INTO board_keys (board_id, key_version, account_id, account_key_version, wrapped_key, created_at)
               SELECT ?, ?, ?, ?, ?, ? WHERE ${moved}
               ON CONFLICT (board_id, key_version, account_id) DO UPDATE SET
                 account_key_version = excluded.account_key_version, wrapped_key = excluded.wrapped_key`,
            )
            .bind(k.boardId, k.keyVersion, accountId, boxKeyVersion, k.wrappedKey, now, ...guard),
    ),
    ...memberKeys.map((k) =>
      db
        .prepare(
          `INSERT INTO board_keys (board_id, key_version, account_id, account_key_version, wrapped_key, created_at)
           SELECT ?, ?, ?, ?, ?, ? WHERE ${moved}`,
        )
        .bind(k.boardId, k.keyVersion, k.accountId, k.accountKeyVersion, k.wrappedKey, now, ...guard),
    ),
    ...deviceKeys.map((k) =>
      db
        .prepare(
          `INSERT INTO device_account_keys (device_id, account_key_version, sealed_key, created_at)
           SELECT ?, ?, ?, ? WHERE ${moved}`,
        )
        .bind(k.deviceId, boxKeyVersion, k.sealedKey, now, ...guard),
    ),
  ];

  let results: D1Result[];
  try {
    results = await db.batch(statements);
  } catch {
    // Another rotation of a shared board got there first; nothing was applied.
    return fail(c, 409, "stale");
  }
  if (results[0]?.meta.changes !== 1) return fail(c, 409, "stale");
  return c.json({ revoked: targetId, boxKeyVersion });
});

/** The account box key sealed to the calling device, at the account's current version. */
devices.get("/me/account-key", readBody, requireDevice, async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT k.account_key_version, k.sealed_key FROM device_account_keys k
       JOIN accounts a ON a.id = ? AND a.box_key_version = k.account_key_version
      WHERE k.device_id = ?`,
  )
    .bind(c.var.device.accountId, c.var.device.id)
    .first<{ account_key_version: number; sealed_key: unknown }>();
  if (!row) return fail(c, 404, "not_found");
  return c.json({ version: row.account_key_version, sealedKey: toBase64(bytes(row.sealed_key)) });
});
