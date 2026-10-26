import {
  isAtRestSealed,
  openAtRest,
  sealAtRest,
  type AtRestKey,
  type AtRestSealed,
  type ResolvedChain,
  type ResolvedPlace,
} from "@map-diary/crypto";
import { loadAtRestKey } from "@map-diary/sync";
import type { TagDefPayload } from "../places/payloads";
import type { Category, PlaceChain, Status } from "../places/types";

/**
 * Places saved without a location, waiting for the resolver. They live on this device only:
 * each holds the one-time secret key that opens its job's result, which never leaves the
 * device. Once a place is found it is written to the diary like any other place.
 */

/** Everything the Add sheet had besides the location, applied once the place is found. */
export interface PendingDraft {
  /** What to call it while it waits: the typed name, or the name guessed from the link. */
  label: string;
  /** The link as given, kept as a source link. */
  link?: string;
  /** Only when the person picked one; otherwise the resolver's category is used. */
  category?: Category;
  status: Status;
  tagIds: string[];
  newTags: TagDefPayload[];
  comment: string;
  /** Where the status, tags and note go once the place is found; Personal if missing. */
  boards?: string[];
  /** Where the tags go, when the person picked boards apart from the status's. */
  tagBoards?: string[];
  /** Where the note goes, when the person picked boards apart from the status's. */
  commentBoards?: string[];
  /**
   * Set when the admin looks a catalogue place up again: the match picked in the Inbox becomes
   * that place's new facts, and no opinions are written.
   */
  refreshPlaceId?: string;
}

export type PendingState =
  /** Not sent yet (offline, or the queue was full); sent on the next poll. */
  | { kind: "unsent" }
  | { kind: "waiting"; jobId: string; publicKey: Uint8Array; secretKey: Uint8Array; expiresAt: number }
  /**
   * Several matches came back, or the match is one outlet of a chain: the person picks one
   * in the Inbox, or (for a chain) adds every outlet.
   */
  | { kind: "choose"; candidates: ResolvedPlace[]; chain?: ResolvedChain }
  /**
   * The match has the name of a place already on the map somewhere else: the person says
   * whether it is another branch of it. `area` is where the one on the map is.
   */
  | { kind: "branch"; candidate: ResolvedPlace; chain: PlaceChain; area?: string }
  /**
   * `job` is kept while the failed job is still on the server, so if the admin puts it back in
   * the queue its answer still reaches this device.
   */
  | { kind: "failed"; reason: FailReason; job?: WaitingJob }
  /** Found and written to the diary; shown in the Inbox for a few days. */
  | { kind: "added"; placeId: string; name: string };

export type WaitingJob = Omit<Extract<PendingState, { kind: "waiting" }>, "kind">;

export type FailReason = "not_found" | "expired" | "bad_result" | "rejected";

export interface PendingItem {
  id: string;
  /** What the resolver is asked: the link or the name. */
  query: string;
  draft: PendingDraft;
  createdAt: number;
  updatedAt: number;
  state: PendingState;
}

export interface PendingStore {
  list(): Promise<PendingItem[]>;
  get(id: string): Promise<PendingItem | undefined>;
  put(item: PendingItem): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryPendingStore implements PendingStore {
  private items = new Map<string, PendingItem>();
  async list() {
    return [...this.items.values()].map((i) => structuredClone(i));
  }
  async get(id: string) {
    const item = this.items.get(id);
    return item && structuredClone(item);
  }
  async put(item: PendingItem) {
    this.items.set(item.id, structuredClone(item));
  }
  async delete(id: string) {
    this.items.delete(id);
  }
  async clear() {
    this.items.clear();
  }
}

const DB_NAME = "map-diary-pending";
const STORE = "pending";
const META = "meta";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** A pending place as stored: only its id in the clear; the draft and job key are sealed. */
interface StoredPending extends AtRestSealed {
  id: string;
}

/**
 * The browser store: its own IndexedDB database, so the diary store's schema is untouched.
 * Each item is sealed under this database's at-rest key, like the diary's own items.
 */
export class IdbPendingStore implements PendingStore {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(factory: IDBFactory = indexedDB): Promise<IdbPendingStore> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(DB_NAME, 2);
      req.onupgradeneeded = (event) => {
        if (event.oldVersion < 1) req.result.createObjectStore(STORE, { keyPath: "id" });
        if (event.oldVersion < 2) req.result.createObjectStore(META);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const store = new IdbPendingStore(db);
    // Items an older version stored in the clear are sealed now.
    for (const item of await request(store.store("readonly").getAll())) {
      if (!isAtRestSealed(item)) await store.put(item as PendingItem);
    }
    return store;
  }

  private store(mode: IDBTransactionMode): IDBObjectStore {
    return this.db.transaction(STORE, mode).objectStore(STORE);
  }

  private async open(key: AtRestKey, stored: unknown): Promise<PendingItem | undefined> {
    if (stored === undefined) return undefined;
    if (!isAtRestSealed(stored)) return stored as PendingItem;
    const { id } = stored as StoredPending;
    return (await openAtRest(key, `${STORE}:${id}`, stored).catch(() => undefined)) as PendingItem | undefined;
  }

  async list() {
    const key = await loadAtRestKey(this.db, META);
    const stored = await request(this.store("readonly").getAll());
    const items = await Promise.all(stored.map((s) => this.open(key, s)));
    return items.filter((i): i is PendingItem => i !== undefined);
  }
  async get(id: string) {
    const key = await loadAtRestKey(this.db, META);
    return this.open(key, await request(this.store("readonly").get(id)));
  }
  async put(item: PendingItem) {
    const key = await loadAtRestKey(this.db, META);
    const sealed: StoredPending = { id: item.id, ...(await sealAtRest(key, `${STORE}:${item.id}`, item)) };
    await request(this.store("readwrite").put(sealed));
  }
  async delete(id: string) {
    await request(this.store("readwrite").delete(id));
  }
  async clear() {
    const tx = this.db.transaction([STORE, META], "readwrite");
    tx.objectStore(STORE).clear();
    tx.objectStore(META).clear();
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
