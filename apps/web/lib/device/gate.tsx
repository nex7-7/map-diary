"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { Diary } from "@map-diary/sync";
import { useSession } from "./hooks";
import styles from "./device.module.css";

/**
 * Renders `children(diary)` once this device is signed in; otherwise offers first-run setup
 * and sign-in. Nothing is decrypted or shown before then.
 */
export function DeviceGate({ children }: { children: (diary: Diary) => ReactNode }) {
  const session = useSession();
  if (session.state === "loading") return <p className="muted">Opening your diary…</p>;
  if (session.state === "ready") return <>{children(session.diary)}</>;
  return (
    <div className={styles.card}>
      <p>This device isn&apos;t signed in yet.</p>
      <Link className={styles.button} href="/setup">
        Set up the diary
      </Link>
      <Link className={styles.secondary} href="/sign-in">
        Sign in with another device or my passphrase
      </Link>
    </div>
  );
}
