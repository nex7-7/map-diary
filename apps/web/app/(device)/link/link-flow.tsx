"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSession } from "@/lib/device";
import styles from "@/lib/device/device.module.css";
import { JoinDevice } from "../join-device";
import { needsHomeScreenInstall } from "../messages";

/** `/link#CODE`: where the QR code on another device leads. The code never reaches the server. */
export function LinkFlow() {
  const session = useSession();
  const [code, setCode] = useState<string | null>(null);
  const [homeScreen, setHomeScreen] = useState(false);

  const read = useRef<string | undefined>(undefined);

  useEffect(() => {
    read.current ??= decodeURIComponent(window.location.hash.slice(1));
    setCode(read.current);
    // Keep the secret out of the address bar and history once read.
    if (read.current) window.history.replaceState(null, "", window.location.pathname);
    setHomeScreen(needsHomeScreenInstall());
  }, []);

  if (session.state === "loading" || code === null) return <p className="muted">Opening…</p>;
  if (session.state === "ready") {
    return (
      <div className={styles.card}>
        <p>This device is already signed in.</p>
        <Link className={styles.button} href="/">
          Open the diary
        </Link>
      </div>
    );
  }
  // The camera opens links in Safari, whose storage is separate from the Home Screen app.
  if (homeScreen) {
    return (
      <div className={styles.card}>
        <p>
          Open the diary from your Home Screen, tap <strong>Add this phone from another device</strong>, and type this code there:
        </p>
        <p className={styles.code}>{code}</p>
      </div>
    );
  }
  return <JoinDevice initialCode={code} />;
}
