import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "@map-diary/crypto";
import { decodeKeyBundle, encodeKeyBundle, type KeyBundle } from "../src/device";
import { SetupError, checkPassphrase } from "../src/account";

beforeAll(async () => {
  await ready();
});

describe("key bundle", () => {
  it("round-trips and refuses anything else", () => {
    const bundle: KeyBundle = {
      v: 2,
      recoverySeed: new Uint8Array(16).fill(1),
      accountId: "acct",
      personalBoardId: "b1",
    };
    expect(decodeKeyBundle(encodeKeyBundle(bundle))).toEqual(bundle);
    const enc = new TextEncoder();
    expect(() => decodeKeyBundle(enc.encode("bundle"))).toThrow();
    expect(() => decodeKeyBundle(enc.encode(JSON.stringify({ v: 2 })))).toThrow();
    // A v1 bundle (board keys inside, before they were wrapped per account) is refused.
    expect(() =>
      decodeKeyBundle(enc.encode(JSON.stringify({ v: 1, recoverySeed: "AQ", accountId: "a", personalBoardId: "b", boardKeys: [] }))),
    ).toThrow();
  });
});

describe("passphrase rules", () => {
  it("needs at least 12 characters and a hard-to-guess passphrase", async () => {
    await expect(checkPassphrase("short one")).rejects.toThrow(SetupError);
    await expect(checkPassphrase("password1234")).rejects.toMatchObject({ code: "passphrase_too_weak" });
    await expect(checkPassphrase("qwertyuiop123")).rejects.toMatchObject({ code: "passphrase_too_weak" });
    await expect(checkPassphrase("vada pav at 4am")).resolves.toBeUndefined();
  });
});
