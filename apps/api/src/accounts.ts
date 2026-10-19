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
import { coversEveryVersion, isInviteId, parseVersionKeys } from "./admin";
import { grantBoard, masterBoard } from "./boards";
import { claudeKeysHeld } from "./claude";

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

export interface NewBoardKey {
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

export function parseBoardKeys(value: unknown, max = 50): NewBoardKey[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
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
 * Creates an account with its first device, its personal board with the key wrapped to the
 * account's box key, and (optionally, for invited friends) the passphrase key backup. Invited
 * accounts also join the master board with every key version wrapped to them.
 *
 * Without an invite this is first-run setup: the admin account, open only while no account
 * exists, and the passphrase backup is required. Every later account needs an unused,
 * unexpired app invite, which this uses up.
 */
accounts.post("/accounts", readBody, async (c) => {
  const { body, rawBody } = c.var;
  if (!isObject(body) || !isObject(body.account) || !isObject(body.personalBoard)) {
    return fail(c, 400, "bad_request");
  }
  const { id: accountId, signPublicKey, boxPublicKey } = body.account;
  const device = parseDevice(body.device);
  const { id: boardId, wrappedKey } = body.personalBoard;
  const invite = body.invite;
  const backup = body.keyBackup === undefined ? null : parseKeyBackupBody(body.keyBackup);
  const masterKeys = invite === undefined ? [] : parseVersionKeys(body.masterKeys);
  if (
    !isId(accountId) ||
    !isPublicKey(signPublicKey) ||
    !isPublicKey(boxPublicKey) ||
    !device ||
    !isId(boardId) ||
    !isB64(wrappedKey, MAX_WRAPPED_KEY_B64) ||
    (invite !== undefined && !isInviteId(invite)) ||
    (body.keyBackup !== undefined && !backup) ||
    (invite === undefined && !backup) ||
    !masterKeys
  ) {
    return fail(c, 400, "bad_request");
  }
  if (!signedByNewDevice(c.req.raw, rawBody, device)) return fail(c, 401, "unauthenticated");
  const accountKey = fromBase64(signPublicKey);
  if (!deviceAuthorized(accountId, device, accountKey)) return fail(c, 400, "bad_device_authorization");

  const now = Date.now();
  const db = c.env.DB;
  let grant: D1PreparedStatement[] = [];
  if (invite === undefined) {
    const existing = await db.prepare("SELECT COUNT(*) AS n FROM accounts").first<{ n: number }>();
    if ((existing?.n ?? 0) > 0) return fail(c, 403, "registration_closed");
  } else {
    const open = await db
      .prepare("SELECT 1 AS ok FROM app_invites WHERE id = ? AND used_at IS NULL AND expires_at > ?")
      .bind(invite, now)
      .first<{ ok: number }>();
    if (!open) return fail(c, 403, "invite_invalid");
    // An invite carries the Public board: the friend re-wrapped every master key version from it
    // to their new account key. A master key rotated since the invite was made leaves it short.
    const master = await masterBoard(db);
    if (!master || !coversEveryVersion(masterKeys, master.key_version)) return fail(c, 409, "invite_stale");
    grant = grantBoard(
      db,
      master.id,
      accountId,
      masterKeys.map((k) => ({ boardId: master.id, keyVersion: k.keyVersion, wrappedKey: fromBase64(k.wrappedKey) })),
      now,
    );
  }
  if (backup) {
    // Two accounts cannot share a passphrase: the lookup id derived from it must be unique.
    const taken = await db.prepare("SELECT 1 AS t FROM key_backups WHERE lookup = ?").bind(backup.lookup).first();
    if (taken) return fail(c, 409, "lookup_taken");
  }

  // Guarded again inside the batch so two racing requests cannot both win: if the account row
  // is not inserted, the device insert below fails its foreign key and the batch rolls back.
  const createAccount =
    invite === undefined
      ? db
          .prepare(
            `INSERT INTO accounts (id, is_admin, sign_public_key, box_public_key, box_key_version, created_at)
             SELECT ?, 1, ?, ?, 1, ? WHERE NOT EXISTS (SELECT 1 FROM accounts)`,
          )
          .bind(accountId, accountKey, fromBase64(boxPublicKey), now)
      : db
          .prepare(
            `INSERT INTO accounts (id, is_admin, sign_public_key, box_public_key, box_key_version, created_at)
             SELECT ?, 0, ?, ?, 1, ?
              WHERE EXISTS (SELECT 1 FROM app_invites WHERE id = ? AND used_at IS NULL AND expires_at > ?)`,
          )
          .bind(accountId, accountKey, fromBase64(boxPublicKey), now, invite, now);

  try {
    await db.batch([
      createAccount,
      ...(invite === undefined
        ? []
        : [
            db
              // The master keys it carried are no use any more; drop them so a leaked link and a
              // copy of the database together open nothing.
              .prepare(
                "UPDATE app_invites SET used_at = ?, used_by_account_id = ?, master_keys = '[]' WHERE id = ? AND used_at IS NULL",
              )
              .bind(now, accountId, invite),
          ]),
      insertDevice(db, accountId, device, now),
      db
        .prepare("INSERT INTO boards (id, kind, owner_account_id, key_version, created_at) VALUES (?, 'personal', ?, 1, ?)")
        .bind(boardId, accountId, now),
      db.prepare("INSERT INTO board_members (board_id, account_id, joined_at) VALUES (?, ?, ?)").bind(boardId, accountId, now),
      insertBoardKey(db, accountId, { boardId, keyVersion: 1, wrappedKey: fromBase64(wrappedKey) }, now),
      ...grant,
      ...(backup ? [upsertKeyBackup(db, accountId, backup, now)] : []),
    ]);
  } catch {
    // A lost race (foreign key failure), a reused id or a passphrase lookup id already taken.
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
  const [account, boards, keys, devices, members] = await db.batch([
    db
      .prepare(
        `SELECT box_public_key, box_key_version,
                EXISTS (SELECT 1 FROM key_backups WHERE account_id = accounts.id) AS has_backup
           FROM accounts WHERE id = ?`,
      )
      .bind(accountId),
    db
      .prepare(
        `SELECT b.id, b.kind, b.key_version, b.rotation_due_at FROM boards b
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
    // Same order as /sync, so a device does not see its groups change between the two.
    db
      .prepare(
        `SELECT g.board_id, g.account_id FROM board_members g JOIN boards b ON b.id = g.board_id AND b.kind = 'group'
          WHERE g.board_id IN (SELECT board_id FROM board_members WHERE account_id = ?)
          ORDER BY g.joined_at, g.account_id`,
      )
      .bind(accountId),
  ]);

  type BoardRow = { id: string; kind: string; key_version: number; rotation_due_at: number | null };
  const groupMembers = (members?.results ?? []) as { board_id: string; account_id: string }[];
  type AccountRow = { box_public_key: unknown; box_key_version: number; has_backup: number };
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
  const deviceRows = (devices?.results ?? []) as DeviceRow[];
  // Which master and Personal key versions each Claude device holds, so this device can add
  // the ones a rotation made since.
  const claudeKeys = deviceRows.some((d) => d.kind === "claude" && d.revoked_at === null)
    ? await claudeKeysHeld(db, accountId)
    : new Map<string, { boardId: string; keyVersion: number }[]>();
  const b64 = (v: unknown) => toBase64(bytes(v));
  const acc = (account?.results?.[0] ?? null) as AccountRow | null;

  return c.json({
    account: {
      id: accountId,
      isAdmin,
      boxPublicKey: acc && acc.box_public_key !== null ? b64(acc.box_public_key) : null,
      boxKeyVersion: acc?.box_key_version ?? 1,
      hasPassphrase: acc?.has_backup === 1,
    },
    deviceId,
    boards: ((boards?.results ?? []) as BoardRow[]).map((b) => ({
      id: b.id,
      kind: b.kind,
      keyVersion: b.key_version,
      rotationDue: b.rotation_due_at !== null,
      ...(b.kind === "group"
        ? { memberIds: groupMembers.filter((m) => m.board_id === b.id).map((m) => m.account_id) }
        : {}),
      keys: keyRows
        .filter((k) => k.board_id === b.id)
        .map((k) => ({ keyVersion: k.key_version, accountKeyVersion: k.account_key_version, wrappedKey: b64(k.wrapped_key) })),
    })),
    devices: deviceRows.map((d) => ({
      id: d.id,
      kind: d.kind,
      signPublicKey: b64(d.sign_public_key),
      boxPublicKey: b64(d.box_public_key),
      createdAt: d.created_at,
      lastSeenAt: d.last_seen_at,
      revokedAt: d.revoked_at,
      ...(d.kind === "claude" && d.revoked_at === null ? { boardKeys: claudeKeys.get(d.id) ?? [] } : {}),
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
