import { beforeAll, describe, expect, it } from "vitest";
import {
  CryptoError,
  generateIdentity,
  generatePairingSecret,
  normalisePairingSecret,
  openAccountTransfer,
  pairingCode,
  pairingId,
  pairingJoinMac,
  randomId,
  ready,
  sealAccountTransfer,
  verifyPairingJoinMac,
  type PairingJoin,
} from "../src/index";

beforeAll(async () => {
  await ready();
});

function join(): PairingJoin {
  const keys = generateIdentity();
  return { deviceId: randomId(), kind: "android", signPublicKey: keys.signPublicKey, boxPublicKey: keys.boxPublicKey };
}

describe("device pairing", () => {
  it("makes a typable secret that reads back however it is typed", () => {
    const secret = generatePairingSecret();
    expect(secret).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    expect(normalisePairingSecret(` ${secret.toLowerCase().replace("-", " ")} `)).toBe(secret);
    expect(normalisePairingSecret("00000-0000O")).toBe("00000-00000");
    expect(normalisePairingSecret("ABCDE-FGHJ")).toBeNull();
    expect(normalisePairingSecret("ABCDE-FGHJU")).toBeNull();
  });

  it("derives a stable id that differs per secret", () => {
    const secret = generatePairingSecret();
    expect(pairingId(secret)).toBe(pairingId(secret.toLowerCase()));
    expect(pairingId(secret)).not.toBe(pairingId(generatePairingSecret()));
    expect(() => pairingId("AAAA")).toThrow(CryptoError);
  });

  it("binds the new device's keys to the secret", () => {
    const secret = generatePairingSecret();
    const j = join();
    const mac = pairingJoinMac(secret, j);
    expect(verifyPairingJoinMac(secret, j, mac)).toBe(true);
    // A server swapping in its own keys, or someone without the link, fails the check.
    expect(verifyPairingJoinMac(secret, { ...j, boxPublicKey: join().boxPublicKey }, mac)).toBe(false);
    expect(verifyPairingJoinMac(generatePairingSecret(), j, mac)).toBe(false);
    expect(verifyPairingJoinMac(secret, j, "not-a-mac")).toBe(false);
  });

  it("shows the same short code on both screens, and a different one for other keys", () => {
    const secret = generatePairingSecret();
    const j = join();
    const code = pairingCode(secret, j);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{3}-[0-9A-HJKMNP-TV-Z]{3}$/);
    expect(pairingCode(secret, { ...j })).toBe(code);
    expect(pairingCode(secret, join())).not.toBe(code);
  });

  it("seals the account keys so only the new device can open them", () => {
    const device = generateIdentity();
    const box = generateIdentity();
    const transfer = {
      accountId: randomId(),
      personalBoardId: randomId(),
      accountBox: { version: 2, publicKey: box.boxPublicKey, secretKey: box.boxSecretKey },
    };
    const sealed = sealAccountTransfer(transfer, device.boxPublicKey);
    expect(openAccountTransfer(sealed, device)).toEqual(transfer);
    expect(() => openAccountTransfer(sealed, generateIdentity())).toThrow(CryptoError);
  });
});
