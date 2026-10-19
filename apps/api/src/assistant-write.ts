import {
  fromBase64,
  linkHash,
  linkHashKey,
  normaliseLink,
  sealEnvelope,
  toBase64,
  wipe,
  type BoardKey,
  type EnvelopeType,
  type JsonValue,
} from "@map-diary/crypto";
import type { ClaudeSession } from "./assistant-read";
import type { AuthedDevice } from "./auth";
import { deleteEnvelopes, pushEnvelopes, type Rejection } from "./envelopes";

/**
 * Writing for the Claude assistant. The Worker seals each item with the Claude device's own
 * signing key, as the owner's account, and stores it through the same checks as a push from
 * any device (envelopes.ts), so Claude gets no rights the owner's phone does not have.
 */

/** A write Claude cannot make, with words the model can pass on or act on. */
export class WriteRefused extends Error {
  override name = "WriteRefused";
  constructor(
    message: string,
    /** The catalogue place that already has the link, for a duplicate. */
    readonly placeId?: string,
  ) {
    super(message);
  }
}

export const OPEN_THE_APP =
  "The diary's keys changed since Claude last had them. Open the app once on one of your devices so it can give " +
  "Claude the new keys, then try again.";

const REJECTIONS: Record<string, string> = {
  stale_key: OPEN_THE_APP,
  board_not_allowed: "Claude cannot post to that board.",
  duplicate_place: "That place is already in the diary.",
  facts_locked: "Only the admin can change a place's facts once they are written.",
  place_not_on_master: "Places go on the public catalogue only.",
  not_author: "Claude can only change your own items.",
  deleted: "That item was deleted.",
  immutable_field: "That item cannot be changed that way.",
};

/** The Claude device as the push checks see it: never admin, and limited to master and Personal. */
function deviceOf(session: ClaudeSession): AuthedDevice {
  return { id: session.deviceId, accountId: session.accountId, kind: "claude", isAdmin: false };
}

export interface NewItem {
  type: EnvelopeType;
  placeId: string | null;
  payload: JsonValue;
  boardIds: readonly string[];
  /** To write a new version of an existing item, keep its id and createdAt. */
  id?: string;
  createdAt?: number;
}

/** The key new writes to a board use. Refuses until the Claude device holds the board's current version. */
function writeKey(session: ClaudeSession, boardId: string): BoardKey {
  const board = session.boards.find((b) => b.id === boardId);
  const key = board && session.keys.find((k) => k.boardId === boardId && k.version === board.keyVersion);
  if (!key) throw new WriteRefused(OPEN_THE_APP);
  return key;
}

/** Link hashes for a place's source links, so the Worker's duplicate check sees them. */
function placeLinkHashes(session: ClaudeSession, links: readonly string[]): string[] {
  const master = session.boards.find((b) => b.kind === "master");
  const first = master && session.keys.find((k) => k.boardId === master.id && k.version === 1);
  if (!first || links.length === 0) return [];
  const key = linkHashKey(first.key);
  try {
    return [...new Set(links.map(normaliseLink))].map((l) => toBase64(linkHash(key, l)));
  } finally {
    wipe(key);
  }
}

/** The catalogue place that already has one of these links, if any. */
export async function findByLinks(db: D1Database, session: ClaudeSession, links: readonly string[]): Promise<string | null> {
  const hashes = placeLinkHashes(session, links);
  if (hashes.length === 0) return null;
  const rows = await db.batch(
    hashes.map((h) => db.prepare("SELECT place_id FROM place_link_hashes WHERE link_hash = ?").bind(fromBase64(h))),
  );
  const match = rows.flatMap((r) => (r.results ?? []) as { place_id: string }[])[0];
  return match?.place_id ?? null;
}

/** Seals and stores items in order; throws WriteRefused with the first refusal. Returns their ids. */
export async function writeItems(db: D1Database, session: ClaudeSession, items: readonly NewItem[]): Promise<string[]> {
  const now = Date.now();
  const envelopes = items.map((item) =>
    sealEnvelope({
      type: item.type,
      authorId: session.accountId,
      deviceId: session.deviceId,
      placeId: item.placeId,
      payload: item.payload,
      boards: item.boardIds.map((id) => writeKey(session, id)),
      signSecretKey: session.signSecretKey,
      ...(item.id ? { id: item.id } : {}),
      ...(item.createdAt !== undefined ? { createdAt: item.createdAt, updatedAt: Math.max(now, item.createdAt) } : {}),
    }),
  );
  const linkHashes = new Map<string, string[]>();
  items.forEach((item, i) => {
    if (item.type !== "place") return;
    const links = (item.payload as { sourceLinks?: string[] }).sourceLinks ?? [];
    linkHashes.set(envelopes[i]!.id, placeLinkHashes(session, links));
  });

  const outcome = await pushEnvelopes(db, deviceOf(session), envelopes, linkHashes);
  if (!outcome) throw new WriteRefused("This Claude connection was removed. Connect Claude again from the Devices screen.");
  const refused: Rejection | undefined = outcome.rejected[0];
  if (refused) throw new WriteRefused(REJECTIONS[refused.reason] ?? `Refused: ${refused.reason}.`, refused.placeId);
  return envelopes.map((e) => e.id);
}

export async function removeItems(db: D1Database, session: ClaudeSession, ids: readonly string[]): Promise<void> {
  if (ids.length > 0) await deleteEnvelopes(db, deviceOf(session), ids);
}

/**
 * Boards an existing item is posted to that the Claude device cannot write to (a group). Claude
 * cannot rewrite such an item without dropping it from that group, so it refuses instead.
 */
export async function boardsOutOfReach(db: D1Database, session: ClaudeSession, id: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM envelope_boards
        WHERE envelope_id = ? AND removed_at IS NULL AND board_id NOT IN (SELECT value FROM json_each(?))`,
    )
    .bind(id, JSON.stringify(session.boards.map((b) => b.id)))
    .first<{ n: number }>();
  return row?.n ?? 0;
}
