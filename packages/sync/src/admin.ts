import { fromBase64 } from "@map-diary/crypto";
import type { AdminDeviceView, AdminResolverView, AdminStorageView, Api, ExportValue, Signer } from "./api";
import type { DeviceState } from "./device";
import { InviteError, attemptAdmin } from "./invites";

// The admin panel's Devices, Resolver and Data sections. The Worker checks the admin device's
// signature on every call; nothing here opens anyone's boards.

const signerOf = (device: DeviceState): Signer => ({ deviceId: device.deviceId, signSecretKey: device.identity.signSecretKey });

export async function listAllDevices(api: Api, device: DeviceState): Promise<AdminDeviceView[]> {
  return (await attemptAdmin(() => api.adminDevices(signerOf(device)))).devices;
}

/**
 * Signs out a device of someone else's account: the server refuses it from now on. Its owner
 * finishes the revoke (new account keys) from their own Devices screen.
 */
export async function signOutDevice(api: Api, device: DeviceState, deviceId: string): Promise<void> {
  await attemptAdmin(() => api.adminRevokeDevice(deviceId, signerOf(device)));
}

export function resolverQueue(api: Api, device: DeviceState): Promise<AdminResolverView> {
  return attemptAdmin(() => api.adminResolver(signerOf(device)));
}

export async function retryResolverJob(api: Api, device: DeviceState, jobId: string): Promise<void> {
  await attemptAdmin(() => api.adminRetryJob(jobId, signerOf(device)));
}

export async function retryFailedJobs(api: Api, device: DeviceState): Promise<number> {
  return (await attemptAdmin(() => api.adminRetryFailedJobs(signerOf(device)))).retried;
}

export function storageUsage(api: Api, device: DeviceState): Promise<AdminStorageView> {
  return attemptAdmin(() => api.adminStorage(signerOf(device)));
}

/** Pages per table before the export gives up, far beyond a few friends' data. */
const MAX_PAGES = 5000;

/**
 * A SQL backup of the whole database, one page at a time, in the same form as
 * `wrangler d1 export`: the schema, then an INSERT per row. Restore it into an empty database
 * with `wrangler d1 execute <db> --file`. It holds only what D1 holds (ciphertext, wrapped
 * keys, passphrase-sealed backups), never anything this device decrypted.
 */
export async function exportDatabase(api: Api, device: DeviceState, onTable?: (table: string) => void): Promise<string> {
  const signer = signerOf(device);
  const { tables, schema } = await attemptAdmin(() => api.adminExportSchema(signer));
  const lines = ["PRAGMA defer_foreign_keys=TRUE;", ...schema.map((s) => `${s};`)];
  for (const table of tables) {
    onTable?.(table);
    let after = 0;
    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES) throw new InviteError("server");
      const res = await attemptAdmin(() => api.adminExportPage(table, after, signer));
      for (const row of res.rows) lines.push(insertStatement(table, row));
      if (res.next === null) break;
      after = res.next;
    }
  }
  return `${lines.join("\n")}\n`;
}

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

export function insertStatement(table: string, row: Record<string, ExportValue>): string {
  const columns = Object.keys(row);
  const values = columns.map((c) => sqlValue(row[c] ?? null));
  return `INSERT INTO ${ident(table)} (${columns.map(ident).join(",")}) VALUES(${values.join(",")});`;
}

function sqlValue(value: ExportValue): string {
  if (value === null) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
  const hex = Array.from(fromBase64(value.b64), (b) => b.toString(16).padStart(2, "0")).join("");
  return `X'${hex}'`;
}
