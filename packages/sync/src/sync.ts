import {
  CryptoError,
  fromBase64,
  linkHash,
  openAccountTransfer,
  openEnvelope,
  ready,
  sealEnvelope,
  toBase64,
  type Envelope,
  type BoardKey,
  type EnvelopeType,
  type JsonValue,
} from "@map-diary/crypto";
import { ApiError, NetworkError, type Api, type Signer, type SyncResponse } from "./api";
import { ensureMasterBoard, keysBehind, linkHashKeyOf, masterBoardOf, refreshKeyRing, writeKey } from "./boards";
import { boardKeyLookup, boardsFrom, mergeBoardKeys, openBoardKeys, type BoardInfo, type DeviceState } from "./device";
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
   * The boards to post it to. Defaults to the item's current boards for an edit and the
   * Personal board for a new item. A catalogue place always goes to the master board alone,
   * and a dropped pin never does.
   */
  boards?: readonly string[];
}

export interface DiaryOptions {
  /**
   * The normalised source links of a place payload, for the catalogue's duplicate check.
   * Without it, places are pushed with no link hashes.
   */
  placeLinks?: (payload: JsonValue) => string[];
}

/** An item the Worker refused for its boards, and the key versions it was sealed with. */
interface Refused {
  id: string;
  versions: Map<string, number>;
}

type Listener = () => void;

function itemFrom(envelope: Envelope, payload: JsonValue, viaClaude = false): DiaryItem {
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
    ...(viaClaude ? { viaClaude: true as const } : {}),
  };
}

/**
 * The device's diary: a local store that is always readable, and a sync loop that pushes
 * local writes and pulls changes. Writes land locally first and sync in the background.
 * Each round first brings the board key ring up to date (and, on the admin's device,
 * creates the master board and moves the admin's places onto it).
 */
export class Diary {
  private readonly listeners = new Set<Listener>();
  private status: SyncStatus = { phase: "idle", lastSyncedAt: null, pending: 0, error: null };
  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly skippedLog: SkippedEnvelope[] = [];
  /** Items refused for a replaced key version or the wrong boards, waiting to be re-sealed. */
  private readonly stale: Refused[] = [];
  /** False until this run has fetched the board key ring; set again when a pull sees it is behind. */
  private ringLoaded = false;
  private ringStale = false;
  /** Set when this device gained a board, so the next round pulls everything again to fetch its past items. */
  private rewind = false;

  private current: DeviceState;

  constructor(
    device: DeviceState,
    private readonly storage: DiaryStorage,
    private readonly api: Api,
    private readonly options: DiaryOptions = {},
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

  /** The boards the account is in, as last fetched; the Personal board alone before the first sync. */
  get boards(): BoardInfo[] {
    return this.device.boards ?? [{ id: this.device.personalBoardId, kind: "personal", keyVersion: 1 }];
  }

  /** Encrypts and saves an item on this device, then syncs it. Returns the stored item. */
  async write(input: WriteInput): Promise<DiaryItem> {
    await ready();
    let createdAt: number | undefined;
    let updatedAt: number | undefined;
    let boardIds = input.boards;
    if (input.id !== undefined) {
      const prior = await this.storage.getItem(input.id);
      if (!prior) throw new Error("No such item on this device");
      // The admin may rewrite any catalogue place's facts; the place then counts as theirs.
      const adminFacts = this.device.isAdmin === true && prior.type === "place";
      if (prior.authorId !== this.device.accountId && !adminFacts) throw new Error("Only the author can change an item");
      if (prior.type !== input.type || prior.placeId !== input.placeId) {
        throw new Error("An item's type and place cannot change");
      }
      createdAt = prior.createdAt;
      // Strictly newer than the last version, even if this clock runs behind another device's.
      updatedAt = Math.max(Date.now(), prior.updatedAt + 1);
      boardIds ??= prior.boardIds;
    }

    const item = await this.sealLocal(input, this.boardKeysFor(input.type, boardIds), createdAt, updatedAt);
    this.emit();
    void this.sync();
    return item;
  }

  /** The current keys of the boards an item goes to, after the catalogue rules. */
  private boardKeysFor(type: EnvelopeType, requested: readonly string[] | undefined): BoardKey[] {
    const master = masterBoardOf(this.device);
    const personal = this.device.personalBoardId;
    let ids: string[];
    if (type === "place") {
      // Before this device has the master key, a place waits on the Personal board and moves later.
      ids = [master?.id ?? personal];
    } else {
      ids = [...new Set(requested && requested.length > 0 ? requested : [personal])];
      // A board the account has left (a group) drops out of an edited item's boards.
      const known = this.device.boards;
      if (known) ids = ids.filter((id) => id === personal || known.some((b) => b.id === id));
      if (type === "private_place") ids = ids.filter((id) => id !== master?.id);
      if (ids.length === 0) ids = [personal];
    }
    return ids.map((id) => {
      const key = writeKey(this.device, id);
      if (!key) throw new Error("This device has no key for that board");
      return key;
    });
  }

  private async sealLocal(input: WriteInput, boards: BoardKey[], createdAt?: number, updatedAt?: number): Promise<DiaryItem> {
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
   * version a rotation has since replaced, or (for a place) to a board the catalogue rules no
   * longer allow. Runs after the round has brought the key ring up to date.
   */
  private async resealStale(): Promise<void> {
    const refused = this.stale.splice(0);
    let resealed = false;
    for (const r of refused) {
      const item = await this.storage.getItem(r.id);
      if (!item || item.authorId !== this.device.accountId) continue;
      let boards: BoardKey[];
      try {
        boards = this.boardKeysFor(item.type, item.boardIds);
      } catch {
        this.skip({ id: r.id, reason: "stale_key" });
        continue;
      }
      // Sealing to the same board versions again would be refused again.
      const same = boards.length === r.versions.size && boards.every((b) => r.versions.get(b.boardId) === b.version);
      if (same) {
        this.skip({ id: r.id, reason: "stale_key" });
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

  /**
   * Brings the key ring up to date when this run has not fetched it yet or a pull found it
   * behind; on the admin's device, also creates the master board and moves the admin's own
   * places onto it.
   */
  private async maintainBoards(): Promise<void> {
    if (this.ringLoaded && !this.ringStale) return;
    const before = this.current.boards;
    let fetched = await refreshKeyRing(this.api, this.current);
    if (before) {
      const now = new Set((fetched.boards ?? []).map((b) => b.id));
      const gone = new Set(before.filter((b) => !now.has(b.id)).map((b) => b.id));
      if (gone.size > 0) {
        // The refreshed ring still carries this device's old keys for those boards.
        fetched = { ...fetched, boardKeys: fetched.boardKeys.filter((k) => !gone.has(k.boardId)) };
        this.current = fetched;
        await this.forgetBoards([...gone]);
      }
      if ((fetched.boards ?? []).some((b) => !before.some((p) => p.id === b.id))) this.rewind = true;
    }
    // A refusal here must not stop the diary syncing; the next round tries again.
    const device = await ensureMasterBoard(this.api, fetched).catch((err: unknown) => {
      if (err instanceof NetworkError) throw err;
      return fetched;
    });
    await this.storage.saveDevice(device);
    this.current = device;
    this.ringLoaded = true;
    this.ringStale = false;
    if (device.isAdmin) await this.movePlacesToMaster();
    await this.rotateDueGroups();
    this.emit();
  }

  /**
   * A member left a group, and the leaver must not pick its next key, so a remaining member's
   * device moves it to a new one. If another member's device got there first, this one picks
   * up their key on the next refresh.
   */
  private async rotateDueGroups(): Promise<void> {
    for (const b of this.current.boards ?? []) {
      if (b.kind !== "group" || !b.rotationDue) continue;
      try {
        const key = await rotateGroupKey(this.api, this.current, b.id);
        await this.adoptBoardKeys([key]);
      } catch (err) {
        if (err instanceof NetworkError) throw err;
      }
      this.ringStale = true;
      this.again = true;
    }
  }

  /**
   * Adds board keys this device just made or received (a new group, an accepted invite, a
   * rotation it did), and saves them. A board not seen before is pulled again from the start.
   */
  async adoptBoardKeys(keys: readonly BoardKey[], kind: BoardInfo["kind"] = "group"): Promise<void> {
    const boards = [...(this.current.boards ?? [])];
    for (const k of keys) {
      const i = boards.findIndex((b) => b.id === k.boardId);
      if (i < 0) {
        boards.push({ id: k.boardId, kind, keyVersion: k.version });
        this.rewind = true;
      } else if (boards[i]!.keyVersion < k.version) {
        boards[i] = { ...boards[i]!, keyVersion: k.version, rotationDue: false };
      }
    }
    const device: DeviceState = { ...this.current, boards, boardKeys: mergeBoardKeys(this.current.boardKeys, keys) };
    await this.storage.saveDevice(device);
    this.current = device;
    this.ringStale = true;
    this.emit();
  }

  /**
   * Forgets boards the account is no longer in (it left or was removed from a group): their
   * keys, and every item this device could see only through them.
   */
  async forgetBoards(boardIds: readonly string[]): Promise<void> {
    const gone = new Set(boardIds);
    if (gone.size === 0) return;
    const device: DeviceState = {
      ...this.current,
      boardKeys: this.current.boardKeys.filter((k) => !gone.has(k.boardId)),
      ...(this.current.boards ? { boards: this.current.boards.filter((b) => !gone.has(b.id)) } : {}),
    };
    await this.storage.saveDevice(device);
    this.current = device;
    const held = new Set(device.boardKeys.map((k) => k.boardId));
    const unreadable = (await this.storage.listItems())
      .filter((i) => i.authorId !== device.accountId && !i.boardIds.some((b) => held.has(b)))
      .map((i) => i.id);
    if (unreadable.length > 0) await this.storage.applyPull({ items: [], deleted: unreadable });
    this.emit();
  }

  /**
   * Places written before the master board existed sit on the Personal board. The admin's
   * device re-seals its own onto the master board, where the catalogue lives.
   */
  private async movePlacesToMaster(): Promise<void> {
    const master = masterBoardOf(this.device);
    if (!master) return;
    const boards = this.boardKeysFor("place", undefined);
    for (const item of await this.storage.listItems()) {
      if (item.type !== "place" || item.authorId !== this.device.accountId) continue;
      if (item.boardIds.length === 1 && item.boardIds[0] === master.id) continue;
      await this.sealLocal(
        { type: item.type, placeId: item.placeId, payload: item.payload, id: item.id },
        boards,
        item.createdAt,
        Math.max(Date.now(), item.updatedAt + 1),
      );
    }
  }

  /**
   * The catalogue place that already has one of these normalised source links, if any. Asks
   * the Worker with keyed hashes, so it also finds places this device has not synced yet.
   * Returns null without the master board.
   */
  async findCataloguePlace(links: readonly string[]): Promise<string | null> {
    await ready();
    const key = linkHashKeyOf(this.device);
    const clean = [...new Set(links.filter((l) => l.length > 0))];
    if (!key || clean.length === 0 || !masterBoardOf(this.device)) return null;
    const { matches } = await this.api.checkPlaceLinks(
      clean.map((l) => toBase64(linkHash(key, l))),
      this.signer,
    );
    return matches[0]?.placeId ?? null;
  }

  /** Deletes one of this account's items everywhere (on the admin's device, any catalogue place). */
  async remove(id: string): Promise<void> {
    const prior = await this.storage.getItem(id);
    const adminPlace = this.device.isAdmin === true && prior?.type === "place";
    if (prior && prior.authorId !== this.device.accountId && !adminPlace) throw new Error("Only the author can delete an item");
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
      await this.maintainBoards();
      await this.pushDeletes();
      await this.pushEnvelopes();
      await this.pull();
      if (this.stale.length > 0) this.ringStale = true;
      await this.maintainBoards();
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
      const result = await this.api.pushEnvelopes(batch, this.signer, await this.linkHashes(batch));
      const deletedOnServer: string[] = [];
      for (const r of result.rejected) {
        // Ids only; never the content.
        if ((r.reason === "stale_key" || r.reason === "place_not_on_master") && r.id !== null) {
          const sent = batch.find((e) => e.id === r.id);
          this.stale.push({ id: r.id, versions: new Map(sent?.boards.map((b) => [b.boardId, b.keyVersion]) ?? []) });
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

  /** Keyed hashes of each catalogue place's source links, so the Worker can block duplicates. */
  private async linkHashes(batch: readonly Envelope[]): Promise<Record<string, string[]>> {
    const out: Record<string, string[]> = {};
    const key = linkHashKeyOf(this.device);
    const master = masterBoardOf(this.device);
    if (!key || !master || !this.options.placeLinks) return out;
    for (const e of batch) {
      if (e.type !== "place" || !e.boards.some((b) => b.boardId === master.id)) continue;
      const item = await this.storage.getItem(e.id);
      if (!item) continue;
      const links = [...new Set(this.options.placeLinks(item.payload).filter((l) => l.length > 0))].slice(0, 10);
      out[e.id] = links.map((l) => toBase64(linkHash(key, l)));
    }
    return out;
  }

  private async pull(): Promise<void> {
    let cursor = await this.storage.getCursor();
    for (;;) {
      const page = await this.api.pull(cursor, this.signer);
      // Another device moved the account to new keys: collect them before opening anything.
      if (page.boxKeyVersion > this.current.accountBox.version) await this.collectAccountKey();
      // Someone rotated a board key, added the account to a board or took it off one, a group's
      // members changed, or a group waits for a new key: fetch the ring first.
      if (keysBehind(this.current, page.boards ?? []) || this.boardsChanged(page.boards)) {
        this.ringStale = true;
        await this.maintainBoards();
      }
      const items = this.openPage(page);
      const changed = await this.storage.applyPull({ items, deleted: page.deleted, cursor: page.cursor });
      if (changed.length > 0) this.emit();
      if (!page.more || page.cursor <= cursor) break;
      cursor = page.cursor;
    }
  }

  private boardsChanged(listed: SyncResponse["boards"] | undefined): boolean {
    if (!listed) return false;
    const key = (bs: readonly BoardInfo[]) => JSON.stringify([...bs].sort((a, b) => (a.id < b.id ? -1 : 1)));
    return key(boardsFrom(listed)) !== key(this.current.boards ?? []);
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
    this.ringStale = true;
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
        items.push(itemFrom(envelope, opened.payload, signer.kind === "claude"));
      } catch (err) {
        this.skip({ id: envelope.id, reason: err instanceof CryptoError ? err.code : "open_failed" });
      }
    }
    return items;
  }
}
