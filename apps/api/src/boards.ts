import { Hono } from "hono";
import { LINK_HASH_BYTES, fromBase64, toBase64 } from "@map-diary/crypto";
import { readBody, requireDevice, type AuthedEnv } from "./auth";
import type { NewBoardKey } from "./accounts";
import { bytes, fail, isB64, isId, isObject } from "./http";

/** crypto_box_seal of a 32-byte board key: 32 + 48 bytes. */
const MAX_WRAPPED_KEY_B64 = 200;
/** A link hash in base64url. */
const LINK_HASH_B64 = Math.ceil((LINK_HASH_BYTES * 4) / 3);
/** Source links per place, and so link hashes per place envelope. */
export const MAX_LINK_HASHES = 10;
const MAX_CHECK = 50;

export function isLinkHash(value: unknown): value is string {
  return isB64(value, LINK_HASH_B64) && value.length === LINK_HASH_B64;
}

/** The master board's id and current key version, or null before the admin creates it. */
export async function masterBoard(db: D1Database): Promise<{ id: string; key_version: number } | null> {
  return db.prepare("SELECT id, key_version FROM boards WHERE kind = 'master'").first<{ id: string; key_version: number }>();
}

/**
 * Statements that make an account a member of a board and store the board's keys wrapped to
 * the account's current box key, one row per key version. App invites use this to grant the
 * master key (every version, so the new member reads the whole catalogue), and group invites
 * will use it for group keys. The caller checks who may grant what.
 */
export function grantBoard(
  db: D1Database,
  boardId: string,
  accountId: string,
  keys: readonly NewBoardKey[],
  now: number,
): D1PreparedStatement[] {
  return [
    db
      .prepare("INSERT INTO board_members (board_id, account_id, joined_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")
      .bind(boardId, accountId, now),
    ...keys.map((k) =>
      db
        .prepare(
          `INSERT INTO board_keys (board_id, key_version, account_id, account_key_version, wrapped_key, created_at)
           SELECT ?, ?, id, box_key_version, ?, ? FROM accounts WHERE id = ?
           ON CONFLICT (board_id, key_version, account_id) DO UPDATE SET
             account_key_version = excluded.account_key_version, wrapped_key = excluded.wrapped_key`,
        )
        .bind(boardId, k.keyVersion, k.wrappedKey, now, accountId),
    ),
  ];
}

export const boards = new Hono<AuthedEnv>();

/**
 * Creates the master board, once, from the admin's device: the board, the admin as its first
 * member and the first master key wrapped to the admin's account box key. Other people join
 * it through app invites.
 */
boards.post("/boards/master", readBody, requireDevice, async (c) => {
  const body = c.var.body;
  if (!isObject(body)) return fail(c, 400, "bad_request");
  const { id, wrappedKey } = body;
  if (!isId(id) || !isB64(wrappedKey, MAX_WRAPPED_KEY_B64)) return fail(c, 400, "bad_request");
  const { accountId, isAdmin } = c.var.device;
  if (!isAdmin) return fail(c, 403, "forbidden");

  const db = c.env.DB;
  const now = Date.now();
  try {
    await db.batch([
      // The unique index on kind = 'master' makes a second board fail the whole batch.
      db.prepare("INSERT INTO boards (id, kind, key_version, created_at) VALUES (?, 'master', 1, ?)").bind(id, now),
      ...grantBoard(db, id, accountId, [{ boardId: id, keyVersion: 1, wrappedKey: fromBase64(wrappedKey) }], now),
    ]);
  } catch {
    return fail(c, 409, "master_exists");
  }
  return c.json({ id, keyVersion: 1 }, 201);
});

/**
 * The members of a board the caller is in, with each one's current account box key, so a
 * device can wrap a rotated board key to every member.
 */
boards.get("/boards/:id/members", readBody, requireDevice, async (c) => {
  const boardId = c.req.param("id");
  const db = c.env.DB;
  const { results } = await db
    .prepare(
      `SELECT a.id, a.box_public_key, a.box_key_version FROM board_members m
         JOIN accounts a ON a.id = m.account_id AND a.removed_at IS NULL
        WHERE m.board_id = ?
          AND EXISTS (SELECT 1 FROM board_members me WHERE me.board_id = m.board_id AND me.account_id = ?)
        ORDER BY a.id`,
    )
    .bind(boardId, c.var.device.accountId)
    .all<{ id: string; box_public_key: unknown; box_key_version: number }>();
  if (results.length === 0) return fail(c, 404, "not_found");
  return c.json({
    members: results
      .filter((r) => r.box_public_key !== null)
      .map((r) => ({ accountId: r.id, boxPublicKey: toBase64(bytes(r.box_public_key)), boxKeyVersion: r.box_key_version })),
  });
});

/**
 * Which of these link hashes already belong to a place in the catalogue. Any member of the
 * master board can ask; the hashes are keyed, so the server learns nothing about the links.
 */
boards.post("/place-links/check", readBody, requireDevice, async (c) => {
  const body = c.var.body;
  const hashes = isObject(body) ? body.hashes : undefined;
  if (!Array.isArray(hashes) || hashes.length === 0 || hashes.length > MAX_CHECK || !hashes.every(isLinkHash)) {
    return fail(c, 400, "bad_request");
  }
  const db = c.env.DB;
  const master = await masterBoard(db);
  const member =
    master &&
    (await db
      .prepare("SELECT 1 AS ok FROM board_members WHERE board_id = ? AND account_id = ?")
      .bind(master.id, c.var.device.accountId)
      .first());
  if (!member) return fail(c, 403, "forbidden");

  const unique = [...new Set(hashes)];
  const rows = await db.batch(
    unique.map((h) => db.prepare("SELECT link_hash, place_id FROM place_link_hashes WHERE link_hash = ?").bind(fromBase64(h))),
  );
  const matches = rows.flatMap((r) =>
    ((r.results ?? []) as { link_hash: unknown; place_id: string }[]).map((m) => ({
      hash: toBase64(bytes(m.link_hash)),
      placeId: m.place_id,
    })),
  );
  return c.json({ matches });
});
