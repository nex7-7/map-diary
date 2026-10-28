import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { fromBase64, generateReplyKeys, openResolverResult, ready, toBase64 } from "@map-diary/crypto";

await ready();

const TOKEN = "test-resolver-token";

const fetchApi = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://map.snehilsinha.com${path}`, init));

let nextId = 1;

const AUTH = { Authorization: `Bearer ${TOKEN}` };

/** One JSON-RPC call to the MCP endpoint, with the token as a Bearer header. */
async function rpc(method: string, params?: unknown, path = "/api/mcp", auth: Record<string, string> = AUTH) {
  const res = await fetchApi(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...auth },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, ...(params ? { params } : {}) }),
  });
  return res;
}

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean; structuredContent?: unknown };

async function callTool(name: string, args: unknown): Promise<ToolResult> {
  const res = await rpc("tools/call", { name, arguments: args });
  expect(res.status).toBe(200);
  const body = await res.json<{ result: ToolResult }>();
  return body.result;
}

async function submit(query: string) {
  const keys = generateReplyKeys();
  const res = await fetchApi("/api/resolver/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, replyPublicKey: toBase64(keys.publicKey) }),
  });
  const { id } = await res.json<{ id: string }>();
  return { id, keys };
}

const candidate = {
  name: "Kyani & Co.",
  category: "cafe-bar",
  location: { lat: 18.9439, lng: 72.8264 },
  cuisine: "Irani",
  signatureDish: { name: "Bun maska", priceInr: 60 },
  sourceLinks: ["https://www.zomato.com/mumbai/kyani-co-marine-lines"],
};

describe("MCP resolver endpoint", () => {
  it("initializes and lists the tools", async () => {
    const init = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    expect(init.status).toBe(200);
    const { result } = await init.json<{ result: { protocolVersion: string; serverInfo: { name: string } } }>();
    expect(result.protocolVersion).toBe("2025-06-18");
    expect(result.serverInfo.name).toBe("map-diary-resolver");

    const odd = await (await rpc("initialize", { protocolVersion: "1999-01-01" })).json<{ result: { protocolVersion: string } }>();
    expect(odd.result.protocolVersion).toBe("2025-11-25");

    const note = await fetchApi("/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(note.status).toBe(202);

    const list = await (await rpc("tools/list")).json<{ result: { tools: { name: string }[] } }>();
    expect(list.result.tools.map((t) => t.name)).toEqual(["get_pending_jobs", "submit_resolution", "get_failed_jobs", "requeue_job"]);

    const unknown = await (await rpc("resources/list")).json<{ error: { code: number } }>();
    expect(unknown.error.code).toBe(-32601);
  });

  it("works a job from listing to sealed result", async () => {
    const { id, keys } = await submit("Kyani Marine Lines");

    const listed = await callTool("get_pending_jobs", { limit: 50 });
    expect(listed.isError).toBeUndefined();
    const { jobs } = listed.structuredContent as { jobs: { id: string; query: string }[] };
    expect(jobs.find((j) => j.id === id)?.query).toBe("Kyani Marine Lines");

    const bad = await callTool("submit_resolution", {
      jobId: id,
      candidates: [{ ...candidate, location: { lat: 28.6, lng: 77.2 } }],
    });
    expect(bad.isError).toBe(true);
    expect(bad.content[0]!.text).toMatch(/inside Mumbai/);

    const ok = await callTool("submit_resolution", { jobId: id, candidates: [candidate] });
    expect(ok.structuredContent).toEqual({ jobId: id, status: "resolved" });

    const again = await callTool("submit_resolution", { jobId: id, failed: true });
    expect(again.isError).toBe(true);
    expect(again.content[0]!.text).toMatch(/already been answered/);

    const row = await env.DB.prepare("SELECT query FROM resolver_jobs WHERE id = ?").bind(id).first();
    expect(row).toEqual({ query: null });
    const job = await (await fetchApi(`/api/resolver/jobs/${id}`)).json<{ sealedResult: string }>();
    expect(openResolverResult(fromBase64(job.sealedResult), keys).candidates[0]).toMatchObject({
      name: "Kyani & Co.",
      signatureDish: { name: "Bun maska", priceInr: 60 },
    });
  });

  it("passes a chain's other outlets through to the device", async () => {
    const { id, keys } = await submit("https://www.zomato.com/mumbai/kyani-co-marine-lines");
    const outlet = { ...candidate, location: { lat: 19.06, lng: 72.83 }, address: "Bandra" };
    const ok = await callTool("submit_resolution", { jobId: id, candidates: [candidate], chain: { name: "Kyani & Co.", outlets: [outlet] } });
    expect(ok.structuredContent).toEqual({ jobId: id, status: "resolved" });
    const job = await (await fetchApi(`/api/resolver/jobs/${id}`)).json<{ sealedResult: string }>();
    expect(openResolverResult(fromBase64(job.sealedResult), keys).chain).toMatchObject({ name: "Kyani & Co.", outlets: [{ address: "Bandra" }] });
  });

  it("marks a job failed", async () => {
    const { id } = await submit("A place that does not exist");
    const out = await callTool("submit_resolution", { jobId: id, failed: true });
    expect(out.structuredContent).toEqual({ jobId: id, status: "failed" });
    expect((await callTool("submit_resolution", { jobId: "nope", failed: true })).content[0]!.text).toMatch(/No such job/);
  });

  it("lists failed jobs and puts one back with a better link", async () => {
    const { id, keys } = await submit("Samai");
    await callTool("submit_resolution", { jobId: id, failed: true });
    const failed = await callTool("get_failed_jobs", { limit: 50 });
    expect((failed.structuredContent as { jobs: { id: string; query: string }[] }).jobs).toContainEqual(expect.objectContaining({ id, query: "Samai" }));

    const link = "https://www.zomato.com/mumbai/samai-marathmola-jewanachi-mejwani-lower-parel";
    expect((await callTool("requeue_job", { jobId: id, query: link })).structuredContent).toEqual({ jobId: id, status: "pending" });
    const listed = await callTool("get_pending_jobs", { limit: 50 });
    expect((listed.structuredContent as { jobs: { id: string; query: string }[] }).jobs).toContainEqual(expect.objectContaining({ id, query: link }));
    const again = await callTool("requeue_job", { jobId: id });
    expect(again.isError).toBe(true);
    expect(again.content[0]!.text).toMatch(/No such failed job/);

    await callTool("submit_resolution", { jobId: id, candidates: [candidate] });
    const job = await (await fetchApi(`/api/resolver/jobs/${id}`)).json<{ sealedResult: string }>();
    expect(openResolverResult(fromBase64(job.sealedResult), keys).candidates).toHaveLength(1);
  });

  it("needs the token as a Bearer header, never in the URL", async () => {
    expect((await rpc("tools/list", undefined, "/api/mcp", { Authorization: "Bearer wrong-token" })).status).toBe(401);
    expect((await rpc("tools/list", undefined, "/api/mcp", {})).status).toBe(401);
    expect((await rpc("tools/list", undefined, `/api/mcp/${TOKEN}`, {})).status).not.toBe(200);
    const withHeader = await fetchApi("/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(await withHeader.json()).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
    expect((await fetchApi("/api/mcp")).status).toBe(405);
  });

  it("answers a batch", async () => {
    const res = await fetchApi("/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AUTH },
      body: JSON.stringify([
        { jsonrpc: "2.0", id: "a", method: "ping" },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: "b", method: "tools/call", params: { name: "nope", arguments: {} } },
      ]),
    });
    const replies = await res.json<{ id: string; error?: { code: number } }[]>();
    expect(replies.map((r) => r.id)).toEqual(["a", "b"]);
    expect(replies[1]!.error?.code).toBe(-32602);
  });
});
