import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { expireResolverJobs } from "../src/scheduled";

const fetchApi = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://map.snehilsinha.com${path}`, init));

describe("routes", () => {
  it("reports health with the applied migration count", async () => {
    const res = await fetchApi("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, migrations: 8 });
  });

  it("returns JSON 404 for unknown routes and paths outside /api", async () => {
    for (const path of ["/api/nope", "/"]) {
      const res = await fetchApi(path);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
  });

  it("allows the local web app origin only", async () => {
    const ok = await fetchApi("/api/health", { headers: { Origin: "http://localhost:3000" } });
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
    const other = await fetchApi("/api/health", { headers: { Origin: "https://evil.example" } });
    expect(other.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("schema", () => {
  const now = 1_760_000_000_000;

  beforeAll(async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO accounts (id, created_at) VALUES ('a1', ?)").bind(now),
      env.DB.prepare(
        "INSERT INTO devices (id, account_id, kind, sign_public_key, box_public_key, created_at) VALUES ('d1', 'a1', 'web', x'01', x'02', ?)",
      ).bind(now),
      env.DB.prepare(
        "INSERT INTO boards (id, kind, owner_account_id, created_at) VALUES ('b1', 'personal', 'a1', ?)",
      ).bind(now),
    ]);
  });

  it("stores an envelope wrapped to a board and keeps a tombstone on delete", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO envelopes (id, v, type, author_id, device_id, place_id, created_at, updated_at,
           nonce, ciphertext, signature, server_updated_at, seq)
         VALUES ('e1', 1, 'status', 'a1', 'd1', 'p1', ?, ?, x'aa', x'bb', x'cc', ?, 1)`,
      ).bind(now, now, now),
      env.DB.prepare(
        "INSERT INTO envelope_boards (envelope_id, board_id, key_version, nonce, wrapped_key, seq) VALUES ('e1', 'b1', 1, x'dd', x'ee', 1)",
      ),
    ]);
    await env.DB.prepare(
      "UPDATE envelopes SET ciphertext = NULL, nonce = NULL, deleted_at = ?, seq = 2 WHERE id = 'e1'",
    )
      .bind(now)
      .run();
    const row = await env.DB.prepare("SELECT deleted_at, ciphertext FROM envelopes WHERE id = 'e1'").first();
    expect(row).toEqual({ deleted_at: now, ciphertext: null });
  });

  it("rejects a live envelope without ciphertext and a second master board", async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO envelopes (id, v, type, author_id, device_id, created_at, updated_at,
           signature, server_updated_at, seq)
         VALUES ('e2', 1, 'comment', 'a1', 'd1', ?, ?, x'cc', ?, 3)`,
      )
        .bind(now, now, now)
        .run(),
    ).rejects.toThrow(/CHECK constraint/);

    await env.DB.prepare("INSERT INTO boards (id, kind, created_at) VALUES ('m1', 'master', ?)").bind(now).run();
    await expect(
      env.DB.prepare("INSERT INTO boards (id, kind, created_at) VALUES ('m2', 'master', ?)").bind(now).run(),
    ).rejects.toThrow(/UNIQUE constraint/);
  });

  it("expires only resolver jobs past their expiry", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO resolver_jobs (id, query, reply_public_key, created_at, updated_at, expires_at) VALUES ('j1', 'Cafe Madras', x'01', ?, ?, ?)",
      ).bind(now, now, now - 1),
      env.DB.prepare(
        "INSERT INTO resolver_jobs (id, query, reply_public_key, created_at, updated_at, expires_at) VALUES ('j2', 'Bastian', x'01', ?, ?, ?)",
      ).bind(now, now, now + 1),
    ]);
    expect(await expireResolverJobs(env.DB, now)).toBe(1);
    const left = await env.DB.prepare("SELECT id FROM resolver_jobs").all();
    expect(left.results).toEqual([{ id: "j2" }]);
  });
});
