import { describe, expect, it } from "vitest";
import { deviceNames, forgetDeviceName, guessDeviceName, nameDevice } from "../lib/device/names";
import { FakeDiary } from "./fake-diary";

describe("device names", () => {
  it("names a device on the Personal board and renames it in place", async () => {
    const diary = new FakeDiary();
    await nameDevice(diary, "dev-1", "  Laptop  ");
    await nameDevice(diary, "dev-1", "Work laptop");
    expect(await deviceNames(diary)).toEqual(new Map([["dev-1", "Work laptop"]]));
    const items = await diary.listItems();
    expect(items).toHaveLength(1);
    expect(items[0]?.boardIds).toEqual(["board-personal"]);
  });

  it("refuses an empty name and drops a removed device's name", async () => {
    const diary = new FakeDiary();
    await expect(nameDevice(diary, "dev-1", " \u0007 ")).rejects.toThrow();
    await nameDevice(diary, "dev-1", "Phone");
    await nameDevice(diary, "dev-2", "Laptop");
    await forgetDeviceName(diary, "dev-1");
    expect(await deviceNames(diary)).toEqual(new Map([["dev-2", "Laptop"]]));
  });

  it("ignores names written by someone else", async () => {
    const diary = new FakeDiary();
    await diary.write({ type: "device_name", placeId: null, payload: { deviceId: "dev-1", name: "Theirs" } });
    const item = [...diary.items.values()][0]!;
    diary.items.set(item.id, { ...item, authorId: "acct-other" });
    expect(await deviceNames(diary)).toEqual(new Map());
  });
});

describe("guessDeviceName", () => {
  const cases: [string, string][] = [
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", "iPhone · Safari"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0", "Windows · Firefox"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36", "Mac · Chrome"],
    ["Mozilla/5.0 (Linux; Android 15; A015) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36", "Android phone · Chrome"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0", "Windows · Edge"],
    ["curl/8.0", "Browser"],
  ];
  it.each(cases)("%s", (ua, name) => expect(guessDeviceName(ua, "web")).toBe(name));
  it("calls the Android shell the Android app", () => expect(guessDeviceName("anything", "android")).toBe("Android app"));
});
