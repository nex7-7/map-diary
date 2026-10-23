"use client";

import { toast } from "sonner";
import type { Diary } from "@map-diary/sync";
import { syncErrorMessage, syncRejectionMessage, userMessage } from "./messages";

/** How long an error stays up; long enough to read twice. */
const ERROR_MS = 8000;

/**
 * Shows an error as a toast. The same sentence replaces itself rather than stacking, so a
 * button tapped three times offline shows one toast.
 */
export function toastError(err: unknown): void {
  const message = userMessage(err);
  toast.error(message, { id: message, duration: ERROR_MS });
}

/** Shows a sentence the app wrote (a refusal it explains itself) as an error toast. */
export function toastProblem(message: string): void {
  toast.error(message, { id: message, duration: ERROR_MS });
}

/**
 * Tells the person when syncing stops or a write is refused, which otherwise happens out of
 * sight: going offline (and back), a failed round, and writes the server keeps off the boards.
 * Returns a function that stops watching.
 */
export function watchSync(diary: Diary): () => void {
  // What was last said: offline, or the error sentence. Null while syncing works.
  let trouble: string | null = null;
  const offStatus = diary.subscribe(() => {
    const status = diary.getStatus();
    if (status.phase === "offline" && trouble !== OFFLINE_NOTE) {
      trouble = OFFLINE_NOTE;
      toast.info(OFFLINE_NOTE, { id: "sync", duration: 6000 });
    } else if (status.phase === "error") {
      const message = syncErrorMessage(status.error);
      if (message && message !== trouble) {
        trouble = message;
        toast.error(message, { id: "sync", duration: ERROR_MS });
      }
    } else if (status.phase === "idle" && trouble !== null) {
      toast.success(trouble === OFFLINE_NOTE ? "Back online. Everything's synced." : "Syncing again.", { id: "sync", duration: 3000 });
      trouble = null;
    }
  });
  const offRejected = diary.onRejected((rejected) => {
    for (const message of new Set(rejected.map((r) => syncRejectionMessage(r.reason)))) {
      if (message) toast.error(message, { id: message, duration: ERROR_MS * 2 });
    }
  });
  return () => {
    offStatus();
    offRejected();
  };
}

const OFFLINE_NOTE = "You're offline. Changes are kept on this device and sync when you're back.";
