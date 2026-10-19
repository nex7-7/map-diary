"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { Diary } from "@map-diary/sync";
import { useSession } from "./hooks";
import { wasRemoved } from "./session";
import styles from "./device.module.css";

/**
 * Renders `children(diary)` once this device is signed in; otherwise offers joining with an
 * invite and sign-in. Nothing is decrypted or shown before then.
 */
export function DeviceGate({ children }: { children: (diary: Diary) => ReactNode }) {
  const session = useSession();
  if (session.state === "loading") return <p className="muted">Opening your diary…</p>;
  if (session.state === "ready") return <>{children(session.diary)}</>;
  return (
    <div className={styles.card}>
      {wasRemoved() ? (
        <p>This device was removed from the diary, so its copy was cleared.</p>
      ) : (
        <p>This device isn&apos;t signed in yet.</p>
      )}
      <Link className={styles.button} href="/invite">
        Join with an invite code
      </Link>
      <Link className={styles.secondary} href="/sign-in">
        Sign in with another device or my passphrase
      </Link>
    </div>
  );
}
