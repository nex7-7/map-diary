import { describe, expect, it } from "vitest";
import { currentDeviceKind } from "../lib/device/kind";

describe("device kind", () => {
  it("is android only inside the Capacitor Android shell", () => {
    expect(currentDeviceKind({})).toBe("web");
    expect(currentDeviceKind({ Capacitor: { getPlatform: () => "web" } })).toBe("web");
    expect(currentDeviceKind({ Capacitor: { getPlatform: () => "ios" } })).toBe("web");
    expect(currentDeviceKind({ Capacitor: { getPlatform: () => "android" } })).toBe("android");
  });
});
