// The device-side flows in @map-diary/sync, run against the real Worker and a local D1.
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  generateBoardKey,
  generateIdentity,
  pairingId,
  randomId,
  ready,
  toBase64,
  wrapKeyForMember,
  type BoardKey,
} from "@map-diary/crypto";
import {
  Api,
  Diary,
  MemoryStorage,
  PairingError,
  InviteError,
  RevokeError,
  SetupError,
  cancelAppInvite,
  checkAppInvite,
  createAppInvite,
  joinPairing,
  listAppInvites,
  listMembers,
  removeMember,
  setPassphrase,
  prepareSetup,
  revokeDevice,
  startPairing,
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
  let friend: DeviceState;
  let friendPhrase: string;

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

  it("links a new device from one already signed in, without the passphrase", async () => {
    const pairing = await startPairing(api, phone, "https://map.snehilsinha.com");
    expect(pairing.link).toBe(`https://map.snehilsinha.com/link#${pairing.secret}`);
    expect(await pairing.check()).toEqual({ state: "waiting" });

    // Typed by hand, in lower case with a space: still the same pairing.
    const secret = pairing.secret;
    const joining = await joinPairing(api, secret.toLowerCase().replace("-", " "), "android");
    expect(await joining.check()).toBeNull();

    const seen = await pairing.check();
    expect(seen).toEqual({ state: "joined", code: joining.code, kind: "android" });
    // The link works once.
    await expect(joinPairing(api, secret)).rejects.toMatchObject({ code: "expired" });
    await expect(joinPairing(api, "not a code")).rejects.toMatchObject({ code: "bad_code" });

    await pairing.approve();
    const linked = await joining.check();
    expect(linked).not.toBeNull();
    expect(linked!.accountId).toBe(phone.accountId);
    expect(linked!.kind).toBe("android");
    expect(linked!.accountBox.publicKey).toEqual(phone.accountBox.publicKey);
    expect(linked!.boardKeys.map((k) => k.boardId).sort()).toEqual([phone.personalBoardId, group.boardId].sort());

    // It syncs like any other device, and the pairing is gone.
    const d = diaryOf(linked!);
    await d.sync();
    expect((await d.listItems()).length).toBeGreaterThan(0);
    expect(d.skipped).toEqual([]);
    await expect(joining.check()).rejects.toBeInstanceOf(PairingError);
  });

  it("refuses a joining device whose keys were not sent by the link holder", async () => {
    const pairing = await startPairing(api, phone, "https://map.snehilsinha.com");
    const secret = pairing.link.split("#")[1]!;
    // Someone who knows the pairing id but not the secret (the server, say) offers its own keys.
    const keys = generateIdentity();
    const res = await exports.default.fetch(
      new Request(`https://map.snehilsinha.com/api/pairings/${pairingId(secret)}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device: { id: randomId(), kind: "web", signPublicKey: toBase64(keys.signPublicKey), boxPublicKey: toBase64(keys.boxPublicKey) },
          mac: toBase64(new Uint8Array(32)),
        }),
      }),
    );
    expect(res.status).toBe(200);
    await expect(pairing.check()).rejects.toMatchObject({ code: "tampered" });
  });

  it("registers a linked device only with an approving device's own signature", async () => {
    const pairing = await startPairing(api, phone, "https://map.snehilsinha.com");
    const joining = await joinPairing(api, pairing.link.split("#")[1]!);
    await pairing.check();
    const id = pairingId(pairing.link.split("#")[1]!);
    const err = await api
      .approvePairing(id, { authorization: toBase64(new Uint8Array(64)), sealedTransfer: toBase64(new Uint8Array(100)) }, {
        deviceId: phone.deviceId,
        signSecretKey: phone.identity.signSecretKey,
      })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 403 });
    expect(await joining.check()).toBeNull();
    await pairing.cancel();
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

  it("revokes a device and moves the account to new keys", async () => {
    const NEW = "bombay sandwich, extra cheese";
    const lost = await signInWithPassphrase(api, NEW);
    const laptop = await signInWithPassphrase(api, NEW);

    // The laptop writes while offline, before it hears about the revocation.
    const laptopStorage = new MemoryStorage();
    await laptopStorage.saveDevice(laptop);
    const offline = new Diary(laptop, laptopStorage, new Api({
      origin: "https://map.snehilsinha.com",
      fetch: () => Promise.reject(new TypeError("Failed to fetch")),
    }));
    await offline.write({ type: "comment", placeId: "place-3", payload: { text: "written before" } });

    await expect(revokeDevice(api, phone, lost.deviceId, { passphrase: PASSPHRASE })).rejects.toMatchObject({
      code: "wrong_passphrase",
    });
    await expect(revokeDevice(api, phone, lost.deviceId, { recoveryPhrase: "0000" })).rejects.toBeInstanceOf(RevokeError);
    await expect(revokeDevice(api, phone, phone.deviceId, { passphrase: NEW })).rejects.toMatchObject({ code: "server" });

    const before = phone.accountBox.version;
    // The Worker refuses a rotation that leaves out a remaining device or a board key.
    await expect(
      api.revokeDevice(
        lost.deviceId,
        {
          boxPublicKey: toBase64(phone.accountBox.publicKey),
          boxKeyVersion: before + 1,
          boardKeys: [],
          deviceKeys: [{ deviceId: phone.deviceId, sealedKey: "AAAA" }],
        },
        { deviceId: phone.deviceId, signSecretKey: phone.identity.signSecretKey },
      ),
    ).rejects.toMatchObject({ status: 409, code: "stale" });

    const personalBefore = Math.max(...phone.boardKeys.filter((k) => k.boardId === phone.personalBoardId).map((k) => k.version));
    phone = await revokeDevice(api, phone, lost.deviceId, { recoveryPhrase: phrase });
    expect(phone.accountBox.version).toBe(before + 1);
    expect(phone.boardKeys.some((k) => k.boardId === phone.personalBoardId && k.version === personalBefore + 1)).toBe(true);

    // The revoked device is refused at once, and its old account key opens nothing new.
    const lostDiary = diaryOf(lost);
    await lostDiary.sync();
    expect(lostDiary.getStatus().error).toBe("device_revoked");
    const me = await api.me({ deviceId: phone.deviceId, signSecretKey: phone.identity.signSecretKey });
    expect(me.account.boxKeyVersion).toBe(before + 1);
    expect(me.boards.every((b) => b.keys.every((k) => k.accountKeyVersion === before + 1))).toBe(true);
    expect(me.devices.find((d) => d.id === lost.deviceId)?.revokedAt).not.toBeNull();

    // A revoked device cannot be revoked again.
    await expect(revokeDevice(api, phone, lost.deviceId, { passphrase: NEW })).rejects.toMatchObject({ code: "server" });

    // The phone writes with the new Personal key.
    const phoneDiary = diaryOf(phone);
    await phoneDiary.write({ type: "comment", placeId: "place-3", payload: { text: "after" } });
    await phoneDiary.sync();

    // The laptop comes online: it collects the new key, reads the phone's item, and re-seals
    // its own offline write, which the Worker refused for its replaced key.
    const online = new Diary(laptop, laptopStorage, api);
    await online.sync();
    expect(online.getStatus()).toMatchObject({ phase: "idle", pending: 0, error: null });
    expect(online.device.accountBox.version).toBe(before + 1);
    expect((await laptopStorage.loadDevice())?.accountBox.version).toBe(before + 1);
    const texts = (await online.listItems()).map((i) => (i.payload as { text?: string }).text);
    expect(texts).toEqual(expect.arrayContaining(["after", "written before"]));
    expect(online.skipped).toEqual([]);

    await phoneDiary.sync();
    expect((await phoneDiary.listItems()).map((i) => (i.payload as { text?: string }).text)).toContain("written before");
  });

  it("invites a friend with a one-time link, with no passphrase needed", async () => {
    const invite = await createAppInvite(api, phone, "https://map.snehilsinha.com");
    expect(invite.link).toBe(`https://map.snehilsinha.com/invite#${invite.code}`);
    expect(invite.code).toMatch(/^(\w{5}-){3}\w{5}$/);
    expect((await listAppInvites(api, phone)).map((i) => i.id)).toContain(invite.id);
    expect(await checkAppInvite(api, invite.code.toLowerCase().replace(/-/g, " "))).toMatchObject({ state: "open" });
    expect(await checkAppInvite(api, "nope")).toEqual({ state: "bad_code" });

    // Without an invite, signup stays closed; a made-up invite is refused.
    await expectSetupError(prepareSetup({ inviteCode: "nope" }), "bad_invite");
    const fake = await prepareSetup({ inviteCode: "00000-00000-00000-00000" });
    await expectSetupError(fake.complete(api), "invite_invalid");
    // The admin's passphrase is taken.
    const clash = await prepareSetup({ inviteCode: invite.code, passphrase: "bombay sandwich, extra cheese", kdf: FAST_KDF });
    await expectSetupError(clash.complete(api), "passphrase_in_use");

    const setup = await prepareSetup({ inviteCode: invite.code });
    friend = await setup.complete(api);
    friendPhrase = setup.recoveryPhrase;
    expect(friend.accountId).not.toBe(phone.accountId);
    const me = await api.me({ deviceId: friend.deviceId, signSecretKey: friend.identity.signSecretKey });
    expect(me.account).toMatchObject({ isAdmin: false, hasPassphrase: false });

    // The invite works once.
    expect(await checkAppInvite(api, invite.code)).toMatchObject({ state: "used" });
    const again = await prepareSetup({ inviteCode: invite.code });
    await expectSetupError(again.complete(api), "invite_invalid");
    expect((await listAppInvites(api, phone)).map((i) => i.id)).not.toContain(invite.id);

    // The friend writes to their own diary.
    const d = diaryOf(friend);
    await d.write({ type: "status", placeId: "place-9", payload: { status: "want" } });
    await d.sync();
    expect(d.getStatus()).toMatchObject({ phase: "idle", pending: 0, error: null });

    // Only the admin manages invites and members.
    await expect(createAppInvite(api, friend, "https://map.snehilsinha.com")).rejects.toMatchObject({ code: "forbidden" });
    await expect(listMembers(api, friend)).rejects.toBeInstanceOf(InviteError);
    const members = await listMembers(api, phone);
    expect(members.map((m) => [m.id, m.isAdmin, m.inviteId])).toEqual([
      [phone.accountId, true, null],
      [friend.accountId, false, invite.id],
    ]);
  });

  it("lets a friend set a passphrase later with the recovery phrase", async () => {
    const FRIEND_PASS = "vada pav near the station";
    await expect(
      setPassphrase(api, friend, { recoveryPhrase: phrase, newPassphrase: FRIEND_PASS, kdf: FAST_KDF }),
    ).rejects.toMatchObject({ code: "wrong_account" });
    await setPassphrase(api, friend, { recoveryPhrase: friendPhrase, newPassphrase: FRIEND_PASS, kdf: FAST_KDF });
    const me = await api.me({ deviceId: friend.deviceId, signSecretKey: friend.identity.signSecretKey });
    expect(me.account.hasPassphrase).toBe(true);
    const laptop = await signInWithPassphrase(api, FRIEND_PASS);
    expect(laptop.accountId).toBe(friend.accountId);
  });

  it("cancels an unused invite", async () => {
    const invite = await createAppInvite(api, phone, "https://map.snehilsinha.com");
    await cancelAppInvite(api, phone, invite.id);
    expect(await checkAppInvite(api, invite.code)).toEqual({ state: "unknown" });
    await expect(cancelAppInvite(api, phone, invite.id)).rejects.toMatchObject({ code: "not_found" });
    const setup = await prepareSetup({ inviteCode: invite.code });
    await expectSetupError(setup.complete(api), "invite_invalid");
  });

  it("removes a friend from the app and refuses all their devices", async () => {
    await expect(removeMember(api, phone, phone.accountId)).rejects.toMatchObject({ code: "server" });
    await expect(removeMember(api, friend, phone.accountId)).rejects.toMatchObject({ code: "forbidden" });

    await removeMember(api, phone, friend.accountId);
    const d = diaryOf(friend);
    await d.sync();
    expect(d.getStatus().error).toBe("device_revoked");
    await expectSetupError(signInWithPassphrase(api, "vada pav near the station"), "wrong_passphrase");
    await expectSetupError(
      signInWithRecoveryPhrase(api, { recoveryPhrase: friendPhrase, newPassphrase: "another long phrase", kdf: FAST_KDF }),
      "unknown_recovery_phrase",
    );

    const members = await listMembers(api, phone);
    expect(members.find((m) => m.id === friend.accountId)).toMatchObject({ devices: 0 });
    expect(members.find((m) => m.id === friend.accountId)?.removedAt).not.toBeNull();
    await expect(removeMember(api, phone, friend.accountId)).rejects.toMatchObject({ code: "not_found" });
  });
});
