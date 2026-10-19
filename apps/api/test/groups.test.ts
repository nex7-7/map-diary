// Groups, invites, leaving and removal, run through @map-diary/sync against the real Worker.
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  deriveAccount,
  generateIdentity,
  generateRecoveryPhrase,
  groupInviteId,
  groupInviteToken,
  randomId,
  ready,
  toBase64,
  wrapKeyForMember,
} from "@map-diary/crypto";
import {
  Api,
  Diary,
  GroupError,
  MemoryStorage,
  acceptGroupInvite,
  createGroup,
  createGroupInvite,
  inviteSecretFrom,
  leaveGroup,
  listGroups,
  readGroupInvite,
  removeGroupMember,
  type DeviceState,
  type DiaryItem,
} from "@map-diary/sync";

await ready();

const api = new Api({ origin: "https://map.snehilsinha.com", fetch: (r) => exports.default.fetch(r) });

/**
 * An account with one web device, inserted directly: only the first account may sign up,
 * and app invites are built elsewhere.
 */
async function makeAccount(): Promise<DeviceState> {
  const account = deriveAccount(generateRecoveryPhrase().seed);
  const box = account.accountBoxKeys(1);
  const personal = account.personalBoardKey(1);
  const identity = generateIdentity();
  const deviceId = randomId();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO accounts (id, created_at, sign_public_key, box_public_key, box_key_version) VALUES (?, ?, ?, ?, 1)",
    ).bind(account.accountId, now, account.accountKeys.signPublicKey, box.publicKey),
    env.DB.prepare(
      "INSERT INTO devices (id, account_id, kind, sign_public_key, box_public_key, created_at) VALUES (?, ?, 'web', ?, ?, ?)",
    ).bind(deviceId, account.accountId, identity.signPublicKey, identity.boxPublicKey, now),
    env.DB.prepare("INSERT INTO boards (id, kind, owner_account_id, created_at) VALUES (?, 'personal', ?, ?)").bind(
      personal.boardId,
      account.accountId,
      now,
    ),
    env.DB.prepare("INSERT INTO board_members (board_id, account_id, joined_at) VALUES (?, ?, ?)").bind(
      personal.boardId,
      account.accountId,
      now,
    ),
    env.DB.prepare(
      "INSERT INTO board_keys (board_id, key_version, account_id, account_key_version, wrapped_key, created_at) VALUES (?, 1, ?, 1, ?, ?)",
    ).bind(personal.boardId, account.accountId, wrapKeyForMember(personal.key, box.publicKey), now),
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

function diaryOf(device: DeviceState) {
  return new Diary(device, new MemoryStorage(), api);
}

async function expectGroupError(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(GroupError);
  expect((err as GroupError).code).toBe(code);
}

const byType = (items: DiaryItem[], type: string) => items.filter((i) => i.type === type);
/** Boards the device holds a key for or knows it is in. */
const heldBoards = (diary: Diary) => [
  ...new Set([...diary.device.boardKeys.map((k) => k.boardId), ...(diary.device.boards ?? []).map((b) => b.id)]),
];

describe("groups", () => {
  let snehil: Diary;
  let asha: Diary;
  let ravi: Diary;
  let groupId: string;

  it("creates a group whose name only its members can read", async () => {
    snehil = diaryOf(await makeAccount());
    asha = diaryOf(await makeAccount());
    ravi = diaryOf(await makeAccount());

    groupId = await createGroup(snehil, api, "  Bandra   lot ");
    await snehil.sync();
    const groups = await listGroups(api, snehil.device);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: groupId, keyVersion: 1, rotationDue: false });
    expect(groups[0]!.members.map((m) => m.accountId)).toEqual([snehil.device.accountId]);

    const name = byType(await snehil.listItems(), "group");
    expect(name.map((i) => [i.payload, i.boardIds])).toEqual([[{ name: "Bandra lot" }, [groupId]]]);

    // The server holds only ciphertext for the name.
    const row = await env.DB.prepare("SELECT ciphertext FROM envelopes WHERE id = ?").bind(name[0]!.id).first<{
      ciphertext: ArrayBuffer;
    }>();
    expect(new TextDecoder().decode(new Uint8Array(row!.ciphertext))).not.toContain("Bandra");

    // Each sync tells the device which boards it is in and who is in each group.
    expect(snehil.device.boards?.find((b) => b.id === groupId)).toEqual({
      id: groupId,
      kind: "group",
      keyVersion: 1,
      memberIds: [snehil.device.accountId],
    });

    await asha.sync();
    expect(await asha.listItems()).toEqual([]);
  });

  it("joins by link and sees the group's items, including ones posted before", async () => {
    await snehil.write({ type: "status", placeId: "place-1", payload: { status: "want" }, boards: [groupId] });
    await snehil.sync();

    const { secret } = await createGroupInvite(api, snehil.device, groupId, "Bandra lot");
    const link = `https://map.snehilsinha.com/join#${secret}`;
    expect(inviteSecretFrom(link)).toBe(secret);

    // The Worker never saw the secret or the token, only values derived from it.
    const invite = await env.DB.prepare("SELECT * FROM invites WHERE id = ?").bind(groupInviteId(secret)).first();
    expect(JSON.stringify(invite)).not.toContain(secret);
    expect(JSON.stringify(invite)).not.toContain(groupInviteToken(secret));

    const seen = await readGroupInvite(api, asha.device, secret);
    expect(seen).toMatchObject({ groupId, groupName: "Bandra lot", members: 1, isMember: false });

    await acceptGroupInvite(asha, api, secret);
    await asha.sync();
    const items = await asha.listItems();
    expect(byType(items, "status").map((i) => i.payload)).toEqual([{ status: "want" }]);
    expect(byType(items, "group").map((i) => i.payload)).toEqual([{ name: "Bandra lot" }]);

    // One use only.
    await expectGroupError(acceptGroupInvite(ravi, api, secret), "invite_not_found");
  });

  it("refuses a made-up link and an accept without the token", async () => {
    await expectGroupError(readGroupInvite(api, ravi.device, "nope"), "invalid_link");
    const { secret } = await createGroupInvite(api, snehil.device, groupId, "Bandra lot");
    const signer = { deviceId: ravi.device.deviceId, signSecretKey: ravi.device.identity.signSecretKey };
    const forged = await api
      .acceptInvite(groupInviteId(secret), { token: toBase64(new Uint8Array(32)), keys: [{ keyVersion: 1, wrappedKey: "AAAA" }] }, signer)
      .catch((e: unknown) => e);
    expect(forged).toMatchObject({ status: 404 });
    await acceptGroupInvite(ravi, api, secret);
    await ravi.sync();
    expect((await listGroups(api, ravi.device))[0]!.members).toHaveLength(3);
  });

  it("refuses posting to a group the account is not in", async () => {
    const outsider = diaryOf(await makeAccount());
    await expect(
      outsider.write({ type: "comment", placeId: "place-1", payload: { text: "hi" }, boards: [groupId] }),
    ).rejects.toThrow(/no key/);
  });

  it("removes a member: their items go, and the group moves to a key they never get", async () => {
    const ravisComment = await ravi.write({
      type: "comment",
      placeId: "place-1",
      payload: { text: "Go for the prawns" },
      boards: [groupId],
    });
    const ravisBoth = await ravi.write({
      type: "status",
      placeId: "place-2",
      payload: { status: "visited" },
      boards: [groupId, ravi.device.personalBoardId],
    });
    await ravi.sync();
    await asha.sync();
    expect((await asha.listItems()).map((i) => i.id)).toEqual(expect.arrayContaining([ravisComment.id, ravisBoth.id]));

    await removeGroupMember(snehil, api, groupId, ravi.device.accountId);
    const groups = await listGroups(api, snehil.device);
    expect(groups[0]!.keyVersion).toBe(2);
    expect(groups[0]!.members.map((m) => m.accountId).sort()).toEqual([asha.device.accountId, snehil.device.accountId].sort());

    // The other member's device drops both of Ravi's items on its next sync and collects the new key.
    await asha.sync();
    const ashaIds = (await asha.listItems()).map((i) => i.id);
    expect(ashaIds).not.toContain(ravisComment.id);
    expect(ashaIds).not.toContain(ravisBoth.id);
    expect(asha.device.boardKeys.some((k) => k.boardId === groupId && k.version === 2)).toBe(true);

    // Ravi's device forgets the group. Its item that was also on the Personal board stays there.
    await ravi.sync();
    const raviItems = await ravi.listItems();
    expect(raviItems.map((i) => i.id)).toContain(ravisBoth.id);
    expect(raviItems.map((i) => i.id)).not.toContain(ravisComment.id);
    expect(raviItems.some((i) => i.authorId !== ravi.device.accountId)).toBe(false);
    expect(heldBoards(ravi)).not.toContain(groupId);

    // New items are sealed under version 2, which Ravi never received.
    const after = await asha.write({ type: "comment", placeId: "place-1", payload: { text: "new" }, boards: [groupId] });
    await asha.sync();
    const stored = await env.DB.prepare("SELECT key_version FROM envelope_boards WHERE envelope_id = ?").bind(after.id).first();
    expect(stored).toEqual({ key_version: 2 });
    const raviKeys = await env.DB.prepare("SELECT COUNT(*) AS n FROM board_keys WHERE board_id = ? AND account_id = ?")
      .bind(groupId, ravi.device.accountId)
      .first();
    expect(raviKeys).toEqual({ n: 0 });
  });

  it("leaves a group, and a remaining member's device rotates its key", async () => {
    const ashasNote = await asha.write({ type: "comment", placeId: "place-3", payload: { text: "mine" }, boards: [groupId] });
    await asha.sync();
    await snehil.sync();
    expect((await snehil.listItems()).map((i) => i.id)).toContain(ashasNote.id);

    await leaveGroup(asha, api, groupId);
    expect(heldBoards(asha)).not.toContain(groupId);
    const others = (items: DiaryItem[]) => items.filter((i) => i.authorId !== asha.device.accountId);
    expect(others(await asha.listItems()).some((i) => i.boardIds.includes(groupId))).toBe(false);
    await asha.sync();
    expect((await asha.listItems()).map((i) => i.id)).not.toContain(ashasNote.id);

    const before = await listGroups(api, snehil.device);
    expect(before[0]).toMatchObject({ rotationDue: true, keyVersion: 2 });

    await snehil.sync();
    expect((await snehil.listItems()).map((i) => i.id)).not.toContain(ashasNote.id);
    const after = await listGroups(api, snehil.device);
    expect(after[0]).toMatchObject({ rotationDue: false, keyVersion: 3 });
    expect(snehil.device.boardKeys.some((k) => k.boardId === groupId && k.version === 3)).toBe(true);

    // The group keeps its name though its creator could leave too.
    expect(byType(await snehil.listItems(), "group")).toHaveLength(1);
  });

  it("refuses a stale rotation and lets a member rejoin through a new invite", async () => {
    const signer = { deviceId: snehil.device.deviceId, signSecretKey: snehil.device.identity.signSecretKey };
    const stale = await api
      .rotateGroup(groupId, { keyVersion: 3, memberKeys: [{ accountId: snehil.device.accountId, accountKeyVersion: 1, wrappedKey: "AAAA" }] }, signer)
      .catch((e: unknown) => e);
    expect(stale).toMatchObject({ status: 409 });

    const { secret } = await createGroupInvite(api, snehil.device, groupId, "Bandra lot");
    await acceptGroupInvite(asha, api, secret);
    await asha.sync();
    expect(asha.device.boardKeys.filter((k) => k.boardId === groupId).map((k) => k.version).sort()).toEqual([1, 2, 3]);
    expect(byType(await asha.listItems(), "status").length).toBeGreaterThan(0);
  });

  it("drops open invites when the key moves on", async () => {
    const { secret } = await createGroupInvite(api, snehil.device, groupId, "Bandra lot");
    await removeGroupMember(snehil, api, groupId, asha.device.accountId);
    await expectGroupError(readGroupInvite(api, ravi.device, secret), "invite_not_found");
  });
});
