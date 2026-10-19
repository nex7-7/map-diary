import { Hono, type Context } from "hono";
import { MAX_CANDIDATES, MUMBAI_BOUNDS, RESOLVER_CATEGORIES, type ResolutionProblem } from "@map-diary/crypto";
import { readBody, type SignedEnv } from "./auth";
import type { JsonObject } from "./http";
import { answerRpc, toolText } from "./mcp-rpc";
import { requireResolver, submitResolution, takePendingJobs } from "./resolver";

/**
 * The resolver as an MCP server, so a Claude scheduled task can work the queue through
 * a custom connector. Two tools, `get_pending_jobs` and `submit_resolution`, run the
 * same code as the REST resolver routes. Streamable HTTP, stateless: every POST carries
 * one JSON-RPC message (or a batch) and gets a plain JSON reply; there are no sessions
 * and no server-sent streams (see mcp-rpc.ts). See docs/mcp-resolver.md.
 *
 * Auth is RESOLVER_TOKEN as a Bearer header on `/api/mcp`, never in the URL, so it stays
 * out of request logs.
 * The tools only ever see a pasted link or name, never anyone's opinions or keys.
 */

const SERVER_INFO = { name: "map-diary-resolver", version: "1.0.0" };
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const [WEST, SOUTH, EAST, NORTH] = MUMBAI_BOUNDS;

const INSTRUCTIONS = `Resolves places for a private Mumbai map diary. Call get_pending_jobs, look each query up \
(a Google Maps, Zomato, District or other link, or a plain place name), then call submit_resolution once per job \
with 1 to ${MAX_CANDIDATES} candidates, or failed: true when you cannot find the place. Several candidates are \
fine when a name is ambiguous; the person picks one later. Never invent facts: leave out a field you could not \
verify. Coordinates must be inside Mumbai (lat ${SOUTH} to ${NORTH}, lng ${WEST} to ${EAST}). The signature dish \
is the dish the place is best known for, at its current menu price for one serving in whole rupees; only for \
restaurant and cafe-bar.`;

const candidateSchema = {
  type: "object",
  properties: {
    name: { type: "string", maxLength: 200, description: "The place's name as it is commonly written." },
    category: { type: "string", enum: [...RESOLVER_CATEGORIES] },
    location: {
      type: "object",
      properties: {
        lat: { type: "number", minimum: SOUTH, maximum: NORTH },
        lng: { type: "number", minimum: WEST, maximum: EAST },
      },
      required: ["lat", "lng"],
      additionalProperties: false,
    },
    address: { type: "string", maxLength: 300 },
    cuisine: { type: "string", maxLength: 100, description: "Food and drink places only, e.g. Parsi, South Indian." },
    signatureDish: {
      type: "object",
      description:
        "Restaurant and cafe-bar only. The dish the place is best known for, at its current menu price for one serving.",
      properties: {
        name: { type: "string", maxLength: 120 },
        priceInr: { type: "integer", minimum: 1, maximum: 50000, description: "Whole rupees, no tiers or ranges." },
      },
      required: ["name", "priceInr"],
      additionalProperties: false,
    },
    sourceLinks: {
      type: "array",
      items: { type: "string", pattern: "^https://" },
      maxItems: 5,
      description: "https pages you used, e.g. the Google Maps, Zomato or official page.",
    },
  },
  required: ["name", "category", "location"],
  additionalProperties: false,
} as const;

const TOOLS = [
  {
    name: "get_pending_jobs",
    title: "Get pending resolver jobs",
    description:
      "Lists the oldest pending jobs, each with an id and a query (a link or a place name). expandedUrl is the full " +
      "Google Maps URL behind a short link, when the Worker could expand it. Each call counts an attempt; a job " +
      "listed 5 times without an answer is marked failed, so answer every job you are given.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "submit_resolution",
    title: "Submit a resolution",
    description:
      `Answers one job with 1 to ${MAX_CANDIDATES} candidate places, or with failed: true when the place cannot be ` +
      "found or is not in Mumbai. The answer is checked, encrypted to the person who asked, and the query is " +
      "deleted. Each job can be answered once. On a check error, fix the candidate and call again.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "The id from get_pending_jobs." },
        candidates: { type: "array", items: candidateSchema, minItems: 1, maxItems: MAX_CANDIDATES },
        failed: { type: "boolean", description: "true when no candidate could be found. Leave out candidates." },
      },
      required: ["jobId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
] as const;

/** What a check failure means, in words a model can act on. */
export const PROBLEMS: Record<ResolutionProblem, string> = {
  bad_shape: "The answer has the wrong shape. Send candidates as an array of place objects, or failed: true.",
  no_candidates: "candidates is empty. Send at least one, or failed: true.",
  too_many_candidates: `Send at most ${MAX_CANDIDATES} candidates.`,
  bad_name: "A candidate has no name, or a name over 200 characters.",
  bad_category: `category must be one of: ${RESOLVER_CATEGORIES.join(", ")}.`,
  outside_mumbai: `location must be inside Mumbai: lat ${SOUTH} to ${NORTH}, lng ${WEST} to ${EAST}.`,
  bad_price: "signatureDish.priceInr must be a whole number of rupees from 1 to 50000.",
  dish_not_food: "Only restaurant and cafe-bar candidates can have a signatureDish.",
  bad_link: "sourceLinks must be at most 5 https URLs.",
};

const JOB_ERRORS: Record<string, string> = {
  not_found: "No such job; it may have expired or been deleted by the person who asked.",
  not_pending: "This job has already been answered or has failed.",
};

async function callTool(db: D1Database, name: unknown, args: JsonObject) {
  const now = Date.now();
  if (name === "get_pending_jobs") {
    const limit = args.limit ?? DEFAULT_LIMIT;
    if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1) {
      return toolText("limit must be a whole number from 1 to 50.", true);
    }
    const jobs = await takePendingJobs(db, Math.min(limit, MAX_LIMIT), now);
    return toolText({ jobs });
  }
  if (name === "submit_resolution") {
    if (typeof args.jobId !== "string") return toolText("jobId is required.", true);
    const answer = args.failed === true ? { failed: true } : { candidates: args.candidates };
    const outcome = await submitResolution(db, args.jobId, answer, now);
    if (outcome.ok) return toolText({ jobId: args.jobId, status: outcome.status });
    const message = PROBLEMS[outcome.error as ResolutionProblem] ?? JOB_ERRORS[outcome.error] ?? outcome.error;
    return toolText(message, true);
  }
  return null;
}

function handle(c: Context<SignedEnv>) {
  const db = c.env.DB;
  return answerRpc(c, c.var.body, {
    info: SERVER_INFO,
    instructions: INSTRUCTIONS,
    tools: TOOLS,
    callTool: (name, args) => callTool(db, name, args),
  });
}

export const mcp = new Hono<SignedEnv>();

mcp.post("/mcp", requireResolver, readBody, handle);

// No server-sent streams or sessions: say so, as the spec asks.
mcp.on(["GET", "DELETE"], "/mcp", (c) => c.body(null, 405, { Allow: "POST" }));
