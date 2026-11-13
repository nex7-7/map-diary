import { beforeAll, describe, expect, it } from "vitest";
import { fromBase64, generateReplyKeys, ready, sealResolverResult, toBase64, type ResolvedChain, type ResolvedPlace } from "@map-diary/crypto";
import { ApiError, NetworkError, type ResolverJobResponse } from "@map-diary/sync";
import { readPayload } from "../lib/places/payloads";
import { setStatus } from "../lib/entries/actions";
import { unwrittenChains } from "../lib/places/chains";
import { ADDED_KEEP_MS, PendingQueue, knownForItem, type ResolverApi } from "../lib/pending/queue";
import { MemoryPendingStore, type PendingDraft } from "../lib/pending/store";
import { placesNeedingWallet } from "../lib/pending/wallet";
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
  async takeResolverJob(id: string): Promise<{ sealedResult: string }> {
    if (this.offline) throw new NetworkError();
    const job = this.jobs.get(id);
    if (!job || job.status !== "resolved" || !job.sealedResult) throw new ApiError(404, "not_found");
    this.jobs.delete(id);
    this.taken++;
    return { sealedResult: job.sealedResult };
  }
  taken = 0;
  async deleteResolverJob(id: string): Promise<undefined> {
    this.jobs.delete(id);
    return undefined;
  }

  /** Short links the Worker can expand, and how often it was asked. */
  expansions = new Map<string, string>();
  expanded = 0;
  async expandMapsLink(url: string): Promise<{ url: string }> {
    if (this.offline) throw new NetworkError();
    this.expanded++;
    const full = this.expansions.get(url);
    if (!full) throw new ApiError(422, "not_expanded");
    return { url: full };
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

const KYANI = "https://www.zomato.com/mumbai/kyani-co-marine-lines";

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

  it("stamps a Visited place found later with the day it was added, not the day it was found", async () => {
    const { api, diary, queue, clock } = setup();
    const addedAt = clock.now();
    await queue.add(KYANI, draft({ link: KYANI, status: "visited" }));
    clock.advance(3 * 24 * 3_600_000);
    api.answer([kyani]);
    await queue.poll();

    const status = [...diary.items.values()].find((i) => i.type === "status")!;
    expect(readPayload("status", status.payload)).toEqual({ status: "visited", visitedAt: addedAt });
    expect(diary.snapshot().places[0]!.opinions.find((o) => o.kind === "status")).toMatchObject({ visitedAt: new Date(addedAt).toISOString() });
  });

  it("gives a Want to place found later no visit date", async () => {
    const { api, diary, queue } = setup();
    await queue.add(KYANI, draft({ link: KYANI }));
    api.answer([kyani]);
    await queue.poll();
    const status = [...diary.items.values()].find((i) => i.type === "status")!;
    expect(status.payload).toEqual({ status: "want" });
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
    await queue.add(KYANI, draft({ link: KYANI, category: "recreation" }));
    api.answer([kyani]);
    await queue.poll();
    const facts = readPayload("place", places(diary)[0]!.payload);
    expect(facts?.category).toBe("recreation");
    expect(facts?.signatureDish).toBeUndefined();
  });

  it("puts the opinions on a place already in the diary instead of adding it twice", async () => {
    const { api, diary, queue } = setup();
    await queue.add(KYANI, draft({ link: KYANI }));
    api.answer([kyani]);
    await queue.poll();
    await queue.add(KYANI, draft({ link: KYANI, comment: "Second visit" }));
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
    await queue.add(KYANI, draft({ link: KYANI }));
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

    await queue.add(KYANI, draft({ link: KYANI }));
    api.answer([kyani]);
    await queue.poll();
    clock.advance(ADDED_KEEP_MS + 1);
    await queue.poll();
    expect(await queue.list()).toHaveLength(0);
  });

  it("asks before adding a lone match for a plain name or a Zomato share link", async () => {
    const { api, diary, queue } = setup();
    await queue.add("Kyani", draft());
    api.answer([kyani]);
    await queue.poll();
    expect((await queue.list())[0]!.state).toMatchObject({ kind: "choose", candidates: [{ name: "Kyani & Co." }] });
    expect(places(diary)).toHaveLength(0);

    const { api: api2, diary: diary2, queue: queue2 } = setup();
    const onelink = "https://zomato.onelink.me/xqzv/lxa9ebfu";
    await queue2.add(onelink, draft({ link: onelink }));
    api2.answer([kyani]);
    await queue2.poll();
    expect((await queue2.list())[0]!.state.kind).toBe("choose");
    expect(places(diary2)).toHaveLength(0);
  });

  it("looks an item up again with a better link, keeping its opinions and dropping the wrong link", async () => {
    const { api, diary, queue } = setup();
    const wrong = "https://zomato.onelink.me/xqzv/lxa9ebfu";
    const item = await queue.add(wrong, draft({ label: wrong, link: wrong, status: "visited", comment: "Thali" }));
    const [firstId, first] = api.only();
    first.status = "failed";
    await queue.poll();

    await queue.requery(item.id, `  ${KYANI}  `);
    expect(api.jobs.has(firstId)).toBe(false);
    const [, job] = api.only();
    expect(job.query).toBe(KYANI);
    const again = (await queue.list())[0]!;
    expect(again.draft).toMatchObject({ label: "", link: KYANI, status: "visited", comment: "Thali" });

    api.answer([kyani]);
    await queue.poll();
    const facts = readPayload("place", places(diary)[0]!.payload);
    expect(facts?.sourceLinks).toEqual([KYANI]);
    expect(diary.snapshot().places[0]!.opinions.find((o) => o.kind === "comment")).toMatchObject({ text: "Thali" });
  });

  it("adds a place filled in by hand, with the item's opinions", async () => {
    const { api, diary, queue } = setup();
    const item = await queue.add("Samai", draft({ label: "Samai", comment: "Marathi thali" }));
    api.only()[1].status = "failed";
    await queue.poll();

    const placeId = await queue.fillIn(item.id, {
      name: "Samai Marathmola Jewanachi Mejwani",
      category: "restaurant",
      location: { lat: 18.9953, lng: 72.8258 },
      sourceLinks: ["https://www.zomato.com/mumbai/samai-marathmola-jewanachi-mejwani-lower-parel"],
    });
    expect(api.jobs.size).toBe(0);
    expect(readPayload("place", diary.items.get(placeId)!.payload)?.name).toBe("Samai Marathmola Jewanachi Mejwani");
    expect(diary.snapshot().places[0]!.opinions.map((o) => o.kind).sort()).toEqual(["comment", "status"]);
    expect((await queue.list())[0]!.state).toEqual({ kind: "added", placeId, name: "Samai Marathmola Jewanachi Mejwani" });
  });

  it("corrects a wrong match: the new facts replace its links and chain", async () => {
    const { api, diary, queue } = setup();
    const placeId = (
      await diary.write({
        type: "place",
        placeId: null,
        payload: { name: "SAMAA", category: "restaurant", location: { lat: 19.1, lng: 72.86 }, sourceLinks: ["https://www.zomato.com/mumbai/samaa-fairmont"], chain: { id: "c", name: "SAMAA" } },
      })
    ).id;
    const right = "https://www.zomato.com/mumbai/samai-marathmola-jewanachi-mejwani-lower-parel";
    const item = await queue.lookUpAgain(placeId, right, "SAMAA", true);
    api.answer([{ ...kyani, name: "Samai", sourceLinks: [] }]);
    await queue.poll();
    await queue.choose(item.id, 0);
    const facts = readPayload("place", diary.items.get(placeId)!.payload)!;
    expect(facts.name).toBe("Samai");
    expect(facts.sourceLinks).toEqual([right]);
    expect(facts.chain).toBeUndefined();
  });

  describe("chains", () => {
    const link = "https://www.zomato.com/mumbai/the-bombay-cartel-lower-parel";
    const lowerParel: ResolvedPlace = { ...kyani, name: "The Bombay Cartel", address: "Kamala Mills, Lower Parel", sourceLinks: [link] };
    const bandra: ResolvedPlace = { ...lowerParel, address: "Linking Road, Bandra", location: { lat: 19.06, lng: 72.83 }, sourceLinks: ["https://www.zomato.com/mumbai/the-bombay-cartel-bandra"] };
    const andheri: ResolvedPlace = { ...lowerParel, address: "Andheri West", location: { lat: 19.13, lng: 72.83 }, sourceLinks: ["https://www.zomato.com/mumbai/the-bombay-cartel-andheri"] };
    const chain: ResolvedChain = { name: "The Bombay Cartel", outlets: [bandra, andheri] };

    const statusOf = (d: FakeDiary) => d.snapshot().places[0]!.opinions.find((o) => o.kind === "status");
    const idOf = (d: FakeDiary, address: string) => places(d).find((p) => readPayload("place", p.payload)!.address === address)!.id;

    it("adds every outlet of a Want to chain straight away when the link was for one place", async () => {
      const { api, diary, queue } = setup();
      await queue.add(link, draft({ link, comment: "For a birthday" }));
      api.answer([lowerParel], chain);
      await queue.poll();
      expect((await queue.list())[0]!.state).toMatchObject({ kind: "added" });
      expect(places(diary)).toHaveLength(3);
      const view = diary.snapshot().places;
      expect(view).toHaveLength(1);
      expect(statusOf(diary)).toMatchObject({ status: "want" });
      expect(view[0]!.opinions.find((o) => o.kind === "comment")).toMatchObject({ text: "For a birthday", allOutlets: true });
    });

    it("asks a Visited chain which outlet the person went to", async () => {
      const { api, diary, queue } = setup();
      await queue.add(link, draft({ link, status: "visited" }));
      api.answer([lowerParel], chain);
      await queue.poll();
      expect((await queue.list())[0]!.state).toMatchObject({ kind: "choose", chain: { name: "The Bombay Cartel" } });
      expect(places(diary)).toHaveLength(0);
    });

    it("asks before adding a chain found by name", async () => {
      const { api, diary, queue } = setup();
      await queue.add("Bombay Cartel", draft({ label: "Bombay Cartel" }));
      api.answer([lowerParel], chain);
      await queue.poll();
      expect((await queue.list())[0]!.state).toMatchObject({ kind: "choose" });
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
      expect(view[0]).toMatchObject({ name: "The Bombay Cartel" });
      expect(view[0]!.outlets?.map((o) => o.address)).toEqual(expect.arrayContaining(["Kamala Mills, Lower Parel", "Linking Road, Bandra", "Andheri West"]));
      expect(placeId).toBe(idOf(diary, "Kamala Mills, Lower Parel"));
      // The note is about the outlet visited, and the status names it.
      const comment = view[0]!.opinions.find((o) => o.kind === "comment");
      expect(comment).toMatchObject({ text: "Great cocktails", placeId });
      expect(comment).not.toHaveProperty("allOutlets");
      expect(statusOf(diary)).toMatchObject({ status: "visited", outlets: [placeId] });
    });

    it("puts the stamp and note on the outlet picked, and the link on the one it was for", async () => {
      const { api, diary, queue } = setup();
      const item = await queue.add(link, draft({ link, status: "visited", comment: "Went with Ria" }));
      api.answer([lowerParel], chain);
      await queue.poll();
      const placeId = await queue.addAll(item.id, 1);

      expect(places(diary)).toHaveLength(3);
      const bandraId = idOf(diary, "Linking Road, Bandra");
      expect(placeId).toBe(bandraId);
      expect(readPayload("place", places(diary).find((p) => p.id === bandraId)!.payload)!.sourceLinks).not.toContain(link);
      expect(readPayload("place", places(diary).find((p) => p.id === idOf(diary, "Kamala Mills, Lower Parel"))!.payload)!.sourceLinks).toContain(link);
      expect(statusOf(diary)).toMatchObject({ status: "visited", outlets: [bandraId] });
      expect(diary.snapshot().places[0]!.opinions.find((o) => o.kind === "comment")).toMatchObject({ placeId: bandraId });
    });

    it("later outlets join a chain, and a Visited one is marked as visited too", async () => {
      const { api, diary, queue } = setup();
      const first = await queue.add(link, draft({ link, status: "visited" }));
      api.answer([lowerParel], chain);
      await queue.poll();
      await queue.choose(first.id, 0);
      expect(places(diary)).toHaveLength(1);
      const lowerId = places(diary)[0]!.id;

      const second = await queue.add("Bombay Cartel Bandra", draft({ label: "Bombay Cartel Bandra", status: "visited" }));
      api.answer([bandra], { name: "Bombay Cartel", outlets: [lowerParel, andheri] });
      await queue.poll();
      await queue.choose(second.id, 0);

      const chains = places(diary).map((p) => readPayload("place", p.payload)!.chain?.id);
      expect(chains).toHaveLength(2);
      expect(chains[0]).toBe(chains[1]);
      expect(diary.snapshot().places).toHaveLength(1);
      const bandraId = places(diary).find((p) => p.id !== lowerId)!.id;
      expect(diary.snapshot().places[0]!.opinions.filter((o) => o.kind === "status")).toMatchObject([{ status: "visited", outlets: [lowerId, bandraId] }]);
    });

    it("doesn't add an outlet the diary already has twice", async () => {
      const { api, diary, queue } = setup();
      await diary.write({ type: "place", placeId: null, payload: { name: "TBC Bandra", category: "restaurant", location: { lat: 19.06, lng: 72.83 }, sourceLinks: bandra.sourceLinks } });
      await queue.add(link, draft({ link }));
      api.answer([lowerParel], chain);
      await queue.poll();
      expect(places(diary)).toHaveLength(3);
    });
  });

  describe("branches of a place already on the map", () => {
    const juhu: ResolvedPlace = {
      name: "Blabber All Day",
      category: "restaurant",
      location: { lat: 19.1154, lng: 72.8357 },
      address: "46 Gulmohar Road, Juhu, Mumbai",
      sourceLinks: ["https://maps.google.com/?cid=1"],
    };
    const borivali: ResolvedPlace = {
      ...juhu,
      category: "cafe-bar",
      location: { lat: 19.221, lng: 72.8621 },
      address: "Esspee Tower, Dattapada Rd, Borivali East, Mumbai",
      sourceLinks: ["https://www.eazydiner.com/mumbai/blabber-all-day-borivali-east"],
    };
    const onMap = (d: FakeDiary, p: ResolvedPlace) =>
      d.write({ type: "place", placeId: null, payload: { name: p.name, category: p.category, location: p.location, address: p.address!, sourceLinks: p.sourceLinks } });

    it("puts a re-added place's notes on the one already there, keeping its status, and says so", async () => {
      const { api, diary, queue } = setup();
      const first = await onMap(diary, juhu);
      await setStatus(diary, first.id, "visited");
      const item = await queue.add("Blabber All Day", draft({ label: "Blabber All Day", comment: "Back again" }));
      api.answer([{ ...juhu, name: "Blabber All Day - Juhu", sourceLinks: ["https://www.zomato.com/mumbai/blabber-all-day-juhu"] }]);
      await queue.poll();
      await queue.choose(item.id, 0);

      expect(places(diary)).toHaveLength(1);
      expect((await queue.list())[0]!.state).toEqual({ kind: "added", placeId: first.id, name: "Blabber All Day - Juhu", existing: true });
      const snap = diary.snapshot().places[0]!;
      expect(snap.opinions.filter((o) => o.kind === "status")).toMatchObject([{ status: "visited" }]);
      expect(snap.opinions.some((o) => o.kind === "comment")).toBe(true);
    });

    it("says a match found by its link was already in the diary", async () => {
      const { api, diary, queue } = setup();
      const first = await onMap(diary, juhu);
      await queue.add("https://maps.google.com/?cid=1", draft({ link: "https://maps.google.com/?cid=1" }));
      api.answer([juhu]);
      await queue.poll();
      expect((await queue.list())[0]!.state).toMatchObject({ kind: "added", placeId: first.id, existing: true });
    });

    it("asks whether a match with the same name elsewhere is another branch", async () => {
      const { api, diary, queue } = setup();
      const first = await onMap(diary, juhu);
      const item = await queue.add("Blabber all day - Borivali", draft({ label: "Blabber all day - Borivali", status: "visited", comment: "Mid food" }));
      api.answer([borivali]);
      await queue.poll();
      // A plain name asks first, even for one match.
      expect((await queue.choose(item.id, 0))).toBeUndefined();
      expect((await queue.list())[0]!.state).toMatchObject({ kind: "branch", chain: { id: first.id, name: "Blabber All Day" }, area: "Juhu" });
      expect(places(diary)).toHaveLength(1);

      const placeId = await queue.answerBranch(item.id, true);
      // The new branch names the first place as its chain; the app folds them into one place.
      expect(readPayload("place", diary.items.get(placeId)!.payload)!.chain).toEqual({ id: first.id, name: "Blabber All Day" });
      const view = diary.snapshot().places;
      expect(view).toHaveLength(1);
      expect(view[0]!.outlets?.map((o) => o.id)).toEqual([first.id, placeId]);
      // The note stays on the branch it was written about.
      expect(view[0]!.opinions.find((o) => o.kind === "comment")).toMatchObject({ text: "Mid food", placeId });
      expect(view[0]!.opinions.find((o) => o.kind === "comment")).not.toHaveProperty("allOutlets");
      // The admin's device writes the chain into the first place's facts.
      expect(unwrittenChains([...diary.items.values()]).map((u) => [u.item.id, u.facts.chain])).toEqual([[first.id, { id: first.id, name: "Blabber All Day" }]]);
    });

    it("keeps a different place with the same name apart when told so", async () => {
      const { api, diary, queue } = setup();
      await onMap(diary, juhu);
      const item = await queue.add("Blabber", draft({ label: "Blabber" }));
      api.answer([borivali]);
      await queue.poll();
      await queue.choose(item.id, 0);
      await queue.answerBranch(item.id, false);
      expect(diary.snapshot().places).toHaveLength(2);
    });

    it("joins a chain the place is already in", async () => {
      const { api, diary, queue } = setup();
      const chain = { id: "chain-blabber", name: "Blabber All Day" };
      await diary.write({ type: "place", placeId: null, payload: { name: juhu.name, category: "restaurant", location: juhu.location, sourceLinks: juhu.sourceLinks, chain } });
      const item = await queue.add("Blabber Borivali", draft({ label: "Blabber Borivali" }));
      api.answer([borivali]);
      await queue.poll();
      await queue.choose(item.id, 0);
      expect((await queue.list())[0]!.state).toMatchObject({ kind: "branch", chain });
    });

    it("adds to the place already on the map when it is the same spot under another link", async () => {
      const { api, diary, queue } = setup();
      const first = await onMap(diary, juhu);
      const item = await queue.add("Blabber Juhu", draft({ label: "Blabber Juhu", status: "visited" }));
      api.answer([{ ...juhu, location: { lat: 19.1156, lng: 72.8358 }, sourceLinks: ["https://www.zomato.com/mumbai/blabber-all-day-juhu"] }]);
      await queue.poll();
      await queue.choose(item.id, 0);
      expect((await queue.list()).find((i) => i.id === item.id)!.state).toMatchObject({ kind: "added", placeId: first.id });
      expect(places(diary)).toHaveLength(1);
      expect([...diary.items.values()].filter((i) => i.type === "status")).toMatchObject([{ placeId: first.id }]);
    });

    it("lets a resolver chain join a same-name place that has no chain yet", async () => {
      const { api, diary, queue } = setup();
      const first = await onMap(diary, juhu);
      const item = await queue.add("Blabber Borivali", draft({ label: "Blabber Borivali" }));
      const bandra = { ...borivali, location: { lat: 19.06, lng: 72.83 }, address: "Bandra West", sourceLinks: ["https://example.com/blabber-bandra"] };
      api.answer([borivali], { name: "Blabber All Day", outlets: [bandra] });
      await queue.poll();
      const placeId = await queue.choose(item.id, 0);
      expect(readPayload("place", diary.items.get(placeId!)!.payload)!.chain?.id).toBe(first.id);
      expect(diary.snapshot().places).toHaveLength(1);
    });
  });

  describe("finding a place on the device, without the resolver", () => {
    const era = { name: "Era", category: "restaurant", location: { lat: 19.136125, lng: 72.833576 }, address: "Dream Works, Andheri West" };
    const SHORT = "https://maps.app.goo.gl/AbCdEf123";
    // Google's share links often expand to the place's id with no pin.
    const NO_PIN = "https://www.google.com/maps/place/Era/data=!4m2!3m1!1s0x3be7b7c0a1b2c3d4:0x9e8f7a6b5c4d3e2f?utm_source=mstt_1&entry=gps";
    const SAME_CID = `https://maps.google.com/?cid=${BigInt("0x9e8f7a6b5c4d3e2f").toString()}`;

    it("puts a friend's short link onto the place someone added under another link to the same Google place", async () => {
      const { api, diary, queue } = setup();
      const first = await diary.write({ type: "place", placeId: null, payload: { ...era, sourceLinks: [SAME_CID] } });
      api.expansions.set(SHORT, NO_PIN);
      await queue.add(`Era ${SHORT}`, draft({ label: "Era", link: SHORT, status: "visited", comment: "Loud" }));
      await queue.poll();

      expect(places(diary)).toHaveLength(1);
      expect((await queue.list())[0]!.state).toEqual({ kind: "added", placeId: first.id, name: "Era", existing: true });
      // The job is closed, so the resolver never sees it.
      expect(api.jobs.size).toBe(0);
      const snap = diary.snapshot().places[0]!;
      expect(snap.opinions.filter((o) => o.kind === "status")).toMatchObject([{ status: "visited" }]);
      expect(snap.opinions.some((o) => o.kind === "comment")).toBe(true);
    });

    it("expands a short link once, and writes the place itself when the full link has the pin", async () => {
      const { api, diary, queue } = setup();
      api.expansions.set(SHORT, "https://www.google.com/maps/place/Era/@19.13,72.83,17z/data=!3m1!4b1!4m6!3m5!1s0x1:0x2!8m2!3d19.136125!4d72.833576");
      await queue.add(SHORT, draft({ label: SHORT, link: SHORT }));
      await queue.poll();
      await queue.poll();

      expect(api.expanded).toBe(1);
      const [place] = places(diary);
      expect(readPayload("place", place!.payload)).toMatchObject({ name: "Era", location: { lat: 19.136125, lng: 72.833576 } });
      expect(api.jobs.size).toBe(0);
    });

    it("leaves it to the resolver when the device can't find the place, asking the Worker only once", async () => {
      const { api, diary, queue } = setup();
      await queue.add(SHORT, draft({ label: SHORT, link: SHORT }));
      await queue.poll();
      await queue.poll();
      expect(api.expanded).toBe(1);
      expect(places(diary)).toHaveLength(0);
      expect((await queue.list())[0]!.state.kind).toBe("waiting");
      expect((await queue.list())[0]!.draft.expandedUrl).toBeNull();
    });

    it("tries the expansion again later when offline", async () => {
      const { api, queue } = setup();
      api.offline = true;
      await queue.add(SHORT, draft({ label: SHORT, link: SHORT }));
      await queue.poll();
      expect((await queue.list())[0]!.draft.expandedUrl).toBeUndefined();
    });

    it("offers a place already in the diary by name, and adds the notes to it on a yes", async () => {
      const { api, diary, queue } = setup();
      const first = await diary.write({ type: "place", placeId: null, payload: { ...era, sourceLinks: ["https://www.zomato.com/mumbai/era-veera-desai-area"] } });
      api.expansions.set(SHORT, "https://maps.google.com/?q=Era,+Dream+Works,+Andheri+West&ftid=0x1:0x5");
      const item = await queue.add(SHORT, draft({ label: SHORT, link: SHORT, comment: "Sushi" }));
      await queue.poll();

      // A name may mean another place, so it asks rather than adding by itself.
      const waiting = (await queue.list())[0]!;
      expect(waiting.state.kind).toBe("waiting");
      const known = knownForItem(await diary.listItems(), waiting, diary.device.accountId);
      expect(known).toEqual({ placeId: first.id, name: "Era" });

      await queue.useKnown(item.id, first.id);
      expect((await queue.list())[0]!.state).toEqual({ kind: "added", placeId: first.id, name: "Era", existing: true });
      expect(api.jobs.size).toBe(0);
      expect(places(diary)).toHaveLength(1);
    });
  });
});

describe("filling in wallet bleeders", () => {
  // As the resolver sends them: the name and price are worked out again when the result opens.
  const starters = {
    name: "",
    priceInr: 1,
    rule: "starters" as const,
    section: "Appetizers",
    chicken: true,
    dishes: [
      { name: "Chicken tikka", priceInr: 400 },
      { name: "Chicken 65", priceInr: 300 },
      { name: "Chicken satay", priceInr: 500 },
    ],
  };
  const burgers = { name: "", priceInr: 1, rule: "focused" as const, section: "Burgers", chicken: true, dishes: [{ name: "Chicken burger", priceInr: 285 }] };
  const ZOMATO = "https://www.zomato.com/mumbai/walters-khar";

  it("fills in only the category and wallet bleeder of a clear match, and adds the chain's missing outlets", async () => {
    const { api, diary, queue } = setup();
    const place = await diary.write({
      type: "place",
      placeId: null,
      payload: { name: "Walters Burger", category: "restaurant", location: { lat: 19.0704, lng: 72.8227 }, address: "Danda Khar", sourceLinks: [ZOMATO] },
    });
    const todo = placesNeedingWallet(await diary.listItems());
    expect(todo.map((p) => p.id)).toEqual([place.id]);
    await queue.lookUpAgain(place.id, ZOMATO, "Walters Burger", false, true);

    const match: ResolvedPlace = { name: "Walters Burger Khar", category: "one-hit-wonder", location: { lat: 19.0705, lng: 72.8228 }, cuisine: "Burgers", signatureDish: burgers, sourceLinks: [ZOMATO] };
    const powai: ResolvedPlace = { ...match, name: "Walters Burger Powai", location: { lat: 19.1206, lng: 72.9092 }, sourceLinks: ["https://www.zomato.com/mumbai/walters-powai"] };
    api.answer([match], { name: "Walters Burger", outlets: [powai] });
    await queue.poll();

    expect((await queue.list())[0]!.state.kind).toBe("added");
    const facts = readPayload("place", diary.items.get(place.id)!.payload)!;
    // The name, address and links stay; the category, wallet bleeder and cuisine come in.
    expect(facts).toMatchObject({ name: "Walters Burger", address: "Danda Khar", category: "one-hit-wonder", cuisine: "Burgers", sourceLinks: [ZOMATO] });
    expect(facts.signatureDish).toMatchObject({ name: "Chicken burgers", priceInr: 285, rule: "focused" });
    expect(facts.chain).toEqual({ id: place.id, name: "Walters Burger" });
    const outlets = places(diary).map((i) => readPayload("place", i.payload)!);
    expect(outlets.map((o) => o.name)).toEqual(["Walters Burger", "Walters Burger Powai"]);
    expect(outlets[1]!.chain).toEqual({ id: place.id, name: "Walters Burger" });
    expect(placesNeedingWallet(await diary.listItems())).toEqual([]);
  });

  it("gives every outlet of a chain the new rules from one lookup, and asks when the match is not clearly the place", async () => {
    const { api, diary, queue } = setup();
    const chain = { id: "c1", name: "Foo" };
    const a = await diary.write({ type: "place", placeId: null, payload: { name: "Foo BKC", category: "restaurant", location: { lat: 19.0534, lng: 72.8514 }, sourceLinks: ["https://z.com/foo-bkc"], chain } });
    const b = await diary.write({ type: "place", placeId: null, payload: { name: "Foo Palladium", category: "restaurant", location: { lat: 18.995, lng: 72.824 }, sourceLinks: [], chain } });
    expect(placesNeedingWallet(await diary.listItems()).map((p) => p.id)).toEqual([a.id]);
    const item = await queue.lookUpAgain(a.id, "https://z.com/foo-bkc", "Foo BKC", false, true);

    const far: ResolvedPlace = { name: "Foo", category: "restaurant", location: { lat: 19.2245, lng: 72.8634 }, signatureDish: starters, sourceLinks: ["https://z.com/foo-borivali"] };
    api.answer([far]);
    await queue.poll();
    expect((await queue.list())[0]!.state.kind).toBe("choose");
    // Nothing changed until the admin picks it.
    expect(readPayload("place", diary.items.get(a.id)!.payload)!.signatureDish).toBeUndefined();
    await queue.choose(item.id, 0);

    for (const id of [a.id, b.id]) {
      const facts = readPayload("place", diary.items.get(id)!.payload)!;
      expect(facts.signatureDish).toMatchObject({ name: "Chicken appetizers", priceInr: 400, rule: "starters" });
      expect(facts.signatureDish!.dishes).toHaveLength(3);
    }
    // The far match was not added as another outlet, and no place moved.
    expect(places(diary)).toHaveLength(2);
    expect(readPayload("place", diary.items.get(a.id)!.payload)!.location).toEqual({ lat: 19.0534, lng: 72.8514 });
  });
});

describe("Add a location", () => {
  const loyka = { id: "chain-loyka", name: "Loyka" };
  const bandra = { name: "Loyka", category: "desserts" as const, location: { lat: 19.065, lng: 72.831 }, address: "Linking Road, Bandra West, Mumbai", cuisine: "Desserts", sourceLinks: ["https://www.zomato.com/mumbai/loyka-linking-road-bandra-west"], chain: loyka };
  const OSHIWARA = "https://www.zomato.com/mumbai/loyka-oshiwara-andheri-west";
  const oshiwara: ResolvedPlace = {
    name: "Loyka Desserts & Chocolate Boudoir",
    category: "cafe-bar",
    location: { lat: 19.149, lng: 72.835 },
    address: "Oshiwara, Andheri West, Mumbai",
    sourceLinks: [OSHIWARA],
  };
  const other: ResolvedPlace = { ...oshiwara, address: "Ghatkopar East, Mumbai", location: { lat: 19.08, lng: 72.91 }, sourceLinks: ["https://www.zomato.com/mumbai/loyka-ghatkopar-east"] };

  it("joins the found place to the chain as a new location, with no opinions of its own", async () => {
    const { api, diary, queue } = setup();
    const lead = await diary.write({ type: "place", placeId: null, payload: bandra });
    await setStatus(diary, lead.id, "visited");
    await queue.addOutlet(OSHIWARA, loyka, "desserts", true);
    const [, job] = api.only();
    expect(job.query).toBe(OSHIWARA);
    // The chain's other outlets the resolver finds are not added from here.
    api.answer([oshiwara], { name: "Loyka", outlets: [other] });
    await queue.poll();

    expect(places(diary)).toHaveLength(2);
    const added = places(diary).find((p) => p.id !== lead.id)!;
    expect(readPayload("place", added.payload)).toMatchObject({ category: "desserts", chain: loyka, address: "Oshiwara, Andheri West, Mumbai" });
    expect((await queue.list())[0]!.state).toMatchObject({ kind: "added", placeId: added.id });
    const view = diary.snapshot().places;
    expect(view).toHaveLength(1);
    // Still one stamp, now naming both locations as visited.
    expect(view[0]!.opinions.filter((o) => o.kind === "status")).toMatchObject([{ status: "visited", outlets: [lead.id, added.id] }]);
  });

  it("asks when several places match, and never offers the chain itself as a known place", async () => {
    const { api, diary, queue } = setup();
    await diary.write({ type: "place", placeId: null, payload: bandra });
    const item = await queue.addOutlet("Loyka Oshiwara", loyka, "desserts", false);
    api.answer([oshiwara, other]);
    await queue.poll();
    expect((await queue.list())[0]!.state).toMatchObject({ kind: "choose" });
    expect(knownForItem([...diary.items.values()], (await queue.list())[0]!, diary.device.accountId)).toBeUndefined();
    await queue.choose(item.id, 0);
    expect(diary.snapshot().places).toHaveLength(1);
    expect([...diary.items.values()].filter((i) => i.type === "status")).toHaveLength(0);
  });

  it("fills a new location in by hand into the chain", async () => {
    const { diary, queue } = setup();
    await diary.write({ type: "place", placeId: null, payload: bandra });
    const item = await queue.addOutlet(OSHIWARA, loyka, "desserts", false);
    await queue.fillIn(item.id, { name: "Loyka", category: "desserts", location: oshiwara.location, sourceLinks: [OSHIWARA] });
    expect(diary.snapshot().places).toHaveLength(1);
    expect(diary.snapshot().places[0]!.outlets).toHaveLength(2);
  });
});
