// The Claude assistant's MCP tools, end to end: the owner connects Claude from their device,
// then the connector calls the real Worker with its secret, against a local D1.
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ready, type JsonValue } from "@map-diary/crypto";
import { Api, Diary, MemoryStorage, connectClaude, createGroup, masterBoardOf, prepareSetup, type DeviceState } from "@map-diary/sync";

await ready();

const ORIGIN = "https://map.snehilsinha.com";
const api = new Api({ origin: ORIGIN, fetch: (r) => exports.default.fetch(r) });
const placeLinks = (payload: JsonValue) => {
  const links = (payload as { sourceLinks?: unknown }).sourceLinks;
  return Array.isArray(links) ? links.filter((l): l is string => typeof l === "string") : [];
};

let owner: DeviceState;
let ownerDiary: Diary;
let secret: string;
let claudeDeviceId: string;

let rpcId = 0;
async function rpc(method: string, params: unknown = {}, auth: { path?: string; bearer?: string } = { bearer: secret }) {
  return exports.default.fetch(
    new Request(`${ORIGIN}/api/claude/mcp${auth.path ? `/${auth.path}` : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(auth.bearer ? { Authorization: `Bearer ${auth.bearer}` } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    }),
  );
}

type Answer = { text: string; isError: boolean; value: Record<string, unknown> };
async function call(name: string, args: Record<string, unknown> = {}): Promise<Answer> {
  const res = await rpc("tools/call", { name, arguments: args });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { result: { content: { text: string }[]; isError?: boolean; structuredContent?: Record<string, unknown> } };
  return { text: body.result.content[0]!.text, isError: body.result.isError === true, value: body.result.structuredContent ?? {} };
}

describe("the Claude assistant's MCP tools", () => {
  let cafeId: string;

  it("sets up an owner with a master board and a Claude device", async () => {
    const setup = await prepareSetup({ passphrase: "vada pav at kirti college", kdf: { opsLimit: 1, memLimit: 8 << 20 } });
    owner = await setup.complete(api);
    ownerDiary = new Diary(owner, new MemoryStorage(), api, { placeLinks });
    await ownerDiary.sync();
    owner = ownerDiary.device;
    expect(masterBoardOf(owner)).toBeDefined();
    const connected = await connectClaude(api, owner);
    secret = connected.connectorSecret;
    claudeDeviceId = connected.deviceId;
  });

  it("speaks MCP and refuses a wrong secret", async () => {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18" });
    expect(((await init.json()) as { result: { serverInfo: { name: string } } }).result.serverInfo.name).toBe("map-diary");
    const list = (await (await rpc("tools/list")).json()) as { result: { tools: { name: string }[] } };
    expect(list.result.tools.map((t) => t.name)).toEqual([
      "search_places",
      "get_place",
      "list_tags",
      "add_place",
      "set_status",
      "add_tag",
      "add_comment",
    ]);
    expect((await rpc("tools/list", {}, { bearer: "wrong" })).status).toBe(401);
    expect((await rpc("tools/list", {}, {})).status).toBe(401);
    // The secret is never accepted in the URL.
    expect((await rpc("tools/list", {}, { path: secret })).status).not.toBe(200);
  });

  it("adds a checked place to the catalogue, with the status on Personal by default", async () => {
    const outside = await call("add_place", { name: "Somewhere", category: "beach", location: { lat: 28.6, lng: 77.2 } });
    expect(outside).toMatchObject({ isError: true });
    expect(outside.text).toMatch(/inside Mumbai/);

    const added = await call("add_place", {
      name: "Café Madras",
      category: "restaurant",
      location: { lat: 19.0269, lng: 72.8553 },
      cuisine: "South Indian",
      signatureDish: { name: "Rasam vada", priceInr: 120 },
      sourceLinks: ["https://maps.app.goo.gl/madras?g_st=iw"],
      comment: "Go before 9 on a Sunday",
    });
    expect(added.isError).toBe(false);
    expect(added.value).toMatchObject({ status: "want", boards: ["personal"] });
    cafeId = added.value.placeId as string;

    // The owner's phone reads what Claude wrote, signed by the Claude device.
    await ownerDiary.sync();
    expect(ownerDiary.skipped).toEqual([]);
    const items = await ownerDiary.listItems();
    const place = items.find((i) => i.id === cafeId)!;
    expect(place.boardIds).toEqual([masterBoardOf(owner)!.id]);
    const status = items.find((i) => i.type === "status" && i.placeId === cafeId)!;
    expect(status).toMatchObject({ boardIds: [owner.personalBoardId], payload: { status: "want" }, viaClaude: true });
    expect(place.viaClaude).toBe(true);
    const rows = await env.DB.prepare("SELECT DISTINCT device_id FROM envelopes WHERE place_id = ? OR id = ?").bind(cafeId, cafeId).all();
    expect(rows.results).toEqual([{ device_id: claudeDeviceId }]);
  });

  it("refuses a duplicate link and points at the place already there", async () => {
    const dup = await call("add_place", {
      name: "Cafe Madras",
      category: "restaurant",
      location: { lat: 19.0269, lng: 72.8553 },
      sourceLinks: ["https://maps.app.goo.gl/madras"],
    });
    expect(dup.isError).toBe(true);
    expect(dup.text).toContain(cafeId);
  });

  it("searches and lists places, and reads one with its opinions", async () => {
    const other = await ownerDiary.write({
      type: "place",
      placeId: null,
      payload: { name: "Juhu Beach", category: "beach", location: { lat: 19.09, lng: 72.82 }, sourceLinks: [] },
    });
    await ownerDiary.write({ type: "status", placeId: other.id, payload: { status: "visited" }, boards: [masterBoardOf(owner)!.id] });
    await ownerDiary.sync();

    const byName = await call("search_places", { query: "cafe" });
    expect((byName.value.places as { id: string; myStatus: string }[]).map((p) => [p.id, p.myStatus])).toEqual([[cafeId, "want"]]);
    const byDish = await call("search_places", { query: "rasam" });
    expect(byDish.value.total).toBe(1);
    const visited = await call("search_places", { status: "visited" });
    expect((visited.value.places as { name: string }[]).map((p) => p.name)).toEqual(["Juhu Beach"]);
    const none = await call("search_places", { status: "none" });
    expect(none.value.total).toBe(0);

    const got = await call("get_place", { placeId: cafeId });
    expect(got.value.place).toMatchObject({ name: "Café Madras", myStatus: "want", cuisine: "South Indian" });
    const opinions = got.value.opinions as { kind: string; viaClaude: boolean; mine: boolean; boards: string[] }[];
    expect(opinions.map((o) => o.kind).sort()).toEqual(["comment", "status"]);
    expect(opinions.every((o) => o.viaClaude && o.mine && o.boards[0] === "personal")).toBe(true);

    expect(await call("get_place", { placeId: "nope" })).toMatchObject({ isError: true });
  });

  it("changes the status in place and can post it publicly", async () => {
    const set = await call("set_status", { placeId: cafeId, status: "visited", boards: ["public"] });
    expect(set.value).toMatchObject({ status: "visited", boards: ["public"] });
    await ownerDiary.sync();
    const statuses = (await ownerDiary.listItems()).filter((i) => i.type === "status" && i.placeId === cafeId);
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({ boardIds: [masterBoardOf(owner)!.id], payload: { status: "visited" } });
  });

  it("tags with a new or existing tag, and widens the owner's own tag to the board asked for", async () => {
    const made = await call("add_tag", { placeId: cafeId, newTag: { name: "Breakfast", emoji: "🍳" } });
    expect(made.isError).toBe(false);
    const tags = await call("list_tags");
    const breakfast = (tags.value.tags as { id: string; name: string; boards: string[] }[]).find((t) => t.name === "Breakfast")!;
    expect(breakfast.boards).toEqual(["personal"]);

    const again = await call("add_tag", { placeId: cafeId, tagId: breakfast.id });
    expect(again.value.note).toBe("Already tagged.");
    const widened = await call("add_tag", { placeId: cafeId, tagId: breakfast.id, boards: ["public"] });
    expect(widened.isError).toBe(false);
    const after = await call("list_tags");
    expect((after.value.tags as { id: string; boards: string[] }[]).find((t) => t.id === breakfast.id)!.boards.sort()).toEqual(["personal", "public"]);
    // The tag on the place moves to the board asked for too, not only its definition.
    expect(widened.value.boards).toEqual(["personal", "public"]);
    await ownerDiary.sync();
    const tagged = (await ownerDiary.listItems()).filter((i) => i.type === "tag" && i.placeId === cafeId);
    expect(tagged).toHaveLength(1);
    expect(tagged[0]!.boardIds.sort()).toEqual([owner.personalBoardId, masterBoardOf(owner)!.id].sort());
  });

  it("keeps opinions on a dropped pin to the boards the pin is on", async () => {
    const pin = await ownerDiary.write({
      type: "private_place",
      placeId: null,
      payload: { name: "Secret vada pav", category: "restaurant", location: { lat: 19.02, lng: 72.84 }, sourceLinks: [] },
    });
    await ownerDiary.sync();
    const publicStatus = await call("set_status", { placeId: pin.id, status: "want", boards: ["public"] });
    expect(publicStatus).toMatchObject({ isError: true });
    expect(publicStatus.text).toMatch(/dropped pin/);
    expect((await call("set_status", { placeId: pin.id, status: "want" })).value).toMatchObject({ boards: ["personal"] });
    expect((await call("add_comment", { placeId: pin.id, text: "Best chutney", boards: ["personal", "public"] })).isError).toBe(true);
    expect((await call("add_comment", { placeId: pin.id, text: "Best chutney" })).isError).toBe(false);
  });

  it("needs a status before tagging or commenting", async () => {
    const bare = await ownerDiary.write({
      type: "place",
      placeId: null,
      payload: { name: "Prithvi Cafe", category: "cafe-bar", location: { lat: 19.105, lng: 72.826 }, sourceLinks: [] },
    });
    await ownerDiary.sync();
    const refused = await call("add_comment", { placeId: bare.id, text: "Irish coffee" });
    expect(refused).toMatchObject({ isError: true });
    expect(refused.text).toMatch(/set_status/);
  });

  it("treats a merged duplicate as the place it was merged into", async () => {
    const master = masterBoardOf(owner)!.id;
    const dupFacts = { name: "Cafe Madras Matunga", category: "restaurant", location: { lat: 19.027, lng: 72.855 }, sourceLinks: ["https://example.com/madras-2"] };
    const dup = await ownerDiary.write({ type: "place", placeId: null, payload: dupFacts });
    const note = await ownerDiary.write({ type: "comment", placeId: dup.id, payload: { text: "filter coffee" }, boards: [master] });
    await ownerDiary.sync();
    // What the admin's Merge does: the duplicate points at the kept place, which lists it.
    const kept = (await ownerDiary.getItem(cafeId))!;
    await ownerDiary.write({ id: dup.id, type: "place", placeId: null, payload: { ...dupFacts, mergedInto: cafeId } });
    await ownerDiary.write({ id: cafeId, type: "place", placeId: null, payload: { ...(kept.payload as Record<string, JsonValue>), mergedFrom: [dup.id] } });
    await ownerDiary.sync();
    expect(ownerDiary.skipped).toEqual([]);

    const found = await call("search_places", { query: "madras" });
    expect((found.value.places as { id: string }[]).map((p) => p.id)).toEqual([cafeId]);
    const viaDup = await call("get_place", { placeId: dup.id });
    expect((viaDup.value.place as { id: string }).id).toBe(cafeId);
    expect((viaDup.value.opinions as { id: string }[]).map((o) => o.id)).toContain(note.id);
  });

  it("treats a chain's outlets as one place, with one status", async () => {
    const chain = { id: "chain-cartel", name: "The Bombay Cartel" };
    const outlet = (area: string, lat: number) => ({
      name: "The Bombay Cartel",
      category: "cafe-bar",
      address: `${area}, Mumbai 400013`,
      location: { lat, lng: 72.83 },
      sourceLinks: [],
      chain,
    });
    const parel = await ownerDiary.write({ type: "place", placeId: null, payload: outlet("Lower Parel", 19.0) });
    const bandra = await ownerDiary.write({ type: "place", placeId: null, payload: outlet("Bandra West", 19.06) });
    await ownerDiary.write({ type: "status", placeId: parel.id, payload: { status: "want" } });
    await ownerDiary.sync();

    const found = await call("search_places", { query: "cartel" });
    const places = found.value.places as { id: string; myStatus: string | null; outlets?: { id: string }[] }[];
    expect(places).toHaveLength(1);
    expect(places[0]!.myStatus).toBe("want");
    expect(places[0]!.outlets?.map((o) => o.id).sort()).toEqual([parel.id, bandra.id].sort());
    expect((await call("search_places", { query: "bandra cartel" })).value.places).toMatchObject([{ myStatus: "want" }]);
    expect((await call("search_places", { query: "cartel", status: "none" })).value.total).toBe(0);

    // Through the other outlet: the same status changes, and tagging needs no second one.
    expect((await call("get_place", { placeId: bandra.id })).value.place).toMatchObject({ myStatus: "want" });
    expect((await call("set_status", { placeId: bandra.id, status: "visited" })).isError).toBe(false);
    expect((await call("add_comment", { placeId: bandra.id, text: "Bandra one is quieter" })).isError).toBe(false);
    await ownerDiary.sync();
    const statuses = (await ownerDiary.listItems()).filter((i) => i.type === "status" && (i.placeId === parel.id || i.placeId === bandra.id));
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({ placeId: parel.id, payload: { status: "visited" } });
  });

  it("never reads a group board, and will not rewrite an item that is also on one", async () => {
    const groupId = await createGroup(ownerDiary, api, "Bandra lot");
    owner = ownerDiary.device;
    const secretPlace = await ownerDiary.write({
      type: "private_place",
      placeId: null,
      payload: { name: "Group-only spot", category: "beach", location: { lat: 19.05, lng: 72.82 }, sourceLinks: [] },
      boards: [groupId],
    });
    await ownerDiary.write({ type: "comment", placeId: cafeId, payload: { text: "group only note" }, boards: [groupId] });
    const juhu = (await ownerDiary.listItems()).find((i) => i.type === "place" && (i.payload as { name: string }).name === "Juhu Beach")!;
    const juhuStatus = (await ownerDiary.listItems()).find((i) => i.type === "status" && i.placeId === juhu.id)!;
    await ownerDiary.write({ id: juhuStatus.id, type: "status", placeId: juhu.id, payload: { status: "visited" }, boards: [masterBoardOf(owner)!.id, groupId] });
    await ownerDiary.sync();
    expect(ownerDiary.skipped).toEqual([]);

    expect((await call("search_places", { query: "group" })).value.total).toBe(0);
    expect(await call("get_place", { placeId: secretPlace.id })).toMatchObject({ isError: true });
    const texts = ((await call("get_place", { placeId: cafeId })).value.opinions as { text?: string }[]).map((o) => o.text);
    expect(texts).not.toContain("group only note");

    const refused = await call("set_status", { placeId: juhu.id, status: "want" });
    expect(refused).toMatchObject({ isError: true });
    expect(refused.text).toMatch(/group/);

    // A status on the group board alone is invisible to Claude, but it still will not add a second one.
    const prithvi = (await ownerDiary.listItems()).find((i) => i.type === "place" && (i.payload as { name: string }).name === "Prithvi Cafe")!;
    await ownerDiary.write({ type: "status", placeId: prithvi.id, payload: { status: "want" }, boards: [groupId] });
    await ownerDiary.sync();
    expect((await call("set_status", { placeId: prithvi.id, status: "visited" })).isError).toBe(true);
  });

  it("refuses writes until it has the newest key, with a plain message", async () => {
    // As if another device rotated the master key and no device of the owner has synced since.
    const master = masterBoardOf(owner)!;
    await env.DB.prepare("UPDATE boards SET key_version = key_version + 1 WHERE id = ?").bind(master.id).run();
    const refused = await call("set_status", { placeId: cafeId, status: "want", boards: ["public"] });
    expect(refused).toMatchObject({ isError: true });
    expect(refused.text).toMatch(/Open the app once/);
    // Reading older items still works.
    expect((await call("get_place", { placeId: cafeId })).isError).toBe(false);
  });

  it("stops working once the Claude device is revoked", async () => {
    await env.DB.prepare("UPDATE devices SET revoked_at = ? WHERE id = ?").bind(Date.now(), claudeDeviceId).run();
    expect((await rpc("tools/list")).status).toBe(401);
  });
});
