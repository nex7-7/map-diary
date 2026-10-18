// The device-side flows in @map-diary/sync, run against the real Worker and a local D1.
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { generateBoardKey, randomId, ready, toBase64, wrapKeyForMember, type BoardKey } from "@map-diary/crypto";
import {
  Api,
  Diary,
  MemoryStorage,
  SetupError,
  prepareSetup,
  signInWithPassphrase,
  signInWithRecoveryPhrase,
  type DeviceState,
} from "@map-diary/sync";

await ready();

// Cheapest Argon2id settings the API accepts; the app uses the defaults.
const FAST_KDF = { opsLimit: 1, memLimit: 8 << 20 };
const PASSPHRASE = "chai at marine drive";

const api = new Api({ origin: "https://map.snehilsinha.com", fetch: (r) => exports.default.fetch(r) });

async function expectSetupError(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(SetupError);
  expect((err as SetupError).code).toBe(code);
}

function diaryOf(device: DeviceState) {
  return new Diary(device, new MemoryStorage(), api);
}

describe("device setup, sign-in and sync", () => {
  let phone: DeviceState;
  let phrase: string;
  let group: BoardKey;

  it("sets up the account on the first device", async () => {
    const setup = await prepareSetup({ passphrase: PASSPHRASE, kdf: FAST_KDF });
    phrase = setup.recoveryPhrase;
    expect(phrase).toMatch(/^(\w{4}-){6}\w{4}$/);
    phone = await setup.complete(api);
    expect(phone.boardKeys).toHaveLength(1);

    const again = await prepareSetup({ passphrase: "another long phrase", kdf: FAST_KDF });
    await expectSetupError(again.complete(api), "registration_closed");
  });

  it("refuses a wrong passphrase and a short one", async () => {
    await expectSetupError(signInWithPassphrase(api, "chai at marine drivE"), "wrong_passphrase");
    await expectSetupError(prepareSetup({ passphrase: "too short", kdf: FAST_KDF }), "passphrase_too_short");
  });

  it("syncs items, edits and deletes between two devices", async () => {
    const laptop = await signInWithPassphrase(api, PASSPHRASE);
    expect(laptop.accountId).toBe(phone.accountId);
    expect(laptop.deviceId).not.toBe(phone.deviceId);
    expect(laptop.boardKeys.map((k) => [k.boardId, k.version])).toEqual([[phone.personalBoardId, 1]]);

    const a = diaryOf(phone);
    const b = diaryOf(laptop);
    const status = await a.write({ type: "status", placeId: "place-1", payload: { status: "want" } });
    const comment = await a.write({ type: "comment", placeId: "place-1", payload: { text: "Try the filter coffee" } });
    await a.sync();
    expect(a.getStatus()).toMatchObject({ phase: "idle", pending: 0, error: null });

    await b.sync();
    const seen = await b.listItems();
    expect(seen.map((i) => i.id).sort()).toEqual([status.id, comment.id].sort());
    expect((await b.getItem(status.id))?.payload).toEqual({ status: "want" });

    // The laptop edits it, the phone sees the edit; then the phone deletes the comment.
    await b.write({ id: status.id, type: "status", placeId: "place-1", payload: { status: "visited" } });
    await b.sync();
    await a.sync();
    expect((await a.getItem(status.id))?.payload).toEqual({ status: "visited" });

    await a.remove(comment.id);
    await a.sync();
    await b.sync();
    expect(await b.getItem(comment.id)).toBeUndefined();
    expect((await b.listItems()).map((i) => i.id)).toEqual([status.id]);
    expect(a.skipped).toEqual([]);
    expect(b.skipped).toEqual([]);

    // A fresh device catches up from cursor 0 and never sees the deleted comment.
    const c = diaryOf(await signInWithPassphrase(api, PASSPHRASE));
    await c.sync();
    expect((await c.listItems()).map((i) => [i.id, i.payload])).toEqual([[status.id, { status: "visited" }]]);
  });

  it("gives a new device every board key wrapped to the account", async () => {
    // Groups arrive in a later phase; create one directly so the account is in two boards.
    group = generateBoardKey(randomId());
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO boards (id, kind, key_version, created_at) VALUES (?, 'group', 1, ?)").bind(group.boardId, now),
      env.DB.prepare("INSERT INTO board_members (board_id, account_id, joined_at) VALUES (?, ?, ?)").bind(group.boardId, phone.accountId, now),
    ]);
    // One wrap for the whole account, written by one device.
    await api.putBoardKeys(
      [{ boardId: group.boardId, keyVersion: 1, wrappedKey: toBase64(wrapKeyForMember(group.key, phone.accountBox.publicKey)) }],
      { deviceId: phone.deviceId, signSecretKey: phone.identity.signSecretKey },
    );

    const tablet = await signInWithPassphrase(api, PASSPHRASE, "android");
    expect(tablet.kind).toBe("android");
    const me = await api.me({ deviceId: tablet.deviceId, signSecretKey: tablet.identity.signSecretKey });
    expect(me.devices.find((d) => d.id === tablet.deviceId)?.kind).toBe("android");
    expect(me.devices.find((d) => d.id === phone.deviceId)?.kind).toBe("web");
    expect(tablet.accountBox.publicKey).toEqual(phone.accountBox.publicKey);
    expect(tablet.boardKeys.find((k) => k.boardId === group.boardId)?.key).toEqual(group.key);
  });

  it("signs in with the recovery phrase and replaces the passphrase", async () => {
    await expectSetupError(
      signInWithRecoveryPhrase(api, { recoveryPhrase: "0000-0000", newPassphrase: "new long phrase", kdf: FAST_KDF }),
      "invalid_recovery_phrase",
    );

    const NEW = "bombay sandwich, extra cheese";
    const restored = await signInWithRecoveryPhrase(api, {
      recoveryPhrase: phrase.toLowerCase().replace(/-/g, " "),
      newPassphrase: NEW,
      kdf: FAST_KDF,
    });
    expect(restored.accountId).toBe(phone.accountId);
    // The phrase restores shared boards too, not just the personal one.
    expect(restored.boardKeys.map((k) => k.boardId).sort()).toEqual([phone.personalBoardId, group.boardId].sort());

    const d = diaryOf(restored);
    await d.sync();
    expect((await d.listItems()).length).toBe(1);

    await expectSetupError(signInWithPassphrase(api, PASSPHRASE), "wrong_passphrase");
    expect((await signInWithPassphrase(api, NEW)).accountId).toBe(phone.accountId);
  });

  it("goes offline without losing queued writes", async () => {
    const offlineApi = new Api({
      origin: "https://map.snehilsinha.com",
      fetch: () => Promise.reject(new TypeError("Failed to fetch")),
    });
    const storage = new MemoryStorage();
    const offline = new Diary(phone, storage, offlineApi);
    await offline.write({ type: "comment", placeId: "place-2", payload: { text: "queued" } });
    await offline.sync();
    expect(offline.getStatus()).toMatchObject({ phase: "offline", pending: 1 });

    const online = new Diary(phone, storage, api);
    await online.sync();
    expect(online.getStatus()).toMatchObject({ phase: "idle", pending: 0 });
  });
});
