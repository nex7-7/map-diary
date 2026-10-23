"use client";

import { useEffect } from "react";
import { addHrefFor, sharedText } from "@/lib/entries/share";

/**
 * `/share`, the manifest's share target: Android opens it with what another app shared in the
 * query. The service worker answers it from its cache, so the query stays on the device, and
 * this page moves the text into the Add sheet's fragment.
 */
export function SharePage() {
  useEffect(() => {
    location.replace(addHrefFor(sharedText(new URLSearchParams(location.search))));
  }, []);
  return <p className="sub" style={{ padding: 20 }}>Opening the Add sheet…</p>;
}
