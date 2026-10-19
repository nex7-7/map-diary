import {
  CryptoError,
  fromBase64,
  generateReplyKeys,
  openResolverResult,
  ready,
  toBase64,
  type JsonValue,
  type ResolvedPlace,
} from "@map-diary/crypto";
import { ApiError, NetworkError, type Api } from "@map-diary/sync";
import { addOpinions, addPlace, findCataloguePlace, type DiaryWriter } from "../entries/actions";
import { isFood } from "../entries/facts";
import { readPayload, type PlacePayload } from "../places/payloads";
import type { PendingDraft, PendingItem, PendingState, PendingStore } from "./store";

/** The resolver calls this needs; they are never signed, so no account is tied to a job. */
export type ResolverApi = Pick<Api, "submitResolverJob" | "getResolverJob" | "deleteResolverJob">;

/** The longest query the queue accepts. */
export const MAX_QUERY_LENGTH = 1000;
/** Found places stay in the Inbox this long, so the person sees what came in. */
export const ADDED_KEEP_MS = 3 * 24 * 60 * 60 * 1000;

const newId = () => crypto.randomUUID();

/**
 * Places waiting for the resolver, on this device. `add` saves first and sends after, so a
 * place is never lost to a bad connection; `poll` sends what is unsent, collects results,
 * writes single matches to the diary and leaves several for the person to pick from.
 */
export class PendingQueue {
  private readonly listeners = new Set<() => void>();
  private polling: Promise<void> | null = null;

  constructor(
    private readonly store: PendingStore,
    private readonly api: ResolverApi,
    private readonly diary: DiaryWriter,
    private readonly now: () => number = Date.now,
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  async list(): Promise<PendingItem[]> {
    return (await this.store.list()).sort((a, b) => b.createdAt - a.createdAt);
  }

  private async save(item: PendingItem, state: PendingState): Promise<PendingItem> {
    // Dismissed while a call was in flight: leave it gone.
    if (!(await this.store.get(item.id))) return item;
    const next = { ...item, state, updatedAt: this.now() };
    await this.store.put(next);
    this.emit();
    return next;
  }

  /** Saves a place to find later and sends its job. Returns the saved item. */
  async add(query: string, draft: PendingDraft): Promise<PendingItem> {
    const q = query.trim().slice(0, MAX_QUERY_LENGTH);
    if (!q) throw new Error("Nothing to look up");
    const at = this.now();
    const item: PendingItem = { id: newId(), query: q, draft, createdAt: at, updatedAt: at, state: { kind: "unsent" } };
    await this.store.put(item);
    this.emit();
    return this.send(item);
  }

  /** Sends a fresh job with a fresh one-time key. Stays unsent if the network or queue is down. */
  private async send(item: PendingItem): Promise<PendingItem> {
    await ready();
    const keys = generateReplyKeys();
    try {
      const job = await this.api.submitResolverJob(item.query, toBase64(keys.publicKey));
      return this.save(item, { kind: "waiting", jobId: job.id, publicKey: keys.publicKey, secretKey: keys.secretKey, expiresAt: job.expiresAt });
    } catch (err) {
      if (err instanceof NetworkError || (err instanceof ApiError && err.status >= 500)) return item;
      if (err instanceof ApiError && err.status === 400) return this.save(item, { kind: "failed", reason: "rejected" });
      throw err;
    }
  }

  /** One pass over every item. Calls made while a pass runs share it. */
  poll(): Promise<void> {
    this.polling ??= this.pollOnce().finally(() => (this.polling = null));
    return this.polling;
  }

  private async pollOnce(): Promise<void> {
    for (const item of await this.store.list()) {
      try {
        if (item.state.kind === "unsent") await this.send(item);
        else if (item.state.kind === "waiting") await this.check(item, item.state);
        else if (item.state.kind === "added" && this.now() - item.updatedAt > ADDED_KEEP_MS) {
          await this.store.delete(item.id);
          this.emit();
        }
      } catch (err) {
        // A network blip leaves the item as it is for the next pass.
        if (!(err instanceof NetworkError)) throw err;
      }
    }
  }

  private async check(item: PendingItem, state: Extract<PendingState, { kind: "waiting" }>): Promise<void> {
    let job;
    try {
      job = await this.api.getResolverJob(state.jobId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        await this.save(item, { kind: "failed", reason: "expired" });
        return;
      }
      throw err;
    }
    if (job.status === "pending") return;

    if (job.status === "failed" || !job.sealedResult) {
      await this.save(item, { kind: "failed", reason: "not_found" });
    } else {
      let candidates: ResolvedPlace[];
      try {
        candidates = openResolverResult(fromBase64(job.sealedResult), { publicKey: state.publicKey, secretKey: state.secretKey }).candidates;
      } catch (err) {
        if (!(err instanceof CryptoError)) throw err;
        await this.save(item, { kind: "failed", reason: "bad_result" });
        await this.forgetJob(state.jobId);
        return;
      }
      // The result is on the device now; the one-time key is no longer needed.
      if (candidates.length === 1) await this.write(item, candidates[0]!);
      else await this.save(item, { kind: "choose", candidates });
    }
    await this.forgetJob(state.jobId);
  }

  private async forgetJob(jobId: string): Promise<void> {
    // Best effort: the server drops jobs on its own after two weeks.
    await this.api.deleteResolverJob(jobId).catch(() => undefined);
  }

  /** Picks one of several matches and writes it to the diary. Returns the place id. */
  async choose(id: string, index: number): Promise<string> {
    const item = await this.store.get(id);
    if (!item || item.state.kind !== "choose") throw new Error("Nothing to choose here");
    const candidate = item.state.candidates[index];
    if (!candidate) throw new Error("No such match");
    return this.write(item, candidate);
  }

  private async write(item: PendingItem, candidate: ResolvedPlace): Promise<string> {
    const placeId = await writeResolved(this.diary, item.draft, candidate);
    await this.save(item, { kind: "added", placeId, name: candidate.name });
    return placeId;
  }

  /** Asks the resolver again, with a new job. */
  async retry(id: string): Promise<void> {
    const item = await this.store.get(id);
    if (!item) return;
    if (item.state.kind === "waiting") await this.forgetJob(item.state.jobId);
    await this.send(await this.save(item, { kind: "unsent" }));
  }

  /** Drops an item, and its job if one is still open. */
  async dismiss(id: string): Promise<void> {
    const item = await this.store.get(id);
    if (!item) return;
    if (item.state.kind === "waiting") await this.forgetJob(item.state.jobId);
    await this.store.delete(id);
    this.emit();
  }
}

/** The place facts for a match, with the person's own link and category choice kept. */
export function factsFromCandidate(draft: PendingDraft, c: ResolvedPlace): PlacePayload {
  const category = draft.category ?? c.category;
  const facts: PlacePayload = {
    name: c.name,
    category,
    location: { lng: c.location.lng, lat: c.location.lat },
    sourceLinks: [...new Set([...(draft.link ? [draft.link] : []), ...c.sourceLinks])],
  };
  if (c.address) facts.address = c.address;
  if (c.cuisine) facts.cuisine = c.cuisine;
  if (c.signatureDish && isFood(category)) facts.signatureDish = { ...c.signatureDish };
  return facts;
}

/**
 * Writes a found place with the draft's status, tags and note. If the diary already has the
 * place (same source link), the opinions go on it instead and its facts are left alone.
 */
export async function writeResolved(w: DiaryWriter, draft: PendingDraft, c: ResolvedPlace): Promise<string> {
  const facts = factsFromCandidate(draft, c);
  if (!readPayload("place", facts as unknown as JsonValue)) throw new Error("The match doesn't fit a place");

  const existing = await findCataloguePlace(w, facts.sourceLinks);
  if (!existing) {
    return addPlace(w, {
      kind: "place",
      facts,
      status: draft.status,
      tagIds: draft.tagIds,
      newTags: draft.newTags,
      comment: draft.comment,
      ...(draft.boards ? { boards: draft.boards } : {}),
    });
  }

  const placeId = existing;
  await addOpinions(w, placeId, {
    status: draft.status,
    tagIds: draft.tagIds,
    newTags: draft.newTags,
    comment: draft.comment,
    ...(draft.boards ? { boards: draft.boards } : {}),
  });
  return placeId;
}
