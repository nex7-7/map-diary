import { Hono } from "hono";
import { KEY_BACKUP_VERSION, fromBase64, toBase64, type KeyBackup } from "@map-diary/crypto";
import { readBody, requireDevice, type AuthedEnv, type SignedEnv } from "./auth";
import { bytes, fail, isB64, isObject, isPositiveInt } from "./http";

/** 32-byte lookup id, base64url. */
const LOOKUP_B64 = 43;

export interface KeyBackupBody {
  lookup: Uint8Array;
  backup: KeyBackup;
}

/** Validates `{ lookup, backup }` as produced by backupLookupId() and createKeyBackup(). */
export function parseKeyBackupBody(value: unknown): KeyBackupBody | null {
  if (!isObject(value) || !isObject(value.backup)) return null;
  const { lookup } = value;
  const { v, kdf, opsLimit, memLimit, salt, nonce, ciphertext } = value.backup;
  if (!isB64(lookup, LOOKUP_B64) || lookup.length !== LOOKUP_B64) return null;
  if (v !== KEY_BACKUP_VERSION || kdf !== "argon2id13") return null;
  // Bounds keep a device from storing a backup no phone could open.
  if (!isPositiveInt(opsLimit) || opsLimit > 10) return null;
  if (!isPositiveInt(memLimit) || memLimit < 8 << 20 || memLimit > 1 << 30) return null;
  if (!isB64(salt, 22) || !isB64(nonce, 32) || !isB64(ciphertext, 64 * 1024)) return null;
  return {
    lookup: fromBase64(lookup),
    backup: { v, kdf, opsLimit, memLimit, salt, nonce, ciphertext },
  };
}

export function upsertKeyBackup(db: D1Database, accountId: string, b: KeyBackupBody, now: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO key_backups (account_id, lookup, v, kdf, kdf_salt, kdf_ops, kdf_mem, nonce, ciphertext, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (account_id) DO UPDATE SET
         lookup = excluded.lookup, v = excluded.v, kdf = excluded.kdf, kdf_salt = excluded.kdf_salt,
         kdf_ops = excluded.kdf_ops, kdf_mem = excluded.kdf_mem, nonce = excluded.nonce,
         ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`,
    )
    .bind(
      accountId,
      b.lookup,
      b.backup.v,
      b.backup.kdf,
      fromBase64(b.backup.salt),
      b.backup.opsLimit,
      b.backup.memLimit,
      fromBase64(b.backup.nonce),
      fromBase64(b.backup.ciphertext),
      now,
    );
}

/**
 * Fetching needs no signature (a new device has no keys yet), only the lookup id derived
 * from the passphrase. It is a POST so the lookup id never lands in URLs or logs.
 */
export const backupFetch = new Hono<SignedEnv>();

backupFetch.post("/key-backup/fetch", readBody, async (c) => {
  const body = c.var.body;
  const lookup = isObject(body) ? body.lookup : undefined;
  if (!isB64(lookup, LOOKUP_B64) || lookup.length !== LOOKUP_B64) return fail(c, 400, "bad_request");
  const row = await c.env.DB.prepare(
    `SELECT k.account_id, k.v, k.kdf, k.kdf_salt, k.kdf_ops, k.kdf_mem, k.nonce, k.ciphertext
       FROM key_backups k JOIN accounts a ON a.id = k.account_id
      WHERE k.lookup = ? AND a.removed_at IS NULL`,
  )
    .bind(fromBase64(lookup))
    .first<{
      account_id: string;
      v: number;
      kdf: string;
      kdf_salt: unknown;
      kdf_ops: number;
      kdf_mem: number;
      nonce: unknown;
      ciphertext: unknown;
    }>();
  if (!row) return fail(c, 404, "not_found");
  return c.json({
    accountId: row.account_id,
    backup: {
      v: row.v,
      kdf: row.kdf,
      opsLimit: row.kdf_ops,
      memLimit: row.kdf_mem,
      salt: toBase64(bytes(row.kdf_salt)),
      nonce: toBase64(bytes(row.nonce)),
      ciphertext: toBase64(bytes(row.ciphertext)),
    },
  });
});

export const backupWrite = new Hono<AuthedEnv>();

/** Replaces the account's backup, for example after a passphrase change or a new group key. */
backupWrite.put("/key-backup", readBody, requireDevice, async (c) => {
  const parsed = parseKeyBackupBody(c.var.body);
  if (!parsed) return fail(c, 400, "bad_request");
  try {
    await upsertKeyBackup(c.env.DB, c.var.device.accountId, parsed, Date.now()).run();
  } catch {
    // The lookup id is taken by another account (the same passphrase); ask for another.
    return fail(c, 409, "lookup_taken");
  }
  return c.json({ ok: true });
});
