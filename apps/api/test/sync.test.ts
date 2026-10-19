import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  authorizeDevice,
  createKeyBackup,
  generateAccountKeys,
  generateBoardKey,
  generateIdentity,
  openEnvelope,
  openKeyBackup,
  randomId,
  ready,
  sealEnvelope,
  signRequest,
  toBase64,
  fromBase64,
  unwrapKeyFromMember,
  wrapKeyForMember,
  type AccountKeys,
  type BoardKey,
  type DeviceKind,
  type Envelope,
  type IdentityKeys,
} from "@map-diary/crypto";

await ready();

// Cheapest Argon2id settings the API accepts; the real app uses defaultKdfParams().
const FAST_KDF = { opsLimit: 1, memLimit: 8 << 20 };
const LOOKUP = toBase64(new Uint8Array(32).fill(7));

interface Device {
  id: string;
  keys: IdentityKeys;
}

const encoder = new TextEncoder();

async function call(path: string, init: { method?: string; body?: unknown; device?: Device; timestamp?: number } = {}) {
  const method = init.method ?? (init.body === undefined ? "GET" : "POST");
  const body = init.body === undefined ? "" : JSON.stringify(init.body);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init.device) {
    Object.assign(
      headers,
      signRequest(
        {
          method,
          path,
          deviceId: init.device.id,
          timestamp: init.timestamp ?? Date.now(),
          body: encoder.encode(body),
        },
        init.device.keys.signSecretKey,
      ),
    );
  }
  const res = await exports.default.fetch(
    new Request(`https://map.snehilsinha.com${path}`, { method, headers, ...(body ? { body } : {}) }),
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> & { [k: string]: any } };
}

function newDevice(): Device {
  return { id: randomId(), keys: generateIdentity() };
}

function deviceBody(accountId: string, d: Device, account: AccountKeys, kind: DeviceKind = "web") {
  return {
    id: d.id,
    kind,
    signPublicKey: toBase64(d.keys.signPublicKey),
    boxPublicKey: toBase64(d.keys.boxPublicKey),
    authorization: authorizeDevice(
      { accountId, deviceId: d.id, kind, signPublicKey: d.keys.signPublicKey, boxPublicKey: d.keys.boxPublicKey },
      account.signSecretKey,
    ),
  };
}

function seal(d: Device, accountId: string, board: BoardKey, payload: string, extra: { id?: string; createdAt?: number; updatedAt?: number } = {}) {
  return sealEnvelope({
    type: "comment",
    authorId: accountId,
    deviceId: d.id,
    placeId: "place1",
    payload: { text: payload },
    boards: [board],
    signSecretKey: d.keys.signSecretKey,
    ...extra,
  });
}

let account: AccountKeys;
// The account's box keypair; board keys are wrapped to it. Only its box half is used here.
let accountBox: IdentityKeys;
const accountId = randomId();
const laptop = newDevice();
let personal: BoardKey;

beforeAll(() => {
  account = generateAccountKeys();
  accountBox = generateIdentity();
  personal = generateBoardKey(randomId());
});

describe("first-run setup", () => {
  const setupBody = () => ({
    account: { id: accountId, signPublicKey: toBase64(account.signPublicKey), boxPublicKey: toBase64(accountBox.boxPublicKey) },
    device: deviceBody(accountId, laptop, account),
    personalBoard: { id: personal.boardId, wrappedKey: toBase64(wrapKeyForMember(personal.key, accountBox.boxPublicKey)) },
    keyBackup: {
      lookup: LOOKUP,
      backup: createKeyBackup(encoder.encode("bundle"), "correct horse", FAST_KDF),
    },
  });

  it("rejects setup not signed by the new device", async () => {
    const res = await call("/api/accounts", { body: setupBody() });
    expect(res.status).toBe(401);
    const other = await call("/api/accounts", { body: setupBody(), device: newDevice() });
    expect(other.status).toBe(401);
  });

  it("rejects a device the account key did not authorise", async () => {
    const body = setupBody();
    body.device.authorization = authorizeDevice(
      { accountId, deviceId: laptop.id, kind: "android", signPublicKey: laptop.keys.signPublicKey, boxPublicKey: laptop.keys.boxPublicKey },
      account.signSecretKey,
    );
    const res = await call("/api/accounts", { body, device: laptop });
    expect(res.status).toBe(400);
  });

  it("needs the account's box public key", async () => {
    const body = setupBody();
    const { boxPublicKey: _, ...noBox } = body.account;
    expect((await call("/api/accounts", { body: { ...body, account: noBox }, device: laptop })).status).toBe(400);
  });

  it("creates the admin account, device, personal board and backup", async () => {
    const res = await call("/api/accounts", { body: setupBody(), device: laptop });
    expect(res.status).toBe(201);
    expect(res.json).toEqual({ accountId, deviceId: laptop.id, personalBoardId: personal.boardId });
  });

  it("closes registration once an account exists", async () => {
    const d = newDevice();
    const body = { ...setupBody(), account: { ...setupBody().account, id: randomId() } };
    body.device = deviceBody(body.account.id, d, account);
    const res = await call("/api/accounts", { body, device: d });
    expect(res.status).toBe(403);
  });

  it("returns the account's boards and keys wrapped to the account from /me", async () => {
    const res = await call("/api/me", { device: laptop });
    expect(res.status).toBe(200);
    expect(res.json.account).toEqual({ id: accountId, isAdmin: true, hasPassphrase: true, boxPublicKey: toBase64(accountBox.boxPublicKey), boxKeyVersion: 1 });
    const [board] = res.json.boards;
    expect(board).toMatchObject({ id: personal.boardId, kind: "personal", keyVersion: 1 });
    expect(board.keys[0].accountKeyVersion).toBe(1);
    expect(unwrapKeyFromMember(fromBase64(board.keys[0].wrappedKey), accountBox)).toEqual(personal.key);
    expect(res.json.devices.map((d: { id: string }) => d.id)).toEqual([laptop.id]);
  });
});

describe("request signatures", () => {
  it("rejects stale, tampered and unknown-device requests", async () => {
    expect((await call("/api/me")).status).toBe(401);
    expect((await call("/api/me", { device: laptop, timestamp: Date.now() - 10 * 60 * 1000 })).status).toBe(401);
    expect((await call("/api/me", { device: newDevice() })).status).toBe(401);

    const headers = signRequest(
      { method: "GET", path: "/api/me", deviceId: laptop.id, timestamp: Date.now(), body: new Uint8Array() },
      laptop.keys.signSecretKey,
    );
    const res = await exports.default.fetch(new Request("https://map.snehilsinha.com/api/me?x=1", { headers }));
    expect(res.status).toBe(401);
  });
});

describe("envelope sync", () => {
  let first: Envelope;

  it("accepts a signed envelope on the personal board and pulls it back", async () => {
    first = seal(laptop, accountId, personal, "Great misal");
    const push = await call("/api/envelopes", { body: { envelopes: [first] }, device: laptop });
    expect(push.status).toBe(200);
    expect(push.json).toEqual({ accepted: [first.id], unchanged: [], rejected: [] });

    const pull = await call("/api/sync?since=0", { device: laptop });
    expect(pull.status).toBe(200);
    expect(pull.json.envelopes).toEqual([first]);
    expect(pull.json.more).toBe(false);
    const signer = pull.json.devices[laptop.id];
    const opened = openEnvelope(pull.json.envelopes[0], {
      boardKey: (id, v) => (id === personal.boardId && v === 1 ? personal.key : undefined),
      signerPublicKey: fromBase64(signer.signPublicKey),
    });
    expect(opened.payload).toEqual({ text: "Great misal" });
  });

  it("applies last-write-wins per envelope and moves the cursor", async () => {
    const before = await call("/api/sync?since=0", { device: laptop });
    const cursor = before.json.cursor as number;

    const older = seal(laptop, accountId, personal, "stale", { id: first.id, createdAt: first.createdAt, updatedAt: first.updatedAt });
    const newer = seal(laptop, accountId, personal, "Great misal, go early", {
      id: first.id,
      createdAt: first.createdAt,
      updatedAt: first.updatedAt + 1000,
    });
    expect((await call("/api/envelopes", { body: { envelopes: [older] }, device: laptop })).json.unchanged).toEqual([first.id]);
    expect((await call("/api/envelopes", { body: { envelopes: [newer] }, device: laptop })).json.accepted).toEqual([first.id]);

    const pull = await call(`/api/sync?since=${cursor}`, { device: laptop });
    expect(pull.json.envelopes).toEqual([newer]);
    expect(pull.json.cursor).toBeGreaterThan(cursor);
    expect((await call(`/api/sync?since=${pull.json.cursor}`, { device: laptop })).json.envelopes).toEqual([]);
  });

  it("rejects bad signatures, other authors, foreign boards and changed fixed fields", async () => {
    const tampered = { ...seal(laptop, accountId, personal, "x"), placeId: "place2" };
    const otherAuthor = seal(laptop, randomId(), personal, "x");
    const foreign = seal(laptop, accountId, generateBoardKey(randomId()), "x");
    const staleKey = seal(laptop, accountId, { ...personal, version: 2 }, "x");
    const moved = sealEnvelope({
      type: "comment",
      authorId: accountId,
      deviceId: laptop.id,
      placeId: "place9",
      payload: { text: "x" },
      boards: [personal],
      signSecretKey: laptop.keys.signSecretKey,
      id: first.id,
      createdAt: first.createdAt,
      updatedAt: first.updatedAt + 5000,
    });
    const res = await call("/api/envelopes", {
      body: { envelopes: [tampered, otherAuthor, foreign, staleKey, moved, { id: "x" }] },
      device: laptop,
    });
    expect(res.json.accepted).toEqual([]);
    expect(Object.fromEntries(res.json.rejected.map((r: { id: string; reason: string }) => [r.id, r.reason]))).toEqual({
      [tampered.id]: "bad_signature",
      [otherAuthor.id]: "not_author",
      [foreign.id]: "board_not_allowed",
      [staleKey.id]: "board_not_allowed",
      [first.id]: "immutable_field",
      x: "invalid",
    });
  });

  it("pages with limit and more", async () => {
    const batch = [1, 2, 3].map((n) => seal(laptop, accountId, personal, `note ${n}`));
    await call("/api/envelopes", { body: { envelopes: batch }, device: laptop });
    const page1 = await call("/api/sync?since=0&limit=2", { device: laptop });
    expect(page1.json.envelopes).toHaveLength(2);
    expect(page1.json.more).toBe(true);
    const page2 = await call(`/api/sync?since=${page1.json.cursor}&limit=2`, { device: laptop });
    expect(page2.json.envelopes).toHaveLength(2);
    expect(page2.json.more).toBe(false);
  });

  it("tombstones a deleted envelope so other devices drop it", async () => {
    const before = (await call("/api/sync?since=0&limit=500", { device: laptop })).json.cursor as number;
    const res = await call("/api/envelopes/delete", { body: { ids: [first.id, "nope"] }, device: laptop });
    expect(res.json).toEqual({ deleted: [first.id] });
    const pull = await call(`/api/sync?since=${before}`, { device: laptop });
    expect(pull.json.envelopes).toEqual([]);
    expect(pull.json.deleted).toEqual([first.id]);

    const revived = seal(laptop, accountId, personal, "back", { id: first.id, createdAt: first.createdAt, updatedAt: Date.now() + 1 });
    const push = await call("/api/envelopes", { body: { envelopes: [revived] }, device: laptop });
    expect(push.json.rejected).toEqual([{ id: first.id, reason: "deleted" }]);
  });
});

describe("second device sign-in", () => {
  const phone = newDevice();

  it("fetches the backup by lookup id only", async () => {
    expect((await call("/api/key-backup/fetch", { body: { lookup: toBase64(new Uint8Array(32)) } })).status).toBe(404);
    const res = await call("/api/key-backup/fetch", { body: { lookup: LOOKUP } });
    expect(res.status).toBe(200);
    expect(res.json.accountId).toBe(accountId);
    expect(new TextDecoder().decode(openKeyBackup(res.json.backup, "correct horse"))).toBe("bundle");
  });

  it("registers a device authorised by the account key, which sees the account's board keys", async () => {
    const forged = deviceBody(accountId, phone, generateAccountKeys(), "android");
    expect((await call("/api/devices", { body: { accountId, device: forged }, device: phone })).status).toBe(403);

    const res = await call("/api/devices", {
      body: { accountId, device: deviceBody(accountId, phone, account, "android") },
      device: phone,
    });
    expect(res.status).toBe(201);

    // No keys were stored for the phone: it opens the same account-wrapped key as the laptop.
    const me = await call("/api/me", { device: phone });
    expect(me.json.devices).toHaveLength(2);
    expect(unwrapKeyFromMember(fromBase64(me.json.boards[0].keys[0].wrappedKey), accountBox)).toEqual(personal.key);
    // The phone sees what the laptop wrote.
    const pull = await call("/api/sync?since=0", { device: phone });
    expect(pull.json.envelopes.length).toBeGreaterThan(0);
  });

  it("refuses board keys for boards the account is not in", async () => {
    const res = await call("/api/board-keys", {
      method: "PUT",
      body: { boardKeys: [{ boardId: randomId(), keyVersion: 1, wrappedKey: toBase64(new Uint8Array(80)) }] },
      device: phone,
    });
    expect(res.status).toBe(403);
  });

  it("replaces the backup from a signed device", async () => {
    const backup = createKeyBackup(encoder.encode("bundle v2"), "new phrase", FAST_KDF);
    const newLookup = toBase64(new Uint8Array(32).fill(9));
    expect((await call("/api/key-backup", { method: "PUT", body: { lookup: newLookup, backup } })).status).toBe(401);
    const res = await call("/api/key-backup", { method: "PUT", body: { lookup: newLookup, backup }, device: phone });
    expect(res.status).toBe(200);
    expect((await call("/api/key-backup/fetch", { body: { lookup: LOOKUP } })).status).toBe(404);
    const fetched = await call("/api/key-backup/fetch", { body: { lookup: newLookup } });
    expect(new TextDecoder().decode(openKeyBackup(fetched.json.backup, "new phrase"))).toBe("bundle v2");
  });

  it("rejects requests from a revoked device", async () => {
    await env.DB.prepare("UPDATE devices SET revoked_at = ? WHERE id = ?").bind(Date.now(), phone.id).run();
    expect((await call("/api/me", { device: phone })).status).toBe(401);
  });
});

describe("tiles", () => {
  const data = Uint8Array.from({ length: 1000 }, (_, i) => i % 256);

  beforeAll(async () => {
    await env.TILES.put("mumbai.pmtiles", data);
  });

  const get = (headers: Record<string, string> = {}, method = "GET") =>
    exports.default.fetch(new Request("https://map.snehilsinha.com/api/tiles/mumbai.pmtiles", { method, headers }));

  it("serves the whole file and byte ranges", async () => {
    const whole = await get();
    expect(whole.status).toBe(200);
    expect(whole.headers.get("Accept-Ranges")).toBe("bytes");
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(data);

    const part = await get({ Range: "bytes=10-19" });
    expect(part.status).toBe(206);
    expect(part.headers.get("Content-Range")).toBe("bytes 10-19/1000");
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(data.slice(10, 20));

    const tail = await get({ Range: "bytes=-5" });
    expect(tail.headers.get("Content-Range")).toBe("bytes 995-999/1000");
  });

  it("answers HEAD and If-None-Match, and 404s other files", async () => {
    const head = await get({}, "HEAD");
    expect(head.status).toBe(200);
    expect(head.headers.get("Content-Length")).toBe("1000");
    const etag = head.headers.get("ETag") ?? "";
    expect((await get({ "If-None-Match": etag })).status).toBe(304);
    const other = await exports.default.fetch(new Request("https://map.snehilsinha.com/api/tiles/other.pmtiles"));
    expect(other.status).toBe(404);
  });
});
