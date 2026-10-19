import { beforeAll, describe, expect, it } from "vitest";
import {
  connectorSecretHash,
  generateConnectorSecret,
  generateIdentity,
  isConnectorSecret,
  openClaudeDeviceKeys,
  ready,
  sealClaudeDeviceKeys,
} from "../src/index";

beforeAll(async () => {
  await ready();
});

describe("Claude connector secret", () => {
  it("is 43 base64url characters and hashes the same way every time", () => {
    const secret = generateConnectorSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isConnectorSecret(secret)).toBe(true);
    expect(connectorSecretHash(secret)).toEqual(connectorSecretHash(` ${secret} `));
    expect(connectorSecretHash(secret)).not.toEqual(connectorSecretHash(generateConnectorSecret()));
  });

  it("rejects anything that is not a secret", () => {
    expect(isConnectorSecret("")).toBe(false);
    expect(isConnectorSecret("short")).toBe(false);
    expect(isConnectorSecret("!".repeat(43))).toBe(false);
    expect(() => connectorSecretHash("short")).toThrow();
  });

  it("seals the device keys so only the secret and the device id open them", () => {
    const secret = generateConnectorSecret();
    const identity = generateIdentity();
    const sealed = sealClaudeDeviceKeys("dev1", identity, secret);
    expect(openClaudeDeviceKeys("dev1", sealed, secret)).toEqual(identity);
    expect(() => openClaudeDeviceKeys("dev1", sealed, generateConnectorSecret())).toThrow(/Could not open/);
    expect(() => openClaudeDeviceKeys("dev2", sealed, secret)).toThrow(/Could not open/);
    expect(JSON.stringify(sealed)).not.toContain(secret);
  });
});
