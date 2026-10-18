import {
  CryptoError,
  fromBase64,
  openEnvelope,
  ready,
  sealEnvelope,
  type Envelope,
  type EnvelopeType,
  type JsonValue,
} from "@map-diary/crypto";
import { ApiError, NetworkError, type Api, type Signer, type SyncResponse } from "./api";
import { boardKeyLookup, currentBoardKey, type DeviceState } from "./device";
import type { DiaryItem, DiaryStorage } from "./storage";

/** The API takes at most this many envelopes or deletions per call. */
const PUSH_BATCH = 100;

export type SyncPhase = "idle" | "syncing" | "offline" | "error";

export interface SyncStatus {
  phase: SyncPhase;
  /** When the last full round finished. */
  lastSyncedAt: number | null;
  /** Envelopes and deletions still waiting to go up. */
  pending: number;
  /** Error code of the last failed round, for example `unauthenticated` once this device is revoked. */
  error: string | null;
}

/** An envelope that could not be stored: the server refused it, or it failed to verify or open. */
export interface SkippedEnvelope {
  id: string | null;
  reason: string;
}

export interface WriteInput {
  type: EnvelopeType;
  placeId: string | null;
  payload: JsonValue;
  /** Rewrites an existing item of this device's account. Omit for a new one. */
  id?: string;
}

type Listener = () => void;

function itemFrom(envelope: Envelope, payload: JsonValue): DiaryItem {
  return {
    id: envelope.id,
    type: envelope.type,
    authorId: envelope.authorId,
    deviceId: envelope.deviceId,
    placeId: envelope.placeId,
    createdAt: envelope.createdAt,
    updatedAt: envelope.updatedAt,
    boardIds: envelope.boards.map((b) => b.boardId),
    payload,
  };
}

/**
 * The device's diary: a local store that is always readable, and a sync loop that pushes
 * local writes and pulls changes. Writes land locally first and sync in the background.
 * Phase 2 writes to the Personal board only.
 */
export class Diary {
  private readonly listeners = new Set<Listener>();
  private status: SyncStatus = { phase: "idle", lastSyncedAt: null, pending: 0, error: null };
  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly skippedLog: SkippedEnvelope[] = [];

  constructor(
    readonly device: DeviceState,
    private readonly storage: DiaryStorage,
    private readonly api: Api,
  ) {}

  private get signer(): Signer {
    return { deviceId: this.device.deviceId, signSecretKey: this.device.identity.signSecretKey };
  }

  /** Called after any change to items or sync status. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  private setStatus(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    this.emit();
  }

  private skip(entry: SkippedEnvelope): void {
    this.skippedLog.push(entry);
    if (this.skippedLog.length > 100) this.skippedLog.shift();
  }

  /** The most recent envelopes that could not be stored, newest last. */
  get skipped(): readonly SkippedEnvelope[] {
    return this.skippedLog;
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  listItems(): Promise<DiaryItem[]> {
    return this.storage.listItems();
  }

  getItem(id: string): Promise<DiaryItem | undefined> {
    return this.storage.getItem(id);
  }

  /** Encrypts and saves an item on this device, then syncs it. Returns the stored item. */
  async write(input: WriteInput): Promise<DiaryItem> {
    await ready();
    const board = currentBoardKey(this.device, this.device.personalBoardId);
    if (!board) throw new Error("This device has no key for the Personal board");

    let createdAt: number | undefined;
    let updatedAt: number | undefined;
    if (input.id !== undefined) {
      const prior = await this.storage.getItem(input.id);
      if (!prior) throw new Error("No such item on this device");
      if (prior.authorId !== this.device.accountId) throw new Error("Only the author can change an item");
      if (prior.type !== input.type || prior.placeId !== input.placeId) {
        throw new Error("An item's type and place cannot change");
      }
      createdAt = prior.createdAt;
      // Strictly newer than the last version, even if this clock runs behind another device's.
      updatedAt = Math.max(Date.now(), prior.updatedAt + 1);
    }

    const envelope = sealEnvelope({
      type: input.type,
      authorId: this.device.accountId,
      deviceId: this.device.deviceId,
      placeId: input.placeId,
      payload: input.payload,
      boards: [board],
      signSecretKey: this.device.identity.signSecretKey,
      ...(input.id === undefined ? {} : { id: input.id }),
      ...(createdAt === undefined ? {} : { createdAt }),
      ...(updatedAt === undefined ? {} : { updatedAt }),
    });
    const item = itemFrom(envelope, input.payload);
    await this.storage.writeLocal(item, envelope);
    this.emit();
    void this.sync();
    return item;
  }

  /** Deletes one of this account's items everywhere. */
  async remove(id: string): Promise<void> {
    const prior = await this.storage.getItem(id);
    if (prior && prior.authorId !== this.device.accountId) throw new Error("Only the author can delete an item");
    await this.storage.deleteLocal(id);
    this.emit();
    void this.sync();
  }

  /** Syncs every `intervalMs` until `stop`. The browser layer also calls `sync` when back online. */
  start(intervalMs = 60_000): void {
    this.stop();
    this.timer = setInterval(() => void this.sync(), intervalMs);
    void this.sync();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * One round: push queued deletions, push queued envelopes, then pull until caught up.
   * Calls during a round are folded into one more round after it.
   */
  sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.round();
        } while (this.again);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async round(): Promise<void> {
    await ready();
    this.setStatus({ phase: "syncing" });
    try {
      await this.pushDeletes();
      await this.pushEnvelopes();
      await this.pull();
      this.setStatus({ phase: "idle", lastSyncedAt: Date.now(), error: null, pending: await this.countPending() });
    } catch (err) {
      const pending = await this.countPending();
      if (err instanceof NetworkError) this.setStatus({ phase: "offline", pending });
      else this.setStatus({ phase: "error", pending, error: err instanceof ApiError ? err.code : "client_error" });
    }
  }

  private async countPending(): Promise<number> {
    const [outbox, deletes] = await Promise.all([this.storage.listOutbox(), this.storage.listPendingDeletes()]);
    return outbox.length + deletes.length;
  }

  private async pushDeletes(): Promise<void> {
    const ids = await this.storage.listPendingDeletes();
    for (let i = 0; i < ids.length; i += PUSH_BATCH) {
      const batch = ids.slice(i, i + PUSH_BATCH);
      // Ids the server did not delete were never pushed or are already gone; either way, done.
      await this.api.deleteEnvelopes(batch, this.signer);
      await this.storage.settleDeletes(batch);
    }
  }

  private async pushEnvelopes(): Promise<void> {
    const outbox = await this.storage.listOutbox();
    for (let i = 0; i < outbox.length; i += PUSH_BATCH) {
      const batch = outbox.slice(i, i + PUSH_BATCH);
      const result = await this.api.pushEnvelopes(batch, this.signer);
      const deletedOnServer: string[] = [];
      for (const r of result.rejected) {
        // Ids only; never the content.
        this.skip({ id: r.id, reason: r.reason });
        if (r.reason === "deleted" && r.id !== null) deletedOnServer.push(r.id);
      }
      // A rejected envelope will not succeed by retrying, so it leaves the queue too.
      await this.storage.settleOutbox(batch.map((e) => ({ id: e.id, updatedAt: e.updatedAt })));
      if (deletedOnServer.length > 0) await this.storage.applyPull({ items: [], deleted: deletedOnServer });
    }
  }

  private async pull(): Promise<void> {
    let cursor = await this.storage.getCursor();
    for (;;) {
      const page = await this.api.pull(cursor, this.signer);
      const items = this.openPage(page);
      const changed = await this.storage.applyPull({ items, deleted: page.deleted, cursor: page.cursor });
      if (changed.length > 0) this.emit();
      if (!page.more || page.cursor <= cursor) break;
      cursor = page.cursor;
    }
  }

  private openPage(page: SyncResponse): DiaryItem[] {
    const keyFor = boardKeyLookup(this.device);
    const items: DiaryItem[] = [];
    for (const envelope of page.envelopes) {
      const signer = page.devices[envelope.deviceId];
      // The signer must be a device of the stated author, and not revoked when it wrote this.
      if (!signer || signer.accountId !== envelope.authorId) {
        this.skip({ id: envelope.id, reason: "unknown_signer" });
        continue;
      }
      if (signer.revokedAt !== null && envelope.updatedAt > signer.revokedAt) {
        this.skip({ id: envelope.id, reason: "revoked_signer" });
        continue;
      }
      try {
        const opened = openEnvelope(envelope, { boardKey: keyFor, signerPublicKey: fromBase64(signer.signPublicKey) });
        items.push(itemFrom(envelope, opened.payload));
      } catch (err) {
        this.skip({ id: envelope.id, reason: err instanceof CryptoError ? err.code : "open_failed" });
      }
    }
    return items;
  }
}
