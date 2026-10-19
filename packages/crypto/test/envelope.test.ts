import { beforeAll, describe, expect, it } from "vitest";
import sodium from "libsodium-wrappers-sumo";
import {
  CryptoError,
  decryptStoredEnvelope,
  fromBase64,
  generateBoardKey,
  generateIdentity,
  openEnvelope,
  ready,
  sealEnvelope,
  signedBytes,
  toBase64,
  verifyEnvelope,
  type BoardKey,
  type Envelope,
  type IdentityKeys,
} from "../src/index";

let alice: IdentityKeys;
let mallory: IdentityKeys;
let personal: BoardKey;
let group: BoardKey;
let master: BoardKey;

beforeAll(async () => {
  await ready();
  alice = generateIdentity();
  mallory = generateIdentity();
  personal = generateBoardKey("personal-alice");
  group = generateBoardKey("group-four");
  master = generateBoardKey("master");
});

function keyring(...keys: BoardKey[]) {
  return (boardId: string, version: number) =>
    keys.find((k) => k.boardId === boardId && k.version === version)?.key;
}

function seal(boards: BoardKey[] = [personal]): Envelope {
  return sealEnvelope({
    type: "comment",
    authorId: "alice",
    deviceId: "alice-phone",
    placeId: "place-1",
    payload: { text: "Best vada pav near the station" },
    boards,
    signSecretKey: alice.signSecretKey,
  });
}

function expectCode(fn: () => unknown, code: CryptoError["code"]) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(CryptoError);
    expect((err as CryptoError).code).toBe(code);
    return;
  }
  throw new Error(`expected CryptoError ${code}`);
}

describe("sealEnvelope / openEnvelope", () => {
  it("round-trips a payload for a board member", () => {
    const env = seal();
    const opened = openEnvelope(env, {
      boardKey: keyring(personal),
      signerPublicKey: alice.signPublicKey,
    });
    expect(opened.payload).toEqual({ text: "Best vada pav near the station" });
    expect(opened.boardId).toBe("personal-alice");
  });

  it("never puts the plaintext in the stored envelope", () => {
    const json = JSON.stringify(seal());
    expect(json).not.toContain("vada pav");
  });

  it("wraps one content key per board, readable from each board", () => {
    const env = seal([group, master]);
    expect(env.boards.map((b) => b.boardId).sort()).toEqual(["group-four", "master"]);
    for (const key of [group, master]) {
      const opened = openEnvelope(env, { boardKey: keyring(key), signerPublicKey: alice.signPublicKey });
      expect(opened.boardId).toBe(key.boardId);
    }
  });

  it("refuses a reader with no key for any of its boards", () => {
    const env = seal([group]);
    expectCode(
      () => openEnvelope(env, { boardKey: keyring(personal, master), signerPublicKey: alice.signPublicKey }),
      "no_board_key",
    );
  });

  it("does not open with a rotated (newer) version of the board key", () => {
    const env = seal([group]);
    const rotated = generateBoardKey("group-four", 2);
    expectCode(
      () => openEnvelope(env, { boardKey: keyring(rotated), signerPublicKey: alice.signPublicKey }),
      "no_board_key",
    );
  });

  it("reports decrypt_failed when the held key for a board is wrong", () => {
    const env = seal([group]);
    const wrong = { ...generateBoardKey("group-four"), version: group.version };
    expectCode(
      () => openEnvelope(env, { boardKey: keyring(wrong), signerPublicKey: alice.signPublicKey }),
      "decrypt_failed",
    );
  });

  it("rejects an empty or duplicated board list", () => {
    expectCode(() => seal([]), "invalid_input");
    expectCode(() => seal([group, group]), "invalid_input");
  });

  it("keeps id and createdAt when writing a new version of an item", () => {
    const first = seal();
    const second = sealEnvelope({
      type: "comment",
      authorId: "alice",
      deviceId: "alice-laptop",
      placeId: "place-1",
      payload: { text: "Edited" },
      boards: [personal],
      signSecretKey: alice.signSecretKey,
      id: first.id,
      createdAt: first.createdAt,
      updatedAt: first.updatedAt + 1,
    });
    expect(second.id).toBe(first.id);
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
  });
});

describe("signatures and tampering", () => {
  it("verifies with the signer's key and not with another's", () => {
    const env = seal();
    expect(verifyEnvelope(env, alice.signPublicKey)).toBe(true);
    expect(verifyEnvelope(env, mallory.signPublicKey)).toBe(false);
  });

  it("rejects an envelope signed by someone else", () => {
    const env = seal();
    expectCode(
      () => openEnvelope(env, { boardKey: keyring(personal), signerPublicKey: mallory.signPublicKey }),
      "bad_signature",
    );
  });

  const tamper: [string, (e: Envelope) => Envelope][] = [
    ["authorId", (e) => ({ ...e, authorId: "mallory" })],
    ["placeId", (e) => ({ ...e, placeId: "place-2" })],
    ["type", (e) => ({ ...e, type: "status" })],
    ["updatedAt", (e) => ({ ...e, updatedAt: e.updatedAt + 1 })],
    ["boards (dropped one)", (e) => ({ ...e, boards: e.boards.slice(1) })],
    ["ciphertext", (e) => ({ ...e, ciphertext: e.ciphertext.slice(0, -2) + (e.ciphertext.endsWith("AA") ? "BB" : "AA") })],
  ];

  for (const [field, mutate] of tamper) {
    it(`detects a changed ${field}`, () => {
      const env = mutate(seal([group, master]));
      expect(verifyEnvelope(env, alice.signPublicKey)).toBe(false);
    });
  }

  it("binds wrapped keys and ciphertext to their envelope id, even if re-signed", () => {
    const a = seal([group]);
    // The author's own key re-signs a copy under a new id: only the AAD binding can catch it.
    const { signature: _sig, ...unsigned } = { ...a, id: "another-id" };
    void _sig;
    const resigned: Envelope = {
      ...unsigned,
      signature: toBase64(sodium.crypto_sign_detached(signedBytes(unsigned), alice.signSecretKey)),
    };
    expect(verifyEnvelope(resigned, alice.signPublicKey)).toBe(true);
    expectCode(
      () => openEnvelope(resigned, { boardKey: keyring(group), signerPublicKey: alice.signPublicKey }),
      "decrypt_failed",
    );
  });
});

describe("decryptStoredEnvelope", () => {
  const stored = (env: Envelope) => ({ ...env, nonce: fromBase64(env.nonce), ciphertext: fromBase64(env.ciphertext) });
  const wrap = (env: Envelope, i = 0) => {
    const b = env.boards[i]!;
    return { boardId: b.boardId, keyVersion: b.keyVersion, nonce: fromBase64(b.nonce), wrappedKey: fromBase64(b.wrappedKey) };
  };

  it("reads stored bytes through one board's wrap", () => {
    const env = seal([personal, master]);
    const i = env.boards.findIndex((b) => b.boardId === master.boardId);
    expect(decryptStoredEnvelope(stored(env), wrap(env, i), master.key)).toEqual({ text: "Best vada pav near the station" });
  });

  it("refuses the wrong key or a wrap moved to another envelope", () => {
    const env = seal([personal]);
    expectCode(() => decryptStoredEnvelope(stored(env), wrap(env), group.key), "decrypt_failed");
    const other = seal([personal]);
    expectCode(() => decryptStoredEnvelope(stored(env), wrap(other), personal.key), "decrypt_failed");
    expectCode(() => decryptStoredEnvelope({ ...stored(env), placeId: "place-2" }, wrap(env), personal.key), "decrypt_failed");
  });
});
