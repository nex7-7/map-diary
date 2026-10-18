"use client";

import { useEffect, useState } from "react";
import styles from "@/lib/device/device.module.css";
import { needsHomeScreenInstall } from "./messages";

export function InstallWarning() {
  const [show, setShow] = useState(false);
  useEffect(() => setShow(needsHomeScreenInstall()), []);
  if (!show) return null;
  return (
    <p className={styles.warning}>
      Add this page to your Home Screen first (Share, then Add to Home Screen) and open it from there. Otherwise Safari
      can erase your keys from this phone.
    </p>
  );
}
