import {
  CryptoError,
  fromBase64,
  openAccountTransfer,
  openEnvelope,
  ready,
  sealEnvelope,
  type Envelope,
  type BoardKey,
  type EnvelopeType,
  type JsonValue,
} from "@map-diary/crypto";
import { ApiError, NetworkError, type Api, type BoardState, type Signer, type SyncResponse } from "./api";
import { boardKeyLookup, currentBoardKey, mergeBoardKeys, openBoardKeys, type DeviceState } from "./device";
import { rotateGroupKey } from "./groups";
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
  /** Error code of the last failed round, for example `device_revoked` once another device removed this one. */
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
  /**
   * The boards to post it to. Defaults to the item's current boards when rewriting one, and
   * to the Personal board for a new item.
   */
  boards?: readonly string[];
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
  /** Items refused for a replaced key version, waiting to be re-sealed. */
  private readonly stale: string[] = [];
  /** Set when a pull collected a newer account key, so stale items can be re-sealed. */
  private keysCollected = false;
  /** Set when this device gained a board, so the next round pulls everything again to fetch its past items. */
  private rewind = false;

  private current: DeviceState;

  constructor(
    device: DeviceState,
    private readonly storage: DiaryStorage,
    private readonly api: Api,
  ) {
    this.current = device;
  }

  /** This device's keys. They change when another device of the account revokes a device. */
  get device(): DeviceState {
    return this.current;
  }

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
    const prior = input.id === undefined ? undefined : await this.storage.getItem(input.id);
    const boardIds = input.boards ?? prior?.boardIds ?? [this.device.personalBoardId];
    const boards = this.keysFor(boardIds);
    if (boards.length === 0 || (input.boards !== undefined && boards.length !== new Set(input.boards).size)) {
      throw new Error("This device has no key for one of the chosen boards");
    }

    let createdAt: number | undefined;
    let updatedAt: number | undefined;
    if (input.id !== undefined) {
      if (!prior) throw new Error("No such item on this device");
      if (prior.authorId !== this.device.accountId) throw new Error("Only the author can change an item");
      if (prior.type !== input.type || prior.placeId !== input.placeId) {
        throw new Error("An item's type and place cannot change");
      }
      createdAt = prior.createdAt;
      // Strictly newer than the last version, even if this clock runs behind another device's.
      updatedAt = Math.max(Date.now(), prior.updatedAt + 1);
    }

    const item = await this.sealLocal(input, boards, createdAt, updatedAt);
    this.emit();
    void this.sync();
    return item;
  }

  /** The newest key of each board this device holds, skipping boards it has none for (ones it left). */
  private keysFor(boardIds: readonly string[]): BoardKey[] {
    const keys: BoardKey[] = [];
    for (const id of new Set(boardIds)) {
      const key = currentBoardKey(this.device, id);
      if (key) keys.push(key);
    }
    return keys;
  }

  /** Board ids this device holds a key for. */
  heldBoards(): string[] {
    return [...new Set(this.device.boardKeys.map((k) => k.boardId))];
  }

  /** Adds board keys this device just made or received (a new group, an accepted invite), and saves them. */
  async adoptBoardKeys(keys: readonly BoardKey[]): Promise<void> {
    const held = new Set(this.heldBoards());
    if (keys.some((k) => !held.has(k.boardId))) this.rewind = true;
    const device: DeviceState = { ...this.current, boardKeys: mergeBoardKeys(this.current.boardKeys, keys) };
    await this.storage.saveDevice(device);
    this.current = device;
    this.keysCollected = true;
    this.emit();
  }

  /**
   * Forgets boards the account is no longer in (it left or was removed from a group): their
   * keys, and every item this device could see only through them.
   */
  async forgetBoards(boardIds: readonly string[]): Promise<void> {
    const gone = new Set(boardIds);
    if (gone.size === 0) return;
    const device: DeviceState = { ...this.current, boardKeys: this.current.boardKeys.filter((k) => !gone.has(k.boardId)) };
    await this.storage.saveDevice(device);
    this.current = device;
    const held = new Set(this.heldBoards());
    const unreadable = (await this.storage.listItems())
      .filter((i) => i.authorId !== device.accountId && !i.boardIds.some((b) => held.has(b)))
      .map((i) => i.id);
    if (unreadable.length > 0) await this.storage.applyPull({ items: [], deleted: unreadable });
    this.emit();
  }

  private async sealLocal(input: WriteInput, boards: readonly BoardKey[], createdAt?: number, updatedAt?: number): Promise<DiaryItem> {
    const envelope = sealEnvelope({
      type: input.type,
      authorId: this.device.accountId,
      deviceId: this.device.deviceId,
      placeId: input.placeId,
      payload: input.payload,
      boards,
      signSecretKey: this.device.identity.signSecretKey,
      ...(input.id === undefined ? {} : { id: input.id }),
      ...(createdAt === undefined ? {} : { createdAt }),
      ...(updatedAt === undefined ? {} : { updatedAt }),
    });
    const item = itemFrom(envelope, input.payload);
    await this.storage.writeLocal(item, envelope);
    return item;
  }

  /**
   * Re-seals this device's items that the Worker refused because they were sealed with a key
   * version a revocation has since replaced. Runs after a pull has collected the new keys.
   */
  private async resealStale(): Promise<void> {
    const ids = this.stale.splice(0);
    // Without a newer key, sealing again would be refused again.
    if (!this.keysCollected) {
      for (const id of ids) this.skip({ id, reason: "stale_key" });
      return;
    }
    this.keysCollected = false;
    let resealed = false;
    for (const id of ids) {
      const item = await this.storage.getItem(id);
      if (!item || item.authorId !== this.device.accountId) continue;
      const boards = this.keysFor(item.boardIds);
      if (boards.length === 0) {
        this.skip({ id, reason: "stale_key" });
        continue;
      }
      // One past the refused version, so settling that one does not drop this from the outbox.
      await this.sealLocal(
        { type: item.type, placeId: item.placeId, payload: item.payload, id: item.id },
        boards,
        item.createdAt,
        item.updatedAt + 1,
      );
      resealed = true;
    }
    if (resealed) this.again = true;
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
      if (this.rewind) {
        this.rewind = false;
        await this.storage.applyPull({ items: [], deleted: [], cursor: 0 });
        this.again = true;
      }
      if (this.stale.length > 0) await this.resealStale();
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
        if (r.reason === "stale_key" && r.id !== null) {
          this.stale.push(r.id);
          continue;
        }
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
      // Another device moved the account to new keys: collect them before opening anything.
      if (page.boxKeyVersion > this.current.accountBox.version) await this.collectAccountKey();
      if (page.boards) await this.reconcileBoards(page.boards);
      const items = this.openPage(page);
      const changed = await this.storage.applyPull({ items, deleted: page.deleted, cursor: page.cursor });
      if (changed.length > 0) this.emit();
      if (!page.more || page.cursor <= cursor) break;
      cursor = page.cursor;
    }
  }

  /**
   * Brings this device's board keys in line with the boards the account is in: collects keys
   * for boards it joined or that moved to a new key (on another device, or by another member),
   * forgets boards it left, and rotates any group a member left, since the leaver must not.
   */
  private async reconcileBoards(boards: readonly BoardState[]): Promise<void> {
    if (JSON.stringify(boards) !== JSON.stringify(this.current.boards ?? [])) {
      const device: DeviceState = { ...this.current, boards: [...boards] };
      await this.storage.saveDevice(device);
      this.current = device;
      this.emit();
    }
    const held = new Set(this.heldBoards());
    const listed = new Set(boards.map((b) => b.id));
    const left = [...held].filter((id) => !listed.has(id));
    if (left.length > 0) await this.forgetBoards(left);

    for (const b of boards) {
      if (b.kind !== "group" || !b.rotationDue) continue;
      try {
        const key = await rotateGroupKey(this.api, this.current, b.id);
        await this.adoptBoardKeys([key]);
      } catch (err) {
        // Another member's device rotated it first; the refresh below picks up their key.
        if (err instanceof NetworkError) throw err;
      }
    }

    const lookup = boardKeyLookup(this.current);
    if (boards.every((b) => lookup(b.id, b.keyVersion) !== undefined)) return;
    const me = await this.api.me(this.signer);
    const opened = openBoardKeys(me, this.current.accountBox);
    if (opened.length > 0) await this.adoptBoardKeys(opened);
  }

  /**
   * Opens the new account box key that the revoking device sealed to this device, then the
   * board keys wrapped to it, and stores the result.
   */
  private async collectAccountKey(): Promise<void> {
    const { version, sealedKey } = await this.api.accountKey(this.signer);
    const transfer = openAccountTransfer(sealedKey, this.current.identity);
    if (transfer.accountId !== this.current.accountId || transfer.accountBox.version !== version) {
      throw new CryptoError("decrypt_failed", "The account key does not belong to this account");
    }
    const me = await this.api.me(this.signer);
    const device: DeviceState = {
      ...this.current,
      accountBox: transfer.accountBox,
      boardKeys: mergeBoardKeys(this.current.boardKeys, openBoardKeys(me, transfer.accountBox)),
    };
    await this.storage.saveDevice(device);
    this.current = device;
    this.keysCollected = true;
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
