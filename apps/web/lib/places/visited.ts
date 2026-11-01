import type { JsonValue } from "@map-diary/crypto";
import type { StoredItem } from "./items-source";
import { readPayload, type StatusPayload } from "./payloads";
import type { Status, StatusOpinion } from "./types";

/** When this status's place was visited: the date the person gave, else when it was stamped. */
export function visitedOn(o: Pick<StatusOpinion, "updatedAt" | "visitedAt">): string {
  return o.visitedAt ?? o.updatedAt;
}

/**
 * The payload for a status written over `prev` (this person's current status item, if any).
 * A Visited date given is used; otherwise a place that stays Visited keeps the day it was first
 * stamped, so changing boards or re-saving does not move the date. Want to carries no date.
 */
export function nextStatusPayload(status: Status, prev?: StoredItem, visitedAt?: number): JsonValue {
  if (status !== "visited") return { status };
  if (visitedAt !== undefined) return { status, visitedAt } satisfies StatusPayload;
  const before = prev ? readPayload("status", prev.payload) : undefined;
  if (prev && before?.status === "visited") return { status, visitedAt: before.visitedAt ?? prev.updatedAt } satisfies StatusPayload;
  return { status };
}

/** The noon of a "YYYY-MM-DD" day in this device's time zone, so the day reads the same here. */
export function dayToMs(day: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  return Number.isNaN(d.getTime()) || d.getDate() !== Number(m[3]) ? undefined : d.getTime();
}

/** A time as the "YYYY-MM-DD" day it falls on in this device's time zone (for a date input). */
export function msToDay(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
