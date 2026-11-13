import { fromBase64, toBase64, type JsonValue } from "@map-diary/crypto";
import type { PendingItem, PendingStore } from "./store";

/**
 * The parts of the device diary the synced pending store needs. `Diary` from @map-diary/sync
 * has them all.
 */
export interface PendingDiary {
  readonly device: { readonly accountId: string; readonly deviceId: string; readonly personalBoardId: string };
  listItems(): Promise<readonly PendingDiaryItem[]>;
  getItem(id: string): Promise<PendingDiaryItem | undefined>;
  write(input: { type: "pending"; placeId: null; payload: JsonValue; id?: string; boards?: readonly string[] }): Promise<{ id: string }>;
  remove(id: string): Promise<void>;
  subscribe?(listener: () => void): () => void;
  sync?(): Promise<void>;
}

interface PendingDiaryItem {
  id: string;
  type: string;
  authorId: string;
  deviceId?: string;
  updatedAt: number;
  boardIds?: readonly string[];
  payload: JsonValue;
}

/**
 * Pending places as items on the person's own Personal board, so every one of their devices
 * holds them and whichever is open first collects the resolver's answer. Each item carries its
 * job's one-time key; it is sealed like any other item, so the Worker sees only ciphertext of
 * type `pending`, and it only accepts that type on the author's Personal board.
 *
 * The item's id is the envelope's id. The Claude device never reads this type.
 */
export class DiaryPendingStore implements PendingStore {
  constructor(private readonly diary: PendingDiary) {}

  private own(item: PendingDiaryItem | undefined): item is PendingDiaryItem {
    return item !== undefined && item.type === "pending" && item.authorId === this.diary.device.accountId;
  }

  async list(): Promise<PendingItem[]> {
    const items = (await this.diary.listItems()).filter((i) => this.own(i));
    return items.map((i) => readPendingItem(i.id, i.payload)).filter((i): i is PendingItem => i !== undefined);
  }

  async get(id: string): Promise<PendingItem | undefined> {
    const item = await this.diary.getItem(id);
    return this.own(item) ? readPendingItem(item.id, item.payload) : undefined;
  }

  async create(item: Omit<PendingItem, "id">): Promise<PendingItem> {
    // The id is the envelope's, so it is not in the payload.
    const { id } = await this.diary.write({ type: "pending", placeId: null, payload: encodePending({ ...item, id: "" }), boards: [this.diary.device.personalBoardId] });
    return { ...item, id };
  }

  async put(item: PendingItem): Promise<void> {
    const prior = await this.diary.getItem(item.id);
    if (!this.own(prior)) return;
    await this.diary.write({ type: "pending", placeId: null, payload: encodePending(item), id: item.id, boards: [this.diary.device.personalBoardId] });
  }

  async delete(id: string): Promise<void> {
    if (this.own(await this.diary.getItem(id))) await this.diary.remove(id);
  }

  /** Forgetting this device wipes its diary store, items and all; the other devices keep theirs. */
  async clear(): Promise<void> {}

  async wroteHere(id: string): Promise<boolean> {
    const item = await this.diary.getItem(id);
    return this.own(item) && item.deviceId === this.diary.device.deviceId;
  }

  /** Pulls what the other devices wrote, so a pass works on the latest copy of each item. */
  async refresh(): Promise<void> {
    await this.diary.sync?.().catch(() => undefined);
  }

  /** Calls `listener` when a pending item changes on this device or arrives from another one. */
  subscribe(listener: () => void): () => void {
    if (!this.diary.subscribe) return () => {};
    let last = "";
    let live = true;
    const check = () =>
      void this.diary.listItems().then((items) => {
        const key = items
          .filter((i) => this.own(i))
          .map((i) => `${i.id}:${i.updatedAt}`)
          .sort()
          .join(",");
        if (live && key !== last) {
          last = key;
          listener();
        }
      });
    void this.diary.listItems().then((items) => {
      last = items
        .filter((i) => this.own(i))
        .map((i) => `${i.id}:${i.updatedAt}`)
        .sort()
        .join(",");
    });
    const off = this.diary.subscribe(check);
    return () => {
      live = false;
      off();
    };
  }
}

const B64 = "$b64";

/** The item as JSON: its one-time keys (bytes) become `{ "$b64": … }`. The id is the envelope's. */
export function encodePending(item: PendingItem): JsonValue {
  const { id: _id, ...rest } = item;
  return JSON.parse(JSON.stringify(rest, (_key, value: unknown) => (value instanceof Uint8Array ? { [B64]: toBase64(value) } : value))) as JsonValue;
}

function revive(value: JsonValue): unknown {
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === B64 && typeof value[B64] === "string") return fromBase64(value[B64]);
    return Object.fromEntries(keys.map((k) => [k, revive(value[k]!)]));
  }
  return value;
}

const STATE_KINDS = new Set(["unsent", "waiting", "choose", "branch", "failed", "added"]);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isKey = (v: unknown): boolean => v instanceof Uint8Array && v.length === 32;
const isJob = (v: unknown): boolean =>
  isRecord(v) && typeof v.jobId === "string" && isKey(v.publicKey) && isKey(v.secretKey) && typeof v.expiresAt === "number";

/**
 * A pending item read back from its payload, or nothing if it does not have the shape this
 * version writes. Only the author's own devices write it, so the checks guard against an older
 * or newer version of the app, not against other people.
 */
export function readPendingItem(id: string, payload: JsonValue): PendingItem | undefined {
  let p: unknown;
  try {
    p = revive(payload);
  } catch {
    return undefined;
  }
  if (!isRecord(p) || typeof p.query !== "string" || typeof p.createdAt !== "number" || typeof p.updatedAt !== "number") return undefined;
  const { draft, state } = p;
  if (!isRecord(draft) || typeof draft.label !== "string" || typeof draft.status !== "string" || typeof draft.comment !== "string") return undefined;
  if (!Array.isArray(draft.tagIds) || !Array.isArray(draft.newTags)) return undefined;
  if (!isRecord(state) || typeof state.kind !== "string" || !STATE_KINDS.has(state.kind)) return undefined;
  if (state.kind === "waiting" && !isJob(state)) return undefined;
  if (state.kind === "failed" && state.job !== undefined && !isJob(state.job)) return undefined;
  if (state.kind === "choose" && !Array.isArray(state.candidates)) return undefined;
  if (state.kind === "added" && typeof state.placeId !== "string") return undefined;
  return { ...(p as Omit<PendingItem, "id">), id };
}
