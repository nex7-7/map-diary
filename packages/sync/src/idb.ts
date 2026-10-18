import type { Envelope } from "@map-diary/crypto";
import type { DeviceState } from "./device";
import { shouldReplace, type DiaryItem, type DiaryStorage, type PulledPage } from "./storage";

export const IDB_NAME = "map-diary";
const IDB_VERSION = 1;

const DEVICE = "device";
const ITEMS = "items";
const OUTBOX = "outbox";
const DELETES = "deletes";
const META = "meta";
const ALL = [DEVICE, ITEMS, OUTBOX, DELETES, META];

const SELF = "self";
const CURSOR = "cursor";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export function openDiaryDb(factory: IDBFactory = indexedDB, name = IDB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(name, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore(DEVICE);
      db.createObjectStore(ITEMS, { keyPath: "id" });
      db.createObjectStore(OUTBOX, { keyPath: "id" });
      db.createObjectStore(DELETES);
      db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB is open in an older version of the app"));
  });
}

/**
 * The browser store. Decrypted items and this device's keys live here and nowhere else;
 * the app must be installed to the Home Screen on iOS so Safari does not evict it.
 */
export class IdbStorage implements DiaryStorage {
  constructor(private readonly db: IDBDatabase) {}

  static async open(factory?: IDBFactory, name?: string): Promise<IdbStorage> {
    return new IdbStorage(await openDiaryDb(factory, name));
  }

  close(): void {
    this.db.close();
  }

  private async read<T>(store: string, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const tx = this.db.transaction(store, "readonly");
    const result = await request(fn(tx.objectStore(store)));
    await done(tx);
    return result;
  }

  async loadDevice() {
    return this.read<DeviceState | undefined>(DEVICE, (s) => s.get(SELF) as IDBRequest<DeviceState | undefined>);
  }

  async saveDevice(device: DeviceState) {
    const tx = this.db.transaction(DEVICE, "readwrite");
    tx.objectStore(DEVICE).put(device, SELF);
    await done(tx);
  }

  async clear() {
    const tx = this.db.transaction(ALL, "readwrite");
    for (const name of ALL) tx.objectStore(name).clear();
    await done(tx);
  }

  async listItems() {
    return this.read<DiaryItem[]>(ITEMS, (s) => s.getAll() as IDBRequest<DiaryItem[]>);
  }

  async getItem(id: string) {
    return this.read<DiaryItem | undefined>(ITEMS, (s) => s.get(id) as IDBRequest<DiaryItem | undefined>);
  }

  async getCursor() {
    const value = await this.read<unknown>(META, (s) => s.get(CURSOR));
    return typeof value === "number" ? value : 0;
  }

  async applyPull(page: PulledPage) {
    const tx = this.db.transaction([ITEMS, OUTBOX, DELETES, META], "readwrite");
    const items = tx.objectStore(ITEMS);
    const outbox = tx.objectStore(OUTBOX);
    const deletes = tx.objectStore(DELETES);
    const changed: string[] = [];

    for (const item of page.items) {
      const [existing, pendingDelete] = await Promise.all([
        request(items.get(item.id) as IDBRequest<DiaryItem | undefined>),
        request(deletes.count(item.id)),
      ]);
      if (shouldReplace(existing, item, pendingDelete > 0)) {
        items.put(item);
        changed.push(item.id);
      }
    }
    for (const id of page.deleted) {
      if ((await request(items.count(id))) > 0) changed.push(id);
      items.delete(id);
      outbox.delete(id);
      deletes.delete(id);
    }
    if (page.cursor !== undefined) tx.objectStore(META).put(page.cursor, CURSOR);
    await done(tx);
    return changed;
  }

  async writeLocal(item: DiaryItem, envelope: Envelope) {
    const tx = this.db.transaction([ITEMS, OUTBOX], "readwrite");
    tx.objectStore(ITEMS).put(item);
    tx.objectStore(OUTBOX).put(envelope);
    await done(tx);
  }

  async deleteLocal(id: string) {
    const tx = this.db.transaction([ITEMS, OUTBOX, DELETES], "readwrite");
    tx.objectStore(ITEMS).delete(id);
    tx.objectStore(OUTBOX).delete(id);
    tx.objectStore(DELETES).put(true, id);
    await done(tx);
  }

  async listOutbox() {
    return this.read<Envelope[]>(OUTBOX, (s) => s.getAll() as IDBRequest<Envelope[]>);
  }

  async settleOutbox(sent: readonly { id: string; updatedAt: number }[]) {
    const tx = this.db.transaction(OUTBOX, "readwrite");
    const outbox = tx.objectStore(OUTBOX);
    for (const s of sent) {
      const queued = await request(outbox.get(s.id) as IDBRequest<Envelope | undefined>);
      if (queued?.updatedAt === s.updatedAt) outbox.delete(s.id);
    }
    await done(tx);
  }

  async listPendingDeletes() {
    const keys = await this.read<IDBValidKey[]>(DELETES, (s) => s.getAllKeys());
    return keys.filter((k): k is string => typeof k === "string");
  }

  async settleDeletes(ids: readonly string[]) {
    const tx = this.db.transaction(DELETES, "readwrite");
    for (const id of ids) tx.objectStore(DELETES).delete(id);
    await done(tx);
  }
}
