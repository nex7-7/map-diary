import { beforeAll, describe, expect, it } from "vitest";
import { CryptoError, generateBoardKey, linkHash, linkHashKey, ready } from "../src/index";

beforeAll(async () => {
  await ready();
});

describe("link hashes", () => {
  it("gives every holder of the master key the same hash, and others a different one", () => {
    const master = generateBoardKey("master");
    const other = generateBoardKey("master");
    const a = linkHash(linkHashKey(master.key), "maps.google.com/?cid=1");
    expect(a).toHaveLength(32);
    expect(linkHash(linkHashKey(master.key), "maps.google.com/?cid=1")).toEqual(a);
    expect(linkHash(linkHashKey(master.key), "maps.google.com/?cid=2")).not.toEqual(a);
    expect(linkHash(linkHashKey(other.key), "maps.google.com/?cid=1")).not.toEqual(a);
  });

  it("rejects a bad key or an empty link", () => {
    expect(() => linkHashKey(new Uint8Array(16))).toThrow(CryptoError);
    expect(() => linkHash(linkHashKey(generateBoardKey("m").key), "")).toThrow(CryptoError);
  });
});
