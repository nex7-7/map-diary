import { beforeAll, describe, expect, it } from "vitest";
import sodium from "libsodium-wrappers-sumo";
import { CryptoError, createKeyBackup, openKeyBackup, ready, type KdfParams } from "../src/index.js";

// Minimum Argon2id cost keeps the suite fast; production uses defaultKdfParams().
let fast: KdfParams;

beforeAll(async () => {
  await ready();
  fast = { opsLimit: sodium.crypto_pwhash_OPSLIMIT_MIN, memLimit: sodium.crypto_pwhash_MEMLIMIT_MIN };
});

describe("passphrase key backup", () => {
  const secret = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

  it("round-trips with the right passphrase", () => {
    const backup = createKeyBackup(secret, "correct horse battery staple", fast);
    expect(openKeyBackup(backup, "correct horse battery staple")).toEqual(secret);
  });

  it("fails with the wrong passphrase", () => {
    const backup = createKeyBackup(secret, "correct horse battery staple", fast);
    expect(() => openKeyBackup(backup, "wrong")).toThrow(CryptoError);
  });

  it("fails if the server swaps the KDF parameters", () => {
    const backup = createKeyBackup(secret, "pass", fast);
    const tampered = { ...backup, opsLimit: backup.opsLimit + 1 };
    expect(() => openKeyBackup(tampered, "pass")).toThrow(CryptoError);
  });

  it("treats Unicode-equivalent passphrases as the same", () => {
    const backup = createKeyBackup(secret, "café", fast);
    expect(openKeyBackup(backup, "café")).toEqual(secret);
  });

  it("rejects an empty passphrase", () => {
    expect(() => createKeyBackup(secret, "", fast)).toThrow(CryptoError);
  });
});
