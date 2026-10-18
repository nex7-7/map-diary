import { beforeAll, describe, expect, it } from "vitest";
import { fromBase64, generateReplyKeys, ready, sealResolverResult, toBase64, type ResolvedPlace } from "@map-diary/crypto";
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
  answer(candidates: ResolvedPlace[]) {
    const [, job] = this.only();
    job.status = "resolved";
    job.sealedResult = toBase64(sealResolverResult({ v: 1, candidates }, fromBase64(job.replyPublicKey)));
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
    expect((await queue.list())[0]!.state).toEqual({ kind: "failed", reason: "not_found" });

    await queue.retry(item.id);
    const [secondId, second] = api.only();
    expect(secondId).not.toBe(firstId);
    expect(second.replyPublicKey).not.toBe(first.replyPublicKey);

    api.jobs.clear();
    await queue.poll();
    expect((await queue.list())[0]!.state).toEqual({ kind: "failed", reason: "expired" });
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
});
