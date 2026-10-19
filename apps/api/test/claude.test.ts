// The Claude assistant's device: connecting it, its keys, its guardrails, top-ups and revoking.
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { openEnvelope, ready, sealEnvelope, fromBase64, type BoardKey, type Envelope } from "@map-diary/crypto";
import {
  Api,
  ClaudeError,
  Diary,
  MemoryStorage,
  connectClaude,
  createGroup,
  prepareSetup,
  revokeDevice,
  signInWithPassphrase,
  type DeviceState,
  type Signer,
} from "@map-diary/sync";
import { unlockClaudeDevice, type UnlockedClaude } from "../src/claude";

await ready();

const FAST_KDF = { opsLimit: 1, memLimit: 8 << 20 };
const PASSPHRASE = "vada pav at dadar station";

const api = new Api({ origin: "https://map.snehilsinha.com", fetch: (r) => exports.default.fetch(r) });

const signerOf = (c: UnlockedClaude): Signer => ({ deviceId: c.deviceId, signSecretKey: c.identity.signSecretKey });

function sealAs(c: UnlockedClaude, input: { type: Envelope["type"]; placeId: string | null; text: string; boards: BoardKey[]; id?: string; createdAt?: number }) {
  return sealEnvelope({
    type: input.type,
    authorId: c.accountId,
    deviceId: c.deviceId,
    placeId: input.placeId,
    payload: { text: input.text },
    boards: input.boards,
    signSecretKey: c.identity.signSecretKey,
    ...(input.id === undefined ? {} : { id: input.id }),
    ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
  });
}

const newest = (c: UnlockedClaude, boardId: string) =>
  c.boardKeys.filter((k) => k.boardId === boardId).sort((a, b) => b.version - a.version)[0]!;

describe("the Claude assistant's device", () => {
  let phone: DeviceState;
  let phrase: string;
  let phoneDiary: Diary;
  let secret: string;
  let claude: UnlockedClaude;
  let masterId: string;
  let groupId: string;

  it("connects Claude with only the master and Personal keys, unlocked by the secret alone", async () => {
    const setup = await prepareSetup({ passphrase: PASSPHRASE, kdf: FAST_KDF });
    phrase = setup.recoveryPhrase;
    phone = await setup.complete(api);
    phoneDiary = new Diary(phone, new MemoryStorage(), api);
    groupId = await createGroup(phoneDiary, api, "Bandra lot");
    await phoneDiary.write({ type: "comment", placeId: "p1", payload: { text: "group only" }, boards: [groupId] });
    await phoneDiary.write({ type: "comment", placeId: "p1", payload: { text: "personal" } });
    await phoneDiary.sync();
    phone = phoneDiary.device;
    masterId = phone.boards!.find((b) => b.kind === "master")!.id;

    const connected = await connectClaude(api, phone);
    secret = connected.connectorSecret;
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // The server holds neither the secret nor the device's secret keys in the clear.
    const row = await env.DB.prepare("SELECT secret_hash, sealed_keys FROM claude_connectors WHERE device_id = ?")
      .bind(connected.deviceId)
      .first<{ secret_hash: ArrayBuffer; sealed_keys: ArrayBuffer }>();
    expect(row).not.toBeNull();
    expect(new Uint8Array(row!.secret_hash)).not.toEqual(fromBase64(secret));

    claude = (await unlockClaudeDevice(env.DB, secret))!;
    expect(claude).toMatchObject({ deviceId: connected.deviceId, accountId: phone.accountId, upToDate: true });
    expect(claude.boards.map((b) => b.kind).sort()).toEqual(["master", "personal"]);
    expect(new Set(claude.boardKeys.map((k) => k.boardId))).toEqual(new Set([masterId, phone.personalBoardId]));
    expect(claude.boardKeys.some((k) => k.boardId === groupId)).toBe(false);
    for (const k of claude.boardKeys) {
      expect(k.key).toEqual(phone.boardKeys.find((p) => p.boardId === k.boardId && p.version === k.version)!.key);
    }

    expect(await unlockClaudeDevice(env.DB, "not a secret")).toBeNull();
    expect(await unlockClaudeDevice(env.DB, secret.slice(0, -2) + (secret.endsWith("AA") ? "AB" : "AA"))).toBeNull();
    await expect(connectClaude(api, phone)).rejects.toMatchObject({ code: "already_connected" });
    await expect(connectClaude(api, phone)).rejects.toBeInstanceOf(ClaudeError);
  });

  it("refuses Claude account keys, groups, pairing, revoking, backups and admin routes", async () => {
    const s = signerOf(claude);
    const refused = { status: 403, code: "claude_not_allowed" };
    await expect(api.accountKey(s)).rejects.toMatchObject(refused);
    await expect(api.me(s)).rejects.toMatchObject(refused);
    await expect(api.listGroups(s)).rejects.toMatchObject(refused);
    await expect(api.boardMembers(groupId, s)).rejects.toMatchObject(refused);
    await expect(api.listAppInvites(s)).rejects.toMatchObject(refused);
    await expect(api.listMembers(s)).rejects.toMatchObject(refused);
    await expect(api.openPairing("x", s)).rejects.toMatchObject(refused);
    await expect(api.putBoardKeys([], s)).rejects.toMatchObject(refused);
    await expect(
      api.revokeDevice(phone.deviceId, { boxPublicKey: "", boxKeyVersion: 2, boxKeySignature: "", boardKeys: [], deviceKeys: [], memberKeys: [] }, s),
    ).rejects.toMatchObject(refused);
    await expect(api.putClaudeBoardKeys(claude.deviceId, [], s)).rejects.toMatchObject(refused);
  });

  it("reads only the master and Personal boards", async () => {
    const page = await api.pull(0, signerOf(claude));
    expect(page.boards.map((b) => b.kind).sort()).toEqual(["master", "personal"]);
    const lookup = (boardId: string, version: number) => claude.boardKeys.find((k) => k.boardId === boardId && k.version === version)?.key;
    const texts = page.envelopes
      .filter((e) => e.type === "comment")
      .map((e) => (openEnvelope(e, { boardKey: lookup, signerPublicKey: fromBase64(page.devices[e.deviceId]!.signPublicKey) }).payload as { text: string }).text);
    expect(texts).toEqual(["personal"]);
  });

  it("writes to master and Personal, edits only places it wrote, and never touches a group", async () => {
    const s = signerOf(claude);
    const master = newest(claude, masterId);
    const personal = newest(claude, phone.personalBoardId);

    const place = sealAs(claude, { type: "place", placeId: null, text: "Kyani & Co", boards: [master] });
    const comment = sealAs(claude, { type: "comment", placeId: place.id, text: "via Claude", boards: [personal] });
    expect(await api.pushEnvelopes([place, comment], s)).toMatchObject({ accepted: [place.id, comment.id], rejected: [] });

    // Its own place's facts it may fix; the phone's are locked to it.
    const fixed = sealAs(claude, { type: "place", placeId: null, text: "Kyani and Co", boards: [master], id: place.id, createdAt: place.createdAt });
    expect((await api.pushEnvelopes([fixed], s)).accepted).toEqual([place.id]);
    await phoneDiary.write({ type: "place", placeId: null, payload: { name: "Cafe Madras" } });
    await phoneDiary.sync();
    const phonePlace = (await phoneDiary.listItems()).find((i) => i.type === "place" && i.deviceId === phone.deviceId)!;
    const edit = sealAs(claude, { type: "place", placeId: null, text: "renamed", boards: [master], id: phonePlace.id, createdAt: phonePlace.createdAt });
    expect((await api.pushEnvelopes([edit], s)).rejected).toEqual([{ id: phonePlace.id, reason: "facts_locked" }]);

    // A group board is out of reach even with a key it should never have.
    const groupKey = phone.boardKeys.find((k) => k.boardId === groupId)!;
    const sneaky = sealAs(claude, { type: "comment", placeId: "p1", text: "to the group", boards: [groupKey] });
    expect((await api.pushEnvelopes([sneaky], s)).rejected).toEqual([{ id: sneaky.id, reason: "board_not_allowed" }]);

    // The account's group-only opinion can be neither rewritten nor deleted by Claude.
    const groupOnly = (await phoneDiary.listItems()).find((i) => (i.payload as { text?: string }).text === "group only")!;
    const rewrite = sealAs(claude, { type: "comment", placeId: "p1", text: "moved", boards: [personal], id: groupOnly.id, createdAt: groupOnly.createdAt });
    expect((await api.pushEnvelopes([rewrite], s)).rejected).toEqual([{ id: groupOnly.id, reason: "board_not_allowed" }]);
    expect(await api.deleteEnvelopes([groupOnly.id, comment.id, place.id], s)).toEqual({ deleted: [comment.id] });
  });

  it("gets rotated keys from the owner's next sync, and nothing before", async () => {
    const laptop = await signInWithPassphrase(api, PASSPHRASE);
    phone = await revokeDevice(api, phoneDiary.device, laptop.deviceId, { recoveryPhrase: phrase });

    // The revoke rotated master and Personal; Claude reads older items but cannot write yet.
    const behind = (await unlockClaudeDevice(env.DB, secret))!;
    expect(behind.upToDate).toBe(false);

    phoneDiary = new Diary(phone, new MemoryStorage(), api);
    await phoneDiary.sync();
    claude = (await unlockClaudeDevice(env.DB, secret))!;
    expect(claude.upToDate).toBe(true);
    expect(newest(claude, masterId).version).toBe(2);
    expect(newest(claude, phone.personalBoardId).version).toBe(2);
    expect(claude.boardKeys.some((k) => k.boardId === groupId)).toBe(false);

    // Another owner device may top up only Claude devices of its own account, and only
    // master and Personal versions that exist.
    await expect(
      api.putClaudeBoardKeys(claude.deviceId, [{ boardId: groupId, keyVersion: 1, wrappedKey: "AAAA" }], {
        deviceId: phone.deviceId,
        signSecretKey: phone.identity.signSecretKey,
      }),
    ).rejects.toMatchObject({ status: 403, code: "board_not_allowed" });
  });

  it("revokes Claude: its keys are deleted and the secret opens nothing", async () => {
    phone = await revokeDevice(api, phoneDiary.device, claude.deviceId, { recoveryPhrase: phrase });
    expect(await unlockClaudeDevice(env.DB, secret)).toBeNull();
    const left = await env.DB.batch([
      env.DB.prepare("SELECT COUNT(*) AS n FROM claude_connectors"),
      env.DB.prepare("SELECT COUNT(*) AS n FROM device_board_keys"),
    ]);
    expect(left.map((r) => (r.results[0] as { n: number }).n)).toEqual([0, 0]);
    await expect(api.pull(0, signerOf(claude))).rejects.toMatchObject({ status: 401, code: "device_revoked" });

    // A new connection is possible once the old one is gone.
    phoneDiary = new Diary(phone, new MemoryStorage(), api);
    await phoneDiary.sync();
    const again = await connectClaude(api, phoneDiary.device);
    expect((await unlockClaudeDevice(env.DB, again.connectorSecret))?.upToDate).toBe(true);
  });
});
