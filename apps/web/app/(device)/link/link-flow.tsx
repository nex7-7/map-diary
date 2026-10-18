"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "@/lib/device";
import styles from "@/lib/device/device.module.css";
import { JoinDevice } from "../join-device";
import { needsHomeScreenInstall } from "../messages";

/** `/link#CODE`: where the QR code on another device leads. The code never reaches the server. */
export function LinkFlow() {
  const session = useSession();
  const [code, setCode] = useState<string | null>(null);
  const [homeScreen, setHomeScreen] = useState(false);

  useEffect(() => {
    setCode(decodeURIComponent(window.location.hash.slice(1)));
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
          Open the diary from your Home Screen, tap Sign in, choose Another device, and type this code there:
        </p>
        <p className={styles.code}>{code}</p>
      </div>
    );
  }
  return <JoinDevice initialCode={code} />;
}
