import { CryptoError, decryptStoredEnvelope, wipe, type BoardKey, type JsonValue } from "@map-diary/crypto";
import { bytes } from "./http";

/**
 * Reading for the Claude assistant. The Claude device holds only the master and Personal
 * board keys, so it reads only what is posted there; group boards stay out of reach. The
 * Worker decrypts on the fly for one tool call and keeps nothing.
 *
 * The free plan allows about 10 ms of CPU per request, so reads decrypt only the envelopes a
 * tool needs, straight from D1's bytes (no base64), and skip signature checks: every envelope
 * was verified when it was pushed.
 */

/** An unlocked Claude device for the length of one call. */
export interface ClaudeSession {
  deviceId: string;
  /** The owner's account: Claude writes as them, signed by its own device key. */
  accountId: string;
  signSecretKey: Uint8Array;
  /** The master board (when there is one) and the owner's Personal board, at their current key versions. */
  boards: { id: string; kind: "master" | "personal"; keyVersion: number }[];
  /** Every key version the Claude device holds for those boards. */
  keys: BoardKey[];
}

/** Forgets a session's secrets once the call is answered. */
export function wipeSession(session: ClaudeSession): void {
  wipe(session.signSecretKey, ...session.keys.map((k) => k.key));
}

/**
 * Most envelopes one call decrypts. About 10 µs each from D1's bytes, so this keeps a call
 * near the CPU limit even on a large diary; past it, results say they are incomplete.
 */
export const MAX_DECRYPTS = 800;

export interface Item {
  id: string;
  type: string;
  authorId: string;
  deviceId: string;
  placeId: string | null;
  createdAt: number;
  updatedAt: number;
  /** The session's boards the item is posted to. */
  boardIds: string[];
  payload: JsonValue;
}

export interface ItemFilter {
  types: readonly string[];
  ids?: readonly string[];
  placeIds?: readonly string[];
  authorIds?: readonly string[];
}

export interface Loaded {
  items: Item[];
  /** True when the decrypt budget ran out before every match was read. */
  truncated: boolean;
}

type Row = {
  id: string;
  v: number;
  type: string;
  author_id: string;
  device_id: string;
  place_id: string | null;
  created_at: number;
  updated_at: number;
  nonce: unknown;
  ciphertext: unknown;
  board_id: string;
  key_version: number;
  wrap_nonce: unknown;
  wrapped_key: unknown;
};

/** Shares one decrypt budget across the reads of a single tool call. */
export class Reader {
  private decrypts = 0;

  constructor(
    private readonly db: D1Database,
    private readonly session: ClaudeSession,
  ) {}

  /** Live items on the session's boards that match, newest first. */
  async load(filter: ItemFilter): Promise<Loaded> {
    const where = ["eb.board_id IN (SELECT value FROM json_each(?1))", "e.type IN (SELECT value FROM json_each(?2))"];
    const params: unknown[] = [JSON.stringify(this.session.boards.map((b) => b.id)), JSON.stringify(filter.types)];
    const list = (column: string, values: readonly string[] | undefined) => {
      if (!values) return;
      params.push(JSON.stringify(values));
      where.push(`${column} IN (SELECT value FROM json_each(?${params.length}))`);
    };
    list("e.id", filter.ids);
    list("e.place_id", filter.placeIds);
    list("e.author_id", filter.authorIds);
    if ([filter.ids, filter.placeIds, filter.authorIds].some((l) => l !== undefined && l.length === 0)) {
      return { items: [], truncated: false };
    }

    const { results } = await this.db
      .prepare(
        `SELECT e.id, e.v, e.type, e.author_id, e.device_id, e.place_id, e.created_at, e.updated_at,
                e.nonce, e.ciphertext, eb.board_id, eb.key_version, eb.nonce AS wrap_nonce, eb.wrapped_key
           FROM envelope_boards eb JOIN envelopes e ON e.id = eb.envelope_id
          WHERE ${where.join(" AND ")} AND eb.removed_at IS NULL AND e.deleted_at IS NULL
          ORDER BY e.updated_at DESC, e.id`,
      )
      .bind(...params)
      .all<Row>();

    // An envelope on both boards comes back twice: read it once, through a key the device holds.
    const byId = new Map<string, Row[]>();
    for (const r of results) {
      const rows = byId.get(r.id);
      if (rows) rows.push(r);
      else byId.set(r.id, [r]);
    }

    const items: Item[] = [];
    let truncated = false;
    for (const rows of byId.values()) {
      if (this.decrypts >= MAX_DECRYPTS) {
        truncated = true;
        break;
      }
      const first = rows[0]!;
      const payload = this.open(rows);
      if (payload === undefined) continue;
      items.push({
        id: first.id,
        type: first.type,
        authorId: first.author_id,
        deviceId: first.device_id,
        placeId: first.place_id,
        createdAt: first.created_at,
        updatedAt: first.updated_at,
        boardIds: rows.map((r) => r.board_id),
        payload,
      });
    }
    return { items, truncated };
  }

  private open(rows: Row[]): JsonValue | undefined {
    for (const r of rows) {
      const key = this.session.keys.find((k) => k.boardId === r.board_id && k.version === r.key_version);
      if (!key) continue; // a version the Claude device has not been given yet
      this.decrypts++;
      try {
        return decryptStoredEnvelope(
          {
            v: r.v,
            id: r.id,
            type: r.type,
            authorId: r.author_id,
            placeId: r.place_id,
            createdAt: r.created_at,
            nonce: bytes(r.nonce),
            ciphertext: bytes(r.ciphertext),
          },
          { boardId: r.board_id, keyVersion: r.key_version, nonce: bytes(r.wrap_nonce), wrappedKey: bytes(r.wrapped_key) },
          key.key,
        );
      } catch (err) {
        if (!(err instanceof CryptoError)) throw err;
      }
    }
    return undefined;
  }
}
