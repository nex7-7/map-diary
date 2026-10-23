"use client";

import { useEffect } from "react";
import { toastError } from "@/lib/errors";

/**
 * A promise that failed with nobody waiting on it would otherwise fail in silence. Say
 * something, in the same words as everywhere else; the error itself is never logged or shown.
 */
export function ErrorListener() {
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      if (e.reason instanceof DOMException && e.reason.name === "AbortError") return;
      toastError(e.reason);
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);
  return null;
}
