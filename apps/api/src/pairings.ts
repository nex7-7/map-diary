import { Hono } from "hono";
import { fromBase64, toBase64, verifyDeviceAuthorization, type DeviceKind } from "@map-diary/crypto";
import { readBody, requireDevice, type AuthedEnv, type SignedEnv } from "./auth";
import { DEVICE_KINDS, insertDevice, isPublicKey } from "./accounts";
import { bytes, fail, isB64, isId, isObject } from "./http";

/** How long a pairing link works. */
export const PAIRING_TTL_MS = 10 * 60 * 1000;
/** Open pairings per account; more than this is a stuck or abusive client. */
const MAX_OPEN_PAIRINGS = 5;
/** crypto_auth tag (32 bytes) in base64url. */
const MAC_B64 = 43;
/** A sealed account transfer is a few hundred bytes. */
const MAX_TRANSFER_B64 = 1024;

interface PairingRow {
  id: string;
  account_id: string;
  created_by_device_id: string;
  device_id: string | null;
  kind: DeviceKind | null;
  sign_public_key: unknown;
  box_public_key: unknown;
  join_mac: unknown;
  sealed_transfer: unknown;
  expires_at: number;
  approved_at: number | null;
}

async function livePairing(db: D1Database, id: string, now: number): Promise<PairingRow | null> {
  return db
    .prepare("SELECT * FROM pairings WHERE id = ? AND expires_at > ?")
    .bind(id, now)
    .first<PairingRow>();
}

function state(row: PairingRow): "waiting" | "joined" | "approved" {
  if (row.approved_at !== null) return "approved";
  return row.device_id !== null ? "joined" : "waiting";
}

/** Routes the old, signed-in device calls. */
export const pairingsSigned = new Hono<AuthedEnv>();

/** Opens a pairing under an id derived from the link secret. */
pairingsSigned.post("/pairings", readBody, requireDevice, async (c) => {
  const body = c.var.body;
  const id = isObject(body) ? body.id : undefined;
  if (!isId(id)) return fail(c, 400, "bad_request");
  const { id: deviceId, accountId } = c.var.device;
  const now = Date.now();
  const db = c.env.DB;
  const open = await db
    .prepare("SELECT COUNT(*) AS n FROM pairings WHERE account_id = ? AND expires_at > ?")
    .bind(accountId, now)
    .first<{ n: number }>();
  if ((open?.n ?? 0) >= MAX_OPEN_PAIRINGS) return fail(c, 429, "too_many_pairings");
  try {
    await db
      .prepare(
        `INSERT INTO pairings (id, account_id, created_by_device_id, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(id, accountId, deviceId, now, now + PAIRING_TTL_MS)
      .run();
  } catch {
    return fail(c, 409, "conflict");
  }
  return c.json({ id, expiresAt: now + PAIRING_TTL_MS }, 201);
});

/** The old device polls for the new device's keys. */
pairingsSigned.get("/pairings/:id", readBody, requireDevice, async (c) => {
  const row = await livePairing(c.env.DB, c.req.param("id"), Date.now());
  if (!row || row.account_id !== c.var.device.accountId) return fail(c, 404, "not_found");
  if (row.device_id === null) return c.json({ state: state(row), expiresAt: row.expires_at });
  return c.json({
    state: state(row),
    expiresAt: row.expires_at,
    device: {
      id: row.device_id,
      kind: row.kind,
      signPublicKey: toBase64(bytes(row.sign_public_key)),
      boxPublicKey: toBase64(bytes(row.box_public_key)),
    },
    mac: toBase64(bytes(row.join_mac)),
  });
});

/**
 * The old device approves: it signs the new device's keys with its own device key (any
 * active device of the account may authorise another) and leaves the account keys sealed
 * to the new device.
 */
pairingsSigned.post("/pairings/:id/approve", readBody, requireDevice, async (c) => {
  const body = c.var.body;
  if (!isObject(body)) return fail(c, 400, "bad_request");
  const { authorization, sealedTransfer } = body;
  if (!isB64(authorization, 100) || !isB64(sealedTransfer, MAX_TRANSFER_B64)) return fail(c, 400, "bad_request");
  const { id: approverId, accountId } = c.var.device;
  const db = c.env.DB;
  const now = Date.now();
  const row = await livePairing(db, c.req.param("id"), now);
  if (!row || row.account_id !== accountId) return fail(c, 404, "not_found");
  if (state(row) !== "joined" || row.device_id === null || row.kind === null) return fail(c, 409, "not_joined");

  const approver = await db
    .prepare("SELECT sign_public_key FROM devices WHERE id = ?")
    .bind(approverId)
    .first<{ sign_public_key: unknown }>();
  const device = {
    id: row.device_id,
    kind: row.kind,
    signPublicKey: bytes(row.sign_public_key),
    boxPublicKey: bytes(row.box_public_key),
    authorization,
  };
  const authorised =
    approver !== null &&
    verifyDeviceAuthorization(
      { accountId, deviceId: device.id, kind: device.kind, signPublicKey: device.signPublicKey, boxPublicKey: device.boxPublicKey },
      authorization,
      bytes(approver.sign_public_key),
    );
  if (!authorised) return fail(c, 403, "forbidden");

  try {
    await db.batch([
      insertDevice(db, accountId, device, now),
      db
        .prepare("UPDATE pairings SET sealed_transfer = ?, approved_at = ? WHERE id = ?")
        .bind(fromBase64(sealedTransfer), now, row.id),
    ]);
  } catch {
    return fail(c, 409, "conflict");
  }
  return c.json({ deviceId: device.id });
});

/** Cancels a pairing from the old device. */
pairingsSigned.delete("/pairings/:id", readBody, requireDevice, async (c) => {
  await c.env.DB.prepare("DELETE FROM pairings WHERE id = ? AND account_id = ?")
    .bind(c.req.param("id"), c.var.device.accountId)
    .run();
  return c.body(null, 204);
});

/**
 * The new device collects the sealed account keys. By now it is registered, so it signs
 * the request with its own key; the pairing is deleted once collected.
 */
pairingsSigned.get("/pairings/:id/transfer", readBody, requireDevice, async (c) => {
  const db = c.env.DB;
  const row = await livePairing(db, c.req.param("id"), Date.now());
  if (!row || row.device_id !== c.var.device.id || row.sealed_transfer === null) return fail(c, 404, "not_found");
  await db.prepare("DELETE FROM pairings WHERE id = ?").bind(row.id).run();
  return c.json({ sealedTransfer: toBase64(bytes(row.sealed_transfer)) });
});

/** Routes the new device calls before it has an account to sign with. */
export const pairingsOpen = new Hono<SignedEnv>();

/** The new device offers its public keys, with a MAC only a holder of the link can make. */
pairingsOpen.post("/pairings/:id/join", readBody, async (c) => {
  const body = c.var.body;
  if (!isObject(body) || !isObject(body.device)) return fail(c, 400, "bad_request");
  const { id, kind, signPublicKey, boxPublicKey } = body.device;
  const { mac } = body;
  if (
    !isId(id) ||
    !DEVICE_KINDS.includes(kind as DeviceKind) ||
    !isPublicKey(signPublicKey) ||
    !isPublicKey(boxPublicKey) ||
    !isB64(mac, MAC_B64) ||
    mac.length !== MAC_B64
  ) {
    return fail(c, 400, "bad_request");
  }
  const now = Date.now();
  const result = await c.env.DB.prepare(
    `UPDATE pairings
        SET device_id = ?, kind = ?, sign_public_key = ?, box_public_key = ?, join_mac = ?, joined_at = ?
      WHERE id = ? AND expires_at > ? AND device_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM devices WHERE id = ?)`,
  )
    .bind(id, kind, fromBase64(signPublicKey), fromBase64(boxPublicKey), fromBase64(mac), now, c.req.param("id"), now, id)
    .run();
  // Unknown, expired and already-joined pairings look the same from outside.
  if (result.meta.changes !== 1) return fail(c, 404, "not_found");
  return c.json({ state: "joined" });
});

/** The new device polls until the old one approves. */
pairingsOpen.get("/pairings/:id/status", async (c) => {
  const row = await livePairing(c.env.DB, c.req.param("id"), Date.now());
  if (!row) return fail(c, 404, "not_found");
  return c.json({ state: state(row) });
});

/** Deletes pairings past their expiry. Returns how many were removed. */
export async function expirePairings(db: D1Database, now: number): Promise<number> {
  const result = await db.prepare("DELETE FROM pairings WHERE expires_at <= ?").bind(now).run();
  return result.meta.changes;
}
