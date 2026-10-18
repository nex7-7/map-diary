"use client";

import { useEffect, useState } from "react";
import { ready } from "@map-diary/crypto";

type Status = "loading" | "ready" | "failed";

/** Confirms libsodium loads in this browser; all crypto runs on the device. */
export function CryptoStatus() {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    let cancelled = false;
    ready().then(
      () => !cancelled && setStatus("ready"),
      () => !cancelled && setStatus("failed"),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const label = { loading: "Loading encryption…", ready: "Encryption ready on this device", failed: "Encryption failed to load" }[status];
  return <p data-status={status}>{label}</p>;
}
