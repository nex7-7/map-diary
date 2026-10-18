import { beforeAll, describe, expect, it } from "vitest";
import {
  CryptoError,
  generateBoardKey,
  generateIdentity,
  ready,
  unwrapKeyFromMember,
  wrapKeyForMember,
} from "../src/index.js";

beforeAll(async () => {
  await ready();
});

describe("board key wrapping", () => {
  it("lets only the addressed member unwrap a board key", () => {
    const bob = generateIdentity();
    const eve = generateIdentity();
    const group = generateBoardKey("group-two");

    const wrapped = wrapKeyForMember(group.key, bob.boxPublicKey);
    expect(unwrapKeyFromMember(wrapped, bob)).toEqual(group.key);
    expect(() => unwrapKeyFromMember(wrapped, eve)).toThrow(CryptoError);
  });

  it("generates distinct keys and rejects bad versions", () => {
    expect(generateBoardKey("a").key).not.toEqual(generateBoardKey("a").key);
    expect(() => generateBoardKey("a", 0)).toThrow(CryptoError);
  });
});
