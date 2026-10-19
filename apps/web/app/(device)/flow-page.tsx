import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/lib/ui";
import styles from "@/lib/device/device.module.css";

/** The frame for signing in, joining and setting up: a back link, the title, then the flow. */
export function FlowPage({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <main className={styles.page}>
      <Link href="/" className={styles.back}>
        <Icon name="chevronLeft" size="m" />
        Back
      </Link>
      <header style={{ display: "grid", gap: 4 }}>
        <h1 className="display">{title}</h1>
        {sub && (
          <p className="sub" style={{ margin: 0 }}>
            {sub}
          </p>
        )}
      </header>
      {children}
    </main>
  );
}
