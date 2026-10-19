import type { Envelope, EnvelopeType, JsonValue } from "@map-diary/crypto";
import { isCurrentDeviceState, type DeviceState } from "./device";

/** A decrypted item as the device keeps it: the envelope's metadata plus its payload. */
export interface DiaryItem {
  id: string;
  type: EnvelopeType;
  /** The account that wrote it. */
  authorId: string;
  /** The device that signed it. */
  deviceId: string;
  placeId: string | null;
  createdAt: number;
  updatedAt: number;
  /** The boards it is posted to. */
  boardIds: string[];
  payload: JsonValue;
  /** Signed by the owner's Claude assistant device: shown as "<name> via Claude". */
  viaClaude?: true;
}

export interface PulledPage {
  items: DiaryItem[];
  deleted: string[];
  /** Saved with the page, so a page is applied exactly once. Omit to keep the cursor. */
  cursor?: number;
}

/**
 * Everything the device stores. Implementations make each method atomic: IndexedDB in the
 * browser (`IdbStorage`), memory in tests (`MemoryStorage`).
 */
export interface DiaryStorage {
  loadDevice(): Promise<DeviceState | undefined>;
  saveDevice(device: DeviceState): Promise<void>;
  /** Removes everything, keys included. */
  clear(): Promise<void>;

  listItems(): Promise<DiaryItem[]>;
  getItem(id: string): Promise<DiaryItem | undefined>;
  getCursor(): Promise<number>;

  /**
   * Applies a pulled page. An item replaces the stored one only if its `updatedAt` is newer,
   * and never while a local delete of it is queued. A deletion removes the item and anything
   * queued for it. Returns the ids that changed.
   */
  applyPull(page: PulledPage): Promise<string[]>;

  /** Saves a local write and queues its envelope for push, replacing any older queued version. */
  writeLocal(item: DiaryItem, envelope: Envelope): Promise<void>;
  /** Removes an item locally and queues its deletion. */
  deleteLocal(id: string): Promise<void>;

  listOutbox(): Promise<Envelope[]>;
  /** Drops sent envelopes from the queue, unless a newer version of one was queued meanwhile. */
  settleOutbox(sent: readonly { id: string; updatedAt: number }[]): Promise<void>;
  listPendingDeletes(): Promise<string[]>;
  settleDeletes(ids: readonly string[]): Promise<void>;
}

/** Shared by both implementations so their rules cannot drift. */
export function shouldReplace(existing: DiaryItem | undefined, incoming: DiaryItem, deletePending: boolean): boolean {
  if (deletePending) return false;
  return !existing || incoming.updatedAt > existing.updatedAt;
}

export class MemoryStorage implements DiaryStorage {
  private device: DeviceState | undefined;
  private items = new Map<string, DiaryItem>();
  private outbox = new Map<string, Envelope>();
  private deletes = new Set<string>();
  private cursor = 0;

  async loadDevice() {
    return isCurrentDeviceState(this.device) ? this.device : undefined;
  }

  async saveDevice(device: DeviceState) {
    this.device = device;
  }

  async clear() {
    this.device = undefined;
    this.items.clear();
    this.outbox.clear();
    this.deletes.clear();
    this.cursor = 0;
  }

  async listItems() {
    return [...this.items.values()];
  }

  async getItem(id: string) {
    return this.items.get(id);
  }

  async getCursor() {
    return this.cursor;
  }

  async applyPull(page: PulledPage) {
    const changed: string[] = [];
    for (const item of page.items) {
      if (shouldReplace(this.items.get(item.id), item, this.deletes.has(item.id))) {
        this.items.set(item.id, item);
        changed.push(item.id);
      }
    }
    for (const id of page.deleted) {
      if (this.items.delete(id)) changed.push(id);
      this.outbox.delete(id);
      this.deletes.delete(id);
    }
    if (page.cursor !== undefined) this.cursor = page.cursor;
    return changed;
  }

  async writeLocal(item: DiaryItem, envelope: Envelope) {
    this.items.set(item.id, item);
    this.outbox.set(envelope.id, envelope);
  }

  async deleteLocal(id: string) {
    this.items.delete(id);
    this.outbox.delete(id);
    this.deletes.add(id);
  }

  async listOutbox() {
    return [...this.outbox.values()];
  }

  async settleOutbox(sent: readonly { id: string; updatedAt: number }[]) {
    for (const s of sent) {
      if (this.outbox.get(s.id)?.updatedAt === s.updatedAt) this.outbox.delete(s.id);
    }
  }

  async listPendingDeletes() {
    return [...this.deletes];
  }

  async settleDeletes(ids: readonly string[]) {
    for (const id of ids) this.deletes.delete(id);
  }
}
