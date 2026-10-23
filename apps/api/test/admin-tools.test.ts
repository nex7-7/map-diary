// The admin panel's place, device, resolver and data tools, run with @map-diary/sync against
// the real Worker and a local D1.
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  deriveAccount,
  fromBase64,
  generateIdentity,
  generateRecoveryPhrase,
  generateReplyKeys,
  randomId,
  ready,
  toBase64,
  wrapKeyForMember,
  type JsonValue,
} from "@map-diary/crypto";
import {
  Api,
  Diary,
  MemoryStorage,
  exportDatabase,
  listAllDevices,
  masterBoardOf,
  prepareSetup,
  resolverQueue,
  retryFailedJobs,
  retryResolverJob,
  revokeDevice,
  signOutDevice,
  storageUsage,
  wrapMasterKeysForAccount,
  type DeviceState,
} from "@map-diary/sync";
import { MAX_ATTEMPTS, takePendingJobs } from "../src/resolver";

await ready();

const FAST_KDF = { opsLimit: 1, memLimit: 8 << 20 };
const ORIGIN = "https://map.snehilsinha.com";
const api = new Api({ origin: ORIGIN, fetch: (r) => exports.default.fetch(r) });

const placeLinks = (payload: JsonValue) => {
  const links = (payload as { sourceLinks?: unknown }).sourceLinks;
  return Array.isArray(links) ? links.filter((l): l is string => typeof l === "string") : [];
};
const diaryOf = (device: DeviceState, storage = new MemoryStorage()) => new Diary(device, storage, api, { placeLinks });
const signer = (d: DeviceState) => ({ deviceId: d.deviceId, signSecretKey: d.identity.signSecretKey });

const place = (name: string, link: string): JsonValue => ({
  name,
  category: "cafe-bar",
  location: { lng: 72.83, lat: 18.92 },
  sourceLinks: [link],
});

/** Another device on an account, made straight in D1 with its copy of the account key. */
async function addDevice(accountId: string): Promise<{ deviceId: string; identity: ReturnType<typeof generateIdentity> }> {
  const identity = generateIdentity();
  const deviceId = randomId();
  await env.DB.prepare(
    "INSERT INTO devices (id, account_id, kind, sign_public_key, box_public_key, created_at) VALUES (?, ?, 'web', ?, ?, ?)",
  )
    .bind(deviceId, accountId, identity.signPublicKey, identity.boxPublicKey, Date.now())
    .run();
  return { deviceId, identity };
}

/** A friend on the app with a known recovery phrase, made in D1 the way an app invite does. */
async function addFriend(admin: DeviceState): Promise<{ device: DeviceState; phrase: string }> {
  const { seed, phrase } = generateRecoveryPhrase();
  const account = deriveAccount(seed);
  const box = account.accountBoxKeys(1);
  const personal = account.personalBoardKey(1);
  const identity = generateIdentity();
  const deviceId = randomId();
  const now = Date.now();
  const master = masterBoardOf(admin)!;
  const grants = wrapMasterKeysForAccount(admin, box.publicKey);
  const keyRow = (boardId: string, version: number, wrapped: Uint8Array) =>
    env.DB.prepare(
      "INSERT INTO board_keys (board_id, key_version, account_id, account_key_version, wrapped_key, created_at) VALUES (?, ?, ?, 1, ?, ?)",
    ).bind(boardId, version, account.accountId, wrapped, now);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO accounts (id, is_admin, sign_public_key, box_public_key, box_key_version, created_at) VALUES (?, 0, ?, ?, 1, ?)",
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
    keyRow(personal.boardId, 1, wrapKeyForMember(personal.key, box.publicKey)),
    env.DB.prepare("INSERT INTO board_members (board_id, account_id, joined_at) VALUES (?, ?, ?)").bind(master.id, account.accountId, now),
    ...grants.map((g) => keyRow(g.boardId, g.keyVersion, fromBase64(g.wrappedKey))),
  ]);
  const device: DeviceState = {
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
  return { device, phrase };
}

describe("admin panel tools", () => {
  let admin: DeviceState;
  let adminStorage: MemoryStorage;
  let friend: DeviceState;
  let friendStorage: MemoryStorage;
  let friendPhrase: string;

  it("lets the admin correct and delete a friend's catalogue place, and nobody else", async () => {
    const setup = await prepareSetup({ passphrase: "cutting chai on carter road", kdf: FAST_KDF });
    admin = await setup.complete(api);
    adminStorage = new MemoryStorage();
    const a = diaryOf(admin, adminStorage);
    await a.sync();
    admin = a.device;

    ({ device: friend, phrase: friendPhrase } = await addFriend(admin));
    friendStorage = new MemoryStorage();
    const f = diaryOf(friend, friendStorage);
    await f.sync();
    friend = f.device;
    const typo = await f.write({ type: "place", placeId: null, payload: place("Bastain", "https://maps.google.com/?cid=301") });
    const status = await f.write({ type: "status", placeId: typo.id, payload: { status: "want" }, boards: [masterBoardOf(friend)!.id] });
    const extra = await f.write({ type: "place", placeId: null, payload: place("Closed cafe", "https://maps.google.com/?cid=302") });
    await f.sync();
    expect(f.skipped).toEqual([]);

    await a.sync();
    await a.write({ id: typo.id, type: "place", placeId: null, payload: place("Bastian", "https://maps.google.com/?cid=301") });
    await a.remove(extra.id);
    await a.sync();
    expect(a.skipped).toEqual([]);

    // The friend sees the corrected facts, now the admin's, and the deleted place is gone.
    await f.sync();
    const fixed = await f.getItem(typo.id);
    expect(fixed?.payload).toMatchObject({ name: "Bastian" });
    expect(fixed?.authorId).toBe(admin.accountId);
    expect(await f.getItem(extra.id)).toBeUndefined();
    // The friend's opinion on the place stays: no moderation.
    expect((await f.getItem(status.id))?.payload).toEqual({ status: "want" });

    // The admin still cannot touch an opinion, and a friend cannot touch a place that is not theirs.
    await expect(a.write({ id: status.id, type: "status", placeId: typo.id, payload: { status: "visited" } })).rejects.toThrow();
    const pushed = await api.deleteEnvelopes([status.id], signer(admin));
    expect(pushed.deleted).toEqual([]);
    expect((await api.deleteEnvelopes([typo.id], signer(friend))).deleted).toEqual([]);
  });

  it("lists every device and signs out a friend's, which its owner then finishes", async () => {
    const second = await addDevice(friend.accountId);
    const all = await listAllDevices(api, admin);
    expect(all.filter((d) => d.accountId === friend.accountId).map((d) => d.id).sort()).toEqual([friend.deviceId, second.deviceId].sort());
    expect(all.find((d) => d.id === admin.deviceId)).toMatchObject({ accountId: admin.accountId, kind: "web", revokedAt: null, rekeyDue: false });

    // A friend cannot list or sign out devices; the admin's own go through the Devices screen.
    await expect(listAllDevices(api, friend)).rejects.toMatchObject({ code: "forbidden" });
    await expect(signOutDevice(api, admin, admin.deviceId)).rejects.toMatchObject({ code: "server" });

    await signOutDevice(api, admin, second.deviceId);
    const out = { ...friend, deviceId: second.deviceId, identity: second.identity };
    await expect(api.me(signer(out))).rejects.toMatchObject({ code: "device_revoked" });
    await expect(signOutDevice(api, admin, second.deviceId)).rejects.toMatchObject({ code: "not_found" });

    const me = await api.me(signer(friend));
    expect(me.devices.find((d) => d.id === second.deviceId)).toMatchObject({ rekeyDue: true });
    expect((await listAllDevices(api, admin)).find((d) => d.id === second.deviceId)?.rekeyDue).toBe(true);

    // The friend finishes with their recovery phrase: new account keys, and the mark is cleared.
    friend = await revokeDevice(api, friend, second.deviceId, { recoveryPhrase: friendPhrase });
    expect(friend.accountBox.version).toBe(2);
    const after = await api.me(signer(friend));
    expect(after.devices.find((d) => d.id === second.deviceId)?.rekeyDue).toBeUndefined();
    expect((await listAllDevices(api, admin)).find((d) => d.id === second.deviceId)?.rekeyDue).toBe(false);
  });

  it("shows the resolver queue and puts failed jobs back in it", async () => {
    const keys = generateReplyKeys();
    const submitted = await api.submitResolverJob("Somewhere unfindable", toBase64(keys.publicKey));
    const now = Date.now();
    for (let i = 0; i <= MAX_ATTEMPTS; i++) await takePendingJobs(env.DB, 50, now);

    let queue = await resolverQueue(api, admin);
    expect(queue.counts.failed).toBeGreaterThanOrEqual(1);
    expect(queue.jobs.find((j) => j.id === submitted.id)).toMatchObject({ status: "failed", query: "Somewhere unfindable", attempts: MAX_ATTEMPTS });

    await retryResolverJob(api, admin, submitted.id);
    queue = await resolverQueue(api, admin);
    expect(queue.jobs.find((j) => j.id === submitted.id)).toMatchObject({ status: "pending", attempts: 0 });
    // The device that asked sees it waiting again.
    expect((await api.getResolverJob(submitted.id)).status).toBe("pending");

    for (let i = 0; i <= MAX_ATTEMPTS; i++) await takePendingJobs(env.DB, 50, now);
    expect(await retryFailedJobs(api, admin)).toBeGreaterThanOrEqual(1);
    await expect(resolverQueue(api, friend)).rejects.toMatchObject({ code: "forbidden" });

    // Once the device drops the job there is nothing to retry.
    await api.deleteResolverJob(submitted.id);
    await expect(retryResolverJob(api, admin, submitted.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("reports storage and exports the database as SQL", async () => {
    const usage = await storageUsage(api, admin);
    expect(usage.d1.limitBytes).toBe(500_000_000);
    const tables = new Map(usage.d1.tables.map((t) => [t.name, t.rows]));
    expect(tables.get("accounts")).toBe(2);
    expect(tables.get("envelopes")).toBeGreaterThanOrEqual(3);
    expect(tables.has("d1_migrations")).toBe(true);

    const sql = await exportDatabase(api, admin);
    expect(sql.startsWith("PRAGMA defer_foreign_keys=TRUE;\nCREATE TABLE")).toBe(true);
    expect(sql).toContain(`INSERT INTO "accounts"`);
    expect(sql).toContain(`'${admin.accountId}'`);
    // BLOBs come out as hex literals.
    expect(sql).toMatch(/X'[0-9a-f]{64}'/);
    const inserts = sql.split("\n").filter((l) => l.startsWith(`INSERT INTO "devices"`));
    expect(inserts.length).toBe((await env.DB.prepare("SELECT COUNT(*) AS n FROM devices").first<{ n: number }>())?.n);

    await expect(storageUsage(api, friend)).rejects.toMatchObject({ code: "forbidden" });
  });
});
