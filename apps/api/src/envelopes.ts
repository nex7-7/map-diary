import { Hono } from "hono";
import {
  ENVELOPE_TYPES,
  ENVELOPE_VERSION,
  fromBase64,
  toBase64,
  verifyEnvelope,
  type Envelope,
  type EnvelopeType,
  type WrappedContentKey,
} from "@map-diary/crypto";
import { readBody, requireDevice, type AuthedEnv } from "./auth";
import { bytes, fail, isB64, isId, isMillis, isObject, isPositiveInt } from "./http";

export const MAX_PUSH = 100;
/** Ciphertext limit per envelope (base64url length), about 48 KiB of payload. */
const MAX_CIPHERTEXT_B64 = 64 * 1024;
const MAX_BOARDS = 10;
const DEFAULT_PULL = 200;
const MAX_PULL = 500;

type Rejection = { id: string | null; reason: string };

/** Shape checks only; the signature and board rights are checked separately. */
function parseEnvelope(value: unknown): Envelope | null {
  if (!isObject(value)) return null;
  const { v, id, type, authorId, deviceId, placeId, createdAt, updatedAt, boards, nonce, ciphertext, signature } =
    value;
  if (v !== ENVELOPE_VERSION || !isId(id) || !ENVELOPE_TYPES.includes(type as EnvelopeType)) return null;
  if (!isId(authorId) || !isId(deviceId) || !(placeId === null || isId(placeId))) return null;
  if (!isMillis(createdAt) || !isMillis(updatedAt) || updatedAt < createdAt) return null;
  if (!isB64(nonce, 32) || !isB64(ciphertext, MAX_CIPHERTEXT_B64) || !isB64(signature, 86)) return null;
  if (!Array.isArray(boards) || boards.length === 0 || boards.length > MAX_BOARDS) return null;
  const wrapped: WrappedContentKey[] = [];
  for (const b of boards) {
    if (!isObject(b)) return null;
    const { boardId, keyVersion, nonce: wn, wrappedKey } = b;
    if (!isId(boardId) || !isPositiveInt(keyVersion) || !isB64(wn, 32) || !isB64(wrappedKey, 128)) return null;
    wrapped.push({ boardId, keyVersion, nonce: wn, wrappedKey });
  }
  if (new Set(wrapped.map((b) => b.boardId)).size !== wrapped.length) return null;
  return {
    v,
    id,
    type: type as EnvelopeType,
    authorId,
    deviceId,
    placeId,
    createdAt,
    updatedAt,
    boards: wrapped,
    nonce,
    ciphertext,
    signature,
  };
}

/** The next change number, computed inside the statement that uses it. */
const NEXT_SEQ = "(SELECT COALESCE(MAX(seq), 0) + 1 FROM envelopes)";

export const envelopes = new Hono<AuthedEnv>();

/**
 * Pushes new envelopes or new versions of the device's account's own envelopes.
 * Last write wins per envelope on updatedAt; an older or equal version is ignored.
 */
envelopes.post("/envelopes", readBody, requireDevice, async (c) => {
  const body = c.var.body;
  const list = isObject(body) ? body.envelopes : undefined;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_PUSH) return fail(c, 400, "bad_request");
  const device = c.var.device;
  const db = c.env.DB;

  const signer = await db
    .prepare("SELECT sign_public_key FROM devices WHERE id = ?")
    .bind(device.id)
    .first<{ sign_public_key: unknown }>();
  if (!signer) return fail(c, 401, "unauthenticated");
  const signPublicKey = bytes(signer.sign_public_key);

  const rejected: Rejection[] = [];
  const candidates: Envelope[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const e = parseEnvelope(raw);
    if (!e) {
      rejected.push({ id: isObject(raw) && isId(raw.id) ? raw.id : null, reason: "invalid" });
    } else if (seen.has(e.id)) {
      rejected.push({ id: e.id, reason: "duplicate" });
    } else if (e.authorId !== device.accountId || e.deviceId !== device.id) {
      rejected.push({ id: e.id, reason: "not_author" });
    } else if (!verifyEnvelope(e, signPublicKey)) {
      rejected.push({ id: e.id, reason: "bad_signature" });
    } else {
      seen.add(e.id);
      candidates.push(e);
    }
  }

  // Board rights: a member of every board, at that board's current key version.
  const boardIds = [...new Set(candidates.flatMap((e) => e.boards.map((b) => b.boardId)))];
  const allowed = new Map<string, number>();
  if (boardIds.length > 0) {
    const { results } = await db
      .prepare(
        `SELECT b.id, b.key_version FROM boards b
           JOIN board_members m ON m.board_id = b.id AND m.account_id = ?
          WHERE b.id IN (SELECT value FROM json_each(?))`,
      )
      .bind(device.accountId, JSON.stringify(boardIds))
      .all<{ id: string; key_version: number }>();
    for (const r of results) allowed.set(r.id, r.key_version);
  }

  type Existing = { id: string; author_id: string; type: string; place_id: string | null; created_at: number; updated_at: number; deleted_at: number | null };
  const existing = new Map<string, Existing>();
  if (candidates.length > 0) {
    const { results } = await db
      .prepare(
        `SELECT id, author_id, type, place_id, created_at, updated_at, deleted_at FROM envelopes
          WHERE id IN (SELECT value FROM json_each(?))`,
      )
      .bind(JSON.stringify(candidates.map((e) => e.id)))
      .all<Existing>();
    for (const r of results) existing.set(r.id, r);
  }

  const accepted: Envelope[] = [];
  const unchanged: string[] = [];
  for (const e of candidates) {
    const prior = existing.get(e.id);
    if (e.boards.some((b) => (allowed.get(b.boardId) ?? 0) > b.keyVersion)) {
      // Sealed before its device collected a rotated key; the device re-seals it and retries.
      rejected.push({ id: e.id, reason: "stale_key" });
    } else if (e.boards.some((b) => allowed.get(b.boardId) !== b.keyVersion)) {
      rejected.push({ id: e.id, reason: "board_not_allowed" });
    } else if (!prior) {
      accepted.push(e);
    } else if (prior.author_id !== e.authorId) {
      rejected.push({ id: e.id, reason: "not_author" });
    } else if (prior.deleted_at !== null) {
      rejected.push({ id: e.id, reason: "deleted" });
    } else if (prior.type !== e.type || prior.place_id !== e.placeId || prior.created_at !== e.createdAt) {
      rejected.push({ id: e.id, reason: "immutable_field" });
    } else if (e.updatedAt <= prior.updated_at) {
      unchanged.push(e.id);
    } else {
      accepted.push(e);
    }
  }

  const now = Date.now();
  const statements = accepted.flatMap((e) => [
    db
      .prepare(
        `INSERT INTO envelopes (id, v, type, author_id, device_id, place_id, created_at, updated_at,
           nonce, ciphertext, signature, server_updated_at, seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${NEXT_SEQ})
         ON CONFLICT (id) DO UPDATE SET
           device_id = excluded.device_id, updated_at = excluded.updated_at, nonce = excluded.nonce,
           ciphertext = excluded.ciphertext, signature = excluded.signature,
           server_updated_at = excluded.server_updated_at, seq = excluded.seq
         WHERE envelopes.author_id = excluded.author_id AND envelopes.deleted_at IS NULL
           AND excluded.updated_at > envelopes.updated_at`,
      )
      .bind(
        e.id,
        e.v,
        e.type,
        e.authorId,
        e.deviceId,
        e.placeId,
        e.createdAt,
        e.updatedAt,
        fromBase64(e.nonce),
        fromBase64(e.ciphertext),
        fromBase64(e.signature),
        now,
      ),
    db.prepare("DELETE FROM envelope_boards WHERE envelope_id = ?").bind(e.id),
    ...e.boards.map((b) =>
      db
        .prepare(
          `INSERT INTO envelope_boards (envelope_id, board_id, key_version, nonce, wrapped_key, seq)
           SELECT ?, ?, ?, ?, ?, seq FROM envelopes WHERE id = ?`,
        )
        .bind(e.id, b.boardId, b.keyVersion, fromBase64(b.nonce), fromBase64(b.wrappedKey), e.id),
    ),
  ]);
  if (statements.length > 0) await db.batch(statements);

  return c.json({ accepted: accepted.map((e) => e.id), unchanged, rejected });
});

/**
 * Deletes the account's own envelopes. The row stays as a tombstone with its ciphertext
 * cleared, so every device drops its cached copy on the next pull. Nobody can delete
 * another person's envelope.
 */
envelopes.post("/envelopes/delete", readBody, requireDevice, async (c) => {
  const body = c.var.body;
  const ids = isObject(body) ? body.ids : undefined;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_PUSH || !ids.every(isId)) {
    return fail(c, 400, "bad_request");
  }
  const db = c.env.DB;
  const now = Date.now();
  const unique = [...new Set(ids)];
  const results = await db.batch(
    unique.flatMap((id) => [
      db
        .prepare(
          `UPDATE envelopes SET nonce = NULL, ciphertext = NULL, deleted_at = ?, server_updated_at = ?,
             seq = ${NEXT_SEQ}
           WHERE id = ? AND author_id = ? AND deleted_at IS NULL`,
        )
        .bind(now, now, id, c.var.device.accountId),
      db
        .prepare(
          `UPDATE envelope_boards SET seq = (SELECT seq FROM envelopes WHERE id = ?)
           WHERE envelope_id = ?`,
        )
        .bind(id, id),
    ]),
  );
  const deleted = unique.filter((_, i) => (results[i * 2]?.meta.changes ?? 0) > 0);
  return c.json({ deleted });
});

/**
 * Every change since `since` on any board the account is a member of, in seq order.
 * Pass the returned cursor back as `since` until `more` is false.
 */
envelopes.get("/sync", readBody, requireDevice, async (c) => {
  const sinceParam = c.req.query("since") ?? "0";
  const limitParam = c.req.query("limit") ?? String(DEFAULT_PULL);
  if (!/^\d{1,15}$/.test(sinceParam) || !/^\d{1,4}$/.test(limitParam)) return fail(c, 400, "bad_request");
  const since = Number(sinceParam);
  const limit = Math.min(Math.max(Number(limitParam), 1), MAX_PULL);
  const db = c.env.DB;

  type Row = {
    id: string;
    v: number;
    type: string;
    author_id: string;
    device_id: string;
    place_id: string | null;
    created_at: number;
    updated_at: number;
    nonce: unknown;
    ciphertext: unknown;
    signature: unknown;
    deleted_at: number | null;
    seq: number;
  };
  const { results: rows } = await db
    .prepare(
      `SELECT e.id, e.v, e.type, e.author_id, e.device_id, e.place_id, e.created_at, e.updated_at,
              e.nonce, e.ciphertext, e.signature, e.deleted_at, e.seq
         FROM envelopes e
        WHERE e.seq > ? AND EXISTS (
          SELECT 1 FROM envelope_boards eb
            JOIN board_members m ON m.board_id = eb.board_id AND m.account_id = ?
           WHERE eb.envelope_id = e.id)
        ORDER BY e.seq LIMIT ?`,
    )
    .bind(since, c.var.device.accountId, limit + 1)
    .all<Row>();

  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  const live = page.filter((r) => r.deleted_at === null);
  const liveIds = JSON.stringify(live.map((r) => r.id));
  const signerIds = JSON.stringify([...new Set(live.map((r) => r.device_id))]);

  type BoardRow = { envelope_id: string; board_id: string; key_version: number; nonce: unknown; wrapped_key: unknown };
  type DeviceRow = { id: string; account_id: string; sign_public_key: unknown; revoked_at: number | null };
  const [boardRows, deviceRows] =
    live.length === 0
      ? [[], []]
      : await Promise.all([
          db
            .prepare(
              `SELECT envelope_id, board_id, key_version, nonce, wrapped_key FROM envelope_boards
                WHERE envelope_id IN (SELECT value FROM json_each(?))`,
            )
            .bind(liveIds)
            .all<BoardRow>()
            .then((r) => r.results),
          db
            .prepare(
              `SELECT id, account_id, sign_public_key, revoked_at FROM devices
                WHERE id IN (SELECT value FROM json_each(?))`,
            )
            .bind(signerIds)
            .all<DeviceRow>()
            .then((r) => r.results),
        ]);

  const boardsByEnvelope = new Map<string, WrappedContentKey[]>();
  for (const b of boardRows) {
    const list = boardsByEnvelope.get(b.envelope_id) ?? [];
    list.push({
      boardId: b.board_id,
      keyVersion: b.key_version,
      nonce: toBase64(bytes(b.nonce)),
      wrappedKey: toBase64(bytes(b.wrapped_key)),
    });
    boardsByEnvelope.set(b.envelope_id, list);
  }

  const out: Envelope[] = live.map((r) => ({
    v: ENVELOPE_VERSION,
    id: r.id,
    type: r.type as EnvelopeType,
    authorId: r.author_id,
    deviceId: r.device_id,
    placeId: r.place_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    boards: (boardsByEnvelope.get(r.id) ?? []).sort((a, b) => (a.boardId < b.boardId ? -1 : a.boardId > b.boardId ? 1 : 0)),
    nonce: toBase64(bytes(r.nonce)),
    ciphertext: toBase64(bytes(r.ciphertext)),
    signature: toBase64(bytes(r.signature)),
  }));

  // Lets the device notice that another of its account's devices moved the account to new keys.
  const account = await db
    .prepare("SELECT box_key_version FROM accounts WHERE id = ?")
    .bind(c.var.device.accountId)
    .first<{ box_key_version: number }>();

  return c.json({
    envelopes: out,
    deleted: page.filter((r) => r.deleted_at !== null).map((r) => r.id),
    // Signer keys so the device can verify each envelope without another round trip.
    devices: Object.fromEntries(
      deviceRows.map((d) => [
        d.id,
        { accountId: d.account_id, signPublicKey: toBase64(bytes(d.sign_public_key)), revokedAt: d.revoked_at },
      ]),
    ),
    cursor: page.at(-1)?.seq ?? since,
    more,
    boxKeyVersion: account?.box_key_version ?? 1,
  });
});
