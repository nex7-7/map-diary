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
import { EntryError, addOpinions, addPlace, findCataloguePlace, findLocalPlace, updateFacts, type DiaryWriter } from "../entries/actions";
import { addOutlet } from "../entries/outlet";
import { parseLink } from "../entries/parse-input";
import { isFood } from "../entries/facts";
import { branchOf, chainFor, knownByName, type KnownPlace } from "../places/chains";
import type { Category, PlaceChain } from "../places/types";
import type { StoredItem } from "../places/items-source";
import { readPayload, type PlacePayload } from "../places/payloads";
import type { PendingDraft, PendingItem, PendingState, PendingStore, WaitingJob } from "./store";
import { applyWallet, confidentMatch } from "./wallet";

/** The resolver calls this needs; they are never signed, so no account is tied to a job. */
export type ResolverApi = Pick<Api, "submitResolverJob" | "getResolverJob" | "takeResolverJob" | "deleteResolverJob" | "expandMapsLink">;

/** The longest query the queue accepts. */
export const MAX_QUERY_LENGTH = 1000;
/** Found places stay in the Inbox this long, so the person sees what came in. */
export const ADDED_KEEP_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * An unsent item another device saved is left to that device this long before this one sends
 * it, so two open devices do not both send a job for it.
 */
export const UNSENT_GRACE_MS = 5 * 60 * 1000;
/**
 * A job that is gone from the server before it expires was most likely taken by another of the
 * person's devices, whose answer reaches this one by sync. Only after this long without it does
 * the item count as failed.
 */
export const GONE_GRACE_MS = 10 * 60 * 1000;

/**
 * Places waiting for the resolver, on this device. `add` saves first and sends after, so a
 * place is never lost to a bad connection; `poll` sends what is unsent, collects results,
 * writes single matches to the diary and leaves several for the person to pick from.
 */
export class PendingQueue {
  private readonly listeners = new Set<() => void>();
  private polling: Promise<void> | null = null;
  /** Jobs this device found gone from the server, and when it first did. */
  private readonly gone = new Map<string, number>();

  constructor(
    private readonly store: PendingStore,
    private readonly api: ResolverApi,
    private readonly diary: DiaryWriter,
    private readonly now: () => number = Date.now,
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    const off = this.store.subscribe?.(listener);
    return () => {
      this.listeners.delete(listener);
      off?.();
    };
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
    const item = await this.store.create({ query: q, draft, createdAt: at, updatedAt: at, state: { kind: "unsent" } });
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
    await this.store.refresh?.();
    for (const item of await this.store.list()) {
      try {
        // Another open device is working on it: settling and sending are left to that device,
        // so its notes are not added twice; an answer is taken by one device only.
        const here = (await this.store.wroteHere?.(item.id)) ?? true;
        if (here && (item.state.kind === "unsent" || item.state.kind === "waiting") && (await this.settleOnDevice(item))) continue;
        if (item.state.kind === "unsent") {
          if (here || this.now() - item.updatedAt > UNSENT_GRACE_MS) await this.send(item);
        }
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

  /**
   * Finds the place without the resolver when this device can: the link is for a place already
   * in the diary (the same link, or another link to the same Google place), or the short Google
   * Maps link turns out to carry the pin after all. Only the link goes to the Worker, to expand
   * it, as when it was added; the diary is searched on the device. Returns whether it settled.
   */
  private async settleOnDevice(item: PendingItem): Promise<boolean> {
    const { draft } = item;
    if (draft.refreshPlaceId || !draft.link) return false;
    let current = item;
    if (draft.expandedUrl === undefined && parseLink(draft.link).shortLink) {
      let expanded: string | null;
      try {
        expanded = (await this.api.expandMapsLink(draft.link)).url;
      } catch (err) {
        // Offline or busy: try on a later pass. Anything else: the resolver has it.
        if (err instanceof NetworkError || (err instanceof ApiError && (err.status >= 500 || err.status === 429))) return false;
        expanded = null;
      }
      current = { ...item, draft: { ...draft, expandedUrl: expanded } };
      if (!(await this.store.get(item.id))) return true;
      await this.store.put(current);
    }
    const links = [current.draft.link, current.draft.expandedUrl ?? undefined];
    const items = await this.diary.listItems();
    const known = findLocalPlace(items, links);
    if (known) {
      await this.putOnPlace(current, known.id);
      return true;
    }
    const full = current.draft.expandedUrl ? parseLink(current.draft.expandedUrl) : undefined;
    if (!full?.location || !full.name) return false;
    const open = jobOf(current.state);
    await this.write(current, {
      name: full.name,
      category: "restaurant",
      location: full.location,
      sourceLinks: [current.draft.expandedUrl!],
    });
    if (open) await this.forgetJob(open.jobId);
    return true;
  }

  /** The person says the item is this place already in the diary: their notes go onto it, with no lookup. */
  async useKnown(id: string, placeId: string): Promise<string> {
    const item = await this.store.get(id);
    if (!item || item.draft.refreshPlaceId || item.state.kind === "added") throw new EntryError("That was already sorted out. Reload the Inbox.");
    const exists = (await this.diary.listItems()).some((i) => i.id === placeId && (i.type === "place" || i.type === "private_place"));
    if (!exists) throw new EntryError("That place isn't on this device any more. It may have been deleted.");
    await this.putOnPlace(item, placeId);
    return placeId;
  }

  /** Puts the item's status, tags and note on a place already in the diary, and closes its job. */
  private async putOnPlace(item: PendingItem, placeId: string): Promise<void> {
    const items = await this.diary.listItems();
    const place = items.find((i) => i.id === placeId);
    const name = place && (place.type === "place" || place.type === "private_place") ? readPayload(place.type, place.payload)?.name : undefined;
    // A new location of a chain carries no opinions: the link was for a place already in the diary.
    if (!item.draft.outletOf) await addDraftOpinions(this.diary, placeId, draftOf(item));
    const open = jobOf(item.state);
    if (open) await this.forgetJob(open.jobId);
    await this.save(item, added(placeId, name ?? item.draft.label, true));
  }

  /** Checks a job that is waiting, or failed but still on the server (the admin may retry it). */
  private async check(item: PendingItem, state: WaitingJob): Promise<void> {
    const failedBefore = item.state.kind === "failed";
    let job;
    try {
      job = await this.api.getResolverJob(state.jobId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return this.goneFromServer(item, state);
      throw err;
    }
    this.gone.delete(state.jobId);
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
      // Taking the answer drops the job, so of several open devices only one writes the place.
      let sealed: string;
      try {
        sealed = (await this.api.takeResolverJob(state.jobId)).sealedResult;
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return this.goneFromServer(item, state);
        throw err;
      }
      let result: ResolverResult;
      try {
        result = openResolverResult(fromBase64(sealed), { publicKey: state.publicKey, secretKey: state.secretKey });
      } catch (err) {
        if (!(err instanceof CryptoError)) throw err;
        await this.save(item, { kind: "failed", reason: "bad_result" });
        return;
      }
      const { candidates, chain } = result;
      // The result is on the device now; the one-time key is no longer needed. Every outlet of a
      // chain goes on the map: a Visited one asks which outlet the person went to, and a Want to
      // one adds them all straight away when the link was for one place. New facts for a place always ask,
      // and so does a lone match for a plain name (or a Zomato share link, which only carries
      // the name): a name can mean another place, so only a link for one place adds by itself.
      if (item.draft.refreshPlaceId && item.draft.wallet) {
        // A wallet refresh applies by itself when a match is clearly the place; else the admin picks.
        const match = confidentMatch(await this.diary.listItems(), item.draft.refreshPlaceId, candidates);
        if (match) await this.writeWallet(item, match, chain);
        else await this.save(item, { kind: "choose", candidates, ...(chain ? { walletChain: chain } : {}) });
      } else if (item.draft.refreshPlaceId) await this.save(item, { kind: "choose", candidates });
      // A new location of a chain: the match is the outlet the link was for; its chain's other
      // outlets are not added here.
      else if (item.draft.outletOf) {
        if (candidates.length === 1 && pointsAtOnePlace(item.draft.link)) await this.write(item, candidates[0]!);
        else await this.save(item, { kind: "choose", candidates });
      }
      else if (chain && item.draft.status === "want" && pointsAtOnePlace(item.draft.link)) {
        await this.save(item, { kind: "choose", candidates, chain });
        await this.addAll(item.id);
      } else if (chain) await this.save(item, { kind: "choose", candidates, chain });
      else if (candidates.length === 1 && pointsAtOnePlace(item.draft.link)) await this.write(item, candidates[0]!);
      else await this.save(item, { kind: "choose", candidates });
    }
  }

  /**
   * The job is not on the server. Before it expires that most likely means another of the
   * person's devices took the answer and its copy of the item is on the way, so this device
   * waits a while before calling it failed rather than overwrite that copy.
   */
  private async goneFromServer(item: PendingItem, state: WaitingJob): Promise<void> {
    const at = this.now();
    const since = this.gone.get(state.jobId) ?? at;
    this.gone.set(state.jobId, since);
    const shared = this.store.wroteHere !== undefined;
    if (shared && at < state.expiresAt && at - since < GONE_GRACE_MS) return;
    this.gone.delete(state.jobId);
    await this.save(item, { kind: "failed", reason: item.state.kind === "failed" ? item.state.reason : "expired" });
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
   * Adds every outlet of the chain. The match keeps the person's link; on a Visited one the
   * outlet they went to (`visited`, an index into `choicesOf`, the match by default) carries
   * the status, tags and note, and the status names it as the outlet visited. On a Want to one
   * the match carries them and the note is about every outlet.
   */
  async addAll(id: string, visited = 0): Promise<string> {
    const item = await this.store.get(id);
    if (!item || item.state.kind !== "choose" || !item.state.chain) throw new EntryError("That was already sorted out. Reload the Inbox.");
    const { chain } = item.state;
    const choices = choicesOf(item.state);
    const draft = draftOf(item);
    const isVisited = draft.status === "visited";
    const pick = isVisited ? (choices[visited] ?? choices[0]!) : choices[0]!;
    const label = chainFor(await this.diary.listItems(), chain.name);
    // The match and the chain's outlets; another possible match only when it was the one picked.
    const all = [item.state.candidates[0]!, ...chain.outlets];
    if (!all.includes(pick)) all.push(pick);
    // The outlet with the stamp first, so it leads the chain's page and list.
    const pickDraft: PendingDraft = pick === item.state.candidates[0] ? draft : withoutLink(draft);
    const { placeId, existing } = await writeResolved(this.diary, pickDraft, pick, label, !isVisited, isVisited ? "self" : undefined);
    for (const c of all) {
      if (c === pick) continue;
      // Only the match keeps the person's link: it is the one the link was for.
      await writeOutlet(this.diary, draft, c, label, c === item.state.candidates[0]);
    }
    await this.save(item, added(placeId, chain.name, existing));
    return placeId;
  }

  private async writeWallet(item: PendingItem, candidate: ResolvedPlace, chain?: ResolvedChain): Promise<string> {
    const placeId = item.draft.refreshPlaceId!;
    await applyWallet(this.diary, placeId, candidate, chain);
    await this.save(item, { kind: "added", placeId, name: item.draft.label });
    return placeId;
  }

  private async write(item: PendingItem, candidate: ResolvedPlace, chain?: ResolvedChain): Promise<string | undefined> {
    if (item.draft.refreshPlaceId && item.draft.wallet) {
      return this.writeWallet(item, candidate, item.state.kind === "choose" ? item.state.walletChain : undefined);
    }
    if (item.draft.refreshPlaceId) {
      const placeId = await refreshFacts(this.diary, item.draft.refreshPlaceId, candidate, item.draft.correcting === true ? item.draft.link : false);
      await this.save(item, { kind: "added", placeId, name: candidate.name });
      return placeId;
    }
    if (item.draft.outletOf) {
      const facts = factsFromCandidate({ ...item.draft, category: item.draft.category ?? candidate.category }, candidate, item.draft.outletOf);
      if (!readPayload("place", facts as unknown as JsonValue)) throw new EntryError("That match is missing a name or a location, so it can't be added. Try looking it up again.");
      const done = await addOutlet(this.diary, item.draft.outletOf.id, facts, item.draft.been === true);
      await this.save(item, added(done.placeId, candidate.name, done.kind !== "added"));
      return done.placeId;
    }
    const items = await this.diary.listItems();
    let label = chain ? chainFor(items, chain.name) : undefined;
    let written: Written;
    // The resolver starts from nothing each time, so the catalogue on this device is what
    // knows a place by this name is already on the map.
    const match = label ? undefined : branchOf(items, candidate);
    if (match?.kind === "same") {
      await addDraftOpinions(this.diary, match.placeId, draftOf(item));
      written = { placeId: match.placeId, existing: true };
    } else if (match?.kind === "branch") {
      await this.save(item, { kind: "branch", candidate, chain: match.chain, ...(match.area ? { area: match.area } : {}) });
      return undefined;
    } else {
      written = await writeResolved(this.diary, draftOf(item), candidate, label);
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
    // A Visited branch is the outlet the person went to.
    const { placeId, existing } = await writeResolved(this.diary, draftOf(item), candidate, isBranch ? chain : undefined, false, isBranch ? "self" : undefined);
    await this.save(item, added(placeId, candidate.name, existing));
    return placeId;
  }

  /**
   * Saves a lookup of an existing catalogue place, whose answer becomes its new facts. With
   * `correcting` the place was the wrong match: its links and chain are replaced, not kept.
   */
  async lookUpAgain(placeId: string, query: string, label: string, correcting = false, wallet = false): Promise<PendingItem> {
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
      ...(wallet && !correcting ? { wallet: true as const } : {}),
    });
  }

  /**
   * Saves a lookup of a new location of a chain ("Add a location" on its place page). Once
   * found it joins the chain as another outlet, in the chain's category.
   */
  async addOutlet(query: string, chain: PlaceChain, category: Category, been: boolean): Promise<PendingItem> {
    const q = query.trim();
    return this.add(q, {
      label: `${chain.name}, new location`,
      ...(isLink(q) ? { link: q } : {}),
      category,
      status: "want",
      tagIds: [],
      newTags: [],
      comment: "",
      outletOf: { ...chain },
      ...(been ? { been: true as const } : {}),
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
    } else if (item.draft.outletOf) {
      const done = await addOutlet(this.diary, item.draft.outletOf.id, { ...facts, chain: { ...item.draft.outletOf } }, item.draft.been === true);
      placeId = done.placeId;
      existing = done.kind !== "added";
    } else {
      const written = await writeFacts(this.diary, draftOf(item), facts);
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

/**
 * A place already in the diary by the item's name (typed, or read off its expanded link), for the
 * Inbox to ask "Is it this one?". Only what the device holds is searched, so nothing is sent and
 * nothing the person cannot see is revealed.
 */
export function knownForItem(items: readonly StoredItem[], item: PendingItem, accountId: string): KnownPlace | undefined {
  // A new location of a chain is not the chain itself, whose name it carries.
  if (item.draft.refreshPlaceId || item.draft.outletOf) return undefined;
  const names = [item.draft.label, item.draft.expandedUrl ? parseLink(item.draft.expandedUrl).name : undefined];
  for (const name of names) {
    if (!name || /^https?:/i.test(name)) continue;
    const found = knownByName(items, name, accountId) ?? (name.includes(",") ? knownByName(items, name.split(",")[0]!, accountId) : undefined);
    if (found) return found;
  }
  return undefined;
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
export async function writeResolved(
  w: DiaryWriter,
  draft: PendingDraft,
  c: ResolvedPlace,
  chain?: PlaceChain,
  allOutlets = false,
  /**
   * "self": a Visited status names this place as the outlet of its chain the person went to,
   * also when the catalogue had it already. (A new outlet is always the one visited.)
   */
  visitedOutlet?: "self",
): Promise<Written> {
  const facts = factsFromCandidate(draft, c, chain);
  if (!readPayload("place", facts as unknown as JsonValue)) throw new EntryError("That match is missing a name or a location, so it can't be added. Try looking it up again.");
  return writeFacts(w, draft, facts, allOutlets, visitedOutlet);
}

/**
 * Writes a catalogue place from its facts with the draft's status, tags and note, or puts them
 * on the place the catalogue already has with one of its links.
 */
export async function writeFacts(w: DiaryWriter, draft: PendingDraft, facts: PlacePayload, allOutlets = false, visitedOutlet?: "self"): Promise<Written> {
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
      ...optionsOf(draft),
    });
    return { placeId, existing: false };
  }

  await addDraftOpinions(w, existing, draft, allOutlets, visitedOutlet && draft.status === "visited" ? [existing] : undefined);
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
async function addDraftOpinions(w: DiaryWriter, placeId: string, draft: PendingDraft, allOutlets = false, outlets?: string[]): Promise<void> {
  await addOpinions(w, placeId, {
    status: draft.status,
    ...(outlets ? { outlets } : {}),
    tagIds: draft.tagIds,
    newTags: draft.newTags,
    comment: draft.comment,
    ...(allOutlets ? { commentAllOutlets: true } : {}),
    ...optionsOf(draft),
  });
}

/**
 * Writes another outlet of a chain as a catalogue place, with no opinions: the chain's
 * status and tags cover it. An outlet the catalogue already has is left as it is.
 */
export async function writeOutlet(w: DiaryWriter, draft: PendingDraft, c: ResolvedPlace, chain: PlaceChain, keepLink = false): Promise<string> {
  // The person's link is for the match, not this outlet.
  const facts = factsFromCandidate(keepLink ? draft : withoutLink(draft), c, chain);
  if (!readPayload("place", facts as unknown as JsonValue)) throw new EntryError("One of the outlets is missing a name or a location, so it can't be added.");
  const existing = await findCataloguePlace(w, facts.sourceLinks);
  if (existing) return existing;
  return (await w.write({ type: "place", placeId: null, payload: facts as unknown as JsonValue })).id;
}

/** The draft without the person's link, for an outlet the link was not for. */
function withoutLink(draft: PendingDraft): PendingDraft {
  const { link: _link, expandedUrl: _expanded, ...rest } = draft;
  return rest;
}

/** The item's draft, with when it was added. */
const draftOf = (item: PendingItem): PendingDraft => ({ ...item.draft, addedAt: item.createdAt });

/** A Visited place is stamped with the day it was added, not the day it was found. */
const visitedAtOf = (draft: PendingDraft) => (draft.status === "visited" && draft.addedAt !== undefined ? { visitedAt: draft.addedAt } : {});

const optionsOf = (draft: PendingDraft) => ({
  ...visitedAtOf(draft),
  ...(draft.boards ? { boards: draft.boards } : {}),
  ...(draft.tagBoards ? { tagBoards: draft.tagBoards } : {}),
  ...(draft.commentBoards ? { commentBoards: draft.commentBoards } : {}),
});
