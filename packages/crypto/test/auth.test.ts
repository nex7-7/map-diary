import { beforeAll, describe, expect, it } from "vitest";
import {
  authorizeDevice,
  backupLookupId,
  generateAccountKeys,
  generateIdentity,
  ready,
  signRequest,
  verifyDeviceAuthorization,
  verifyRequest,
  type DeviceToAuthorize,
  type RequestToSign,
} from "../src/index";

const utf8ForTest = (s: string) => new TextEncoder().encode(s);

beforeAll(async () => {
  await ready();
});

describe("request signatures", () => {
  const device = () => generateIdentity();
  const request = (body = "{}"): RequestToSign => ({
    method: "post",
    path: "/api/envelopes",
    deviceId: "dev1",
    timestamp: 1_760_000_000_000,
    body: utf8ForTest(body),
  });

  it("verifies a signed request and rejects any changed field", () => {
    const d = device();
    const headers = signRequest(request(), d.signSecretKey);
    const sig = headers["X-Signature"] ?? "";
    expect(headers["X-Device-Id"]).toBe("dev1");
    expect(verifyRequest(request(), sig, d.signPublicKey)).toBe(true);
    expect(verifyRequest({ ...request(), method: "PUT" }, sig, d.signPublicKey)).toBe(false);
    expect(verifyRequest({ ...request(), path: "/api/other" }, sig, d.signPublicKey)).toBe(false);
    expect(verifyRequest({ ...request(), timestamp: 1 }, sig, d.signPublicKey)).toBe(false);
    expect(verifyRequest(request('{"x":1}'), sig, d.signPublicKey)).toBe(false);
    expect(verifyRequest(request(), sig, device().signPublicKey)).toBe(false);
    expect(verifyRequest(request(), "not base64!", d.signPublicKey)).toBe(false);
  });
});

describe("device authorisation", () => {
  it("binds the device keys to the account key", () => {
    const account = generateAccountKeys();
    const d = generateIdentity();
    const toAuthorize: DeviceToAuthorize = {
      accountId: "acc1",
      deviceId: "dev1",
      kind: "web",
      signPublicKey: d.signPublicKey,
      boxPublicKey: d.boxPublicKey,
    };
    const auth = authorizeDevice(toAuthorize, account.signSecretKey);
    expect(verifyDeviceAuthorization(toAuthorize, auth, account.signPublicKey)).toBe(true);
    expect(verifyDeviceAuthorization({ ...toAuthorize, kind: "claude" }, auth, account.signPublicKey)).toBe(false);
    expect(
      verifyDeviceAuthorization(
        { ...toAuthorize, boxPublicKey: generateIdentity().boxPublicKey },
        auth,
        account.signPublicKey,
      ),
    ).toBe(false);
    expect(verifyDeviceAuthorization(toAuthorize, auth, generateAccountKeys().signPublicKey)).toBe(false);
  });
});

describe("backup lookup id", () => {
  it("is deterministic per passphrase and normalised", () => {
    const a = backupLookupId("dosa at 2am");
    expect(backupLookupId("dosa at 2am")).toBe(a);
    expect(backupLookupId("dosa at 3am")).not.toBe(a);
    // "é" composed vs decomposed
    expect(backupLookupId("café")).toBe(backupLookupId("café"));
    expect(() => backupLookupId("")).toThrow();
  });
});
