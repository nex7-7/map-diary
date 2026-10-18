import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** The only error body the API returns. Never include request data in it. */
export function fail(c: Context, status: ContentfulStatusCode, error: string) {
  return c.json({ error }, status);
}

/** D1 returns BLOB columns as number arrays; normalise to bytes. */
export function bytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  throw new TypeError("expected a BLOB column");
}

export type JsonObject = { [key: string]: unknown };

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Ids are random base64url strings from the device; keep them short and plain. */
export function isId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

export function isB64(value: unknown, maxLength = 1 << 20): value is string {
  return typeof value === "string" && value.length <= maxLength && /^[A-Za-z0-9_-]*$/.test(value);
}

export function isMillis(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}
