import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { IdbPendingStore, type PendingItem } from "../lib/pending";

function pending(id: string): PendingItem {
  return {
    id,
    query: "Cafe Madras, Matunga",
    draft: { label: "Cafe Madras", status: "want", tagIds: [], newTags: [], comment: "dosa with Ravi" },
    createdAt: 1,
    updatedAt: 1,
    state: {
      kind: "waiting",
      jobId: "j1",
      publicKey: new Uint8Array(32).fill(1),
      secretKey: new Uint8Array(32).fill(2),
      expiresAt: 9,
    },
  };
}

function rawItems(factory: IDBFactory): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const open = factory.open("map-diary-pending");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const req = open.result.transaction("pending", "readonly").objectStore("pending").getAll();
      req.onsuccess = () => {
        open.result.close();
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    };
  });
}

describe("IdbPendingStore", () => {
  it("keeps pending places sealed, job keys included, and opens them again", async () => {
    const factory = new IDBFactory();
    const store = await IdbPendingStore.open(factory);
    await store.put(pending("p1"));
    expect(await store.get("p1")).toEqual(pending("p1"));
    expect(await store.list()).toEqual([pending("p1")]);

    const raw = await rawItems(factory);
    expect(Object.keys(raw[0] as object).sort()).toEqual(["ct", "id", "iv"]);
    expect(JSON.stringify(raw)).not.toContain("Madras");

    await store.delete("p1");
    expect(await store.list()).toEqual([]);
  });

  it("seals what a version before sealing stored in the clear", async () => {
    const factory = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
      const open = factory.open("map-diary-pending", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("pending", { keyPath: "id" });
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction("pending", "readwrite");
        tx.objectStore("pending").put(pending("old"));
        tx.oncomplete = () => {
          open.result.close();
          resolve();
        };
      };
    });
    const store = await IdbPendingStore.open(factory);
    expect(await store.get("old")).toEqual(pending("old"));
    expect(JSON.stringify(await rawItems(factory))).not.toContain("Madras");
  });
});
