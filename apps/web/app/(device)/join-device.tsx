"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { joinPairing, type JoiningDevice } from "@map-diary/sync";
import { adoptDevice, api, currentDeviceKind } from "@/lib/device";
import styles from "@/lib/device/device.module.css";
import { pairingErrorMessage } from "./messages";

const POLL_MS = 2000;

/**
 * Signs this device in from one already signed in: type (or arrive with) the code shown on
 * the other device, check both screens show the same confirmation code, approve there.
 */
export function JoinDevice({ initialCode = "" }: { initialCode?: string }) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode);
  const [joining, setJoining] = useState<JoiningDevice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join(text: string) {
    setBusy(true);
    setError(null);
    try {
      setJoining(await joinPairing(api, text, currentDeviceKind()));
    } catch (err) {
      setError(pairingErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Arriving from the QR link joins straight away; `join` only sets state, so it is safe here.
  useEffect(() => {
    if (initialCode) void join(initialCode);
  }, [initialCode]);

  useEffect(() => {
    if (!joining) return;
    let live = true;
    const timer = setInterval(() => {
      joining.check().then(
        async (device) => {
          if (!live || !device) return;
          live = false;
          clearInterval(timer);
          await adoptDevice(device);
          router.push("/");
        },
        (err: unknown) => {
          if (!live) return;
          live = false;
          clearInterval(timer);
          setJoining(null);
          setError(pairingErrorMessage(err));
        },
      );
    }, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [joining, router]);

  if (joining) {
    return (
      <div className={styles.card}>
        <p>Check that your other device shows this code, then tap Add it there.</p>
        <p className={styles.code} aria-label="Confirmation code">
          {joining.code}
        </p>
        <p className="muted">Waiting for your other device…</p>
      </div>
    );
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void join(code);
  }

  return (
    <form className={styles.card} onSubmit={submit}>
      <p className="muted">
        On a device that is already signed in, open Devices and tap Add a device. Scan the QR code, or type the code
        it shows here.
      </p>
      <label className={styles.field}>
        <span>Code from your other device</span>
        <input
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="7K3QM-9XT2B"
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </label>
      {error && <p className={styles.error}>{error}</p>}
      <button className={styles.button} type="submit" disabled={busy}>
        {busy ? "Connecting…" : "Connect"}
      </button>
    </form>
  );
}
