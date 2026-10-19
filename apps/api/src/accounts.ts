import { Hono } from "hono";
import { fromBase64, toBase64, verifyDeviceAuthorization, type DeviceKind } from "@map-diary/crypto";
import {
  readBody,
  readSignatureHeaders,
  requestIsSignedBy,
  requireDevice,
  type AuthedEnv,
  type SignedEnv,
} from "./auth";
import { bytes, fail, isB64, isId, isObject, isPositiveInt } from "./http";
import { parseKeyBackupBody, upsertKeyBackup } from "./backup";

export const DEVICE_KINDS: readonly DeviceKind[] = ["web", "android", "claude"];

/** Ed25519 and X25519 public keys are both 32 bytes. */
const PUBLIC_KEY_B64 = 43;
/** crypto_box_seal of a 32-byte board key: 32 + 48 bytes. */
const MAX_WRAPPED_KEY_B64 = 200;

export interface NewDevice {
  id: string;
  kind: DeviceKind;
  signPublicKey: Uint8Array;
  boxPublicKey: Uint8Array;
  authorization: string;
}

interface NewBoardKey {
  boardId: string;
  keyVersion: number;
  wrappedKey: Uint8Array;
}

function parseDevice(value: unknown): NewDevice | null {
  if (!isObject(value)) return null;
  const { id, kind, signPublicKey, boxPublicKey, authorization } = value;
  if (!isId(id) || !DEVICE_KINDS.includes(kind as DeviceKind)) return null;
  if (!isPublicKey(signPublicKey) || !isPublicKey(boxPublicKey)) return null;
  if (!isB64(authorization, 100)) return null;
  return {
    id,
    kind: kind as DeviceKind,
    signPublicKey: fromBase64(signPublicKey),
    boxPublicKey: fromBase64(boxPublicKey),
    authorization,
  };
}

function parseBoardKey(value: unknown): NewBoardKey | null {
  if (!isObject(value)) return null;
  const { boardId, keyVersion, wrappedKey } = value;
  if (!isId(boardId) || !isPositiveInt(keyVersion) || !isB64(wrappedKey, MAX_WRAPPED_KEY_B64)) return null;
  return { boardId, keyVersion, wrappedKey: fromBase64(wrappedKey) };
}

export function isPublicKey(value: unknown): value is string {
  return isB64(value, PUBLIC_KEY_B64) && value.length === PUBLIC_KEY_B64;
}

function parseBoardKeys(value: unknown): NewBoardKey[] | null {
  if (!Array.isArray(value) || value.length > 50) return null;
  const keys = value.map(parseBoardKey);
  return keys.every((k): k is NewBoardKey => k !== null) ? keys : null;
}

/** The new device must sign the request with the key it is registering. */
function signedByNewDevice(req: Request, rawBody: Uint8Array, device: NewDevice): boolean {
  const headers = readSignatureHeaders(req, Date.now());
  return (
    headers !== null &&
    headers.deviceId === device.id &&
    requestIsSignedBy(req, headers, rawBody, device.signPublicKey)
  );
}

function deviceAuthorized(accountId: string, device: NewDevice, accountSignPublicKey: Uint8Array): boolean {
  return verifyDeviceAuthorization(
    {
      accountId,
      deviceId: device.id,
      kind: device.kind,
      signPublicKey: device.signPublicKey,
      boxPublicKey: device.boxPublicKey,
    },
    device.authorization,
    accountSignPublicKey,
  );
}

export function insertDevice(db: D1Database, accountId: string, d: NewDevice, now: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO devices (id, account_id, kind, sign_public_key, box_public_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(d.id, accountId, d.kind, d.signPublicKey, d.boxPublicKey, now);
}

/** A board key sealed to the account's box key, at the account's current box key version. */
function insertBoardKey(db: D1Database, accountId: string, k: NewBoardKey, now: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO board_keys (board_id, key_version, account_id, account_key_version, wrapped_key, created_at)
       SELECT ?, ?, id, box_key_version, ?, ? FROM accounts WHERE id = ?
       ON CONFLICT (board_id, key_version, account_id) DO UPDATE SET
         account_key_version = excluded.account_key_version, wrapped_key = excluded.wrapped_key`,
    )
    .bind(k.boardId, k.keyVersion, k.wrappedKey, now, accountId);
}

/** Board keys may only be stored for boards the account is in, at the board's current version. */
async function boardKeysAllowed(db: D1Database, accountId: string, keys: readonly NewBoardKey[]): Promise<boolean> {
  if (keys.length === 0) return true;
  const { results } = await db
    .prepare(
      `SELECT b.id, b.key_version FROM boards b
         JOIN board_members m ON m.board_id = b.id AND m.account_id = ?
        WHERE b.id IN (SELECT value FROM json_each(?))`,
    )
    .bind(accountId, JSON.stringify(keys.map((k) => k.boardId)))
    .all<{ id: string; key_version: number }>();
  const current = new Map(results.map((r) => [r.id, r.key_version]));
  return keys.every((k) => current.get(k.boardId) === k.keyVersion);
}

export const accounts = new Hono<SignedEnv>();

/**
 * First-run setup: creates the account (as admin), its first device, the personal board
 * with its key wrapped to the account's box key, and the passphrase key backup. Open only while no
 * account exists; later accounts arrive through invites.
 */
accounts.post("/accounts", readBody, async (c) => {
  const { body, rawBody } = c.var;
  if (!isObject(body) || !isObject(body.account) || !isObject(body.personalBoard)) {
    return fail(c, 400, "bad_request");
  }
  const { id: accountId, signPublicKey, boxPublicKey } = body.account;
  const device = parseDevice(body.device);
  const { id: boardId, wrappedKey } = body.personalBoard;
  const backup = parseKeyBackupBody(body.keyBackup);
  if (
    !isId(accountId) ||
    !isPublicKey(signPublicKey) ||
    !isPublicKey(boxPublicKey) ||
    !device ||
    !isId(boardId) ||
    !isB64(wrappedKey, MAX_WRAPPED_KEY_B64) ||
    !backup
  ) {
    return fail(c, 400, "bad_request");
  }
  if (!signedByNewDevice(c.req.raw, rawBody, device)) return fail(c, 401, "unauthenticated");
  const accountKey = fromBase64(signPublicKey);
  if (!deviceAuthorized(accountId, device, accountKey)) return fail(c, 400, "bad_device_authorization");

  const existing = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM accounts").first<{ n: number }>();
  if ((existing?.n ?? 0) > 0) return fail(c, 403, "registration_closed");

  const now = Date.now();
  const db = c.env.DB;
  try {
    await db.batch([
      // Guarded again here so two racing first-run requests cannot both win.
      db
        .prepare(
          `INSERT INTO accounts (id, is_admin, sign_public_key, box_public_key, box_key_version, created_at)
           SELECT ?, 1, ?, ?, 1, ? WHERE NOT EXISTS (SELECT 1 FROM accounts)`,
        )
        .bind(accountId, accountKey, fromBase64(boxPublicKey), now),
      insertDevice(db, accountId, device, now),
      db
        .prepare("INSERT INTO boards (id, kind, owner_account_id, key_version, created_at) VALUES (?, 'personal', ?, 1, ?)")
        .bind(boardId, accountId, now),
      db.prepare("INSERT INTO board_members (board_id, account_id, joined_at) VALUES (?, ?, ?)").bind(boardId, accountId, now),
      insertBoardKey(db, accountId, { boardId, keyVersion: 1, wrappedKey: fromBase64(wrappedKey) }, now),
      upsertKeyBackup(db, accountId, backup, now),
    ]);
  } catch {
    // A lost race (foreign key failure) or a reused id.
    return fail(c, 409, "conflict");
  }
  return c.json({ accountId, deviceId: device.id, personalBoardId: boardId }, 201);
});

/**
 * Signs a new device in. The device has already opened the passphrase backup or the
 * recovery phrase, so it holds the account key to authorise itself. Board keys are wrapped
 * to the account, so the device needs nothing else stored.
 */
accounts.post("/devices", readBody, async (c) => {
  const { body, rawBody } = c.var;
  if (!isObject(body)) return fail(c, 400, "bad_request");
  const { accountId } = body;
  const device = parseDevice(body.device);
  if (!isId(accountId) || !device) return fail(c, 400, "bad_request");
  if (!signedByNewDevice(c.req.raw, rawBody, device)) return fail(c, 401, "unauthenticated");

  const account = await c.env.DB.prepare(
    "SELECT sign_public_key FROM accounts WHERE id = ? AND removed_at IS NULL",
  )
    .bind(accountId)
    .first<{ sign_public_key: unknown }>();
  if (!account || account.sign_public_key === null) return fail(c, 403, "forbidden");
  if (!deviceAuthorized(accountId, device, bytes(account.sign_public_key))) {
    return fail(c, 403, "forbidden");
  }

  try {
    await insertDevice(c.env.DB, accountId, device, Date.now()).run();
  } catch {
    return fail(c, 409, "conflict");
  }
  return c.json({ accountId, deviceId: device.id }, 201);
});

export const me = new Hono<AuthedEnv>();

/** Everything a device needs after unlocking: the account's box key, boards, wrapped keys and devices. */
me.get("/me", readBody, requireDevice, async (c) => {
  const { id: deviceId, accountId, isAdmin } = c.var.device;
  const db = c.env.DB;
  const [account, boards, keys, devices] = await db.batch([
    db.prepare("SELECT box_public_key, box_key_version FROM accounts WHERE id = ?").bind(accountId),
    db
      .prepare(
        `SELECT b.id, b.kind, b.key_version FROM boards b
           JOIN board_members m ON m.board_id = b.id
          WHERE m.account_id = ? ORDER BY b.created_at`,
      )
      .bind(accountId),
    db
      .prepare("SELECT board_id, key_version, account_key_version, wrapped_key FROM board_keys WHERE account_id = ?")
      .bind(accountId),
    db
      .prepare(
        `SELECT id, kind, sign_public_key, box_public_key, created_at, last_seen_at, revoked_at
           FROM devices WHERE account_id = ? ORDER BY created_at`,
      )
      .bind(accountId),
  ]);

  type BoardRow = { id: string; kind: string; key_version: number };
  type AccountRow = { box_public_key: unknown; box_key_version: number };
  type KeyRow = { board_id: string; key_version: number; account_key_version: number; wrapped_key: unknown };
  type DeviceRow = {
    id: string;
    kind: string;
    sign_public_key: unknown;
    box_public_key: unknown;
    created_at: number;
    last_seen_at: number | null;
    revoked_at: number | null;
  };
  const keyRows = (keys?.results ?? []) as KeyRow[];
  const b64 = (v: unknown) => toBase64(bytes(v));
  const acc = (account?.results?.[0] ?? null) as AccountRow | null;

  return c.json({
    account: {
      id: accountId,
      isAdmin,
      boxPublicKey: acc && acc.box_public_key !== null ? b64(acc.box_public_key) : null,
      boxKeyVersion: acc?.box_key_version ?? 1,
    },
    deviceId,
    boards: ((boards?.results ?? []) as BoardRow[]).map((b) => ({
      id: b.id,
      kind: b.kind,
      keyVersion: b.key_version,
      keys: keyRows
        .filter((k) => k.board_id === b.id)
        .map((k) => ({ keyVersion: k.key_version, accountKeyVersion: k.account_key_version, wrappedKey: b64(k.wrapped_key) })),
    })),
    devices: ((devices?.results ?? []) as DeviceRow[]).map((d) => ({
      id: d.id,
      kind: d.kind,
      signPublicKey: b64(d.sign_public_key),
      boxPublicKey: b64(d.box_public_key),
      createdAt: d.created_at,
      lastSeenAt: d.last_seen_at,
      revokedAt: d.revoked_at,
    })),
  });
});

/** Stores board keys wrapped to this device's account box key. */
me.put("/board-keys", readBody, requireDevice, async (c) => {
  const body = c.var.body;
  const keys = parseBoardKeys(isObject(body) ? body.boardKeys : undefined);
  if (!keys || keys.length === 0) return fail(c, 400, "bad_request");
  const { accountId } = c.var.device;
  if (!(await boardKeysAllowed(c.env.DB, accountId, keys))) return fail(c, 403, "board_not_allowed");
  const now = Date.now();
  await c.env.DB.batch(keys.map((k) => insertBoardKey(c.env.DB, accountId, k, now)));
  return c.json({ stored: keys.length });
});
