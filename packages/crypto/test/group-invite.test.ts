import { beforeAll, describe, expect, it } from "vitest";
import {
  CryptoError,
  generateBoardKey,
  generateGroupInviteSecret,
  groupInviteId,
  groupInviteToken,
  groupInviteTokenHash,
  isGroupInviteSecret,
  openGroupInvite,
  ready,
  sealGroupInvite,
  toBase64,
} from "../src/index";

beforeAll(async () => {
  await ready();
});

describe("group invites", () => {
  it("derives an id and token that differ per secret and from each other", () => {
    const secret = generateGroupInviteSecret();
    expect(isGroupInviteSecret(secret)).toBe(true);
    expect(isGroupInviteSecret("not-a-secret")).toBe(false);
    expect(groupInviteId(secret)).toBe(groupInviteId(secret));
    expect(groupInviteId(secret)).not.toBe(groupInviteId(generateGroupInviteSecret()));
    expect(groupInviteToken(secret)).not.toContain(groupInviteId(secret));
    expect(toBase64(groupInviteTokenHash(groupInviteToken(secret)))).toBe(toBase64(groupInviteTokenHash(groupInviteToken(secret))));
  });

  it("carries every key version and the name to whoever holds the link", () => {
    const secret = generateGroupInviteSecret();
    const v1 = generateBoardKey("g1", 1);
    const v2 = generateBoardKey("g1", 2);
    const sealed = sealGroupInvite(secret, {
      boardId: "g1",
      groupName: "Bandra lot",
      keys: [v1, v2].map((k) => ({ version: k.version, key: k.key })),
    });
    const opened = openGroupInvite(secret, sealed);
    expect(opened.boardId).toBe("g1");
    expect(opened.groupName).toBe("Bandra lot");
    expect(opened.keys.map((k) => [k.version, toBase64(k.key)])).toEqual([
      [1, toBase64(v1.key)],
      [2, toBase64(v2.key)],
    ]);
  });

  it("refuses another secret and a tampered invite", () => {
    const secret = generateGroupInviteSecret();
    const sealed = sealGroupInvite(secret, {
      boardId: "g1",
      groupName: "x",
      keys: [{ version: 1, key: generateBoardKey("g1").key }],
    });
    expect(() => openGroupInvite(generateGroupInviteSecret(), sealed)).toThrow(CryptoError);
    const flipped = sealed.sealedKeys.startsWith("A") ? "B" + sealed.sealedKeys.slice(1) : "A" + sealed.sealedKeys.slice(1);
    expect(() => openGroupInvite(secret, { ...sealed, sealedKeys: flipped })).toThrow(CryptoError);
  });
});
