import { beforeAll, describe, expect, it } from "vitest";
import {
  CryptoError,
  authorizeDevice,
  deriveAccount,
  generateIdentity,
  generateRecoveryPhrase,
  parseRecoveryPhrase,
  ready,
  recoveryPhraseFromSeed,
  unwrapKeyFromMember,
  verifyDeviceAuthorization,
  wrapKeyForMember,
} from "../src/index";

beforeAll(async () => {
  await ready();
});

describe("recovery phrase", () => {
  it("prints 7 groups of 4 and reads back as typed", () => {
    const { seed, phrase } = generateRecoveryPhrase();
    expect(phrase).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){6}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(parseRecoveryPhrase(phrase)).toEqual(seed);
    expect(parseRecoveryPhrase(` ${phrase.toLowerCase().replace(/-/g, " ")} `)).toEqual(seed);
    expect(recoveryPhraseFromSeed(seed)).toBe(phrase);
  });

  it("reads look-alike letters as digits", () => {
    const seed = new Uint8Array(16); // all zeros: the phrase starts with 0s
    const phrase = recoveryPhraseFromSeed(seed);
    expect(parseRecoveryPhrase(phrase.replace(/0/g, "O"))).toEqual(seed);
  });

  it("catches typos, wrong lengths and impossible characters", () => {
    const { phrase } = generateRecoveryPhrase();
    const first = phrase[0] === "2" ? "3" : "2";
    expect(() => parseRecoveryPhrase(first + phrase.slice(1))).toThrow(CryptoError);
    expect(() => parseRecoveryPhrase(phrase.slice(0, -1))).toThrow(CryptoError);
    expect(() => parseRecoveryPhrase(phrase.slice(0, -1) + "U")).toThrow(CryptoError);
  });
});

describe("account derivation", () => {
  it("derives the same account from the same seed, and a different one otherwise", () => {
    const { seed } = generateRecoveryPhrase();
    const a = deriveAccount(seed);
    const b = deriveAccount(Uint8Array.from(seed));
    expect(b.accountId).toBe(a.accountId);
    expect(b.personalBoardId).toBe(a.personalBoardId);
    expect(b.accountKeys.signPublicKey).toEqual(a.accountKeys.signPublicKey);
    expect(b.personalBoardKey(1).key).toEqual(a.personalBoardKey(1).key);
    expect(a.personalBoardKey(2).key).not.toEqual(a.personalBoardKey(1).key);
    expect(a.accountId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(a.personalBoardId).not.toBe(a.accountId);

    const other = deriveAccount(generateRecoveryPhrase().seed);
    expect(other.accountId).not.toBe(a.accountId);
    expect(other.personalBoardKey(1).key).not.toEqual(a.personalBoardKey(1).key);
  });

  it("derives a versioned account box key that board keys can be wrapped to", () => {
    const { seed } = generateRecoveryPhrase();
    const a = deriveAccount(seed);
    const v1 = a.accountBoxKeys(1);
    expect(deriveAccount(Uint8Array.from(seed)).accountBoxKeys(1).publicKey).toEqual(v1.publicKey);
    expect(a.accountBoxKeys(2).publicKey).not.toEqual(v1.publicKey);
    expect(v1.publicKey).not.toEqual(a.accountKeys.signPublicKey);
    expect(() => a.accountBoxKeys(0)).toThrow(CryptoError);

    const boardKey = a.personalBoardKey(1).key;
    const wrapped = wrapKeyForMember(boardKey, v1.publicKey);
    const opened = unwrapKeyFromMember(wrapped, { boxPublicKey: v1.publicKey, boxSecretKey: v1.secretKey });
    expect(opened).toEqual(boardKey);
  });

  it("gives an account key that can authorise devices", () => {
    const account = deriveAccount(generateRecoveryPhrase().seed);
    const device = generateIdentity();
    const d = {
      accountId: account.accountId,
      deviceId: "dev1",
      kind: "web" as const,
      signPublicKey: device.signPublicKey,
      boxPublicKey: device.boxPublicKey,
    };
    const sig = authorizeDevice(d, account.accountKeys.signSecretKey);
    expect(verifyDeviceAuthorization(d, sig, account.accountKeys.signPublicKey)).toBe(true);
  });

  it("rejects bad seeds and versions", () => {
    expect(() => deriveAccount(new Uint8Array(15))).toThrow(CryptoError);
    expect(() => deriveAccount(new Uint8Array(16)).personalBoardKey(0)).toThrow(CryptoError);
  });
});
