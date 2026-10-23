import { beforeAll, describe, expect, it } from "vitest";
import { fromBase64, generateReplyKeys, ready, sealResolverResult, toBase64, type ResolvedChain, type ResolvedPlace } from "@map-diary/crypto";
import { ApiError, NetworkError, type ResolverJobResponse } from "@map-diary/sync";
import { readPayload } from "../lib/places/payloads";
import { ADDED_KEEP_MS, PendingQueue, type ResolverApi } from "../lib/pending/queue";
import { MemoryPendingStore, type PendingDraft } from "../lib/pending/store";
import { FakeDiary } from "./fake-diary";

beforeAll(ready);

type Job = { query: string; replyPublicKey: string; status: ResolverJobResponse["status"]; sealedResult?: string };

/** The resolver routes in memory, with a hand for the resolver's side. */
class FakeResolver implements ResolverApi {
  jobs = new Map<string, Job>();
  offline = false;
  private n = 0;

  async submitResolverJob(query: string, replyPublicKey: string): Promise<ResolverJobResponse> {
    if (this.offline) throw new NetworkError();
    const id = `job-${++this.n}`;
    this.jobs.set(id, { query, replyPublicKey, status: "pending" });
    return { id, status: "pending", expiresAt: 2_000_000_000_000 };
  }
  async getResolverJob(id: string): Promise<ResolverJobResponse> {
    if (this.offline) throw new NetworkError();
    const job = this.jobs.get(id);
    if (!job) throw new ApiError(404, "not_found");
    return { id, status: job.status, expiresAt: 2_000_000_000_000, ...(job.sealedResult ? { sealedResult: job.sealedResult } : {}) };
  }
  async deleteResolverJob(id: string): Promise<undefined> {
    this.jobs.delete(id);
    return undefined;
  }

  only(): [string, Job] {
    const [entry] = [...this.jobs.entries()];
    if (!entry || this.jobs.size !== 1) throw new Error(`expected one job, have ${this.jobs.size}`);
    return entry;
  }
  answer(candidates: ResolvedPlace[], chain?: ResolvedChain) {
    const [, job] = this.only();
    job.status = "resolved";
    job.sealedResult = toBase64(sealResolverResult({ v: 1, candidates, ...(chain ? { chain } : {}) }, fromBase64(job.replyPublicKey)));
  }
}

const kyani: ResolvedPlace = {
  name: "Kyani & Co.",
  category: "restaurant",
  location: { lat: 18.9447, lng: 72.8277 },
  address: "Jer Mahal, Marine Lines",
  cuisine: "Irani café",
  signatureDish: { name: "Bun maska", priceInr: 60 },
  sourceLinks: ["https://www.zomato.com/mumbai/kyani-co-marine-lines"],
};

const draft = (over: Partial<PendingDraft> = {}): PendingDraft => ({
  label: "Kyani",
  status: "want",
  tagIds: [],
  newTags: [],
  comment: "",
  ...over,
});

function setup() {
  const store = new MemoryPendingStore();
  const api = new FakeResolver();
  const diary = new FakeDiary();
  let t = 1_760_000_000_000;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  return { store, api, diary, clock, queue: new PendingQueue(store, api, diary, clock.now) };
}

const places = (d: FakeDiary) => [...d.items.values()].filter((i) => i.type === "place");

describe("PendingQueue", () => {
  it("sends only the query and a fresh public key", async () => {
    const { api, queue } = setup();
    const item = await queue.add("  Kyani and Co  ", draft());
    const [jobId, job] = api.only();
    expect(job.query).toBe("Kyani and Co");
    expect(fromBase64(job.replyPublicKey)).toHaveLength(32);
    expect(item.state).toMatchObject({ kind: "waiting", jobId });
  });

  it("writes a single match with the draft's status, tags and note, then forgets the job", async () => {
    const { api, diary, queue } = setup();
    await queue.add("https://www.zomato.com/mumbai/kyani-co-marine-lines/info", draft({
      link: "https://www.zomato.com/mumbai/kyani-co-marine-lines/info",
      status: "visited",
      newTags: [{ name: "Breakfast", emoji: "🍳", description: "" }],
      comment: "Get there early",
    }));
    await queue.poll();
    expect((await queue.list())[0]!.state.kind).toBe("waiting");

    api.answer([kyani]);
    await queue.poll();

    const [place] = places(diary);
    expect(place).toBeDefined();
    const facts = readPayload("place", place!.payload);
    expect(facts).toMatchObject({ name: "Kyani & Co.", cuisine: "Irani café", signatureDish: { name: "Bun maska", priceInr: 60 } });
    expect(facts?.sourceLinks).toEqual(["https://www.zomato.com/mumbai/kyani-co-marine-lines/info", "https://www.zomato.com/mumbai/kyani-co-marine-lines"]);
    const snap = diary.snapshot().places[0]!;
    expect(snap.opinions.map((o) => o.kind).sort()).toEqual(["comment", "status", "tag"]);
    expect(snap.opinions.find((o) => o.kind === "status")).toMatchObject({ status: "visited" });
    expect(api.jobs.size).toBe(0);
    expect((await queue.list())[0]!.state).toEqual({ kind: "added", placeId: place!.id, name: "Kyani & Co." });
  });

  it("keeps several matches for the person to pick, and writes the one picked", async () => {
    const { api, diary, queue } = setup();
    const item = await queue.add("Bastian", draft({ label: "Bastian" }));
    const worli = { ...kyani, name: "Bastian Worli", sourceLinks: [] };
    const bandra = { ...kyani, name: "Bastian Bandra", location: { lat: 19.06, lng: 72.83 }, sourceLinks: [] };
    api.answer([worli, bandra]);
    await queue.poll();

    const waiting = await queue.list();
    expect(waiting[0]!.state).toMatchObject({ kind: "choose", candidates: [{ name: "Bastian Worli" }, { name: "Bastian Bandra" }] });
    expect(places(diary)).toHaveLength(0);
    // The one-time key is gone once the result is on the device.
    expect(JSON.stringify(waiting[0])).not.toContain("secretKey");

    await queue.choose(item.id, 1);
    expect(readPayload("place", places(diary)[0]!.payload)?.name).toBe("Bastian Bandra");
  });

  it("uses the category the person picked, and drops a dish it doesn't fit", async () => {
    const { api, diary, queue } = setup();
    await queue.add("Kyani", draft({ category: "recreation" }));
    api.answer([kyani]);
    await queue.poll();
    const facts = readPayload("place", places(diary)[0]!.payload);
    expect(facts?.category).toBe("recreation");
    expect(facts?.signatureDish).toBeUndefined();
  });

  it("puts the opinions on a place already in the diary instead of adding it twice", async () => {
    const { api, diary, queue } = setup();
    await queue.add("Kyani", draft());
    api.answer([kyani]);
    await queue.poll();
    await queue.add("Kyani again", draft({ comment: "Second visit" }));
    api.answer([kyani]);
    await queue.poll();
    expect(places(diary)).toHaveLength(1);
    expect([...diary.items.values()].filter((i) => i.type === "status")).toHaveLength(1);
    expect(diary.snapshot().places[0]!.opinions.some((o) => o.kind === "comment" && o.text === "Second visit")).toBe(true);
  });

  it("saves while offline and sends on the next poll", async () => {
    const { api, queue } = setup();
    api.offline = true;
    const item = await queue.add("Kyani", draft());
    expect(item.state.kind).toBe("unsent");
    await queue.poll();
    api.offline = false;
    await queue.poll();
    expect((await queue.list())[0]!.state.kind).toBe("waiting");
    expect(api.jobs.size).toBe(1);
  });

  it("marks failed and expired jobs, and retries with a new job and key", async () => {
    const { api, queue } = setup();
    const item = await queue.add("Nowhere café", draft());
    const [firstId, first] = api.only();
    first.status = "failed";
    await queue.poll();
    expect((await queue.list())[0]!.state).toMatchObject({ kind: "failed", reason: "not_found", job: { jobId: firstId } });
    // The failed job stays on the server, so the admin can put it back in the queue.
    expect(api.jobs.has(firstId)).toBe(true);

    await queue.retry(item.id);
    expect(api.jobs.has(firstId)).toBe(false);
    const [secondId, second] = api.only();
    expect(secondId).not.toBe(firstId);
    expect(second.replyPublicKey).not.toBe(first.replyPublicKey);

    api.jobs.clear();
    await queue.poll();
    expect((await queue.list())[0]!.state).toEqual({ kind: "failed", reason: "expired" });
  });

  it("picks up a failed job the admin put back in the queue", async () => {
    const { api, diary, queue } = setup();
    await queue.add("Kyani", draft());
    const [jobId, job] = api.only();
    job.status = "failed";
    await queue.poll();
    expect((await queue.list())[0]!.state.kind).toBe("failed");

    job.status = "pending";
    await queue.poll();
    expect((await queue.list())[0]!.state).toMatchObject({ kind: "waiting", jobId });

    api.answer([kyani]);
    await queue.poll();
    expect((await queue.list())[0]!.state.kind).toBe("added");
    expect(places(diary).map((p) => readPayload("place", p.payload)?.name)).toEqual(["Kyani & Co."]);
  });

  it("looks a place up again and replaces only its facts", async () => {
    const { api, diary, queue } = setup();
    const old = await diary.write({
      type: "place",
      placeId: null,
      payload: { name: "Kyani", category: "cafe-bar", location: { lat: 18.94, lng: 72.82 }, sourceLinks: ["https://example.com/kyani"], chain: { id: "c1", name: "Kyani" } },
    });
    const item = await queue.lookUpAgain(old.id, "Kyani & Co., Marine Lines", "Kyani");
    expect(api.only()[1].query).toBe("Kyani & Co., Marine Lines");
    api.answer([kyani]);
    await queue.poll();
    // Even one match waits for the admin to confirm it.
    expect((await queue.list())[0]!.state.kind).toBe("choose");
    expect(await queue.choose(item.id, 0)).toBe(old.id);

    const facts = readPayload("place", diary.items.get(old.id)!.payload)!;
    expect(facts).toMatchObject({ name: "Kyani & Co.", category: "restaurant", chain: { id: "c1", name: "Kyani" } });
    expect(facts.sourceLinks).toEqual(["https://example.com/kyani", ...kyani.sourceLinks]);
    // No opinions, and no second place.
    expect([...diary.items.values()].map((i) => i.type)).toEqual(["place"]);
  });

  it("refuses a result sealed to another key", async () => {
    const { api, queue } = setup();
    await queue.add("Kyani", draft());
    const [, job] = api.only();
    const other = generateReplyKeys().publicKey;
    job.status = "resolved";
    job.sealedResult = toBase64(sealResolverResult({ v: 1, candidates: [kyani] }, other));
    await queue.poll();
    expect((await queue.list())[0]!.state).toEqual({ kind: "failed", reason: "bad_result" });
  });

  it("dismisses an item and its open job, and clears found ones after a few days", async () => {
    const { api, clock, queue } = setup();
    const a = await queue.add("A", draft());
    await queue.dismiss(a.id);
    expect(api.jobs.size).toBe(0);
    expect(await queue.list()).toHaveLength(0);

    await queue.add("Kyani", draft());
    api.answer([kyani]);
    await queue.poll();
    clock.advance(ADDED_KEEP_MS + 1);
    await queue.poll();
    expect(await queue.list()).toHaveLength(0);
  });

  describe("chains", () => {
    const link = "https://www.zomato.com/mumbai/the-bombay-cartel-lower-parel";
    const lowerParel: ResolvedPlace = { ...kyani, name: "The Bombay Cartel", address: "Kamala Mills, Lower Parel", sourceLinks: [link] };
    const bandra: ResolvedPlace = { ...lowerParel, address: "Linking Road, Bandra", location: { lat: 19.06, lng: 72.83 }, sourceLinks: ["https://www.zomato.com/mumbai/the-bombay-cartel-bandra"] };
    const andheri: ResolvedPlace = { ...lowerParel, address: "Andheri West", location: { lat: 19.13, lng: 72.83 }, sourceLinks: ["https://www.zomato.com/mumbai/the-bombay-cartel-andheri"] };
    const chain: ResolvedChain = { name: "The Bombay Cartel", outlets: [bandra, andheri] };

    it("asks before adding a chain, even with one match", async () => {
      const { api, diary, queue } = setup();
      await queue.add(link, draft({ link }));
      api.answer([lowerParel], chain);
      await queue.poll();
      expect((await queue.list())[0]!.state).toMatchObject({ kind: "choose", chain: { name: "The Bombay Cartel" } });
      expect(places(diary)).toHaveLength(0);
    });

    it("adds every outlet as one chain, with the opinions on the one linked", async () => {
      const { api, diary, queue } = setup();
      const item = await queue.add(link, draft({ link, status: "visited", comment: "Great cocktails" }));
      api.answer([lowerParel], chain);
      await queue.poll();
      const placeId = await queue.addAll(item.id);

      const written = places(diary).map((p) => readPayload("place", p.payload)!);
      expect(written).toHaveLength(3);
      expect(new Set(written.map((f) => f.chain?.id)).size).toBe(1);
      // The person's link goes on the outlet it was for only.
      expect(written.filter((f) => f.sourceLinks.includes(link))).toHaveLength(1);

      const view = diary.snapshot().places;
      expect(view).toHaveLength(1);
      expect(view[0]).toMatchObject({ id: placeId, name: "The Bombay Cartel" });
      expect(view[0]!.outlets?.map((o) => o.address)).toEqual(["Kamala Mills, Lower Parel", "Linking Road, Bandra", "Andheri West"]);
      expect(view[0]!.opinions.find((o) => o.kind === "comment")).toMatchObject({ text: "Great cocktails", allOutlets: true });
    });

    it("adds only the outlet picked, still labelled with its chain, and later outlets join it", async () => {
      const { api, diary, queue } = setup();
      const first = await queue.add(link, draft({ link }));
      api.answer([lowerParel], chain);
      await queue.poll();
      await queue.choose(first.id, 0);
      expect(places(diary)).toHaveLength(1);

      const second = await queue.add("Bombay Cartel Bandra", draft({ label: "Bombay Cartel Bandra" }));
      api.answer([bandra], { name: "Bombay Cartel", outlets: [lowerParel, andheri] });
      await queue.poll();
      await queue.choose(second.id, 0);

      const chains = places(diary).map((p) => readPayload("place", p.payload)!.chain?.id);
      expect(chains).toHaveLength(2);
      expect(chains[0]).toBe(chains[1]);
      expect(diary.snapshot().places).toHaveLength(1);
    });

    it("doesn't add an outlet the diary already has twice", async () => {
      const { api, diary, queue } = setup();
      await diary.write({ type: "place", placeId: null, payload: { name: "TBC Bandra", category: "restaurant", location: { lat: 19.06, lng: 72.83 }, sourceLinks: bandra.sourceLinks } });
      const item = await queue.add(link, draft({ link }));
      api.answer([lowerParel], chain);
      await queue.poll();
      await queue.addAll(item.id);
      expect(places(diary)).toHaveLength(3);
    });
  });
});
