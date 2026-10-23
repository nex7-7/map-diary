import { Hono } from "hono";
import { toBase64 } from "@map-diary/crypto";
import { readBody, requireAdmin, requireDevice, type AuthedEnv } from "./auth";
import { fail, isId } from "./http";

/**
 * The admin panel's Devices, Resolver and Data sections. Like the rest of admin power these
 * are enforced by the admin device's signature, not by keys: nothing here returns anything
 * the server could not already read, and nothing opens anyone's boards.
 */
export const adminTools = new Hono<AuthedEnv>();

adminTools.use("/admin/*", readBody, requireDevice, requireAdmin);

/** Every device on the app, oldest account first, with each account's devices oldest first. */
adminTools.get("/admin/devices", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT d.id, d.account_id, d.kind, d.created_at, d.last_seen_at, d.revoked_at, d.rekey_due_at
       FROM devices d JOIN accounts a ON a.id = d.account_id
      ORDER BY a.created_at, d.created_at`,
  ).all<{
    id: string;
    account_id: string;
    kind: string;
    created_at: number;
    last_seen_at: number | null;
    revoked_at: number | null;
    rekey_due_at: number | null;
  }>();
  return c.json({
    devices: results.map((d) => ({
      id: d.id,
      accountId: d.account_id,
      kind: d.kind,
      createdAt: d.created_at,
      lastSeenAt: d.last_seen_at,
      revokedAt: d.revoked_at,
      rekeyDue: d.rekey_due_at !== null,
    })),
  });
});

/**
 * Signs out a device of someone else's account. The server refuses it at once and drops
 * everything sealed to it (its copy of the account key, a Claude device's keys and connector,
 * open pairings). Moving that account to new keys needs its owner's recovery seed, so the
 * device is marked and the owner's Devices screen asks them to finish the revoke. The admin's
 * own devices are revoked from the Devices screen, which does both at once.
 */
adminTools.post("/admin/devices/:id/revoke", async (c) => {
  const id = c.req.param("id");
  if (!isId(id)) return fail(c, 400, "bad_request");
  const db = c.env.DB;
  const target = await db
    .prepare("SELECT account_id FROM devices WHERE id = ? AND revoked_at IS NULL")
    .bind(id)
    .first<{ account_id: string }>();
  if (!target) return fail(c, 404, "not_found");
  if (target.account_id === c.var.device.accountId) return fail(c, 400, "own_device");
  const now = Date.now();
  const results = await db.batch([
    db.prepare("UPDATE devices SET revoked_at = ?, rekey_due_at = ? WHERE id = ? AND revoked_at IS NULL").bind(now, now, id),
    db.prepare("DELETE FROM device_account_keys WHERE device_id = ?").bind(id),
    db.prepare("DELETE FROM pairings WHERE created_by_device_id = ?").bind(id),
    db.prepare("DELETE FROM claude_connectors WHERE device_id = ?").bind(id),
    db.prepare("DELETE FROM device_board_keys WHERE device_id = ?").bind(id),
  ]);
  if (results[0]?.meta.changes !== 1) return fail(c, 404, "not_found");
  return c.json({ revoked: id });
});

/** Jobs the admin panel lists: the unfinished ones, newest first. */
const MAX_LISTED_JOBS = 200;

/**
 * The resolver queue: how many jobs are waiting, found and failed, and the waiting and failed
 * ones with their query. Jobs are anonymous, so this shows what the resolver itself sees and
 * nothing about who asked.
 */
adminTools.get("/admin/resolver", async (c) => {
  const db = c.env.DB;
  const now = Date.now();
  const [counts, jobs] = await db.batch([
    db.prepare("SELECT status, COUNT(*) AS n FROM resolver_jobs WHERE expires_at > ? GROUP BY status").bind(now),
    db
      .prepare(
        `SELECT id, status, query, attempts, created_at, updated_at, expires_at FROM resolver_jobs
          WHERE status IN ('pending', 'failed') AND expires_at > ? ORDER BY created_at DESC LIMIT ?`,
      )
      .bind(now, MAX_LISTED_JOBS),
  ]);
  const byStatus = Object.fromEntries(((counts?.results ?? []) as { status: string; n: number }[]).map((r) => [r.status, r.n]));
  type JobRow = {
    id: string;
    status: string;
    query: string | null;
    attempts: number;
    created_at: number;
    updated_at: number;
    expires_at: number;
  };
  return c.json({
    counts: { pending: byStatus.pending ?? 0, resolved: byStatus.resolved ?? 0, failed: byStatus.failed ?? 0 },
    jobs: ((jobs?.results ?? []) as JobRow[]).map((j) => ({
      id: j.id,
      status: j.status,
      query: j.query,
      attempts: j.attempts,
      createdAt: j.created_at,
      updatedAt: j.updated_at,
      expiresAt: j.expires_at,
    })),
  });
});

/**
 * Puts a failed or stuck job back in the queue with a fresh count of attempts. The device that
 * asked still holds the job's one-time key, so the answer reaches it as before.
 */
adminTools.post("/admin/resolver/jobs/:id/retry", async (c) => {
  const id = c.req.param("id");
  if (!isId(id)) return fail(c, 400, "bad_request");
  const now = Date.now();
  const { meta } = await c.env.DB.prepare(
    `UPDATE resolver_jobs SET status = 'pending', attempts = 0, updated_at = ?
      WHERE id = ? AND status IN ('pending', 'failed') AND query IS NOT NULL AND expires_at > ?`,
  )
    .bind(now, id, now)
    .run();
  if (meta.changes === 0) return fail(c, 404, "not_found");
  return c.json({ id, status: "pending" });
});

/** Every failed job back in the queue at once, for after the resolver was down. */
adminTools.post("/admin/resolver/retry-failed", async (c) => {
  const now = Date.now();
  const { meta } = await c.env.DB.prepare(
    `UPDATE resolver_jobs SET status = 'pending', attempts = 0, updated_at = ?
      WHERE status = 'failed' AND query IS NOT NULL AND expires_at > ?`,
  )
    .bind(now, now)
    .run();
  return c.json({ retried: meta.changes });
});

/** The app's own tables, in creation order. Cloudflare's and SQLite's internal ones are left out. */
async function tableNames(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY rowid`,
    )
    .all<{ name: string }>();
  return results.map((r) => r.name);
}

/** Free-tier limits the Data section measures against. */
const D1_FREE_BYTES = 500 * 1000 * 1000;
const R2_FREE_BYTES = 10 * 1000 * 1000 * 1000;
const MAP_FILE = "mumbai.pmtiles";

/** Storage used: the database's size and rows per table, and the map file in R2. */
adminTools.get("/admin/data", async (c) => {
  const db = c.env.DB;
  const names = await tableNames(db);
  const counts = await db.batch(names.map((n) => db.prepare(`SELECT COUNT(*) AS n FROM "${n}"`)));
  const sizeBytes = counts[0]?.meta.size_after ?? null;
  const map = await c.env.TILES.head(MAP_FILE);
  return c.json({
    d1: {
      sizeBytes,
      limitBytes: D1_FREE_BYTES,
      tables: names.map((name, i) => ({ name, rows: (counts[i]?.results?.[0] as { n: number } | undefined)?.n ?? 0 })),
    },
    r2: { mapFileBytes: map?.size ?? null, limitBytes: R2_FREE_BYTES },
  });
});

/** Rows per export page: keeps each call well inside the free tier's CPU time. */
const EXPORT_PAGE = 200;

/**
 * One page of a table for the backup the admin's device assembles into a SQL file. The first
 * call (no `table`) returns the schema and the table list. Columns come back as JSON values,
 * with a BLOB as `{ "b64": "..." }`. Everything here is what D1 already holds: envelopes are
 * ciphertext, keys are wrapped and backups are sealed under passphrases.
 */
adminTools.get("/admin/data/export", async (c) => {
  const db = c.env.DB;
  const names = await tableNames(db);
  const table = c.req.query("table");
  if (table === undefined) {
    const { results } = await db
      .prepare(
        `SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND type IN ('table', 'index')
           AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY rowid`,
      )
      .all<{ type: string; name: string; sql: string }>();
    return c.json({ tables: names, schema: results.map((r) => r.sql) });
  }
  if (!names.includes(table)) return fail(c, 404, "not_found");
  const afterParam = c.req.query("after") ?? "0";
  if (!/^\d{1,15}$/.test(afterParam)) return fail(c, 400, "bad_request");
  const { results } = await db
    .prepare(`SELECT rowid AS _export_rowid, * FROM "${table}" WHERE rowid > ? ORDER BY rowid LIMIT ?`)
    .bind(Number(afterParam), EXPORT_PAGE + 1)
    .all<Record<string, unknown>>();
  const page = results.slice(0, EXPORT_PAGE);
  const rows = page.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) if (k !== "_export_rowid") out[k] = exportValue(v);
    return out;
  });
  const last = page.at(-1)?._export_rowid;
  return c.json({ table, rows, next: results.length > EXPORT_PAGE && typeof last === "number" ? last : null });
});

function exportValue(value: unknown): unknown {
  if (value instanceof ArrayBuffer) return { b64: toBase64(new Uint8Array(value)) };
  if (ArrayBuffer.isView(value)) return { b64: toBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
  if (Array.isArray(value)) return { b64: toBase64(Uint8Array.from(value as number[])) };
  return value;
}
