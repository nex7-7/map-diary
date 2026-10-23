// The master board and the shared place catalogue, run with @map-diary/sync against the real
// Worker and a local D1.
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  deriveAccount,
  fromBase64,
  generateIdentity,
  generateRecoveryPhrase,
  linkHash,
  randomId,
  ready,
  sealEnvelope,
  toBase64,
  wrapKeyForMember,
  type JsonValue,
} from "@map-diary/crypto";
import {
  Api,
  Diary,
  MemoryStorage,
  linkHashKeyOf,
  masterBoardOf,
  prepareSetup,
  revokeDevice,
  signInWithPassphrase,
  wrapMasterKeysForAccount,
  writeKey,
  type DeviceState,
  type RejectedWrite,
} from "@map-diary/sync";

await ready();

const FAST_KDF = { opsLimit: 1, memLimit: 8 << 20 };
const PASSPHRASE = "cutting chai on carter road";
const ORIGIN = "https://map.snehilsinha.com";

const api = new Api({ origin: ORIGIN, fetch: (r) => exports.default.fetch(r) });
/** The same Worker, but the master board cannot be created: the state before this phase. */
const noMasterApi = new Api({
  origin: ORIGIN,
  fetch: (r) =>
    new URL(r.url).pathname === "/api/boards/master"
      ? Promise.resolve(Response.json({ error: "internal" }, { status: 500 }))
      : exports.default.fetch(r),
});

const placeLinks = (payload: JsonValue) => {
  const links = (payload as { sourceLinks?: unknown }).sourceLinks;
  return Array.isArray(links) ? links.filter((l): l is string => typeof l === "string") : [];
};
const diaryOf = (device: DeviceState, storage = new MemoryStorage(), via = api) => new Diary(device, storage, via, { placeLinks });
const signer = (d: DeviceState) => ({ deviceId: d.deviceId, signSecretKey: d.identity.signSecretKey });

const place = (name: string, link: string): JsonValue => ({
  name,
  category: "cafe-bar",
  location: { lng: 72.83, lat: 18.92 },
  sourceLinks: [link],
});

/**
 * A second person on the app, made directly in D1 the way an app invite will: an account with
 * its Personal board, one device, and every master key version wrapped to its account key.
 */
async function addFriend(admin: DeviceState): Promise<DeviceState> {
  const account = deriveAccount(generateRecoveryPhrase().seed);
  const box = account.accountBoxKeys(1);
  const personal = account.personalBoardKey(1);
  const identity = generateIdentity();
  const deviceId = randomId();
  const now = Date.now();
  const grants = wrapMasterKeysForAccount(admin, box.publicKey);
  const master = masterBoardOf(admin)!;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO accounts (id, is_admin, sign_public_key, box_public_key, box_key_version, created_at)
       VALUES (?, 0, ?, ?, 1, ?)`,
    ).bind(account.accountId, account.accountKeys.signPublicKey, box.publicKey, now),
    env.DB.prepare(
      "INSERT INTO devices (id, account_id, kind, sign_public_key, box_public_key, created_at) VALUES (?, ?, 'web', ?, ?, ?)",
    ).bind(deviceId, account.accountId, identity.signPublicKey, identity.boxPublicKey, now),
    env.DB.prepare("INSERT INTO boards (id, kind, owner_account_id, key_version, created_at) VALUES (?, 'personal', ?, 1, ?)").bind(
      personal.boardId,
      account.accountId,
      now,
    ),
    env.DB.prepare("INSERT INTO board_members (board_id, account_id, joined_at) VALUES (?, ?, ?)").bind(personal.boardId, account.accountId, now),
    env.DB.prepare(
      "INSERT INTO board_keys (board_id, key_version, account_id, account_key_version, wrapped_key, created_at) VALUES (?, 1, ?, 1, ?, ?)",
    ).bind(personal.boardId, account.accountId, wrapKeyForMember(personal.key, box.publicKey), now),
    env.DB.prepare("INSERT INTO board_members (board_id, account_id, joined_at) VALUES (?, ?, ?)").bind(master.id, account.accountId, now),
    ...grants.map((g) =>
      env.DB.prepare(
        "INSERT INTO board_keys (board_id, key_version, account_id, account_key_version, wrapped_key, created_at) VALUES (?, ?, ?, 1, ?, ?)",
      ).bind(g.boardId, g.keyVersion, account.accountId, fromBase64(g.wrappedKey), now),
    ),
  ]);
  return {
    v: 2,
    accountId: account.accountId,
    deviceId,
    kind: "web",
    identity,
    accountBox: box,
    personalBoardId: personal.boardId,
    boardKeys: [personal],
    createdAt: now,
  };
}

describe("the master board and the place catalogue", () => {
  let admin: DeviceState;
  let adminStorage: MemoryStorage;
  let friend: DeviceState;
  let friendStorage: MemoryStorage;
  let cafeId: string;

  it("moves the admin's earlier places onto the master board once it exists", async () => {
    // Set up as before this phase: no master board yet, and a place on the Personal board.
    const setup = await prepareSetup({ passphrase: PASSPHRASE, kdf: FAST_KDF });
    admin = await setup.complete(noMasterApi);
    expect(masterBoardOf(admin)).toBeUndefined();
    adminStorage = new MemoryStorage();
    await adminStorage.saveDevice(admin);
    const before = diaryOf(admin, adminStorage, noMasterApi);
    const cafe = await before.write({ type: "place", placeId: null, payload: place("Kyani & Co", "https://maps.google.com/?cid=111") });
    cafeId = cafe.id;
    await before.write({ type: "status", placeId: cafeId, payload: { status: "visited" } });
    await before.sync();
    expect(before.getStatus()).toMatchObject({ phase: "idle", pending: 0, error: null });
    expect((await before.getItem(cafeId))?.boardIds).toEqual([admin.personalBoardId]);
    const stored = await env.DB.prepare("SELECT board_id FROM envelope_boards WHERE envelope_id = ?").bind(cafeId).all<{ board_id: string }>();
    expect(stored.results).toEqual([{ board_id: admin.personalBoardId }]);

    // The next sync creates the master board and re-seals the place onto it. Opinions stay put.
    const after = diaryOf(admin, adminStorage);
    await after.sync();
    expect(after.getStatus()).toMatchObject({ phase: "idle", pending: 0, error: null });
    admin = after.device;
    const master = masterBoardOf(admin)!;
    expect(master).toMatchObject({ kind: "master", keyVersion: 1 });
    expect((await after.getItem(cafeId))?.boardIds).toEqual([master.id]);
    const moved = await env.DB.prepare("SELECT board_id FROM envelope_boards WHERE envelope_id = ?").bind(cafeId).all<{ board_id: string }>();
    expect(moved.results).toEqual([{ board_id: master.id }]);
    expect((await after.listItems()).find((i) => i.type === "status")?.boardIds).toEqual([admin.personalBoardId]);
    expect(after.skipped).toEqual([]);

    // A second master board is refused, and so is one from anyone but the admin.
    await expect(api.createMasterBoard({ id: randomId(), wrappedKey: "AAAA" }, signer(admin))).rejects.toMatchObject({
      status: 409,
      code: "master_exists",
    });
  });

  it("gives every member the catalogue but not anyone's Personal board", async () => {
    friend = await addFriend(admin);
    friendStorage = new MemoryStorage();
    await friendStorage.saveDevice(friend);
    const d = diaryOf(friend, friendStorage);
    await d.sync();
    expect(d.getStatus()).toMatchObject({ phase: "idle", error: null });
    friend = d.device;
    expect(friend.isAdmin).toBe(false);
    expect(writeKey(friend, masterBoardOf(admin)!.id)?.key).toEqual(writeKey(admin, masterBoardOf(admin)!.id)?.key);
    // The place is there; the admin's Visited (Personal) is not.
    expect((await d.listItems()).map((i) => i.id)).toEqual([cafeId]);

    await expect(api.createMasterBoard({ id: randomId(), wrappedKey: "AAAA" }, signer(friend))).rejects.toMatchObject({
      status: 403,
    });
  });

  it("blocks a duplicate place by its keyed link hash, which any member can check", async () => {
    const d = diaryOf(friend, friendStorage);
    expect(await d.findCataloguePlace(["https://maps.google.com/?cid=111"])).toBe(cafeId);
    expect(await d.findCataloguePlace(["https://maps.google.com/?cid=999"])).toBeNull();

    const refused: RejectedWrite[] = [];
    d.onRejected((r) => refused.push(...r));
    const copy = await d.write({ type: "place", placeId: null, payload: place("Kyani", "https://maps.google.com/?cid=111") });
    await d.sync();
    expect(d.skipped).toEqual([{ id: copy.id, reason: "duplicate_place" }]);
    // The screens hear about it, with the place that already has the link.
    expect(refused).toEqual([{ id: copy.id, type: "place", reason: "duplicate_place", placeId: cafeId }]);

    // The server sees only the hash: nothing in D1 holds the link itself.
    const { results } = await env.DB.prepare("SELECT link_hash, place_id FROM place_link_hashes").all<{ link_hash: ArrayBuffer; place_id: string }>();
    const expected = toBase64(linkHash(linkHashKeyOf(admin)!, "https://maps.google.com/?cid=111"));
    expect(results.map((r) => [toBase64(new Uint8Array(r.link_hash)), r.place_id])).toEqual([[expected, cafeId]]);
  });

  it("locks a member's place facts after the first write and keeps dropped pins off the master board", async () => {
    const d = diaryOf(friend, friendStorage);
    const mine = await d.write({ type: "place", placeId: null, payload: place("Bastian", "https://maps.google.com/?cid=222") });
    await d.write({ type: "status", placeId: mine.id, payload: { status: "want" }, boards: [masterBoardOf(friend)!.id] });
    const pin = await d.write({ type: "private_place", placeId: null, payload: place("Secret beach", "https://example.com/x"), boards: [masterBoardOf(friend)!.id] });
    expect(pin.boardIds).toEqual([friend.personalBoardId]);
    await d.sync();
    expect(d.skipped).toEqual([]);

    await d.write({ id: mine.id, type: "place", placeId: null, payload: place("Bastian Worli", "https://maps.google.com/?cid=222") });
    await d.sync();
    expect(d.skipped.at(-1)).toEqual({ id: mine.id, reason: "facts_locked" });

    // A dropped pin sealed to the master board by hand is refused too.
    const forged = sealEnvelope({
      type: "private_place",
      authorId: friend.accountId,
      deviceId: friend.deviceId,
      placeId: null,
      payload: place("Pin", "https://example.com/y"),
      boards: [writeKey(friend, masterBoardOf(friend)!.id)!],
      signSecretKey: friend.identity.signSecretKey,
    });
    const res = await api.pushEnvelopes([forged], signer(friend));
    expect(res.rejected).toEqual([{ id: forged.id, reason: "private_on_master" }]);

    // Only the admin deletes a catalogue place.
    expect((await api.deleteEnvelopes([mine.id], signer(friend))).deleted).toEqual([]);

    // The admin sees the friend's place and their Public status, and can still edit its own facts.
    const a = diaryOf(admin, adminStorage);
    await a.sync();
    const seen = await a.listItems();
    expect(seen.find((i) => i.id === mine.id)?.payload).toMatchObject({ name: "Bastian" });
    expect(seen.some((i) => i.type === "status" && i.authorId === friend.accountId)).toBe(true);
    expect(seen.some((i) => i.id === pin.id)).toBe(false);
    await a.write({ id: cafeId, type: "place", placeId: null, payload: place("Kyani & Co.", "https://maps.google.com/?cid=111") });
    await a.sync();
    expect(a.skipped).toEqual([]);
  });

  it("rotates the master key for every member when the admin revokes a device", async () => {
    const lost = await signInWithPassphrase(api, PASSPHRASE);
    const masterId = masterBoardOf(admin)!.id;

    // The friend writes to the Public board while offline, still under master key 1.
    const offline = diaryOf(friend, friendStorage, new Api({ origin: ORIGIN, fetch: () => Promise.reject(new TypeError("offline")) }));
    const late = await offline.write({ type: "comment", placeId: cafeId, payload: { text: "the berry pulao" }, boards: [masterId] });

    admin = await revokeDevice(api, admin, lost.deviceId, { passphrase: PASSPHRASE });
    expect(masterBoardOf(admin)).toMatchObject({ id: masterId, keyVersion: 2 });
    const me = await api.me(signer(admin));
    expect(me.boards.find((b) => b.id === masterId)?.keyVersion).toBe(2);

    const a = diaryOf(admin, adminStorage);
    const fresh = await a.write({ type: "comment", placeId: cafeId, payload: { text: "new menu" }, boards: [masterId] });
    await a.sync();
    expect(fresh.boardIds).toEqual([masterId]);

    // The friend collects master key 2, reads the new comment, and re-seals its stale one.
    const f = diaryOf(friend, friendStorage);
    await f.sync();
    expect(f.getStatus()).toMatchObject({ phase: "idle", pending: 0, error: null });
    expect(writeKey(f.device, masterId)?.version).toBe(2);
    expect((await f.getItem(fresh.id))?.payload).toEqual({ text: "new menu" });
    expect(f.skipped.filter((s) => s.reason === "stale_key")).toEqual([]);

    await a.sync();
    expect((await a.getItem(late.id))?.payload).toEqual({ text: "the berry pulao" });

    // The revoked device's account key opens no wrap of master key 2.
    const rows = await env.DB.prepare("SELECT account_id, account_key_version FROM board_keys WHERE board_id = ? AND key_version = 2")
      .bind(masterId)
      .all<{ account_id: string; account_key_version: number }>();
    expect(rows.results.map((r) => [r.account_id, r.account_key_version]).sort()).toEqual(
      [
        [admin.accountId, admin.accountBox.version],
        [friend.accountId, 1],
      ].sort(),
    );
  });
});
