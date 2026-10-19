import type { Context } from "hono";
import { isObject, type JsonObject } from "./http";

/**
 * The JSON-RPC side of an MCP server over Streamable HTTP, stateless: every POST carries one
 * JSON-RPC message (or a batch) and gets a plain JSON reply; there are no sessions and no
 * server-sent streams. The resolver (mcp.ts) and the Claude assistant (assistant.ts) each
 * bring their own tools.
 */

/** Newest first; an unknown requested version gets the newest. */
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent?: unknown;
  isError?: true;
}

export interface McpServer {
  info: { name: string; version: string };
  instructions: string;
  tools: readonly unknown[];
  /** Runs a tool; null when there is no tool by that name. */
  callTool(name: unknown, args: JsonObject): Promise<ToolResult | null>;
}

type Id = string | number | null;
type Reply = JsonObject;

const result = (id: Id, value: unknown): Reply => ({ jsonrpc: "2.0", id, result: value });
const error = (id: Id, code: number, message: string): Reply => ({ jsonrpc: "2.0", id, error: { code, message } });

/** A tool's answer: text for the model, with the same value as structured content. */
export function toolText(value: unknown, isError = false): ToolResult {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
    ...(isError ? { isError: true as const } : { structuredContent: value }),
  };
}

/** Handles one JSON-RPC message; null for notifications and stray responses. */
async function handleMessage(server: McpServer, msg: unknown): Promise<Reply | null> {
  if (!isObject(msg) || msg.jsonrpc !== "2.0") return error(null, -32600, "Invalid Request");
  const isRequest = "id" in msg && (typeof msg.id === "string" || typeof msg.id === "number");
  if (typeof msg.method !== "string") return isRequest ? error(msg.id as Id, -32600, "Invalid Request") : null;
  if (!isRequest) return null; // notifications/initialized, cancellations and the like need no answer
  const id = msg.id as Id;
  const params = isObject(msg.params) ? msg.params : {};

  switch (msg.method) {
    case "initialize": {
      const asked = params.protocolVersion;
      const protocolVersion =
        typeof asked === "string" && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0];
      return result(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: server.info,
        instructions: server.instructions,
      });
    }
    case "ping":
      return result(id, {});
    case "tools/list":
      return result(id, { tools: server.tools });
    case "tools/call": {
      const args = isObject(params.arguments) ? params.arguments : {};
      const out = await server.callTool(params.name, args);
      return out ? result(id, out) : error(id, -32602, "Unknown tool");
    }
    default:
      return error(id, -32601, "Method not found");
  }
}

/** Answers a POSTed JSON-RPC body: one message or a batch. */
export async function answerRpc(c: Context, body: unknown, server: McpServer): Promise<Response> {
  if (Array.isArray(body)) {
    if (body.length === 0) return c.json(error(null, -32600, "Invalid Request"), 400);
    // One at a time, so a batch of tool calls stays within one request's CPU and D1 limits in order.
    const replies: Reply[] = [];
    for (const m of body) {
      const r = await handleMessage(server, m);
      if (r) replies.push(r);
    }
    return replies.length ? c.json(replies) : c.body(null, 202);
  }
  const reply = await handleMessage(server, body);
  return reply ? c.json(reply) : c.body(null, 202);
}
