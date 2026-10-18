import { IDBFactory } from "fake-indexeddb";
import { beforeAll, describe, expect, it } from "vitest";
import { generateIdentity, ready, type Envelope } from "@map-diary/crypto";
import { IdbStorage, MemoryStorage, type DeviceState, type DiaryItem, type DiaryStorage } from "../src/index";

beforeAll(async () => {
  await ready();
});

function item(id: string, updatedAt: number, text = "x"): DiaryItem {
  return {
    id,
    type: "comment",
    authorId: "acct",
    deviceId: "dev",
    placeId: "p1",
    createdAt: 1,
    updatedAt,
    boardIds: ["b1"],
    payload: { text },
  };
}

// The storage layer treats envelopes as opaque; only id and updatedAt matter here.
function envelope(id: string, updatedAt: number): Envelope {
  return { id, updatedAt } as Envelope;
}

const implementations: [string, () => Promise<DiaryStorage>][] = [
  ["MemoryStorage", async () => new MemoryStorage()],
  ["IdbStorage", () => IdbStorage.open(new IDBFactory())],
];

describe.each(implementations)("%s", (_name, make) => {
  it("keeps the device state, keys included", async () => {
    const s = await make();
    expect(await s.loadDevice()).toBeUndefined();
    const device: DeviceState = {
      v: 2,
      accountId: "acct",
      deviceId: "dev",
      kind: "web",
      identity: generateIdentity(),
      accountBox: { version: 1, publicKey: new Uint8Array(32).fill(1), secretKey: new Uint8Array(32).fill(2) },
      personalBoardId: "b1",
      boardKeys: [{ boardId: "b1", version: 1, key: new Uint8Array(32).fill(3) }],
      createdAt: 5,
    };
    await s.saveDevice(device);
    expect(await s.loadDevice()).toEqual(device);
    await s.clear();
    expect(await s.loadDevice()).toBeUndefined();

    // A device stored before board keys were wrapped per account has to sign in again.
    const { accountBox: _, ...old } = device;
    await s.saveDevice({ ...old, v: 1 } as unknown as DeviceState);
    expect(await s.loadDevice()).toBeUndefined();
  });

  it("applies pulled items last-write-wins and saves the cursor", async () => {
    const s = await make();
    expect(await s.getCursor()).toBe(0);
    expect(await s.applyPull({ items: [item("a", 10, "first")], deleted: [], cursor: 4 })).toEqual(["a"]);
    expect(await s.applyPull({ items: [item("a", 9, "older")], deleted: [], cursor: 5 })).toEqual([]);
    expect((await s.getItem("a"))?.payload).toEqual({ text: "first" });
    expect(await s.applyPull({ items: [item("a", 11, "newer")], deleted: [] })).toEqual(["a"]);
    expect((await s.getItem("a"))?.payload).toEqual({ text: "newer" });
    expect(await s.getCursor()).toBe(5);
  });

  it("queues local writes and settles only the version that was sent", async () => {
    const s = await make();
    await s.writeLocal(item("a", 10), envelope("a", 10));
    await s.writeLocal(item("b", 10), envelope("b", 10));
    await s.writeLocal(item("b", 12), envelope("b", 12)); // edited while the first push was in flight
    expect((await s.listOutbox()).map((e) => [e.id, e.updatedAt]).sort()).toEqual([["a", 10], ["b", 12]]);
    await s.settleOutbox([{ id: "a", updatedAt: 10 }, { id: "b", updatedAt: 10 }]);
    expect((await s.listOutbox()).map((e) => e.id)).toEqual(["b"]);
    expect((await s.listItems()).map((i) => i.id).sort()).toEqual(["a", "b"]);
  });

  it("keeps a local delete over a pulled update, and drops everything on a pulled delete", async () => {
    const s = await make();
    await s.writeLocal(item("a", 10), envelope("a", 10));
    await s.deleteLocal("a");
    expect(await s.getItem("a")).toBeUndefined();
    expect(await s.listOutbox()).toEqual([]);
    expect(await s.listPendingDeletes()).toEqual(["a"]);
    expect(await s.applyPull({ items: [item("a", 20)], deleted: [] })).toEqual([]);
    expect(await s.getItem("a")).toBeUndefined();

    await s.writeLocal(item("b", 10), envelope("b", 10));
    expect(await s.applyPull({ items: [], deleted: ["a", "b"] })).toEqual(["b"]);
    expect(await s.listItems()).toEqual([]);
    expect(await s.listOutbox()).toEqual([]);
    expect(await s.listPendingDeletes()).toEqual([]);

    await s.deleteLocal("c");
    await s.settleDeletes(["c"]);
    expect(await s.listPendingDeletes()).toEqual([]);
  });
});
