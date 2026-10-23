import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CryptoError } from "@map-diary/crypto";
import { ApiError, GroupError, InviteError, NetworkError, SetupError, WriteError, type Diary, type RejectedWrite, type SyncStatus } from "@map-diary/sync";
import { EntryError } from "../lib/entries/actions";
import { OFFLINE, SERVER, TABLES, UNKNOWN, syncErrorMessage, syncRejectionMessage, userMessage } from "../lib/errors/messages";

const toast = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const { watchSync } = await import("../lib/errors/notify");

const API_SRC = join(import.meta.dirname, "../../api/src");

/** Every error code the API Worker can answer with: the third argument of each `fail(c, status, "code")`. */
function apiErrorCodes(): string[] {
  const codes = new Set<string>();
  for (const file of readdirSync(API_SRC).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))) {
    for (const m of readFileSync(join(API_SRC, file), "utf8").matchAll(/fail\(c,\s*\d+,\s*"([a-z_]+)"\)/g)) codes.add(m[1]!);
  }
  return [...codes];
}

/** Every reason the API gives for refusing one envelope of a push. */
function pushRejectionReasons(): string[] {
  const src = readFileSync(join(API_SRC, "envelopes.ts"), "utf8");
  return [...new Set([...src.matchAll(/reason: "([a-z_]+)"/g)].map((m) => m[1]!))];
}

describe("error messages", () => {
  it("has words for every error code the API returns", () => {
    const codes = apiErrorCodes();
    expect(codes.length).toBeGreaterThan(30);
    expect(codes.filter((c) => !(c in TABLES.API))).toEqual([]);
  });

  it("has words, or a deliberate silence, for every reason a push is refused", () => {
    const reasons = pushRejectionReasons();
    expect(reasons).toContain("duplicate_place");
    // stale_key and place_not_on_master are re-sealed by the diary, never shown.
    const shown = reasons.filter((r) => r !== "stale_key" && r !== "place_not_on_master");
    expect(shown.filter((r) => !(r in TABLES.REJECTED))).toEqual([]);
    expect(syncRejectionMessage("deleted")).toBeNull();
    expect(syncRejectionMessage("something_new")).toMatch(/refused/);
  });

  it("ends every message with a full stop and never leaks a code", () => {
    for (const [table, messages] of Object.entries(TABLES)) {
      for (const [code, text] of Object.entries(messages)) {
        if (text === null) continue;
        expect(text, `${table}.${code}`).toMatch(/[.!?]$/);
        expect(text, `${table}.${code}`).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
      }
    }
  });

  it("maps each kind of error to its sentence", () => {
    expect(userMessage(new NetworkError())).toBe(OFFLINE);
    expect(userMessage(new SetupError("wrong_passphrase"))).toMatch(/passphrase didn't match/);
    expect(userMessage(new InviteError("offline"))).toBe(OFFLINE);
    expect(userMessage(new GroupError("empty_name"))).toBe("A group needs a name.");
    expect(userMessage(new WriteError("no_board_key"))).toMatch(/Let it sync/);
    expect(userMessage(new ApiError(409, "conflict"))).toMatch(/another device/);
    expect(userMessage(new ApiError(503, "brand_new"))).toBe(SERVER);
    expect(userMessage(new ApiError(429, "brand_new"))).toMatch(/Too many tries/);
    expect(userMessage(new EntryError("A tag needs a name."))).toBe("A tag needs a name.");
    expect(userMessage(new DOMException("full", "QuotaExceededError"))).toMatch(/out of storage/);
  });

  it("never shows the text of an error it doesn't know", () => {
    expect(userMessage(new Error("Envelope signature is invalid"))).toBe(UNKNOWN);
    expect(userMessage(new CryptoError("bad_signature", "Envelope signature is invalid"))).not.toMatch(/Envelope/);
    expect(userMessage(new TypeError("Cannot read properties of undefined"))).toBe(UNKNOWN);
    expect(userMessage("a string")).toBe(UNKNOWN);
    expect(userMessage(undefined)).toBe(UNKNOWN);
  });

  it("stays quiet about the sync codes the welcome screen explains", () => {
    expect(syncErrorMessage(null)).toBeNull();
    expect(syncErrorMessage("device_revoked")).toBeNull();
    expect(syncErrorMessage("client_error")).toMatch(/couldn't finish syncing/);
    expect(syncErrorMessage("internal")).toBe(SERVER);
  });
});

/** Just enough of a Diary to drive its status and refusals by hand. */
function fakeDiary() {
  let status: SyncStatus = { phase: "idle", lastSyncedAt: null, pending: 0, error: null };
  const listeners = new Set<() => void>();
  const refusals = new Set<(r: readonly RejectedWrite[]) => void>();
  const diary = {
    getStatus: () => status,
    subscribe: (l: () => void) => (listeners.add(l), () => listeners.delete(l)),
    onRejected: (l: (r: readonly RejectedWrite[]) => void) => (refusals.add(l), () => refusals.delete(l)),
  } as unknown as Diary;
  return {
    diary,
    set(patch: Partial<SyncStatus>) {
      status = { ...status, ...patch };
      for (const l of listeners) l();
    },
    refuse(rejected: RejectedWrite[]) {
      for (const l of refusals) l(rejected);
    },
  };
}

describe("watchSync", () => {
  beforeEach(() => {
    toast.info.mockClear();
    toast.error.mockClear();
    toast.success.mockClear();
  });

  it("says offline once per outage and back online when a round lands", () => {
    const d = fakeDiary();
    const stop = watchSync(d.diary);
    for (let i = 0; i < 3; i++) {
      d.set({ phase: "syncing" });
      d.set({ phase: "offline" });
    }
    expect(toast.info).toHaveBeenCalledTimes(1);
    d.set({ phase: "syncing" });
    d.set({ phase: "idle" });
    expect(toast.success).toHaveBeenCalledWith("Back online. Everything's synced.", expect.anything());
    d.set({ phase: "idle" });
    expect(toast.success).toHaveBeenCalledTimes(1);
    stop();
  });

  it("shows a failed round's error once, and nothing for a removed device", () => {
    const d = fakeDiary();
    watchSync(d.diary);
    d.set({ phase: "error", error: "client_error" });
    d.set({ phase: "syncing" });
    d.set({ phase: "error", error: "client_error" });
    expect(toast.error).toHaveBeenCalledTimes(1);
    d.set({ phase: "error", error: "device_revoked" });
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("explains a refused write and keeps quiet about harmless ones", () => {
    const d = fakeDiary();
    watchSync(d.diary);
    d.refuse([
      { id: "a", type: "place", reason: "duplicate_place", placeId: "p" },
      { id: "b", type: "place", reason: "duplicate_place", placeId: "q" },
      { id: "c", type: "comment", reason: "deleted" },
    ]);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error.mock.calls[0]![0]).toMatch(/already in the diary/);
  });
});
