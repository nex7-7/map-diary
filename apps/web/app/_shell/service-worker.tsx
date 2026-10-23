"use client";

import { useEffect } from "react";

/**
 * Registers the service worker (public/sw.js, written at build time), which keeps the app's
 * pages and files so the installed app opens offline. Not in `next dev`, where files change
 * under it.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Private mode or an old browser: the app still works online.
    });
  }, []);
  return null;
}
