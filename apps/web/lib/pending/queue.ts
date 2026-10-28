import {
  CryptoError,
  fromBase64,
  generateReplyKeys,
  openResolverResult,
  ready,
  toBase64,
  type JsonValue,
  type ResolvedChain,
  type ResolvedPlace,
  type ResolverResult,
} from "@map-diary/crypto";
import { ApiError, NetworkError, type Api } from "@map-diary/sync";
import { EntryError, addOpinions, addPlace, findCataloguePlace, updateFacts, type DiaryWriter } from "../entries/actions";
import { isFood } from "../entries/facts";
import { branchOf, chainFor } from "../places/chains";
import type { PlaceChain } from "../places/types";
import { readPayload, type PlacePayload } from "../places/payloads";
import type { PendingDraft, PendingItem, PendingState, PendingStore, WaitingJob } from "./store";

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
    if (!q) throw new EntryError("Type a link or a name to look up.");
    const at = this.now();
    const item: PendingItem = { id: newId(), query: q, draft, createdAt: at, updatedAt: at, state: { kind: "unsent" } };
    await this.store.put(item);
    this.emit();
    return this.send(item);
  }

  /** Sends a fresh job with a fresh one-time key. Stays unsent if the network or queue is down or busy. */
  private async send(item: PendingItem): Promise<PendingItem> {
    await ready();
    const keys = generateReplyKeys();
    try {
      const job = await this.api.submitResolverJob(item.query, toBase64(keys.publicKey));
      return this.save(item, { kind: "waiting", jobId: job.id, publicKey: keys.publicKey, secretKey: keys.secretKey, expiresAt: job.expiresAt });
    } catch (err) {
      if (err instanceof NetworkError || (err instanceof ApiError && (err.status >= 500 || err.status === 429))) return item;
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
        else if (item.state.kind === "failed" && item.state.job) await this.check(item, item.state.job);
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

  /** Checks a job that is waiting, or failed but still on the server (the admin may retry it). */
  private async check(item: PendingItem, state: WaitingJob): Promise<void> {
    const failedBefore = item.state.kind === "failed";
    let job;
    try {
      job = await this.api.getResolverJob(state.jobId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        await this.save(item, { kind: "failed", reason: failedBefore && item.state.kind === "failed" ? item.state.reason : "expired" });
        return;
      }
      throw err;
    }
    if (job.status === "pending") {
      // Back in the queue after the admin retried it.
      if (failedBefore) await this.save(item, { kind: "waiting", ...state });
      return;
    }

    if (job.status === "failed" || !job.sealedResult) {
      // Kept on the server until this device moves on, so the admin can put it back in the queue.
      if (!failedBefore) await this.save(item, { kind: "failed", reason: "not_found", job: state });
      return;
    } else {
      let result: ResolverResult;
      try {
        result = openResolverResult(fromBase64(job.sealedResult), { publicKey: state.publicKey, secretKey: state.secretKey });
      } catch (err) {
        if (!(err instanceof CryptoError)) throw err;
        await this.save(item, { kind: "failed", reason: "bad_result" });
        await this.forgetJob(state.jobId);
        return;
      }
      const { candidates, chain } = result;
      // The result is on the device now; the one-time key is no longer needed. A chain always
      // asks: every outlet, or only the one the link was for. New facts for a place always ask,
      // and so does a lone match for a plain name (or a Zomato share link, which only carries
      // the name): a name can mean another place, so only a link for one place adds by itself.
      if (item.draft.refreshPlaceId) await this.save(item, { kind: "choose", candidates });
      else if (chain) await this.save(item, { kind: "choose", candidates, chain });
      else if (candidates.length === 1 && pointsAtOnePlace(item.draft.link)) await this.write(item, candidates[0]!);
      else await this.save(item, { kind: "choose", candidates });
    }
    await this.forgetJob(state.jobId);
  }

  private async forgetJob(jobId: string): Promise<void> {
    // Best effort: the server drops jobs on its own after two weeks.
    await this.api.deleteResolverJob(jobId).catch(() => undefined);
  }

  /**
   * Picks one of several matches (for a chain, one of `choicesOf`: the matches, then the
   * other outlets) and writes it to the diary. Returns the place id, or nothing when the
   * match may be another branch of a place on the map and the person is asked first.
   */
  async choose(id: string, index: number): Promise<string | undefined> {
    const item = await this.store.get(id);
    if (!item || item.state.kind !== "choose") throw new EntryError("That was already sorted out. Reload the Inbox.");
    const candidate = choicesOf(item.state)[index];
    if (!candidate) throw new EntryError("That match is gone. Reload the Inbox.");
    return this.write(item, candidate, item.state.chain);
  }

  /**
   * Adds every outlet of the chain: the match carries the status, tags and note (about every
   * outlet), and the others join it as places of the same chain.
   */
  async addAll(id: string): Promise<string> {
    const item = await this.store.get(id);
    if (!item || item.state.kind !== "choose" || !item.state.chain) throw new EntryError("That was already sorted out. Reload the Inbox.");
    const { chain } = item.state;
    const match = item.state.candidates[0]!;
    const label = chainFor(await this.diary.listItems(), chain.name);
    const { placeId, existing } = await writeResolved(this.diary, item.draft, match, label, true);
    for (const outlet of chain.outlets) await writeOutlet(this.diary, item.draft, outlet, label);
    await this.save(item, added(placeId, chain.name, existing));
    return placeId;
  }

  private async write(item: PendingItem, candidate: ResolvedPlace, chain?: ResolvedChain): Promise<string | undefined> {
    if (item.draft.refreshPlaceId) {
      const placeId = await refreshFacts(this.diary, item.draft.refreshPlaceId, candidate, item.draft.correcting === true ? item.draft.link : false);
      await this.save(item, { kind: "added", placeId, name: candidate.name });
      return placeId;
    }
    const items = await this.diary.listItems();
    let label = chain ? chainFor(items, chain.name) : undefined;
    let written: Written;
    // The resolver starts from nothing each time, so the catalogue on this device is what
    // knows a place by this name is already on the map.
    const match = label ? undefined : branchOf(items, candidate);
    if (match?.kind === "same") {
      await addDraftOpinions(this.diary, match.placeId, item.draft);
      written = { placeId: match.placeId, existing: true };
    } else if (match?.kind === "branch") {
      await this.save(item, { kind: "branch", candidate, chain: match.chain, ...(match.area ? { area: match.area } : {}) });
      return undefined;
    } else {
      written = await writeResolved(this.diary, item.draft, candidate, label);
    }
    await this.save(item, added(written.placeId, candidate.name, written.existing));
    return written.placeId;
  }

  /**
   * Answers whether the match is another branch of the place on the map with its name: if so
   * it joins that chain, so both show as one place with a row per location.
   */
  async answerBranch(id: string, isBranch: boolean): Promise<string> {
    const item = await this.store.get(id);
    if (!item || item.state.kind !== "branch") throw new EntryError("That was already sorted out. Reload the Inbox.");
    const { candidate, chain } = item.state;
    const { placeId, existing } = await writeResolved(this.diary, item.draft, candidate, isBranch ? chain : undefined);
    await this.save(item, added(placeId, candidate.name, existing));
    return placeId;
  }

  /**
   * Saves a lookup of an existing catalogue place, whose answer becomes its new facts. With
   * `correcting` the place was the wrong match: its links and chain are replaced, not kept.
   */
  async lookUpAgain(placeId: string, query: string, label: string, correcting = false): Promise<PendingItem> {
    const q = query.trim();
    return this.add(q, {
      label,
      ...(correcting && isLink(q) ? { link: q } : {}),
      status: "want",
      tagIds: [],
      newTags: [],
      comment: "",
      refreshPlaceId: placeId,
      ...(correcting ? { correcting: true as const } : {}),
    });
  }

  /**
   * Looks the item up again with a better link or name, keeping its status, tags, note and
   * boards. A wrong link is dropped, so it never becomes one of the place's source links.
   */
  async requery(id: string, query: string): Promise<void> {
    const item = await this.store.get(id);
    if (!item) throw new EntryError("That was already sorted out. Reload the Inbox.");
    const q = query.trim().slice(0, MAX_QUERY_LENGTH);
    if (!q) throw new EntryError("Type a link or a name to look up.");
    const open = jobOf(item.state);
    if (open) await this.forgetJob(open.jobId);
    const { link: _old, ...rest } = item.draft;
    // A label that was only the old query goes with it; one the person typed stays.
    const label = rest.label && rest.label !== item.query && rest.label !== item.draft.link ? rest.label : "";
    const draft: PendingDraft = { ...rest, label, ...(isLink(q) ? { link: q } : {}) };
    const next: PendingItem = { ...item, query: q, draft, state: { kind: "unsent" }, updatedAt: this.now() };
    await this.store.put(next);
    this.emit();
    await this.send(next);
  }

  /**
   * The person typed the place's details in themselves: they go into the diary like a
   * resolver's match, with the item's status, tags, note and boards. For a lookup of an
   * existing place they become its facts.
   */
  async fillIn(id: string, facts: PlacePayload): Promise<string> {
    const item = await this.store.get(id);
    if (!item) throw new EntryError("That was already sorted out. Reload the Inbox.");
    const open = jobOf(item.state);
    let placeId: string;
    let existing = false;
    if (item.draft.refreshPlaceId) {
      const place = (await this.diary.listItems()).find((i) => i.id === item.draft.refreshPlaceId && i.type === "place");
      if (!place) throw new EntryError("That place isn't on this device any more. It may have been deleted.");
      await updateFacts(this.diary, place, facts);
      placeId = place.id;
    } else {
      const written = await writeFacts(this.diary, item.draft, facts);
      placeId = written.placeId;
      existing = written.existing;
    }
    if (open) await this.forgetJob(open.jobId);
    await this.save(item, added(placeId, facts.name, existing));
    return placeId;
  }

  /** Asks the resolver again, with a new job. */
  async retry(id: string): Promise<void> {
    const item = await this.store.get(id);
    if (!item) return;
    const open = jobOf(item.state);
    if (open) await this.forgetJob(open.jobId);
    await this.send(await this.save(item, { kind: "unsent" }));
  }

  /** Drops an item, and its job if one is still open. */
  async dismiss(id: string): Promise<void> {
    const item = await this.store.get(id);
    if (!item) return;
    const open = jobOf(item.state);
    if (open) await this.forgetJob(open.jobId);
    await this.store.delete(id);
    this.emit();
  }
}

/** Whether text is a link rather than a name. */
function isLink(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}

/**
 * A link for one place, whose lone match can be added without asking. A Zomato share link
 * (zomato.onelink.me) only gives the resolver the restaurant's name, so it asks like a name.
 */
export function pointsAtOnePlace(link: string | undefined): boolean {
  if (!link) return false;
  try {
    return new URL(link).hostname.toLowerCase() !== "zomato.onelink.me";
  } catch {
    return false;
  }
}

/** The job still open on the server for an item, if any. */
function jobOf(state: PendingState): WaitingJob | undefined {
  if (state.kind === "waiting") return state;
  if (state.kind === "failed") return state.job;
  return undefined;
}

/**
 * Rewrites a catalogue place's facts from a fresh lookup (the admin's device, or the person who
 * added it while they may still correct it). The place keeps its chain, its merged duplicates
 * and every link it had, unless `correcting` (the link that found the right place, or
 * undefined for a name) says the place was the wrong match: then the new facts start over.
 */
export async function refreshFacts(w: DiaryWriter, placeId: string, c: ResolvedPlace, correcting: string | undefined | false = false): Promise<string> {
  const item = (await w.listItems()).find((i) => i.id === placeId && i.type === "place");
  const current = item && readPayload("place", item.payload);
  if (!item || !current) throw new EntryError("That place isn't on this device any more. It may have been deleted.");
  const base: PendingDraft = { label: current.name, status: "want", tagIds: [], newTags: [], comment: "" };
  const kept = current.mergedFrom ? { mergedFrom: current.mergedFrom } : {};
  let facts: PlacePayload;
  if (correcting === false) {
    const fresh = factsFromCandidate(base, c, current.chain);
    facts = { ...fresh, sourceLinks: [...new Set([...current.sourceLinks, ...fresh.sourceLinks])], ...kept };
  } else {
    facts = { ...factsFromCandidate({ ...base, ...(correcting ? { link: correcting } : {}) }, c), ...kept };
  }
  if (!readPayload("place", facts as unknown as JsonValue)) throw new EntryError("That match is missing a name or a location, so it can't be added. Try looking it up again.");
  await w.write({ type: "place", placeId: null, payload: facts as unknown as JsonValue, id: placeId });
  return placeId;
}

/** What the person can pick from: the matches, then a chain's other outlets. */
export function choicesOf(state: { candidates: ResolvedPlace[]; chain?: ResolvedChain }): ResolvedPlace[] {
  return [...state.candidates, ...(state.chain?.outlets ?? [])];
}

/** The place facts for a match, with the person's own link and category choice kept. */
export function factsFromCandidate(draft: PendingDraft, c: ResolvedPlace, chain?: PlaceChain): PlacePayload {
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
  if (chain) facts.chain = { ...chain };
  return facts;
}

/**
 * Writes a found place with the draft's status, tags and note. If the diary already has the
 * place (same source link), the opinions go on it instead and its facts are left alone.
 * `chain` labels it as an outlet; `allOutlets` makes the note about every outlet.
 */
export async function writeResolved(w: DiaryWriter, draft: PendingDraft, c: ResolvedPlace, chain?: PlaceChain, allOutlets = false): Promise<Written> {
  const facts = factsFromCandidate(draft, c, chain);
  if (!readPayload("place", facts as unknown as JsonValue)) throw new EntryError("That match is missing a name or a location, so it can't be added. Try looking it up again.");
  return writeFacts(w, draft, facts, allOutlets);
}

/**
 * Writes a catalogue place from its facts with the draft's status, tags and note, or puts them
 * on the place the catalogue already has with one of its links.
 */
export async function writeFacts(w: DiaryWriter, draft: PendingDraft, facts: PlacePayload, allOutlets = false): Promise<Written> {
  const existing = await findCataloguePlace(w, facts.sourceLinks);
  if (!existing) {
    const placeId = await addPlace(w, {
      kind: "place",
      facts,
      status: draft.status,
      tagIds: draft.tagIds,
      newTags: draft.newTags,
      comment: draft.comment,
      ...(allOutlets ? { commentAllOutlets: true } : {}),
      ...boardsOf(draft),
    });
    return { placeId, existing: false };
  }

  await addDraftOpinions(w, existing, draft, allOutlets);
  return { placeId: existing, existing: true };
}

/** Where a match went: a new place, or one already in the diary that got the draft's notes. */
export interface Written {
  placeId: string;
  existing: boolean;
}

/** The Inbox state of a match written to the diary. */
const added = (placeId: string, name: string, existing: boolean): PendingState => ({ kind: "added", placeId, name, ...(existing ? { existing: true as const } : {}) });

/** Puts the draft's status, tags and note on a place already in the diary. */
async function addDraftOpinions(w: DiaryWriter, placeId: string, draft: PendingDraft, allOutlets = false): Promise<void> {
  await addOpinions(w, placeId, {
    status: draft.status,
    tagIds: draft.tagIds,
    newTags: draft.newTags,
    comment: draft.comment,
    ...(allOutlets ? { commentAllOutlets: true } : {}),
    ...boardsOf(draft),
  });
}

/**
 * Writes another outlet of a chain as a catalogue place, with no opinions: the chain's
 * status and tags cover it. An outlet the catalogue already has is left as it is.
 */
export async function writeOutlet(w: DiaryWriter, draft: PendingDraft, c: ResolvedPlace, chain: PlaceChain): Promise<string> {
  // The person's link is for the match, not this outlet.
  const { link: _link, ...rest } = draft;
  const facts = factsFromCandidate(rest, c, chain);
  if (!readPayload("place", facts as unknown as JsonValue)) throw new EntryError("One of the outlets is missing a name or a location, so it can't be added.");
  const existing = await findCataloguePlace(w, facts.sourceLinks);
  if (existing) return existing;
  return (await w.write({ type: "place", placeId: null, payload: facts as unknown as JsonValue })).id;
}

const boardsOf = (draft: PendingDraft) => ({
  ...(draft.boards ? { boards: draft.boards } : {}),
  ...(draft.tagBoards ? { tagBoards: draft.tagBoards } : {}),
  ...(draft.commentBoards ? { commentBoards: draft.commentBoards } : {}),
});
