import { createMiddleware } from "hono/factory";
import {
  AUTH_HEADERS,
  REQUEST_MAX_SKEW_MS,
  ready,
  verifyRequest,
} from "@map-diary/crypto";
import { bytes, fail } from "./http";

/** Largest request body the API accepts (a push of envelopes, a key backup). */
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** A registered, unrevoked device whose signature on this request checked out. */
export interface AuthedDevice {
  id: string;
  accountId: string;
  isAdmin: boolean;
}

export type SignedVars = {
  /** The raw request body, exactly as signed. */
  rawBody: Uint8Array;
  /** The parsed JSON body; undefined for an empty body. */
  body: unknown;
};

export type AuthedEnv = {
  Bindings: Env;
  Variables: SignedVars & { device: AuthedDevice };
};

export type SignedEnv = {
  Bindings: Env;
  Variables: SignedVars;
};

export interface SignatureHeaders {
  deviceId: string;
  timestamp: number;
  signature: string;
}

/** Reads the signature headers and checks the timestamp is within the allowed skew. */
export function readSignatureHeaders(req: Request, now: number): SignatureHeaders | null {
  const deviceId = req.headers.get(AUTH_HEADERS.device);
  const ts = req.headers.get(AUTH_HEADERS.timestamp);
  const signature = req.headers.get(AUTH_HEADERS.signature);
  if (!deviceId || !ts || !signature || !/^\d{1,16}$/.test(ts)) return null;
  const timestamp = Number(ts);
  if (Math.abs(now - timestamp) > REQUEST_MAX_SKEW_MS) return null;
  return { deviceId, timestamp, signature };
}

/** Checks a request signature against a known device public key. */
export function requestIsSignedBy(
  req: Request,
  headers: SignatureHeaders,
  rawBody: Uint8Array,
  signPublicKey: Uint8Array,
): boolean {
  const url = new URL(req.url);
  return verifyRequest(
    {
      method: req.method,
      path: url.pathname + url.search,
      deviceId: headers.deviceId,
      timestamp: headers.timestamp,
      body: rawBody,
    },
    headers.signature,
    signPublicKey,
  );
}

/** Reads and parses the body once, for routes that verify a signature themselves. */
export const readBody = createMiddleware<SignedEnv>(async (c, next) => {
  await ready();
  const declared = Number(c.req.header("Content-Length") ?? "0");
  if (declared > MAX_BODY_BYTES) return fail(c, 413, "too_large");
  const rawBody = new Uint8Array(await c.req.raw.arrayBuffer());
  if (rawBody.byteLength > MAX_BODY_BYTES) return fail(c, 413, "too_large");
  let body: unknown;
  if (rawBody.byteLength > 0) {
    try {
      body = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(rawBody));
    } catch {
      return fail(c, 400, "bad_json");
    }
  }
  c.set("rawBody", rawBody);
  c.set("body", body);
  await next();
});

/**
 * Requires a request signed by a registered, unrevoked device of an active account.
 * There are no sessions or passwords: every request carries its own signature.
 */
export const requireDevice = createMiddleware<AuthedEnv>(async (c, next) => {
  const now = Date.now();
  const headers = readSignatureHeaders(c.req.raw, now);
  if (!headers) return fail(c, 401, "unauthenticated");

  const row = await c.env.DB.prepare(
    `SELECT d.account_id, d.sign_public_key, d.last_seen_at, d.revoked_at, a.is_admin
       FROM devices d JOIN accounts a ON a.id = d.account_id
      WHERE d.id = ? AND a.removed_at IS NULL`,
  )
    .bind(headers.deviceId)
    .first<{
      account_id: string;
      sign_public_key: unknown;
      last_seen_at: number | null;
      revoked_at: number | null;
      is_admin: number;
    }>();
  if (!row) return fail(c, 401, "unauthenticated");

  if (!requestIsSignedBy(c.req.raw, headers, c.var.rawBody, bytes(row.sign_public_key))) {
    return fail(c, 401, "unauthenticated");
  }
  // Only the holder of the device key learns it was revoked, so it can forget its keys.
  if (row.revoked_at !== null) return fail(c, 401, "device_revoked");

  c.set("device", { id: headers.deviceId, accountId: row.account_id, isAdmin: row.is_admin === 1 });

  // Hourly is enough for the admin device list, and keeps D1 writes low.
  if (row.last_seen_at === null || now - row.last_seen_at > 60 * 60 * 1000) {
    c.executionCtx.waitUntil(
      c.env.DB.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").bind(now, headers.deviceId).run(),
    );
  }
  await next();
});
