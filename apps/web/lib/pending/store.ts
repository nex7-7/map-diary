import type { ResolvedPlace } from "@map-diary/crypto";
import type { TagDefPayload } from "../places/payloads";
import type { Category, Status } from "../places/types";

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
}

export type PendingState =
  /** Not sent yet (offline, or the queue was full); sent on the next poll. */
  | { kind: "unsent" }
  | { kind: "waiting"; jobId: string; publicKey: Uint8Array; secretKey: Uint8Array; expiresAt: number }
  /** Several matches came back; the person picks one in the Inbox. */
  | { kind: "choose"; candidates: ResolvedPlace[] }
  | { kind: "failed"; reason: FailReason }
  /** Found and written to the diary; shown in the Inbox for a few days. */
  | { kind: "added"; placeId: string; name: string };

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

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** The browser store: its own IndexedDB database, so the diary store's schema is untouched. */
export class IdbPendingStore implements PendingStore {
  private constructor(private readonly db: IDBDatabase) {}

  static open(factory: IDBFactory = indexedDB): Promise<IdbPendingStore> {
    return new Promise((resolve, reject) => {
      const req = factory.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(new IdbPendingStore(req.result));
      req.onerror = () => reject(req.error);
    });
  }

  private store(mode: IDBTransactionMode): IDBObjectStore {
    return this.db.transaction(STORE, mode).objectStore(STORE);
  }

  list() {
    return request(this.store("readonly").getAll() as IDBRequest<PendingItem[]>);
  }
  get(id: string) {
    return request(this.store("readonly").get(id) as IDBRequest<PendingItem | undefined>);
  }
  async put(item: PendingItem) {
    await request(this.store("readwrite").put(item));
  }
  async delete(id: string) {
    await request(this.store("readwrite").delete(id));
  }
  async clear() {
    await request(this.store("readwrite").clear());
  }
}
