import { Hono } from "hono";
import {
  connectorSecretHash,
  fromBase64,
  isConnectorSecret,
  openClaudeDeviceKeys,
  ready,
  toBase64,
  unwrapKeyFromMember,
  verifyDeviceAuthorization,
  type BoardKey,
  type IdentityKeys,
} from "@map-diary/crypto";
import { readBody, requireDevice, type AuthedEnv } from "./auth";
import { insertDevice, isPublicKey, parseBoardKeys, type NewBoardKey } from "./accounts";
import { bytes, fail, isB64, isId, isObject } from "./http";

/** The boards a Claude device holds keys for. Never a group. */
export const CLAUDE_BOARD_KINDS = ["master", "personal"] as const;
export type ClaudeBoardKind = (typeof CLAUDE_BOARD_KINDS)[number];

/** A connector secret hash, base64url. */
const SECRET_HASH_B64 = 43;
/** The four keypair halves as JSON, sealed: a few hundred bytes. */
const MAX_SEALED_KEYS_B64 = 1024;
/** Every master and Personal key version; each revocation or removal adds one. */
const MAX_BOARD_KEYS = 500;

/** The account's master and Personal boards, at their current key versions. */
async function claudeBoards(db: D1Database, accountId: string): Promise<{ id: string; kind: ClaudeBoardKind; key_version: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT b.id, b.kind, b.key_version FROM boards b
         JOIN board_members m ON m.board_id = b.id AND m.account_id = ?
        WHERE b.kind IN ('master', 'personal') ORDER BY b.created_at`,
    )
    .bind(accountId)
    .all<{ id: string; kind: ClaudeBoardKind; key_version: number }>();
  return results;
}

function insertDeviceBoardKey(db: D1Database, deviceId: string, k: NewBoardKey, now: number): D1PreparedStatement {
  // A key version never changes, so a second wrap of the same one is a no-op.
  return db
    .prepare(
      `INSERT INTO device_board_keys (device_id, board_id, key_version, wrapped_key, created_at)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    )
    .bind(deviceId, k.boardId, k.keyVersion, k.wrappedKey, now);
}

const keyOf = (boardId: string, version: number) => `${boardId}\u0000${version}`;

export const claude = new Hono<AuthedEnv>();

/**
 * Connects Claude: registers a `claude` device made in the owner's browser. The browser
 * authorised its public keys with its own device key (as when approving a pairing), sealed
 * the Claude device's secret keys under a key derived from the connector secret, and wrapped
 * every master and Personal key version to the Claude device. The secret itself never
 * reaches this route; only its hash does, to find the device on each assistant call. An
 * account has at most one Claude device; revoke it to connect a new one.
 */
claude.post("/claude-devices", readBody, requireDevice, async (c) => {
  const body = c.var.body;
  if (!isObject(body) || !isObject(body.device) || !isObject(body.connector)) return fail(c, 400, "bad_request");
  const { id, signPublicKey, boxPublicKey, authorization } = body.device;
  const { secretHash, nonce, sealedKeys } = body.connector;
  const boardKeys = parseBoardKeys(body.boardKeys, MAX_BOARD_KEYS);
  if (
    !isId(id) ||
    !isPublicKey(signPublicKey) ||
    !isPublicKey(boxPublicKey) ||
    !isB64(authorization, 100) ||
    !isB64(secretHash, SECRET_HASH_B64) ||
    secretHash.length !== SECRET_HASH_B64 ||
    !isB64(nonce, 32) ||
    !isB64(sealedKeys, MAX_SEALED_KEYS_B64) ||
    !boardKeys
  ) {
    return fail(c, 400, "bad_request");
  }
  const { id: callerId, accountId } = c.var.device;
  const db = c.env.DB;

  const caller = await db
    .prepare("SELECT sign_public_key FROM devices WHERE id = ?")
    .bind(callerId)
    .first<{ sign_public_key: unknown }>();
  const device = {
    id,
    kind: "claude" as const,
    signPublicKey: fromBase64(signPublicKey),
    boxPublicKey: fromBase64(boxPublicKey),
    authorization,
  };
  const authorised =
    caller !== null &&
    verifyDeviceAuthorization(
      { accountId, deviceId: id, kind: "claude", signPublicKey: device.signPublicKey, boxPublicKey: device.boxPublicKey },
      authorization,
      bytes(caller.sign_public_key),
    );
  if (!authorised) return fail(c, 403, "forbidden");

  const existing = await db
    .prepare("SELECT 1 AS ok FROM devices WHERE account_id = ? AND kind = 'claude' AND revoked_at IS NULL")
    .bind(accountId)
    .first();
  if (existing) return fail(c, 409, "claude_connected");

  // Exactly every version of the master and Personal keys, so Claude reads the whole history
  // of both and nothing else.
  const boards = await claudeBoards(db, accountId);
  const expected = boards.flatMap((b) => Array.from({ length: b.key_version }, (_, i) => keyOf(b.id, i + 1)));
  const sent = new Set(boardKeys.map((k) => keyOf(k.boardId, k.keyVersion)));
  if (sent.size !== boardKeys.length || sent.size !== expected.length || !expected.every((k) => sent.has(k))) {
    return fail(c, 409, "stale");
  }

  const now = Date.now();
  try {
    await db.batch([
      insertDevice(db, accountId, device, now),
      db
        .prepare("INSERT INTO claude_connectors (device_id, secret_hash, nonce, sealed_keys, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(id, fromBase64(secretHash), fromBase64(nonce), fromBase64(sealedKeys), now),
      ...boardKeys.map((k) => insertDeviceBoardKey(db, id, k, now)),
    ]);
  } catch {
    return fail(c, 409, "conflict");
  }
  return c.json({ deviceId: id }, 201);
});

/**
 * Adds master and Personal key versions the Claude device does not hold yet, after a
 * rotation. Any of the owner's other devices does this on its next sync; until then Claude
 * reads only older items and its writes are refused.
 */
claude.put("/claude-devices/:id/board-keys", readBody, requireDevice, async (c) => {
  const body = c.var.body;
  const keys = parseBoardKeys(isObject(body) ? body.boardKeys : undefined, MAX_BOARD_KEYS);
  if (!keys || keys.length === 0) return fail(c, 400, "bad_request");
  const targetId = c.req.param("id");
  const { accountId } = c.var.device;
  const db = c.env.DB;
  const target = await db
    .prepare("SELECT 1 AS ok FROM devices WHERE id = ? AND account_id = ? AND kind = 'claude' AND revoked_at IS NULL")
    .bind(targetId, accountId)
    .first();
  if (!target) return fail(c, 404, "not_found");
  const current = new Map((await claudeBoards(db, accountId)).map((b) => [b.id, b.key_version]));
  if (!keys.every((k) => k.keyVersion <= (current.get(k.boardId) ?? 0))) return fail(c, 403, "board_not_allowed");
  const now = Date.now();
  await db.batch(keys.map((k) => insertDeviceBoardKey(db, targetId, k, now)));
  return c.json({ stored: keys.length });
});

/** The board key versions each of the account's active Claude devices holds, for `/me`. */
export async function claudeKeysHeld(db: D1Database, accountId: string): Promise<Map<string, { boardId: string; keyVersion: number }[]>> {
  const { results } = await db
    .prepare(
      `SELECT k.device_id, k.board_id, k.key_version FROM device_board_keys k
         JOIN devices d ON d.id = k.device_id AND d.account_id = ? AND d.revoked_at IS NULL
        ORDER BY k.board_id, k.key_version`,
    )
    .bind(accountId)
    .all<{ device_id: string; board_id: string; key_version: number }>();
  const out = new Map<string, { boardId: string; keyVersion: number }[]>();
  for (const r of results) {
    const list = out.get(r.device_id) ?? [];
    list.push({ boardId: r.board_id, keyVersion: r.key_version });
    out.set(r.device_id, list);
  }
  return out;
}

/** A Claude device opened with its connector secret, for the length of one assistant call. */
export interface UnlockedClaude {
  deviceId: string;
  accountId: string;
  /** The Claude device's own keys: it signs what it writes. */
  identity: IdentityKeys;
  /** The account's master and Personal boards, at the key version new writes must use. */
  boards: { id: string; kind: ClaudeBoardKind; keyVersion: number }[];
  /** Every key version Claude holds for those boards. */
  boardKeys: BoardKey[];
  /**
   * False when a board has moved to a key version Claude does not hold yet: reads still work
   * for older items, but writes must wait until one of the owner's devices syncs.
   */
  upToDate: boolean;
}

/**
 * Finds the Claude device by its connector secret and opens its keys and board keys. Returns
 * null for an unknown secret, a revoked device or a removed account. Keep the result only
 * for the call; never log it.
 */
export async function unlockClaudeDevice(db: D1Database, secret: string, now = Date.now()): Promise<UnlockedClaude | null> {
  await ready();
  if (!isConnectorSecret(secret)) return null;
  const row = await db
    .prepare(
      `SELECT c.device_id, c.nonce, c.sealed_keys, d.account_id, d.last_seen_at FROM claude_connectors c
         JOIN devices d ON d.id = c.device_id AND d.kind = 'claude' AND d.revoked_at IS NULL
         JOIN accounts a ON a.id = d.account_id AND a.removed_at IS NULL
        WHERE c.secret_hash = ?`,
    )
    .bind(connectorSecretHash(secret))
    .first<{ device_id: string; nonce: unknown; sealed_keys: unknown; account_id: string; last_seen_at: number | null }>();
  if (!row) return null;
  let identity: IdentityKeys;
  try {
    identity = openClaudeDeviceKeys(
      row.device_id,
      { nonce: toBase64(bytes(row.nonce)), sealedKeys: toBase64(bytes(row.sealed_keys)) },
      secret,
    );
  } catch {
    return null;
  }

  const [boardRows, keyRows] = await Promise.all([
    claudeBoards(db, row.account_id),
    db
      .prepare("SELECT board_id, key_version, wrapped_key FROM device_board_keys WHERE device_id = ?")
      .bind(row.device_id)
      .all<{ board_id: string; key_version: number; wrapped_key: unknown }>()
      .then((r) => r.results),
  ]);
  const boards = boardRows.map((b) => ({ id: b.id, kind: b.kind, keyVersion: b.key_version }));
  const boardIds = new Set(boards.map((b) => b.id));
  const boardKeys: BoardKey[] = keyRows
    .filter((k) => boardIds.has(k.board_id))
    .map((k) => ({ boardId: k.board_id, version: k.key_version, key: unwrapKeyFromMember(bytes(k.wrapped_key), identity) }));
  const upToDate = boards.every((b) => boardKeys.some((k) => k.boardId === b.id && k.version === b.keyVersion));

  // Hourly, like signed requests, so the Devices screen shows when Claude was last used.
  if (row.last_seen_at === null || now - row.last_seen_at > 60 * 60 * 1000) {
    await db.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").bind(now, row.device_id).run();
  }
  return { deviceId: row.device_id, accountId: row.account_id, identity, boards, boardKeys, upToDate };
}
