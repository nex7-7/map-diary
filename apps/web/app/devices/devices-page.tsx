"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";
import { PairingError, type OpenPairing, type PairingCheck } from "@map-diary/sync";
import entries from "@/app/_entries/entries.module.css";
import { pairingErrorMessage } from "@/app/(device)/messages";
import { DeviceGate, addDevice, listDevices, type Diary, type ListedDevice } from "@/lib/device";
import styles from "@/lib/device/device.module.css";

const POLL_MS = 2000;

const KIND_LABEL: Record<string, string> = { web: "Browser", android: "Android app", claude: "Claude" };

/** `/devices`: the devices signed in to this account, and linking a new one. */
export function DevicesPage() {
  return (
    <main>
      <Link href="/" className={entries.back}>
        ← Diary
      </Link>
      <h1 style={{ margin: "12px 0 16px" }}>Devices</h1>
      <DeviceGate>{(diary) => <Devices diary={diary} />}</DeviceGate>
    </main>
  );
}

function Devices({ diary }: { diary: Diary }) {
  const [devices, setDevices] = useState<ListedDevice[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    listDevices(diary).then(
      (list) => {
        setDevices(list);
        setLoadFailed(false);
      },
      () => {
        setDevices((d) => d ?? []);
        setLoadFailed(true);
      },
    );
  }, [diary]);
  useEffect(load, [load]);

  const day = (ms: number) => new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className={styles.card}>
      {loadFailed && <p className={styles.error}>Couldn&apos;t load your devices. Check your connection and reload.</p>}
      {devices === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
          {devices.map((d) => (
            <li key={d.id}>
              <strong>{KIND_LABEL[d.kind] ?? d.kind}</strong>
              {d.current && " (this device)"}
              <br />
              <span className="muted">
                Added {day(d.createdAt)}
                {d.lastSeenAt !== null && ` · last used ${day(d.lastSeenAt)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <AddDevice
          diary={diary}
          onDone={() => {
            setAdding(false);
            load();
          }}
        />
      ) : (
        <button className={styles.button} type="button" onClick={() => setAdding(true)}>
          Add a device
        </button>
      )}
    </div>
  );
}

/** Shows a QR code and a typed code for the new device, then asks to confirm its code. */
function AddDevice({ diary, onDone }: { diary: Diary; onDone: () => void }) {
  const [pairing, setPairing] = useState<OpenPairing | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [seen, setSeen] = useState<PairingCheck>({ state: "waiting" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    let opened: OpenPairing | null = null;
    setError(null);
    setSeen({ state: "waiting" });
    addDevice(diary).then(
      async (p) => {
        opened = p;
        if (!live) return void p.cancel();
        setPairing(p);
        setQr(await QRCode.toDataURL(p.link, { margin: 1, width: 240 }));
      },
      (err: unknown) => live && setError(pairingErrorMessage(err)),
    );
    return () => {
      live = false;
      void opened?.cancel();
    };
  }, [diary, attempt]);

  // Poll until the new device joins; stop once it has, so the code stays put while the person compares.
  useEffect(() => {
    if (!pairing || seen.state !== "waiting") return;
    const timer = setInterval(() => {
      if (Date.now() > pairing.expiresAt) {
        clearInterval(timer);
        setError(pairingErrorMessage(new PairingError("expired")));
        return;
      }
      pairing.check().then(setSeen, (err: unknown) => {
        clearInterval(timer);
        setError(pairingErrorMessage(err));
      });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [pairing, seen.state]);

  async function approve() {
    if (!pairing) return;
    setBusy(true);
    try {
      await pairing.approve();
      onDone();
    } catch (err) {
      setError(pairingErrorMessage(err));
      setBusy(false);
    }
  }

  async function cancel() {
    await pairing?.cancel();
    onDone();
  }

  if (error) {
    return (
      <>
        <p className={styles.error}>{error}</p>
        <button className={styles.button} type="button" onClick={() => setAttempt((n) => n + 1)}>
          Make a new code
        </button>
        <button className={styles.secondary} type="button" onClick={() => void cancel()}>
          Close
        </button>
      </>
    );
  }

  if (seen.state === "joined") {
    return (
      <>
        <p>
          A new {KIND_LABEL[seen.kind]?.toLowerCase() ?? "device"} wants to join. Add it only if it shows this code:
        </p>
        <p className={styles.code} aria-label="Confirmation code">
          {seen.code}
        </p>
        <button className={styles.button} type="button" disabled={busy} onClick={() => void approve()}>
          {busy ? "Adding…" : "The codes match, add it"}
        </button>
        <button className={styles.secondary} type="button" disabled={busy} onClick={() => void cancel()}>
          They don&apos;t match
        </button>
      </>
    );
  }

  return (
    <>
      <p>On the new device, scan this with the camera, or open the diary, tap Sign in, choose Another device and type the code.</p>
      {qr ? <img src={qr} alt="QR code to add a device" width={240} height={240} /> : <p className="muted">Making a code…</p>}
      {pairing && <p className={styles.code}>{pairing.secret}</p>}
      <p className="muted">The code works once, for ten minutes.</p>
      <button className={styles.secondary} type="button" onClick={() => void cancel()}>
        Cancel
      </button>
    </>
  );
}
