import { beforeAll, describe, expect, it } from "vitest";
import { CryptoError, generateBoardKey, linkHash, linkHashKey, normaliseLink, ready } from "../src/index";

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

describe("normaliseLink", () => {
  it("drops the scheme, www, tracking parameters and trailing slash", () => {
    expect(normaliseLink("https://www.zomato.com/mumbai/x/info/?utm_source=share")).toBe("zomato.com/mumbai/x/info");
    expect(normaliseLink("https://maps.app.goo.gl/AbC?g_st=iw")).toBe("maps.app.goo.gl/AbC");
    expect(normaliseLink("https://example.com/p?b=2&a=1")).toBe("example.com/p?a=1&b=2");
  });
});
