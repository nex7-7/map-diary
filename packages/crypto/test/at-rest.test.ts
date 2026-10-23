import { beforeAll, describe, expect, it } from "vitest";
import {
  CryptoError,
  generateAtRestKey,
  isAtRestKey,
  isAtRestSealed,
  openAtRest,
  ready,
  sealAtRest,
} from "../src/index";

beforeAll(async () => {
  await ready();
});

describe("at-rest sealing", () => {
  it("round-trips values, byte arrays included", async () => {
    const key = await generateAtRestKey();
    const value = {
      name: "Cafe Madras",
      keys: { secret: new Uint8Array([1, 2, 3]) },
      list: [1, null, "x"],
    };
    const sealed = await sealAtRest(key, "items:p1", value);
    expect(isAtRestSealed(sealed)).toBe(true);
    expect(new TextDecoder().decode(sealed.ct)).not.toContain("Cafe Madras");
    const opened = (await openAtRest(key, "items:p1", sealed)) as typeof value;
    expect(opened.name).toBe("Cafe Madras");
    expect(opened.keys.secret).toBeInstanceOf(Uint8Array);
    expect([...opened.keys.secret]).toEqual([1, 2, 3]);
    expect(opened.list).toEqual([1, null, "x"]);
  });

  it("uses a fresh nonce every time", async () => {
    const key = await generateAtRestKey();
    const a = await sealAtRest(key, "c", "same");
    const b = await sealAtRest(key, "c", "same");
    expect(a.iv).not.toEqual(b.iv);
    expect(a.ct).not.toEqual(b.ct);
  });

  it("refuses another record's context, another key, and tampering", async () => {
    const key = await generateAtRestKey();
    const sealed = await sealAtRest(key, "items:a", { text: "hi" });
    await expect(openAtRest(key, "items:b", sealed)).rejects.toBeInstanceOf(CryptoError);
    await expect(openAtRest(await generateAtRestKey(), "items:a", sealed)).rejects.toBeInstanceOf(CryptoError);
    const ct = sealed.ct.slice();
    ct[0] = (ct[0] ?? 0) ^ 1;
    await expect(openAtRest(key, "items:a", { iv: sealed.iv, ct })).rejects.toBeInstanceOf(CryptoError);
  });

  it("makes a key that cannot be exported", async () => {
    const key = await generateAtRestKey();
    expect(isAtRestKey(key)).toBe(true);
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
  });
});
