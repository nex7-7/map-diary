import { ready, signRequest, type DeviceKind, type Envelope, type KeyBackup } from "@map-diary/crypto";

/** The device's request-signing identity. */
export interface Signer {
  deviceId: string;
  signSecretKey: Uint8Array;
}

/** An error response from the API Worker; `code` is its `error` field. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`API ${status}: ${code}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** The network failed before any response; the sync loop treats this as offline. */
export class NetworkError extends Error {
  constructor() {
    super("Network request failed");
    this.name = "NetworkError";
  }
}

export interface ApiOptions {
  /** Origin of the API Worker, for example `https://map.snehilsinha.com`. Empty means same origin. */
  origin: string;
  fetch?: (request: Request) => Promise<Response>;
  /** Server clock offset correction; defaults to Date.now. */
  now?: () => number;
}

export interface DeviceBody {
  id: string;
  kind: DeviceKind;
  signPublicKey: string;
  boxPublicKey: string;
  authorization: string;
}

export interface WrappedBoardKey {
  boardId: string;
  keyVersion: number;
  wrappedKey: string;
}

export interface KeyBackupBody {
  lookup: string;
  backup: KeyBackup;
}

export type PairingState = "waiting" | "joined" | "approved";

export interface PairingView {
  state: PairingState;
  expiresAt: number;
  device?: Omit<DeviceBody, "authorization">;
  mac?: string;
}

export interface MeResponse {
  account: { id: string; isAdmin: boolean; boxPublicKey: string | null; boxKeyVersion: number };
  deviceId: string;
  boards: {
    id: string;
    kind: string;
    keyVersion: number;
    keys: { keyVersion: number; accountKeyVersion: number; wrappedKey: string }[];
  }[];
  devices: {
    id: string;
    kind: string;
    signPublicKey: string;
    boxPublicKey: string;
    createdAt: number;
    lastSeenAt: number | null;
    revokedAt: number | null;
  }[];
}

export interface PushResponse {
  accepted: string[];
  unchanged: string[];
  rejected: { id: string | null; reason: string }[];
}

export interface SyncResponse {
  envelopes: Envelope[];
  deleted: string[];
  devices: Record<string, { accountId: string; signPublicKey: string; revokedAt: number | null }>;
  cursor: number;
  more: boolean;
  /** The account's current box key version; newer than the device's means it must collect the new key. */
  boxKeyVersion: number;
  /** The boards the account is in now, with their current key versions. */
  boards?: BoardState[];
}

export interface BoardState {
  id: string;
  kind: string;
  keyVersion: number;
  /** A member left this group; a remaining member's device moves it to a new key. */
  rotationDue: boolean;
  /** A group's members, whose opinions its board shows. */
  memberIds?: string[];
}

export interface GroupMember {
  accountId: string;
  joinedAt: number;
  /** The account's box public key; board keys are wrapped to it. */
  boxPublicKey: string | null;
  boxKeyVersion: number;
}

export interface GroupView {
  id: string;
  keyVersion: number;
  rotationDue: boolean;
  members: GroupMember[];
}

export interface InviteView {
  boardId: string;
  nonce: string;
  sealedKeys: string;
  expiresAt: number;
  keyVersion: number;
  members: number;
  isMember: boolean;
}

/** A new group key wrapped to one member's account box key. */
export interface MemberKeyBody {
  accountId: string;
  accountKeyVersion: number;
  wrappedKey: string;
}

export interface RevokeBody {
  boxPublicKey: string;
  boxKeyVersion: number;
  boardKeys: WrappedBoardKey[];
  deviceKeys: { deviceId: string; sealedKey: string }[];
}

export type ResolverJobStatus = "pending" | "resolved" | "failed";

export interface ResolverJobResponse {
  id: string;
  status: ResolverJobStatus;
  /** base64url sealed box; open it with `openResolverResult` and the job's reply keys. */
  sealedResult?: string;
  expiresAt: number;
}

const encoder = new TextEncoder();

/** A thin, typed client for the routes in apps/api/README.md. Every signed call carries its own signature. */
export class Api {
  private readonly origin: string;
  private readonly doFetch: (request: Request) => Promise<Response>;
  private readonly now: () => number;

  constructor(options: ApiOptions) {
    this.origin = options.origin.replace(/\/$/, "");
    this.doFetch = options.fetch ?? ((r) => fetch(r));
    this.now = options.now ?? Date.now;
  }

  private async call<T>(method: string, path: string, body: unknown, signer: Signer | null): Promise<T> {
    const text = body === undefined ? "" : JSON.stringify(body);
    const headers: Record<string, string> = {};
    if (text) headers["Content-Type"] = "application/json";
    if (signer) {
      // A page can sign its first request before anything else has loaded libsodium.
      await ready();
      Object.assign(
        headers,
        signRequest(
          { method, path, deviceId: signer.deviceId, timestamp: this.now(), body: encoder.encode(text) },
          signer.signSecretKey,
        ),
      );
    }
    // A relative URL needs a base outside the browser; same-origin requests resolve against the page.
    const base = this.origin || (typeof location === "undefined" ? "http://localhost" : location.origin);
    const request = new Request(base + path, { method, headers, ...(text ? { body: text } : {}) });

    let res: Response;
    try {
      res = await this.doFetch(request);
    } catch {
      throw new NetworkError();
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      const code =
        typeof json === "object" && json !== null && typeof (json as { error?: unknown }).error === "string"
          ? (json as { error: string }).error
          : "http_error";
      throw new ApiError(res.status, code);
    }
    return json as T;
  }

  createAccount(
    body: {
      account: { id: string; signPublicKey: string; boxPublicKey: string };
      device: DeviceBody;
      personalBoard: { id: string; wrappedKey: string };
      keyBackup: KeyBackupBody;
    },
    signer: Signer,
  ) {
    return this.call<{ accountId: string; deviceId: string; personalBoardId: string }>("POST", "/api/accounts", body, signer);
  }

  registerDevice(body: { accountId: string; device: DeviceBody }, signer: Signer) {
    return this.call<{ accountId: string; deviceId: string }>("POST", "/api/devices", body, signer);
  }

  fetchKeyBackup(lookup: string) {
    return this.call<{ accountId: string; backup: KeyBackup }>("POST", "/api/key-backup/fetch", { lookup }, null);
  }

  putKeyBackup(body: KeyBackupBody, signer: Signer) {
    return this.call<{ ok: true }>("PUT", "/api/key-backup", body, signer);
  }

  me(signer: Signer) {
    return this.call<MeResponse>("GET", "/api/me", undefined, signer);
  }

  putBoardKeys(boardKeys: WrappedBoardKey[], signer: Signer) {
    return this.call<{ stored: number }>("PUT", "/api/board-keys", { boardKeys }, signer);
  }

  // Device pairing: the old device opens, reads and approves; the new device joins,
  // polls and collects. See packages/crypto/src/pairing.ts.

  openPairing(id: string, signer: Signer) {
    return this.call<{ id: string; expiresAt: number }>("POST", "/api/pairings", { id }, signer);
  }

  readPairing(id: string, signer: Signer) {
    return this.call<PairingView>("GET", `/api/pairings/${encodeURIComponent(id)}`, undefined, signer);
  }

  approvePairing(id: string, body: { authorization: string; sealedTransfer: string }, signer: Signer) {
    return this.call<{ deviceId: string }>("POST", `/api/pairings/${encodeURIComponent(id)}/approve`, body, signer);
  }

  cancelPairing(id: string, signer: Signer) {
    return this.call<undefined>("DELETE", `/api/pairings/${encodeURIComponent(id)}`, undefined, signer);
  }

  joinPairing(id: string, body: { device: Omit<DeviceBody, "authorization">; mac: string }) {
    return this.call<{ state: "joined" }>("POST", `/api/pairings/${encodeURIComponent(id)}/join`, body, null);
  }

  pairingStatus(id: string) {
    return this.call<{ state: PairingState }>("GET", `/api/pairings/${encodeURIComponent(id)}/status`, undefined, null);
  }

  collectPairing(id: string, signer: Signer) {
    return this.call<{ sealedTransfer: string }>("GET", `/api/pairings/${encodeURIComponent(id)}/transfer`, undefined, signer);
  }

  /** Revokes another device of this account and moves the account to the next box key version. */
  revokeDevice(id: string, body: RevokeBody, signer: Signer) {
    return this.call<{ revoked: string; boxKeyVersion: number }>(
      "POST",
      `/api/devices/${encodeURIComponent(id)}/revoke`,
      body,
      signer,
    );
  }

  /** The account box key sealed to this device, at the account's current version. */
  accountKey(signer: Signer) {
    return this.call<{ version: number; sealedKey: string }>("GET", "/api/me/account-key", undefined, signer);
  }

  pushEnvelopes(envelopes: Envelope[], signer: Signer) {
    return this.call<PushResponse>("POST", "/api/envelopes", { envelopes }, signer);
  }

  deleteEnvelopes(ids: string[], signer: Signer) {
    return this.call<{ deleted: string[] }>("POST", "/api/envelopes/delete", { ids }, signer);
  }

  pull(since: number, signer: Signer, limit?: number) {
    const query = `since=${since}` + (limit === undefined ? "" : `&limit=${limit}`);
    return this.call<SyncResponse>("GET", `/api/sync?${query}`, undefined, signer);
  }

  // Groups: see apps/api/src/groups.ts.

  listGroups(signer: Signer) {
    return this.call<{ groups: GroupView[] }>("GET", "/api/groups", undefined, signer);
  }

  createGroup(body: { boardId: string; wrappedKey: string }, signer: Signer) {
    return this.call<{ id: string; keyVersion: number }>("POST", "/api/groups", body, signer);
  }

  createInvite(groupId: string, body: { id: string; tokenHash: string; nonce: string; sealedKeys: string }, signer: Signer) {
    return this.call<{ id: string; expiresAt: number }>(
      "POST",
      `/api/groups/${encodeURIComponent(groupId)}/invites`,
      body,
      signer,
    );
  }

  readInvite(id: string, signer: Signer) {
    return this.call<InviteView>("GET", `/api/invites/${encodeURIComponent(id)}`, undefined, signer);
  }

  acceptInvite(id: string, body: { token: string; keys: { keyVersion: number; wrappedKey: string }[] }, signer: Signer) {
    return this.call<{ boardId: string; keyVersion: number }>(
      "POST",
      `/api/invites/${encodeURIComponent(id)}/accept`,
      body,
      signer,
    );
  }

  rotateGroup(groupId: string, body: { keyVersion: number; memberKeys: MemberKeyBody[] }, signer: Signer) {
    return this.call<{ id: string; keyVersion: number }>(
      "POST",
      `/api/groups/${encodeURIComponent(groupId)}/rotate`,
      body,
      signer,
    );
  }

  removeMember(groupId: string, accountId: string, body: { keyVersion: number; memberKeys: MemberKeyBody[] }, signer: Signer) {
    return this.call<{ id: string; keyVersion: number; removed: string }>(
      "POST",
      `/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(accountId)}/remove`,
      body,
      signer,
    );
  }

  leaveGroup(groupId: string, signer: Signer) {
    return this.call<{ id: string; left: true }>("POST", `/api/groups/${encodeURIComponent(groupId)}/leave`, undefined, signer);
  }

  // Resolver jobs are anonymous: these calls are never signed, so the server cannot tie a
  // job to an account. The job id is the only handle on it.

  submitResolverJob(query: string, replyPublicKey: string) {
    return this.call<ResolverJobResponse>("POST", "/api/resolver/jobs", { query, replyPublicKey }, null);
  }

  getResolverJob(id: string) {
    return this.call<ResolverJobResponse>("GET", `/api/resolver/jobs/${encodeURIComponent(id)}`, undefined, null);
  }

  deleteResolverJob(id: string) {
    return this.call<undefined>("DELETE", `/api/resolver/jobs/${encodeURIComponent(id)}`, undefined, null);
  }

  /** Expands a short Google Maps link to the full URL; parse its coordinates on the device. */
  expandMapsLink(url: string) {
    return this.call<{ url: string }>("POST", "/api/resolver/expand", { url }, null);
  }
}
