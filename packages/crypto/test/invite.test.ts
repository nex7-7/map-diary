import { beforeAll, describe, expect, it } from "vitest";
import {
  appInviteBoxKeys,
  appInviteId,
  generateBoardKey,
  generateInviteCode,
  normaliseInviteCode,
  ready,
  unwrapKeyFromMember,
  wrapKeyForMember,
} from "../src/index";

beforeAll(async () => {
  await ready();
});

describe("app invites", () => {
  it("makes a 20-character code that reads back however it is typed", () => {
    const code = generateInviteCode();
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{5}-){3}[0-9A-HJKMNP-TV-Z]{5}$/);
    expect(normaliseInviteCode(` ${code.toLowerCase().replace(/-/g, " ")} `)).toBe(code);
    expect(normaliseInviteCode("O0000-00000-00000-0000L")).toBe("00000-00000-00000-00001");
    expect(normaliseInviteCode("00000-00000-00000-0000")).toBeNull();
    expect(normaliseInviteCode("00000-00000-00000-0000U")).toBeNull();
  });

  it("derives a stable id and key that differ per code and from each other", () => {
    const code = generateInviteCode();
    expect(appInviteId(code)).toBe(appInviteId(code.toLowerCase()));
    expect(appInviteId(code)).not.toBe(appInviteId(generateInviteCode()));
    expect(appInviteId(code)).toHaveLength(22);
    expect(appInviteBoxKeys(code).boxPublicKey).toEqual(appInviteBoxKeys(code.replace(/-/g, "")).boxPublicKey);
    expect(appInviteBoxKeys(code).boxPublicKey).not.toEqual(appInviteBoxKeys(generateInviteCode()).boxPublicKey);
    expect(() => appInviteId("not a code")).toThrow();
  });

  it("carries a board key that only the code opens", () => {
    const code = generateInviteCode();
    const board = generateBoardKey("master");
    const wrapped = wrapKeyForMember(board.key, appInviteBoxKeys(code).boxPublicKey);
    expect(unwrapKeyFromMember(wrapped, appInviteBoxKeys(code.toLowerCase()))).toEqual(board.key);
    expect(() => unwrapKeyFromMember(wrapped, appInviteBoxKeys(generateInviteCode()))).toThrow();
  });
});
