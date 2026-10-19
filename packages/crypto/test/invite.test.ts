import { beforeAll, describe, expect, it } from "vitest";
import {
  CryptoError,
  generateBoardKey,
  generateInviteSecret,
  inviteId,
  inviteToken,
  inviteTokenHash,
  isInviteSecret,
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
    const secret = generateInviteSecret();
    expect(isInviteSecret(secret)).toBe(true);
    expect(isInviteSecret("not-a-secret")).toBe(false);
    expect(inviteId(secret)).toBe(inviteId(secret));
    expect(inviteId(secret)).not.toBe(inviteId(generateInviteSecret()));
    expect(inviteToken(secret)).not.toContain(inviteId(secret));
    expect(toBase64(inviteTokenHash(inviteToken(secret)))).toBe(toBase64(inviteTokenHash(inviteToken(secret))));
  });

  it("carries every key version and the name to whoever holds the link", () => {
    const secret = generateInviteSecret();
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
    const secret = generateInviteSecret();
    const sealed = sealGroupInvite(secret, {
      boardId: "g1",
      groupName: "x",
      keys: [{ version: 1, key: generateBoardKey("g1").key }],
    });
    expect(() => openGroupInvite(generateInviteSecret(), sealed)).toThrow(CryptoError);
    const flipped = sealed.sealedKeys.startsWith("A") ? "B" + sealed.sealedKeys.slice(1) : "A" + sealed.sealedKeys.slice(1);
    expect(() => openGroupInvite(secret, { ...sealed, sealedKeys: flipped })).toThrow(CryptoError);
  });
});
