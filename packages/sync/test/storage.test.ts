import { IDBFactory } from "fake-indexeddb";
import { beforeAll, describe, expect, it } from "vitest";
import { generateIdentity, ready, type Envelope } from "@map-diary/crypto";
import { IDB_NAME, IdbStorage, MemoryStorage, type DeviceState, type DiaryItem, type DiaryStorage } from "../src/index";

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
    expect((await s.listOutbox()).map((e) => [e.id, e.updatedAt]).sort()).toEqual([
      ["a", 10],
      ["b", 12],
    ]);
    await s.settleOutbox([
      { id: "a", updatedAt: 10 },
      { id: "b", updatedAt: 10 },
    ]);
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

describe("IdbStorage at rest", () => {
  function raw(factory: IDBFactory, store: string): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
      const open = factory.open(IDB_NAME);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const req = open.result.transaction(store, "readonly").objectStore(store).getAll();
        req.onsuccess = () => {
          open.result.close();
          resolve(req.result);
        };
        req.onerror = () => reject(req.error);
      };
    });
  }

  function put(factory: IDBFactory, store: string, value: unknown, key?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const open = factory.open(IDB_NAME);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction(store, "readwrite");
        tx.objectStore(store).put(value, key);
        tx.oncomplete = () => {
          open.result.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }

  const device = (): DeviceState => ({
    v: 2,
    accountId: "acct",
    deviceId: "dev",
    kind: "web",
    identity: generateIdentity(),
    accountBox: { version: 1, publicKey: new Uint8Array(32).fill(1), secretKey: new Uint8Array(32).fill(2) },
    personalBoardId: "b1",
    boardKeys: [{ boardId: "b1", version: 1, key: new Uint8Array(32).fill(3) }],
    createdAt: 5,
  });

  it("stores keys and items only in sealed form, under a key that cannot be exported", async () => {
    const factory = new IDBFactory();
    const s = await IdbStorage.open(factory);
    await s.saveDevice(device());
    await s.writeLocal(item("a", 10, "secret note"), envelope("a", 10));
    await s.applyPull({ items: [item("b", 11, "pulled note")], deleted: [] });
    s.close();

    const [storedDevice] = await raw(factory, "device");
    expect(storedDevice).toEqual({ iv: expect.any(Uint8Array), ct: expect.any(Uint8Array) });
    const items = await raw(factory, "items");
    expect(items).toHaveLength(2);
    for (const i of items) expect(Object.keys(i as object).sort()).toEqual(["ct", "id", "iv", "updatedAt"]);
    expect(JSON.stringify(items)).not.toContain("note");
    const key = (await raw(factory, "meta")).find((v) => v instanceof CryptoKey) as CryptoKey;
    expect(key.extractable).toBe(false);

    const again = await IdbStorage.open(factory);
    expect((await again.loadDevice())?.boardKeys[0]?.key).toEqual(new Uint8Array(32).fill(3));
    expect((await again.getItem("a"))?.payload).toEqual({ text: "secret note" });
    expect((await again.listItems()).map((i) => i.id).sort()).toEqual(["a", "b"]);
  });

  it("seals a device and items stored in the clear by an older version", async () => {
    const factory = new IDBFactory();
    (await IdbStorage.open(factory)).close();
    const d = device();
    await put(factory, "device", d, "self");
    await put(factory, "items", item("old", 3, "plain note"));
    await put(factory, "meta", false, "sealed");

    const s = await IdbStorage.open(factory);
    expect(await s.loadDevice()).toEqual(d);
    expect((await s.getItem("old"))?.payload).toEqual({ text: "plain note" });
    s.close();
    expect(JSON.stringify(await raw(factory, "items"))).not.toContain("plain note");
    const [storedDevice] = await raw(factory, "device");
    expect(storedDevice).toEqual({ iv: expect.any(Uint8Array), ct: expect.any(Uint8Array) });
  });
});
