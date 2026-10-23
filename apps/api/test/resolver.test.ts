import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { fromBase64, generateReplyKeys, openResolverResult, ready, toBase64 } from "@map-diary/crypto";
import { expandShortLink, isShortMapsLink } from "../src/expand";
import { MAX_ATTEMPTS, takePendingJobs } from "../src/resolver";
import { expireResolverJobs } from "../src/scheduled";

await ready();

const TOKEN = "test-resolver-token";

const fetchApi = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://map.snehilsinha.com${path}`, init));

const json = (method: string, body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});

const asResolver = { Authorization: `Bearer ${TOKEN}` };

async function submit(query: string) {
  const keys = generateReplyKeys();
  const res = await fetchApi("/api/resolver/jobs", json("POST", { query, replyPublicKey: toBase64(keys.publicKey) }));
  expect(res.status).toBe(201);
  const { id } = await res.json<{ id: string }>();
  return { id, keys };
}

async function pending(limit = 50) {
  const res = await fetchApi(`/api/resolver/pending?limit=${limit}`, { headers: asResolver });
  expect(res.status).toBe(200);
  return (await res.json<{ jobs: { id: string; query: string; attempts: number }[] }>()).jobs;
}

const candidate = {
  name: "Britannia & Co.",
  category: "restaurant",
  location: { lat: 18.9345, lng: 72.8399 },
  cuisine: "Parsi",
  signatureDish: { name: "Berry pulao", priceInr: 750 },
  sourceLinks: ["https://www.zomato.com/mumbai/britannia-co-fort"],
};

describe("resolver queue", () => {
  it("runs a job from submit to sealed result to delete", async () => {
    const { id, keys } = await submit("  https://www.zomato.com/mumbai/britannia-co-fort ");

    const before = await fetchApi(`/api/resolver/jobs/${id}`);
    expect(await before.json()).toMatchObject({ id, status: "pending" });

    const jobs = await pending();
    expect(jobs.find((j) => j.id === id)).toMatchObject({
      query: "https://www.zomato.com/mumbai/britannia-co-fort",
      attempts: 1,
    });

    const answer = await fetchApi(`/api/resolver/jobs/${id}/resolution`, json("POST", { candidates: [candidate] }, asResolver));
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ status: "resolved" });

    // The server keeps only the sealed result, never the query.
    const row = await env.DB.prepare("SELECT query, status FROM resolver_jobs WHERE id = ?").bind(id).first();
    expect(row).toEqual({ query: null, status: "resolved" });

    const after = await (await fetchApi(`/api/resolver/jobs/${id}`)).json<{ status: string; sealedResult: string }>();
    expect(after.status).toBe("resolved");
    const result = openResolverResult(fromBase64(after.sealedResult), keys);
    expect(result.candidates[0]).toMatchObject({ name: "Britannia & Co.", signatureDish: { priceInr: 750 } });

    expect((await fetchApi(`/api/resolver/jobs/${id}`, { method: "DELETE" })).status).toBe(204);
    expect((await fetchApi(`/api/resolver/jobs/${id}`)).status).toBe(404);
    expect((await fetchApi(`/api/resolver/jobs/${id}`, { method: "DELETE" })).status).toBe(404);
  });

  it("refuses bad submissions", async () => {
    const key = toBase64(generateReplyKeys().publicKey);
    for (const body of [
      { query: "", replyPublicKey: key },
      { query: "x".repeat(1001), replyPublicKey: key },
      { query: "Bastian", replyPublicKey: toBase64(new Uint8Array(16)) },
      { query: "Bastian", replyPublicKey: "not base64!" },
      { query: 7, replyPublicKey: key },
    ]) {
      expect((await fetchApi("/api/resolver/jobs", json("POST", body))).status).toBe(400);
    }
  });

  it("checks answers and lets each job be answered once", async () => {
    const { id } = await submit("Bastian Worli");
    const outside = { ...candidate, location: { lat: 28.6, lng: 77.2 } };
    const bad = await fetchApi(`/api/resolver/jobs/${id}/resolution`, json("POST", { candidates: [outside] }, asResolver));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "outside_mumbai" });

    const failed = await fetchApi(`/api/resolver/jobs/${id}/resolution`, json("POST", { failed: true }, asResolver));
    expect(await failed.json()).toEqual({ status: "failed" });
    expect(await (await fetchApi(`/api/resolver/jobs/${id}`)).json()).toMatchObject({ status: "failed" });

    const again = await fetchApi(`/api/resolver/jobs/${id}/resolution`, json("POST", { candidates: [candidate] }, asResolver));
    expect(again.status).toBe(409);
    const missing = await fetchApi(`/api/resolver/jobs/nope/resolution`, json("POST", { failed: true }, asResolver));
    expect(missing.status).toBe(404);
  });

  it("needs the resolver token for the resolver side", async () => {
    expect((await fetchApi("/api/resolver/pending")).status).toBe(401);
    const wrong = await fetchApi("/api/resolver/pending", { headers: { Authorization: "Bearer nope" } });
    expect(wrong.status).toBe(401);
    const { id } = await submit("Kyani");
    const res = await fetchApi(`/api/resolver/jobs/${id}/resolution`, json("POST", { failed: true }));
    expect(res.status).toBe(401);
    expect((await fetchApi("/api/resolver/pending?limit=0", { headers: asResolver })).status).toBe(400);
  });

  it("fails a job after too many attempts and expires old ones", async () => {
    const { id } = await submit("Somewhere unfindable");
    const now = Date.now();
    for (let i = 0; i < MAX_ATTEMPTS; i++) await takePendingJobs(env.DB, 50, now);
    const jobs = await takePendingJobs(env.DB, 50, now);
    expect(jobs.find((j) => j.id === id)).toBeUndefined();
    const row = await env.DB.prepare("SELECT status, query FROM resolver_jobs WHERE id = ?").bind(id).first();
    // The query stays, so the admin can put the job back in the queue.
    expect(row).toEqual({ status: "failed", query: "Somewhere unfindable" });

    await expireResolverJobs(env.DB, now + 15 * 24 * 60 * 60 * 1000);
    expect((await fetchApi(`/api/resolver/jobs/${id}`)).status).toBe(404);
  });
});

describe("short link expansion", () => {
  const short = "https://maps.app.goo.gl/AbCdEf123";
  const full = "https://www.google.com/maps/place/Kyani+%26+Co./@18.9447,72.8270,17z/data=!3d18.9447!4d72.8270";

  function redirects(chain: Record<string, string>) {
    const seen: string[] = [];
    const doFetch = async (r: Request) => {
      seen.push(r.url);
      const to = chain[r.url];
      return to ? new Response(null, { status: 302, headers: { Location: to } }) : new Response("page", { status: 200 });
    };
    return { seen, doFetch };
  }

  it("recognises short links", () => {
    expect(isShortMapsLink(short)).toBe(true);
    expect(isShortMapsLink("https://goo.gl/maps/xyz")).toBe(true);
    expect(isShortMapsLink("https://goo.gl/other")).toBe(false);
    expect(isShortMapsLink("https://www.zomato.com/mumbai/x")).toBe(false);
  });

  it("follows redirects to the full Maps URL, through the consent wall", async () => {
    const consent = `https://consent.google.com/m?continue=${encodeURIComponent(full)}`;
    const { seen, doFetch } = redirects({ [short]: consent });
    expect(await expandShortLink(short, doFetch)).toBe(full);
    expect(seen).toEqual([short]);
  });

  it("never fetches a non-Google host", async () => {
    const { seen, doFetch } = redirects({ [short]: "https://evil.example/x" });
    expect(await expandShortLink(short, doFetch)).toBeNull();
    expect(seen).toEqual([short]);
  });

  it("gives up on a page that does not redirect", async () => {
    const { doFetch } = redirects({});
    expect(await expandShortLink(short, doFetch)).toBeNull();
  });

  it("rejects non-short links at the route", async () => {
    const res = await fetchApi("/api/resolver/expand", json("POST", { url: "https://evil.example/x" }));
    expect(res.status).toBe(400);
  });
});

describe("sync client", () => {
  it("submits, polls and deletes a job without signing anything", async () => {
    const { Api } = await import("@map-diary/sync");
    const seen: Request[] = [];
    const api = new Api({
      origin: "https://map.snehilsinha.com",
      fetch: (r) => {
        seen.push(r.clone());
        return exports.default.fetch(r);
      },
    });
    const keys = generateReplyKeys();
    const job = await api.submitResolverJob("Gajalee, Vile Parle", toBase64(keys.publicKey));
    expect(job.status).toBe("pending");
    await fetchApi(`/api/resolver/jobs/${job.id}/resolution`, json("POST", { candidates: [candidate] }, asResolver));
    const done = await api.getResolverJob(job.id);
    expect(openResolverResult(fromBase64(done.sealedResult!), keys).candidates).toHaveLength(1);
    await api.deleteResolverJob(job.id);
    expect(seen.every((r) => r.headers.get("X-Device-Id") === null)).toBe(true);
  });
});

describe("resolver rate limit", () => {
  it("lets one client submit only a few jobs a minute", async () => {
    await ready();
    const submit = () =>
      exports.default.fetch(
        new Request("https://map.snehilsinha.com/api/resolver/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.20" },
          body: JSON.stringify({ query: "Cafe Madras", replyPublicKey: toBase64(generateReplyKeys().publicKey) }),
        }),
      );
    const statuses: number[] = [];
    for (let i = 0; i < 32; i++) statuses.push((await submit()).status);
    expect(statuses.slice(0, 30).every((s) => s === 201)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});
