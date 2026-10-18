import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import {
  REPLY_PUBLIC_KEY_BYTES,
  fromBase64,
  parseResolution,
  ready,
  sealResolverResult,
  toBase64,
} from "@map-diary/crypto";
import { readBody, type SignedEnv } from "./auth";
import { expandShortLink, isShortMapsLink } from "./expand";
import { bytes, fail, isB64, isId, isObject } from "./http";

/**
 * The anonymous resolver queue. A device posts a link or name with a one-time public
 * key; no account or device is attached. The resolver (Claude's scheduled task, or any
 * script holding RESOLVER_TOKEN) lists pending jobs and answers them; the Worker checks
 * each answer, seals it to the job's key and clears the query. The device fetches the
 * sealed result by job id and deletes the job. See docs/resolver.md.
 */

/** Jobs nobody picks up are dropped by the cron after this long. */
export const JOB_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** A job listed this many times without an answer is marked failed. */
export const MAX_ATTEMPTS = 5;
/** Queue-wide cap on unfinished jobs; the submit route is open, so keep it small. */
export const MAX_OPEN_JOBS = 500;
export const MAX_QUERY_LENGTH = 1000;
const DEFAULT_PENDING = 10;
const MAX_PENDING = 50;

type JobRow = { id: string; status: "pending" | "resolved" | "failed"; sealed_result: unknown; expires_at: number };

/** Device side: submit, poll and delete. Anonymous; the job id is the capability. */
export const resolverJobs = new Hono<SignedEnv>();

resolverJobs.post("/resolver/jobs", readBody, async (c) => {
  const body = c.var.body;
  if (!isObject(body)) return fail(c, 400, "bad_request");
  const { query, replyPublicKey } = body;
  if (typeof query !== "string" || !isB64(replyPublicKey, 64)) return fail(c, 400, "bad_request");
  const trimmed = query.trim();
  if (!trimmed || trimmed.length > MAX_QUERY_LENGTH) return fail(c, 400, "bad_request");
  let key: Uint8Array;
  try {
    key = fromBase64(replyPublicKey);
  } catch {
    return fail(c, 400, "bad_request");
  }
  if (key.length !== REPLY_PUBLIC_KEY_BYTES) return fail(c, 400, "bad_request");

  const db = c.env.DB;
  const open = await db
    .prepare("SELECT COUNT(*) AS n FROM resolver_jobs WHERE status = 'pending'")
    .first<{ n: number }>();
  if ((open?.n ?? 0) >= MAX_OPEN_JOBS) return fail(c, 503, "queue_full");

  const now = Date.now();
  const id = toBase64(crypto.getRandomValues(new Uint8Array(16)));
  const expiresAt = now + JOB_TTL_MS;
  await db
    .prepare(
      `INSERT INTO resolver_jobs (id, query, reply_public_key, status, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
    )
    .bind(id, trimmed, key, now, now, expiresAt)
    .run();
  return c.json({ id, status: "pending", expiresAt }, 201);
});

resolverJobs.get("/resolver/jobs/:id", async (c) => {
  const id = c.req.param("id");
  if (!isId(id)) return fail(c, 404, "not_found");
  const row = await c.env.DB.prepare(
    "SELECT id, status, sealed_result, expires_at FROM resolver_jobs WHERE id = ?",
  )
    .bind(id)
    .first<JobRow>();
  if (!row || row.expires_at <= Date.now()) return fail(c, 404, "not_found");
  await ready();
  return c.json({
    id: row.id,
    status: row.status,
    ...(row.status === "resolved" ? { sealedResult: toBase64(bytes(row.sealed_result)) } : {}),
    expiresAt: row.expires_at,
  });
});

/** The device has its result, or gave up on the job. */
resolverJobs.delete("/resolver/jobs/:id", async (c) => {
  const id = c.req.param("id");
  if (!isId(id)) return fail(c, 404, "not_found");
  const { meta } = await c.env.DB.prepare("DELETE FROM resolver_jobs WHERE id = ?").bind(id).run();
  if (meta.changes === 0) return fail(c, 404, "not_found");
  return c.body(null, 204);
});

/**
 * Expands a short Google Maps link (maps.app.goo.gl and friends) to the full URL, whose
 * coordinates the device then reads itself. A web page cannot follow that redirect
 * (no CORS), so the Worker does. Only Google hosts are ever fetched.
 */
resolverJobs.post("/resolver/expand", readBody, async (c) => {
  const body = c.var.body;
  const url = isObject(body) ? body.url : undefined;
  if (typeof url !== "string" || url.length > 2000 || !isShortMapsLink(url)) return fail(c, 400, "bad_request");
  const expanded = await expandShortLink(url, (r) => fetch(r));
  if (!expanded) return fail(c, 422, "not_expanded");
  return c.json({ url: expanded });
});

type ResolverEnv = SignedEnv;

/** Resolver side: a bearer token set with `wrangler secret put RESOLVER_TOKEN`. */
export const requireResolver = createMiddleware<ResolverEnv>(async (c, next) => {
  const expected = c.env.RESOLVER_TOKEN;
  if (!expected) return fail(c, 503, "resolver_not_configured");
  const header = c.req.header("Authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match || !tokensMatch(match[1]!, expected)) return fail(c, 401, "unauthenticated");
  await next();
});

function tokensMatch(given: string, expected: string): boolean {
  const enc = new TextEncoder();
  const a = enc.encode(given);
  const b = enc.encode(expected);
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

export interface PendingJob {
  id: string;
  query: string;
  /** The full URL behind a short Google Maps link, when the query is one. */
  expandedUrl?: string;
  attempts: number;
  createdAt: number;
}

/**
 * Lists the oldest pending jobs and counts the attempt. Jobs that have been handed out
 * MAX_ATTEMPTS times without an answer are marked failed first, so one unresolvable job
 * cannot block the queue. Shared by the REST route and the MCP endpoint.
 */
export async function takePendingJobs(
  db: D1Database,
  limit: number,
  now: number,
  doFetch: (r: Request) => Promise<Response> = (r) => fetch(r),
): Promise<PendingJob[]> {
  await db
    .prepare(
      `UPDATE resolver_jobs SET status = 'failed', query = NULL, updated_at = ?
        WHERE status = 'pending' AND attempts >= ?`,
    )
    .bind(now, MAX_ATTEMPTS)
    .run();
  const { results } = await db
    .prepare(
      `UPDATE resolver_jobs SET attempts = attempts + 1, updated_at = ?
        WHERE id IN (SELECT id FROM resolver_jobs WHERE status = 'pending' AND expires_at > ?
                      ORDER BY created_at LIMIT ?)
        RETURNING id, query, attempts, created_at`,
    )
    .bind(now, now, limit)
    .all<{ id: string; query: string; attempts: number; created_at: number }>();
  results.sort((a, b) => a.created_at - b.created_at);
  return Promise.all(
    results.map(async (r) => {
      const job: PendingJob = { id: r.id, query: r.query, attempts: r.attempts, createdAt: r.created_at };
      if (isShortMapsLink(r.query)) {
        const expanded = await expandShortLink(r.query, doFetch);
        if (expanded) job.expandedUrl = expanded;
      }
      return job;
    }),
  );
}

export type SubmitOutcome =
  | { ok: true; status: "resolved" | "failed" }
  | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * Records the resolver's answer to one job: `{ candidates: [...] }` (checked by
 * `parseResolution`, then sealed to the job's key) or `{ failed: true }`. Either way the
 * plaintext query is cleared. Shared by the REST route and the MCP endpoint.
 */
export async function submitResolution(db: D1Database, id: string, answer: unknown, now: number): Promise<SubmitOutcome> {
  if (!isId(id)) return { ok: false, status: 404, error: "not_found" };
  const row = await db
    .prepare("SELECT status, reply_public_key, expires_at FROM resolver_jobs WHERE id = ?")
    .bind(id)
    .first<{ status: string; reply_public_key: unknown; expires_at: number }>();
  if (!row || row.expires_at <= now) return { ok: false, status: 404, error: "not_found" };
  if (row.status !== "pending") return { ok: false, status: 409, error: "not_pending" };

  if (isObject(answer) && answer.failed === true) {
    await db
      .prepare(
        "UPDATE resolver_jobs SET status = 'failed', query = NULL, updated_at = ? WHERE id = ? AND status = 'pending'",
      )
      .bind(now, id)
      .run();
    return { ok: true, status: "failed" };
  }

  const parsed = parseResolution(answer);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.problem };
  await ready();
  const sealed = sealResolverResult(parsed.result, bytes(row.reply_public_key));
  const { meta } = await db
    .prepare(
      `UPDATE resolver_jobs SET status = 'resolved', query = NULL, sealed_result = ?, updated_at = ?
        WHERE id = ? AND status = 'pending'`,
    )
    .bind(sealed, now, id)
    .run();
  if (meta.changes === 0) return { ok: false, status: 409, error: "not_pending" };
  return { ok: true, status: "resolved" };
}

export const resolverWork = new Hono<ResolverEnv>();

resolverWork.get("/resolver/pending", requireResolver, async (c) => {
  const raw = c.req.query("limit");
  const n = raw === undefined ? DEFAULT_PENDING : Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) return fail(c, 400, "bad_request");
  const jobs = await takePendingJobs(c.env.DB, Math.min(n, MAX_PENDING), Date.now());
  return c.json({ jobs });
});

resolverWork.post("/resolver/jobs/:id/resolution", requireResolver, readBody, async (c) => {
  const outcome = await submitResolution(c.env.DB, c.req.param("id"), c.var.body, Date.now());
  if (!outcome.ok) return fail(c, outcome.status, outcome.error);
  return c.json({ status: outcome.status });
});
