import {
  generateAtRestKey,
  isAtRestKey,
  isAtRestSealed,
  openAtRest,
  sealAtRest,
  type AtRestKey,
  type AtRestSealed,
  type Envelope,
} from "@map-diary/crypto";
import { isCurrentDeviceState, type DeviceState } from "./device";
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
const AT_REST_KEY = "atRestKey";
const SEALED_FLAG = "sealed";

/** An item as stored: id and time in the clear for the sync rules, the rest sealed. */
interface StoredItem extends AtRestSealed {
  id: string;
  updatedAt: number;
}

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

/**
 * The database's at-rest key, made on first use and kept in `store` under a fixed name. The
 * browser stores the key itself, never its bytes. Read on every use, so a store cleared in
 * another tab gets a new key rather than a stale one.
 */
export async function loadAtRestKey(db: IDBDatabase, store: string): Promise<AtRestKey> {
  const read = db.transaction(store, "readonly");
  const existing: unknown = await request(read.objectStore(store).get(AT_REST_KEY));
  if (isAtRestKey(existing)) return existing;
  const fresh = await generateAtRestKey();
  // Another tab may have made one meanwhile: keep whichever was stored first.
  const tx = db.transaction(store, "readwrite");
  const s = tx.objectStore(store);
  const raced: unknown = await request(s.get(AT_REST_KEY));
  if (!isAtRestKey(raced)) s.put(fresh, AT_REST_KEY);
  await done(tx);
  return isAtRestKey(raced) ? raced : fresh;
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
 * The browser store. Items and this device's keys live here and nowhere else, sealed under
 * the database's at-rest key (see `loadAtRestKey`); outbox envelopes are already ciphertext.
 * The app must be installed to the Home Screen on iOS so Safari does not evict it.
 */
export class IdbStorage implements DiaryStorage {
  constructor(private readonly db: IDBDatabase) {}

  static async open(factory?: IDBFactory, name?: string): Promise<IdbStorage> {
    const storage = new IdbStorage(await openDiaryDb(factory, name));
    await storage.sealPlainRecords();
    return storage;
  }

  close(): void {
    this.db.close();
  }

  private key(): Promise<AtRestKey> {
    return loadAtRestKey(this.db, META);
  }

  private async read<T>(store: string, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const tx = this.db.transaction(store, "readonly");
    const result = await request(fn(tx.objectStore(store)));
    await done(tx);
    return result;
  }

  private async sealItem(key: AtRestKey, item: DiaryItem): Promise<StoredItem> {
    return { id: item.id, updatedAt: item.updatedAt, ...(await sealAtRest(key, `${ITEMS}:${item.id}`, item)) };
  }

  /** Opens a stored item; one stored before sealing existed is returned as it is. */
  private async openItem(key: AtRestKey, stored: unknown): Promise<DiaryItem | undefined> {
    if (stored === undefined) return undefined;
    if (!isAtRestSealed(stored)) return stored as DiaryItem;
    const { id } = stored as StoredItem;
    return (await openAtRest(key, `${ITEMS}:${id}`, stored)) as DiaryItem;
  }

  /** Seals the device and items a version of the app before sealing stored in the clear. */
  private async sealPlainRecords(): Promise<void> {
    if ((await this.read<unknown>(META, (s) => s.get(SEALED_FLAG))) === true) return;
    const key = await this.key();
    const device = await this.read<unknown>(DEVICE, (s) => s.get(SELF) as IDBRequest<unknown>);
    const items = await this.read<unknown[]>(ITEMS, (s) => s.getAll());
    const sealedDevice =
      device !== undefined && !isAtRestSealed(device) ? await sealAtRest(key, `${DEVICE}:${SELF}`, device) : undefined;
    const sealedItems = await Promise.all(
      items.filter((i) => !isAtRestSealed(i)).map((i) => this.sealItem(key, i as DiaryItem)),
    );
    const tx = this.db.transaction([DEVICE, ITEMS, META], "readwrite");
    if (sealedDevice) tx.objectStore(DEVICE).put(sealedDevice, SELF);
    for (const item of sealedItems) tx.objectStore(ITEMS).put(item);
    tx.objectStore(META).put(true, SEALED_FLAG);
    await done(tx);
  }

  async loadDevice() {
    const stored = await this.read<unknown>(DEVICE, (s) => s.get(SELF) as IDBRequest<unknown>);
    let device: unknown = stored;
    if (isAtRestSealed(stored)) {
      try {
        device = await openAtRest(await this.key(), `${DEVICE}:${SELF}`, stored);
      } catch {
        // Sealed under a key that is gone (storage cleared in another tab): sign in again.
        return undefined;
      }
    }
    // An older device format cannot unwrap account-wrapped board keys; it signs in again.
    return isCurrentDeviceState(device) ? device : undefined;
  }

  async saveDevice(device: DeviceState) {
    const sealed = await sealAtRest(await this.key(), `${DEVICE}:${SELF}`, device);
    const tx = this.db.transaction(DEVICE, "readwrite");
    tx.objectStore(DEVICE).put(sealed, SELF);
    await done(tx);
  }

  async clear() {
    const tx = this.db.transaction(ALL, "readwrite");
    for (const name of ALL) tx.objectStore(name).clear();
    await done(tx);
  }

  async listItems() {
    const key = await this.key();
    const stored = await this.read<unknown[]>(ITEMS, (s) => s.getAll());
    const items = await Promise.all(stored.map((s) => this.openItem(key, s).catch(() => undefined)));
    return items.filter((i): i is DiaryItem => i !== undefined);
  }

  async getItem(id: string) {
    const key = await this.key();
    const stored = await this.read<unknown>(ITEMS, (s) => s.get(id));
    return this.openItem(key, stored).catch(() => undefined);
  }

  async getCursor() {
    const value = await this.read<unknown>(META, (s) => s.get(CURSOR));
    return typeof value === "number" ? value : 0;
  }

  async applyPull(page: PulledPage) {
    // Seal first: a transaction closes if it waits on anything but its own requests.
    const key = await this.key();
    const sealed = await Promise.all(page.items.map((item) => this.sealItem(key, item)));
    const tx = this.db.transaction([ITEMS, OUTBOX, DELETES, META], "readwrite");
    const items = tx.objectStore(ITEMS);
    const outbox = tx.objectStore(OUTBOX);
    const deletes = tx.objectStore(DELETES);
    const changed: string[] = [];

    for (const item of sealed) {
      const [existing, pendingDelete] = await Promise.all([
        request(items.get(item.id) as IDBRequest<{ updatedAt: number } | undefined>),
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
    const sealed = await this.sealItem(await this.key(), item);
    const tx = this.db.transaction([ITEMS, OUTBOX], "readwrite");
    tx.objectStore(ITEMS).put(sealed);
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
