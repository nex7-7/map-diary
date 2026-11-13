import type { JsonValue } from "@map-diary/crypto";
import type { StoredItem } from "./items-source";
import { readPayload, type StatusPayload } from "./payloads";
import type { PlaceView, Status, StatusOpinion } from "./types";

/** When this status's place was visited: the date the person gave, else when it was stamped. */
export function visitedOn(o: Pick<StatusOpinion, "updatedAt" | "visitedAt">): string {
  return o.visitedAt ?? o.updatedAt;
}

/**
 * The payload for a status written over `prev` (this person's current status item, if any).
 * A Visited date given is used; otherwise a place that stays Visited keeps the day it was first
 * stamped, so changing boards or re-saving does not move the date. Want to carries no date.
 * On a chain, `outlets` names the outlets visited; a place that stays Visited keeps its own.
 */
export function nextStatusPayload(status: Status, prev?: StoredItem, visitedAt?: number, outlets?: readonly string[]): JsonValue {
  if (status !== "visited") return { status };
  const before = prev ? readPayload("status", prev.payload) : undefined;
  const stays = prev !== undefined && before?.status === "visited";
  const out: StatusPayload = { status };
  if (visitedAt !== undefined) out.visitedAt = visitedAt;
  else if (stays) out.visitedAt = before.visitedAt ?? prev.updatedAt;
  const ids = outlets ?? (stays ? before.outlets : undefined);
  if (ids && ids.length > 0) out.outlets = [...ids];
  return out as unknown as JsonValue;
}

/**
 * The outlets of a chain this Visited status has been to: the ones it names, else the one it
 * is attached to. If none of those is an outlet any more (merged away), every outlet counts,
 * so the place never loses its seal. Empty for Want to.
 */
export function visitedOutlets(place: Pick<PlaceView, "id" | "outlets">, o: Pick<StatusOpinion, "status" | "outlets" | "placeId">): Set<string> {
  if (o.status !== "visited") return new Set();
  const all = (place.outlets ?? [place]).map((x) => x.id);
  const named = o.outlets ?? (o.placeId ? [o.placeId] : []);
  const kept = all.filter((id) => named.includes(id));
  return new Set(kept.length > 0 ? kept : all);
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
