import { beforeAll, describe, expect, it } from "vitest";
import { fromBase64, ready, sealResolverResult, toBase64, type EnvelopeType, type JsonValue, type ResolvedPlace } from "@map-diary/crypto";
import { ApiError, type ResolverJobResponse } from "@map-diary/sync";
import type { StoredItem } from "../lib/places/items-source";
import { GONE_GRACE_MS, PendingQueue, UNSENT_GRACE_MS, type ResolverApi } from "../lib/pending/queue";
import type { PendingDraft } from "../lib/pending/store";
import { DiaryPendingStore, encodePending, readPendingItem } from "../lib/pending/synced";

beforeAll(ready);

type Stored = StoredItem & { deviceId: string };

/** The server's copy of every item: each device pushes to it at once and pulls on refresh. */
class Cloud {
  items = new Map<string, Stored>();
}

/** One device's diary: a local copy of the items, which it pushes at once and pulls on sync. */
class DeviceDiary {
  readonly device: { accountId: string; deviceId: string; personalBoardId: string };
  items = new Map<string, Stored>();
  /** False while this device has not pulled (closed, or offline). */
  pulls = true;
  private n = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly cloud: Cloud,
    deviceId: string,
    private readonly clock: { now: () => number },
  ) {
    this.device = { accountId: "acct-me", deviceId, personalBoardId: "board-personal" };
  }
  async listItems() {
    return [...this.items.values()];
  }
  async getItem(id: string) {
    return this.items.get(id);
  }
  async write(input: { type: EnvelopeType; placeId: string | null; payload: JsonValue; id?: string; boards?: readonly string[] }) {
    const id = input.id ?? `${this.device.deviceId}-${++this.n}`;
    const prior = this.items.get(id);
    const now = this.clock.now() + ++this.n;
    const item: Stored = {
      id,
      type: input.type,
      authorId: this.device.accountId,
      deviceId: this.device.deviceId,
      placeId: input.placeId,
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
      boardIds: input.boards ? [...input.boards] : (prior?.boardIds ?? [this.device.personalBoardId]),
      payload: input.payload,
    };
    this.items.set(id, item);
    this.cloud.items.set(id, item);
    for (const l of this.listeners) l();
    return item;
  }
  async remove(id: string) {
    this.items.delete(id);
    this.cloud.items.delete(id);
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async sync() {
    if (!this.pulls) return;
    this.items = new Map(this.cloud.items);
    for (const l of this.listeners) l();
  }
}

class FakeResolver implements ResolverApi {
  jobs = new Map<string, { replyPublicKey: string; status: ResolverJobResponse["status"]; sealedResult?: string }>();
  private n = 0;
  async submitResolverJob(_query: string, replyPublicKey: string): Promise<ResolverJobResponse> {
    const id = `job-${++this.n}`;
    this.jobs.set(id, { replyPublicKey, status: "pending" });
    return { id, status: "pending", expiresAt: 2_000_000_000_000 };
  }
  async getResolverJob(id: string): Promise<ResolverJobResponse> {
    const job = this.jobs.get(id);
    if (!job) throw new ApiError(404, "not_found");
    return { id, status: job.status, expiresAt: 2_000_000_000_000, ...(job.sealedResult ? { sealedResult: job.sealedResult } : {}) };
  }
  async takeResolverJob(id: string) {
    const job = this.jobs.get(id);
    if (!job?.sealedResult) throw new ApiError(404, "not_found");
    this.jobs.delete(id);
    return { sealedResult: job.sealedResult };
  }
  async deleteResolverJob(id: string): Promise<undefined> {
    this.jobs.delete(id);
    return undefined;
  }
  async expandMapsLink(): Promise<{ url: string }> {
    throw new ApiError(422, "not_expanded");
  }
  answer(candidates: ResolvedPlace[]) {
    for (const job of this.jobs.values()) {
      job.status = "resolved";
      job.sealedResult = toBase64(sealResolverResult({ v: 1, candidates }, fromBase64(job.replyPublicKey)));
    }
  }
}

const KYANI = "https://www.zomato.com/mumbai/kyani-co-marine-lines";
const kyani: ResolvedPlace = { name: "Kyani & Co.", category: "restaurant", location: { lat: 18.9447, lng: 72.8277 }, sourceLinks: [KYANI] };
const draft: PendingDraft = { label: "Kyani", link: KYANI, status: "want", tagIds: [], newTags: [], comment: "Bun maska" };

function setup() {
  let t = 1_760_000_000_000;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const cloud = new Cloud();
  const api = new FakeResolver();
  const device = (id: string) => {
    const diary = new DeviceDiary(cloud, id, clock);
    return { diary, queue: new PendingQueue(new DiaryPendingStore(diary), api, diary, clock.now) };
  };
  return { clock, cloud, api, phone: device("phone"), laptop: device("laptop") };
}

const places = (d: DeviceDiary) => [...d.items.values()].filter((i) => i.type === "place");

describe("pending places across devices", () => {
  it("keeps the one-time key only inside the item's payload, on the Personal board", async () => {
    const { phone, cloud } = setup();
    const item = await phone.queue.add(KYANI, draft);
    const stored = cloud.items.get(item.id)!;
    expect(stored.type).toBe("pending");
    expect(stored.boardIds).toEqual(["board-personal"]);
    expect(item.state.kind).toBe("waiting");
    const back = readPendingItem(item.id, stored.payload);
    expect(back).toEqual(item);
    expect(readPendingItem("x", encodePending({ ...item, state: { kind: "waiting", jobId: "j", publicKey: new Uint8Array(3), secretKey: new Uint8Array(3), expiresAt: 1 } }))).toBeUndefined();
  });

  it("finishes a place on another device while the one that added it is closed", async () => {
    const { phone, laptop, api } = setup();
    await phone.queue.add(KYANI, draft);
    phone.diary.pulls = false;
    api.answer([kyani]);

    await laptop.queue.poll();
    expect(places(laptop.diary)).toHaveLength(1);
    expect((await laptop.queue.list())[0]!.state).toMatchObject({ kind: "added", name: "Kyani & Co." });
    expect(api.jobs.size).toBe(0);

    // The phone opens later: it sees the place as added, and writes nothing twice.
    phone.diary.pulls = true;
    await phone.queue.poll();
    expect(places(phone.diary)).toHaveLength(1);
    expect((await phone.queue.list())[0]!.state.kind).toBe("added");
    expect([...phone.diary.items.values()].filter((i) => i.type === "comment")).toHaveLength(1);
  });

  it("lets only one device take an answer, and the other waits for its copy", async () => {
    const { phone, laptop, api, clock } = setup();
    await phone.queue.add(KYANI, draft);
    await laptop.diary.sync();
    api.answer([kyani]);

    // The laptop takes the answer while the phone has not pulled since.
    phone.diary.pulls = false;
    await laptop.queue.poll();
    await phone.queue.poll();
    expect((await phone.queue.list())[0]!.state.kind).toBe("waiting");
    expect(places(phone.diary)).toHaveLength(0);

    phone.diary.pulls = true;
    await phone.queue.poll();
    expect((await phone.queue.list())[0]!.state.kind).toBe("added");
    expect(places(phone.diary)).toHaveLength(1);

    // A job gone with no copy arriving counts as failed after a while.
    const { link: _link, ...noLink } = draft;
    await phone.queue.add("Nowhere café", { ...noLink, label: "Nowhere" });
    api.jobs.clear();
    await phone.queue.poll();
    expect((await phone.queue.list()).find((i) => i.query === "Nowhere café")!.state.kind).toBe("waiting");
    clock.advance(GONE_GRACE_MS + 1);
    await phone.queue.poll();
    expect((await phone.queue.list()).find((i) => i.query === "Nowhere café")!.state).toEqual({ kind: "failed", reason: "expired" });
  });

  it("leaves an unsent item to the device that saved it for a while", async () => {
    const { phone, laptop, api, clock } = setup();
    const offline = api.submitResolverJob.bind(api);
    api.submitResolverJob = async () => {
      throw new ApiError(503, "queue_full");
    };
    await phone.queue.add(KYANI, draft);
    api.submitResolverJob = offline;

    await laptop.queue.poll();
    expect(api.jobs.size).toBe(0);
    clock.advance(UNSENT_GRACE_MS + 1);
    await laptop.queue.poll();
    expect(api.jobs.size).toBe(1);
    expect((await laptop.queue.list())[0]!.state.kind).toBe("waiting");
  });

  it("tells the Inbox when an item arrives from another device", async () => {
    const { phone, laptop } = setup();
    let calls = 0;
    const off = laptop.queue.subscribe(() => calls++);
    await phone.queue.add(KYANI, draft);
    await laptop.diary.sync();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBeGreaterThan(0);
    expect(await laptop.queue.list()).toHaveLength(1);
    off();
  });
});
