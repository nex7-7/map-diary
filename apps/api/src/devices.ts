import { Hono } from "hono";
import { fromBase64, toBase64 } from "@map-diary/crypto";
import { readBody, requireDevice, type AuthedEnv } from "./auth";
import { isPublicKey, parseBoardKeys, type NewBoardKey } from "./accounts";
import { bytes, fail, isB64, isId, isObject, isPositiveInt } from "./http";

/** A sealed account box key is a few hundred bytes, like a pairing transfer. */
const MAX_SEALED_KEY_B64 = 1024;
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

const keyOf = (boardId: string, version: number) => `${boardId}\u0000${version}`;

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
 * it, and added the next Personal board key. The revoked device gets none of this, so the
 * server refuses it at once and nothing written from now on is readable with its keys.
 */
devices.post("/devices/:id/revoke", readBody, requireDevice, async (c) => {
  const body = c.var.body;
  if (!isObject(body)) return fail(c, 400, "bad_request");
  const { boxPublicKey, boxKeyVersion } = body;
  const boardKeys = parseBoardKeys(body.boardKeys, MAX_BOARD_KEYS);
  const deviceKeys = parseDeviceKeys(body.deviceKeys);
  if (!isPublicKey(boxPublicKey) || !isPositiveInt(boxKeyVersion) || !boardKeys || !deviceKeys) {
    return fail(c, 400, "bad_request");
  }

  const targetId = c.req.param("id");
  const { id: callerId, accountId } = c.var.device;
  if (targetId === callerId) return fail(c, 400, "cannot_revoke_self");
  const db = c.env.DB;

  const [accountRes, devicesRes, boardsRes, keysRes] = await db.batch([
    db.prepare("SELECT box_key_version FROM accounts WHERE id = ?").bind(accountId),
    db.prepare("SELECT id FROM devices WHERE account_id = ? AND revoked_at IS NULL").bind(accountId),
    db
      .prepare(
        `SELECT b.id, b.kind, b.key_version FROM boards b
           JOIN board_members m ON m.board_id = b.id AND m.account_id = ?`,
      )
      .bind(accountId),
    db.prepare("SELECT board_id, key_version FROM board_keys WHERE account_id = ?").bind(accountId),
  ]);
  const account = (accountRes?.results?.[0] ?? null) as { box_key_version: number } | null;
  const active = ((devicesRes?.results ?? []) as { id: string }[]).map((d) => d.id);
  const boards = (boardsRes?.results ?? []) as { id: string; kind: string; key_version: number }[];
  const held = (keysRes?.results ?? []) as { board_id: string; key_version: number }[];
  if (!account || !active.includes(targetId)) return fail(c, 404, "not_found");

  // The account moves exactly one version on; anything else is a stale view of it.
  if (boxKeyVersion !== account.box_key_version + 1) return fail(c, 409, "stale");

  // Every remaining device gets the new key, so none is left unable to read.
  const remaining = active.filter((id) => id !== targetId);
  if (!sameSet(remaining, deviceKeys.map((k) => k.deviceId)) || deviceKeys.length !== remaining.length) {
    return fail(c, 409, "stale");
  }

  // Every board key the account holds is re-wrapped, and the Personal board moves on one version.
  // Master and group keys rotate too once sharing exists (Phase 5); today only Personal boards do.
  const personal = boards.filter((b) => b.kind === "personal");
  const expected = [
    ...held.map((k) => keyOf(k.board_id, k.key_version)),
    ...personal.map((b) => keyOf(b.id, b.key_version + 1)),
  ];
  if (!sameSet(expected, boardKeys.map((k) => keyOf(k.boardId, k.keyVersion))) || boardKeys.length !== expected.length) {
    return fail(c, 409, "stale");
  }

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
    db.prepare(`DELETE FROM device_account_keys WHERE device_id = ? AND ${moved}`).bind(targetId, ...guard),
    db.prepare(`DELETE FROM pairings WHERE created_by_device_id = ? AND ${moved}`).bind(targetId, ...guard),
    ...personal.map((b) =>
      db
        .prepare(`UPDATE boards SET key_version = ? WHERE id = ? AND key_version = ? AND ${moved}`)
        .bind(b.key_version + 1, b.id, b.key_version, ...guard),
    ),
    ...boardKeys.map((k: NewBoardKey) =>
      db
        .prepare(
          `INSERT INTO board_keys (board_id, key_version, account_id, account_key_version, wrapped_key, created_at)
           SELECT ?, ?, ?, ?, ?, ? WHERE ${moved}
           ON CONFLICT (board_id, key_version, account_id) DO UPDATE SET
             account_key_version = excluded.account_key_version, wrapped_key = excluded.wrapped_key`,
        )
        .bind(k.boardId, k.keyVersion, accountId, boxKeyVersion, k.wrappedKey, now, ...guard),
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

  const results = await db.batch(statements);
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
